/**
 * The ecosystem bar: five parts of a data center, lit green, amber or red from one scored
 * build. Pure, so the bar, the single round-one hint and the coach question can be tested.
 *
 * POWER, COOLING, COMPUTE, DATA, CONNECTIONS. Red means the AI stops or the crowd leaves;
 * amber means it works but a data-center decision is costing points. The first red part,
 * else the first amber part, is the one hint a player gets between rounds.
 */
import { HALLS, SITES, byId, hallRackCap } from "./data.js"
import { formatMoney } from "./model.js"

/** The build step a part's hint points at when the message does not name one. */
const DEFAULT_STEP = { power: "gpu", cooling: "cooling", compute: "gpu", data: "storage", connections: "wires" }

export const ECO_PARTS = [
  { id: "power", name: "POWER", art: "token" },
  { id: "cooling", name: "COOLING", art: "fan" },
  { id: "compute", name: "COMPUTE", art: "rackLiquid" },
  { id: "data", name: "DATA", art: "vault" },
  { id: "connections", name: "CONNECTIONS", art: "user" },
]

const copyTime = (hours) => (hours < 168 ? `${Math.max(1, Math.round(hours / 24))} days` : `${(hours / 168).toFixed(1)} weeks`)
const ms = (seconds) => `${Math.round((seconds || 0) * 1000)} ms`
const pct = (value) => `${Math.round((value || 0) * 100)}%`
const metros = (sites = []) => sites.map((site) => site?.metro || byId(SITES, site)?.metro || site).filter(Boolean).join(" + ")

function powerPart(r) {
  const used = r.powerUsedMW || 0
  const cap = r.powerMW || 0
  const where = metros(r.sites) || "this metro"
  if (r.overPower) {
    return {
      state: "red",
      why: `These racks draw ${used.toFixed(2)} MW against the ${cap.toFixed(2)} MW available in ${where}, so they brown out.`,
      ask: `Would a hall that wastes less power, fewer racks, or a metro with more power keep the lights steady?`,
      step: (r.metroTerms?.powerMult || 1) < 1 ? "location" : "gpu",
      detail: `${r.powerLine || `${Math.round(r.siteKW || 0)} kW of IT at PUE ${r.pue}`}, against ${Math.round((r.powerMW || 0) * 1000)} kW offered (${Math.round(r.powerCapKW || 0)} kW of IT at this PUE); overflow billed at 8×.`,
    }
  }
  if ((r.priceMult || 1) > 1.1) {
    return {
      state: "amber",
      why: `Power in ${where} costs about ${Math.round(((r.priceMult || 1) - 1) * 100)}% more than the cheapest metro on the list.`,
      ask: `Would a metro with cheaper power pay for itself without moving away from the people?`,
      step: "location",
      detail: `Power price ×${(r.priceMult || 1).toFixed(2)} (game value).`,
    }
  }
  return { state: "green", why: `${used.toFixed(2)} of ${cap.toFixed(2)} MW in ${where}: the lights stay on.`, ask: "", detail: `${r.powerLine || `PUE ${r.pue}, ${Math.round(r.facilityKW || 0)} kW at the meter`}, of ${Math.round(cap * 1000)} kW offered.` }
}

function coolingPart(r) {
  const platform = r.platform
  const hall = r.hall
  if (platform?.cooling === "liquid" && hall?.cooling !== "liquid") {
    return {
      state: "red",
      why: `${platform.name} needs cold plates, and the ${hall?.name?.toLowerCase() || "air hall"} only has fans, so the racks overheat and crawl.`,
      ask: `Would the liquid-cooled hall let these racks run at full speed?`,
      detail: `Thermal throttle to 15% and a failure bill on every rack.`,
    }
  }
  if (platform && hall && platform.rackKW > hallRackCap(hall)) {
    const contained = byId(HALLS, "C")
    return {
      state: "red",
      why: `${platform.name} runs at ${platform.rackKW} kW a rack, more than this hall's ${hall.maxRackKW} kW, so it throttles.`,
      ask: contained && platform.rackKW <= hallRackCap(contained)
        ? `Would cold aisle containment keep these racks at full speed?`
        : `Would a hall rated for hotter racks keep them at full speed?`,
      detail: `Throttled to 35%. Containment takes up to ${contained?.maxRackKW ?? 30} kW a rack, a rear door ${byId(HALLS, "R")?.maxRackKW ?? 70} kW.`,
    }
  }
  if (platform?.cooling !== "liquid" && hall?.cooling === "liquid") {
    return {
      state: "amber",
      why: `Fan-cooled racks in the liquid hall still breathe air, so you pay the liquid fit-out and waste as much power as fans do.`,
      ask: `Would cold aisle containment or a rear-door hall cool these racks for less, and sooner?`,
      detail: `Effective PUE ${r.pue} on a ${hall.fitOutWeeks}-week fit-out.`,
    }
  }
  const liquidLate = (r.leadParts || []).find((part) => part.id === "hall")
  if (liquidLate && r.lateWeeks > 0 && liquidLate.weeks >= (r.liveWeeks || 0) - 1e-9) {
    return {
      state: "amber",
      why: `The liquid hall fit-out in ${metros(r.sites)} is the slowest part, so you launch late.`,
      ask: `Is a metro with a liquid hall ready sooner on the list?`,
      step: "location",
      detail: `Fit-out ${liquidLate.weeks} weeks against a week ${r.scenario?.deadlineWeeks} deadline.`,
    }
  }
  if (hall?.id === "A" && (r.siteKW || 0) > 0.75 * (r.powerCapKW || Infinity)) {
    return {
      state: "amber",
      why: `Fans spend ${Math.round((hall.pue - 1) * 100)}% of the power on cooling, and the room is nearly full.`,
      ask: `Would cold aisle containment waste less on cooling and feed more of this power room to the GPUs?`,
      detail: `PUE ${hall.pue} against ${byId(HALLS, "C")?.pue ?? 1.29} with containment, ${byId(HALLS, "R")?.pue ?? 1.28} behind a rear door.`,
    }
  }
  return { state: "green", why: `${platform?.name || "The racks"} fit the ${hall?.name?.toLowerCase() || "hall"} at PUE ${r.pue}.`, ask: "", detail: `${platform?.rackKW || 0} kW a rack under a ${hall?.maxRackKW || 0} kW limit.` }
}

function computePart(r) {
  const useCase = r.useCase || {}
  // The racks at full speed against the crowd. Cooling, power and the wire have their own lights.
  const rackTok = Number.isFinite(r.rackTok) ? r.rackTok : r.throughput || 0
  const coverage = r.demand > 0 ? Math.min(1, rackTok / r.demand) : 0
  const tokens = `${Math.round(rackTok).toLocaleString("en-GB")} of ${Math.round(r.demand || 0).toLocaleString("en-GB")} tok/s`
  // Defensive: the board's budget guard never lets a player reach an over-budget build.
  if (r.overBudget) {
    return {
      state: "red",
      why: `${r.racks}× ${r.platform?.name} costs ${formatMoney(r.finance)} more than the budget (game prices), so the factory is never paid for.`,
      ask: `Would fewer racks, or a cheaper rack, still serve the crowd inside the budget?`,
      detail: `Spend ${formatMoney(r.budgetSpend)} of ${formatMoney(r.budget)} (game values).`,
    }
  }
  if (r.bottleneck === "fit") {
    return { state: "red", why: `The ${r.useCase?.model} does not fit on these GPUs, so nothing comes out.`, ask: `Would a rack with more memory per GPU, or an NVL72 rack, load the model?`, detail: `Group of ${r.gpus} GPUs cannot hold the weights.` }
  }
  if (r.slowStream) {
    return {
      state: "red",
      why: `${r.platform?.name} streams each answer at about ${(r.streamTps || 0).toFixed(1)} tokens a second, below the ${useCase.tps || 0} people expect: a dev box, not a crowd server.`,
      ask: `Would GPUs with HBM memory stream every answer at full speed?`,
      detail: `${r.platform?.hbmTBs} TB/s of ${r.platform?.memKind || "memory"} against the ${r.useCase?.weightsGB || 0} GB model: ${tokens}.`,
    }
  }
  const gpuLate = (r.leadParts || []).find((part) => part.id === "gpu")
  if (r.lateWeeks > 0 && gpuLate && gpuLate.weeks >= (r.liveWeeks || 0) - 1e-9) {
    return {
      state: "red",
      why: `${r.platform?.name} arrives in week ${Math.ceil(r.liveWeeks)}, ${Math.ceil(r.lateWeeks)} weeks after the deadline, so the crowd waits on an empty hall.`,
      ask: `Would a rack that ships sooner serve the crowd on time?`,
      detail: `Lead ${gpuLate.weeks} weeks against a week ${r.scenario?.deadlineWeeks} deadline.`,
    }
  }
  if (coverage < 0.4) {
    return { state: "red", why: `These racks can serve ${pct(coverage)} of the crowd at full speed: the rest get nothing.`, ask: `Would more racks, or a stronger rack, serve the whole crowd?`, detail: `${tokens}.` }
  }
  if (coverage < 0.6) {
    return { state: "amber", why: `These racks can serve ${pct(coverage)} of the crowd at full speed.`, ask: `Would one more rack, or the KV cache, serve the rest?`, detail: `${tokens}.` }
  }
  if (rackTok > (r.demand || 0) * 1.6) {
    return { state: "amber", why: `You built ${(rackTok / Math.max(1, r.demand || 1)).toFixed(1)}× the demand, and idle GPUs still burn power and money.`, ask: `Would fewer racks serve the same crowd for less?`, detail: `${tokens}.` }
  }
  return { state: "green", why: `${r.racks}× ${r.platform?.name} can serve ${pct(coverage)} of the crowd.`, ask: "", detail: `${tokens}, live week ${Math.ceil(r.liveWeeks || 0)}.` }
}

function dataPart(r) {
  const useCase = r.useCase || {}
  const dataId = r.data?.id || "local"
  const needs = useCase.data && useCase.data !== "none"
  const home = r.dataHome
  if (needs && dataId === "local") {
    return {
      state: "red",
      why: `${useCase.name} needs its ${useCase.data === "bulk" ? "candidate libraries" : "documents"} beside the GPUs, and local drives hold none of them.`,
      ask: `Would shared storage${useCase.data === "required" ? " with a vector index" : ""} give the model something to know?`,
      detail: `Quality ${r.quality}, retrieval ${ms(r.data?.retrieval?.[useCase.data])}.`,
    }
  }
  if (needs && (r.quality || 1) < 1) {
    return {
      state: "amber",
      why: `The app scans files instead of searching an index, so answers are weaker and slower to start.`,
      ask: `Would a vector index find the right passages before the GPU starts?`,
      detail: `Quality ${r.quality}, retrieval ${ms(r.data?.retrieval?.[useCase.data])}.`,
    }
  }
  if (!needs && dataId !== "local") {
    return { state: "amber", why: `${r.data?.name} holds nothing this job reads: cost and power for nothing.`, ask: `Would local drives do, since nothing here is looked up?`, detail: `${formatMoney(r.data?.capex || 0)} and ${r.data?.kw || 0} kW per site (game values).` }
  }
  const prefillHeavy = !r.kv && (useCase.reuse || 0) >= 0.4 && (r.prefillShare || 0) >= 0.3
  if (prefillHeavy) {
    return {
      state: "amber",
      why: `GPUs spend ${pct(r.prefillShare)} of their time re-reading context they have already seen.`,
      ask: `Would the KV cache tier let them skip that re-read?`,
      step: "memory",
      detail: `Reuse ${pct(useCase.reuse)}, hit ${pct(r.hit)}.`,
    }
  }
  if (r.kv && (useCase.reuse || 0) < 0.1) {
    return { state: "amber", why: `A KV cache tier for prompts that are never repeated: parked notes nobody reloads.`, ask: `Would the GPUs do as well with the KV cache off?`, detail: `Reuse ${pct(useCase.reuse)}.`, step: "memory" }
  }
  if (r.hosts === "grace" && (useCase.ctx || 0) < 32000) {
    return { state: "amber", why: `CPU host memory parks contexts past 32k tokens; these prompts are ${(useCase.ctx || 0).toLocaleString("en-GB")} tokens.`, ask: `Would standard hosts do the same job for less?`, detail: `Host park share ${pct(r.hostPark)}.`, step: "memory" }
  }
  if (r.hosts === "dpu") {
    return { state: "amber", why: `BlueField DPUs isolate tenants; this job has one.`, ask: `Would standard hosts do, since nothing here is multi-tenant?`, detail: `$700k and 8 kW per site (game values).`, step: "memory" }
  }
  if (r.transfer && !r.transfer.local && r.transfer.hours > 48) {
    return {
      state: "amber",
      why: `Copying ${Math.round(r.transfer.gb / 1000)} TB from ${home?.city || "the data's home"} takes ${copyTime(r.transfer.hours)} over this link.`,
      ask: `Would a metro beside the data, or a fatter link, skip the copy?`,
      step: "location",
      detail: `${r.transfer.gbps} Gbps, ${formatMoney(r.transfer.cost)} egress (game).`,
    }
  }
  const words = needs ? `${r.data?.name}${r.kv ? " and a KV cache tier" : ""} keep the model fed.` : r.kv ? `The KV cache tier parks repeat context; nothing else is needed.` : `Nothing to look up, nothing to park: local drives are right.`
  return { state: "green", why: words, ask: "", detail: `Quality ${r.quality}, hit ${pct(r.hit)}${home ? `, ${Math.round(r.dataNearKm || 0)} km from ${home.city}` : ""}.` }
}

function connectionsPart(r) {
  const useCase = r.useCase || {}
  const batch = (useCase.legs || []).some((leg) => leg.slaExempt)
  const publicTrips = r.publicTrips || 0
  if (!batch && publicTrips > 0 && (!r.slaMet || (r.coverage || 0) < 0.5)) {
    return {
      state: "red",
      why: `The public internet adds jitter to ${publicTrips} trip${publicTrips > 1 ? "s" : ""} per answer, so people leave before the first word.`,
      ask: `Would a private path keep every answer steady?`,
      detail: `Network ${ms(r.netDelayS)}, TTFT ${ms(r.ttft)} against ${ms(useCase.ttft)}.`,
    }
  }
  if ((r.farShare || 0) >= 0.2) {
    return {
      state: "red",
      why: `${pct(r.farShare)} of the people are too far from ${metros(r.sites)} to get an answer in time.`,
      ask: `Would a second metro closer to them cut the round trip?`,
      step: "location",
      detail: `User round trip ${ms(r.userRttS)}.`,
    }
  }
  if (r.net?.unreached?.length) {
    return { state: "amber", why: `Traffic to ${r.net.unreached.join(" and ")} falls back to the public internet.`, ask: `Would a path that reaches that destination keep it private?`, detail: `Unreached: ${r.net.unreached.join(", ")}.` }
  }
  if (!r.slaMet && (r.netDelayS || 0) > 0.05) {
    return { state: "amber", why: `Round trips add ${ms(r.netDelayS)} before the first word.`, ask: `Would a nearer metro or a private path cut the trips short?`, detail: `TTFT ${ms(r.ttft)} against ${ms(useCase.ttft)}.` }
  }
  if (r.bandwidthCapped && (r.served || 0) < (r.demand || 0) * 0.98) {
    return { state: "amber", why: `The pipe is too thin for the tokens.`, ask: `Would a fatter link carry the whole crowd?`, detail: `Cap ${Math.round(r.capTok || 0).toLocaleString("en-GB")} tok/s.` }
  }
  if (batch && publicTrips === 0 && r.wire?.id && ["public", "peer"].includes(r.wire.id)) {
    return { state: "amber", why: `The lab's bulk feed rides a shared path, so fewer candidates are screened each hour.`, ask: `Would a fat private pipe from the lab feed the GPUs faster?`, detail: `${r.wire?.name} at ${r.wire?.gbps} Gbps.` }
  }
  if (r.orcaRemote) {
    return { state: "amber", why: `ORCA PT-3 is in London (LHR19); from ${metros(r.sites)} it is a remote link, and half its extra hits are lost.`, ask: `Would London put the GPUs beside ORCA?`, detail: `Hit multiplier ${(r.hitMult || 1).toFixed(2)}.`, step: "location" }
  }
  if ((r.net?.haircut || 0) > 0) {
    return { state: "amber", why: `A critical leg has no backup path, so an outage takes a bite.`, ask: `Would a redundant connection cover the outage?`, detail: `Haircut ${pct(r.net.haircut)}.` }
  }
  if ((r.priceMult || 1) <= 1 && (r.dataNearKm || 0) > 1500 && (useCase.toolCalls || 0) > 0) {
    return { state: "amber", why: `Every tool trip runs ${Math.round(r.dataKm || 0).toLocaleString("en-GB")} km to where the data lives.`, ask: `Would a metro nearer the data shorten those trips?`, detail: `Data round trip over ${Math.round(r.dataKm || 0)} km.`, step: "location" }
  }
  return { state: "green", why: `${metros(r.sites)} reach the people and the data on ${r.network?.name || "private links"}.`, ask: "", detail: `TTFT ${ms(r.ttft)}, network ${ms(r.netDelayS)}.` }
}

/** The five parts for one scored build. An unscored build leaves every part dark. */
export function ecosystem(result) {
  if (!result?.ok) return ECO_PARTS.map((part) => ({ ...part, state: "off", why: "Pick a GPU to light the ecosystem.", ask: "", detail: "" }))
  const parts = {
    power: powerPart(result),
    cooling: coolingPart(result),
    compute: computePart(result),
    data: dataPart(result),
    connections: connectionsPart(result),
  }
  return ECO_PARTS.map((part) => ({ ...part, step: DEFAULT_STEP[part.id], ...parts[part.id] }))
}

/** The single hint between rounds: the first red part, else the first amber part, or null when all is green. */
export function ecoHint(result) {
  const parts = ecosystem(result)
  return parts.find((part) => part.state === "red") || parts.find((part) => part.state === "amber") || null
}

/** The coach line: one question about the weakest part, or one happy sentence. */
export function ecoQuestion(result) {
  if (!result?.ok) return "Pick a GPU to start the factory."
  const hint = ecoHint(result)
  if (!hint) return "Every part is lit. Can you spend a little less and keep it that way?"
  return hint.ask || hint.why
}

/** Short counts for the review card: how many parts are green, amber and red. */
export function ecoSummary(result) {
  const parts = ecosystem(result)
  const count = (state) => parts.filter((part) => part.state === state).length
  return { green: count("green"), amber: count("amber"), red: count("red"), parts }
}
