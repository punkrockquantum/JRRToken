/** Plain account of one finished build, plus the single tile change that would score higher. */
import { NETWORKS, PLATFORMS, SITES, byId } from "./data.js"
import { evaluateBuild, formatMoney, formatScore } from "./model.js"
import { brainPick, choicesToBuild, cityChoices, citySites } from "./presets.js"
import { peopleLead, savingsLine } from "./results.js"

const KINDS = {
  fabric: "ServiceFabric",
  mcp: "ServiceFabric MCP",
  cross: "Cross connect",
  fiber: "Dark fiber",
  public: "Public internet",
}

const LIBRARY = {
  none: "No shared library",
  basic: "File & object",
  smart: "Vector index",
}

const WIRES = {
  cheap: "Public internet",
  fast: "ServiceFabric",
  private: "Cross connect, ServiceFabric and dark fiber",
  mix: "the ServiceFabric and MCP mix",
}

function metros(sites = []) {
  return sites.map((site) => (site && typeof site === "object" ? site.metro : byId(SITES, site)?.metro)).filter(Boolean)
}

function hallWords(hall) {
  return hall?.cooling === "liquid" ? "liquid-cooled hall" : "air-cooled hall"
}

/** One-tile neighbours of the current picture. */
function neighbours(useCaseId, choices) {
  const list = []
  for (const brains of ["small", "medium", "big", "huge"]) {
    if (brains === choices.brains) continue
    const pick = brainPick(useCaseId, brains)
    const platform = byId(PLATFORMS, pick.platform)
    list.push({
      choices: { ...choices, brains },
      phrase: `Switching to ${pick.racks}× ${platform?.name || pick.platform}`,
    })
  }
  list.push({
    choices: { ...choices, memory: !choices.memory },
    phrase: choices.memory ? "Turning the KV cache tier off" : "Turning the KV cache tier on",
  })
  for (const library of ["none", "basic", "smart"]) {
    if (library === choices.library) continue
    list.push({
      choices: { ...choices, library },
      phrase: `Switching the library to ${LIBRARY[library]}`,
    })
  }
  const home = choices.home === "super" ? "cool" : "super"
  list.push({
    choices: { ...choices, home },
    phrase: `Switching to the ${home === "super" ? "liquid-cooled" : "air-cooled"} hall`,
  })
  if (cityChoices(useCaseId)) {
    for (const cities of [1, 2, 3]) {
      if (cities === choices.cities) continue
      const names = metros(citySites(useCaseId, cities)).join(" and ")
      list.push({
        choices: { ...choices, cities },
        phrase: `Placing the computers in ${names || `${cities} cities`}`,
      })
    }
  }
  for (const wires of ["cheap", "fast", "private", "mix"]) {
    if (wires === choices.wires) continue
    list.push({
      choices: { ...choices, wires },
      phrase: `Switching the wires to ${WIRES[wires]}`,
    })
  }
  if (choices.helper != null && useCaseId === "drug") {
    list.push({
      choices: { ...choices, helper: !choices.helper },
      phrase: choices.helper ? "Turning the ORCA PT-3 helper off" : "Turning the ORCA PT-3 helper on",
    })
  }
  return list
}

/** The best single tile change, or a line that this picture already wins. */
export function bestChange(useCaseId, choices) {
  const current = evaluateBuild(useCaseId, choicesToBuild(useCaseId, choices))
  let winner = null
  for (const step of neighbours(useCaseId, choices)) {
    const result = evaluateBuild(useCaseId, choicesToBuild(useCaseId, step.choices))
    if (!winner || result.score > winner.result.score) winner = { ...step, result }
  }
  if (!winner || winner.result.score <= current.score) {
    return { text: "This is the best build.", better: false, score: current.score }
  }
  return {
    text: `${winner.phrase} would have scored about ${formatScore(winner.result.score)}.`,
    better: true,
    score: winner.result.score,
  }
}

function memoryLine(result, choices) {
  if (!choices.memory) {
    return {
      id: "memory",
      text: "KV cache tier OFF: the GPUs re-read every chat.",
      detail: Number.isFinite(result.ttft) ? `Time to first token ${Math.round(result.ttft * 1000)} ms.` : "",
    }
  }
  const off = evaluateBuild(result.useCase.id, choicesToBuild(result.useCase.id, { ...choices, memory: false }))
  const pct = off.throughput > 0 ? Math.round((result.throughput / off.throughput - 1) * 100) : 0
  const extra = pct > 0 ? ` (+${pct}% speed)` : ""
  const detail = Number.isFinite(result.ttft) && Number.isFinite(off.ttft)
    ? `Time to first token ${Math.round(result.ttft * 1000)} ms versus ${Math.round(off.ttft * 1000)} ms without it.`
    : ""
  return { id: "memory", text: `KV cache tier ON saved re-reading repeat chats${extra}.`, detail }
}

function legWords(name = "") {
  const plain = name.toLowerCase().replace(/\s*→\s*/, " to ")
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

function networkLine(result, choices) {
  const legs = (result.legResults || []).filter((leg) => leg.kind && leg.kind !== "off")
  const bits = legs.map((leg) => `${legWords(leg.name)}: ${KINDS[leg.kind] || byId(NETWORKS, leg.kind)?.name || leg.kind}`)
  let text = bits.length ? `${bits.join(". ")}.` : "No private wires."
  if (Number.isFinite(result.ttft)) text += ` First word in ${result.ttft.toFixed(2)} s.`
  const earned = (result.combos || []).map((combo) => combo.name).filter(Boolean)
  if (earned.length) text += ` You earned ${earned.join(" and ")}.`
  if (choices.wires !== "cheap") {
    const pub = evaluateBuild(result.useCase.id, choicesToBuild(result.useCase.id, { ...choices, wires: "cheap" }))
    if (Number.isFinite(pub.ttft) && pub.ttft > (result.ttft || 0) + 0.02) {
      text += ` Public internet would have taken ${pub.ttft.toFixed(2)} s and added jitter.`
    }
  }
  const detail = legs.map((leg) => {
    const ms = Number.isFinite(leg.rttS) ? `${Math.round(leg.rttS * 1000)} ms` : ""
    const speed = Number.isFinite(leg.gbps) ? `${leg.gbps} Gbps` : ""
    return [legWords(leg.name), ms, speed].filter(Boolean).join(" ")
  }).join(". ")
  return { id: "network", text, detail }
}

/**
 * Five to seven short lines. `text` is the plain account. `detail` is the nerd numbers.
 */
export function explainResult(result, choices, { nerd = false } = {}) {
  const platform = result.platform
  const gpus = (result.racks || 0) * (platform?.gpusPerRack || 0)
  const where = metros(result.sites)
  const coverage = Math.round((result.coverage || 0) * 100)
  let compute = `You chose ${result.racks}× ${platform?.name || "computers"} (${gpus} GPUs) in a ${hallWords(result.hall)}`
  if (where.length) compute += ` in ${where.join(" and ")}`
  compute += `: enough for ${coverage}% of the crowd.`
  if (platform?.cooling === "liquid" && result.hall?.cooling !== "liquid") {
    compute += " These racks need liquid cooling, so they run slower."
  }
  const dataId = result.data?.id || "local"
  const storage = {
    local: "No shared library, so the computers only use what they already know.",
    file: "File & object storage holds the documents the app reads.",
    vector: "A vector index finds the right passage before the answer is written.",
  }[dataId] || "The library is in place."
  const week = Math.ceil(result.liveWeeks || 0)
  const deadline = result.scenario?.deadlineWeeks || 0
  const money = `You used ${formatMoney(result.budgetSpend || 0)} of a ${formatMoney(result.budget || 0)} budget, go live in week ${week} against a week ${deadline} deadline, at ${formatMoney(result.costPerM, 3)} per million tokens versus a par of ${formatMoney(result.useCase?.parCost, 3)}.`
  const suggestion = bestChange(result.useCase.id, choices)
  const lines = [
    {
      id: "compute",
      text: compute,
      detail: `${Math.round(result.goodput || 0).toLocaleString("en-GB")} tok/s, ${Math.round(result.facilityKW || 0)} kW facility.`,
    },
    memoryLine(result, choices),
    { id: "storage", text: storage, detail: result.data?.name || "" },
    networkLine(result, choices),
    {
      id: "money",
      text: money,
      detail: `Score ${formatScore(result.score)}.`,
    },
    {
      id: "people",
      text: `${peopleLead(result)}. ${savingsLine(result)}`,
      detail: "",
    },
    { id: "next", text: suggestion.text, detail: suggestion.better ? `That build scores ${formatScore(suggestion.score)}.` : "" },
  ]
  const sentence = (value) => (value && !/[.!?]$/.test(value) ? `${value}.` : value)
  return {
    title: "WHAT YOU BUILT AND WHY IT SCORED THIS WAY",
    lines: lines.map((line) => {
      const text = sentence(line.text)
      const detail = sentence(line.detail)
      return { ...line, text, detail, show: nerd ? [text, detail].filter(Boolean).join(" ") : text }
    }),
    suggestion,
  }
}
