/** Plain words for the people-power card and gauge. No DOM here, so the tests can read them. */
import { formatMoney, lossPhrase } from "./model.js"

export function peopleCount(fte) {
  const n = Math.max(0, Math.round(Number(fte) || 0))
  return `about ${n.toLocaleString("en-GB")}`
}

export function moneyWords(value) {
  const n = Math.abs(Number(value) || 0)
  if (n >= 1e9) return `$${String(Math.round((n / 1e9) * 10) / 10).replace(/\.0$/, "")} billion`
  if (n >= 1e6) return `$${String(Math.round((n / 1e6) * 10) / 10).replace(/\.0$/, "")} million`
  if (n >= 1e3) return `$${Math.round(n / 1e3).toLocaleString("en-GB")} thousand`
  return `$${Math.round(n).toLocaleString("en-GB")}`
}

/**
 * Why this build cannot earn its saving. Over budget always counts; power and lateness
 * only count when they have already floored the score.
 */
export function blockedReason(result) {
  if (!result?.ok) return null
  if (result.overBudget) return { kind: "budget", text: `You can't afford this: about ${formatMoney(result.finance)} over budget` }
  if (result.score > 0) return null
  if (result.overPower) return { kind: "power", text: "Too much power for this hall" }
  if (result.lateWeeks > 0) {
    const weeks = Math.ceil(result.lateWeeks)
    return { kind: "late", text: `Launched ${weeks} ${weeks === 1 ? "week" : "weeks"} late` }
  }
  return null
}

const IF_ONLY = {
  budget: "If you could pay for it",
  power: "If the hall had the power",
  late: "If it launched on time",
}

export function peopleLead(result) {
  const verb = blockedReason(result) ? "would do" : "does"
  return `Your factory ${verb} the work of ${peopleCount(result?.fteEquivalent)} people`
}

export function savingsLine(result) {
  const saved = result?.annualSavings || 0
  const blocked = blockedReason(result)
  if (saved < 0) return `Costs about ${lossPhrase(saved)} more than it saves each year`
  if (blocked) return `${IF_ONLY[blocked.kind]}, it would save about ${moneyWords(saved)} a year`
  return `Saving about ${moneyWords(saved)} a year after paying for the factory`
}
