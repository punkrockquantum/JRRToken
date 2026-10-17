/**
 * Power (user: "Make sure there is always enough power providing the user gets the
 * configuration right. The available power for each site must be sufficient to at least run
 * the smallest model on the least powerful hardware. Also make sure the rack level power draw
 * is accurate." and "As soon as the user selects more users, the power goes red. Even
 * switching back doesn't correct this.").
 *
 * - Rack kW is IT power built from the node datasheets: nodes × node kW + top-of-rack, with a
 *   source URL beside every platform; the node figure sits between 1× and 2× the GPUs' board
 *   power; facility kW is IT × PUE and cooling changes nothing else.
 * - The power floor: no scenario, crowd or metro offers less than one rack of the least
 *   powerful platform through the air hall's PUE, rounded up to a 100 kW suite.
 * - At every story × crowd × model × metro some GPU tile fits the power and the budget with
 *   the right cooling, and the opening build of every story fits as it stands.
 * - A crowd that grows and shrinks back lands on the same build and the same green light.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { HALLS, METRO_OFFERS, MODEL_IDS, PLATFORMS, POWER_FLOOR_MW, POWER_OFFERS_MW, SCENARIOS, USER_TIER_IDS, USE_CASES, byId, powerFloorMW, resolveUseCase } from "../js/data.js"
import { ecosystem } from "../js/eco.js"
import { thinkLines } from "../js/explain.js"
import { evaluateBuild, powerLine, scenarioFor, tierPowerMW } from "../js/model.js"
import { choicesToBuild, defaultChoices, expertChoices, simpleBrainIds } from "../js/presets.js"
import { applyTile, fitsChoices, stepTiles } from "../js/steps.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const airHall = byId(HALLS, "A")

/* Published node and rack figures the table must reproduce (kW). */
const DATASHEET_NODE_KW = { h100: 10.2, h200: 10.2, b200: 14.3, b300: 14, b300n: 14, gb200: 132, gb300: 142 }

test("rack power is nodes × node kW + top-of-rack, from the datasheets, with a source beside every platform", () => {
  const source = readFileSync(join(root, "js/data.js"), "utf8")
  const table = source.slice(source.indexOf("export const PLATFORMS = ["), source.indexOf("export const DATA_TIERS"))
  for (const platform of PLATFORMS) {
    const { id, gpuW, nodeKW, nodesPerRack, torKW, rackKW, gpusPerRack } = platform
    assert.ok(gpuW > 0 && nodeKW > 0 && nodesPerRack > 0 && torKW >= 0 && rackKW > 0, `${id}: power fields`)
    const sum = nodesPerRack * nodeKW + torKW
    assert.ok(Math.abs(rackKW / sum - 1) <= 0.1, `${id}: rackKW ${rackKW} within 10% of ${nodesPerRack} × ${nodeKW} + ${torKW} = ${sum}`)
    assert.equal(rackKW, Math.round(sum), `${id}: the rounded sum`)
    const gpusPerNode = gpusPerRack / nodesPerRack
    const boards = (gpusPerNode * gpuW) / 1000
    const overhead = nodeKW / boards
    assert.ok(overhead >= 1 && overhead <= 2, `${id}: a node of ${gpusPerNode} × ${gpuW} W boards (${boards} kW) draws ${nodeKW} kW, ${overhead.toFixed(2)}× the boards`)
    if (DATASHEET_NODE_KW[id]) assert.equal(nodeKW, DATASHEET_NODE_KW[id], `${id}: the published node figure`)
    const block = table.slice(Math.max(0, table.indexOf(`id: "${id}"`) - 900), table.indexOf(`id: "${id}"`))
    assert.match(block, /https:\/\/[^\s)]+nvidia\.com/, `${id}: a source URL sits beside the figures`)
  }
  /* The reference racks the user asked for. */
  assert.equal(byId(PLATFORMS, "h100").rackKW, 22, "two HGX H100 nodes and a 400G top-of-rack")
  assert.equal(byId(PLATFORMS, "h200").rackKW, 22)
  assert.equal(byId(PLATFORMS, "b200").rackKW, 30)
  assert.equal(byId(PLATFORMS, "b300").rackKW, 30)
  assert.equal(byId(PLATFORMS, "gb200").rackKW, 132)
  assert.equal(byId(PLATFORMS, "gb300").rackKW, 142)
  assert.equal(byId(PLATFORMS, "vr").rackKW, 210)
  assert.ok(byId(PLATFORMS, "rtx6000").rackKW >= 13 && byId(PLATFORMS, "rtx6000").rackKW <= 15, "two 8-GPU RTX PRO 6000 nodes at 600 W a card")
  assert.ok(byId(PLATFORMS, "l40s").rackKW >= 8 && byId(PLATFORMS, "l40s").rackKW <= 11, "two 8-GPU L40S nodes at 350 W a card")
  /* Hall caps per cooling type stay in the published bands and cover the air racks. */
  const cap = (id) => byId(HALLS, id).maxRackKW
  assert.ok(cap("A") >= 10 && cap("A") <= 15 && cap("C") >= 15 && cap("C") <= 30 && cap("I") >= 30 && cap("I") <= 60 && cap("R") >= 40 && cap("R") <= 70 && cap("B") >= 100 && cap("B") <= 240)
  /* Open air takes the small racks; cold aisle containment takes every air-cooled NVIDIA rack. */
  for (const platform of PLATFORMS.filter((item) => item.cooling === "air")) assert.ok(platform.rackKW <= cap("C"), `${platform.id} fits the contained hall's rack cap`)
  assert.ok(PLATFORMS.some((item) => item.cooling === "air" && item.rackKW <= cap("A")), "small racks fit open air")
  assert.ok(PLATFORMS.some((item) => item.cooling === "air" && item.rackKW > cap("A")), "an HGX rack runs too hot for open air")
  for (const platform of PLATFORMS.filter((item) => item.cooling === "liquid")) assert.ok(platform.rackKW > cap("R") && platform.rackKW <= cap("B"), `${platform.id} needs the liquid hall`)
})

test("facility power is IT × PUE: cooling changes the PUE and nothing else, and the nerd line shows the sum", () => {
  const build = (home) => choicesToBuild("chat", { ...defaultChoices("chat"), home }, true)
  const results = ["cool", "aisle", "row", "rear", "super"].map((home) => evaluateBuild("chat", build(home)))
  for (const result of results) {
    assert.ok(Math.abs(result.facilityKW - result.itKW * result.pue) < 1e-6, `facility = IT × PUE at PUE ${result.pue}`)
    assert.equal(result.rackItKW, result.racks * result.platform.rackKW)
    assert.ok(Math.abs(result.powerCapKW - (result.powerMW * 1000) / result.pue) < 1e-6)
    assert.match(result.powerLine, /^\d+ racks? × \d+ kW IT( \+ \d+ kW storage and hosts)? × PUE [\d.]+ = \d+ kW facility$/)
  }
  assert.ok(new Set(results.map((result) => result.itKW)).size === 1, "the same racks draw the same IT power in every hall")
  assert.ok(new Set(results.map((result) => result.facilityKW)).size >= 3, "the PUE moves the meter")
  assert.equal(powerLine(6, 30, 0, 1.38, 248.4), "6 racks × 30 kW IT × PUE 1.38 = 248 kW facility")
  assert.equal(powerLine(1, 132, 18, 1.2, 180), "1 rack × 132 kW IT + 18 kW storage and hosts × PUE 1.2 = 180 kW facility")
  const lines = thinkLines(results[0])
  assert.ok(lines.some((line) => /^Power: \d+ racks × 30 kW IT .*× PUE 1\.38 = \d+ kW facility, against the 0\.60 MW offer \(600 kW\)\./.test(line)), lines.join("\n"))
  /* The nerd GPU tiles carry the tile's racks as IT and facility kW in the hall the board is on. */
  for (const tile of stepTiles("chat", "gpu", true, { ...defaultChoices("chat"), home: "rear" })) {
    if (!tile.platform) continue
    const pue = tile.platform.cooling === "liquid" ? byId(HALLS, "R").pue : byId(HALLS, "R").pue
    const itKW = tile.racks * tile.platform.rackKW
    assert.ok(tile.nerd.includes(`${tile.racks} rack${tile.racks === 1 ? "" : "s"} = ${itKW} kW IT, ${Math.round(itKW * pue)} kW at PUE ${pue} in the rear-door hall`), tile.nerd)
  }
})

test("the power floor: one rack of the least powerful platform through the air PUE, rounded up to a 100 kW suite, and no offer is ever below it", () => {
  const smallest = Math.min(...PLATFORMS.map((platform) => platform.rackKW))
  assert.ok(POWER_FLOOR_MW * 1000 >= smallest * airHall.pue, `${POWER_FLOOR_MW} MW covers a ${smallest} kW rack at PUE ${airHall.pue}`)
  assert.ok(POWER_OFFERS_MW.includes(POWER_FLOOR_MW) && POWER_FLOOR_MW >= 0.1)
  assert.equal(powerFloorMW(), POWER_FLOOR_MW)
  assert.equal(tierPowerMW(0.18, 0.04), POWER_FLOOR_MW, "the small drug lab is floored, not 7 kW")
  assert.equal(tierPowerMW(0.6, 0.1995), 0.12, "a crowd above the floor scales, rounded up to 10 kW")
  assert.equal(tierPowerMW(0.6, 1), 0.6)
  for (const [id, scenario] of Object.entries(SCENARIOS)) assert.ok(scenario.powerMW >= POWER_FLOOR_MW, id)
  for (const useCase of USE_CASES) {
    const offers = METRO_OFFERS[useCase.id] || []
    for (const users of USER_TIER_IDS) {
      const story = resolveUseCase(useCase.id, { users })
      const scenario = scenarioFor(story)
      assert.ok(scenario.powerMW >= POWER_FLOOR_MW, `${useCase.id} ${users}: ${scenario.powerMW} MW`)
      if (users !== "large") assert.ok(scenario.powerMW <= SCENARIOS[useCase.id].powerMW, "a smaller crowd is never offered more than the top crowd")
      for (const offer of offers) {
        const result = evaluateBuild(useCase.id, choicesToBuild(useCase.id, { ...defaultChoices(useCase.id), users, metros: [offer.id] }, false))
        assert.ok(result.powerMW >= POWER_FLOOR_MW, `${useCase.id} ${users} ${offer.id}: ${result.powerMW} MW after the metro's share`)
        assert.ok(result.powerCapKW >= smallest, `${useCase.id} ${users} ${offer.id}: the smallest rack fits the IT cap`)
      }
    }
  }
})

test("at every story × crowd × model × metro some GPU tile fits the power and the budget with the right cooling, and the opening build fits as it stands", () => {
  for (const useCase of USE_CASES) {
    const opening = defaultChoices(useCase.id)
    const first = evaluateBuild(useCase.id, choicesToBuild(useCase.id, opening, false))
    assert.ok(!first.overPower && !first.overBudget && first.bottleneck !== "fit", `${useCase.id}: the opening build fits (${Math.round(first.siteKW)} kW of ${Math.round(first.powerCapKW)} kW)`)
    assert.equal(ecosystem(first).find((part) => part.id === "power").state === "red", false, `${useCase.id}: the opening POWER light is not red`)
    for (const offer of METRO_OFFERS[useCase.id] || []) {
      for (const users of USER_TIER_IDS) {
        for (const model of MODEL_IDS) {
          const base = { ...opening, users, model, metros: [offer.id] }
          const fits = []
          for (const gpu of simpleBrainIds(useCase.id)) {
            for (const home of ["cool", "aisle", "super"]) {
              if (fitsChoices(useCase.id, { ...base, brains: gpu, home }, false)) fits.push(`${gpu}/${home}`)
            }
          }
          assert.ok(fits.length > 0, `${useCase.id} ${users} ${model} ${offer.id}: no GPU tile fits the power and the budget`)
          /* The board's own hidden default at that crowd and model fits too. */
          const dealt = applyTile(useCase.id, "model", users, applyTile(useCase.id, "model", model, { ...opening, metros: [offer.id] }))
          assert.ok(fitsChoices(useCase.id, dealt, false), `${useCase.id} ${users} ${model} ${offer.id}: the dealt default ${dealt.brains} fits`)
        }
      }
    }
  }
})

test("a crowd that grows and shrinks back lands on the same build, the same scenario power and the same green light", () => {
  for (const useCase of USE_CASES) {
    const start = defaultChoices(useCase.id)
    const light = (choices) => {
      const result = evaluateBuild(useCase.id, choicesToBuild(useCase.id, choices, false))
      return { power: ecosystem(result).find((part) => part.id === "power").state, mw: result.powerMW, brains: result.platform.id, racks: result.racks, overPower: result.overPower }
    }
    const first = light(start)
    assert.equal(first.overPower, false, `${useCase.id}: opens inside the power`)
    const small = applyTile(useCase.id, "model", "small", start)
    const smallLight = light(small)
    assert.equal(smallLight.overPower, false, `${useCase.id} small: ${smallLight.brains} ×${smallLight.racks} is inside ${smallLight.mw} MW`)
    assert.ok(smallLight.mw >= POWER_FLOOR_MW)
    const back = applyTile(useCase.id, "model", "large", small)
    const backLight = light(back)
    assert.deepEqual(backLight, first, `${useCase.id}: large → small → large returns to the opening build and light`)
    assert.equal(back.brains, start.brains, `${useCase.id}: the hidden GPU default follows the crowd back`)
    const again = applyTile(useCase.id, "model", "small", back)
    assert.deepEqual(light(again), smallLight, `${useCase.id}: small again is the same small`)
    const medium = applyTile(useCase.id, "model", "medium", again)
    assert.equal(light(medium).overPower, false, `${useCase.id} medium: ${light(medium).brains} is inside ${light(medium).mw} MW`)
    /* A GPU the player picked stays theirs across crowds unless the budget forbids it. */
    const picked = applyTile(useCase.id, "gpu", simpleBrainIds(useCase.id)[0], start)
    assert.equal(picked.brainsAuto, false)
    const pickedLarge = applyTile(useCase.id, "model", "large", applyTile(useCase.id, "model", "medium", picked))
    assert.equal(pickedLarge.brains, picked.brains, `${useCase.id}: a picked GPU is kept`)
  }
})

test("the POWER light is green for every expert build and only red when the racks really draw more than the offer", () => {
  for (const useCase of USE_CASES) {
    const expert = evaluateBuild(useCase.id, choicesToBuild(useCase.id, expertChoices(useCase.id), true))
    const power = ecosystem(expert).find((part) => part.id === "power")
    assert.equal(expert.overPower, false, `${useCase.id}: the expert build is inside the power`)
    assert.notEqual(power.state, "red", `${useCase.id}: ${power.why}`)
    for (const users of USER_TIER_IDS) {
      for (const tile of stepTiles(useCase.id, "gpu", false, { ...defaultChoices(useCase.id), users })) {
        const result = evaluateBuild(useCase.id, choicesToBuild(useCase.id, { ...defaultChoices(useCase.id), users, brains: tile.id }, false))
        const state = ecosystem(result).find((part) => part.id === "power").state
        assert.equal(state === "red", Boolean(result.overPower), `${useCase.id} ${users} ${tile.id}: red only when over`)
        if (result.overPower) assert.ok(result.siteKW > result.powerCapKW, `${useCase.id} ${users} ${tile.id}: over means the IT draw passed the cap`)
      }
    }
  }
})
