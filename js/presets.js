/**
 * The picture tiles on the game screen, and the builds they stand for.
 * Players never see these ids. The scoring engine does.
 */
import { MISSION_SITES, USE_CASES, byId } from "./data.js"
import { blankFabric } from "./network.js"
import { routeNetworkId } from "./routes.js"

export const STORIES = {
  chat: { line: "Shoppers want quick answers.", sprite: "iconChat" },
  rag: { line: "Office staff want answers from their files.", sprite: "iconBook" },
  code: { line: "Coders want a helper that keeps up.", sprite: "iconCode" },
  research: { line: "Analysts want long, careful answers.", sprite: "iconOwl" },
  drug: { line: "Scientists want new medicines.", sprite: "iconFlask" },
}

/** Platform and rack count. HUGE is the trap. */
const BRAINS = {
  chat: { small: ["h100", 2], medium: ["b300", 6], big: ["gb200", 2], huge: ["vr", 4] },
  rag: { small: ["h200", 2], medium: ["b300", 6], big: ["gb200", 2], huge: ["vr", 4] },
  code: { small: ["h200", 2], medium: ["b300", 6], big: ["gb200", 2], huge: ["vr", 4] },
  research: { small: ["h200", 2], medium: ["b300", 6], big: ["gb200", 2], huge: ["vr", 4] },
  drug: { small: ["h200", 2], medium: ["b300", 4], big: ["gb200", 2], huge: ["vr", 4] },
}

const LIBRARY = { none: "local", basic: "file", smart: "vector" }

const CITIES = {
  chat: [["lon"], ["lon", "iad"], ["lon", "iad", "sjc"]],
  code: [["iad"], ["iad", "sjc"], ["iad", "chi", "sjc"]],
}

/** Best legal mixture for each story. MCP sits on the control leg, out of sight. */
const MIX = {
  chat: { all: "fabric", control: "off" },
  rag: { users: "fabric", store: "cross", control: "mcp" },
  code: { users: "fabric", tools: "cross", inter: "fabric", control: "mcp" },
  research: { users: "fabric", data: "cross", control: "mcp" },
  drug: { lab: "fiber", orca: "cross", control: "off" },
}

const BRAIN_IDS = ["small", "medium", "big", "huge"]
const LIBRARY_IDS = ["none", "basic", "smart"]
const WIRE_IDS = ["cheap", "fast", "private", "mix"]

export function defaultChoices(useCaseId) {
  return {
    brains: "medium",
    memory: useCaseId === "code",
    library: byId(USE_CASES, useCaseId)?.data === "none" ? "none" : "basic",
    home: "cool",
    cities: 1,
    wires: "fast",
    helper: false,
  }
}

/** The expert picture: big brains, memory, the useful library, a super-cool hall, mixed wires. */
export function expertChoices(useCaseId) {
  const useCase = byId(USE_CASES, useCaseId)
  return {
    brains: "big",
    memory: true,
    library: useCase?.data === "none" ? "none" : "basic",
    home: "super",
    cities: 1,
    wires: "mix",
    helper: Boolean(useCase?.orca),
  }
}

export function cityChoices(useCaseId) {
  return (MISSION_SITES[useCaseId]?.max || 1) > 1
}

function sitesFor(useCaseId, cities) {
  const sets = CITIES[useCaseId]
  if (!sets) return [(MISSION_SITES[useCaseId]?.defaults || ["lon"])[0]]
  return sets[Math.max(0, Math.min(sets.length, cities) - 1)].slice()
}

function assignRoutes(useCase, sites, helper, wires) {
  const assign = wires === "cheap"
    ? { all: "public", control: "off" }
    : wires === "fast"
      ? { all: "fabric", control: "off" }
      : wires === "mix"
        ? MIX[useCase.id]
        : { all: "fabric", control: "off" }
  const routes = {}
  for (const leg of useCase.legs) {
    if (leg.when === "multi" && sites.length < 2) continue
    if (leg.when === "orca" && !helper) continue
    let kind = assign[leg.id] ?? assign.all ?? (leg.when === "optional" ? "off" : "fabric")
    if (wires === "private") {
      if (leg.role === "data" || leg.role === "tools" || leg.role === "orca") kind = "cross"
      else if (leg.role === "inter") kind = "fiber"
      else if (leg.when === "optional") kind = "off"
      else kind = "fabric"
    }
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

/** Turn picture choices into a build the scoring engine understands. */
export function choicesToBuild(useCaseId, choices) {
  const useCase = byId(USE_CASES, useCaseId)
  const picked = { ...defaultChoices(useCaseId), ...choices }
  const [platform, racks] = BRAINS[useCaseId][picked.brains]
  const sites = sitesFor(useCaseId, cityChoices(useCaseId) ? picked.cities : 1)
  const helper = Boolean(useCase?.orca && picked.helper)
  const routes = assignRoutes(useCase, sites, helper, picked.wires)
  return {
    hall: picked.home === "super" ? "B" : "A",
    platform,
    racks,
    data: LIBRARY[picked.library],
    kv: Boolean(picked.memory),
    orca: helper,
    graphs: "large",
    network: routeNetworkId(routes),
    fabric: { ...blankFabric(), dest: useCase?.netDest?.user || "internet" },
    routes,
    bwTier: picked.wires === "mix" ? 0 : 0,
    fabricRedundant: picked.wires === "mix" || picked.wires === "private",
    sites,
    choices: picked,
  }
}

/** Every picture combination for one story. Small enough to score all of them. */
export function allPresets(useCaseId) {
  const useCase = byId(USE_CASES, useCaseId)
  const cities = cityChoices(useCaseId) ? [1, 2, 3] : [1]
  const helpers = useCase?.orca ? [false, true] : [false]
  const list = []
  for (const brains of BRAIN_IDS) {
    for (const memory of [false, true]) {
      for (const library of LIBRARY_IDS) {
        for (const home of ["cool", "super"]) {
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
  }
  return list
}

export const PRESET_IDS = { brains: BRAIN_IDS, library: LIBRARY_IDS, wires: WIRE_IDS }
