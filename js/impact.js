/**
 * TOKEN IMPACT: what one connectivity tile does to the player's current build, read straight
 * from the same evaluation the results screen uses. Every number here is an `evaluateBuild`
 * output (or a one-line function of one), so the strip can never disagree with the score.
 */
import { USE_CASES, byId } from "./data.js"
import { streamFeel } from "./latency.js"
import { evaluateBuild, formatMoney, formatSeconds } from "./model.js"
import { PRODUCT_IDS, legacyWires } from "./netplan.js"
import { choicesToBuild } from "./presets.js"

const KIND_NAMES = {
  fabric: "ServiceFabric",
  mcp: "ServiceFabric MCP",
  cross: "Cross connect",
  fiber: "Dark fiber",
  public: "Public internet",
  peer: "Peering",
  eye: "Eyeball network",
  off: "Off",
}

/** good: comfortably under target; ok: under target; bad: over target. */
export function firstTokenState(seconds, targetS) {
  if (!Number.isFinite(seconds) || !Number.isFinite(targetS)) return "bad"
  if (seconds <= targetS * 0.7) return "good"
  if (seconds <= targetS) return "ok"
  return "bad"
}

export function idleState(share) {
  if (share < 0.02) return "good"
  if (share < 0.15) return "ok"
  return "bad"
}

export function feelState(feel) {
  return feel === "smooth" ? "good" : feel === "stutters" ? "ok" : "bad"
}

function pct(share) {
  if (!(share > 0)) return "0%"
  if (share < 0.01) return "<1%"
  return `${Math.round(share * 100)}%`
}

/** One plain sentence saying why this wire lands where it does for this story. */
export function whyLine(useCase, result, { ingress, batch }) {
  const target = formatSeconds(useCase.ttft)
  const first = formatSeconds(result.ttft)
  const net = result.net || {}
  const monthly = `${formatMoney(net.mrc || 0)}/mo (estimate)`
  const weeks = Math.round((net.leadDays || 0) / 7)
  const wait = weeks <= 0 ? "no wait" : `${weeks} wk wait`
  if (batch) {
    return result.wireIdle >= 0.01
      ? `Batch work is never late, but this pipe is thin: the racks wait on data ${pct(result.wireIdle)} of the time.`
      : `Batch work is never late and this pipe keeps the racks fed; it costs ${monthly} and a ${wait}.`
  }
  if (result.pMiss >= 0.5) {
    return `Most answers miss the ${target} target: the first token lands at ${first}, so the crowd gives up.`
  }
  if (result.wireIdle >= 0.15) return `The first token is fine at ${first}, but stalls and drops leave the GPUs idle ${pct(result.wireIdle)} of the time.`
  if (result.farShare >= 0.2) return `Part of the crowd is too far from your sites for any wire; this one lands the first token at ${first} for ${monthly}.`
  if (ingress?.kind === "public") return `The open internet makes it at ${first}, but every answer jitters and a few packets drop.`
  if (result.ttft > useCase.ttft * 0.7) return `Just inside the ${target} target at ${first}: no room for a busy hour.`
  if (ingress?.kind === "peer" || ingress?.kind === "eye") return `Peering lands the first token at ${first}; a little jitter and loss remain, for ${monthly} and a ${wait}.`
  if (ingress?.kind === "cross" || ingress?.kind === "fiber") return `Private glass to the users: first token at ${first}, nothing jitters, for ${monthly} and a ${wait}.`
  return `First token at ${first} against a ${target} target, a steady stream and busy GPUs, for ${monthly} and a ${wait}.`
}

/**
 * The impact strip for one wires tile against the player's other choices.
 * Returns { firstToken, stream, idle, why, nerd, result } where nerd carries per-leg detail.
 */
export function wireImpact(useCaseId, choices, wires, nerd = false) {
  const useCase = byId(USE_CASES, useCaseId)
  /* A product id reads as "this product on its own" (MCP brings the fabric it configures); a legacy tile id reads as before. */
  const product = PRODUCT_IDS.includes(wires)
  const solo = wires === "mcp" ? ["fabric", "mcp"] : [wires]
  const patch = product ? { net: solo, legs: {}, wires: legacyWires(solo), routed: undefined } : { wires }
  const build = choicesToBuild(useCaseId, { ...choices, ...patch }, nerd)
  const result = evaluateBuild(useCaseId, build)
  const batch = (useCase.legs || []).some((leg) => leg.slaExempt)
  const legs = (result.legResults || []).filter((leg) => leg.kind && leg.kind !== "off")
  const roles = Object.fromEntries((useCase.legs || []).map((leg) => [leg.id, leg.role]))
  const ingress = legs.find((leg) => roles[leg.id] === "ingress" || roles[leg.id] === "lab") || null
  const stepS = result.streamTps > 0 ? 1 / result.streamTps : 0
  const feel = batch ? "smooth" : streamFeel(stepS, ingress ? ingress.jitterS : result.jitterS || 0)
  const firstToken = {
    seconds: result.ttft,
    targetS: useCase.ttft,
    label: batch ? `${formatSeconds(result.ttft)} · batch` : `${formatSeconds(result.ttft)} vs ${formatSeconds(useCase.ttft)}`,
    state: batch ? "good" : firstTokenState(result.ttft, useCase.ttft),
  }
  const stream = { feel, state: feelState(feel) }
  const idle = { share: result.wireIdle || 0, label: pct(result.wireIdle || 0), state: idleState(result.wireIdle || 0) }
  const net = result.net || {}
  const detail = {
    legs: legs.map((leg) => ({
      id: leg.id,
      name: leg.name,
      kind: leg.kind,
      product: KIND_NAMES[leg.kind] || leg.kind,
      rttMs: leg.rttS * 1000,
      jitterMs: (leg.jitterS || 0) * 1000,
      loss: leg.loss || 0,
      gbps: leg.gbps,
      mrc: leg.mrc || 0,
      leadDays: leg.leadDays || 0,
    })),
    pMiss: result.pMiss,
    mrc: net.mrc || 0,
    nrc: net.nrc || 0,
    leadDays: net.leadDays || 0,
  }
  return {
    wires,
    firstToken,
    stream,
    idle,
    why: whyLine(useCase, result, { ingress, batch }),
    detail,
    result,
  }
}

/** The nerd line under a tile: per-leg RTT, jitter, loss, bandwidth, then P(miss), monthly cost and lead time. */
export function detailLine(detail) {
  const legs = detail.legs.map((leg) => {
    const bits = [`${leg.name} ${leg.product}`, `${leg.rttMs < 1 ? leg.rttMs.toFixed(1) : Math.round(leg.rttMs)} ms`]
    bits.push(`±${leg.jitterMs < 1 ? leg.jitterMs.toFixed(1) : Math.round(leg.jitterMs)} ms`)
    if (leg.loss > 0) bits.push(`${(leg.loss * 100).toFixed(1)}% loss`)
    if (Number.isFinite(leg.gbps) && leg.gbps > 0) bits.push(`${leg.gbps} Gbps`)
    return bits.join(" ")
  })
  const weeks = detail.leadDays / 7
  const lead = detail.leadDays <= 0 ? "no lead time" : weeks < 1 ? `${detail.leadDays} d lead` : `${Math.round(weeks)} wk lead`
  const tail = [`P(miss) ${pct(detail.pMiss)}`, `${formatMoney(detail.mrc)}/mo est.`, detail.nrc > 0 ? `${formatMoney(detail.nrc)} once est.` : null, lead].filter(Boolean)
  return [...legs, tail.join(" · ")].join(". ")
}
