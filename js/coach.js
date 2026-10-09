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

/** One friendly sentence for the game screen. The detailed coach stays for the model tests. */
export function plainCoach(result) {
  if (!result?.ok) return "Pick a size of brain to start."
  const minutes = result.humanMinutes || 0
  const serve = minutes
    ? `Serve more people: every answer saves ${minutes} minutes of someone's day.`
    : "Serve more people."
  if (result.leak === "overspend") return "Too many brains for your wallet!"
  if (result.leak === "power") return "The lights are flickering. Too much power!"
  if (result.leak === "thermal") {
    if (result.platform?.cooling === "liquid" && result.hall?.cooling !== "liquid") return "These racks need liquid cooling"
    return "These brains are too hot for this hall!"
  }
  if (result.leak === "space") return "The hall is stuffed full!"
  if (result.leak === "lead") return "The trucks are late. Pick something quicker!"
  if (result.leak === "store") return "This story needs a library!"
  if (result.leak === "network" || result.leak === "unreached" || result.leak === "bandwidth") return "People are waiting... try faster wires."
  if (result.coverage < 0.45 || result.leak === "sla") return "People are waiting... move closer or add memory."
  if (result.leak === "short" || result.leak === "kv") return serve
  if (result.leak === "idle" || result.leak === "oversized") return "Too many brains sitting around!"
  return "Nice! Can you spend a little less?"
}
