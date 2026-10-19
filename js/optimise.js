/**
 * OPTIMISE ROUTING: one click finds the best connectivity for the player's metros and the rest of
 * the board. It scores every per-leg assignment of the products the board offers (and the MCP
 * agent on or off) with `evaluateBuild`, keeps the ones the scenario budget pays for, and applies
 * the highest score (ties go to the cheaper build). The result is the optimum the CONNECTIONS
 * light measures against (`choices.routed`), so the light is green by construction afterwards.
 */
import { USE_CASES, byId } from "./data.js"
import { evaluateBuild, formatMoney, formatSeconds, siteReach } from "./model.js"
import { PRODUCTS, activeLegsFor, legacyWires, netOf, productName, productOnLeg, routeProducts } from "./netplan.js"
import { LEAD_DAYS } from "./network.js"
import { COMBO, choicesToBuild, cleanMetros } from "./presets.js"

const WORDS = { cross: "in-building", fiber: "your own glass", fabric: "private", mcp: "private, agent-configured", eye: "shared edge", peer: "shared", public: "open internet" }

/** The key the CONNECTIONS light compares: the optimum holds for one story on one metro set. */
export function routeKey(useCaseId, metros = []) {
  return `${useCaseId}|${cleanMetros(useCaseId, metros).slice().sort().join("+")}`
}

/** Short words for a leg: "Users", "Documents", "Sites", "Lab", "ORCA". */
export function legWord(leg) {
  if (leg.role === "ingress") return leg.dest === "partner" && leg.id === "users" && /FACTORY/i.test(leg.name) ? "Robots" : "Users"
  if (leg.role === "inter") return "Sites"
  if (leg.role === "lab") return "Lab"
  if (leg.role === "orca") return "ORCA"
  if (leg.role === "tools") return "Tools & repos"
  if (leg.role === "data") return /DOCUMENT/i.test(leg.name) ? "Documents" : "Data"
  return leg.name
}

function ms(seconds) {
  const value = (seconds || 0) * 1000
  return value < 1 ? `${value.toFixed(1)} ms` : `${Math.round(value)} ms`
}

/**
 * The current route, leg by leg, read from the evaluation: which product carries each leg, its
 * round trip, and one line per leg ("Users → ServiceFabric (private, 2 ms)").
 */
export function routeSummary(useCaseId, choices = {}, nerd = false, result = null) {
  const useCase = byId(USE_CASES, useCaseId)
  const build = choicesToBuild(useCaseId, choices, nerd)
  const scored = result || evaluateBuild(useCaseId, build)
  const carried = build.netRouting?.carried || {}
  const specs = useCase?.legs || []
  const legs = (scored.legResults || [])
    .filter((leg) => leg.kind && leg.kind !== "off" && specs.find((item) => item.id === leg.id)?.role !== "control")
    .map((leg) => {
      const spec = specs.find((item) => item.id === leg.id) || { name: leg.name, role: "" }
      const product = carried[leg.id] || null
      return {
        id: leg.id,
        name: leg.name,
        word: legWord(spec),
        product,
        kind: leg.kind,
        label: productName(product, leg.kind),
        rttMs: (leg.rttS || 0) * 1000,
        line: `${legWord(spec)} → ${productName(product, leg.kind)} (${WORDS[leg.kind] || leg.kind}, ${ms(leg.rttS)})`,
      }
    })
  return {
    legs,
    line: legs.map((leg) => `${leg.word} → ${leg.label}`).join(" · "),
    ttft: scored.ttft,
    costPerM: scored.costPerM,
    score: scored.score,
    spend: scored.budgetSpend || 0,
    mrc: scored.net?.mrc || 0,
    agent: Boolean(build.netRouting?.agent),
    unused: build.netRouting?.unused || [],
    result: scored,
  }
}

/** The products that may carry one leg on this board, best physics first, one product per physics row. */
function legOptions(useCase, leg, reach, productIds) {
  const seen = new Set()
  const out = []
  for (const id of productIds) {
    const product = byId(PRODUCTS, id)
    if (!product || id === "mcp") continue
    const gate = productOnLeg(product, leg, reach)
    if (!gate.ok || seen.has(gate.kind)) continue
    seen.add(gate.kind)
    out.push({ id, kind: gate.kind })
  }
  return out
}

function cartesian(lists) {
  return lists.reduce((acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])), [[]])
}

function better(a, b) {
  if (!b) return true
  if (a.score !== b.score) return a.score > b.score
  if (a.spend !== b.spend) return a.spend < b.spend
  return a.mrc < b.mrc
}

/**
 * The best connectivity for a story on a metro set, inside the budget left for it.
 * `budgetLeft` (optional) caps the network's extra spend over the cheapest wiring; by default the
 * scenario budget decides. `choices` carries the rest of the board (GPU, cooling, memory, QPU);
 * `metros` overrides its metros. Returns the choice set to apply, the before and after numbers,
 * the per-leg lines, and any product the optimum wanted but the budget refused.
 */
export function bestConnectivity(useCaseId, metros = null, budgetLeft = null, choices = {}, nerd = false) {
  const useCase = byId(USE_CASES, useCaseId)
  const base = { ...choices, metros: cleanMetros(useCaseId, metros || choices.metros) }
  delete base.routed
  const sites = base.metros
  const helper = Boolean(useCase?.orca && base.helper)
  const reach = siteReach(useCaseId, sites)
  const offered = nerd ? PRODUCTS.map((product) => product.id) : PRODUCTS.filter((product) => product.simple).map((product) => product.id)
  const legs = activeLegsFor(useCase, sites, helper).filter((leg) => leg.role !== "control")
  const options = legs.map((leg) => legOptions(useCase, leg, reach, offered))
  const before = routeSummary(useCaseId, base, nerd)

  const cheapest = evaluateBuild(useCaseId, choicesToBuild(useCaseId, { ...base, net: ["public"], legs: {}, wires: "cheap" }, nerd))
  const floor = cheapest.budgetSpend || 0
  const affordable = (scored) => !scored.overBudget && (budgetLeft == null || (scored.budgetSpend || 0) - floor <= budgetLeft + 1e-6)

  /* MCP in the player's set stays: the agent routes, and the result reads "agent-routed". */
  const keepAgent = netOf(useCaseId, base, COMBO[useCaseId]).includes("mcp")
  let bestAll = null
  let bestOk = null
  let bestAgent = null
  const seen = new Set()
  for (const assignment of cartesian(options)) {
    for (const agent of [false, true]) {
      const net = [...new Set(assignment.map((option) => option.id))]
      if (agent) {
        if (!net.includes("fabric")) continue
        net.push("mcp")
      }
      /* The simple board has no pins: a product set routes itself, so each set is scored once. */
      const pins = nerd ? Object.fromEntries(legs.map((leg, index) => [leg.id, assignment[index].id])) : {}
      const key = JSON.stringify([net.slice().sort(), pins])
      if (seen.has(key)) continue
      seen.add(key)
      const candidate = { ...base, net, legs: pins, wires: legacyWires(net, COMBO[useCaseId]?.legs) }
      const build = choicesToBuild(useCaseId, candidate, nerd)
      const scored = evaluateBuild(useCaseId, build)
      if (!scored.ok) continue
      const entry = { candidate, score: scored.score, spend: scored.budgetSpend || 0, mrc: scored.net?.mrc || 0, scored, net }
      if (better(entry, bestAll)) bestAll = entry
      if (affordable(scored) && better(entry, bestOk)) bestOk = entry
      if (agent && affordable(scored) && better(entry, bestAgent)) bestAgent = entry
    }
  }
  if (keepAgent && bestAgent) bestOk = bestAgent
  if (!bestOk) return { changed: false, before, after: before, choices: { ...choices }, lines: ["No connectivity fits this budget: pick a cheaper GPU first."], skipped: [], agent: false }

  /* Never worse than what the player has: a legacy tile the product router cannot reproduce keeps its score. */
  const keep = before.result.ok && !before.result.overBudget && before.score > bestOk.score + 1e-9
  const winner = keep ? { ...before, candidate: { ...base, net: netOf(useCaseId, base, COMBO[useCaseId]) }, net: netOf(useCaseId, base, COMBO[useCaseId]), score: before.score, spend: before.spend } : bestOk

  /* Pins the plain router would choose anyway are dropped: the set alone reproduces the route. */
  let applied = { ...winner.candidate }
  if (!keep) {
    const plain = routeProducts(useCase, sites, helper, winner.net, {}, reach)
    const pins = {}
    const wanted = winner.candidate.legs || {}
    for (const leg of legs) if (wanted[leg.id] && plain.carried[leg.id] !== wanted[leg.id]) pins[leg.id] = wanted[leg.id]
    /* A product no leg uses once the pins are settled leaves the set. */
    const live = routeProducts(useCase, sites, helper, winner.net, pins, reach)
    const net = winner.net.filter((id) => !live.unused.includes(id))
    applied = { ...winner.candidate, net, legs: pins, wires: legacyWires(net, COMBO[useCaseId]?.legs) }
  }
  const after = routeSummary(useCaseId, applied, nerd)
  applied.routed = { key: routeKey(useCaseId, sites), score: after.score, agent: after.agent }

  const skipped = []
  if (bestAll && bestAll !== bestOk && !keep) {
    for (const id of bestAll.net) {
      if (!bestOk.net.includes(id)) skipped.push({ product: id, reason: `${productName(id)} would score ${Math.round(bestAll.score).toLocaleString("en-GB")} but goes over the budget by ${formatMoney(Math.max(0, (bestAll.spend || 0) - (bestAll.scored.budget || 0)))}` })
    }
  }
  const eligible = new Set(options.flat().map((option) => option.id))
  if (eligible.has("fiber") && !after.legs.some((leg) => leg.kind === "fiber")) {
    skipped.push({ product: "fiber", reason: `Dark fiber skipped: a ${Math.round(LEAD_DAYS.fiber / 7)}-week dig and its up-front cost buy no score here` })
  }
  if (eligible.has("public") && !after.legs.some((leg) => leg.kind === "public")) skipped.push({ product: "public", reason: "Public internet skipped: jitter and loss on live legs" })

  const lines = [
    ...after.legs.map((leg) => leg.line),
    ...skipped.map((item) => item.reason),
  ]
  const summary = `First token ${formatSeconds(before.ttft)} → ${formatSeconds(after.ttft)} · ${formatMoney(before.costPerM, 2)} → ${formatMoney(after.costPerM, 2)} per 1M tokens`
  const was = JSON.stringify([netOf(useCaseId, base, COMBO[useCaseId]), base.legs || {}])
  return {
    changed: was !== JSON.stringify([applied.net, applied.legs || {}]),
    before,
    after,
    choices: applied,
    lines,
    summary,
    skipped,
    agent: after.agent,
    label: after.agent ? "agent-routed" : "optimised",
  }
}
