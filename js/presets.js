/**
 * The picture tiles on the game screen, and the builds they stand for.
 * Players never see these ids. The scoring engine does.
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

/** Platform and rack count. Vera Rubin ×1 is always offered; HUGE is the nerd-only trap. */
const BRAINS = {
  chat: { small: ["h100", 2], medium: ["b300", 6], big: ["gb200", 2], rubin: ["vr", 1], huge: ["vr", 4] },
  rag: { small: ["h200", 2], medium: ["b300", 6], big: ["gb200", 2], rubin: ["vr", 1], huge: ["vr", 4] },
  code: { small: ["h200", 2], medium: ["b300", 6], big: ["gb200", 2], rubin: ["vr", 1], huge: ["vr", 4] },
  research: { small: ["h200", 2], medium: ["b300", 6], big: ["gb200", 2], rubin: ["vr", 1], huge: ["vr", 4] },
  drug: { small: ["h200", 2], medium: ["b300", 4], big: ["gb200", 2], rubin: ["vr", 1], huge: ["vr", 4] },
  robot: { small: ["h100", 1], medium: ["h100", 2], big: ["h200", 2], rubin: ["vr", 1], huge: ["vr", 2] },
}

const LIBRARY = { none: "local", basic: "file", smart: "vector" }

/** Storage the simple view picks for each story. Nerd mode can change it. */
const AUTO_LIBRARY = { chat: "none", rag: "smart", code: "basic", research: "smart", drug: "basic", robot: "none" }

export function autoLibrary(useCaseId) {
  return AUTO_LIBRARY[useCaseId] || "basic"
}

const CITIES = {
  chat: [["lon"], ["lon", "fra"], ["lon", "fra", "ams"]],
  code: [["iad"], ["iad", "sjc"], ["iad", "chi", "sjc"]],
  robot: [["fra"], ["fra", "ams"]],
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

/** Picture-board tiles. Nerd mode adds HUGE, more halls, storage, hosts and the MCP toggle. */
const BRAIN_IDS = ["small", "medium", "big", "rubin"]
const NERD_BRAIN_IDS = ["small", "medium", "big", "rubin", "huge"]
const LIBRARY_IDS = ["none", "basic", "smart"]
const WIRE_IDS = ["cheap", "peer", "fast", "private"]
const HOME_IDS = ["cool", "super"]
const NERD_HOME_IDS = ["cool", "row", "rear", "super"]

/**
 * The simple board: three decisions, three tiles each. Everything else is a hidden default
 * for the story. The third DATA HALL tile adds a second metro where closeness matters, and
 * the KV memory tier for the one-site stories.
 */
export const SIMPLE_IDS = { brains: ["medium", "big", "rubin"], halls: ["cool", "super", "plus"], wires: ["cheap", "peer", "fast"] }

/** Hidden KV memory default: on where people keep the conversation going (reuse at least half). */
const SIMPLE_MEMORY = { chat: true, rag: false, code: true, research: false, drug: false, robot: true }

/**
 * The hall behind the third tile. Liquid by default; Robotics runs air-cooled Hopper racks,
 * so its two metros are air halls, like the nerd expert picture (a liquid hall would just cost more).
 */
const PLUS_HOME = { robot: "cool" }

export function plusHome(useCaseId) {
  return PLUS_HOME[useCaseId] || "super"
}

export function defaultChoices(useCaseId) {
  return {
    brains: "medium",
    memory: useCaseId === "code",
    library: autoLibrary(useCaseId),
    home: "cool",
    cities: 1,
    wires: "fast",
    mcp: false,
    helper: false,
    hosts: "standard",
  }
}

export function simpleMemory(useCaseId) {
  return Boolean(SIMPLE_MEMORY[useCaseId])
}

/** What the third hall tile adds for this story. */
export function simplePlus(useCaseId) {
  return cityChoices(useCaseId) ? "metros" : "memory"
}

/** Which simple hall tile a full choice set lands on. */
export function simpleHall(useCaseId, choices = {}) {
  const home = choices.home === "super" ? "super" : "cool"
  if (simplePlus(useCaseId) === "metros") return home === plusHome(useCaseId) && (choices.cities || 1) >= 2 ? "plus" : home
  if (home !== "super") return "cool"
  return choices.memory && !simpleMemory(useCaseId) ? "plus" : "super"
}

/** Full choices for one simple tile set, hidden defaults included. */
export function simpleToChoices(useCaseId, { brains = "medium", hall = "cool", wires = "peer" } = {}) {
  const useCase = byId(USE_CASES, useCaseId)
  const plus = simplePlus(useCaseId)
  return {
    ...defaultChoices(useCaseId),
    brains: SIMPLE_IDS.brains.includes(brains) ? brains : "medium",
    memory: simpleMemory(useCaseId) || (hall === "plus" && plus === "memory"),
    home: hall === "cool" ? "cool" : hall === "plus" ? plusHome(useCaseId) : "super",
    cities: hall === "plus" && plus === "metros" ? 2 : 1,
    wires: SIMPLE_IDS.wires.includes(wires) ? wires : "peer",
    helper: Boolean(useCase?.orca),
  }
}

/** The simple board's opening picture: the middle GPU, the air hall, peering. */
export function simpleDefaults(useCaseId) {
  return simpleToChoices(useCaseId, { brains: "medium", hall: "cool", wires: "peer" })
}

/** The simple tile set a full choice set shows. */
export function simplePicks(useCaseId, choices = {}) {
  const brains = { small: "medium", huge: "big" }[choices.brains] || (SIMPLE_IDS.brains.includes(choices.brains) ? choices.brains : "medium")
  const wires = choices.wires === "private" ? "fast" : SIMPLE_IDS.wires.includes(choices.wires) ? choices.wires : "peer"
  return { brains, hall: simpleHall(useCaseId, choices), wires }
}

const SIMPLE_WIRES = {
  cheap: { label: "Public internet", hint: "cheap, busy, slow at peaks" },
  peer: { label: "Peering + eyeballs", hint: "straight into home networks" },
  fast: { label: "ServiceFabric", hint: "private lane, fast and steady" },
}

/** Five words that tell a newcomer what each rack is good at. */
const SIMPLE_GPU_HINTS = {
  h100: "the classic, runs on air",
  h200: "more memory, runs on air",
  b200: "FP4 maths, runs on air",
  b300: "strongest rack on air",
  gb200: "72 GPUs as one, liquid",
  gb300: "reasoning rack, liquid only",
  vr: "next gen, liquid, arrives late",
}

/** One simple hall tile: label, five-word hint and the phrase the coach uses to suggest it. */
export function simpleHallTile(useCaseId, hall) {
  if (hall === "cool") {
    return { id: hall, label: "Air-cooled hall", hint: "fans, ready now, cheaper", phrase: "Switching to the air-cooled hall", inWords: "in an air-cooled hall" }
  }
  if (hall === "super") {
    return { id: hall, label: "Liquid-cooled hall", hint: "water to the chip, faster", phrase: "Switching to the liquid-cooled hall", inWords: "in a liquid-cooled hall" }
  }
  if (simplePlus(useCaseId) === "metros") {
    const names = citySites(useCaseId, 2).map((id) => byId(SITES, id)?.metro || id)
    const cooled = plusHome(useCaseId) === "cool" ? "air-cooled" : "liquid-cooled"
    return {
      id: hall,
      label: `${cooled.charAt(0).toUpperCase()}${cooled.slice(1)} in 2 metros`,
      hint: `${names.join(" + ")}, closer to people`,
      phrase: `Adding a second ${cooled} hall in ${names[1] || "a second metro"}`,
      inWords: `in ${cooled} halls in ${names.join(" and ")}`,
    }
  }
  return {
    id: hall,
    label: "Liquid-cooled + KV memory",
    hint: "water to the chip, remembers chats",
    phrase: "Switching to the liquid-cooled hall with KV memory",
    inWords: "in a liquid-cooled hall with KV memory",
  }
}

/** The whole simple board for one story: three decisions, three real tiles each. */
export function simpleTiles(useCaseId) {
  return {
    brains: SIMPLE_IDS.brains.map((id) => {
      const pick = brainPick(useCaseId, id)
      const platform = byId(PLATFORMS, pick.platform)
      return { id, label: `${platform?.name || pick.platform} ×${pick.racks}`, hint: SIMPLE_GPU_HINTS[pick.platform] || "", platform, racks: pick.racks }
    }),
    halls: SIMPLE_IDS.halls.map((id) => simpleHallTile(useCaseId, id)),
    wires: SIMPLE_IDS.wires.map((id) => ({ id, ...SIMPLE_WIRES[id] })),
  }
}

/** Every simple-board combination for one story: 27 pictures. */
export function allSimple(useCaseId) {
  const list = []
  for (const brains of SIMPLE_IDS.brains) {
    for (const hall of SIMPLE_IDS.halls) {
      for (const wires of SIMPLE_IDS.wires) list.push({ brains, hall, wires })
    }
  }
  return list
}

/** Stories whose documents or tools sit beside the GPUs in the same building. */
const IN_BUILDING = new Set(["rag", "research", "code"])

/**
 * Nerd tile that reproduces a simple pick exactly. The simple ServiceFabric tile also puts
 * the documents or tools leg on an in-building cross connect, which the nerd board calls
 * "Cross connect + Dark fiber" for those stories.
 */
export function nerdChoices(useCaseId, choices) {
  const next = { ...choices }
  if (next.wires === "fast" && IN_BUILDING.has(useCaseId)) next.wires = "private"
  return next
}

/** The expert picture: big brains, memory, a liquid hall, the metros near people, the right road. */
export function expertChoices(useCaseId) {
  const useCase = byId(USE_CASES, useCaseId)
  return {
    brains: "big",
    memory: true,
    library: autoLibrary(useCaseId),
    home: useCaseId === "robot" ? "cool" : "super",
    cities: ["chat", "code", "robot"].includes(useCaseId) ? 2 : 1,
    wires: EXPERT_WIRES[useCaseId] || "fast",
    mcp: false,
    helper: Boolean(useCase?.orca),
    hosts: "standard",
  }
}

const EXPERT_WIRES = { chat: "fast", rag: "private", code: "private", research: "private", drug: "private", robot: "fast" }

/** Snap any choice set onto the simple board, hidden defaults and all. */
export function simpleChoices(useCaseId, choices) {
  return simpleToChoices(useCaseId, simplePicks(useCaseId, choices))
}

export function cityChoices(useCaseId) {
  return (MISSION_SITES[useCaseId]?.max || 1) > 1
}

function sitesFor(useCaseId, cities) {
  const sets = CITIES[useCaseId]
  if (!sets) return [(MISSION_SITES[useCaseId]?.defaults || ["lon"])[0]]
  return sets[Math.max(0, Math.min(sets.length, cities) - 1)].slice()
}

/**
 * Each connection tile is a real-world choice. Behind it, every leg gets the sensible product:
 * peering puts users on eyeball ISPs, cross connect + dark fiber lights your own glass between
 * your sites and to partners in the building, and users still arrive over ServiceFabric.
 */
function assignRoutes(useCase, sites, helper, wires, mcp = false, { inBuilding = false } = {}) {
  const control = mcp ? "mcp" : "off"
  const assign = wires === "cheap"
    ? { all: "public", control: "off" }
    : wires === "peer"
      ? { all: "peer", users: "eye", control: "off" }
      : wires === "eye"
        ? { all: "eye", control: "off" }
        : wires === "mix"
          ? MIX[useCase.id]
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
    if (leg.role === "orca" && (wires === "cheap" || wires === "peer" || wires === "eye")) kind = "cross"
    if (inBuilding && wires === "fast" && (leg.role === "data" || leg.role === "tools")) kind = "cross"
    routes[leg.id] = { kind, fabric: { ...blankFabric(), dest: leg.dest }, backup: null }
  }
  return routes
}

/** The computers behind one BRAINS tile. */
export function brainPick(useCaseId, brains) {
  const picked = BRAINS[useCaseId]?.[brains] || BRAINS.chat.medium
  return { platform: picked[0], racks: picked[1] }
}

/** Metro ids for a cities tile. */
export function citySites(useCaseId, cities) {
  return sitesFor(useCaseId, cities)
}

/**
 * Turn picture choices into a build the scoring engine understands.
 * The simple board (nerd off) applies its hidden defaults: storage picked for the story,
 * standard hosts, no MCP, ORCA included for drug discovery, and with ServiceFabric the
 * documents or tools leg rides an in-building cross connect.
 */
export function choicesToBuild(useCaseId, choices, nerd = false) {
  const useCase = byId(USE_CASES, useCaseId)
  const picked = { ...defaultChoices(useCaseId), ...choices }
  if (!nerd) Object.assign(picked, { library: autoLibrary(useCaseId), hosts: "standard", mcp: false, helper: Boolean(useCase?.orca) })
  const [platform, racks] = BRAINS[useCaseId][picked.brains] || BRAINS[useCaseId].big
  const sites = sitesFor(useCaseId, cityChoices(useCaseId) ? picked.cities : 1)
  const helper = Boolean(useCase?.orca && picked.helper)
  const routes = assignRoutes(useCase, sites, helper, picked.wires, Boolean(picked.mcp), { inBuilding: !nerd })
  const build = {
    hall: { cool: "A", rear: "R", row: "I", super: "B" }[picked.home] || "A",
    hosts: picked.hosts || "standard",
    platform,
    racks,
    data: LIBRARY[picked.library],
    kv: Boolean(picked.memory),
    orca: helper,
    graphs: "large",
    network: routeNetworkId(routes),
    fabric: { ...blankFabric(), dest: useCase?.netDest?.user || "internet" },
    routes,
    bwTier: picked.wires === "fast" || picked.wires === "private" ? 1 : 0,
    fabricRedundant: ["mix", "private", "fast"].includes(picked.wires),
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

/** Every simple-view picture combination for one story. Small enough to score all of them. */
export function allPresets(useCaseId) {
  const useCase = byId(USE_CASES, useCaseId)
  const maxCities = MISSION_SITES[useCaseId]?.max || 1
  const cities = cityChoices(useCaseId) ? Array.from({ length: maxCities }, (_, i) => i + 1) : [1]
  const helpers = useCase?.orca ? [false, true] : [false]
  const library = autoLibrary(useCaseId)
  const list = []
  for (const brains of BRAIN_IDS) {
    for (const memory of [false, true]) {
      for (const home of HOME_IDS) {
        for (const city of cities) {
          for (const wires of WIRE_IDS) {
            for (const helper of helpers) {
              list.push({ brains, memory, library, home, cities: city, wires, helper })
            }
          }
        }
      }
    }
  }
  return list
}

export const PRESET_IDS = { brains: BRAIN_IDS, nerdBrains: NERD_BRAIN_IDS, library: LIBRARY_IDS, wires: WIRE_IDS, homes: HOME_IDS, nerdHomes: NERD_HOME_IDS }
