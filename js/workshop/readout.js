/**
 * Workshop mode: the read-out every team gets at the end. From the evaluated build (js/workshop/cfd.js)
 * it writes WHAT WENT WELL (three sentences the decisions earned), WHAT YOU COULD HAVE DONE DIFFERENTLY
 * (the single best alternative at each station, holding the other three fixed, with the points and
 * the runs it would have added: the kiosk game's neighbour-search idea at station grain), the
 * architect's notes from any SEND BACK, and one closing line on Digital Realty's role built from
 * published facts only. The Worker stores the result in `readouts`; the iPad prints it.
 */
import { REFERENCE_BUILD, RUNS_CAP, SCENARIO, STATION_IDS, completeChoices, evaluateWorkshop, formatMoney, stationById, tileOf } from "./cfd.js"

/** Published facts only (digitalrealty.com, checked Oct 2026). */
export const DR_CLOSING = "Digital Realty runs 300+ data centers in 50+ metros on PlatformDIGITAL: the metros on your board are real, ServiceFabric is how a CFD site reaches the offices, the data room and the clouds privately, and its liquid-cooled halls are where 130 kW racks go."

const STATION_NAMES = Object.fromEntries(STATION_IDS.map((id) => [id, stationById(id).name]))

/** Every combination of a station's tiles: [{ decisionId: tileId }]. */
export function stationCombos(stationId) {
  const station = stationById(stationId)
  let combos = [{}]
  for (const decision of station.decisions) {
    combos = combos.flatMap((partial) => decision.tiles.map((tile) => ({ ...partial, [decision.id]: tile.id })))
  }
  return combos
}

/** The tile titles behind one station's choices: "GB200 NVL72 rack · Small · InfiniBand + parallel file system". */
export function describeChoices(stationId, choices, metroId) {
  const station = stationById(stationId)
  return station.decisions
    .map((decision) => {
      const tile = tileOf(stationId, decision.id, choices[decision.id])
      if (!tile) return null
      if (decision.id === "power") return `${blockTitle(metroId, choices[decision.id])} block`
      return tile.title.replace(/^[A-C] · /, "")
    })
    .filter(Boolean)
    .join(" · ")
}

function blockTitle(metroId, blockId) {
  const index = Number(String(blockId).replace("block-", "")) || 0
  return ["smallest", "middle", "biggest"][Math.min(2, index)]
}

/**
 * The three things that went well, in priority order, from what the build does. Returns at most
 * `limit` sentences; a weak build still gets the true ones (budget, go-live) so nobody leaves empty-handed.
 */
export function wentWell(result, { sendBacks = 0, firstTime = null, limit = 3 } = {}) {
  const r = result
  const lines = []
  const stationsFirstTime = firstTime ?? (sendBacks === 0 ? 4 : null)
  if (stationsFirstTime === 4) lines.push("Approved first time at all four stations: clear pitches, no send-backs.")
  else if (stationsFirstTime !== null && stationsFirstTime >= 2) lines.push(`Approved first time at ${stationsFirstTime} of 4 stations.`)
  if (!r.gpu.trap) lines.push(`FP64-capable GPUs: ${r.gpu.gpus} × ${r.gpu.title.replace(/ nodes| rack| servers/, "")} give ${r.pflops} PFLOPS of double precision, ${r.runs} runs a night against a par of ${r.parRuns}.`)
  if (r.power.state === "green") lines.push(r.power.headroomPct <= 20 ? `Right-sized power: a ${r.power.mw} MW block for ${r.power.facilityKW} kW, ${r.power.headroomPct}% headroom, nothing stranded.` : `Right-sized power: the smallest block on the ladder (${r.power.mw} MW) for ${r.power.facilityKW} kW; nothing bigger bought.`)
  if (r.net.allPrivate) lines.push(`Private connectivity on every leg: ${r.net.frameMs} ms remote 3D frames for both offices and the night's data home in ${r.net.ingestHours} h.`)
  else if (r.net.private) lines.push(`Private connectivity for the remote 3D views: ${r.net.frameMs} ms frames instead of the public internet's jitter.`)
  if (r.cooling.liquid && r.design.cooling === "liquid") lines.push(`Direct liquid cooling for ${r.rackKW} kW racks: the density the design needs, PUE ${r.cooling.pue}.`)
  else if (!r.cooling.liquidInAir && !r.cooling.tooHot) lines.push(`Cooling matched the racks: ${r.rackKW} kW a rack under a ${r.cooling.capKW} kW ${r.cooling.title.toLowerCase()} cap.`)
  if (r.metro.id === "lon") lines.push(`London sits ${r.metro.dataKm} km from the UK data room: the shortest data leg on the board.`)
  if (!r.overBudget) lines.push(`Within budget: ${formatMoney(r.capex)} of ${formatMoney(r.budget)}${r.moneyLeft >= 5e5 ? `, ${formatMoney(r.moneyLeft)} back to the car (+${Math.round((r.factors.value - 1) * 100)}%)` : ""}.`)
  if (r.lateWeeks === 0) lines.push(`Live in ${r.leadWeeks} weeks, inside the ${r.goLiveWeeks}-week deadline.`)
  if (r.efficiency >= 0.85) lines.push(`A fabric that feeds the GPUs: ${Math.round(r.efficiency * 100)}% interconnect efficiency.`)
  return lines.slice(0, limit)
}

/**
 * For each station, the best alternative holding the other three fixed, with the gain. Sorted by
 * gain, largest first; stations where nothing beats the team's choice are left out.
 */
export function bestAlternatives(choices, { sendBacks = 0 } = {}) {
  const base = evaluateWorkshop(choices, { sendBacks })
  const complete = completeChoices(choices)
  const out = []
  for (const stationId of STATION_IDS) {
    let best = null
    for (const combo of stationCombos(stationId)) {
      const trial = { ...complete, [stationId]: combo }
      const result = evaluateWorkshop(trial, { sendBacks })
      if (result.score > base.score && (!best || result.score > best.result.score)) best = { combo, result }
    }
    if (best) {
      out.push({
        station: stationId,
        name: STATION_NAMES[stationId],
        combo: best.combo,
        fromCombo: complete[stationId],
        from: describeChoices(stationId, complete[stationId], complete.dcpower.metro),
        to: describeChoices(stationId, best.combo, best.combo.metro || complete.dcpower.metro),
        gain: best.result.score - base.score,
        score: best.result.score,
        runsFrom: base.runs,
        runsTo: best.result.runs,
        result: best.result,
      })
    }
  }
  return out.sort((a, b) => b.gain - a.gain)
}

/**
 * The differently-sentences, at most `limit`: a greedy path of single-station fixes, each quantified
 * against the step before ("CFD: … +900", "Then DATACENTER & POWER: … +120 more"), and, when the path
 * stops short of the thoughtful build, the gap to it. A build at the top gets one line saying so.
 */
export function doDifferently(choices, { sendBacks = 0, limit = 3 } = {}) {
  const lines = []
  let current = completeChoices(choices)
  const used = new Set()
  while (lines.length < limit) {
    const alt = bestAlternatives(current, { sendBacks }).find((candidate) => !used.has(candidate.station))
    if (!alt) break
    const runs = alt.runsTo !== alt.runsFrom ? `, ${alt.runsFrom} → ${alt.runsTo} runs a night` : ""
    const why = reason(alt)
    lines.push(lines.length === 0 ? `${alt.name}: ${alt.to} instead of ${alt.from} would have scored +${alt.gain} (${alt.score}${runs})${why ? `: ${why}` : ""}.` : `Then ${alt.name}: ${alt.to} instead of ${alt.from}, +${alt.gain} more (${alt.score}${runs})${why ? `: ${why}` : ""}.`)
    used.add(alt.station)
    current = { ...current, [alt.station]: alt.combo }
  }
  const reached = evaluateWorkshop(current, { sendBacks })
  const reference = evaluateWorkshop(REFERENCE_BUILD, { sendBacks })
  if (reference.score > reached.score && lines.length < limit) {
    const differs = STATION_IDS.filter((id) => describeChoices(id, current[id], current.dcpower.metro) !== describeChoices(id, REFERENCE_BUILD[id], REFERENCE_BUILD.dcpower.metro))
    const where = differs.map((id) => `${STATION_NAMES[id]}: ${describeChoices(id, REFERENCE_BUILD[id], REFERENCE_BUILD.dcpower.metro)}`).join("; ")
    const base = lines.length ? "From there, the" : "No single station change beats this build. The"
    lines.push(`${base} top build on the board scores ${reference.score} (+${reference.score - reached.score}): ${reference.runs} runs a night for ${formatMoney(reference.capex)}, ${formatMoney(reference.moneyLeft)} back to the car. It differs at ${where}.`)
  }
  if (!lines.length) lines.push("Nothing beats this build at any one station: every alternative we tried scored lower.")
  return lines
}

/** A short cause for the gain, from the decision that changed. */
function reason(alt) {
  const r = alt.result
  const before = alt.fromCombo || {}
  const after = alt.combo || {}
  if (alt.station === "cfd") {
    const cheaper = `still ${r.runs} runs a night (the score caps at ${Math.round(RUNS_CAP * SCENARIO.parRuns)}), with ${formatMoney(r.moneyLeft)} back to the car`
    if (before.gpu !== after.gpu && before.gpu === "rtx") return "CFD needs FP64, which inference GPUs barely have"
    if (before.gpu !== after.gpu) return alt.runsTo > alt.runsFrom ? "more runs with the design and hall you chose" : cheaper
    if (before.size !== after.size) return alt.runsTo > alt.runsFrom ? `${tileOf("cfd", "size", after.size).title} is the size the par needs` : cheaper
    if (before.fabric !== after.fabric) return alt.runsTo > alt.runsFrom ? "a fabric and storage that keep the GPUs fed" : cheaper
    return r.overBudget ? "" : "inside the budget"
  }
  if (alt.station === "dcpower") {
    if (before.cooling !== after.cooling) return r.cooling.liquid ? "the hall that cools liquid racks" : "cooling that matches the racks"
    if (before.power !== after.power && r.power.state === "green") return "the block fits the need with 10–20% headroom"
    if (before.power !== after.power) return r.power.shortKW > 0 ? "a block the racks do not trip" : "a block closer to the need"
    if (before.metro !== after.metro) return `${r.metro.name} is ${r.metro.dataKm} km from the data`
    return ""
  }
  if (alt.station === "connectivity") return `${r.net.frameMs} ms frames and ${r.net.ingestHours} h for the night's data`
  if (alt.station === "oems") return r.design.mismatch ? "" : "a design made for that GPU"
  return ""
}

/** "A", "A and B", "A, B and C". */
function listNames(names) {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/**
 * The whole read-out for a team. `decisions` is the team's list from the Worker (station, choices,
 * approval, sendBacks, hostNote), `rank`/`teams` the standing once the session has them.
 */
export function generateReadout({ choices, decisions = [], rank = null, teams = null, teamName = "" }) {
  const sendBacks = decisions.reduce((sum, decision) => sum + (decision.sendBacks || 0), 0)
  const firstTime = decisions.filter((decision) => decision.approval === "approved" && !(decision.sendBacks > 0)).length
  const missing = STATION_IDS.filter((id) => !decisions.some((decision) => decision.station === id && decision.choices))
  const result = evaluateWorkshop(choices, { sendBacks })
  const well = wentWell(result, { sendBacks, firstTime })
  const differently = doDifferently(choices, { sendBacks })
  if (missing.length) differently.unshift(`You never saved a choice at ${listNames(missing.map((id) => STATION_NAMES[id]))}: the cheapest tile stood in for you.`)
  const notes = decisions
    .filter((decision) => decision.sendBacks > 0 && decision.hostNote)
    .map((decision) => `${STATION_NAMES[decision.station]}: sent back ${decision.sendBacks === 1 ? "once" : `${decision.sendBacks} times`} (${decision.hostNote}).`)
  return {
    score: result.score,
    rank,
    teams,
    teamName,
    wentWell: well,
    doDifferently: differently,
    architectNotes: notes,
    closing: DR_CLOSING,
    summary: `${result.runs} runs a night · ${formatMoney(result.capex)} · ${result.net.frameMs} ms 3D frames · power ${result.power.state} · live in ${result.leadWeeks} wk`,
    detail: result,
  }
}
