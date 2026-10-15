/**
 * The picture tiles on the game screen, and the builds they stand for.
 * Players never see these ids. The scoring engine does.
 *
 * A choice set is one object: `metros` (Digital Realty metro ids), `brains` (GPU tile),
 * `home` (cooling), `memory` + `hosts` (the KV tier and the CPUs beside it), `wires`
 * (connectivity), `library` (storage), `helper` (ORCA) and `mcp`. The simple board offers
 * three tiles per step; nerd mode offers the full set. Both run through `choicesToBuild`.
 */
import { MISSION_SITES, PLATFORMS, SITES, USE_CASES, byId } from "./data.js"
import { FIBER_MAX_KM, kmBetween } from "./model.js"
import { blankFabric } from "./network.js"
import { routeNetworkId } from "./routes.js"

export const STORIES = {
  chat: { line: "Shoppers want quick answers.", sprite: "iconChat" },
  rag: { line: "Office staff want answers from their files.", sprite: "iconBook" },
  code: { line: "Coders want a helper that keeps up.", sprite: "iconCode" },
  research: { line: "Analysts want long, careful answers.", sprite: "iconOwl" },
  drug: { line: "Scientists want new medicines.", sprite: "iconFlask" },
  robot: { line: "Robot fleets on a factory floor need answers in milliseconds.", sprite: "hero" },
}

/**
 * Platform and rack count. Vera Rubin ×1 is always offered; HUGE is the nerd-only trap.
 * The coding agents' 64k contexts on two coasts need a third NVL72 rack.
 */
const BRAINS = {
  chat: { small: ["h100", 2], medium: ["b300", 6], big: ["gb200", 2], rubin: ["vr", 1], huge: ["vr", 4] },
  rag: { small: ["h200", 2], medium: ["b300", 6], big: ["gb200", 2], rubin: ["vr", 1], huge: ["vr", 4] },
  code: { small: ["h200", 2], medium: ["b300", 6], big: ["gb200", 3], rubin: ["vr", 1], huge: ["vr", 4] },
  research: { small: ["h200", 2], medium: ["b300", 6], big: ["gb200", 2], rubin: ["vr", 1], huge: ["vr", 4] },
  drug: { small: ["h200", 2], medium: ["b300", 4], big: ["gb200", 2], rubin: ["vr", 1], huge: ["vr", 4] },
  robot: { small: ["h100", 1], medium: ["h100", 2], big: ["h200", 2], rubin: ["vr", 1], huge: ["vr", 2] },
}

const LIBRARY = { none: "local", basic: "file", smart: "vector" }

/** Storage the story's expert picks. Every player chooses it on the STORAGE step. */
const AUTO_LIBRARY = { chat: "none", rag: "smart", code: "basic", research: "smart", drug: "basic", robot: "none" }

export function autoLibrary(useCaseId) {
  return AUTO_LIBRARY[useCaseId] || "basic"
}

/** Best legal mixture for each story. MCP sits on the control leg, out of sight. */
const MIX = {
  chat: { all: "fabric", control: "off" },
  rag: { users: "fabric", store: "cross", control: "mcp" },
  code: { users: "fabric", tools: "cross", inter: "fabric", control: "mcp" },
  research: { users: "fabric", data: "cross", control: "mcp" },
  drug: { lab: "fiber", orca: "cross", control: "off" },
  robot: { all: "fabric", control: "off" },
}

/**
 * The COMBO tile: one product per leg, only for the stories where mixing pays in the model.
 * `inter: "fiber"` is dark fiber between the player's metros when they are within fibre reach
 * (FIBER_MAX_KM), ServiceFabric otherwise. A chatbot and a batch screen have no mix to make.
 *
 * Robots: each plant's carrier circuit lands in the Digital Realty building, so the hand-off is
 * a cross connect and the miles beyond it are fibre physics; the model and the other site ride
 * ServiceFabric. Dark fiber between the sites was tried and loses here: 12 weeks of lead and
 * its up-front cost buy no first-token time for a 50 ms robot loop.
 * Coding agents: the repos and tools are on a cloud on-ramp in the building (cross connect),
 * developers arrive over ServiceFabric, an MCP agent configures the control leg, and dark fiber
 * joins the metros where they are close enough.
 * RAG and research: a cross connect to the on-ramp beside the documents, ServiceFabric for the
 * people, MCP on the control leg.
 */
export const COMBO = {
  rag: { legs: { users: "fabric", store: "cross", control: "mcp" }, parts: ["Staff → ServiceFabric", "Documents → Cross connect to the cloud on-ramp", "Control → MCP agent-configured"] },
  code: { legs: { users: "fabric", tools: "cross", inter: "fiber", control: "mcp" }, parts: ["Developers → ServiceFabric", "Repos & tools → Cross connect to the on-ramp", "Sites → Dark fiber when close, else ServiceFabric", "Control → MCP agent-configured"] },
  research: { legs: { users: "fabric", data: "cross", control: "mcp" }, parts: ["Analysts → ServiceFabric", "Papers & weights → Cross connect to the cloud on-ramp", "Control → MCP agent-configured"] },
  robot: { legs: { users: "cross", inter: "fabric", control: "off" }, parts: ["Robots → Cross connect to each plant's carrier", "Sites → ServiceFabric", "Model & data → stay in the hall, no WAN leg"] },
}

export function hasCombo(useCaseId) {
  return Boolean(COMBO[useCaseId])
}

const BRAIN_IDS = ["small", "medium", "big", "rubin"]
const NERD_BRAIN_IDS = ["small", "medium", "big", "rubin", "huge"]
const LIBRARY_IDS = ["none", "basic", "smart"]
const WIRE_IDS = ["cheap", "peer", "fast", "private", "combo"]
const HOME_IDS = ["cool", "rear", "super"]
const NERD_HOME_IDS = ["cool", "row", "rear", "super"]

/** The tiles each step offers on the simple board (three) and in nerd mode (the full set). */
export const SIMPLE_IDS = {
  brains: ["medium", "big", "rubin"],
  home: ["cool", "rear", "super"],
  memory: ["off", "on", "plus"],
  wires: ["cheap", "peer", "fast"],
  library: ["none", "basic", "smart"],
}
export const NERD_IDS = {
  brains: NERD_BRAIN_IDS,
  home: NERD_HOME_IDS,
  memory: ["off", "on", "plus", "dpu"],
  wires: WIRE_IDS,
  library: LIBRARY_IDS,
}

/** The CONNECTIVITY tiles a story offers: COMBO only where mixing pays. */
export function wireIds(useCaseId, nerd = false) {
  const base = nerd ? ["cheap", "peer", "fast", "private"] : SIMPLE_IDS.wires
  return hasCombo(useCaseId) ? [...base, "combo"] : base
}

/** Which metros a story may use, and how many. */
export function maxMetros(useCaseId) {
  return MISSION_SITES[useCaseId]?.max || 1
}

export function cityChoices(useCaseId) {
  return maxMetros(useCaseId) > 1
}

/** Clean metro list: known ids, no repeats, at least the story's home metro, at most its maximum. */
export function cleanMetros(useCaseId, metros) {
  const picked = [...new Set((metros || []).filter((id) => byId(SITES, id)))]
  const list = picked.length ? picked : (MISSION_SITES[useCaseId]?.defaults || ["lon"]).slice(0, 1)
  return list.slice(0, maxMetros(useCaseId))
}

export function defaultChoices(useCaseId) {
  return {
    metros: (MISSION_SITES[useCaseId]?.defaults || ["lon"]).slice(0, 1),
    brains: "medium",
    memory: false,
    library: "none",
    home: "cool",
    wires: "peer",
    mcp: false,
    helper: false,
    hosts: "standard",
  }
}

/** The MEMORY tile a choice set is on: the KV tier, and the hosts beside it. */
export function memoryTile(choices = {}) {
  if (!choices.memory) return "off"
  if (choices.hosts === "grace") return "plus"
  if (choices.hosts === "dpu") return "dpu"
  return "on"
}

/** What one MEMORY tile sets. */
export function memoryChoices(tile = "off") {
  if (tile === "plus") return { memory: true, hosts: "grace" }
  if (tile === "dpu") return { memory: true, hosts: "dpu" }
  if (tile === "on") return { memory: true, hosts: "standard" }
  return { memory: false, hosts: "standard" }
}

/** Snap any choice set onto the simple board: three tiles a step, no MCP, no HUGE. */
export function simpleChoices(useCaseId, choices = {}) {
  const picked = { ...defaultChoices(useCaseId), ...choices }
  const brains = { small: "medium", huge: "big" }[picked.brains] || (SIMPLE_IDS.brains.includes(picked.brains) ? picked.brains : "medium")
  const home = picked.home === "row" ? "rear" : SIMPLE_IDS.home.includes(picked.home) ? picked.home : "cool"
  const wires = wireIds(useCaseId).includes(picked.wires)
    ? picked.wires
    : picked.wires === "private" || picked.wires === "mix" || picked.wires === "combo" ? (hasCombo(useCaseId) ? "combo" : "fast") : "peer"
  const memory = memoryTile(picked) === "dpu" ? "plus" : memoryTile(picked)
  const library = SIMPLE_IDS.library.includes(picked.library) ? picked.library : "none"
  const { sitePlans, ...rest } = picked
  return {
    ...rest,
    metros: cleanMetros(useCaseId, picked.metros),
    brains,
    home,
    wires,
    library,
    ...memoryChoices(memory),
    mcp: false,
    helper: Boolean(picked.helper && byId(USE_CASES, useCaseId)?.orca),
  }
}

/** The nerd board keeps every simple pick as it is: the wires tiles mean the same thing in both modes. */
export function nerdChoices(useCaseId, choices) {
  const next = { ...defaultChoices(useCaseId), ...choices }
  next.metros = cleanMetros(useCaseId, next.metros)
  return next
}

/**
 * The expert picture for each story. It differs by story on purpose: the metros near the
 * people or the data, the right rack, the hall that fits the power room, the right road,
 * and the memory or data the workload actually reuses.
 */
const EXPERTS = {
  chat: { metros: ["lon", "fra"], brains: "big", memory: true, hosts: "standard", home: "super", wires: "fast", library: "none" },
  rag: { metros: ["fra"], brains: "medium", memory: true, hosts: "standard", home: "rear", wires: "combo", library: "smart" },
  code: { metros: ["iad", "sjc"], brains: "big", memory: true, hosts: "grace", home: "super", wires: "combo", library: "basic" },
  research: { metros: ["par"], brains: "big", memory: true, hosts: "standard", home: "super", wires: "combo", library: "smart" },
  drug: { metros: ["lon"], brains: "medium", memory: false, hosts: "standard", home: "rear", wires: "private", library: "basic", helper: true },
  robot: { metros: ["fra", "ams"], brains: "big", memory: true, hosts: "standard", home: "rear", wires: "combo", library: "none" },
}

export function expertChoices(useCaseId) {
  const useCase = byId(USE_CASES, useCaseId)
  const expert = EXPERTS[useCaseId] || EXPERTS.chat
  return { ...defaultChoices(useCaseId), ...expert, mcp: false, helper: Boolean(useCase?.orca && expert.helper) }
}

/**
 * Each connection tile is a real-world choice. Behind it, every leg gets the sensible product:
 * peering puts users on eyeball ISPs, cross connect + dark fiber lights your own glass between
 * your sites and to partners in the building, and users still arrive over ServiceFabric.
 */
function assignRoutes(useCase, sites, helper, wires, mcp = false) {
  const control = mcp ? "mcp" : "off"
  // Eyeball networks are where consumers live. A factory, lab or company cloud is reached through an exchange.
  const consumers = useCase.legs.some((leg) => leg.role === "ingress" && leg.dest === "internet")
  const combo = COMBO[useCase.id]?.legs
  const assign = wires === "cheap"
    ? { all: "public", control: "off" }
    : wires === "peer"
      ? { all: "peer", ...(consumers ? { users: "eye" } : {}), control: "off" }
      : wires === "eye"
        ? { all: "eye", control: "off" }
        : wires === "mix"
          ? MIX[useCase.id]
          : wires === "combo" && combo
            ? combo
            : { all: "fabric", control }
  const places = sites.map((id) => byId(SITES, id)).filter(Boolean)
  const regional = places.every((a) => places.every((b) => kmBetween(a, b) <= FIBER_MAX_KM))
  const routes = {}
  for (const leg of useCase.legs) {
    if (leg.when === "multi" && sites.length < 2) continue
    if (leg.when === "orca" && !helper) continue
    let kind = assign[leg.id] ?? assign.all ?? (leg.when === "optional" ? "off" : "fabric")
    if (wires === "private") {
      if (leg.role === "data" || leg.role === "tools" || leg.role === "orca") kind = "cross"
      else if (leg.role === "inter") kind = regional ? "fiber" : "fabric"
      else if (leg.role === "lab") kind = "fiber"
      else if (leg.when === "optional") kind = control
      else kind = "fabric"
    }
    if (kind === "fiber" && leg.role === "inter" && !regional) kind = "fabric"
    if (leg.role === "orca" && (wires === "cheap" || wires === "peer" || wires === "eye")) kind = "cross"
    routes[leg.id] = { kind, fabric: { ...blankFabric(), dest: leg.dest }, backup: null }
  }
  return routes
}

/** True when a choice set's COMBO puts an MCP agent on the control leg. */
export function comboMcp(useCaseId, wires) {
  return wires === "combo" && COMBO[useCaseId]?.legs.control === "mcp"
}

/** The computers behind one BRAINS tile. */
export function brainPick(useCaseId, brains) {
  const picked = BRAINS[useCaseId]?.[brains] || BRAINS.chat.medium
  return { platform: picked[0], racks: picked[1] }
}

/**
 * Turn picture choices into a build the scoring engine understands.
 * The simple board (nerd off) snaps every step onto its three tiles, never uses MCP, and
 * with ServiceFabric puts the documents or tools leg on an in-building cross connect.
 */
export function choicesToBuild(useCaseId, choices, nerd = false) {
  const useCase = byId(USE_CASES, useCaseId)
  const picked = nerd ? { ...defaultChoices(useCaseId), ...choices } : simpleChoices(useCaseId, choices)
  const [platform, racks] = BRAINS[useCaseId][picked.brains] || BRAINS[useCaseId].big
  const sites = cleanMetros(useCaseId, picked.metros)
  const helper = Boolean(useCase?.orca && picked.helper)
  const routes = assignRoutes(useCase, sites, helper, picked.wires, Boolean(picked.mcp))
  const build = {
    hall: { cool: "A", rear: "R", row: "I", super: "B" }[picked.home] || "A",
    hosts: picked.hosts || "standard",
    platform,
    racks,
    data: LIBRARY[picked.library] || "local",
    kv: Boolean(picked.memory),
    orca: helper,
    graphs: "large",
    network: routeNetworkId(routes),
    fabric: { ...blankFabric(), dest: useCase?.netDest?.user || "internet" },
    routes,
    bwTier: picked.wires === "fast" || picked.wires === "private" || picked.wires === "combo" ? 1 : 0,
    fabricRedundant: ["mix", "private", "fast", "combo"].includes(picked.wires),
    sites,
    choices: picked,
  }
  if (nerd && sites.length > 1 && Array.isArray(picked.sitePlans) && picked.sitePlans.length) {
    build.sitePlans = picked.sitePlans.map((plan) => ({
      id: plan.id,
      role: plan.role,
      powerMW: Number(plan.powerMW) || 0,
    }))
  }
  return build
}

/** Every non-empty metro set a story may pick from its short list, up to its maximum. */
export function metroSets(useCaseId, ids) {
  const max = maxMetros(useCaseId)
  const out = []
  const walk = (start, acc) => {
    if (acc.length) out.push(acc.slice())
    if (acc.length >= max) return
    for (let i = start; i < ids.length; i += 1) walk(i + 1, [...acc, ids[i]])
  }
  walk(0, [])
  return out
}

/** Every nerd picture combination for one story, on the expert's metros. Small enough to score all of them. */
export function allPresets(useCaseId) {
  const useCase = byId(USE_CASES, useCaseId)
  const expert = expertChoices(useCaseId)
  const helpers = useCase?.orca ? [false, true] : [false]
  const library = autoLibrary(useCaseId)
  const metroLists = cityChoices(useCaseId) ? [expert.metros.slice(0, 1), expert.metros] : [expert.metros]
  const list = []
  for (const brains of BRAIN_IDS) {
    for (const memory of [false, true]) {
      for (const hosts of memory ? ["standard", "grace"] : ["standard"]) {
        for (const home of HOME_IDS) {
          for (const metros of metroLists) {
            for (const wires of wireIds(useCaseId, true)) {
              for (const helper of helpers) {
                list.push({ metros, brains, memory, hosts, library, home, wires, helper })
              }
            }
          }
        }
      }
    }
  }
  return list
}

export const PRESET_IDS = { brains: BRAIN_IDS, nerdBrains: NERD_BRAIN_IDS, library: LIBRARY_IDS, wires: WIRE_IDS, homes: HOME_IDS, nerdHomes: NERD_HOME_IDS }
