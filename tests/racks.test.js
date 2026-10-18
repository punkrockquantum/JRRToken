import assert from "node:assert/strict"
import test from "node:test"
import { PLATFORMS, USE_CASES, byId } from "../js/data.js"
import { thinkLines } from "../js/explain.js"
import { evaluateBuild } from "../js/model.js"
import { brainPick, choicesToBuild, defaultChoices, defaultRacks, expertChoices, nerdChoices, rackCount, simpleBrainIds, simpleChoices } from "../js/presets.js"
import { applyRacks, applyTile, budgetOf, gpuRows, landingRacks, rackBounds, rackGuard, stepTiles } from "../js/steps.js"

/* User: "The compute / GPU section isn't accurate. Allow users to choose how many racks, so the solution could be
   lower power / older chips but more racks - ensure that is factored in to the maths that calculates the resulting
   performance and displayed on the right." */

const score = (id, choices, nerd = false) => evaluateBuild(id, choicesToBuild(id, choices, nerd))

test("the rack count is the player's when set, else the platform's sensible default for the crowd; both boards carry it into the build", () => {
  assert.equal(rackCount({}), null)
  assert.equal(rackCount({ racks: 0 }), null)
  assert.equal(rackCount({ racks: 2.5 }), null)
  assert.equal(rackCount({ racks: "7" }), 7)
  assert.deepEqual(brainPick("chat", "b300", "large"), { platform: "b300", racks: 6 })
  assert.deepEqual(brainPick("chat", "b300", "large", 9), { platform: "b300", racks: 9 })
  assert.deepEqual(brainPick("chat", "h100", "large", 1), { platform: "h100", racks: 1 })
  assert.equal(defaultRacks("chat", "b300"), 6)
  assert.equal(defaultRacks("robot", "rtx6000"), 9)
  /* HUGE is the nerd trap and brings its own count. */
  assert.equal(brainPick("chat", "huge", "large", 1).racks, brainPick("chat", "huge", "large").racks)
  for (const { id } of USE_CASES) {
    const base = { ...defaultChoices(id), racks: 3 }
    assert.equal(choicesToBuild(id, base, false).racks, 3, `${id} simple board`)
    assert.equal(choicesToBuild(id, base, true).racks, 3, `${id} nerd board`)
    assert.equal(simpleChoices(id, base).racks, 3)
    assert.equal(nerdChoices(id, base).racks, 3)
    assert.equal(choicesToBuild(id, defaultChoices(id), false).racks, defaultRacks(id, defaultChoices(id).brains), `${id} default count`)
  }
})

test("an NVL72 rack's worth of shoppers takes about twenty H100 racks, at several times the power and the floor space", () => {
  /* One metro, so one NVL72 rack is a whole build (two metros need a rack each); the Hopper racks sit under containment. */
  const expert = { ...expertChoices("chat"), metros: ["lon"] }
  const one = score("chat", { ...expert, brains: "gb200", racks: 1 }, true)
  assert.ok(one.coverage > 0.3, `one NVL72 rack serves a good share: ${one.coverage}`)
  const hopper = (racks) => score("chat", { ...expert, brains: "h100", home: "aisle", racks }, true)
  const h1 = hopper(1)
  const h8 = hopper(8)
  assert.ok(Math.abs(h8.coverage / (8 * h1.coverage) - 1) < 0.05, "coverage climbs rack by rack while nothing bites")
  const equivalent = one.coverage / h1.coverage
  assert.ok(equivalent >= 15 && equivalent <= 30, `about twenty Hopper racks for one NVL72 rack: ${equivalent.toFixed(1)}`)
  assert.ok(equivalent * byId(PLATFORMS, "h100").rackKW > one.siteKW * 1.5, `power ${Math.round(equivalent * 22)} kW against ${one.siteKW} kW`)
  assert.ok(equivalent > one.spaceUsed * 4, `space ${equivalent.toFixed(0)} racks against ${one.spaceUsed}`)
  /* Twenty racks reach 90% of the NVL72 rack's crowd inside the power room; the twenty-first browns out; all of them
     are over the budget, so the stepper would have refused them long before. */
  const twenty = hopper(20)
  assert.ok(twenty.coverage >= one.coverage * 0.9 && !twenty.overPower && twenty.overBudget, `${twenty.coverage.toFixed(3)} vs ${one.coverage.toFixed(3)}`)
  assert.ok(hopper(21).overPower && hopper(21).coverage > twenty.coverage * 0.95, "the next rack browns out rather than failing")
  for (let racks = 1; racks <= 8; racks += 1) {
    const result = hopper(racks)
    assert.equal(result.racks, racks)
    assert.equal(result.rackItKW, racks * byId(PLATFORMS, "h100").rackKW)
  }
  /* The lesson the user asked for: an older air-cooled rack, more of them, can beat the tile's default. */
  const seven = score("chat", { ...expertChoices("chat"), brains: "b300", home: "aisle", racks: 7 }, false)
  const two = score("chat", { ...expertChoices("chat"), brains: "gb200", racks: 2 }, false)
  assert.ok(seven.score > two.score && !seven.overBudget && !seven.overPower, `seven HGX B300 racks under containment (${seven.score}) beat two NVL72 racks (${two.score})`)
})

test("the stepper never steps over the budget: plus is refused and tagged OVER BUDGET, minus always works, the range is the hall's rack positions", () => {
  for (const { id } of USE_CASES) {
    for (const nerd of [false, true]) {
      /* The walk starts on the cheap Hopper tile, so every story has room for more racks before the budget bites. */
      let choices = { ...defaultChoices(id), brains: "h200", brainsAuto: false }
      const bounds = rackBounds(id, choices, nerd)
      assert.equal(bounds.min, 1)
      assert.ok(bounds.max >= 12 && bounds.max <= 72, `${id} range to ${bounds.max}`)
      assert.deepEqual(bounds.steps, nerd ? [-5, -1, 1, 5] : [-1, 1])
      let presses = 0
      for (;;) {
        const guard = rackGuard(id, choices, 1, nerd)
        if (guard.blocked) {
          if (!guard.atEnd) {
            assert.match(guard.tag, /^OVER BUDGET by \$/)
            assert.match(guard.line, /would be over the \$[\d.,]+[kM]? budget by/)
            assert.ok(budgetOf(id, applyRacks(id, choices, 1, nerd), nerd).over, `${id}: the refused count really is over budget`)
          }
          break
        }
        choices = applyRacks(id, choices, 1, nerd)
        presses += 1
        assert.ok(!budgetOf(id, choices, nerd).over, `${id} ${nerd ? "nerd" : "simple"}: ${choices.racks} racks stay inside the budget`)
        assert.ok(presses < 80, "the walk ends")
      }
      assert.ok(presses >= 1, `${id}: at least one more Hopper rack is affordable`)
      /* The opening build itself never sits over budget, whatever the stepper says about the next rack. */
      assert.ok(!budgetOf(id, defaultChoices(id), nerd).over, `${id}: the opening build is affordable`)
      /* Minus walks back down to one rack and never below. */
      while (rackCount(choices) > 1) {
        const guard = rackGuard(id, choices, -1, nerd)
        assert.equal(guard.blocked, false)
        choices = applyRacks(id, choices, -1, nerd)
      }
      assert.equal(rackGuard(id, choices, -1, nerd).atEnd, true, `${id}: one rack is the floor`)
      assert.equal(applyRacks(id, choices, -5, nerd).racks, 1)
    }
  }
  /* Past the power offer is allowed and browns out: the engine, not the guard, says so. */
  const hot = { ...expertChoices("drug"), racks: 6 }
  const result = score("drug", hot, true)
  assert.equal(result.overPower, true)
  assert.ok(result.score >= 100 && result.warnings.some((line) => /brown out/.test(line)), `${result.score}: ${result.warnings.join(" | ")}`)
  assert.equal(rackGuard("drug", { ...expertChoices("drug"), racks: 5 }, 1, true).blocked, false, "the sixth rack is affordable, so the stepper allows it and the board shows the brown-out")
})

test("every GPU tile shows the count it would land on and four numbers that equal evaluateBuild for exactly that build", () => {
  for (const { id } of USE_CASES) {
    for (const nerd of [false, true]) {
      for (const choices of [defaultChoices(id), { ...defaultChoices(id), racks: 3, brainsAuto: false }, expertChoices(id)]) {
        for (const tile of stepTiles(id, "gpu", nerd, choices)) {
          const landing = landingRacks(id, tile.id, choices, nerd)
          assert.equal(tile.racks, landing.racks, `${id} ${tile.id}: the tile counts the racks it lands on`)
          const next = applyTile(id, "gpu", tile.id, choices, nerd)
          const result = score(id, next, nerd)
          assert.equal(result.racks, tile.racks, `${id} ${tile.id}: the pick makes the build the tile described`)
          assert.deepEqual(tile.rows, gpuRows(result, tile.platform), `${id} ${tile.id}: rows from the engine`)
          assert.deepEqual(tile.rows.map((row) => row.label), ["SERVES", "POWER", "COST", "LEAD"])
          assert.equal(tile.rows[0].text, `${Math.round(result.coverage * 100)}%`)
          assert.equal(tile.rows[1].text, `${result.powerUsedMW.toFixed(2)}/${result.powerMW} MW`)
          assert.equal(tile.rows[3].text, `${tile.platform.leadWeeks} wk`)
          if (tile.id !== "huge") assert.match(tile.label, new RegExp(`×${tile.id === "spark" ? tile.racks * 16 : tile.racks}$`))
        }
      }
    }
  }
  /* The count belongs to the rack it was set for: the chosen tile keeps it, every other tile shows its own default,
     and picking another rack starts at that default (a count that suits six HGX racks misreads an NVL72 tile). */
  const seven = { ...defaultChoices("chat"), racks: 7, brainsAuto: false }
  assert.equal(landingRacks("chat", "b300", seven).racks, 7, "the chosen HGX B300 tile carries the player's seven")
  assert.equal(landingRacks("chat", "h200", seven).racks, defaultRacks("chat", "h200"), "another tile shows its own default")
  assert.equal(landingRacks("chat", "gb200", seven).racks, 2)
  assert.equal(applyTile("chat", "gpu", "h200", seven).racks, undefined)
  assert.equal(score("chat", applyTile("chat", "gpu", "h200", seven)).racks, defaultRacks("chat", "h200"))
  assert.equal(applyTile("chat", "gpu", "b300", seven).racks, 7, "re-tapping the chosen tile keeps the count")
  assert.ok(simpleBrainIds("chat").every((brains) => stepTiles("chat", "gpu", false, seven).some((tile) => tile.id === brains)))
  /* The stepper then takes the new rack from its default. */
  assert.equal(applyRacks("chat", applyTile("chat", "gpu", "h200", seven), 1).racks, defaultRacks("chat", "h200") + 1)
})

test("the Scouter and HOW WE THINK read every stepper press from evaluateBuild: the count, the power sum, the spend and the share follow the racks", () => {
  /* The right-hand panel renders live() = evaluateBuild(choicesToBuild(choices)); each press makes a new choice set, so the
     same call gives the same numbers the gauges show (MONEY = budgetSpend / budget, POWER = powerUsedMW / powerMW, CROWD =
     coverage) and the nerd working repeats the power sum rack by rack. */
  for (const { id } of USE_CASES) {
    for (const nerd of [false, true]) {
      let choices = { ...defaultChoices(id), brains: "h200", brainsAuto: false }
      let previous = score(id, choices, nerd)
      for (let press = 0; press < 4; press += 1) {
        if (rackGuard(id, choices, 1, nerd).blocked) break
        choices = applyRacks(id, choices, 1, nerd)
        const result = score(id, choices, nerd)
        const racks = rackCount(choices)
        assert.equal(result.racks, racks, `${id}: the engine scores the stepped count`)
        assert.equal(result.rackItKW, racks * byId(PLATFORMS, "h200").rackKW, `${id}: IT power is racks × rack kW`)
        assert.ok(result.budgetSpend > previous.budgetSpend, `${id}: MONEY rises with a rack (${previous.budgetSpend} → ${result.budgetSpend})`)
        assert.ok(result.powerUsedMW > previous.powerUsedMW, `${id}: POWER rises with a rack`)
        assert.ok(result.coverage >= previous.coverage - 1e-9, `${id}: CROWD never falls with a rack (${previous.coverage} → ${result.coverage})`)
        const working = thinkLines(result)
        const power = working.find((line) => line.startsWith("Power: "))
        assert.ok(power, `${id}: HOW WE THINK carries the power sum`)
        assert.ok(power.startsWith(`Power: ${racks} racks × ${byId(PLATFORMS, "h200").rackKW} kW IT`), `${id}: "${power}"`)
        assert.ok(power.includes(`against the ${result.powerMW.toFixed(2)} MW offer`), `${id}: the offer is the engine's`)
        assert.ok(working[0].includes(`supply ${Math.round(result.throughput).toLocaleString("en-GB")} tok/s`), `${id}: supply is the engine's`)
        previous = result
      }
    }
  }
})
