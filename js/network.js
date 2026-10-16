/**
 * Network provisioning: what each option costs up front (NRC), every month (MRC),
 * and how many days it takes before traffic flows.
 *
 * Published (ServiceFabric user guide, FAQ and terminology pages, checked Oct 2026):
 * - Port speeds 10 Gbps or 100 Gbps, depending on location and availability zone.
 * - Link (Layer 2, port to port over a VLAN) and Connection (Layer 3, via a virtual router)
 *   speeds: 50, 100, 200, 300, 400, 500 Mbps, 1, 2, 2.5, 5, 10, 100 Gbps.
 * - Destinations: cloud on-ramps (AWS, Azure, Google Cloud, IBM Cloud, Oracle Cloud),
 *   ports and virtual routers of your own or of other customers, and Digital Internet
 *   (50 Mbps to 10 Gbps, same region only).
 * - Port groups (LAG) and availability zones give redundancy.
 * - A new port needs a cross connect (LOA, remote hands ticket) with a 15-day SLA.
 *   Links and Connections are typically ready in under five minutes (up to 15).
 * - ServiceFabric MCP (early access): read-only and read-write MCP servers over the
 *   same ServiceFabric API, including a pricing domain. It does not change the data path.
 * - Cross Connect: a physical link between two endpoints in one facility.
 *
 * Not published, so every number below is a labelled game assumption: all prices,
 * the cross-connect and internet lead times, dark-fiber lead time, optics, and the
 * outage haircut for a single port.
 */

export const HORIZON_DAYS = 365
export const HOURS_PER_MONTH = 730

/** Published Link / Connection speeds, in Gbps. */
export const FABRIC_SPEEDS = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 1, 2, 2.5, 5, 10, 100]
/** Published port speeds, in Gbps. */
export const PORT_SPEEDS = [10, 100]
/** Digital Internet tops out at 10 Gbps (published). */
export const INTERNET_MAX_GBPS = 10

export const DESTINATIONS = [
  { id: "cloud", name: "Cloud on-ramp", short: "CLOUD", learn: "AWS, Azure, Google Cloud, IBM Cloud or Oracle Cloud." },
  { id: "partner", name: "Partner / SaaS", short: "PARTNER", learn: "Another customer's port or virtual router, found in Service Directory." },
  { id: "metro", name: "Another Digital Realty metro", short: "METRO", learn: "Your own port in a second metro." },
  { id: "internet", name: "Digital Internet", short: "INTERNET", learn: "Digital Realty's internet service on the fabric, up to 10 Gbps, same region." },
]

/** Game prices (US dollars). Industry-typical ranges, not a Digital Realty quote. */
export const NET_PRICES = {
  portMrc: { 10: 1200, 100: 4000 },
  portNrc: 0,
  vcMrc: { 0.05: 400, 0.1: 450, 0.2: 500, 0.3: 550, 0.4: 600, 0.5: 650, 1: 750, 2: 850, 2.5: 900, 5: 1100, 10: 1300, 100: 1500 },
  metroMult: 1.5,
  routerMrc: 500,
  crossNrc: 500,
  crossMrc: 400,
  fiberNrc: 60000,
  opticsNrc: 40000,
  fiberMrcBase: 2500,
  fiberMrcPerKm: 0,
  transitPerMbps: 0.3,
  transitCommitGbps: 10,
  transitNrc: 1000,
}

/** Days from order to first live traffic. */
export const LEAD_DAYS = {
  /** Published: new-port cross connect SLA 15 days; the virtual connection itself takes minutes. */
  fabricPort: 15,
  fabricVc: 0,
  /** Game: about five business days (not published; industry 3 to 15 business days). */
  cross: 7,
  /** Game: 12 weeks (industry 8 to 16 weeks). */
  fiber: 84,
  /** Game: three weeks for an ISP to install transit (industry days to weeks). */
  public: 21,
  /** Game: an exchange port, its cross connect and the first BGP sessions take about three weeks (industry two to six). */
  peer: 21,
  /** Game: private hand-offs to eyeball ISPs are negotiated one by one, about four weeks (industry one to three months). */
  eye: 28,
}

/** Expected share of good tokens lost to outages on a single, unprotected path. Game assumption. */
export const OUTAGE_HAIRCUT = 0.03
/** Same campus distance used for a partner hand-off. Matches the model's partner distance. */
const PARTNER_KM = 15
/** Dark fiber here is a metro or regional product. */
export const FIBER_MAX_KM = 1500
/** Physical capacity of one cross connect or one lit fibre route with 100G optics. */
export const PHYSICAL_GBPS = 100

export function blankFabric() {
  return { port: 10, vc: 1, dest: "internet", layer: "l2", redundant: false }
}

export function speedLabel(gbps) {
  if (!Number.isFinite(gbps)) return "—"
  return gbps < 1 ? `${Math.round(gbps * 1000)} Mbps` : `${gbps} Gbps`
}

export function vcPrice(gbps, dest) {
  const base = NET_PRICES.vcMrc[gbps] ?? NET_PRICES.vcMrc[nearestSpeed(gbps)]
  return dest === "metro" ? base * NET_PRICES.metroMult : base
}

export function nearestSpeed(gbps) {
  return FABRIC_SPEEDS.reduce((best, s) => (Math.abs(s - gbps) < Math.abs(best - gbps) ? s : best), FABRIC_SPEEDS[0])
}

/** Smallest published speed at or above `gbps`. */
export function speedFor(gbps) {
  return FABRIC_SPEEDS.find((s) => s >= gbps - 1e-9) ?? FABRIC_SPEEDS[FABRIC_SPEEDS.length - 1]
}

export function stepSpeed(gbps, dir) {
  const i = FABRIC_SPEEDS.indexOf(nearestSpeed(gbps))
  return FABRIC_SPEEDS[Math.max(0, Math.min(FABRIC_SPEEDS.length - 1, i + dir))]
}

/** Peak bytes per site, as Gbps, for the use case's full demand. */
export function needGbps(useCase, siteCount = 1) {
  if (!useCase) return 0
  return (useCase.demand * (useCase.bytesPerToken || 64) * 8) / 1e9 / Math.max(1, siteCount)
}

/** Which destinations the traffic of this build must reach. */
export function destinationsNeeded(useCase, legs, siteCount = 1) {
  const map = useCase?.netDest || {}
  const set = []
  for (const leg of legs || []) {
    const dest = map[leg.id] || "internet"
    if (!set.includes(dest)) set.push(dest)
  }
  if (siteCount > 1 && !set.includes("metro")) set.push("metro")
  return set
}

/** Clamp a fabric config to what ServiceFabric actually offers. */
export function cleanFabric(config = {}) {
  const base = { ...blankFabric(), ...config }
  const warnings = []
  const port = PORT_SPEEDS.includes(base.port) ? base.port : 10
  let vc = nearestSpeed(Number(base.vc) || 1)
  if (vc > port) {
    warnings.push(`A ${speedLabel(vc)} connection does not fit a ${port} Gbps port. It runs at ${port} Gbps.`)
    vc = port
  }
  if (base.dest === "internet" && vc > INTERNET_MAX_GBPS) {
    warnings.push(`Digital Internet tops out at ${INTERNET_MAX_GBPS} Gbps. The connection runs at ${INTERNET_MAX_GBPS} Gbps.`)
    vc = INTERNET_MAX_GBPS
  }
  const dest = DESTINATIONS.some((d) => d.id === base.dest) ? base.dest : "internet"
  return { config: { port, vc, dest, layer: base.layer === "l3" ? "l3" : "l2", redundant: Boolean(base.redundant) }, warnings }
}

/**
 * MCP's labelled agility benefit: during the run the agent steps the connection one tier
 * up when it is too thin, or one tier down when a smaller tier still carries the peak.
 * Same price list, same latency.
 */
export function mcpRightSize(config, need) {
  const vc = config.vc
  if (need > vc + 1e-9) {
    const up = Math.min(stepSpeed(vc, 1), config.port, config.dest === "internet" ? INTERNET_MAX_GBPS : Infinity)
    return { ...config, vc: up }
  }
  const down = stepSpeed(vc, -1)
  if (down < vc && down >= need) return { ...config, vc: down }
  return config
}

/**
 * Line items for the chosen network.
 * `ctx`: { useCase, kind, fabric, siteCount, legs, interKm, perSiteKm }.
 */
export function networkBill(ctx) {
  const { useCase, kind, siteCount = 1, legs = [], interKm = 0 } = ctx
  const needs = destinationsNeeded(useCase, legs, siteCount)
  const items = []
  const warnings = []
  const unreached = []
  let leadDays = 0
  let capGbps = PHYSICAL_GBPS
  let haircut = 0
  let config = null
  let rightSized = null

  if (kind === "fabric" || kind === "mcp") {
    const clean = cleanFabric(ctx.fabric)
    config = clean.config
    warnings.push(...clean.warnings)
    const need = needGbps(useCase, siteCount)
    let live = config
    if (kind === "mcp") {
      live = mcpRightSize(config, need)
      if (live.vc !== config.vc) rightSized = { from: config.vc, to: live.vc }
    }
    const copies = live.redundant ? 2 : 1
    const ports = siteCount * copies
    items.push({ label: `${ports}× ${live.port}G port`, nrc: ports * NET_PRICES.portNrc, mrc: ports * NET_PRICES.portMrc[live.port] })
    const reached = live.layer === "l3" ? needs : needs.filter((d) => d === live.dest)
    if (live.layer === "l2" && !needs.includes(live.dest)) reached.push(live.dest)
    const vcs = reached.length * siteCount * copies
    const vcMrc = reached.reduce((sum, dest) => sum + vcPrice(live.vc, dest), 0) * siteCount * copies
    items.push({ label: `${vcs}× ${speedLabel(live.vc)} ${live.layer === "l3" ? "connection" : "link"}`, nrc: 0, mrc: vcMrc })
    if (live.layer === "l3") items.push({ label: `${siteCount}× virtual router`, nrc: 0, mrc: siteCount * NET_PRICES.routerMrc })
    for (const dest of needs) if (!reached.includes(dest)) unreached.push(dest)
    if (unreached.length) {
      const names = unreached.map((d) => DESTINATIONS.find((x) => x.id === d)?.name || d).join(" and ")
      warnings.push(`A Layer 2 link reaches one destination. ${names} traffic falls back to the public internet. Layer 3 reaches them all.`)
    }
    if (!needs.includes(live.dest) && live.layer === "l2") {
      warnings.push(`Nothing in this job talks to ${DESTINATIONS.find((d) => d.id === live.dest)?.name || live.dest}. That link carries no traffic.`)
    }
    capGbps = live.vc * siteCount
    if (!live.redundant) haircut = OUTAGE_HAIRCUT
    leadDays = LEAD_DAYS.fabricPort + LEAD_DAYS.fabricVc
    config = live
  } else if (kind === "cross") {
    const count = Math.max(1, needs.length)
    items.push({ label: `${count}× cross connect`, nrc: count * NET_PRICES.crossNrc, mrc: count * NET_PRICES.crossMrc })
    leadDays = LEAD_DAYS.cross
  } else if (kind === "fiber") {
    const routes = []
    routes.push(PARTNER_KM)
    if (siteCount > 1) for (let i = 1; i < siteCount; i += 1) routes.push(Math.max(PARTNER_KM, interKm / Math.max(1, siteCount - 1)))
    const km = routes.reduce((a, b) => a + b, 0)
    items.push({ label: `${routes.length}× dark fiber route`, nrc: routes.length * NET_PRICES.fiberNrc, mrc: routes.length * NET_PRICES.fiberMrcBase + km * NET_PRICES.fiberMrcPerKm })
    items.push({ label: `${routes.length}× optics (DWDM pair)`, nrc: routes.length * NET_PRICES.opticsNrc, mrc: 0 })
    leadDays = LEAD_DAYS.fiber
    haircut = OUTAGE_HAIRCUT
  } else {
    const mbps = NET_PRICES.transitCommitGbps * 1000
    items.push({ label: `${NET_PRICES.transitCommitGbps} Gbps transit × ${siteCount}`, nrc: NET_PRICES.transitNrc * siteCount, mrc: mbps * NET_PRICES.transitPerMbps * siteCount })
    capGbps = NET_PRICES.transitCommitGbps * siteCount
    leadDays = LEAD_DAYS.public
    haircut = OUTAGE_HAIRCUT
  }
  const nrc = items.reduce((sum, item) => sum + item.nrc, 0)
  const mrc = items.reduce((sum, item) => sum + item.mrc, 0)
  return { kind, needs, items, nrc, mrc, leadDays, capGbps, haircut, unreached, warnings, config, rightSized }
}

/** Share of the horizon that earns revenue once the network is live. */
export function liveShare(leadDays) {
  return Math.max(0, HORIZON_DAYS - Math.max(0, leadDays)) / HORIZON_DAYS
}

/** The agent console: an intent phrase becomes an exact, priced proposal. */
export const MCP_INTENTS = [
  { id: "lean", text: "Carry my peak traffic for the lowest monthly bill." },
  { id: "safe", text: "Carry my peak and survive a port or zone failure." },
  { id: "reach", text: "Reach every cloud, partner and metro my app calls." },
]

export function mcpPropose(intentId, useCase, legs, siteCount = 1) {
  const needs = destinationsNeeded(useCase, legs, siteCount)
  const need = needGbps(useCase, siteCount)
  const vc = speedFor(need)
  const port = vc > 10 ? 100 : 10
  const many = needs.length > 1
  const config = {
    port,
    vc,
    dest: needs[0] || "internet",
    layer: intentId === "reach" || many ? "l3" : "l2",
    redundant: intentId !== "lean",
  }
  if (intentId === "lean" && many) config.layer = "l3"
  const bill = networkBill({ useCase, kind: "mcp", fabric: config, siteCount, legs })
  const steps = [
    `service-fabric: list ports, locations and pricing for ${siteCount} site${siteCount > 1 ? "s" : ""}`,
    `peak ≈ ${speedLabel(Math.round(need * 100) / 100)} per site → ${speedLabel(vc)} ${config.layer === "l3" ? "connection" : "link"} on a ${port}G port`,
    `destinations: ${needs.map((d) => DESTINATIONS.find((x) => x.id === d)?.short || d).join(", ")}${config.layer === "l3" ? " via a virtual router" : ""}`,
    config.redundant ? "second port in another availability zone" : "single port, no failover",
  ]
  return { intentId, config, bill, steps }
}
