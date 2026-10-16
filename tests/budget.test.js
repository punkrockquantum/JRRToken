/**
 * The budget guard and the score floor (user: "It should be impossible to go completely over
 * budget or get a score of Zero").
 *
 * - No pick the board offers lands over the scenario budget: a tile that would is blocked,
 *   tagged with the shortfall, and carries a line saying what to drop.
 * - The hidden defaults are always affordable, at every model size and crowd, in both modes,
 *   because the first step snaps the GPU back when the budget shrinks.
 * - No runnable build scores zero: the floor is 100, weak-but-legal builds read as a few
 *   hundred, and the floor never reorders two builds.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { MODEL_IDS, USER_TIER_IDS, USE_CASES } from "../js/data.js"
import { SCORE_FLOOR, SCORE_KNEE, STAR_POINTS, blendScore, evaluateBuild, shapeScore, stars } from "../js/model.js"
import { choicesToBuild, defaultChoices, expertChoices } from "../js/presets.js"
import { BUILD_STEP_IDS, affordableChoices, allSimple, applyTile, budgetOf, stepTiles, tileGuard } from "../js/steps.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

test("the score floor: no raw score maps below 100, the knee is continuous, order is kept, three stars are untouched", () => {
  assert.equal(SCORE_FLOOR, 100)
  assert.equal(shapeScore(0), SCORE_FLOOR)
  assert.equal(shapeScore(-5), SCORE_FLOOR)
  assert.equal(shapeScore(NaN), SCORE_FLOOR)
  assert.equal(shapeScore(Infinity), SCORE_FLOOR, "a broken cost per token still gives the floor, not a jackpot")
  assert.equal(shapeScore(SCORE_KNEE), SCORE_KNEE)
  assert.ok(Math.abs(shapeScore(SCORE_KNEE - 1) - (SCORE_KNEE - 1)) <= 1, "continuous at the knee (rounded)")
  assert.equal(shapeScore(1400), 1400)
  assert.equal(shapeScore(STAR_POINTS[0]), STAR_POINTS[0])
  let last = -1
  for (let raw = 0; raw <= 1500; raw += 0.5) {
    const shaped = shapeScore(raw)
    assert.ok(shaped >= last, `monotonic at ${raw}`)
    assert.ok(shaped >= SCORE_FLOOR, `floored at ${raw}`)
    last = shaped
  }
  assert.ok(shapeScore(10) > SCORE_FLOOR && shapeScore(10) < 200, `a tiny raw score reads as a bit over the floor (${shapeScore(10)})`)
  assert.ok(shapeScore(100) >= 250 && shapeScore(100) <= 300, `raw 100 reads as weak-but-legal (${shapeScore(100)})`)
  assert.equal(blendScore({ par: 1, coverage: 0, slaFactor: 0, costPerM: 1 }), SCORE_FLOOR)
  assert.equal(blendScore({ par: 1, coverage: 1, slaFactor: 1, costPerM: Infinity }), SCORE_FLOOR)
  assert.equal(blendScore({ par: 0, coverage: 1, slaFactor: 1, costPerM: 1 }), SCORE_FLOOR)
  assert.equal(stars({ ok: true, slaMet: true, overBudget: false, score: SCORE_FLOOR }), 0, "the floor earns no star")
})

test("every runnable build in the whole simple space scores at least the floor; the weakest legal builds stay in the 100-450 band", () => {
  for (const useCase of USE_CASES) {
    let weakest = Infinity
    let best = 0
    for (const choices of allSimple(useCase.id)) {
      const result = evaluateBuild(useCase.id, choicesToBuild(useCase.id, choices, false))
      assert.equal(result.ok, true)
      assert.ok(result.score >= SCORE_FLOOR, `${useCase.id} ${JSON.stringify(choices)} scored ${result.score}`)
      assert.ok(Number.isInteger(result.score))
      weakest = Math.min(weakest, result.score)
      best = Math.max(best, result.score)
    }
    assert.ok(weakest >= SCORE_FLOOR && weakest <= 450, `${useCase.id} weakest ${weakest}`)
    assert.ok(best >= 1390, `${useCase.id} best ${best}`)
  }
})

test("the floor never reorders two builds: a build with the higher raw score has the higher (or equal) shaped score", () => {
  const list = allSimple("chat").map((choices) => evaluateBuild("chat", choicesToBuild("chat", choices, false)))
  for (let i = 1; i < list.length; i += 1) {
    const a = list[i - 1]
    const b = list[i]
    if (a.rawScore > b.rawScore) assert.ok(a.score >= b.score, `${a.rawScore} > ${b.rawScore} but ${a.score} < ${b.score}`)
    if (a.rawScore < b.rawScore) assert.ok(a.score <= b.score)
  }
})

test("budget guard: the hidden defaults are affordable at every story, model size and crowd, in both modes", () => {
  for (const useCase of USE_CASES) {
    for (const nerd of [false, true]) {
      const base = nerd ? expertChoices(useCase.id) : defaultChoices(useCase.id)
      for (const users of USER_TIER_IDS) {
        for (const model of MODEL_IDS) {
          const choices = applyTile(useCase.id, "model", users, applyTile(useCase.id, "model", model, base, nerd), nerd)
          const money = budgetOf(useCase.id, choices, nerd)
          assert.ok(!money.over, `${useCase.id} ${nerd ? "nerd" : "simple"} ${model} ${users}: defaults spend ${money.spend} of ${money.budget}`)
          /* A fresh plan at that first step is the same thing the board shows: affordable too. */
          const fresh = affordableChoices(useCase.id, { ...base, model, users }, nerd)
          assert.ok(!budgetOf(useCase.id, fresh, nerd).over, `${useCase.id} fresh ${model} ${users}`)
        }
      }
    }
  }
})

test("budget guard: no selectable tile on any step lands over the budget, and every blocked tile says by how much and what to drop", () => {
  let blockedCount = 0
  for (const useCase of USE_CASES) {
    for (const nerd of [false, true]) {
      for (const users of USER_TIER_IDS) {
        const base = applyTile(useCase.id, "model", users, nerd ? expertChoices(useCase.id) : defaultChoices(useCase.id), nerd)
        assert.ok(!budgetOf(useCase.id, base, nerd).over, `${useCase.id} ${users} base`)
        for (const stepId of BUILD_STEP_IDS) {
          for (const tile of stepTiles(useCase.id, stepId, nerd, base)) {
            const guard = tileGuard(useCase.id, stepId, tile, base, nerd)
            const next = applyTile(useCase.id, stepId, tile.id, base, nerd)
            const money = budgetOf(useCase.id, next, nerd)
            if (guard.blocked) {
              blockedCount += 1
              assert.notEqual(stepId, "model", "the first step sets the budget and is never blocked")
              assert.ok(money.over, `${useCase.id} ${stepId} ${tile.id} blocked but affordable`)
              assert.match(guard.tag, /^OVER BUDGET by \$[\d.,]+[kM]?$/, guard.tag)
              assert.match(guard.line, /^Over the \$[\d.,]+[kM]? budget by \$[\d.,]+[kM]? \(game prices\)\. /, guard.line)
              assert.ok(/To afford it, (pick|drop) .+ on the [A-Z &]+ step\.$|needs a cheaper GPU\.$/.test(guard.line), guard.line)
            } else {
              assert.ok(!money.over, `${useCase.id} ${nerd ? "nerd" : "simple"} ${users} ${stepId} ${tile.id}: selectable yet ${money.spend} > ${money.budget}`)
            }
          }
        }
      }
    }
  }
  assert.ok(blockedCount > 20, `the guard should bite somewhere (${blockedCount} blocked tiles)`)
  /* The small crowd blocks the big racks on every story; the large crowd affords the simple board's first five tiles. */
  for (const useCase of USE_CASES) {
    const small = applyTile(useCase.id, "model", "small", defaultChoices(useCase.id))
    const gpus = stepTiles(useCase.id, "gpu", false, small)
    assert.ok(gpus.some((tile) => tileGuard(useCase.id, "gpu", tile, small).blocked), `${useCase.id} small: at least one GPU tile is blocked`)
    assert.ok(!tileGuard(useCase.id, "gpu", gpus[0], small).blocked, `${useCase.id} small: the cheapest GPU tile is selectable`)
    const large = applyTile(useCase.id, "model", "large", defaultChoices(useCase.id))
    assert.ok(stepTiles(useCase.id, "gpu", false, large).slice(0, 5).every((tile) => !tileGuard(useCase.id, "gpu", tile, large).blocked), `${useCase.id} large affords the first five GPU tiles`)
  }
})

test("budget guard: shrinking the crowd snaps an unaffordable GPU back to the cheapest that fits, and the tile that is on is never blocked", () => {
  const big = applyTile("chat", "gpu", "gb200", applyTile("chat", "model", "large", defaultChoices("chat")))
  assert.equal(big.brains, "gb200")
  assert.ok(!budgetOf("chat", big).over)
  const shrunk = applyTile("chat", "model", "small", big)
  assert.equal(shrunk.users, "small")
  assert.notEqual(shrunk.brains, "gb200", "the small budget cannot pay for two NVL72 racks")
  assert.ok(!budgetOf("chat", shrunk).over)
  for (const stepId of BUILD_STEP_IDS) {
    for (const tile of stepTiles("chat", stepId, false, shrunk)) {
      const on = stepId === "model" ? shrunk[tile.row] === tile.id : false
      if (on) assert.ok(!tileGuard("chat", stepId, tile, shrunk).blocked)
    }
  }
  /* A build that is somehow over budget (defensive branch) still blocks nothing that is already on. */
  const forced = { ...shrunk, brains: "vr" }
  const vr = stepTiles("chat", "gpu", false, forced).find((tile) => tile.id === "vr")
  assert.ok(!tileGuard("chat", "gpu", vr, forced).blocked, "the tile the build is on is the build itself")
})

test("the board wires the guard in: blocked tiles are tagged, refuse the tap, and the designer clamps", () => {
  const main = readFileSync(join(root, "js/main.js"), "utf8")
  assert.match(main, /const guard = tileGuard\(id, stepId, tile, choices, state\.nerd\)/)
  assert.match(main, /tag: guard\.blocked \? guard\.tag : tile\.tag \|\| ""/)
  assert.match(main, /if \(guard\.blocked\) \{\s*play\("error"\)\s*flashWhy\(guard\.line\)/)
  assert.match(main, /"aria-disabled": blocked \? "true" : null/)
  assert.match(main, /applyTile\(state\.plan\.useCase, stepId, tile\.id, state\.plan\.choices, state\.nerd\)/)
  assert.match(main, /card\.warn = `OVER BUDGET by \$\{formatMoney\(alt\.finance\)\}`/)
  assert.match(main, /disabled: Boolean\(shortfall\)/, "the per-site designer disables a step the budget cannot pay for")
  const css = readFileSync(join(root, "css/game.css"), "utf8")
  assert.match(css, /\.tile\.over \{/)
  assert.match(css, /\.tile-tag\.over \{/)
})
