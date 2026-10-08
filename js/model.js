import { DATA_TIERS, HALLS, KV_TIER, ORCA, PLATFORMS, USE_CASES, byId } from "./data.js"

export const PICK_COUNT = 3
export const MAX_RACKS = 40

const HBM_HEADROOM = 0.7
const KV_USABLE = 0.9
const HOST_KV_SHARE = 0.5
const PREFILL_EFFICIENCY = 0.35
const HBM_ONLY_REUSE = 0.3
const SPILL_PENALTY = 0.4
const LATE_GOODPUT = 0.25
const NETWORK_S = 0.05

export function blankBuild() {
  return { platform: null, racks: 1, data: "local", kv: false, orca: false }
}

export function blankPlan() {
  return { picks: [], halls: {}, builds: {} }
}

export function weightScale(platform) {
  return platform.precision === "FP4" ? 0.5 : 1
}

export function kvScale(platform) {
  return platform.precision === "FP4" ? 0.5 : 1
}

/**
 * Decode is memory-bound: each step reads the weights plus every active stream's
 * KV cache from HBM. Faster HBM finishes each stream sooner, so more requests fit.
 */
export function decodeRoofline(useCase, platform, { group, instances, racks, kvOn }) {
  const bandwidthGBs = group * platform.hbmTBs * 1000
  const weightsGB = useCase.weightsGB * weightScale(platform)
  const readGB = useCase.moe ? Math.min(weightsGB, useCase.activeB * 4 * weightScale(platform)) : weightsGB
  const kvPerStreamGB = (useCase.ctx * useCase.kvMBPerTok * kvScale(platform)) / 1000
  const capacity = Math.max(0, group * platform.hbmGB * KV_USABLE - weightsGB) / kvPerStreamGB
  const parked = kvOn
    ? Infinity
    : (racks * platform.hostTB * 1000 * HOST_KV_SHARE) / instances / kvPerStreamGB
  const byMemory = Math.min(capacity, useCase.activeShare * (capacity + parked))
  const bySpeed = Math.max(0, (bandwidthGBs / useCase.tps - readGB) / kvPerStreamGB)
  const streams = Math.min(byMemory, bySpeed)
  if (streams < 1) {
    return { tokens: 0, streamTps: bandwidthGBs / readGB, streams: 0, parkedOnHost: false }
  }
  const stepS = (readGB + streams * kvPerStreamGB) / bandwidthGBs
  return {
    tokens: (instances * streams) / stepS,
    streamTps: 1 / stepS,
    streams: instances * streams,
    parkedOnHost: !kvOn && byMemory > capacity * useCase.activeShare * 1.01,
  }
}

export function groupSize(useCase, platform) {
  const need = Math.ceil((useCase.weightsGB * weightScale(platform)) / (platform.hbmGB * HBM_HEADROOM))
  let size = 8
  while (size < need) size *= 2
  if (useCase.moe && platform.domain >= 72) return Math.max(size, platform.domain)
  return size
}

export function evaluateDeployment(useCaseId, hallId, build) {
  const useCase = byId(USE_CASES, useCaseId)
  const hall = byId(HALLS, hallId)
  const platform = byId(PLATFORMS, build?.platform)
  const data = byId(DATA_TIERS, build?.data) || DATA_TIERS[0]
  const racks = Number(build?.racks) || 0
  const out = {
    useCase,
    hall,
    platform,
    data,
    racks,
    ok: false,
    errors: [],
    demand: useCase?.demand ?? 0,
    throughput: 0,
    served: 0,
    goodput: 0,
    ttft: null,
    slaMet: false,
    itKW: 0,
    facilityKW: 0,
    kvFill: 0,
    computeTok: 0,
    kvTok: 0,
    bottleneck: null,
    fits: true,
    gpus: 0,
    kv: false,
    orca: false,
  }
  if (!useCase || !hall) {
    out.errors.push("Pick a mission and a hall.")
    return out
  }
  if (!platform) {
    out.errors.push("Choose an NVIDIA platform.")
    return out
  }
  if (!Number.isInteger(racks) || racks < 1 || racks > MAX_RACKS) {
    out.errors.push(`Use between 1 and ${MAX_RACKS} racks.`)
    return out
  }
  if (platform.cooling === "liquid" && hall.cooling !== "liquid") {
    out.errors.push(`${platform.name} needs liquid cooling. Move this mission to Hall B.`)
  }
  if (platform.rackKW > hall.maxRackKW) {
    out.errors.push(`${platform.name} racks draw ${platform.rackKW} kW. ${hall.name} cools ${hall.maxRackKW} kW max.`)
  }

  const kvOn = Boolean(build.kv)
  const orcaOn = Boolean(build.orca && useCase.orca)
  out.kv = kvOn
  out.orca = orcaOn
  const storageKW = data.kw + (kvOn ? KV_TIER.kw : 0) + (orcaOn ? ORCA.kw : 0)
  out.itKW = racks * platform.rackKW + storageKW
  out.facilityKW = out.itKW * hall.pue

  const gpus = racks * platform.gpusPerRack
  out.gpus = gpus
  const group = groupSize(useCase, platform)
  if (gpus < group) {
    out.errors.push(`The ${useCase.model} needs ${group} ${platform.gpu} GPUs just to load. Add racks.`)
  }
  if (out.errors.length) return out

  out.fits = group <= platform.domain
  const instances = Math.floor(gpus / group)
  const used = instances * group
  const domainMult = useCase.moe ? (platform.domain >= 72 ? 1.5 : 0.75) : 1
  const fitMult = out.fits ? 1 : SPILL_PENALTY
  const sizeMult = Math.pow(70 / useCase.activeB, 0.6)
  out.computeTok = used * platform.tokPerGpu * sizeMult * domainMult * fitMult

  const decode = decodeRoofline(useCase, platform, { group, instances, racks, kvOn })
  out.kvTok = decode.tokens * fitMult
  out.streamTps = decode.streamTps
  out.streams = decode.streams
  out.parkedOnHost = decode.parkedOnHost

  const prefillRate = (group * platform.pflops * 1e15 * PREFILL_EFFICIENCY) / (2 * useCase.activeB * 1e9)
  const hit = kvOn ? useCase.reuse : useCase.reuse * HBM_ONLY_REUSE
  out.hit = hit
  const prefillPerOutput = (useCase.ctx * (1 - hit)) / useCase.outTokens
  const decodeRate = Math.min(out.computeTok, out.kvTok)
  const prefillTotal = instances * prefillRate * fitMult
  out.prefillShare = decodeRate > 0 ? (prefillPerOutput / prefillTotal) / (1 / decodeRate + prefillPerOutput / prefillTotal) : 0

  out.quality = data.feed[useCase.data]
  const blended = decodeRate > 0 ? 1 / (1 / decodeRate + prefillPerOutput / prefillTotal) : 0
  out.throughput = blended * (orcaOn ? ORCA.feed : 1)
  out.served = Math.min(out.throughput, out.demand)
  const util = out.throughput > 0 ? Math.min(1, out.demand / out.throughput) : 1
  out.kvFill = Math.min(1, out.served / Math.max(1, out.kvTok))

  const prefillS = (useCase.ctx * (1 - hit)) / (prefillRate * fitMult)
  const queue = 1 + 3 * Math.pow(util, 3)
  out.ttft = prefillS * queue + data.retrieval[useCase.data] + NETWORK_S
  out.slaMet = out.ttft <= useCase.ttft
  out.goodput = out.served * out.quality * (out.slaMet ? 1 : LATE_GOODPUT)
  out.tokPerMW = out.goodput / (out.facilityKW / 1000)
  out.coverage = out.goodput / out.demand
  out.points = missionPoints(out.tokPerMW, out.coverage, useCase.par)
  out.bottleneck = bottleneck(out, useCase, data)
  out.ok = true
  return out
}

/** 1,000 points = par efficiency with all demand served on time. */
export function missionPoints(tokPerMW, coverage, par) {
  if (!(par > 0) || !Number.isFinite(tokPerMW)) return 0
  return Math.round((1000 * tokPerMW * coverage) / par)
}

function bottleneck(result, useCase, data) {
  if (!result.fits) return "fit"
  if (!result.slaMet) {
    if (data.retrieval[useCase.data] >= 0.8) return "retrieval"
    return "ttft"
  }
  if (data.feed[useCase.data] < 1) return "data"
  if (result.served >= result.demand) {
    if (result.throughput > result.demand * 1.6) return "oversized"
    return "met"
  }
  return result.kvTok < result.computeTok ? "kv" : "compute"
}

export function planErrors(plan) {
  const errors = []
  const picks = plan?.picks || []
  if (picks.length !== PICK_COUNT) errors.push(`Choose ${PICK_COUNT} missions.`)
  const used = new Set(picks.map((id) => plan.halls?.[id]).filter(Boolean))
  if (picks.some((id) => !byId(HALLS, plan.halls?.[id]))) errors.push("Send every mission to a hall.")
  else if (picks.length === PICK_COUNT && used.size < HALLS.length) errors.push("Use both data halls.")
  return errors
}

export function evaluatePlan(plan) {
  const picks = plan?.picks || []
  const deployments = picks.map((id) => evaluateDeployment(id, plan.halls?.[id], plan.builds?.[id]))
  const errors = [...planErrors(plan)]
  for (const item of deployments) errors.push(...item.errors)

  const halls = HALLS.map((hall) => {
    const here = deployments.filter((item) => item.hall?.id === hall.id)
    const itKW = here.reduce((sum, item) => sum + item.itKW, 0)
    return { hall, itKW, capKW: hall.itMW * 1000, over: itKW > hall.itMW * 1000 }
  })
  for (const entry of halls) {
    if (entry.over) {
      errors.push(`${entry.hall.name} is over its ${entry.hall.itMW} MW power limit.`)
    }
  }

  const supply = PLATFORMS.map((platform) => {
    const racks = deployments
      .filter((item) => item.platform?.id === platform.id)
      .reduce((sum, item) => sum + item.racks, 0)
    return { platform, racks, over: racks > platform.supply }
  })
  for (const entry of supply) {
    if (entry.over) {
      errors.push(`Only ${entry.platform.supply} ${entry.platform.name} racks are available.`)
    }
  }

  const demand = deployments.reduce((sum, item) => sum + item.demand, 0)
  const goodput = deployments.reduce((sum, item) => sum + item.goodput, 0)
  const facilityKW = deployments.reduce((sum, item) => sum + item.facilityKW, 0)
  const unique = [...new Set(errors)]
  const ok = unique.length === 0 && deployments.every((item) => item.ok)
  const tokPerMW = facilityKW > 0 ? goodput / (facilityKW / 1000) : 0
  const coverage = demand > 0 ? goodput / demand : 0
  const jPerToken = goodput > 0 ? (facilityKW * 1000) / goodput : null
  const score = ok ? deployments.reduce((sum, item) => sum + item.points, 0) : 0
  return {
    ok,
    errors: unique,
    deployments,
    halls,
    supply,
    demand,
    goodput,
    facilityKW,
    tokPerMW,
    coverage,
    jPerToken,
    score,
    badges: ok ? badgesFor(deployments, coverage) : [],
  }
}

export const STAR_POINTS = [400, 800, 1200]

export function stars(deployment) {
  if (!deployment?.ok || !deployment.slaMet) return 0
  return STAR_POINTS.filter((threshold) => deployment.points >= threshold).length
}

function badgesFor(deployments, coverage) {
  const badges = []
  if (deployments.every((item) => item.slaMet)) badges.push({ id: "sweep", name: "Clean Sweep", text: "Every mission met its SLA." })
  if (coverage >= 0.95) badges.push({ id: "full", name: "Full House", text: "Served 95% of all demand." })
  if (deployments.some((item) => item.platform?.id === "vr")) badges.push({ id: "rubin", name: "Early Adopter", text: "Deployed Vera Rubin." })
  if (deployments.every((item) => item.data.id !== "local")) badges.push({ id: "fed", name: "Well Fed", text: "Every mission used Everpure." })
  if (deployments.some((item) => item.kv)) badges.push({ id: "kv", name: "Memory Master", text: "Used the Everpure KV cache." })
  if (deployments.every((item) => stars(item) === 3)) badges.push({ id: "perfect", name: "All Stars", text: "Three stars on every mission." })
  return badges
}

export function formatTokens(value) {
  if (!Number.isFinite(value)) return "—"
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${Math.round(value / 1e3)}K`
  return String(Math.round(value))
}

export function formatSeconds(value) {
  if (!Number.isFinite(value)) return "—"
  if (value < 1) return `${Math.round(value * 1000)}ms`
  return `${value.toFixed(1)}s`
}

export function formatScore(value) {
  if (!Number.isFinite(value)) return "0"
  return Math.round(value).toLocaleString("en-GB")
}
