import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { USE_CASES } from "../js/data.js"
import { STEP_IDS, STEPS, applyTile, jobBrief, modelDefaulted, nextStep, prevStep, simpleDefaults, stepIndex } from "../js/steps.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const main = readFileSync(join(root, "js/main.js"), "utf8")
const smoke = readFileSync(join(root, "scripts/smoke.mjs"), "utf8")

/* User: "Move the 'where' section to be the first stage of the playable game, so users understand the
 * scenario, workload they need to manage and geographic dependencies." */

test("WHERE opens the game and MODEL & USERS follows it; a fresh plan starts on the first step", () => {
  assert.equal(STEPS[0].id, "location")
  assert.equal(STEPS[0].short, "WHERE")
  assert.equal(STEPS[1].id, "model")
  assert.equal(stepIndex("location"), 0)
  assert.equal(nextStep("location"), "model")
  assert.equal(prevStep("model"), "location")
  assert.equal(prevStep("location"), "location")
  assert.match(main, /step: STEP_IDS\[0\], round: 1/, "freshPlan opens on whatever step is first")
  assert.match(main, /state\.plan\.step : STEP_IDS\[0\]/, "the game screen falls back to the first step")
  assert.match(main, /stepId === "location" \? whoWhere\(id\) : null/, "the WHO & WHERE brief sits on the first step")
})

test("the smoke walks the steps in the game's order", () => {
  const order = smoke.match(/const BUILD_STEPS = (\[[^\]]+\])/)[1]
  assert.deepEqual(JSON.parse(order), STEP_IDS.filter((id) => id !== "review"))
})

test("the brief's demand is the story's default until MODEL & USERS is set, then follows the picks", () => {
  for (const uc of USE_CASES) {
    const fresh = simpleDefaults(uc.id)
    assert.equal(modelDefaulted(uc.id, fresh), true, uc.id)
    const brief = jobBrief(uc.id, fresh)
    assert.match(brief.needs[0], /tokens a second of answers for .+ · the story's default until MODEL & USERS is set$/, uc.id)
    assert.match(brief.needs[1], /^First word within /)
    assert.ok(brief.job.length > 20, "the job reads in plain words")
    const picked = applyTile(uc.id, "model", "small", fresh)
    assert.equal(modelDefaulted(uc.id, picked), false, `${uc.id}: a smaller crowd is a pick`)
    const after = jobBrief(uc.id, picked)
    assert.doesNotMatch(after.needs[0], /default/)
    assert.notEqual(after.needs[0], brief.needs[0].replace(/ · the story's default.*$/, ""), `${uc.id}: the demand follows the crowd`)
    assert.equal(after.needs[1], brief.needs[1], "the first-word target is the story's, not the crowd's")
  }
  assert.equal(modelDefaulted("chat", null), true, "no choice set: the story at its defaults")
})
