/**
 * The CONNECTIVITY step as a product set. The player picks any number of Digital Realty products
 * (`choices.net`, an array of product ids); the router puts the best eligible product on every
 * traffic leg of the story, so a set reads as "the products I have bought" and the legs follow.
 * Nerd mode may pin one product on one leg (`choices.legs`, leg id → product id).
 *
 * Products (published catalogue: digitalrealty.com/platform-digital/connectivity and the
 * ServiceFabric user guide, checked Oct 2026): Cross Connect, ServiceFabric, ServiceFabric MCP
 * (early access), Dark Fiber, Metro Connect (between Digital Realty facilities in one metro),
 * Pathway products (protected conduit for your own cabling within and between buildings), the
 * Internet Exchange (peering), Digital Internet (internet on the fabric, up to 10 Gbps) and
 * cloud on-ramps (reached over a cross connect or a ServiceFabric connection). Every product
 * maps onto one of the physics rows in js/physics.js; the nerd-only products are refinements of
 * the five simple ones, never a different wire, so a set scores the same on both boards.
 *
 * A legacy choice set (`choices.wires` one of cheap / peer / fast / private / combo, no `net`)
 * still routes the old way in js/presets.js; `netOf` says which products such a set stands for.
 */
import { IN_METRO_KM, NETWORKS, byId } from "./data.js"
import { CAMPUS_KM, siteReach } from "./model.js"
import { blankFabric } from "./network.js"
import { legEligibility } from "./routes.js"

/** Physics order at any distance: cross ≤ fiber ≤ fabric = mcp ≤ eye ≤ peer < public (js/physics.js). */
const RANK = { cross: 0, fiber: 1, fabric: 2, mcp: 2, eye: 3, peer: 4, public: 5 }

export const PRODUCTS = [
  {
    id: "public",
    label: "Public internet",
    short: "Internet",
    kind: "public",
    simple: true,
    art: "gremlin",
    hint: "cheap, busy, slow at peaks",
    lines: [
      "The public internet is transit: the shared road everyone uses, crossing several networks.",
      "The slowest path on the board: at least twice ServiceFabric's round trip, with jitter and a little packet loss.",
      "Fine for batch jobs that can wait; slow and jittery for live users.",
    ],
  },
  {
    id: "cross",
    label: "Cross Connect",
    short: "Cross connect",
    kind: "cross",
    simple: true,
    art: "chest",
    hint: "your own cable inside the building",
    lines: [
      "A cross connect is a physical cable between two endpoints in the same Digital Realty building: your racks and a cloud on-ramp, a partner, or a carrier's hand-off.",
      "Nothing to configure and almost no delay, about five business days to install (game), about $500 up front and $400 a month each (estimate).",
      "It cannot leave the building: the legs it can carry are the documents, tools and partners that are already here.",
    ],
  },
  {
    id: "fabric",
    label: "ServiceFabric",
    short: "ServiceFabric",
    kind: "fabric",
    simple: true,
    art: "token",
    hint: "private lane, fast and steady",
    lines: [
      "ServiceFabric is Digital Realty's private, software-defined interconnection to clouds, partners, your other metros and Digital Internet.",
      "Lower delay than peering, less than half the public internet's, almost no jitter and no loss; a connection goes live in minutes once the port exists (15-day port SLA, published).",
      "About $1,200 a month per 10G port plus $400 to $1,500 a month per connection by bandwidth (estimate).",
    ],
  },
  {
    id: "mcp",
    label: "ServiceFabric MCP",
    short: "MCP",
    kind: "mcp",
    simple: true,
    art: "gem",
    hint: "an AI agent configures the fabric",
    lines: [
      "Digital Realty's early-access Model Context Protocol server lets an AI agent see and configure ServiceFabric connections: the same private fabric and the same latency, configured in minutes by intent.",
      "Game effect: agentic routing. The agent re-routes each leg during the run and right-sizes the bandwidth one tier up or down, so you never pay for a fatter link than the peak needs.",
      "MCP configures ServiceFabric, so it needs ServiceFabric in the set: the router treats the pair as one product.",
    ],
  },
  {
    id: "fiber",
    label: "Dark Fiber",
    short: "Dark fiber",
    kind: "fiber",
    simple: true,
    art: "vault",
    hint: "your own glass between sites, 12-week dig",
    lines: [
      "Unlit fibre between your own sites, or to a named partner such as a lab or a plant, that you light with your own optics.",
      "Pure physics delay and no bandwidth cap, but 8 to 16 weeks to light (game: 12), about $60k per route up front plus $40k of optics and $2,500 a month (estimate).",
      "It pays between two or three nearby metros; it never reaches users on the open internet.",
    ],
  },
  {
    id: "ix",
    label: "Peering",
    short: "Peering",
    kind: "peer",
    simple: false,
    art: "user",
    hint: "Internet Exchange: shorter than transit, still shared",
    lines: [
      "Digital Realty's Internet Exchange hands traffic straight to the other network instead of paying a transit ISP to carry it.",
      "Shorter than the public internet but still a shared path: about 1.5× the great circle plus 8 ms at the exchange, 12% jitter and 0.2% loss (game assumption).",
      "An exchange port, its cross connect and the first sessions take about three weeks (game). ServiceFabric is quicker and steadier on every leg.",
    ],
  },
  {
    id: "dinet",
    label: "Digital Internet",
    short: "Digital Internet",
    kind: "fabric",
    simple: false,
    art: "token",
    hint: "internet service on the fabric, 10 Gbps",
    lines: [
      "Digital Realty's internet service delivered over ServiceFabric: 50 Mbps to 10 Gbps, same region only (published).",
      "In the game it is the ServiceFabric path for the legs whose far end is the open internet: the same fabric port, the same minutes-to-live connection.",
      "It carries only internet-bound legs; clouds, partners and your other metros take a ServiceFabric connection.",
    ],
  },
  {
    id: "onramp",
    label: "Cloud on-ramp",
    short: "On-ramp",
    kind: "cross",
    simple: false,
    art: "chest",
    hint: "the cloud's own door in this building",
    lines: [
      "AWS, Azure, Google Cloud, IBM Cloud and Oracle Cloud keep on-ramps in Digital Realty buildings (300+ on-ramps, published).",
      "In the game it is a cross connect to that on-ramp: the retrieval hop floors at in-building latency when the data's region is in this metro.",
      "It carries the documents, tools and data legs only; people never arrive through an on-ramp.",
    ],
  },
  {
    id: "metro",
    label: "Metro Connect",
    short: "Metro Connect",
    kind: "fiber",
    simple: false,
    art: "vault",
    hint: "dedicated link between buildings in one metro",
    lines: [
      "Metro Connect is a dedicated connection between Digital Realty facilities in the same metro area (published).",
      "In the game it is dark-fibre physics with no dig: it carries the inter-site leg when both your sites sit in one metro.",
      "Your sites are in different metros on this board, so it carries no leg until a second site lands in the same metro.",
    ],
  },
  {
    id: "pathway",
    label: "Pathway",
    short: "Pathway",
    kind: "cross",
    simple: false,
    art: "scroll",
    hint: "your own cabling in protected conduit",
    lines: [
      "Pathway products physically protect your own cabling within and between Digital Realty buildings (published).",
      "In the game it is the conduit for your own fibre between two of your halls on one campus: cross-connect physics across the campus.",
      "It carries the inter-site leg only when both sites share a campus; across metros it carries nothing.",
    ],
  },
]

export const PRODUCT_IDS = PRODUCTS.map((product) => product.id)
const SIMPLE_PRODUCTS = PRODUCTS.filter((product) => product.simple).map((product) => product.id)
const NERD_ONLY = { ix: "public", dinet: "fabric", onramp: "cross", metro: "fiber", pathway: "fiber" }

export function productById(id) {
  return byId(PRODUCTS, id)
}

/** The product tiles a board offers: five on the simple board, the full catalogue in nerd mode. */
export function netIds(useCaseId, nerd = false) {
  void useCaseId
  return nerd ? PRODUCT_IDS.slice() : SIMPLE_PRODUCTS.slice()
}

/** A known, de-duplicated product list, or null when the list is empty or not a list. */
export function cleanNet(net) {
  if (!Array.isArray(net)) return null
  const list = [...new Set(net.filter((id) => PRODUCT_IDS.includes(id)))]
  return list.length ? list : null
}

/** The products a legacy `wires` tile stands for (the COMBO tile's legs name the story's own set). */
export function legacyNet(useCaseId, wires, mcp = false, combo = null) {
  if (wires === "cheap") return ["public"]
  if (wires === "peer" || wires === "eye") return ["ix"]
  if (wires === "fast") return mcp ? ["fabric", "mcp"] : ["fabric"]
  if (wires === "private" || wires === "mix") return ["fabric", "cross", "fiber"]
  if (wires === "combo") {
    const kinds = Object.values(combo?.legs || {})
    const list = []
    if (kinds.includes("fabric") || kinds.includes("mcp")) list.push("fabric")
    if (kinds.includes("cross")) list.push("cross")
    if (kinds.includes("fiber")) list.push("fiber")
    if (kinds.includes("mcp")) list.push("mcp")
    return list.length ? list : ["fabric"]
  }
  return ["public"]
}

/** The product set a choice set is on: its own `net`, else what its legacy tile stands for. */
export function netOf(useCaseId, choices = {}, combo = null) {
  return cleanNet(choices.net) || legacyNet(useCaseId, choices.wires || "cheap", Boolean(choices.mcp), combo)
}

/** The legacy tile id that reads closest to a product set, for the sentences that still name one. */
export function legacyWires(net = [], comboLegs = null) {
  const has = (id) => net.includes(id)
  if (comboLegs) {
    const want = legacyNet("", "combo", false, { legs: comboLegs })
    if (want.length === net.length && want.every(has)) return "combo"
  }
  const privateGlass = has("cross") || has("fiber") || has("onramp") || has("metro") || has("pathway")
  const fabric = has("fabric") || has("dinet")
  if (fabric && privateGlass) return "private"
  if (fabric) return "fast"
  if (privateGlass) return "private"
  if (has("ix")) return "peer"
  return "cheap"
}

/** The simple board's version of a product set: every nerd-only product snaps onto the simple one it refines. */
export function simpleNet(net = []) {
  return cleanNet(net.map((id) => NERD_ONLY[id] || id)) || ["public"]
}

/** The set after tapping one product: it toggles; the last product stays. */
export function toggleProduct(net = [], productId) {
  if (!PRODUCT_IDS.includes(productId)) return net.slice()
  if (net.includes(productId)) return net.length > 1 ? net.filter((id) => id !== productId) : net.slice()
  return [...net, productId]
}

/** The one-line hint for a set that needs a partner product, or "". */
export function netHint(net = []) {
  if (net.includes("mcp") && !net.includes("fabric")) return "MCP configures ServiceFabric: add it too."
  return ""
}

/**
 * Whether one product may carry one leg, and as which physics row. `reach` is the model's
 * siteReach; the product rules sit on top of the per-kind rules in js/routes.js.
 */
export function productOnLeg(product, leg, reach) {
  const no = (reason) => ({ ok: false, kind: product.kind, reason })
  if (leg.role === "control") return no("The control leg carries no traffic.")
  if (product.id === "mcp") return no("MCP configures ServiceFabric; it is not a wire of its own.")
  if (product.id === "dinet" && leg.dest !== "internet") return no("Digital Internet reaches the open internet only.")
  if (product.id === "onramp" && !(leg.role === "data" || leg.role === "tools")) return no("An on-ramp carries the data and tools legs only.")
  if (product.id === "metro") {
    if (leg.role !== "inter") return no("Metro Connect joins your own buildings in one metro.")
    if ((reach?.interKm ?? Infinity) > IN_METRO_KM) return no("Your sites are in different metros.")
    return { ok: true, kind: "fiber", reason: "Your two buildings in one metro." }
  }
  if (product.id === "pathway") {
    if (leg.role !== "inter") return no("Pathway carries your own cabling between your halls.")
    if ((reach?.interKm ?? Infinity) > CAMPUS_KM) return no("Your sites are not on one campus.")
    return { ok: true, kind: "cross", reason: "Your own conduit across the campus." }
  }
  if (product.id === "cross" && !(leg.role === "data" || leg.role === "tools" || leg.role === "orca" || (leg.role === "ingress" && leg.dest === "partner"))) {
    return no("People on the open internet or a cloud do not arrive through a cross connect.")
  }
  if (product.id === "fiber" && !(leg.role === "inter" || leg.role === "lab" || (leg.role === "ingress" && leg.dest === "partner"))) {
    return no("Dark fiber runs to your other site or a named partner, not to the open internet or a cloud.")
  }
  const gate = legEligibility(leg, product.kind, reach)
  return { ok: gate.ok, kind: product.kind, reason: gate.reason }
}

/** The legs a story runs with these sites and this QPU choice (the optional control leg included). */
export function activeLegsFor(useCase, sites = [], helper = false) {
  return (useCase?.legs || []).filter((leg) => {
    if (leg.when === "multi") return sites.length > 1
    if (leg.when === "orca") return Boolean(helper && useCase?.orca)
    return true
  })
}

/**
 * The route for a product set: on every leg the eligible product with the best physics (a pinned
 * product first, when it is in the set and eligible), MCP on the control leg and on every
 * ServiceFabric leg when the set has both. Returns the routes the engine reads, which product
 * carries each leg, and the products left unused.
 */
export function routeProducts(useCase, sites, helper, net = [], pins = {}, reach = null) {
  const geometry = reach || siteReach(useCase.id, sites)
  const products = net.map(productById).filter(Boolean)
  const agent = net.includes("mcp") && net.includes("fabric")
  const routes = {}
  const carried = {}
  const used = new Set()
  for (const leg of activeLegsFor(useCase, sites, helper)) {
    if (leg.role === "control") {
      routes[leg.id] = { kind: agent ? "mcp" : "off", fabric: { ...blankFabric(), dest: leg.dest }, backup: null, product: agent ? "mcp" : null }
      if (agent) used.add("mcp")
      continue
    }
    const options = products
      .map((product) => ({ product, gate: productOnLeg(product, leg, geometry) }))
      .filter((option) => option.gate.ok)
      .sort((a, b) => RANK[a.gate.kind] - RANK[b.gate.kind])
    const pinned = pins?.[leg.id] ? options.find((option) => option.product.id === pins[leg.id]) : null
    const choice = pinned || options[0] || null
    let kind = choice ? choice.gate.kind : "public"
    if (kind === "fabric" && agent) kind = "mcp"
    routes[leg.id] = { kind, fabric: { ...blankFabric(), dest: leg.dest }, backup: null, product: choice?.product.id || null }
    carried[leg.id] = choice?.product.id || null
    if (choice) used.add(choice.product.id)
    if (choice && kind === "mcp") used.add("mcp")
  }
  const unused = net.filter((id) => !used.has(id))
  return { routes, carried, unused, agent }
}

/** The name the tables use for a routed leg: the product when known, else the physics row. */
export function productName(productId, kind) {
  return productById(productId)?.label || byId(NETWORKS, kind)?.name || kind
}
