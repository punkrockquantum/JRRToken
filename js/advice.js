/**
 * The coach: a one-step neighbour search over the build. Every tile alternative on every build
 * step, the rack count one up or down (five as well on the nerd board), a connectivity product
 * added or removed, a metro added, dropped or swapped; the move with the biggest score gain that
 * the budget guard allows is the advice. Pure, so the Scouter's coach line, the round-one hint
 * and the results' "what would have scored higher" share one search and the tests can play it on
 * random builds.
 *
 * Simple mode says the move plainly ("One more rack would score higher."); nerd mode adds the gain
 * ("One more rack would score about 1,180 (+212)."). When no neighbour scores higher the line is
 * BEST_LINE: this is the best build for this job.
 */
import { PLATFORMS, SITES, byId } from "./data.js"
import { evaluateBuild, formatScore } from "./model.js"
import { brainPick, choicesToBuild, modelPicks, rackCount } from "./presets.js"
import { BUILD_STEP_IDS, applyRacks, applyTile, qpuRelevant, rackBounds, rackGuard, stepTiles, stepValue, tileGuard, tileOn } from "./steps.js"

export const BEST_LINE = "This is the best build for this job."
export const START_LINE = "Pick a GPU to start the factory."

/** A gain below this many points is noise, not advice. */
const MIN_GAIN = 1

const score = (useCaseId, choices, nerd) => evaluateBuild(useCaseId, choicesToBuild(useCaseId, choices, nerd))
const metroName = (id) => byId(SITES, id)?.metro || id
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** How a metro tap reads: a second metro added, one dropped, or the racks moved. */
export function locationPhrase(before = [], after = []) {
  const added = after.filter((id) => !before.includes(id))
  const dropped = before.filter((id) => !after.includes(id))
  if (added.length && dropped.length) return `Moving the racks from ${dropped.map(metroName).join(" and ")} to ${added.map(metroName).join(" and ")}`
  if (added.length) return `Adding a second metro in ${added.map(metroName).join(" and ")}`
  return `Dropping ${dropped.map(metroName).join(" and ")}`
}

/** How a connectivity tap reads: one product added or removed on a multi-select board, else the connection switched. */
function wiresPhrase(tile, wasOn, multi) {
  if (!multi) return `Switching the connection to ${tile.label}`
  return wasOn ? `Dropping ${tile.label}` : `Adding ${tile.label}`
}

const STEP_PHRASE = {
  gpu: (tile) => `Switching to ${tile.label}`,
  cooling: (tile) => `Switching to ${tile.label.toLowerCase()}`,
  memory: (tile) => tile.phrase || `Switching memory to ${tile.label}`,
  storage: (tile) => `Switching storage to ${tile.label.toLowerCase()}`,
  qpu: (tile) => (tile.id === "orca" ? "Turning the ORCA PT-3 helper on" : "Turning the ORCA PT-3 helper off"),
}

/** "One more rack", "Five racks fewer": the rack move in words, with the count it lands on. */
export function racksPhrase(delta, next, platform) {
  const n = Math.abs(delta)
  const word = platform?.id === "spark" ? (n === 1 ? "shelf" : "shelves") : n === 1 ? "rack" : "racks"
  const count = n === 1 ? "One" : n === 5 ? "Five" : String(n)
  const lead = delta > 0 ? `${count} more ${word}` : `${count} ${word} fewer`
  return `${lead} (${next} of ${platform?.name || "these racks"})`
}

/**
 * Every one-step neighbour of a choice set that the budget guard allows: on each build step every
 * tile that changes the build (metros toggle, so a metro tap can add, drop or swap; a multi-select
 * connectivity board adds or removes one product), then the rack count by each of the stepper's
 * steps. MODEL & USERS is the brief the player chose, not a decision to second-guess.
 */
export function neighbours(useCaseId, choices = {}, nerd = false) {
  const list = []
  for (const stepId of BUILD_STEP_IDS) {
    if (stepId === "model") continue
    if (stepId === "qpu" && !qpuRelevant(useCaseId)) continue
    const value = stepValue(useCaseId, stepId, choices)
    const tiles = stepTiles(useCaseId, stepId, nerd, choices)
    const multi = stepId === "location" || (stepId === "wires" && Array.isArray(value))
    for (const tile of tiles) {
      if (tile.locked) continue
      const wasOn = tileOn(useCaseId, stepId, tile, choices)
      if (wasOn && !multi) continue
      if (tileGuard(useCaseId, stepId, tile, choices, nerd).blocked) continue
      const next = applyTile(useCaseId, stepId, tile.id, choices, nerd)
      const after = stepValue(useCaseId, stepId, next)
      if (same(after, value)) continue
      const phrase = stepId === "location" ? locationPhrase(value, after) : stepId === "wires" ? wiresPhrase(tile, wasOn, multi) : STEP_PHRASE[stepId](tile)
      list.push({ kind: stepId, step: stepId, to: tile.id, choices: next, phrase })
    }
    if (stepId === "gpu") {
      const { users } = modelPicks(useCaseId, choices)
      const pick = brainPick(useCaseId, choices.brains, users, choices.racks)
      const platform = byId(PLATFORMS, pick.platform)
      const current = rackCount(choices) || pick.racks
      for (const delta of rackBounds(useCaseId, choices, nerd).steps) {
        const guard = rackGuard(useCaseId, choices, delta, nerd)
        if (guard.blocked) continue
        const next = applyRacks(useCaseId, choices, delta, nerd)
        if (rackCount(next) === current) continue
        list.push({ kind: "racks", step: "gpu", to: rackCount(next), delta, choices: next, phrase: racksPhrase(rackCount(next) - current, rackCount(next), platform) })
      }
    }
  }
  return list
}

/**
 * The current build scored, and the neighbour with the biggest gain (ties go to the earlier step,
 * the way the board reads), or `best: null` when nothing one step away scores higher.
 */
export function bestMove(useCaseId, choices = {}, nerd = false) {
  const current = score(useCaseId, choices, nerd)
  let best = null
  if (!current.ok) return { current, best }
  for (const move of neighbours(useCaseId, choices, nerd)) {
    const result = score(useCaseId, move.choices, nerd)
    if (!result.ok || result.overBudget) continue
    const gain = result.score - current.score
    if (gain < MIN_GAIN) continue
    if (!best || gain > best.gain) best = { ...move, result, gain }
  }
  return { current, best }
}

/**
 * The coach's line for one build. `past` phrases it for the results card ("would have scored").
 * Returns the move too, so the hint can open the step it points at and a test can follow it.
 */
export function coachAdvice(useCaseId, choices = {}, nerd = false, { past = false } = {}) {
  const { current, best } = bestMove(useCaseId, choices, nerd)
  if (!current.ok) return { text: START_LINE, better: false, score: current.score || 0, from: current.score || 0, gain: 0, kind: null, step: "gpu", to: null, choices: null, phrase: "" }
  if (!best) return { text: BEST_LINE, better: false, score: current.score, from: current.score, gain: 0, kind: null, step: null, to: null, choices: null, phrase: "" }
  const verb = past ? "would have scored" : "would score"
  const text = nerd
    ? `${best.phrase} ${verb} about ${formatScore(best.result.score)} (+${formatScore(Math.round(best.gain))}).`
    : `${best.phrase} ${verb} higher.`
  return { text, better: true, score: best.result.score, from: current.score, gain: best.gain, kind: best.kind, step: best.step, to: best.to, choices: best.choices, phrase: best.phrase }
}
