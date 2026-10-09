import { DATA_TIERS, HALLS, MISSION_SITES, PLATFORMS, USE_CASES, byId } from "./data.js"
import { evaluateBuild } from "./model.js"
import { blankFabric } from "./network.js"
import { routeNetworkId } from "./routes.js"

const RACKS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16]

/** Site sets the search tries. Multi-site use cases get one-, two-, and three-metro options. */
export const SITE_SETS = {
  chat: [["lon"], ["iad"], ["lon", "fra"], ["lon", "iad"], ["lon", "iad", "sjc"]],
  code: [["iad"], ["sjc"], ["iad", "chi"], ["iad", "sjc"], ["iad", "chi", "sjc"]],
}

function assignRoutes(useCase, build, assign) {
  const routes = {}
  for (const leg of useCase.legs) {
    if (leg.when === "multi" && build.sites.length < 2) continue
    if (leg.when === "orca" && !build.orca) continue
    const kind = assign[leg.id] ?? assign.all ?? (leg.when === "optional" ? "off" : "fabric")
    routes[leg.id] = { kind, fabric: { ...blankFabric(), dest: leg.dest }, backup: assign.backup?.[leg.id] || null }
  }
  return routes
}

/** Single-product plans plus the legal mixtures a thoughtful player would try. */
export function networkOptions(useCaseId, build) {
  const useCase = byId(USE_CASES, useCaseId)
  const plans = [{ all: "public", control: "off" }, { all: "fabric", control: "off" }, { all: "mcp", control: "mcp" }]
  if (useCaseId === "rag" || useCaseId === "research") plans.push({ users: "fabric", store: "cross", data: "cross", control: "mcp" })
  if (useCaseId === "code") plans.push({ users: "fabric", tools: "cross", inter: "fabric", control: "mcp" }, { users: "fabric", tools: "fabric", inter: "fiber", control: "mcp" })
  if (useCaseId === "chat") plans.push({ users: "fabric", inter: "fiber", control: "off" }, { users: "fabric", inter: "fabric", control: "mcp" })
  if (useCaseId === "drug") plans.push({ lab: "fabric", orca: "cross", control: "off" }, { lab: "fiber", orca: "cross", control: "off" }, { lab: "public", orca: "cross", control: "off" })
  const options = []
  for (const assign of plans) {
    for (const bwTier of [0, 1]) {
      for (const fabricRedundant of [false, true]) {
        const routes = assignRoutes(useCase, build, assign)
        options.push({ routes, network: routeNetworkId(routes), bwTier, fabricRedundant })
      }
    }
  }
  return options
}

/** Every build the search tries for one use case, scored and sorted best first. */
export function searchBuilds(useCaseId) {
  const useCase = byId(USE_CASES, useCaseId)
  const siteSets = SITE_SETS[useCaseId] || [MISSION_SITES[useCaseId]?.defaults?.slice(0, 1) || ["lon"]]
  const list = []
  for (const hall of HALLS) {
    for (const platform of PLATFORMS) {
      for (const racks of RACKS) {
        if (racks > platform.supply) continue
        for (const data of DATA_TIERS) {
          for (const kv of [false, true]) {
            for (const orca of useCase.orca ? [false, true] : [false]) {
              for (const sites of siteSets) {
                if (racks < sites.length) continue
                const base = { hall: hall.id, platform: platform.id, racks, data: data.id, kv, orca, graphs: "large", sites }
                for (const net of networkOptions(useCaseId, base)) {
                  const build = { ...base, ...net }
                  const result = evaluateBuild(useCaseId, build)
                  list.push({ build, result })
                }
              }
            }
          }
        }
      }
    }
  }
  return list.sort((a, b) => b.result.score - a.result.score)
}

/** Coarse strategy: hall, GPU, metro count, storage, and the mix of products. MCP counts as fabric. */
export function strategyKey(build) {
  const kinds = Object.values(build.routes || {})
    .map((route) => (route.kind === "mcp" ? "fabric" : route.kind))
    .filter((kind) => kind && kind !== "off")
    .sort()
  const family = kinds.length ? [...new Set(kinds)].join("+") : (build.network === "mcp" ? "fabric" : build.network)
  return `${build.hall}/${build.platform}/${build.sites.length}site/${build.data}${build.orca ? "/orca" : ""}/${family}`
}

/** Distinct strategies within `band` of the best score. */
export function nearStrategies(list, band = 0.1) {
  if (!list.length) return []
  const floor = list[0].result.score * (1 - band)
  const seen = new Map()
  for (const item of list) {
    if (item.result.score < floor) break
    const key = strategyKey(item.build)
    if (!seen.has(key)) seen.set(key, item)
  }
  return [...seen.values()]
}

/** The naive build: the newest GPU at full supply, every extra, everything on ServiceFabric MCP. */
export function maxedBuild(useCaseId) {
  const useCase = byId(USE_CASES, useCaseId)
  const vr = byId(PLATFORMS, "vr")
  const sites = (SITE_SETS[useCaseId] || [["lon"]]).at(-1)
  const base = { hall: "B", platform: vr.id, racks: vr.supply, data: "vector", kv: true, orca: Boolean(useCase.orca), graphs: "large", sites }
  const routes = assignRoutes(useCase, base, { all: "mcp" })
  return { ...base, routes, network: routeNetworkId(routes), bwTier: 1, fabricRedundant: true }
}

/** A typical first try: two GB200 racks in the liquid hall, shared storage, all ServiceFabric. */
export function typicalBuild(useCaseId) {
  const useCase = byId(USE_CASES, useCaseId)
  const base = { hall: "B", platform: "gb200", racks: 2, data: useCase.data === "none" ? "local" : "file", kv: false, orca: false, graphs: "large", sites: (SITE_SETS[useCaseId] || [["lon"]])[0] }
  const routes = assignRoutes(useCase, base, { all: "fabric", control: "off" })
  return { ...base, routes, network: routeNetworkId(routes), bwTier: 0, fabricRedundant: false }
}
