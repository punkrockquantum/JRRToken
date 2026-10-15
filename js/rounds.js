/**
 * Two rounds per story. Round one scores the first build; the results show one hint and
 * IMPROVE IT. Round two is the same story again; the final score is the better of the two.
 * Pure helpers, so the league entry and the results line can be tested without a browser.
 */
import { formatScore } from "./model.js"
import { ecoHint } from "./eco.js"

export const MAX_ROUNDS = 2

/** The better of the rounds played so far. */
export function finalScore(rounds = []) {
  return rounds.reduce((best, round) => Math.max(best, Number(round?.score) || 0), 0)
}

/** "Round 1: 812 → Round 2: 1,400 (+588)". One round gives "Round 1: 812". */
export function roundLine(rounds = []) {
  const scores = rounds.map((round) => Number(round?.score) || 0)
  if (!scores.length) return ""
  if (scores.length === 1) return `Round 1: ${formatScore(scores[0])}`
  const delta = scores[1] - scores[0]
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±"
  return `Round 1: ${formatScore(scores[0])} → Round 2: ${formatScore(scores[1])} (${sign}${formatScore(Math.abs(delta))})`
}

/**
 * The single hint between rounds: the first red part of the ecosystem, else the first amber
 * one, as "PART: one sentence why." Never the full answer. Null when every part is green.
 */
export function roundHint(result) {
  const part = ecoHint(result)
  if (!part || part.state === "green") return null
  return { id: part.id, name: part.name, state: part.state, step: part.step, text: `${part.name}: ${part.why}` }
}

/** Whether another round is still open after this many have been played. */
export function canImprove(rounds = []) {
  return rounds.length < MAX_ROUNDS
}

/**
 * The league entry for a player after any round: the final score is the better round,
 * and both rounds are stored so the board can show the improvement.
 */
export function roundEntry(player, result, rounds, { at = Date.now(), story = "" } = {}) {
  const scores = rounds.map((round) => Number(round?.score) || 0)
  const bestIndex = scores.indexOf(Math.max(...scores))
  const bestRound = rounds[bestIndex] || { result }
  const best = bestRound.result || result
  return {
    name: player.name,
    email: player.email,
    consent: true,
    consentAt: player.consentAt || at,
    score: finalScore(rounds),
    round1: scores[0] ?? null,
    round2: scores[1] ?? null,
    useCase: best.useCase?.id || result.useCase?.id,
    costPerM: Number.isFinite(best.costPerM) ? Math.round(best.costPerM * 10000) / 10000 : null,
    fteEquivalent: best.fteEquivalent,
    annualSavings: best.annualSavings,
    at,
    summary: `${story || best.useCase?.name || ""} ${formatScore(finalScore(rounds))} points${scores.length > 1 ? ` (${roundLine(rounds)})` : ""}.`.trim(),
  }
}
