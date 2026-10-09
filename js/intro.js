import { PALETTE, drawSprite, fitCanvas, text } from "./sprites.js"
import { play } from "./sound.js"

export const W = 480
export const H = 270
const FLOOR = 190

const PROMPT = "What is our travel policy?"
const WORDS = ["WHAT", "IS", "OUR", "TRAVEL", "POLICY", "?"]
const VALUES = [3923, 374, 1057, 5944, 4947, 30]
const WORD_COLORS = [PALETTE.B, PALETTE.L, PALETTE.O, PALETTE.P, PALETTE.c, PALETTE.y]
const ANSWER = ["Up", " to", " 3", " nights", ".", " Book", " in", " the", " portal", "."]

/**
 * One journey: prompt, retrieval, generation, a helper, then the quest.
 * `simple` is one sentence. `nerd` is the deeper dive for a basic technical audience.
 * Windows keep the timings the draw functions were built for; gaps between them are unused.
 */
export const SCENES = [
  {
    id: "prompt",
    stage: 0,
    start: 0,
    end: 14,
    title: "1 · PROMPT",
    simple: "You type a prompt, your question, and the AI reads it as tokens, the small word-parts it understands.",
    nerd: "A tokenizer splits your prompt into tokens, about four characters each in English. Each token becomes a numeric id, then an embedding vector the model computes with.",
    lesson: "token",
  },
  {
    id: "retrieval",
    stage: 1,
    start: 14,
    end: 22,
    title: "2 · RETRIEVAL",
    simple: "First the app can look up your own documents and add them to the prompt, and that is retrieval.",
    nerd: "In private AI with RAG, your documents were embedded and indexed earlier. At question time the application embeds the question, runs a similarity search in the vector index, and adds the top passages to the prompt before the model runs. The model itself does not search.",
    lesson: "rag",
  },
  {
    id: "generation",
    stage: 2,
    start: 22,
    end: 38,
    title: "3 · GENERATION",
    simple: "Then big computers read it all, remember it, and write the answer one token at a time, and that is generation.",
    nerd: "Weights, billions of learned numbers fixed after training, already sit in GPU memory. Prefill processes every prompt token in parallel and writes the KV cache, which sets time to first token. Decode then writes one token per step by re-reading the weights and the KV cache from HBM, and keeping that cache across follow-up turns avoids re-reading the whole chat.",
    lesson: "ttft",
  },
  {
    id: "helpers",
    stage: 2,
    start: 46,
    end: 54,
    title: "4 · HELPERS",
    simple: "Some jobs aren't about words: a special helper finds medicine matches faster.",
    nerd: "ORCA PT-3 is a photonic quantum accelerator using photonic boson sampling, single photons in a time-bin interferometer, working beside the GPUs. The GPUs build a molecule-protein binding graph, and the accelerator samples dense clusters so the classical optimizer finds the best binding pose, the max clique, about twice as often. That means more hits per candidate screened, not faster tokens.",
    lesson: "orca",
  },
  {
    id: "quest",
    stage: 3,
    start: 62,
    end: 70,
    title: "5 · YOUR QUEST",
    simple: "Closer computers and good memory mean faster answers, so build the best factory you can afford!",
    nerd: "Time to first token is prefill plus each round trip times the distance, and light covers about 200 km per millisecond in fibre. Private interconnection, a cross connect, a software-defined fabric, or dark fibre, stays predictable, while the public internet is the slowest and the jitteriest. Putting the computers close to the people and the documents cuts those round trips.",
    lesson: "profit",
  },
]

/** Which caption the player sees. Nerd mode is the deeper dive. */
export function sceneCaption(scene, nerd = false) {
  return nerd ? scene.nerd : scene.simple
}

/** The stages shown in the path bar at the top of every scene. */
export const PATH = ["PROMPT", "RETRIEVAL", "GENERATION"]

export const DURATION = SCENES[SCENES.length - 1].end

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const ease = (t) => 1 - Math.pow(1 - clamp(t), 3)
const lerp = (a, b, t) => a + (b - a) * t
const blink = (t, hz = 2) => Math.floor(t * hz) % 2 === 0

/** Extra canvas labels. The game screen sets this with the shared nerd-mode switch. */
let detail = false
export function setIntroDetail(on) {
  detail = Boolean(on)
}
export function introDetail() {
  return detail
}

const cues = new Set()
function cue(key, sound) {
  if (cues.has(key)) return
  cues.add(key)
  play(sound)
}

function box(ctx, x, y, w, h, fill = PALETTE.w, border = PALETTE.k) {
  ctx.fillStyle = border
  ctx.fillRect(x - 2, y, w + 4, h)
  ctx.fillRect(x, y - 2, w, h + 4)
  ctx.fillStyle = fill
  ctx.fillRect(x, y, w, h)
}

/** Framed container (HBM, memory tiers) with an optional title above it. */
function frame(ctx, x, y, w, h, title, color = PALETTE.c) {
  ctx.fillStyle = color
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4)
  ctx.fillStyle = "#141430"
  ctx.fillRect(x, y, w, h)
  if (title) text(ctx, title, x + w / 2, y - 14, { color, align: "center" })
}

/** 10x10 data block with a one-letter glyph (W = weights, K = KV cache). */
function block(ctx, x, y, color, glyph = "") {
  ctx.fillStyle = PALETTE.k
  ctx.fillRect(x - 1, y - 1, 12, 12)
  ctx.fillStyle = color
  ctx.fillRect(x, y, 10, 10)
  if (glyph) text(ctx, glyph, x + 1, y + 1, { color: PALETTE.k })
}

function building(ctx, x, y, w, h, t) {
  ctx.fillStyle = PALETTE.k
  ctx.fillRect(x - 2, y - 2, w + 4, h + 2)
  ctx.fillStyle = "#30305a"
  ctx.fillRect(x, y, w, h)
  const cols = Math.floor((w - 8) / 12)
  const rows = Math.floor((h - 8) / 12)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const on = (Math.floor(t * 3) + row * 3 + col) % 5 !== 0
      ctx.fillStyle = on ? PALETTE.y : "#1c1c40"
      ctx.fillRect(x + 6 + col * 12, y + 6 + row * 12, 6, 6)
    }
  }
}

function pixelLine(ctx, x1, y1, x2, y2, color) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
  ctx.fillStyle = color
  for (let i = 0; i <= steps; i += 1) {
    const p = steps ? i / steps : 0
    ctx.fillRect(Math.round(lerp(x1, x2, p)), Math.round(lerp(y1, y2, p)), 1, 1)
  }
}

function background(ctx, t) {
  ctx.fillStyle = "#101028"
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 60; i += 1) {
    const sx = (i * 97) % W
    const sy = (i * 41) % 120
    if ((Math.floor(t * 2) + i) % 7 === 0) continue
    ctx.fillStyle = i % 3 ? "#3a3a6a" : "#8080c0"
    ctx.fillRect(sx, sy, 1, 1)
  }
  ctx.fillStyle = "#1c1c40"
  ctx.fillRect(0, FLOOR, W, H - FLOOR)
  ctx.fillStyle = "#26265a"
  for (let x = 0; x < W; x += 24) ctx.fillRect(x, FLOOR, 1, H - FLOOR)
  for (let y = FLOOR; y < H; y += 12) ctx.fillRect(0, y, W, 1)
}

/* ---------- Scenes. Each returns the HTML speech-bubble text, or null. ---------- */

function drawPrompt(ctx, t) {
  const local = t / 7
  drawSprite(ctx, Math.floor(t * 4) % 2 ? "hero" : "hero2", 40, FLOOR - 32, 2)
  drawSprite(ctx, "iconCode", 84, FLOOR - 22, 2)
  text(ctx, "YOU", 56, FLOOR + 8, { align: "center" })
  building(ctx, 352, FLOOR - 72, 108, 72, t)
  text(ctx, "AI FACTORY", 406, FLOOR - 88, { color: PALETTE.L, align: "center" })
  ctx.fillStyle = PALETTE.d
  ctx.fillRect(116, FLOOR - 10, 236, 2)
  text(ctx, "WIRES", 234, FLOOR + 8, { color: PALETTE.g, align: "center" })
  const typed = Math.floor(clamp((local - 0.08) / 0.5) * PROMPT.length)
  const cursor = typed < PROMPT.length && blink(t, 3) ? "_" : ""
  if (local > 0.62) {
    if (blink(t, 4)) text(ctx, "ENTER!", 56, FLOOR - 48, { color: PALETTE.L, align: "center" })
    const p = ease((local - 0.62) / 0.33)
    drawSprite(ctx, "prompt", Math.round(lerp(112, 340, p)), FLOOR - 26 - Math.round(Math.sin(p * Math.PI) * 6), 2)
    if (p >= 1 && blink(t, 6)) {
      ctx.fillStyle = PALETTE.Y
      ctx.fillRect(352, FLOOR - 72, 108, 2)
    }
  }
  return PROMPT.slice(0, typed) + cursor
}

function drawTokens(ctx, t) {
  const local = (t - 7) / 7
  drawSprite(ctx, "hero", 16, FLOOR - 32, 2)
  const widths = WORDS.map((word) => word.length * 8 + 8)
  const total = widths.reduce((sum, w) => sum + w, 0) + (WORDS.length - 1) * 8
  let wx = Math.round((W - total) / 2)
  const split = ease((local - 0.2) / 0.4)
  WORDS.forEach((word, i) => {
    const slotX = 48 + i * 64
    const x = Math.round(lerp(wx, slotX + 32 - widths[i] / 2, split))
    const y = Math.round(lerp(56, 92, split))
    box(ctx, x, y, widths[i], 12, WORD_COLORS[i])
    text(ctx, word, x + 4, y + 2, { color: PALETTE.k })
    wx += widths[i] + 8
  })
  if (local > 0.5) {
    const pop = ease((local - 0.5) / 0.3)
    WORDS.forEach((_, i) => {
      const slotX = 48 + i * 64
      const bob = Math.round(Math.sin(t * 6 + i) * 1.5)
      drawSprite(ctx, (Math.floor(t * 3) + i) % 9 === 0 ? "token2" : "token", slotX + 22, Math.round(lerp(100, 120, pop)) + bob, 2)
      if (pop > 0.6) text(ctx, String(VALUES[i]), slotX + 32, 146, { color: PALETTE.Y, align: "center" })
    })
    if (pop >= 1) text(ctx, "6 TOKENS", W / 2, 168, { color: PALETTE.y, align: "center" })
  }
  return null
}

/** Dashed rectangle, used for the private-environment boundary. */
function dashedRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color
  for (let i = 0; i < w; i += 8) {
    ctx.fillRect(x + i, y, 4, 1)
    ctx.fillRect(x + i, y + h - 1, 4, 1)
  }
  for (let j = 0; j < h; j += 8) {
    ctx.fillRect(x, y + j, 1, 4)
    ctx.fillRect(x + w - 1, y + j, 1, 4)
  }
}

/*
 * Private AI with RAG. Labels sit away from every flight path:
 * index labels are below the floor line, where nothing flies.
 */
function drawRetrieval(ctx, t) {
  const local = (t - 14) / 8
  dashedRect(ctx, 4, 22, W - 8, 222, PALETTE.L)
  text(ctx, "YOUR PRIVATE SPACE", W - 12, 28, { color: PALETTE.L, align: "right" })
  text(ctx, "THE APP", 16, 28, { color: PALETTE.o })

  text(ctx, "TOKENS", 24, 42, { color: PALETTE.g })
  const intake = ease(local / 0.25)
  for (let i = 0; i < 6; i += 1) drawSprite(ctx, "token", Math.round(lerp(24 + i * 14, 166, intake)), 52)
  frame(ctx, 150, 46, 72, 22, null, PALETTE.P)
  text(ctx, "MATCH", 186, 53, { color: PALETTE.P, align: "center" })

  const index = { x: 392, y: FLOOR - 32 }
  drawSprite(ctx, "vault", index.x, index.y, 2)
  text(ctx, "YOUR DOCUMENTS", 408, FLOOR + 8, { color: PALETTE.o, align: "center" })
  text(ctx, detail ? "VECTOR INDEX" : "LIBRARY", 408, FLOOR + 20, { color: PALETTE.g, align: "center" })
  box(ctx, 360, FLOOR + 34, 96, 10, PALETTE.K, PALETTE.d)
  text(ctx, "SORTED EARLIER", 408, FLOOR + 35, { color: PALETTE.Y, align: "center" })

  if (local > 0.25) {
    const fly = ease((local - 0.25) / 0.25)
    const heights = [4, 9, 6, 11, 5, 8, 10, 3]
    heights.forEach((h, i) => {
      const x = lerp(230 + i * 5, index.x + 4 + (i % 4) * 6, fly)
      const y = lerp(68, index.y + 20, fly)
      ctx.fillStyle = i % 2 ? PALETTE.B : PALETTE.c
      ctx.fillRect(Math.round(x), Math.round(y) - h, 3, h)
    })
    if (fly < 1) text(ctx, "LOOKING", 258, 76, { color: PALETTE.c, align: "center" })
  }
  if (local > 0.48 && local < 0.6 && blink(t, 8)) {
    ctx.fillStyle = PALETTE.Y
    ctx.fillRect(index.x - 4, index.y - 6, 40, 2)
    text(ctx, "FOUND!", 408, index.y - 20, { color: PALETTE.Y, align: "center" })
  }

  text(ctx, "PROMPT", 24, 100, { color: PALETTE.g })
  for (let i = 0; i < 6; i += 1) drawSprite(ctx, "token", 24 + i * 14, 112)
  if (local > 0.58) {
    const back = ease((local - 0.58) / 0.25)
    for (let i = 0; i < 3; i += 1) {
      const x = lerp(index.x + 8, 112 + i * 14, back)
      const y = lerp(index.y + 8, 112, back) - Math.sin(back * Math.PI) * 40
      drawSprite(ctx, "scroll", Math.round(x), Math.round(y))
    }
    cue("rag-found", "coin")
    text(ctx, "+3 DOCUMENTS", 24, 132, { color: PALETTE.L })
    if (back >= 1) {
      text(ctx, "PROMPT + DOCS", 24, 148, { color: PALETTE.Y })
      text(ctx, "TO GENERATION", 24, 160, { color: PALETTE.Y })
    }
  }
  return null
}

/** Layers of learned weights inside HBM, each with a bias tag. Values match the 70B chat model at FP8. */
const LAYERS = [
  { x: 140, name: "L1" },
  { x: 204, name: "L2" },
  { x: 268, name: "L80" },
]

function drawPrefill(ctx, t) {
  const local = (t - 22) / 8
  frame(ctx, 120, 40, 216, 112, detail ? "HBM" : "BRAIN")
  box(ctx, 128, 46, 200, 10, PALETTE.P, PALETTE.k)
  text(ctx, detail ? "WEIGHTS" : "WHAT IT KNOWS", 228, 47, { color: PALETTE.k, align: "center" })
  if (detail) text(ctx, "PREFILL", 16, 24, { color: PALETTE.y })
  drawSprite(ctx, "rackRubin", 24, FLOOR - 40, 2)
  text(ctx, "BRAIN", 40, FLOOR - 56, { color: PALETTE.L, align: "center" })

  const sweep = clamp((local - 0.15) / 0.45)
  const columnX = Math.round(lerp(24, 340, ease(sweep)))
  LAYERS.forEach((layer) => {
    const lit = sweep > 0 && sweep < 1 && columnX + 30 >= layer.x && columnX <= layer.x + 40
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        ctx.fillStyle = lit ? PALETTE.Y : (row + col) % 2 ? PALETTE.P : PALETTE.p
        ctx.fillRect(layer.x + col * 10, 64 + row * 10, 8, 8)
      }
    }
  })

  if (sweep < 1) {
    for (let i = 0; i < 9; i += 1) {
      const x = columnX + (i % 3) * 10
      const y = 70 + Math.floor(i / 3) * 12
      drawSprite(ctx, i >= 6 ? "scroll" : "token", x, y)
    }
  }

  drawSprite(ctx, "chest", 392, FLOOR - 30, 2)
  text(ctx, detail ? "KV CACHE" : "MEMORY", 408, FLOOR - 44, { color: PALETTE.c, align: "center" })
  if (local > 0.45) {
    const drops = ((local - 0.45) / 0.3) * 6
    for (let i = 0; i < Math.min(6, Math.floor(drops) + 1); i += 1) {
      const phase = clamp(drops - i)
      const x = lerp(338, 396 + (i % 3) * 7, ease(phase))
      const y = lerp(96, FLOOR - 22, ease(phase)) - Math.sin(phase * Math.PI) * 20
      drawSprite(ctx, "gem", Math.round(x), Math.round(y))
    }
  }

  let status = "YOU ASKED"
  if (local >= 0.15) status = "READING"
  if (local >= 0.6) status = "MEMORY SAVED"
  if (local >= 0.8) status = "FIRST WORD!"
  text(ctx, status, W / 2, 236, { color: local >= 0.8 ? PALETTE.L : PALETTE.y, align: "center" })
  text(ctx, "READS IT ALL AT ONCE", W / 2, 220, { color: PALETTE.P, align: "center" })
  text(ctx, local >= 0.8 ? "QUICK!" : "WAIT...", 72, 200, { color: local >= 0.8 ? PALETTE.L : PALETTE.y })
  if (local >= 0.8) {
    const fly = ease((local - 0.8) / 0.15)
    drawSprite(ctx, "token", Math.round(lerp(336, 80, fly)), Math.round(lerp(100, 160, fly) - Math.sin(fly * Math.PI) * 30), 2)
    cue("prefill-first", "token")
  }
  return null
}

function drawDecode(ctx, t) {
  const local = (t - 30) / 8
  drawSprite(ctx, "hero", 24, FLOOR - 32, 2)
  drawSprite(ctx, "rackRubin", 272, FLOOR - 40, 2)
  text(ctx, detail ? "DECODE" : "BRAIN", 284, FLOOR - 56, { color: PALETTE.L, align: "center" })
  frame(ctx, 320, FLOOR - 84, 136, 84, detail ? "HBM" : "BRAIN")
  const steps = local * ANSWER.length
  const k = Math.min(ANSWER.length, Math.floor(steps))
  const phase = steps % 1
  const reading = k < ANSWER.length && phase < 0.4
  const flash = reading && blink(t, 12)
  text(ctx, "KNOWS", 328, FLOOR - 78, { color: PALETTE.P })
  for (let i = 0; i < 4; i += 1) block(ctx, 328 + i * 14, FLOOR - 66, flash ? PALETTE.Y : PALETTE.P, "W")
  text(ctx, detail ? "KV CACHE" : "MEMORY", 328, FLOOR - 44, { color: PALETTE.c })
  for (let i = 0; i < 4; i += 1) block(ctx, 328 + i * 14, FLOOR - 32, flash ? PALETTE.Y : PALETTE.c, "K")
  if (reading) {
    ctx.fillStyle = PALETTE.Y
    ctx.fillRect(298, FLOOR - 30, 22, 2)
  }
  if (k < ANSWER.length && phase >= 0.4) {
    const p = ease((phase - 0.4) / 0.6)
    drawSprite(ctx, "token", Math.round(lerp(276, 56, p)), Math.round(lerp(FLOOR - 56, FLOOR - 36, p) - Math.sin(p * Math.PI) * 50), 2)
    cue(`decode-${k}`, "token")
  }
  text(ctx, "ONE WORD", W / 2, 36, { color: PALETTE.y, align: "center" })
  text(ctx, "AT A TIME", W / 2, 52, { color: PALETTE.Y, align: "center" })
  text(ctx, "FAST", W / 2, 68, { color: PALETTE.L, align: "center" })
  return ANSWER.slice(0, k).join("")
}

const NODES = [[0, -44], [40, -22], [40, 22], [0, 44], [-40, 22], [-40, -22], [0, -12], [18, 12], [-18, 12]]
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6], [6, 7], [6, 8], [7, 8], [1, 7], [3, 7], [3, 8], [5, 8], [2, 7], [4, 8], [3, 6]]
const CLIQUE = [3, 6, 7, 8]

function drawOrca(ctx, t) {
  const local = (t - 46) / 8
  drawSprite(ctx, "rackRubin", 40, FLOOR - 40, 2)
  text(ctx, "BRAIN", 52, FLOOR - 56, { color: PALETTE.L, align: "center" })
  const cx = 210
  const cy = 118
  const shown = Math.min(NODES.length, Math.floor(clamp(local / 0.3) * NODES.length + 0.001))
  const found = local > 0.62
  const hot = (i) => found && CLIQUE.includes(i)
  EDGES.forEach(([a, b]) => {
    if (a >= shown || b >= shown) return
    const flicker = !found && local > 0.3 && (Math.floor(t * 10) + a * 3 + b) % 5 === 0
    const color = hot(a) && hot(b) ? PALETTE.L : flicker ? PALETTE.Y : PALETTE.d
    pixelLine(ctx, cx + NODES[a][0], cy + NODES[a][1], cx + NODES[b][0], cy + NODES[b][1], color)
  })
  NODES.forEach(([dx, dy], i) => {
    if (i >= shown) return
    const grow = hot(i) && blink(t, 3) ? 1 : 0
    ctx.fillStyle = PALETTE.k
    ctx.fillRect(cx + dx - 4 - grow, cy + dy - 4 - grow, 8 + grow * 2, 8 + grow * 2)
    ctx.fillStyle = hot(i) ? PALETTE.L : PALETTE.w
    ctx.fillRect(cx + dx - 3 - grow, cy + dy - 3 - grow, 6 + grow * 2, 6 + grow * 2)
  })
  if (found && blink(t, 3)) {
    ctx.fillStyle = PALETTE.Y
    ctx.fillRect(cx - 28, cy - 22, 56, 1)
    ctx.fillRect(cx - 28, cy + 54, 56, 1)
    ctx.fillRect(cx - 28, cy - 22, 1, 76)
    ctx.fillRect(cx + 27, cy - 22, 1, 76)
  }
  text(ctx, detail ? "BINDING GRAPH" : "MATCHES", cx, 28, { color: PALETTE.g, align: "center" })
  frame(ctx, 340, 48, 124, 96, detail ? "ORCA" : "HELPER", PALETTE.c)
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      ctx.fillStyle = "#2a2a4a"
      ctx.fillRect(356 + col * 24, 68 + row * 18, 18, 1)
      ctx.fillRect(362 + col * 24, 62 + row * 18, 1, 14)
    }
  }
  const photon = Math.floor(t * 6) % 16
  ctx.fillStyle = [PALETTE.c, PALETTE.P, PALETTE.y, PALETTE.L][photon % 4]
  ctx.fillRect(360 + (photon % 4) * 24, 64 + Math.floor(photon / 4) * 18, 4, 4)
  if (detail) text(ctx, "BOSON SAMPLE", 402, 156, { color: PALETTE.c, align: "center" })
  text(ctx, "MOLECULE", 40, 36, { color: PALETTE.g, align: "center" })
  if (local < 0.25) {
    const p = ease(local / 0.25)
    text(ctx, "CCO", Math.round(lerp(24, 150, p)), 52, { color: PALETTE.Y })
  }
  let status = "GRAPH"
  let color = PALETTE.y
  if (local >= 0.3 && local < 0.5) status = "CLASSICAL"
  else if (local >= 0.5 && local < 0.62) {
    status = "SAMPLE"
    color = PALETTE.c
    const p = ease((local - 0.5) / 0.12)
    drawSprite(ctx, "gem", Math.round(lerp(cx + 40, 360, p)), Math.round(lerp(cy, 80, p)))
  } else if (found) {
    status = "BEST POSE"
    color = PALETTE.L
    cue("orca-hit", "coin")
    text(ctx, ">2X HITS", 360, 176, { color: PALETTE.L })
  }
  text(ctx, status, 16, 12, { color })
  return null
}

const NET_LINKS = [
  { name: "XCON 0.1MS", ms: 2, color: PALETTE.L },
  { name: "FABRIC", ms: 8, color: PALETTE.c },
  { name: "DARK FIBER", ms: 16, color: PALETTE.B },
  { name: "PUBLIC NET", ms: 40, color: PALETTE.o, drop: true },
]

function drawNetwork(ctx, t) {
  const local = (t - 54) / 8
  text(ctx, "TRAINING", 8, 8, { color: PALETTE.d })
  drawSprite(ctx, "rackAir", 8, 22, 1)
  pixelLine(ctx, 6, 20, 26, 42, PALETTE.r)
  pixelLine(ctx, 26, 20, 6, 42, PALETTE.r)
  text(ctx, "1 HALL", 48, 24, { color: PALETTE.d })
  text(ctx, "NO DISTANCE", 48, 40, { color: PALETTE.d })

  text(ctx, "INFERENCE", 160, 8, { color: PALETTE.L })
  ;["USERS", "DATA", "TOOLS"].forEach((name, i) => {
    text(ctx, name, 160, 28 + i * 14, { color: PALETTE.g })
    ctx.fillStyle = PALETTE.y
    ctx.fillRect(230, 30 + i * 14, 16, 2)
  })
  building(ctx, 250, 22, 48, 48, t)
  text(ctx, "METRO A", 274, 74, { color: PALETTE.y, align: "center" })
  building(ctx, 360, 22, 48, 48, t)
  text(ctx, "METRO B", 384, 74, { color: PALETTE.y, align: "center" })

  let trips = 0
  NET_LINKS.forEach((link, i) => {
    const y = 100 + i * 28
    text(ctx, link.name, 8, y - 12, { color: link.color })
    text(ctx, `${link.ms} MS`, 150, y - 12, { color: link.color })
    ctx.fillStyle = "#2a2a4a"
    ctx.fillRect(220, y, 200, 2)
    const dropped = link.drop && Math.floor(t * 3) % 4 === 0
    if (dropped) {
      text(ctx, "DROP", 430, y - 4, { color: PALETTE.r })
    } else {
      const p = ((t - 54) / (0.6 + i * 0.35)) % 1
      const wobble = link.drop ? (Math.floor(t * 5) % 3) - 1 : 0
      box(ctx, Math.round(lerp(220, 410, p)), y - 2 + wobble * 3, 6, 6, link.color)
    }
    if (local > i / NET_LINKS.length) trips += 1
  })
  text(ctx, "200 KM / MS", 8, 214, { color: PALETTE.g })
  text(ctx, "TTFT", 130, 214, { color: PALETTE.y })
  ctx.fillStyle = "#1c1c40"
  ctx.fillRect(170, 214, 200, 10)
  ctx.fillStyle = PALETTE.y
  ctx.fillRect(170, 214, Math.round(40 + trips * 40), 10)
  text(ctx, `${trips} TRIPS`, 380, 214, { color: PALETTE.y })
  return null
}

function drawQuest(ctx, t) {
  const local = (t - 62) / 8
  drawSprite(ctx, "prof", 48, FLOOR - 48, 3)
  drawSprite(ctx, "rackAir", 272, FLOOR - 48, 2)
  drawSprite(ctx, "rackLiquid", 304, FLOOR - 50, 2)
  drawSprite(ctx, "rackRubin", 336, FLOOR - 38, 2)
  drawSprite(ctx, "vault", 392, FLOOR - 32, 2)
  text(ctx, "YOUR BUDGET", 316, FLOOR - 66, { color: PALETTE.g, align: "center" })
  text(ctx, "COMPUTERS", 316, FLOOR + 8, { color: PALETTE.L, align: "center" })
  text(ctx, "LIBRARY", 408, FLOOR + 8, { color: PALETTE.o, align: "center" })
  text(ctx, "LONDON", 316, 48, { color: PALETTE.y, align: "center" })
  if (detail) text(ctx, "200 KM / MS", 80, 48, { color: PALETTE.c })
  if (local > 0.3 && blink(t, 2)) text(ctx, "GO", W / 2, 232, { color: PALETTE.y, align: "center" })
  return null
}

const DRAW = {
  prompt: (ctx, t) => (t < 7 ? drawPrompt(ctx, t) : drawTokens(ctx, t)),
  retrieval: drawRetrieval,
  generation: (ctx, t) => (t < 30 ? drawPrefill(ctx, t) : drawDecode(ctx, t)),
  helpers: drawOrca,
  quest: drawQuest,
}

/** PROMPT ▶ RETRIEVAL ▶ GENERATION across the top, with the current stage lit. */
function drawPath(ctx, stage) {
  ctx.fillStyle = "#0b0b17"
  ctx.fillRect(0, 3, W, 16)
  const gap = 20
  const widths = PATH.map((name) => name.length * 8)
  let x = Math.round((W - widths.reduce((a, b) => a + b, 0) - gap * (PATH.length - 1)) / 2)
  PATH.forEach((name, i) => {
    const lit = stage >= PATH.length || i === stage
    const done = i < stage
    text(ctx, name, x, 7, { color: lit ? PALETTE.y : done ? PALETTE.L : PALETTE.d })
    x += widths[i]
    if (i < PATH.length - 1) {
      ctx.fillStyle = done || lit ? PALETTE.L : PALETTE.d
      for (let r = 0; r < 4; r += 1) ctx.fillRect(x + 7 + r, 7 + r, 1, 8 - r * 2)
      x += gap
    }
  })
}

export function sceneAt(t) {
  return SCENES.find((scene) => t >= scene.start && t < scene.end) || SCENES[SCENES.length - 1]
}

/**
 * Time inside one scene, counted from the moment the player entered it.
 * Story scenes play once and hold the last frame. A looping scene wraps.
 * The returned time stays inside the scene, so the next scene never starts by itself.
 */
export function sceneTime(index, elapsed, { hold = false } = {}) {
  const scene = SCENES[Math.max(0, Math.min(SCENES.length - 1, index))]
  const span = Math.max(0.001, scene.end - scene.start)
  const looping = scene.loop && !hold
  const safe = Math.max(0, Number(elapsed) || 0)
  const local = looping ? safe % span : Math.min(safe, span - 0.001)
  return { scene, t: scene.start + local, index: SCENES.indexOf(scene) }
}

/** Paints one frame and returns the speech-bubble text for the HTML overlay (or null). */
export function renderIntro(ctx, t) {
  ctx.imageSmoothingEnabled = false
  background(ctx, t)
  const scene = sceneAt(t)
  const bubble = DRAW[scene.id](ctx, t) ?? null
  const span = Math.max(0.001, scene.end - scene.start)
  const frac = (SCENES.indexOf(scene) + clamp((t - scene.start) / span)) / SCENES.length
  ctx.fillStyle = PALETTE.d
  ctx.fillRect(0, 0, W, 3)
  ctx.fillStyle = PALETTE.y
  ctx.fillRect(0, 0, Math.round(frac * W), 3)
  drawPath(ctx, scene.stage ?? 0)
  return bubble
}

export const INPUT_HOLD_MS = 400

/**
 * Decides whether a player input may move the intro on.
 * Input in the first INPUT_HOLD_MS of a scene is dropped, and so is any event
 * that began before the scene appeared (such as the click that opened the intro).
 */
export function createAdvanceGate({ now = () => performance.now(), holdMs = INPUT_HOLD_MS } = {}) {
  let shownAt = now()
  return {
    shown() {
      shownAt = now()
    },
    allow(eventTime) {
      if (now() - shownAt < holdMs) return false
      if (Number.isFinite(eventTime) && eventTime < shownAt) return false
      return true
    },
  }
}

export function createIntro(canvas, { onDone, onScene, onBubble } = {}) {
  let { ctx } = fitCanvas(canvas, W, H)
  let raf = 0
  let index = 0
  let entered = 0
  let lastBubble
  let running = false
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  function paint(t) {
    const bubble = renderIntro(ctx, t)
    if (bubble !== lastBubble) {
      lastBubble = bubble
      onBubble?.(bubble)
    }
  }

  function elapsed() {
    return reduced ? 1e9 : Math.max(0, (performance.now() - entered) / 1000)
  }

  function enter(nextIndex, { sound = null } = {}) {
    index = Math.max(0, Math.min(SCENES.length - 1, nextIndex))
    entered = performance.now()
    cues.clear()
    onScene?.(SCENES[index])
    paint(sceneTime(index, elapsed(), { hold: reduced }).t)
    if (sound) play(sound)
  }

  function frame() {
    if (!running) return
    paint(sceneTime(index, elapsed(), { hold: reduced }).t)
    raf = requestAnimationFrame(frame)
  }

  function arm() {
    running = true
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(frame)
  }

  return {
    /** Begin at the first scene. Animation time starts at zero. */
    start() {
      enter(0)
      arm()
    },
    next() {
      if (index >= SCENES.length - 1) {
        onDone?.()
        return false
      }
      enter(index + 1, { sound: "blip" })
      return true
    },
    prev() {
      if (index <= 0) return false
      enter(index - 1, { sound: "back" })
      return true
    },
    /** Replay the chosen scene from its first frame. */
    jump(sceneIndex) {
      enter(sceneIndex, { sound: "blip" })
      arm()
      return index
    },
    current() {
      return SCENES[index].id
    },
    resize() {
      ctx = fitCanvas(canvas, W, H).ctx
      paint(sceneTime(index, elapsed(), { hold: reduced }).t)
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
    },
  }
}
