const ADVICE = {
  fit: {
    title: "MODEL TOO BIG!",
    lesson: "nvlink",
    text: "The model doesn't fit inside one NVLink group, so GPUs chat over the slow network. Pick GPUs with more HBM, or an NVL72 rack.",
  },
  retrieval: {
    title: "SLOW LOOKUPS!",
    lesson: "rag",
    text: "The documents live far away, so users wait. Add Everpure File & Object, or a Vector Index for instant lookups.",
  },
  ttft: {
    title: "TOO SLOW TO START!",
    lesson: "ttft",
    text: "Users wait too long for the first token. Add racks or newer GPUs, or turn on the Everpure KV cache so prompts aren't re-read.",
  },
  data: {
    title: "HUNGRY GPUS!",
    lesson: "goodput",
    text: "Without shared Everpure data, answers are worse, so fewer tokens count as good. Feed the GPUs!",
  },
  kv: {
    title: "MEMORY BOUND!",
    lesson: "hbm",
    text: "The GPUs are waiting on memory, not maths. Faster HBM (Rubin), FP4, or more racks help.",
  },
  compute: {
    title: "MORE MUSCLE NEEDED!",
    lesson: "tps",
    text: "Every GPU is flat out and users are still queueing. Add racks or pick a newer GPU.",
  },
  oversized: {
    title: "TOO MUCH FACTORY!",
    lesson: "rightsize",
    text: "You built far more than this mission needs. Idle GPUs still burn power. Take some racks away.",
  },
  met: {
    title: "NICE FIT!",
    lesson: "goodput",
    text: "Demand met on time. Can you hit it with fewer watts? Try fewer racks or a more efficient GPU.",
  },
}

const ERROR_ADVICE = {
  title: "CAN'T BUILD THAT!",
  lesson: null,
}

export function coach(result) {
  if (!result) return null
  if (!result.ok) {
    return { ...ERROR_ADVICE, text: result.errors[0] || "Choose a GPU platform to start." }
  }
  const prefillHeavy = !result.kv && result.useCase.reuse >= 0.4 && result.prefillShare >= 0.35
  if (prefillHeavy && result.bottleneck !== "fit" && result.bottleneck !== "retrieval") {
    const pct = Math.round(result.prefillShare * 100)
    return {
      title: "STOP RE-READING!",
      lesson: "kv",
      text: `Your GPUs spend ${pct}% of their time re-reading old prompts. The Everpure KV cache remembers them, so the GPUs can write new tokens instead.`,
    }
  }
  return ADVICE[result.bottleneck] || ADVICE.met
}

export const ADVICE_KEYS = Object.keys(ADVICE)
