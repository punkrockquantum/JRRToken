import { DATA_TIERS, FTE_HOURS, HALLS, HORIZON_WEEKS, HUMAN_WORK, KV_TIER, MISSION_SITES, NETWORKS, ORCA, PLATFORMS, SCENARIOS, SITES, USER_BASES, USE_CASES, byId } from "./data.js"
import { HOURS_PER_MONTH, blankFabric, destinationsNeeded, liveShare, networkBill } from "./network.js"
import { defaultRoutes, evaluateRoutes } from "./routes.js"

/** Air-cooling a liquid rack keeps a sliver of throughput and bills a failure cost. */
const THERMAL_FACTOR = 0.15
const THERMAL_BILL = 0.5
/** Fallback budget when a use case has no scenario card. */
export const BUDGET = 9_000_000
/** $100 per MWh, charged in the back end only. */
export const POWER_PRICE = 0.1
/** Late launch: each week past the deadline costs this share of the score, down to the floor. Game.
 *  0.1 makes the first late weeks bite: four weeks late keeps 60% of the score. */
export const LATE_PER_WEEK = 0.1
export const LATE_FLOOR = 0.4
export const AMORT_HOURS = 3 * 365 * 24
/** Over-budget dollars are repaid once a year, plus this interest. Not every hour. */
export const FINANCE_RATE = 0.25
/** Results card stops spelling a loss past this and says "over $5B". */
export const LOSS_DISPLAY_CAP = 5_000_000_000
/** Overflow racks past the hall's space are rented at a premium, per hour, on top of the rack. */
const SPACE_PREMIUM = 0.35
/** Power past the allocation is billed at this multiple, and those racks brown out. */
const OVERPOWER_MULT = 8
const HOUR = 3600
const HOURS_PER_YEAR = 365 * 24

/**
 * People-power for one build. `goodTok` is tokens per second already scaled by the
 * live share of the 52-week horizon, so a late factory only counts the weeks it runs.
 * Tokens above `demand` never count. Hours are good tasks × minutes/60 × share.
 * If a full year of demand would take more people than `fteCap`, every build on
 * that story is scaled so serving all of the demand equals the cap. Serving half
 * the crowd is then half the people. Factory cost for the year is the capex
 * (hidden helper included) plus power, network, and other running costs.
 * Budget overspend is included once for the year, plus interest, inside hourlyOpex.
 */
export function peoplePower({ goodTok = 0, demand = Infinity, work, capex = 0, hourlyOpex = 0 } = {}) {
  const tokens = work?.tokensPerTask > 0 ? work.tokensPerTask : 1
  const minutes = work?.humanMinutes > 0 ? work.humanMinutes : 0
  const share = Math.max(0, Math.min(1, work?.share ?? 1))
  const wage = work?.loadedCost > 0 ? work.loadedCost : 0
  const fteCap = work?.fteCap > 0 ? work.fteCap : Infinity
  const counted = Math.min(Math.max(0, goodTok), Math.max(0, Number.isFinite(demand) ? demand : Infinity))
  const hoursFor = (tok) => ((Math.max(0, tok) * HOUR) / tokens) * (minutes / 60) * share * HOURS_PER_YEAR
  const rawHours = hoursFor(counted)
  const rawFte = rawHours / FTE_HOURS
  let scale = 1
  let capped = false
  if (Number.isFinite(demand) && demand > 0 && Number.isFinite(fteCap)) {
    const demandFte = hoursFor(demand) / FTE_HOURS
    if (demandFte > fteCap) {
      scale = fteCap / demandFte
      capped = true
    }
  }
  let humanHoursPerYear = rawHours * scale
  let fteEquivalent = rawFte * scale
  if (fteEquivalent > fteCap) {
    fteEquivalent = fteCap
    humanHoursPerYear = fteCap * FTE_HOURS
    capped = true
  }
  const humanCostAvoided = fteEquivalent * wage
  const annualFactory = Math.max(0, capex) + Math.max(0, hourlyOpex) * HOURS_PER_YEAR
  const annualSavings = humanCostAvoided - annualFactory
  return {
    tasksPerHour: (counted * HOUR) / tokens,
    humanHoursPerHour: humanHoursPerYear / HOURS_PER_YEAR,
    humanHoursPerYear,
    fteEquivalent,
    humanCostAvoided,
    annualFactory,
    annualSavings,
    capped,
    share,
    fteCap: Number.isFinite(fteCap) ? fteCap : 0,
  }
}

/**
 * Bounded, monotonic people-power factor. The best picture's net saving is 1,
 * which lands on 1.5. A build that saves nothing lands on 0.6. Worse than that
 * stays at 0.6. Better than the par stays at 1.5.
 */
export function savingsFactorFor(annualSavings = 0, savingsPar = 0) {
  const par = Number(savingsPar)
  if (!(par > 0)) return 1
  const raw = 0.6 + 0.9 * (Number(annualSavings) / par)
  return Math.max(0.6, Math.min(1.5, raw))
}

/** Efficiency score, then a bounded bump or dip from money saved versus paying people. */
export function blendScore({ par = 0, coverage = 0, slaFactor = 0, launchFactor = 1, costPerM = Infinity, savingsFactor = 1 } = {}) {
  if (!(Number.isFinite(costPerM) && costPerM > 0 && par > 0)) return 0
  const base = (1000 * par * coverage * slaFactor * launchFactor) / costPerM
  return Math.max(0, Math.round(base * savingsFactor))
}

const HBM_HEADROOM = 0.7
const KV_USABLE = 0.9
const HOST_KV_SHARE = 0.5
const PREFILL_EFFICIENCY = 0.35
const HBM_ONLY_REUSE = 0.3
const SPILL_PENALTY = 0.4
const LATE_GOODPUT = 0.25

/** In-building cross connect. Game stand-in inside the published "minimal latency" range. */
export const CROSS_RTT_S = 0.0001
/** ServiceFabric overhead on top of fibre. Not a published SLA. MCP uses the same fabric. */
export const FABRIC_OVERHEAD_S = 0.0003
/** Public routes are longer than the great-circle fibre path. */
export const INTERNET_INFLATION = 2
export const INTERNET_HOP_S = 0.02
export const INTERNET_LOSS = 0.005
export const INTERNET_JITTER_FRAC = 0.35
/** Same campus. Beyond this, a cross connect does not reach. */
export const CAMPUS_KM = 2
/** Named partner / cloud on-ramp in the metro. Game distance. */
export const PARTNER_KM = 15
/** Dark fiber is a metro or regional product in this game. */
export const FIBER_MAX_KM = 1500

/** Score thresholds for one, two, and three stars. */
export const STAR_POINTS = [700, 1000, 1250]

export function blankBuild(useCaseId = null) {
  const useCase = byId(USE_CASES, useCaseId)
  const sites = [(MISSION_SITES[useCaseId]?.defaults || ["lon"])[0]]
  return {
    hall: "A",
    platform: "h100",
    racks: 2,
    data: "local",
    kv: false,
    orca: false,
    graphs: "large",
    network: "fabric",
    fabric: { ...blankFabric(), dest: useCase?.netDest?.user || "internet" },
    routes: defaultRoutes(useCase),
    bwTier: 0,
    fabricRedundant: false,
    sites,
  }
}

export function blankPlan() {
  return { useCase: null, build: blankBuild(null) }
}

/** Great-circle distance in km. */
export function kmBetween(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** One-way fibre delay: 5 µs per km. */
export function fiberOneWayS(km) {
  return Math.max(0, km) * 5e-6
}

/** Round trip on dark fibre: physics only, both directions. */
export function fiberRttS(km) {
  return 2 * fiberOneWayS(km)
}

export function siteIdsFor(useCaseId, build) {
  const rules = MISSION_SITES[useCaseId] || { max: 1, defaults: ["lon"] }
  const picked = (build?.sites || []).filter((id) => byId(SITES, id))
  const ids = picked.length ? [...new Set(picked)] : [rules.defaults[0]]
  return ids.slice(0, rules.max)
}

/** Users go to their nearest site. Returns share-weighted distance and RTT per site. */
export function siteReach(useCaseId, siteIds) {
  const sites = siteIds.map((id) => byId(SITES, id)).filter(Boolean)
  const places = USER_BASES[useCaseId]?.places || []
  const perSite = sites.map((site) => ({ site, share: 0, km: 0 }))
  let avgKm = 0
  let rttS = 0
  for (const place of places) {
    let best = 0
    let bestKm = Infinity
    sites.forEach((site, i) => {
      const km = kmBetween(place, site)
      if (km < bestKm) {
        bestKm = km
        best = i
      }
    })
    if (!sites.length) continue
    perSite[best].share += place.share
    perSite[best].km += place.share * bestKm
    avgKm += place.share * bestKm
    rttS += place.share * fiberRttS(bestKm)
  }
  for (const entry of perSite) {
    entry.km = entry.share > 0 ? entry.km / entry.share : 0
    entry.rttS = fiberRttS(entry.km)
  }
  let interKm = 0
  for (let i = 0; i < sites.length; i += 1) {
    for (let j = i + 1; j < sites.length; j += 1) interKm = Math.max(interKm, kmBetween(sites[i], sites[j]))
  }
  return { sites, perSite, avgKm, rttS, interKm }
}

export function splitRacks(racks, count) {
  return Array.from({ length: count }, (_, i) => Math.floor(racks / count) + (i < racks % count ? 1 : 0))
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

/**
 * Delay for one product over `km` of fibre.
 * Cross connect ignores distance: it only exists inside one building.
 * Dark fibre is physics only. ServiceFabric and ServiceFabric MCP share one fabric, so
 * they add the same small hop. The public internet inflates the route, adds a peering
 * hop, and jitters.
 */
export function linkProfile(link, km = 0) {
  const distance = Math.max(0, Number(km) || 0)
  const oneWay = fiberOneWayS(distance)
  const id = link?.id
  if (id === "fiber") {
    return { oneWayS: oneWay, rttS: 2 * oneWay, jitterS: 0, loss: 0, gbps: link.gbps, inflatedKm: distance }
  }
  if (id === "fabric" || id === "mcp") {
    const rttS = 2 * oneWay + FABRIC_OVERHEAD_S
    return { oneWayS: oneWay + FABRIC_OVERHEAD_S / 2, rttS, jitterS: rttS * 0.02, loss: 0, gbps: link.gbps, inflatedKm: distance }
  }
  if (id === "public") {
    const inflatedKm = distance * INTERNET_INFLATION
    const publicOne = fiberOneWayS(inflatedKm)
    const rttS = 2 * publicOne + INTERNET_HOP_S
    return {
      oneWayS: publicOne + INTERNET_HOP_S / 2,
      rttS,
      jitterS: rttS * INTERNET_JITTER_FRAC,
      loss: INTERNET_LOSS,
      gbps: link.gbps,
      inflatedKm,
    }
  }
  return { oneWayS: CROSS_RTT_S / 2, rttS: CROSS_RTT_S, jitterS: 0, loss: 0, gbps: link?.gbps || 100, inflatedKm: 0 }
}

export function linkRtt(link, km = 0) {
  return linkProfile(link, km).rttS
}

/** Cross connect only in one building. Dark fibre only when there is a far end to light. */
export function linkEligibility(useCaseId, build, link) {
  const reach = siteReach(useCaseId, siteIdsFor(useCaseId, build))
  const farUsers = reach.avgKm > CAMPUS_KM
  const manySites = reach.sites.length > 1
  if (link?.id === "cross") {
    if (manySites) return { ok: false, reason: "Cross Connect stays in one building. These sites are in different metros." }
    if (farUsers) return { ok: false, reason: `Cross Connect stays in one building. Users are about ${Math.round(reach.avgKm).toLocaleString("en-GB")} km away.` }
    return { ok: true, reason: "Users and partners are in this building." }
  }
  if (link?.id === "fiber") {
    if (!manySites && !farUsers) return { ok: false, reason: "Dark fiber needs your other site, or a named partner outside this building." }
    if (manySites && reach.interKm > FIBER_MAX_KM) {
      return { ok: false, reason: `Dark fiber is a metro or regional route. These sites are ${Math.round(reach.interKm).toLocaleString("en-GB")} km apart.` }
    }
    return { ok: true, reason: manySites ? "Lit between your own sites." : "Lit to a named partner." }
  }
  return { ok: true, reason: "" }
}

/**
 * One user trip, plus retrieval and tool calls. Each site keeps its own copy of the data,
 * so site-to-site replication runs in the background and is paid as link cost, not TTFT.
 */
export function networkLegs(useCase, data, reach) {
  const userKm = reach?.avgKm || 0
  const legs = [{ id: "user", km: userKm }]
  if (useCase?.data && useCase.data !== "none" && data && data.id !== "local") {
    legs.push({ id: "retrieval", km: Math.max(userKm, PARTNER_KM) })
    if (data.id === "vector") legs.push({ id: "retrieval", km: PARTNER_KM })
  }
  const toolKm = MISSION_SITES[useCase?.id]?.toolsNearUsers ? userKm : Math.max(PARTNER_KM, reach?.interKm || 0)
  for (let i = 0; i < (useCase?.toolCalls || 0); i += 1) legs.push({ id: "tool", km: toolKm })
  return legs
}

const PUBLIC_LINK = { id: "public", gbps: 10 }

/**
 * TTFT wait is the sum of each leg's RTT. Jitter is added on top for the SLA check.
 * Legs to a destination the link does not reach (`unreached`) ride the public internet.
 * `capGbps` overrides the link's bandwidth (a configured ServiceFabric connection).
 */
export function networkDelay(useCase, link, data, reach = null, { unreached = [], capGbps = null } = {}) {
  const legs = networkLegs(useCase, data, reach)
  const destOf = (leg) => useCase?.netDest?.[leg.id] || "internet"
  let meanS = 0
  let jitterS = 0
  let maxRtt = 0
  let publicTrips = 0
  for (const leg of legs) {
    const viaPublic = link?.id === "public" || unreached.includes(destOf(leg))
    if (viaPublic) publicTrips += 1
    const profile = linkProfile(viaPublic ? PUBLIC_LINK : link, leg.km)
    meanS += profile.rttS
    jitterS += profile.jitterS
    maxRtt = Math.max(maxRtt, profile.rttS)
  }
  const userPublic = link?.id === "public" || unreached.includes(destOf(legs[0]))
  const loss = userPublic ? INTERNET_LOSS : 0
  const gbps = capGbps ?? link?.gbps ?? 1
  const nominalBps = (gbps * 1e9 * (1 - loss)) / 8
  const interactive = (useCase?.ttft ?? 1) <= 2 || (useCase?.toolCalls || 0) > 0
  const mathis = loss > 0 ? 1460 / (Math.max(maxRtt, 0.001) * Math.sqrt(loss)) : Infinity
  const bytesPerSec = interactive && loss > 0 ? Math.min(nominalBps, Math.max(mathis, nominalBps * 0.05)) : nominalBps
  const bytes = useCase?.bytesPerToken || 64
  const userProfile = linkProfile(userPublic ? PUBLIC_LINK : link, reach?.avgKm || 0)
  return {
    rttS: legs.length ? meanS / legs.length : 0,
    userRttS: userProfile.rttS,
    meanS,
    jitterS,
    slaS: meanS + jitterS,
    trips: legs.length,
    publicTrips,
    loss,
    capTok: bytesPerSec / bytes,
    bytesPerSec,
    legs,
  }
}

/** Value multiplier for a screened candidate. Tokens/s are unchanged. 1 means no boost. */
export function orcaHitMult(useCase, build, link) {
  if (!useCase?.orca || !build?.orca || !build?.platform) return 1
  const base = build.graphs === "small" ? ORCA.small : ORCA.large
  if (link?.orcaLocal) return base
  const retain = link?.orcaRetain ?? 0.5
  return 1 + (base - 1) * retain
}

function storageSpace(build, useCase) {
  const data = byId(DATA_TIERS, build?.data) || DATA_TIERS[0]
  return (data.space || 0) + (build?.kv ? KV_TIER.space || 0 : 0) + (build?.orca && useCase?.orca ? ORCA.space || 0 : 0)
}

/** Racks are paid once; storage and KV are duplicated at every site. The network bill adds its NRC. */
function hardwareCapex(useCase, platform, racks, data, build, siteCount = 1) {
  const gpu = platform ? platform.capex * racks : 0
  const store = data?.capex || 0
  const kv = build?.kv ? KV_TIER.capex : 0
  const orca = build?.orca && useCase?.orca ? ORCA.capex : 0
  return gpu + orca + (store + kv) * siteCount
}

function emptyResult(useCase, hall, platform, data, link, racks, build) {
  return {
    useCase,
    hall,
    platform,
    data,
    network: link,
    build,
    racks,
    ok: false,
    errors: [],
    warnings: [],
    demand: useCase?.demand ?? 0,
    throughput: 0,
    served: 0,
    goodput: 0,
    goodTok: 0,
    ttft: null,
    slaMet: false,
    pMiss: 1,
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
    hitMult: 1,
    capex: 0,
    hardwareCapex: 0,
    revenue: 0,
    powerCost: 0,
    amort: 0,
    netCost: 0,
    failure: 0,
    finance: 0,
    spaceBill: 0,
    hourlyCost: 0,
    profit: 0,
    bandwidthCapped: false,
    graphs: build?.graphs === "small" ? "small" : "large",
    sites: [],
    siteRacks: [],
    reach: null,
    userKm: 0,
    userRttS: 0,
    interKm: 0,
    reachMult: 1,
    waitS: 0,
    net: null,
    live: 1,
    coverage: 0,
    slaFactor: 0,
    costPerM: Infinity,
    score: 0,
    fteEquivalent: 0,
    humanHoursPerYear: 0,
    humanCostAvoided: 0,
    annualFactory: 0,
    annualSavings: 0,
    savingsFactor: 1,
    points: 0,
    badges: [],
  }
}

/**
 * One use case, one build: physics first (fit, roofline, prefill, network), then the
 * hall's space and power, the budget, and the network's lead time turn it into a cost
 * per million good tokens and a score. Bad builds never block; they just cost.
 */
export function evaluateBuild(useCaseId, build = {}) {
  const useCase = byId(USE_CASES, useCaseId)
  const hall = byId(HALLS, build?.hall || "A")
  const platform = byId(PLATFORMS, build?.platform)
  const data = byId(DATA_TIERS, build?.data) || DATA_TIERS[0]
  const link = byId(NETWORKS, build?.network) || byId(NETWORKS, "fabric")
  const out = emptyResult(useCase, hall, platform, data, link, Number(build?.racks) || 0, build)
  if (!useCase || !hall) {
    out.errors.push("Choose a use case.")
    return out
  }
  if (!platform) {
    out.errors.push("Choose an NVIDIA platform.")
    return out
  }
  const warnings = []
  let racks = Math.round(Number(build.racks) || 0)
  if (racks < 1) {
    racks = 1
    warnings.push("At least one rack is built.")
  }
  if (racks > platform.supply) {
    warnings.push(`Only ${platform.supply} ${platform.name} racks exist. The rest were not delivered.`)
    racks = platform.supply
  }
  out.racks = racks

  const siteIds = siteIdsFor(useCase.id, build)
  const reach = siteReach(useCase.id, siteIds)
  const siteCount = Math.max(1, reach.sites.length)
  out.sites = reach.sites
  out.reach = reach
  out.userKm = reach.avgKm
  out.userRttS = reach.rttS
  out.interKm = reach.interKm

  const kvOn = Boolean(build.kv)
  const orcaOn = Boolean(build.orca && useCase.orca)
  out.kv = kvOn
  out.orca = orcaOn

  let wire = link
  let bill
  let routed = null
  if (build.routes) {
    routed = evaluateRoutes({ useCase, build, reach, siteCount })
    wire = routed.wire
    bill = routed.bill
    out.linkGate = { ok: true, reason: "" }
    out.network = routed.network
    warnings.push(...routed.warnings)
  } else {
    const gate = linkEligibility(useCase.id, build, link)
    out.linkGate = gate
    wire = gate.ok ? link : byId(NETWORKS, "public")
    if (!gate.ok) warnings.push(`${gate.reason} Traffic falls back to the public internet.`)
    const legs = networkLegs(useCase, data, reach)
    bill = networkBill({ useCase, kind: wire.id, fabric: build.fabric, siteCount, legs, interKm: reach.interKm })
    warnings.push(...bill.warnings)
  }
  out.wire = wire
  out.net = bill
  out.netLeadDays = bill.leadDays
  out.combos = routed?.combos || []
  out.synergy = routed?.synergy || null
  out.legResults = routed?.legs || null
  out.hardwareCapex = hardwareCapex(useCase, platform, racks, data, build, siteCount)
  out.orcaCapex = orcaOn ? ORCA.capex : 0
  out.capex = out.hardwareCapex + bill.nrc
  out.netCost = bill.mrc / HOURS_PER_MONTH

  let thermal = 1
  if (platform.cooling === "liquid" && hall.cooling !== "liquid") {
    thermal = THERMAL_FACTOR
    out.failure = (platform.capex * racks * THERMAL_BILL) / HOURS_PER_MONTH
    warnings.push("These racks need liquid cooling, so in the air hall they overheat and run much slower.")
  } else if (platform.rackKW > hall.maxRackKW) {
    thermal = 0.35
    out.failure = (platform.capex * racks * 0.25) / HOURS_PER_MONTH
    warnings.push(`${platform.name} runs too hot for the ${hall.name}, so it overheats and throttles.`)
  }
  let deliver = 1
  if (racks < siteCount) {
    deliver = racks / siteCount
    warnings.push("Not enough racks for every site. Extra sites were not built.")
  }

  const storageKW = data.kw + (kvOn ? KV_TIER.kw : 0) + (orcaOn ? ORCA.kw : 0)
  const perSiteRacks = splitRacks(racks, siteCount)
  out.siteRacks = perSiteRacks
  out.itKW = racks * platform.rackKW + storageKW * siteCount
  out.facilityKW = out.itKW * hall.pue
  out.siteKW = Math.max(...perSiteRacks) * platform.rackKW + storageKW
  out.spaceUsed = Math.max(...perSiteRacks) + storageSpace(build, useCase)
  out.spaceCap = hall.rackSpace
  const scenario = scenarioFor(useCase)
  out.scenario = scenario
  out.budget = scenario.budget
  out.powerCapKW = (scenario.powerMW * 1000) / hall.pue
  out.powerMW = scenario.powerMW
  out.powerUsedMW = (out.siteKW * hall.pue) / 1000
  out.leadParts = leadParts(useCase, hall, platform, data, kvOn, orcaOn, bill)
  out.liveWeeks = Math.max(0, ...out.leadParts.map((part) => part.weeks))
  out.live = Math.max(0, HORIZON_WEEKS - out.liveWeeks) / HORIZON_WEEKS
  out.lateWeeks = Math.max(0, out.liveWeeks - scenario.deadlineWeeks)
  out.launchFactor = out.lateWeeks > 0 ? Math.max(LATE_FLOOR, 1 - out.lateWeeks * LATE_PER_WEEK) : 1
  if (out.lateWeeks > 0) warnings.push(`Live in week ${fmtWeeks(out.liveWeeks)}, ${fmtWeeks(out.lateWeeks)} weeks after the deadline. The slowest part is ${out.leadParts.reduce((a, b) => (b.weeks > a.weeks ? b : a)).name}.`)
  out.gpus = racks * platform.gpusPerRack
  out.hitMult = orcaHitMult(useCase, { ...build, platform: platform.id, orca: orcaOn }, wire)

  const group = groupSize(useCase, platform)
  const loaded = Math.min(...perSiteRacks) * platform.gpusPerRack >= group
  out.fits = group <= platform.domain
  const instances = perSiteRacks.reduce((sum, r) => sum + Math.floor((r * platform.gpusPerRack) / group), 0)
  out.warnings = warnings
  if (!loaded || instances < 1) {
    warnings.push(
      siteCount > 1
        ? `The ${useCase.model} needs ${group} ${platform.gpu} GPUs at every site. These racks cannot load it, so this build produces nothing.`
        : `The ${useCase.model} needs ${group} ${platform.gpu} GPUs just to load. These racks produce nothing.`,
    )
    out.ttft = 99
    out.bottleneck = "fit"
    out.ok = true
    return settle(out)
  }
  const domainMult = useCase.moe ? (platform.domain >= 72 ? 1.5 : 0.75) : 1
  const fitMult = out.fits ? 1 : SPILL_PENALTY
  const sizeMult = Math.pow(70 / useCase.activeB, 0.6)
  out.computeTok = instances * group * platform.tokPerGpu * sizeMult * domainMult * fitMult

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
  let throughput = blended
  const delay = routed
    ? routed.delay
    : networkDelay(useCase, wire, data, reach, { unreached: bill.unreached, capGbps: bill.capGbps })
  out.netS = delay.slaS
  out.waitS = delay.meanS
  out.userRttS = delay.userRttS
  out.trips = delay.trips
  out.publicTrips = delay.publicTrips
  out.loss = delay.loss
  out.reachMult = Math.max(0.4, 1 - (MISSION_SITES[useCase.id]?.sense || 0) * delay.meanS)
  const interactive = useCase.ttft <= 2 || (useCase.toolCalls || 0) > 0
  if (delay.publicTrips > 0 && interactive) {
    const share = delay.publicTrips / delay.trips
    const stall = 1 / (1 + (delay.rttS * share) / 0.008)
    const drop = Math.max(0.05, (1 - INTERNET_LOSS) ** delay.publicTrips)
    throughput *= stall * drop
  } else if (delay.publicTrips > 0) {
    throughput *= 1 - INTERNET_LOSS
  }
  if (throughput > delay.capTok) {
    throughput = delay.capTok
    out.bandwidthCapped = true
  }
  out.capTok = delay.capTok
  throughput *= thermal * deliver
  out.throughput = throughput
  out.served = Math.min(out.throughput, out.demand)
  const util = out.throughput > 0 ? Math.min(1, out.demand / out.throughput) : 1
  out.kvFill = Math.min(1, out.served / Math.max(1, out.kvTok))

  const prefillS = (useCase.ctx * (1 - hit)) / (prefillRate * fitMult)
  const queue = 1 + 3 * Math.pow(util, 3)
  const promptBytes = useCase.ctx * (useCase.bytesPerToken || 64)
  const ingestS = delay.bytesPerSec > 0 ? promptBytes / delay.bytesPerSec : 0
  let ttft = prefillS * queue + data.retrieval[useCase.data] + delay.meanS + ingestS
  if (orcaOn && !wire.orcaLocal) ttft += delay.rttS * (out.graphs === "large" ? 4 : 2)
  const ttftHi = ttft + delay.jitterS
  const ttftLo = Math.max(0, ttft - delay.jitterS)
  let pMiss = 0
  if (ttftHi > useCase.ttft) {
    pMiss = ttftLo >= useCase.ttft ? 1 : (ttftHi - useCase.ttft) / Math.max(1e-9, ttftHi - ttftLo)
  }
  out.ttft = ttft
  out.pMiss = pMiss
  out.slaMet = pMiss < 0.5
  out.goodput = out.served * out.quality * (1 - pMiss * (1 - LATE_GOODPUT))
  if (routed?.synergy?.goodputMult && routed.synergy.goodputMult !== 1) out.goodput *= routed.synergy.goodputMult
  out.bottleneck = bottleneck(out, useCase, data, delay)
  out.ok = true
  return settle(out)
}

function bottleneck(result, useCase, data, delay) {
  if (!result.fits) return "fit"
  if (!result.slaMet) {
    if (data.retrieval[useCase.data] >= 0.8) return "retrieval"
    if (delay.slaS >= 0.15) return "network"
    return "ttft"
  }
  if (result.bandwidthCapped && result.served < result.demand * 0.98) return "bandwidth"
  if (data.feed[useCase.data] < 1) return "data"
  if (result.served >= result.demand) {
    if (result.throughput > result.demand * 1.6) return "oversized"
    return "met"
  }
  return result.kvTok < result.computeTok ? "kv" : "compute"
}

/** Space, power, budget, outages, and lead time: from tokens to dollars and a score. */
function settle(out) {
  const add = (line) => {
    out.warnings = [...out.warnings, line]
  }
  const scaleRun = (scale) => {
    out.goodput *= scale
    out.served *= scale
    out.throughput *= scale
  }
  if (out.spaceUsed > out.spaceCap + 1e-6) {
    const overflow = out.spaceUsed - out.spaceCap
    scaleRun(out.spaceCap / out.spaceUsed)
    out.spaceBill = (overflow * (out.platform?.capex || 50000) * SPACE_PREMIUM) / HOURS_PER_MONTH
    out.overSpace = true
    add(`Your space holds ${out.spaceCap} racks, so ${fmtSpace(overflow)} more spill into costly, throttled overflow space.`)
  } else out.overSpace = false
  if (out.siteKW > out.powerCapKW && out.siteKW > 0) {
    const scale = out.powerCapKW / out.siteKW
    scaleRun(scale)
    out.powerCost += (out.siteKW - out.powerCapKW) * POWER_PRICE * OVERPOWER_MULT
    out.overPower = true
    add(`Power is over the ${out.powerMW ?? Math.round(out.powerCapKW / 100) / 10} MW available, so racks brown out and the overflow is billed.`)
  } else out.overPower = false
  out.budgetSpend = out.capex - (out.orcaCapex || 0)
  out.finance = Math.max(0, out.budgetSpend - (out.budget ?? BUDGET))
  out.overBudget = out.finance > 0
  if (out.overBudget) add(`Over the budget by ${formatMoney(out.finance)}, so the overspend is financed at a punishing rate.`)

  const net = out.net || { haircut: 0 }
  const live = out.live ?? 1
  const outage = 1 - (net.haircut || 0)
  out.powerCost += out.facilityKW * POWER_PRICE
  out.amort = out.capex / AMORT_HOURS
  // The token price still carries the whole overspend each hour, so an over-budget
  // rack cannot win and the ranking stays put. People-power repays it once a year.
  const annualFinance = out.finance * (1 + FINANCE_RATE)
  out.hourlyCost = out.powerCost + out.amort + out.netCost + out.failure + out.spaceBill + out.finance
  const pricePerM = out.scenario?.pricePerM ?? scenarioFor(out.useCase).pricePerM
  out.goodTok = out.goodput * outage * live * out.hitMult * out.reachMult
  out.revenue = (out.goodTok * pricePerM * HOUR) / 1e6
  const fullYear = live > 0 ? (out.revenue / live) * 24 * 365 : 0
  out.lostRevenue = fullYear * (1 - live)
  out.lateRevenue = fullYear * Math.min(1, (out.lateWeeks || 0) / HORIZON_WEEKS)
  out.profit = out.revenue - out.hourlyCost
  out.tokPerMW = out.facilityKW > 0 ? out.goodput / (out.facilityKW / 1000) : 0
  const goodHour = out.goodTok * HOUR
  out.costPerM = goodHour > 0 ? (out.hourlyCost * 1e6) / goodHour : Infinity
  out.coverage = out.demand > 0 ? Math.min(1, out.served / out.demand) : 0
  out.slaFactor = out.goodput > 0 ? 1 - (out.pMiss || 0) * (1 - LATE_GOODPUT) : 0
  const par = out.useCase?.parCost || 0
  const work = HUMAN_WORK[out.useCase?.id] || null
  const hourlyOpex = Math.max(0, out.hourlyCost - out.amort - out.finance) + annualFinance / HOURS_PER_YEAR
  const people = peoplePower({ goodTok: out.goodTok, demand: out.demand, work, capex: out.capex, hourlyOpex })
  out.tasksPerHour = people.tasksPerHour
  out.humanHoursPerYear = people.humanHoursPerYear
  out.fteEquivalent = people.fteEquivalent
  out.humanCostAvoided = people.humanCostAvoided
  out.annualFactory = people.annualFactory
  out.annualSavings = people.annualSavings
  out.peopleCapped = people.capped
  out.share = people.share
  out.fteCap = people.fteCap
  out.savingsFactor = savingsFactorFor(people.annualSavings, work?.savingsPar)
  out.humanMinutes = work?.humanMinutes || 0
  out.loadedCost = work?.loadedCost || 0
  out.tokensPerTask = work?.tokensPerTask || 0
  out.score = blendScore({
    par,
    coverage: out.coverage,
    slaFactor: out.slaFactor,
    launchFactor: out.launchFactor ?? 1,
    costPerM: out.costPerM,
    savingsFactor: out.savingsFactor,
  })
  out.points = out.score
  if (out.throughput > out.demand * 1.6 && out.bottleneck === "met") out.bottleneck = "oversized"
  out.leak = efficiencyLeak(out)
  out.badges = out.score > 0 && !out.overBudget && !out.overSpace ? badgesFor(out) : []
  return out
}

export function scenarioFor(useCase) {
  return SCENARIOS[useCase?.id] || { where: "", budget: BUDGET, powerMW: 1, deadlineWeeks: 26, pricePerM: 1 }
}

function fmtWeeks(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** Every component's lead time in weeks. Parts are ordered in parallel; the slowest sets go-live. */
export function leadParts(useCase, hall, platform, data, kvOn, orcaOn, bill) {
  const parts = []
  if (platform) parts.push({ id: "gpu", name: platform.name, weeks: platform.leadWeeks || 0 })
  if (hall?.fitOutWeeks) parts.push({ id: "hall", name: "Liquid hall fit-out", weeks: hall.fitOutWeeks })
  if (data?.leadWeeks) parts.push({ id: "storage", name: data.name, weeks: data.leadWeeks })
  if (kvOn) parts.push({ id: "kv", name: KV_TIER.name, weeks: KV_TIER.leadWeeks })
  if (orcaOn) parts.push({ id: "orca", name: ORCA.name, weeks: ORCA.leadWeeks })
  if (bill) parts.push({ id: "network", name: "Network", weeks: Math.round(((bill.leadDays || 0) / 7) * 10) / 10 })
  return parts
}

function fmtSpace(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** The single biggest reason this build's cost per good token is higher than it could be. */
export function efficiencyLeak(r) {
  if (!r?.ok) return null
  if (r.overBudget) return "overspend"
  if (r.overSpace) return "space"
  if (r.overPower) return "power"
  if (r.failure > 0) return "thermal"
  if (r.bottleneck === "fit") return "fit"
  if (r.data?.id === "local" && r.useCase?.data && r.useCase.data !== "none") return "store"
  if (!r.slaMet) return r.bottleneck === "network" ? "network" : "sla"
  if (r.bandwidthCapped && r.served < r.demand * 0.98) return "bandwidth"
  if (r.net?.unreached?.length) return "unreached"
  if (r.lateWeeks > 0) return "lead"
  if (r.throughput > r.demand * 1.3) return "idle"
  if (r.coverage < 0.9) return "short"
  return "met"
}

function badgesFor(result) {
  const badges = []
  if (result.coverage >= 0.9 && result.slaMet) badges.push({ id: "ontime", name: "On Time", text: "Demand met inside the SLA." })
  if (result.score >= STAR_POINTS[2]) badges.push({ id: "sharp", name: "Efficient", text: "A low cost per million good tokens." })
  if (result.kv && result.useCase.reuse >= 0.4) badges.push({ id: "kv", name: "Memory Master", text: "The KV cache tier cut repeat prefill." })
  if (result.orca && result.hitMult > 1) badges.push({ id: "photon", name: "Photon Fold", text: "ORCA raised hits per candidate." })
  if (result.data?.id === "vector" && result.useCase.data === "required") badges.push({ id: "fed", name: "Well Fed", text: "A vector index kept the answers grounded." })
  if (result.net && !result.lateWeeks && !result.net.haircut) badges.push({ id: "wired", name: "Wired Right", text: "Live fast on a protected network." })
  return badges
}

export function stars(result) {
  if (!result?.ok || !result.slaMet || result.overBudget) return 0
  return STAR_POINTS.filter((threshold) => result.score >= threshold).length
}

export function planErrors(plan) {
  if (!plan?.useCase) return ["Choose a use case."]
  if (!plan.build?.platform) return ["Choose a GPU."]
  return []
}

/** Live difference of an alternative build against the one the player has now. */
export function selectionDelta(useCaseId, build, patch) {
  const before = evaluateBuild(useCaseId, build)
  const after = evaluateBuild(useCaseId, { ...build, ...patch })
  const num = (value) => (Number.isFinite(value) ? value : 0)
  return {
    after,
    capex: num(after.capex) - num(before.capex),
    monthly: (num(after.netCost) - num(before.netCost)) * HOURS_PER_MONTH,
    costPerM: Number.isFinite(after.costPerM) && Number.isFinite(before.costPerM) ? after.costPerM - before.costPerM : null,
    score: num(after.score) - num(before.score),
    ttft: num(after.ttft) - num(before.ttft),
    profit: num(after.profit) - num(before.profit),
  }
}

/** One line: what changing this choice does to the score, $ per M tokens, budget, and wait. */
export function formatDelta(delta) {
  const parts = [
    Math.abs(delta.score) >= 1 ? `${delta.score > 0 ? "+" : "-"}${formatScore(Math.abs(delta.score))} pts` : null,
    delta.costPerM != null && Math.abs(delta.costPerM) >= 0.0005 ? `${delta.costPerM > 0 ? "+" : "-"}${formatMoney(Math.abs(delta.costPerM), 3)}/M tok` : null,
    signedMoney(delta.capex),
    signedMoney(delta.monthly, "/mo"),
    Math.abs(delta.ttft) >= 0.001 ? `${delta.ttft > 0 ? "+" : "-"}${formatSeconds(Math.abs(delta.ttft))} TTFT` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(", ") : "No change from the current choice."
}

function signedMoney(value, suffix = "") {
  if (!Number.isFinite(value) || Math.abs(value) < 0.5) return null
  return `${value > 0 ? "+" : "-"}${formatMoney(Math.abs(value))}${suffix}`
}

export function formatTokens(value) {
  if (!Number.isFinite(value)) return "—"
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${Math.round(value / 1e3)}K`
  return String(Math.round(value))
}

export function formatSeconds(value) {
  if (!Number.isFinite(value)) return "—"
  if (value < 0.001) return `${Math.round(value * 1e6)}µs`
  if (value < 1) return `${Math.round(value * 1000)}ms`
  return `${value.toFixed(1)}s`
}

export function formatScore(value) {
  if (!Number.isFinite(value)) return "0"
  return Math.round(value).toLocaleString("en-GB")
}

/** Loss wording for the results card. Past $5B the card says "over $5B". */
export function lossPhrase(annualSavings) {
  const loss = Math.abs(Number(annualSavings) || 0)
  if (loss > LOSS_DISPLAY_CAP) return "over $5B"
  return formatMoney(loss)
}

/**
 * Game prices in US dollars. Millions keep up to two decimals; thousands and whole dollars
 * do not. Sub-dollar values (cost per million tokens) keep `cents` significant decimals.
 */
export function formatMoney(value, cents = 0) {
  if (!Number.isFinite(value)) return "$0"
  const sign = value < 0 ? "-" : ""
  const abs = Math.abs(value)
  if (abs >= 1e6) {
    const millions = (abs / 1e6).toFixed(2).replace(/0$/, "").replace(/\.0$/, "")
    return `${sign}$${millions}M`
  }
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}k`
  if (cents > 0 && abs < 10) return `${sign}$${abs.toFixed(cents)}`
  return `${sign}$${Math.round(abs)}`
}

export { destinationsNeeded }
