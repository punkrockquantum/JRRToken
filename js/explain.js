/** Plain account of one finished build, plus the single tile change that would score higher. */
import { NETWORKS, SITES, byId } from "./data.js"
import { STAR_POINTS, evaluateBuild, formatMoney, formatScore } from "./model.js"
import { choicesToBuild } from "./presets.js"
import { peopleLead, savingsLine } from "./results.js"
import { BUILD_STEP_IDS, allSimple, applyTile, describeChoices, qpuRelevant, stepTiles, stepValue } from "./steps.js"

const KINDS = {
  fabric: "ServiceFabric",
  mcp: "ServiceFabric MCP",
  cross: "Cross connect",
  fiber: "Dark fiber",
  public: "Public internet",
}

const WIRES = {
  cheap: "Public internet",
  peer: "Peering + eyeball networks",
  fast: "ServiceFabric",
  private: "Cross connect + Dark fiber",
}

function metros(sites = []) {
  return sites.map((site) => (site && typeof site === "object" ? site.metro : byId(SITES, site)?.metro)).filter(Boolean)
}

function hallWords(hall) {
  return hall?.cooling === "liquid" ? "liquid-cooled hall" : "air-cooled hall"
}

const STEP_PHRASE = {
  gpu: (tile) => `Switching to ${tile.racks}× ${tile.platform?.name || tile.id}`,
  cooling: (tile) => `Switching to the ${tile.label.toLowerCase()}`,
  memory: (tile) => tile.phrase || `Switching memory to ${tile.label}`,
  wires: (tile) => `Switching the connection to ${tile.label}`,
  storage: (tile) => `Switching storage to ${tile.label.toLowerCase()}`,
  qpu: (tile) => (tile.id === "orca" ? "Turning the ORCA PT-3 helper on" : "Turning the ORCA PT-3 helper off"),
}

function locationPhrase(useCaseId, before, after) {
  const name = (id) => byId(SITES, id)?.metro || id
  const added = after.filter((id) => !before.includes(id))
  const dropped = before.filter((id) => !after.includes(id))
  if (added.length && dropped.length) return `Moving the racks from ${dropped.map(name).join(" and ")} to ${added.map(name).join(" and ")}`
  if (added.length) return `Adding a second metro in ${added.map(name).join(" and ")}`
  return `Dropping ${dropped.map(name).join(" and ")}`
}

/** One-tile neighbours of the current picture: every other tile on every step, simple or nerd. */
function neighbours(useCaseId, choices, nerd = false) {
  const list = []
  for (const stepId of BUILD_STEP_IDS) {
    if (stepId === "qpu" && !qpuRelevant(useCaseId)) continue
    const value = stepValue(useCaseId, stepId, choices)
    for (const tile of stepTiles(useCaseId, stepId, nerd)) {
      if (tile.locked) continue
      if (stepId !== "location" && tile.id === value) continue
      const next = applyTile(useCaseId, stepId, tile.id, choices)
      if (stepId === "location" && JSON.stringify(stepValue(useCaseId, "location", next)) === JSON.stringify(value)) continue
      list.push({
        kind: stepId,
        to: tile.id,
        choices: next,
        phrase: stepId === "location" ? locationPhrase(useCaseId, value, stepValue(useCaseId, "location", next)) : STEP_PHRASE[stepId](tile),
      })
    }
  }
  return list
}

/** The simple board does not change while the game runs, so each story's best is scored once. */
const SIMPLE_BEST = new Map()

/** The highest-scoring picture on the simple board, spelled out step by step. */
export function simpleBest(useCaseId) {
  if (SIMPLE_BEST.has(useCaseId)) return SIMPLE_BEST.get(useCaseId)
  let best = null
  for (const combo of allSimple(useCaseId)) {
    const result = evaluateBuild(useCaseId, choicesToBuild(useCaseId, combo, false))
    if (!best || result.score > best.result.score) best = { combo, result }
  }
  const found = best ? { score: best.result.score, choices: best.combo, result: best.result, phrase: describeChoices(useCaseId, best.combo) } : null
  SIMPLE_BEST.set(useCaseId, found)
  return found
}

/** The best single tile change, or a line that this picture already wins. */
export function bestChange(useCaseId, choices, { nerd = false } = {}) {
  const current = evaluateBuild(useCaseId, choicesToBuild(useCaseId, choices, nerd))
  let winner = null
  for (const step of neighbours(useCaseId, choices, nerd)) {
    const result = evaluateBuild(useCaseId, choicesToBuild(useCaseId, step.choices, nerd))
    if (!winner || result.score > winner.result.score) winner = { ...step, result }
  }
  if (!winner || winner.result.score <= current.score) {
    if (!nerd) {
      const best = simpleBest(useCaseId)
      if (best && best.score > current.score * 1.02) {
        const lead = current.score < STAR_POINTS[0] ? "No single change rescues this." : "No single change beats this."
        return { text: `${lead} ${best.phrase} would score about ${formatScore(best.score)}.`, better: true, score: best.score, kind: null }
      }
    }
    return { text: "This is the best build.", better: false, score: current.score, kind: null }
  }
  return {
    text: `${winner.phrase} would have scored about ${formatScore(winner.result.score)}.`,
    better: true,
    score: winner.result.score,
    kind: winner.kind || null,
    to: winner.to || null,
  }
}

function memoryLine(result, choices, nerd = false) {
  if (!choices.memory) {
    return {
      id: "memory",
      text: "KV cache tier OFF: the GPUs re-read every chat.",
      detail: Number.isFinite(result.ttft) ? `Time to first token ${Math.round(result.ttft * 1000)} ms.` : "",
    }
  }
  const off = evaluateBuild(result.useCase.id, choicesToBuild(result.useCase.id, { ...choices, memory: false }, nerd))
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

/**
 * Batch stories (drug discovery) never pay a jitter or SLA haircut on the public internet;
 * the lab leg is only bandwidth-limited. So the comparison is candidates screened, not waiting.
 */
function batchLine(result, choices, nerd = false) {
  const id = result.useCase.id
  const scored = (wires) => (choices.wires === wires ? result : evaluateBuild(id, choicesToBuild(id, { ...choices, wires }, nerd)))
  if (choices.wires === "cheap" || choices.wires === "peer") {
    const priv = scored("private")
    if (!(result.served > 0 && priv.served > result.served * 1.005)) return ""
    const more = Math.round((priv.served / result.served - 1) * 100)
    const name = choices.wires === "cheap" ? "Public internet" : "Peering"
    return ` ${name} was fine for your batch lab data, but a private link would have screened ${more}% more candidates.`
  }
  const pub = scored("cheap")
  if (!(pub.served > 0 && result.served > pub.served * 1.005)) return ""
  const more = Math.round((result.served / pub.served - 1) * 100)
  return ` Public internet would also have carried your batch lab data, but your private link screened ${more}% more candidates.`
}

function networkLine(result, choices, nerd = false) {
  const legs = (result.legResults || []).filter((leg) => leg.kind && leg.kind !== "off")
  const bits = legs.map((leg) => `${legWords(leg.name)}: ${KINDS[leg.kind] || byId(NETWORKS, leg.kind)?.name || leg.kind}`)
  let text = bits.length ? `${bits.join(". ")}.` : "No private wires."
  if (Number.isFinite(result.ttft)) text += ` First word in ${result.ttft.toFixed(2)} s.`
  const earned = (result.combos || []).map((combo) => combo.name).filter(Boolean)
  if (earned.length) text += ` You earned ${earned.join(" and ")}.`
  const batch = (result.useCase?.legs || []).some((leg) => leg.slaExempt)
  if (batch) {
    text += batchLine(result, choices, nerd)
  } else if (choices.wires !== "cheap") {
    const pub = evaluateBuild(result.useCase.id, choicesToBuild(result.useCase.id, { ...choices, wires: "cheap" }, nerd))
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

/** Live working for nerd mode: how this picture was scored. */
export function thinkLines(result) {
  if (!result?.ok) return ["This picture is not a working factory yet."]
  const num = (value) => Math.round(value || 0).toLocaleString("en-GB")
  const ms = (seconds) => (Number.isFinite(seconds) ? `${Math.round(seconds * 1000)} ms` : "—")
  const legs = (result.legResults || [])
    .filter((leg) => leg.kind && leg.kind !== "off")
    .map((leg) => `${leg.name} ${ms(leg.rttS)} × ${leg.trips ?? 1}`)
    .join("; ")
  const crit = (result.leadParts || []).reduce((best, part) => (!best || part.weeks > best.weeks ? part : best), null)
  const combos = (result.combos || []).map((combo) => combo.name || combo.label || combo.id || "").filter(Boolean)
  const accelerator = result.orcaCapex > 0 ? " Hidden accelerator capex is inside the factory cost." : ""
  return [
    `Demand ${num(result.demand)} tok/s versus supply ${num(result.throughput)} tok/s.`,
    `Decode is limited by HBM bandwidth against the bytes of the weights and the KV cache. Hosts: ${result.hosts || "standard"}.`,
    `TTFT ${ms(result.ttft)} is prefill ${ms(result.prefillS)} plus network ${ms(result.netDelayS)}. ${legs}`,
    `Power: ${result.racks || 0} racks × ${result.platform?.rackKW || 0} kW × PUE ${result.hall?.pue ?? "—"} makes ${num(result.facilityKW)} kW against ${Number(result.powerMW || 0).toFixed(2)} MW.`,
    `Cost ${formatMoney(result.costPerM, 3)} per million tokens, with capex amortisation inside the hourly cost.${accelerator}`,
    crit ? `Lead-time critical path: ${crit.name}, ${crit.weeks} weeks.` : "",
    `People-power: about ${num(result.fteEquivalent)} people, net ${formatMoney(result.annualSavings || 0)} a year.`,
    `Combo bonuses: ${combos.length ? combos.join(", ") : "none"}.`,
  ].filter(Boolean)
}

function siteStory(result, choices, nerd = false) {
  const sites = result.sites || []
  const id = result.useCase?.id
  if (["rag", "research", "drug"].includes(id)) {
    return {
      text: "One site is the right call. The library is heavy, so a second metro mostly copies data.",
      detail: "Data gravity: the documents stay next to the computers.",
    }
  }
  if (sites.length < 2) return { text: "", detail: "" }
  const cohorts = result.cohorts || []
  const remote = [...cohorts].sort((a, b) => b.share - a.share).find((row) => row.siteId && row.siteId !== sites[0].id) || cohorts[1]
  const metro = sites.find((site) => site.id === remote?.siteId)?.metro || sites[1]?.metro
  const text = remote && metro
    ? `Your second site in ${metro} cut the round trip for ${Math.round(remote.share * 100)}% of users.`
    : ""
  let detail = ""
  if (remote) {
    const solo = evaluateBuild(id, {
      ...choicesToBuild(id, { ...choices, metros: [sites[0].id] }, nerd),
      sites: [sites[0].id],
    })
    const before = (solo.cohorts || []).find((row) => row.city === remote.city)
    if (before && Number.isFinite(before.rttS) && Number.isFinite(remote.rttS)) {
      const ms = (s) => (s * 1000 < 1 ? "under 1" : String(Math.round(s * 1000)))
      detail = `That round trip went from ${ms(before.rttS)} ms to ${ms(remote.rttS)} ms.`
    }
  }
  if (result.sitePlans?.length) {
    const bits = result.sitePlans.map((row) => `${row.metro} ${row.role} ${Number(row.powerMW).toFixed(2)} MW`)
    detail = `${detail} Per site: ${bits.join(", ")}.`.trim()
  }
  return { text, detail }
}

const AUDIENCE = {
  chat: "shoppers",
  rag: "office staff",
  code: "coders",
  research: "analysts",
  drug: "the lab's candidates",
  robot: "robots",
}

const WIRE_WORDS = {
  cheap: "the public internet",
  peer: "peering",
  fast: "ServiceFabric",
  private: "private links",
}

function timeWords(ttft) {
  if (!Number.isFinite(ttft)) return ""
  if (ttft <= 0.1) return "in a blink"
  if (ttft <= 0.5) return "in under half a second"
  if (ttft <= 1) return "in under a second"
  if (ttft <= 2.5) return "in a couple of seconds"
  return `in about ${Math.round(ttft)} seconds`
}

function capital(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** The clause after the colon: which data-center decision held this build back. */
function limitWords(change, useCaseId, batch) {
  if (change?.kind === "wires") {
    return change.to === "fast" || change.to === "private" ? "a private connection would have carried more, faster" : "a better connection would have answered more of them"
  }
  if (change?.kind === "location") {
    return /^Adding/.test(change.phrase || "") ? "a second metro would have put the answers closer to people" : "a metro closer to the people and the data would have answered faster"
  }
  if (change?.kind === "cooling") {
    if (change.to === "super") return "liquid cooling would have let the racks run harder"
    if (change.to === "rear" || change.to === "row") return "a better-cooled hall would have fed more of the power room to the GPUs"
    return "the air-cooled hall would have been ready sooner and cheaper"
  }
  if (change?.kind === "memory") return change.to === "off" ? "memory the job never reuses was cost and power for nothing" : "KV memory would have spared the GPUs re-reading every prompt"
  if (change?.kind === "storage") return change.to === "none" ? "shared storage the job never reads was cost and power for nothing" : "shared storage would have given the model something to know"
  if (change?.kind === "qpu") return change.to === "orca" ? "ORCA PT-3 beside the GPUs would have found twice the strong binders" : "the quantum helper cost more than it found"
  if (change?.kind === "gpu") return batch ? "the GPUs ran out of muscle before the candidate list did" : "the GPUs ran out of muscle before the crowd did"
  return "closer, cooler and better connected is the whole game"
}

/**
 * The booth lesson in one sentence: what happened, tied to the data-center decision
 * (cooling, location, connection, power or money) that caused it.
 */
export function headline(result, choices = {}, change = null) {
  if (!result?.ok) return "Pick a GPU to start the factory."
  const id = result.useCase?.id
  const who = AUDIENCE[id] || "people"
  const where = metros(result.sites)
  const place = where.length ? ` in ${where.join(" and ")}` : ""
  const hall = hallWords(result.hall)
  const name = result.platform?.name || "these racks"
  const racks = `${result.racks}× ${name}`
  const coverage = Math.round((result.coverage || 0) * 100)
  const wire = WIRE_WORDS[choices.wires] || "private links"
  const batch = (result.useCase?.legs || []).some((leg) => leg.slaExempt)
  if (result.overBudget) {
    return `${racks} cost ${formatMoney(result.finance)} more than the whole budget, so the money ran out before the ${hall}${place} could pay for itself.`
  }
  if (result.platform?.cooling === "liquid" && result.hall?.cooling !== "liquid") {
    return `Your ${racks} overheated in the air-cooled hall${place}: these racks need liquid cooling to run at full speed.`
  }
  if (result.overPower && result.score === 0) {
    return `Your ${racks} drew more power than the ${hall}${place} could feed, so the racks browned out.`
  }
  if (result.lateWeeks > 0) {
    const weeks = Math.ceil(result.lateWeeks)
    return `${name} arrived in week ${Math.ceil(result.liveWeeks)}, ${weeks} ${weeks === 1 ? "week" : "weeks"} after the deadline, so ${who} waited on an empty ${hall}${place}.`
  }
  const top = (result.score || 0) >= STAR_POINTS[2]
  if (batch) {
    const base = `Your ${hall}${place} screened ${coverage}% of ${who} over ${wire}`
    if (top) return `${base}, with ORCA PT-3 finding about twice the strong matches.`
    return `${base}: ${limitWords(change, id, batch)}.`
  }
  const publicWire = (result.publicTrips || 0) > 0
  if (publicWire && (!result.slaMet || (result.coverage || 0) < 0.5)) {
    return `The public internet left ${Math.max(1, 100 - coverage)}% of ${who} waiting on your ${hall}${place}: fast GPUs cannot fix a slow, jittery connection.`
  }
  if ((result.farShare || 0) >= 0.2 && !top) {
    return `One metro${place} kept ${Math.round(result.farShare * 100)}% of ${who} too far away: a second metro closer to them would have answered faster.`
  }
  if (!result.slaMet && !top) {
    return `${capital(who)} waited ${timeWords(result.ttft).replace(/^in /, "")} for the first word from your ${hall}${place}: ${limitWords(change, id, batch)}.`
  }
  const base = `Your ${hall}${place} answered ${coverage}% of ${who} ${timeWords(result.ttft)} over ${wire}`
  if (top) return `${base}: close, cool and connected.`
  return `${base}: ${limitWords(change, id, batch)}.`
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
  const places = siteStory(result, choices, nerd)
  if (places.text) compute += ` ${places.text}`
  const dataId = result.data?.id || "local"
  const storage = {
    local: "No shared library, so the computers only use what they already know.",
    file: "File & object storage holds the documents the app reads.",
    vector: "A vector index finds the right passage before the answer is written.",
  }[dataId] || "The library is in place."
  const storageWhy = nerd ? "" : " Storage was picked for this story automatically."
  const week = Math.ceil(result.liveWeeks || 0)
  const deadline = result.scenario?.deadlineWeeks || 0
  const money = `You used ${formatMoney(result.budgetSpend || 0)} of a ${formatMoney(result.budget || 0)} budget, go live in week ${week} against a week ${deadline} deadline, at ${formatMoney(result.costPerM, 3)} per million tokens versus a par of ${formatMoney(result.useCase?.parCost, 3)}.`
  const suggestion = bestChange(result.useCase.id, choices, { nerd })
  const thinking = thinkLines(result).join(" ")
  const lines = [
    {
      id: "compute",
      text: compute,
      detail: `${Math.round(result.goodput || 0).toLocaleString("en-GB")} tok/s, ${Math.round(result.facilityKW || 0)} kW facility. ${places.detail} ${thinking}`,
    },
    memoryLine(result, choices, nerd),
    { id: "storage", text: `${storage}${storageWhy}`, detail: result.data?.name || "" },
    networkLine(result, choices, nerd),
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
    headline: headline(result, choices, suggestion),
    lines: lines.map((line) => {
      const text = sentence(line.text)
      const detail = sentence(line.detail)
      return { ...line, text, detail, show: nerd ? [text, detail].filter(Boolean).join(" ") : text }
    }),
    suggestion,
  }
}

/** The one line under the Digital Realty logo on every results card. */
export const DR_FOOTER = "Built in a Digital Realty data center: power, cooling and connections ready."
