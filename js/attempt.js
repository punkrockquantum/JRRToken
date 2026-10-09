/**
 * The booth-server payload for one finished run. Kept out of main.js so tests can
 * build it without a browser. recordAttempt() accepts this object as-is.
 */

import { formatScore } from "./model.js"

export function attemptPayload(player, result, playedAt = Date.now()) {
  const cost = Number(result?.costPerM)
  let consentAt = player?.consentAt
  if (typeof consentAt === "number" && Number.isFinite(consentAt)) consentAt = new Date(consentAt).toISOString()
  if (typeof consentAt !== "string" || !consentAt) consentAt = new Date(playedAt).toISOString()
  return {
    name: player?.name || "",
    email: player?.email || "",
    score: Math.max(0, Number(result?.score) || 0),
    useCase: result?.useCase?.name || "",
    costPerMTok: Number.isFinite(cost) ? Math.max(0, cost) : null,
    profitPerHour: Number.isFinite(Number(result?.profit)) ? result.profit : null,
    consent: true,
    consentAt,
    playedAt,
    fteEquivalent: Number.isFinite(Number(result?.fteEquivalent)) ? Number(result.fteEquivalent) : null,
    annualSavings: Number.isFinite(Number(result?.annualSavings)) ? Number(result.annualSavings) : null,
    humanHoursPerYear: Number.isFinite(Number(result?.humanHoursPerYear)) ? Number(result.humanHoursPerYear) : null,
    scenario: result?.useCase?.id || "",
  }
}

/** Server line when the booth answers; local rank when it does not. */
export function syncStatusLine(sync, local) {
  if (sync?.ok) return `ATTEMPT ${sync.attempts} · BEST ${formatScore(sync.best)} · RANK ${sync.rank} OF ${sync.players}`
  const rank = local?.rank || 1
  const players = local?.players || 1
  return `RANK ${rank} OF ${players}`
}
