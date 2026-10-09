/**
 * Per-leg routing. Each use case has a few traffic legs. The player puts one product
 * on each leg, and a few labelled combos reward mixtures.
 *
 * Distances, the shared-pipe queue, the goodput bonuses, and the +25% score cap are
 * game assumptions. Product rules (where a cross connect can go, ServiceFabric speeds,
 * MCP not being a faster pipe) follow the published facts in network.js.
 */

import { NETWORKS, byId } from "./data.js"
import { CAMPUS_KM, INTERNET_LOSS, linkProfile } from "./model.js"
import {
  FIBER_MAX_KM,
  INTERNET_MAX_GBPS,
  LEAD_DAYS,
  NET_PRICES,
  OUTAGE_HAIRCUT,
  blankFabric,
  cleanFabric,
  mcpRightSize,
  speedFor,
  stepSpeed,
  vcPrice,
} from "./network.js"

/** Company cloud region used when a retrieval leg is not an in-building cross connect. Game. */
export const CLOUD_REGION_KM = 800
/** Extra wait when one product carries both the user path and the retrieval path. Game. */
export const SHARED_PIPE_S = 0.004
/** ServiceFabric at or above this rate counts as a high-bandwidth science pipe. Game. */
export const FAT_GBPS = 10
/** Combo goodput bonuses cannot multiply score by more than this. */
export const SYNERGY_CAP = 1.25
const STREAM_BONUS = new Set(["chat", "rag", "code", "research"])
const PRIVATE = new Set(["cross", "fabric", "fiber", "mcp"])

export const COMBOS = [
  {
    id: "private",
    name: "PRIVATE PATH",
    text: "Every latency-sensitive leg is on a private path, so internet jitter never touches the SLA, and chat, RAG and agents gain 5% goodput because predictable latency keeps the stream smooth (game).",
  },
  {
    id: "fabricMcp",
    name: "FABRIC + MCP",
    text: "ServiceFabric carries the data or tool calls and ServiceFabric MCP watches the control leg, so bandwidth steps one tier during the run and coding and research pay 10% less network opex (game). The wire is not faster.",
  },
  {
    id: "onramp",
    name: "IN-BUILDING ON-RAMP",
    text: "A cross connect reaches the cloud on-ramp in this building while ServiceFabric covers the other path, so retrieval delay floors at in-building latency and RAG and research gain 10% goodput (game: the biggest first-token win for RAG).",
  },
  {
    id: "backbone",
    name: "OWN FIBER",
    text: "Dark fiber between your own metros removes the inter-site delay and the bandwidth cap (game), but the route still waits out its lead time and its up-front cost.",
  },
  {
    id: "bulk",
    name: "BULK PIPE",
    text: "A dark-fiber or high-bandwidth ServiceFabric feed from the lab screens more candidates per hour (game). The public internet still works here, only slower, and it is not an SLA miss.",
  },
  {
    id: "redundant",
    name: "REDUNDANT PATHS",
    text: "A second, different private product backs up a critical leg, so the outage haircut drops off (game). You pay for both.",
  },
]

export function capSynergy(mult) {
  return Math.min(SYNERGY_CAP, mult)
}

export function isPrivate(kind) {
  return PRIVATE.has(kind)
}

export function activeLegs(useCase, build, reach) {
  const sites = reach?.sites?.length || Math.max(1, build?.sites?.length || 1)
  return (useCase?.legs || []).filter((leg) => {
    if (leg.when === "multi") return sites > 1
    if (leg.when === "orca") return Boolean(build?.orca && useCase?.orca)
    return true
  })
}

export function defaultRoutes(useCase) {
  const routes = {}
  for (const leg of useCase?.legs || []) {
    routes[leg.id] = leg.when === "optional"
      ? { kind: "off" }
      : { kind: "fabric", fabric: { ...blankFabric(), dest: leg.dest } }
  }
  return routes
}

export function routeNetworkId(routes = {}) {
  const kinds = Object.values(routes).map((route) => route?.kind).filter((kind) => kind && kind !== "off")
  const set = new Set(kinds)
  if (set.size <= 1) return [...set][0] || "fabric"
  return "mix"
}

export function legKm(leg, reach, kind) {
  if (leg.role === "orca" || leg.role === "control") return 0
  if (leg.role === "inter") return reach?.interKm || 0
  if (leg.role === "data" || leg.role === "tools") return kind === "cross" ? 0 : CLOUD_REGION_KM
  if (leg.role === "lab") return reach?.avgKm || 0
  return reach?.avgKm || 0
}

export function legEligibility(leg, kind, reach) {
  if (kind === "off") {
    return leg.when === "optional"
      ? { ok: true, reason: "" }
      : { ok: false, reason: "This leg needs a path." }
  }
  if (kind === "fabric" || kind === "mcp" || kind === "public") return { ok: true, reason: "" }
  const km = legKm(leg, reach, kind)
  if (kind === "cross") {
    if (leg.role === "inter") return { ok: false, reason: "Cross Connect stays in one building. These sites are in different metros." }
    if (leg.role === "orca" || leg.role === "data" || leg.role === "tools") return { ok: true, reason: "In this building: a cloud on-ramp or a same-hall hand-off." }
    if (km > CAMPUS_KM) return { ok: false, reason: `Cross Connect stays in one building. This path is about ${Math.round(km).toLocaleString("en-GB")} km.` }
    return { ok: true, reason: "Both ends are in this building." }
  }
  if (kind === "fiber") {
    if (leg.role === "orca" || leg.role === "control") return { ok: false, reason: "Dark fiber needs your other site, or a named partner outside this building." }
    if (km <= CAMPUS_KM) return { ok: false, reason: "Dark fiber needs your other site, or a named partner outside this building." }
    if (km > FIBER_MAX_KM) return { ok: false, reason: `Dark fiber is a metro or regional route. This path is ${Math.round(km).toLocaleString("en-GB")} km.` }
    return { ok: true, reason: "Lit between your own sites or to a named partner." }
  }
  return { ok: false, reason: "Unknown option." }
}

function leadOf(kind) {
  if (kind === "fabric" || kind === "mcp") return LEAD_DAYS.fabricPort
  if (kind === "cross") return LEAD_DAYS.cross
  if (kind === "fiber") return LEAD_DAYS.fiber
  if (kind === "public") return LEAD_DAYS.public
  return 0
}

function backupChoices(leg, primary, reach) {
  return ["cross", "fiber", "fabric"].filter((kind) => kind !== primary && isPrivate(kind) && legEligibility(leg, kind, reach).ok)
}

export function nextBackup(leg, route, reach) {
  const options = [null, ...backupChoices(leg, route?.kind, reach)]
  const index = options.indexOf(route?.backup || null)
  return options[(index + 1) % options.length] || null
}

/**
 * Which combos are on. Each one requires its exact condition; a near miss stays off.
 * `assigned` entries use the effective kind after ineligible options fall back.
 */
export function detectCombos(assigned, useCase, reach) {
  const live = assigned.filter((row) => row.kind !== "off")
  const sensitive = live.filter((row) => row.leg.sensitive)
  const on = []
  const push = (id) => on.push(COMBOS.find((combo) => combo.id === id))
  if (sensitive.length > 0 && sensitive.every((row) => isPrivate(row.kind))) push("private")
  const dataFabric = live.some((row) => (row.leg.role === "data" || row.leg.role === "tools") && row.kind === "fabric")
  const controlMcp = live.some((row) => row.leg.role === "control" && row.kind === "mcp")
  if (dataFabric && controlMcp) push("fabricMcp")
  const dataCross = live.some((row) => row.leg.role === "data" && row.kind === "cross")
  const fabricElsewhere = live.some((row) => row.kind === "fabric" && row.leg.role !== "data")
  if ((useCase.id === "rag" || useCase.id === "research") && dataCross && fabricElsewhere) push("onramp")
  if (
    (useCase.id === "chat" || useCase.id === "code")
    && (reach?.sites?.length || 0) > 1
    && live.some((row) => row.leg.role === "inter" && row.kind === "fiber")
  ) push("backbone")
  if (useCase.id === "drug" && live.some((row) => row.leg.role === "lab" && (row.kind === "fiber" || ((row.kind === "fabric" || row.kind === "mcp") && row.vc >= FAT_GBPS)))) push("bulk")
  if (live.some((row) => row.leg.critical && row.backup && isPrivate(row.backup) && isPrivate(row.kind) && row.backup !== row.kind)) push("redundant")
  return on.filter(Boolean)
}

function synergyFor(combos, useCaseId) {
  const ids = new Set(combos.map((combo) => combo.id))
  let raw = 1
  if (ids.has("private") && STREAM_BONUS.has(useCaseId)) raw *= 1.05
  if (ids.has("onramp")) raw *= 1.1
  if (ids.has("bulk")) raw *= 1.12
  return { goodputMult: capSynergy(raw), capped: raw > SYNERGY_CAP + 1e-9, opexMult: ids.has("fabricMcp") && (useCaseId === "code" || useCaseId === "research") ? 0.9 : 1 }
}

function mixFace() {
  return {
    id: "mix",
    name: "Mixture",
    short: "MIX",
    gbps: 10,
    orcaLocal: false,
    orcaRetain: 0.7,
    does: "A different product on each traffic leg.",
    learn: "Each leg has its own product. Combos reward mixtures that match how the traffic actually flows. The boost is capped at +25% (game).",
  }
}

/**
 * Bill, delay, and combos for a routed build.
 * `ctx`: { useCase, build, reach, siteCount }.
 */
export function evaluateRoutes(ctx) {
  const { useCase, build, reach, siteCount = 1 } = ctx
  const warnings = []
  const catalog = activeLegs(useCase, build, reach)
  const rows = catalog.map((leg) => {
    const chosen = build.routes?.[leg.id] || { kind: leg.when === "optional" ? "off" : "fabric", fabric: { ...blankFabric(), dest: leg.dest } }
    const gate = legEligibility(leg, chosen.kind, reach)
    let kind = chosen.kind
    if (!gate.ok) {
      warnings.push(`${leg.name}: ${gate.reason} Traffic on this leg falls back to the public internet.`)
      kind = "public"
    }
    let fabric = { ...blankFabric(), dest: leg.dest, ...(chosen.fabric || {}) }
    if ((kind === "fabric" || kind === "mcp") && Number.isFinite(build.bwTier)) {
      const need = ((useCase.demand * (useCase.bytesPerToken || 64) * 8) / 1e9 / siteCount) * (leg.bw || 1)
      const vc = stepSpeed(speedFor(need), build.bwTier)
      fabric = { ...fabric, vc, port: vc > 10 ? 100 : 10, redundant: build.fabricRedundant ?? fabric.redundant }
    }
    if (kind === "fabric" || kind === "mcp") {
      const clean = cleanFabric({ ...fabric, dest: leg.dest === "internet" ? fabric.dest : leg.dest })
      fabric = { ...clean.config, dest: leg.dest }
      if (fabric.dest === "internet" && fabric.vc > INTERNET_MAX_GBPS) fabric.vc = INTERNET_MAX_GBPS
      warnings.push(...clean.warnings.map((line) => `${leg.name}: ${line}`))
    }
    const backupGate = chosen.backup ? legEligibility(leg, chosen.backup, reach) : { ok: false }
    const backup = chosen.backup && backupGate.ok && chosen.backup !== kind ? chosen.backup : null
    return { leg, kind, fabric, backup, requested: chosen.kind }
  })

  const ingress = rows.find((row) => row.leg.role === "ingress")
  const needOf = (row) => ((useCase.demand * (useCase.bytesPerToken || 64) * 8) / 1e9 / siteCount) * (row.leg.bw || 1)
  for (const row of rows) {
    if (row.kind !== "mcp") continue
    const next = mcpRightSize(row.fabric, needOf(row))
    if (next.vc !== row.fabric.vc) {
      row.rightSized = { from: row.fabric.vc, to: next.vc }
      row.fabric = next
    }
  }
  const combos = detectCombos(rows.map((row) => ({ ...row, vc: row.fabric.vc })), useCase, reach)
  const synergy = synergyFor(combos, useCase.id)
  const comboIds = new Set(combos.map((combo) => combo.id))
  for (const row of rows) {
    if (!comboIds.has("fabricMcp") || row.kind !== "fabric" || (row.leg.role !== "data" && row.leg.role !== "tools")) continue
    const next = mcpRightSize(row.fabric, needOf(row))
    if (next.vc !== row.fabric.vc) {
      row.rightSized = { from: row.fabric.vc, to: next.vc }
      row.fabric = next
    }
  }

  const ids = new Set()
  const items = []
  const fabricRows = rows.filter((row) => row.kind === "fabric" || row.kind === "mcp" || row.backup === "fabric")
  if (fabricRows.length) {
    const port = Math.max(...fabricRows.map((row) => row.fabric.port || 10))
    const redundant = fabricRows.some((row) => row.fabric.redundant || row.backup === "fabric")
    const copies = redundant ? 2 : 1
    const ports = siteCount * copies
    items.push({ label: `${ports}× ${port}G port`, nrc: ports * NET_PRICES.portNrc, mrc: ports * NET_PRICES.portMrc[port] || NET_PRICES.portMrc[10] })
    const layered = fabricRows.some((row) => row.fabric.layer === "l3")
    if (layered) items.push({ label: `${siteCount}× virtual router`, nrc: 0, mrc: siteCount * NET_PRICES.routerMrc })
    for (const row of fabricRows) {
      if (row.kind !== "fabric" && row.kind !== "mcp") continue
      const copiesHere = row.leg.role === "ingress" ? siteCount * (row.fabric.redundant ? 2 : 1) : 1
      const mrc = vcPrice(row.fabric.vc, row.leg.dest) * copiesHere
      items.push({ label: `${row.leg.name} ${row.fabric.vc < 1 ? `${Math.round(row.fabric.vc * 1000)}M` : `${row.fabric.vc}G`} ${row.fabric.layer === "l3" ? "connection" : "link"}`, nrc: 0, mrc })
      row.mrc = mrc
      row.nrc = 0
    }
  }

  const legStats = []
  let meanS = 0
  let jitterS = 0
  let trips = 0
  let publicTrips = 0
  let maxRtt = 0
  let userRttS = 0
  let loss = 0
  let capTok = Infinity
  const unreached = []
  let leadDays = 0
  const bytes = useCase.bytesPerToken || 64

  for (const row of rows) {
    if (row.kind === "off") {
      legStats.push({ id: row.leg.id, name: row.leg.name, kind: "off", kindLabel: "OFF", rttS: 0, gbps: 0, mrc: 0, nrc: 0, leadDays: 0, addedS: 0 })
      continue
    }
    const km = legKm(row.leg, reach, row.kind)
    const link = byId(NETWORKS, row.kind) || byId(NETWORKS, "public")
    let profile = linkProfile(link, km)
    if (row.leg.role === "inter" && comboIds.has("backbone")) profile = { ...profile, rttS: 0, jitterS: 0, loss: 0, gbps: Infinity }
    if (row.leg.role === "data" && comboIds.has("onramp")) profile = linkProfile(byId(NETWORKS, "cross"), 0)
    const weight = row.leg.trips || 0
    let extra = 0
    if ((row.leg.role === "data" || row.leg.role === "tools") && ingress && row.kind === ingress.kind && !comboIds.has("onramp")) extra = SHARED_PIPE_S * weight
    const addedS = weight * profile.rttS + extra
    if (row.leg.role !== "control") {
      meanS += addedS
      jitterS += weight * profile.jitterS * (row.leg.jitter || 0)
      trips += weight
      if (row.kind === "public" && !row.leg.slaExempt) publicTrips += weight
      maxRtt = Math.max(maxRtt, profile.rttS)
      if (row.leg.role === "ingress") {
        userRttS = profile.rttS
        if (row.kind === "public") loss = INTERNET_LOSS
      }
    }
    let gbps = row.kind === "fabric" || row.kind === "mcp" ? row.fabric.vc * (row.leg.role === "ingress" ? siteCount : 1) : link.gbps
    if (row.leg.role === "inter" && comboIds.has("backbone")) gbps = Infinity
    if ((row.leg.bw || 0) > 0 && Number.isFinite(gbps)) {
      const legCap = (gbps * 1e9) / 8 / (bytes * row.leg.bw)
      capTok = Math.min(capTok, legCap)
    }
    if (row.kind === "cross" || row.backup === "cross") {
      const count = (row.kind === "cross" ? 1 : 0) + (row.backup === "cross" ? 1 : 0)
      const scale = row.leg.role === "ingress" ? siteCount : 1
      const nrc = count * scale * NET_PRICES.crossNrc
      const mrc = count * scale * NET_PRICES.crossMrc
      items.push({ label: `${row.leg.name} cross connect`, nrc, mrc })
      row.nrc = (row.nrc || 0) + nrc
      row.mrc = (row.mrc || 0) + mrc
    }
    if (row.kind === "fiber" || row.backup === "fiber") {
      const count = (row.kind === "fiber" ? 1 : 0) + (row.backup === "fiber" ? 1 : 0)
      const nrc = count * (NET_PRICES.fiberNrc + NET_PRICES.opticsNrc)
      const mrc = count * (NET_PRICES.fiberMrcBase + km * NET_PRICES.fiberMrcPerKm)
      items.push({ label: `${row.leg.name} dark fiber + optics`, nrc, mrc })
      row.nrc = (row.nrc || 0) + nrc
      row.mrc = (row.mrc || 0) + mrc
    }
    if (row.kind === "public") {
      const scale = row.leg.role === "ingress" ? siteCount : 1
      const nrc = NET_PRICES.transitNrc * scale
      const mrc = NET_PRICES.transitCommitGbps * 1000 * NET_PRICES.transitPerMbps * scale
      items.push({ label: `${row.leg.name} transit`, nrc, mrc })
      row.nrc = nrc
      row.mrc = mrc
    }
    if (row.leg.role !== "control") leadDays = Math.max(leadDays, leadOf(row.kind))
    const short = byId(NETWORKS, row.kind)?.short || row.kind.toUpperCase()
    legStats.push({
      id: row.leg.id,
      name: row.leg.name,
      hint: row.leg.hint,
      kind: row.kind,
      kindLabel: short,
      rttS: profile.rttS,
      gbps: Number.isFinite(gbps) ? gbps : null,
      mrc: row.mrc || 0,
      nrc: row.nrc || 0,
      leadDays: row.leg.role === "control" ? 0 : leadOf(row.kind),
      addedS,
      trips: weight,
      backup: row.backup,
      rightSized: row.rightSized || null,
    })
    ids.add(row.leg.dest)
  }

  let nrc = items.reduce((sum, item) => sum + item.nrc, 0)
  let mrc = items.reduce((sum, item) => sum + item.mrc, 0)
  if (synergy.opexMult < 1 && mrc > 0) {
    const cut = mrc * (1 - synergy.opexMult)
    items.push({ label: "MCP agility −10% network opex (game)", nrc: 0, mrc: -cut })
    mrc -= cut
  }
  const exposed = rows.some((row) => row.leg.critical && !row.leg.slaExempt && row.kind !== "off" && unprotected(row))
  const haircut = comboIds.has("redundant") || !exposed ? 0 : OUTAGE_HAIRCUT
  const orcaRow = rows.find((row) => row.leg.role === "orca" && row.kind !== "off")
  const faceKind = routeNetworkId(build.routes || {})
  const network = faceKind === "mix" ? mixFace() : byId(NETWORKS, faceKind) || byId(NETWORKS, "fabric")
  const wire = byId(NETWORKS, orcaRow?.kind || rows.find((row) => row.kind !== "off")?.kind || "public")
  const config = rows.find((row) => row.kind === "fabric" || row.kind === "mcp")?.fabric || null
  const rightSized = rows.find((row) => row.rightSized)?.rightSized || null
  if (!Number.isFinite(capTok)) capTok = 1e12
  const nominalBps = capTok * bytes
  return {
    wire,
    network,
    combos,
    synergy,
    warnings,
    legs: legStats,
    bill: {
      kind: faceKind,
      needs: [...ids],
      items,
      nrc,
      mrc,
      leadDays,
      capGbps: Number.isFinite(capTok) ? (capTok * bytes * 8) / 1e9 : null,
      haircut,
      unreached,
      warnings,
      config,
      rightSized,
    },
    delay: {
      rttS: trips ? meanS / trips : 0,
      userRttS,
      meanS,
      jitterS: comboIds.has("private") ? 0 : jitterS,
      slaS: meanS + (comboIds.has("private") ? 0 : jitterS),
      trips,
      publicTrips,
      loss: comboIds.has("private") ? 0 : loss,
      capTok,
      bytesPerSec: nominalBps,
      legs: legStats,
    },
  }
}

function unprotected(row) {
  if (row.backup && isPrivate(row.backup) && row.backup !== row.kind) return false
  if (row.kind === "cross") return false
  if ((row.kind === "fabric" || row.kind === "mcp") && row.fabric.redundant) return false
  return true
}

/** Smallest published speed that carries the heaviest leg. */
export function routeSpeed(useCase, siteCount = 1) {
  const base = (useCase.demand * (useCase.bytesPerToken || 64) * 8) / 1e9 / Math.max(1, siteCount)
  const heaviest = Math.max(1, ...(useCase.legs || []).map((leg) => leg.bw || 1))
  return speedFor(base * heaviest)
}
