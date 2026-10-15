/**
 * Latency physics for the connectivity step: what one network option does to the first token,
 * the stream, the GPUs and the go-live date. Pure functions in SI units (seconds, km, bytes).
 *
 * This module is independent of the scoring in model.js, which keeps its tuned game constants.
 * It feeds the TOKEN IMPACT strip and the nerd per-leg readout, so a player can see the physics
 * behind a tile before the score moves.
 */

import { EGRESS_PER_GB } from "./data.js"
import { kmBetween } from "./model.js"

/** Light in glass travels about 204,000 km/s: 4.9 µs per km, one way. */
export const FIBRE_S_PER_KM = 4.9e-6
/** Cable routes are longer than the great circle: lit fibre about 1.2×, public internet paths about 2×. */
export const INFLATION = { fibre: 1.2, internet: 2.0 }
/** A late answer is still worth a quarter of a timely one. */
export const LATE_GOODPUT = 0.25
/** Ethernet payload used by the Mathis throughput bound, in bytes. */
export const MSS_BYTES = 1460

/**
 * Per-option overheads on top of the glass. Round-trip seconds, jitter as a share of the round
 * trip, packet loss as a fraction, and the port speed in Gbps. Game values, not SLAs.
 */
export const OPTIONS = {
  internet: { name: "Public internet", inflation: INFLATION.internet, overheadS: 0.025, jitterFrac: 0.35, loss: 0.005, gbps: 10 },
  peer: { name: "Peering + eyeballs", inflation: 1.5, overheadS: 0.008, jitterFrac: 0.12, loss: 0.002, gbps: 10 },
  fabric: { name: "ServiceFabric", inflation: INFLATION.fibre, overheadS: 0.0003, jitterFrac: 0.02, loss: 0, gbps: 100 },
  fiber: { name: "Dark fiber", inflation: INFLATION.fibre, overheadS: 0, jitterFrac: 0, loss: 0, gbps: 400 },
  cross: { name: "Cross connect", inflation: 1, overheadS: 0.0001, jitterFrac: 0, loss: 0, gbps: 100 },
}

export const OPTION_IDS = Object.keys(OPTIONS)

/** Round trip over lit fibre along a realistic cable route. */
export function fibreRttS(km) {
  return 2 * Math.max(0, km) * INFLATION.fibre * FIBRE_S_PER_KM
}

/** Round trip over the public internet: a longer path plus queueing at several hops. */
export function internetRttS(km) {
  return legRtt(km, "internet").rttS
}

/**
 * One network leg of `km` great-circle distance on one option.
 * Returns the round trip, its jitter, loss, the port speed and the cable path length.
 */
export function legRtt(km, optionId) {
  const option = OPTIONS[optionId] || OPTIONS.fabric
  const pathKm = Math.max(0, Number(km) || 0) * option.inflation
  const rttS = 2 * pathKm * FIBRE_S_PER_KM + option.overheadS
  return { option: optionId in OPTIONS ? optionId : "fabric", rttS, jitterS: rttS * option.jitterFrac, loss: option.loss, gbps: option.gbps, pathKm }
}

/** Same as legRtt, from two places with lat/lon. */
export function legBetween(a, b, optionId) {
  return legRtt(kmBetween(a, b), optionId)
}

/**
 * Time to the first token. Users pay their round trip once; the model pays the data round trip
 * on every retrieval or tool trip; then the store lookup, the queue and the prefill.
 */
export function ttftS({ usersRttS = 0, trips = 0, dataRttS = 0, storeS = 0, queueS = 0, prefillS = 0 } = {}) {
  return usersRttS + Math.max(0, trips) * dataRttS + storeS + queueS + prefillS
}

/**
 * First-token delay and jitter from a list of legs on the critical path. Each leg carries
 * `rttS`, `jitterS` and `trips` (default 1). Legs marked `slaExempt` (bulk feeds that can wait)
 * are skipped, so a batch pipe never counts against the first token.
 */
export function firstToken(legs, { storeS = 0, queueS = 0, prefillS = 0 } = {}) {
  let meanS = storeS + queueS + prefillS
  let jitterS = 0
  for (const leg of legs || []) {
    if (!leg || leg.slaExempt) continue
    const trips = Number.isFinite(leg.trips) ? Math.max(0, leg.trips) : 1
    meanS += trips * (leg.rttS || 0)
    jitterS += trips * (leg.jitterS || 0)
  }
  return { meanS, jitterS }
}

/**
 * Jitter pacing: tokens leave the GPU every `stepS`, but arrive no smoother than the jitter.
 * Returns the gap the user actually sees between tokens.
 */
export function pacedStepS(stepS, jitterS) {
  return Math.max(Math.max(0, stepS), Math.max(0, jitterS))
}

/** How the stream feels: smooth, stutters, or stalls, from the jitter against the token step. */
export function streamFeel(stepS, jitterS) {
  if (!(stepS > 0)) return "smooth"
  const ratio = Math.max(0, jitterS) / stepS
  if (ratio < 0.5) return "smooth"
  if (ratio < 2) return "stutters"
  return "stalls"
}

/**
 * Mathis bound: a lossy TCP path cannot carry more than MSS / (RTT × √loss) bytes per second.
 * Infinite when there is no loss; the port speed is the other cap.
 */
export function mathisBps(rttS, loss, mss = MSS_BYTES) {
  if (!(loss > 0)) return Infinity
  return mss / (Math.max(rttS, 0.001) * Math.sqrt(loss))
}

/** Usable bytes per second on a leg: the port, or the Mathis bound when the path drops packets. */
export function usableBps(leg) {
  const portBps = (leg.gbps || 0) * 1e9 / 8
  return Math.min(portBps, mathisBps(leg.rttS, leg.loss))
}

/**
 * Share of the time the GPUs sit idle while streams wait on the network. Each stream gives the
 * GPU `stepS` of work per `stepS + waitS` cycle; `streams` concurrent streams fill the gap.
 */
export function gpuIdle(streams, stepS, waitS) {
  const cycle = Math.max(0, stepS) + Math.max(0, waitS)
  if (!(cycle > 0)) return 0
  return 1 - Math.min(1, (Math.max(0, streams) * Math.max(0, stepS)) / cycle)
}

/** Standard normal CDF, Abramowitz and Stegun 7.1.26 (error under 1.5e-7). */
export function normalCdf(z) {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  const erf = 1 - poly * Math.exp(-x * x)
  return 0.5 * (1 + sign * erf)
}

/**
 * Probability the first token misses its target, treating the delay as normal with mean `meanS`
 * and standard deviation `sdS` (use the jitter). With no jitter it is a step at the target.
 */
export function pMiss(meanS, sdS, targetS) {
  if (!(sdS > 0)) return meanS > targetS ? 1 : 0
  return 1 - normalCdf((targetS - meanS) / sdS)
}

/** Goodput factor: late answers keep LATE_GOODPUT of their value; `slaExempt` work keeps all of it. */
export function lateFactor(miss, { slaExempt = false, late = LATE_GOODPUT } = {}) {
  if (slaExempt) return 1
  return 1 - Math.min(1, Math.max(0, miss)) * (1 - late)
}

/** Hours to copy `tb` terabytes over a `gbps` pipe at full rate. */
export function transferHours(tb, gbps) {
  if (!(gbps > 0)) return Infinity
  return (Math.max(0, tb) * 8000) / gbps / 3600
}

/** Cloud egress to pull `tb` terabytes out, at the game's $/GB. */
export function egressUsd(tb, perGb = EGRESS_PER_GB) {
  return Math.max(0, tb) * 1000 * perGb
}

/** Go-live: the lead time plus whole days of copying. */
export function goLiveDays(leadDays, tb, gbps) {
  const hours = transferHours(tb, gbps)
  return Math.max(0, leadDays) + (Number.isFinite(hours) ? Math.ceil(hours / 24) : Infinity)
}

/**
 * Everything one option does to one story, in one object: first token versus target, stream
 * feel, GPU idle share, P(miss) and the usable rate. `legs` are {km, optionId, trips, slaExempt}.
 */
export function tokenImpact({ legs = [], targetS = 1, stepS = 0.02, streams = 1, storeS = 0, queueS = 0, prefillS = 0 } = {}) {
  const resolved = legs.map((leg) => ({ ...legRtt(leg.km, leg.optionId), trips: leg.trips, slaExempt: Boolean(leg.slaExempt) }))
  const first = firstToken(resolved, { storeS, queueS, prefillS })
  const miss = pMiss(first.meanS, first.jitterS, targetS)
  const users = resolved[0] || legRtt(0, "fabric")
  const waitS = resolved.filter((leg) => !leg.slaExempt).reduce((sum, leg) => sum + (Number.isFinite(leg.trips) ? leg.trips : 1) * leg.rttS, 0)
  return {
    legs: resolved,
    firstTokenS: first.meanS,
    jitterS: first.jitterS,
    targetS,
    pMiss: miss,
    lateFactor: lateFactor(miss),
    stepS: pacedStepS(stepS, users.jitterS),
    feel: streamFeel(stepS, users.jitterS),
    gpuIdle: gpuIdle(streams, stepS, waitS),
    usableBps: Math.min(...resolved.filter((leg) => !leg.slaExempt).map(usableBps), Infinity),
    bulkBps: Math.min(...resolved.filter((leg) => leg.slaExempt).map(usableBps), Infinity),
  }
}
