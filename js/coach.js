import { stars } from "./model.js"
import { DESTINATIONS } from "./network.js"

const ADVICE = {
  fit: { title: "MODEL TOO BIG!", lesson: "nvlink", text: () => "The model doesn't fit on these GPUs, so pick ones with more memory or an NVL72 rack." },
  store: { title: "NO DOCUMENTS!", lesson: "rag", text: () => "This job needs your company's documents, so add File & Object or a Vector Index." },
  network: { title: "SLOW WIRE!", lesson: "network", text: () => "Fast GPUs can't fix a slow connection, so move the busy legs off the public internet." },
  sla: { title: "TOO SLOW!", lesson: "ttft", text: (r) => `The first word takes ${seconds(r.ttft)} against ${seconds(r.useCase.ttft)}, so add racks, a newer GPU, or the KV memory tier.` },
  bandwidth: { title: "THIN PIPE!", lesson: "network", text: () => "The pipe is too thin for the tokens, so turn the bandwidth up one step." },
  unreached: { title: "DEAD ENDS!", lesson: "network", text: (r) => `${names(r.net.unreached)} traffic rides the public internet, so give that leg a private path.` },
  idle: { title: "IDLE RACKS!", lesson: "rightsize", text: (r) => `You built ${(r.throughput / Math.max(1, r.demand)).toFixed(1)}× the demand, and idle GPUs still cost money, so take racks away.` },
  lead: { title: "LATE START!", lesson: "network", text: (r) => `You go live in week ${weeks(r.liveWeeks)}, ${weeks(r.lateWeeks)} weeks late, so swap the slowest part (${slowest(r)}).` },
  short: { title: "MORE MUSCLE!", lesson: "tps", text: (r) => `You serve ${Math.round(r.coverage * 100)}% of demand, so add racks or a newer GPU if budget and power allow.` },
  met: { title: "NICE BUILD!", lesson: "goodput", text: () => "Demand met on time, so now shave the cost: a cheaper pipe, or storage that just fits." },
}

const HURT = ["overspend", "space", "power", "thermal"]

function seconds(value) {
  if (!Number.isFinite(value)) return "—"
  return value < 1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(1)}s`
}

function weeks(value) {
  return Number.isInteger(value) ? String(value) : (value || 0).toFixed(1)
}

function slowest(r) {
  const parts = r.leadParts || []
  return parts.length ? parts.reduce((a, b) => (b.weeks > a.weeks ? b : a)).name : "network"
}

function names(ids = []) {
  return ids.map((id) => DESTINATIONS.find((d) => d.id === id)?.name || id).join(" and ")
}

function leadWarning(list) {
  const rank = [/financ|capex budget/i, /overheat|liquid cooling/i, /holds \d+ racks|overflow space/i, /brown|over its/i, /not delivered/i, /produce nothing|cannot load/i]
  for (const pattern of rank) {
    const hit = list.find((line) => pattern.test(line))
    if (hit) return hit
  }
  return list[0]
}

/** The biggest efficiency leak in one build, in plain words. */
export function coach(result) {
  if (!result) return null
  if (!result.ok) {
    return { title: "PICK A GPU", lesson: null, text: result.errors?.[0] || "Choose a GPU platform to start." }
  }
  if (HURT.includes(result.leak)) {
    return { title: "THIS WILL HURT", lesson: "budget", text: leadWarning(result.warnings || []) }
  }
  const prefillHeavy = !result.kv && result.useCase.reuse >= 0.4 && result.prefillShare >= 0.35
  if (prefillHeavy && ["short", "met", "idle", "sla"].includes(result.leak)) {
    const pct = Math.round(result.prefillShare * 100)
    return { title: "STOP RE-READING!", lesson: "kv", text: `GPUs spend ${pct}% of their time re-reading, so switch on the KV memory tier.` }
  }
  const advice = ADVICE[result.leak] || ADVICE.met
  return { title: advice.title, lesson: advice.lesson, text: advice.text(result) }
}

export const ADVICE_KEYS = Object.keys(ADVICE)

/**
 * Which plain-words lesson a build earns. The nerd board's line (below) and the booth's
 * one-sentence line (js/booth.js) share this so the two never disagree on the diagnosis.
 */
export function coachKey(result) {
  if (!result?.ok) return "start"
  if (result.leak === "overspend") return "overspend"
  if (result.leak === "power") return "power"
  if (result.leak === "thermal") return result.platform?.cooling === "liquid" && result.hall?.cooling !== "liquid" ? "liquid" : "hot"
  if (result.leak === "space") return "space"
  if (result.leak === "lead") return "lead"
  if (result.leak === "store") return "store"
  if (result.leak === "network" || result.leak === "unreached" || result.leak === "bandwidth") return "wires"
  /* Same call as the results headline: a public-internet build that misses its users is a connection lesson, not a location one. */
  if ((result.publicTrips || 0) > 0 && (!result.slaMet || (result.coverage || 0) < 0.5)) return "wires"
  if ((result.farShare || 0) >= 0.2) return "far"
  if (result.coverage < 0.45 || result.leak === "sla") return "slow"
  /* A build that keeps its promise and serves nearly everyone (or earns three stars) is not "short" before GO. */
  if (result.slaMet && ((result.coverage || 0) >= 0.95 || stars(result) >= 3)) return "nice"
  if (result.leak === "short" || result.leak === "kv") return "short"
  if (result.leak === "idle" || result.leak === "oversized") return "idle"
  return "nice"
}

const PLAIN = {
  start: "Pick a GPU to start the factory.",
  overspend: "Too many GPUs for your wallet: the money runs out before the hall pays off.",
  power: "The lights are flickering: these racks pull more power than the hall can feed.",
  liquid: "These racks need liquid cooling. Air alone cannot keep them running.",
  hot: "These GPUs run too hot for this hall. Cooling is the limit.",
  space: "The hall is stuffed full. More racks need more floor and power.",
  lead: "The racks arrive after the deadline. Pick a GPU you can get sooner.",
  store: "This story needs its documents in the same building.",
  wires: "People are waiting on a slow connection. Fast GPUs cannot fix slow wires.",
  far: "People in the far city are waiting. A hall closer to them answers faster.",
  slow: "People are waiting for the first word. Move closer or add the KV memory.",
  short: "The crowd is bigger than your GPUs. More muscle in a cool hall serves more people.",
  idle: "GPUs are sitting idle, and idle racks still burn power and money.",
  nice: "Nice! Close, cool and connected. Can you spend a little less?",
}

export const COACH_KEYS = Object.keys(PLAIN)

/**
 * The friendly line for the nerd game screen and the nerd results. Every line names the
 * data-center decision (cooling, location, connection, power or money) behind what the crowd is feeling.
 */
export function plainCoach(result) {
  return PLAIN[coachKey(result)]
}
