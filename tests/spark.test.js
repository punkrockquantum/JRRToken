/**
 * NVIDIA DGX Spark (user: add the desktop AI box as a platform): GB10 Grace Blackwell, 128 GB of
 * unified LPDDR5x at 273 GB/s, about 1 PFLOP FP4 with sparsity (0.5 dense), $3,999, a pair over
 * ConnectX-7. The game's unit is a shelf of sixteen (about 3 kW, $64k, estimates).
 *
 * - It fits by model size: a 70B or 100B model at FP4 loads on one box; a 650B model does not
 *   fit even across a pair.
 * - It is the cheapest capex on the board and the lowest-power rack, so it sets the power floor.
 * - It streams a 70B model at about 8 tokens a second: below every story's speed, so it is
 *   never the optimum at any crowd, never the hidden default, and the COMPUTE light says why.
 * - It is on the simple six-tile GPU step of every story, first, and in the nerd list.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { MODEL_IDS, PLATFORMS, POWER_FLOOR_MW, USER_TIER_IDS, USE_CASES, byId, resolveUseCase } from "../js/data.js"
import { ecosystem } from "../js/eco.js"
import { SCORE_FLOOR, evaluateBuild, groupSize } from "../js/model.js"
import { choicesToBuild, defaultChoices, nerdBrainIds, simpleBrainIds } from "../js/presets.js"
import { allSimple, applyTile, stepTiles } from "../js/steps.js"

const spark = byId(PLATFORMS, "spark")
const build = (id, choices) => evaluateBuild(id, choicesToBuild(id, { ...defaultChoices(id), ...choices }, false))

test("the DGX Spark platform carries the published figures and the shelf estimates", () => {
  assert.ok(spark, "the platform exists")
  assert.deepEqual([spark.hbmGB, spark.hbmTBs, spark.memKind, spark.pflops, spark.precision, spark.domain], [128, 0.273, "LPDDR5x", 0.5, "FP4", 2])
  assert.deepEqual([spark.gpusPerRack, spark.rackKW, spark.capex, spark.cooling], [16, 3, 64000, "air"])
  assert.ok(spark.leadWeeks >= 4 && spark.leadWeeks <= 8, "4 to 8 weeks")
  assert.ok(Math.abs(spark.capex / spark.gpusPerRack - 3999) < 100, "sixteen boxes at the $3,999 list price")
  assert.ok(spark.nodesPerRack * spark.nodeKW + spark.torKW >= 2.7 && spark.nodesPerRack * spark.nodeKW + spark.torKW <= 3.2, "16 × ~170 W plus a small switch is about 3 kW")
  assert.equal(PLATFORMS[0].id, "spark", "cheapest first")
  assert.ok(PLATFORMS.every((platform) => platform.capex >= spark.capex), "the cheapest capex on the board")
  assert.ok(PLATFORMS.every((platform) => platform.rackKW >= spark.rackKW), "the lowest-power rack on the board")
  assert.ok(POWER_FLOOR_MW * 1000 >= spark.rackKW * 1.38, "the power floor covers a shelf through the air PUE")
  /* Decode per box sits about thirty times below an H100 per GPU: 273 GB/s against 3.35 TB/s and a 70B model. */
  const h100 = byId(PLATFORMS, "h100")
  const ratio = (h100.hbmTBs / spark.hbmTBs) * (h100.tokPerGpu / spark.tokPerGpu) ** 0 // bandwidth ratio alone
  assert.ok(ratio >= 10 && ratio <= 15, `HBM bandwidth ratio ${ratio.toFixed(1)}`)
  assert.ok(h100.tokPerGpu / spark.tokPerGpu >= 25 && h100.tokPerGpu / spark.tokPerGpu <= 35, "game tokens per GPU about 30× below an H100")
})

test("it fits by model size: 70B and 100B at FP4 on one box, never a 650B model", () => {
  for (const useCase of USE_CASES) {
    for (const model of MODEL_IDS) {
      const story = resolveUseCase(useCase.id, { model })
      const group = groupSize(story, spark)
      const result = build(useCase.id, { model, brains: "spark" })
      if (model === "650b") {
        assert.ok(group > spark.domain, `${useCase.id} 650B needs ${group} boxes, more than a pair`)
        assert.equal(result.bottleneck, "fit", `${useCase.id} 650B does not fit`)
        assert.equal(result.slowStream, false, "a spill is a fit problem, not a speed problem")
        assert.match(ecosystem(result).find((part) => part.id === "compute").why, /does not fit on these GPUs/)
      } else {
        assert.equal(group, 1, `${useCase.id} ${model} loads on one box`)
        assert.equal(result.fits, true)
        assert.notEqual(result.bottleneck, "fit")
        assert.equal(result.slowStream, true, `${useCase.id} ${model}: the stream is below the story's speed`)
        assert.ok(result.streamTps > 4 && result.streamTps < 9, `${useCase.id} ${model}: about ${result.streamTps.toFixed(1)} tok/s a stream`)
        assert.ok(result.streamTps < story.tps, `${useCase.id} ${model}: ${result.streamTps.toFixed(1)} < ${story.tps}`)
        assert.ok(result.warnings.some((line) => /streams the .* at about [\d.]+ tokens a second per answer, below the \d+ people expect/.test(line)), result.warnings.join(" / "))
        const compute = ecosystem(result).find((part) => part.id === "compute")
        assert.equal(compute.state, "red")
        assert.match(compute.why, /a dev box, not a crowd server/)
        assert.equal(result.slaMet, false, `${useCase.id} ${model}: slow streams miss the target`)
      }
      assert.ok(result.score >= SCORE_FLOOR, "the floor holds")
    }
  }
})

test("it is never the optimum at any crowd, never the hidden default, and no star comes from it", () => {
  for (const useCase of USE_CASES) {
    for (const users of USER_TIER_IDS) {
      let best = null
      for (const choices of allSimple(useCase.id)) {
        const result = evaluateBuild(useCase.id, choicesToBuild(useCase.id, { ...choices, users }, false))
        if (!best || result.score > best.score) best = { score: result.score, brains: choices.brains }
      }
      assert.notEqual(best.brains, "spark", `${useCase.id} ${users}: the best build (${best.score}) is not a shelf of Sparks`)
      const sparkBest = Math.max(...["cool", "rear"].map((home) => build(useCase.id, { users, brains: "spark", home }).score))
      assert.ok(sparkBest < 200, `${useCase.id} ${users}: a Spark shelf scores ${sparkBest}`)
      const dealt = applyTile(useCase.id, "model", users, defaultChoices(useCase.id))
      assert.notEqual(dealt.brains, "spark", `${useCase.id} ${users}: the hidden default is never the dev box`)
    }
  }
})

test("it is the first of the six simple GPU tiles on every story, counted in boxes, and in the nerd list", () => {
  for (const useCase of USE_CASES) {
    const simple = simpleBrainIds(useCase.id)
    assert.equal(simple.length, 6, `${useCase.id}: six simple tiles`)
    assert.equal(simple[0], "spark")
    assert.ok(nerdBrainIds(useCase.id).includes("spark"))
    const tile = stepTiles(useCase.id, "gpu", false, defaultChoices(useCase.id))[0]
    assert.match(tile.label, /^NVIDIA DGX Spark ×(16|32|48|64|80|96|112|128|144|160)$/, tile.label)
    assert.equal(tile.hint, "Desktop AI boxes on a shelf: cheap, tiny, slow memory")
    assert.ok(tile.lines.some((line) => /Spark is a dev box: great for one engineer, not for a crowd/.test(line)))
    assert.ok(tile.lines.some((line) => /nvidia\.com\/dgx-spark/.test(line)), "cites nvidia.com/dgx-spark")
    assert.match(tile.why, /[Dd]ev boxes/)
    const nerdTile = stepTiles(useCase.id, "gpu", true, defaultChoices(useCase.id)).find((item) => item.id === "spark")
    assert.match(nerdTile.nerd, /^128 GB LPDDR5x, 0\.273 TB\/s, 0\.5 PFLOPS FP4 dense, 3 kW a rack; \$64k a rack and a 6-week lead \(estimates\)\. \d+ racks? = \d+ kW IT, \d+ kW at PUE 1\.38 in the air hall$/, nerdTile.nerd)
    /* The shelf is always affordable, at every crowd. */
    for (const users of USER_TIER_IDS) assert.equal(build(useCase.id, { users, brains: "spark" }).overBudget, false, `${useCase.id} ${users}`)
  }
})
