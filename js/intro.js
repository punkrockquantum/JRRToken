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
 * Five click-through scenes. `simple` is one or two short sentences. `nerd` is at most three.
 * Windows keep the timings the draw functions were built for; one scene may chain several.
 * `loop` replays the scene's own animation until the player continues.
 */
export const SCENES = [
  {
    id: "prompt",
    stage: 0,
    start: 0,
    end: 14,
    loop: true,
    title: "1 · PROMPT → TOKENS",
    simple: "You type a prompt, your question. The AI reads it as tokens, small word-parts, and gives each one a mathematical value.",
    nerd: "A tokenizer splits your prompt into tokens, about four characters each in English. Each token becomes a numeric id, then an embedding vector the model computes with. Every later step reads those vectors, not your letters.",
    lesson: "token",
  },
  {
    id: "generation",
    stage: 1,
    start: 14,
    end: 38,
    loop: true,
    title: "2 · RETRIEVAL → GENERATION",
    simple: "First the app can look up your own documents and add them to the prompt: retrieval. Then GPUs read it all, remember it, and write the answer one token at a time: generation.",
    nerd: "For retrieval the app embeds your question and runs a similarity search in a vector index built from your documents earlier, then adds the top passages to the prompt; the model never searches. The weights, billions of numbers fixed after training, already sit in GPU HBM, and prefill reads every prompt token at once and writes the KV cache, which sets time to first token. Decode then writes one token per step, re-reading the weights and the KV cache every time, so it is bound by memory bandwidth rather than maths.",
    lesson: "ttft",
  },
  {
    id: "ecosystem",
    stage: 2,
    start: 86,
    end: 100,
    loop: true,
    title: "3 · THE ECOSYSTEM",
    simple: "Every AI answer is born in a data center: power feeds it, cooling keeps it alive, GPUs think, data gives it something to know, and connections carry the answer to you.",
    nerd: "Power at a PUE near 1.2 on liquid and 1.38 on air feeds racks that cooling holds at about 40 kW on air and 100 to 240 kW on direct liquid. Compute is GPUs whose HBM bandwidth sets decode speed, fed by a vector index and a KV cache tier in the same hall. Connections carry round trips at about 200 km per millisecond, and take any one of the five away and the AI stops.",
    lesson: "pue",
  },
  {
    id: "factory",
    stage: 3,
    start: 38,
    end: 62,
    loop: true,
    title: "4 · THE FACTORY",
    simple: "Four kinds of chips share the work: GPU for the maths, CPU to organise, DPU to move data safely, QPU for special searches. Chips make heat, so halls are cooled by air or by liquid.",
    nerd: "GPU HBM bandwidth decides decode speed, a Grace or Vera-class CPU host can park the KV cache in its LPDDR, a BlueField-class DPU isolates tenants and offloads networking, and an ORCA PT-3 photonic quantum accelerator uses boson sampling to find molecule matches about 2× more often. Air, in-row coolers or a Rear Door Heat Exchanger handle up to about 70 kW per rack. Direct Liquid cooling to cold plates on the chips carries 100-240 kW per rack with a better PUE.",
    lesson: "pue",
  },
  {
    id: "wires",
    stage: 4,
    start: 62,
    end: 70,
    loop: true,
    title: "5 · THE WIRES",
    simple: "Inside the cluster, chips talk over super-fast links. Out to customers, the wire decides speed: public internet is slow and jittery, peering and private links are fast and steady.",
    nerd: "Inside, an NVLink domain joins 72 GPUs as one; outside, light covers about 200 km per millisecond, so time to first token is prefill plus round trips times distance. Peering and eyeball networks shorten the path to your users' ISPs, a cross connect is a cable inside the building, dark fiber is a cable of your own between your sites, and ServiceFabric sets up private software-defined links in minutes. ServiceFabric MCP is an agent configuring that same fabric through the Model Context Protocol: same latency, faster operations.",
    lesson: "network",
  },
  {
    id: "quest",
    stage: 5,
    start: 70,
    end: 86,
    loop: true,
    title: "6 · YOUR QUEST",
    simple: "Every job wants a different factory: chat wants closeness and memory, research wants big clusters, medicine wants a QPU, robots want millisecond answers. Build the best AI factory you can afford!",
    nerd: "Digital Realty runs 300+ data centers in 50+ metros on PlatformDIGITAL, serving hyperscalers, scaling AI companies, banks and labs. Power, cooling and ServiceFabric connectivity are already in those buildings, so the factory, the wire and the cooling can match the job. Pick the chips, the cooling and the links the job actually needs, inside the budget.",
    lesson: "profit",
  },
]

/** The ecosystem cutaway is shared by both intros; the nerd caption carries the numbers. */
const ECOSYSTEM_SCENE = SCENES.find((scene) => scene.id === "ecosystem")

/**
 * The booth intro: four click-through scenes, one sentence each, big sprites.
 * Nerd mode swaps in the six-scene deep dive above. Both sets share one timeline
 * (absolute seconds), so the draw windows below can be reused.
 */
export const SIMPLE_SCENES = [
  {
    id: "ask",
    stage: 0,
    start: 0,
    end: 22,
    loop: true,
    title: "1 · YOU ASK",
    simple: "You ask. The AI reads your words as tokens and writes the answer one token at a time.",
    lesson: "token",
  },
  { ...ECOSYSTEM_SCENE, stage: 1, title: "2 · THE ECOSYSTEM" },
  {
    id: "takeaway",
    stage: 2,
    start: 100,
    end: 108,
    loop: true,
    title: "3 · TAKE ONE AWAY",
    simple: "Take any one away and the AI stops: no power, no maths; no cooling, no GPUs; no data, nothing to know; no connection, no answer.",
    lesson: "pue",
  },
  {
    id: "build",
    stage: 3,
    start: 38,
    end: 54,
    loop: true,
    title: "4 · YOUR QUEST",
    simple: "Closer, cooler and better connected means faster answers for less money. Build the best AI factory you can afford!",
    lesson: "profit",
  },
]

/** Which caption the player sees. Nerd mode is the deeper dive. */
export function sceneCaption(scene, nerd = false) {
  return nerd ? scene.nerd || scene.simple : scene.simple
}

/** The scene set for the current mode: four booth scenes, or the six-scene deep dive. */
export function scenesFor(nerd = false) {
  return nerd ? SCENES : SIMPLE_SCENES
}

/**
 * Where to land when the player flips nerd mode mid-intro: the scene that covers the
 * same ground. Booth scene 1 is prompt + generation, 2 and 3 are the ecosystem, 4 is the quest.
 */
export function matchingScene(index, toNerd) {
  const i = Math.max(0, Number(index) || 0)
  if (toNerd) return [0, 2, 2, 5][Math.min(3, i)]
  return i <= 1 ? 0 : i === 2 ? 1 : 3
}

/** The stages shown in the path bar at the top of every scene, one per scene. */
export const PATH = ["PROMPT", "GENERATION", "ECOSYSTEM", "FACTORY", "WIRES", "QUEST"]
export const SIMPLE_PATH = ["ASK", "ECOSYSTEM", "TAKE ONE AWAY", "BUILD"]

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
  text(ctx, "CONNECTION", 234, FLOOR + 8, { color: PALETTE.g, align: "center" })
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
  const local = (t - 62) / 8
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
      const p = ((t - 62) / (0.6 + i * 0.35)) % 1
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

function drawLesson(ctx, t, start, labels, arts) {
  const span = 8
  const local = ((t - start) % span + span) % span / span
  labels.forEach((name, i) => {
    const x = 48 + i * Math.floor(400 / labels.length)
    const bob = Math.round(Math.sin((local + i * 0.2) * Math.PI * 2) * 3)
    drawSprite(ctx, arts[i] || "token", x, FLOOR - 48 + bob, 2)
    text(ctx, name, x + 16, FLOOR + 10, { color: i === Math.floor(local * labels.length) % labels.length ? PALETTE.y : PALETTE.L, align: "center" })
  })
  return null
}

function drawQuest(ctx, t) {
  const local = (t - 78) / 8
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

/* ---------- Booth scenes: three sentences, big sprites. ---------- */

/** You ask, the words become tokens, the answer comes back one token at a time. */
function drawAsk(ctx, t) {
  const heroX = 20
  drawSprite(ctx, Math.floor(t * 4) % 2 ? "hero" : "hero2", heroX, FLOOR - 64, 4)
  text(ctx, "YOU", heroX + 32, FLOOR + 8, { align: "center" })
  building(ctx, 330, FLOOR - 96, 130, 96, t)
  text(ctx, "AI FACTORY", 395, FLOOR + 8, { color: PALETTE.L, align: "center" })
  ctx.fillStyle = PALETTE.d
  ctx.fillRect(92, FLOOR - 10, 238, 3)
  if (t < 6) {
    const typed = Math.floor(clamp((t - 0.3) / 3.5) * PROMPT.length)
    const cursor = typed < PROMPT.length && blink(t, 3) ? "_" : ""
    text(ctx, "YOU ASK", W / 2, 36, { color: PALETTE.y, align: "center", scale: 2 })
    if (t > 4.2) {
      const p = ease((t - 4.2) / 1.6)
      drawSprite(ctx, "prompt", Math.round(lerp(96, 318, p)), Math.round(FLOOR - 44 - Math.sin(p * Math.PI) * 14), 3)
      if (p >= 1 && blink(t, 6)) {
        ctx.fillStyle = PALETTE.Y
        ctx.fillRect(330, FLOOR - 96, 130, 3)
      }
    }
    return PROMPT.slice(0, typed) + cursor
  }
  if (t < 12) {
    const split = ease((t - 6) / 1.6)
    text(ctx, "WORDS BECOME TOKENS", W / 2, 24, { color: PALETTE.y, align: "center", scale: 2 })
    WORDS.forEach((word, i) => {
      const x = 44 + i * 66
      const y = Math.round(lerp(52, 60, split))
      box(ctx, x, y, 58, 18, WORD_COLORS[i])
      text(ctx, word, x + 29, y + 5, { color: PALETTE.k, align: "center" })
      if (t > 8) {
        const bob = Math.round(Math.sin(t * 6 + i) * 2)
        drawSprite(ctx, (Math.floor(t * 3) + i) % 9 === 0 ? "token2" : "token", x + 13, 90 + bob, 2)
        if (t > 9.2) text(ctx, String(VALUES[i]), x + 29, 130, { color: PALETTE.Y, align: "center" })
      }
    })
    if (t > 10) text(ctx, "6 TOKENS", W / 2, 150, { color: PALETTE.L, align: "center", scale: 2 })
    return null
  }
  const steps = ((t - 12) / 9.5) * ANSWER.length
  const k = Math.min(ANSWER.length, Math.floor(steps))
  const phase = steps % 1
  text(ctx, "THE ANSWER COMES BACK", W / 2, 24, { color: PALETTE.y, align: "center", scale: 2 })
  text(ctx, "ONE TOKEN AT A TIME", W / 2, 48, { color: PALETTE.L, align: "center", scale: 2 })
  if (k < ANSWER.length) {
    const p = ease(phase)
    drawSprite(ctx, "token", Math.round(lerp(326, 84, p)), Math.round(FLOOR - 70 - Math.sin(p * Math.PI) * 56), 3)
    cue(`ask-${k}`, "token")
  }
  return ANSWER.slice(0, k).join("")
}

/** The five parts of the ecosystem cutaway, left to right, with the words under each. */
export const ECO_SCENE_PARTS = [
  { id: "power", name: "POWER", note: "FEEDS IT", nerd: "PUE 1.2-1.4" },
  { id: "cooling", name: "COOLING", note: "KEEPS IT COOL", nerd: "40-240 KW/RACK" },
  { id: "compute", name: "COMPUTE", note: "GPUS THINK", nerd: "HBM SETS SPEED" },
  { id: "data", name: "DATA", note: "WHAT IT KNOWS", nerd: "VECTOR INDEX" },
  { id: "connections", name: "CONNECTIONS", note: "CARRIES IT", nerd: "200 KM/MS" },
]

// Cutaway geometry. The box starts below the path bar and the two-line title band (y 16-56),
// is wide enough that the five 8px-per-glyph part names never touch (76.8 px per column), and
// the person waiting for the answer stands just outside its right edge.
const CUT_LEFT = 8
const CUT_TOP = 58
const CUT_WIDTH = 400
const CUT_HEIGHT = 174
const HERO_X = 420

/** Label boxes of the cutaway's name and note rows (8 px per glyph), for layout tests. */
export function ecoLabelBoxes({ nerdNotes = false } = {}) {
  const colW = (CUT_WIDTH - 16) / 5
  const centre = (i) => Math.round(CUT_LEFT + 8 + colW * i + colW / 2)
  const box = (str, cx, y) => ({ text: str, x: cx - (str.length * 8) / 2, w: str.length * 8, y, h: 8 })
  return ECO_SCENE_PARTS.flatMap((part, i) => [
    box(part.name, centre(i), FLOOR + 8),
    box(nerdNotes ? part.nerd : part.note, centre(i), i % 2 === 0 ? FLOOR + 20 : FLOOR + 30),
  ]).concat([{ text: "frame", x: CUT_LEFT, w: CUT_WIDTH, y: CUT_TOP, h: CUT_HEIGHT }, { text: "title", x: 0, w: W, y: 0, h: 56 }])
}

/** How many parts are lit at `local` seconds into the ecosystem scene: one every 1.8 s. */
export function ecosystemLit(local) {
  return Math.min(ECO_SCENE_PARTS.length, Math.floor(Math.max(0, local) / 1.8) + (local >= 0 ? 1 : 0))
}

/**
 * The data-center cutaway. `states[i]` is "lit", "hot" (the one being introduced), "off" or
 * "broken". Tokens flow to the person on the right only when every part is lit.
 */
function drawCutaway(ctx, t, states, { nerdNotes = false } = {}) {
  const left = CUT_LEFT
  const width = CUT_WIDTH
  dashedRect(ctx, left, CUT_TOP, width, CUT_HEIGHT, PALETTE.L)
  text(ctx, "DATA CENTER", left + 8, CUT_TOP + 6, { color: PALETTE.L })
  const colour = (state) => (state === "hot" ? PALETTE.y : state === "lit" ? PALETTE.g : state === "broken" ? PALETTE.r : PALETTE.d)
  const live = (state) => state === "hot" || state === "lit"
  const colW = (width - 16) / 5
  const centre = (i) => Math.round(left + 8 + colW * i + colW / 2)

  // POWER: a pylon with a bolt and a busbar along the floor to every other part.
  const [power, cooling, compute, data, wires] = states
  const px = centre(0)
  pixelLine(ctx, px - 10, FLOOR - 4, px, FLOOR - 70, colour(power))
  pixelLine(ctx, px + 10, FLOOR - 4, px, FLOOR - 70, colour(power))
  pixelLine(ctx, px - 8, FLOOR - 40, px + 8, FLOOR - 40, colour(power))
  pixelLine(ctx, px - 5, FLOOR - 56, px + 5, FLOOR - 56, colour(power))
  if (live(power)) {
    const bolt = blink(t, 4) ? PALETTE.Y : PALETTE.y
    pixelLine(ctx, px + 2, FLOOR - 92, px - 4, FLOOR - 78, bolt)
    pixelLine(ctx, px - 4, FLOOR - 78, px + 3, FLOOR - 78, bolt)
    pixelLine(ctx, px + 3, FLOOR - 78, px - 3, FLOOR - 64, bolt)
  } else if (power === "broken") {
    text(ctx, "X", px, FLOOR - 92, { color: PALETTE.r, align: "center", scale: 2 })
  }
  ctx.fillStyle = live(power) ? PALETTE.y : PALETTE.d
  ctx.fillRect(px, FLOOR - 2, centre(4) - px, 2)

  // COOLING: a fan and a pipe; cold dots rise when it runs, heat shimmer when it is broken.
  const cx = centre(1)
  drawSprite(ctx, "fan", cx - 30, FLOOR - 76, 3)
  drawSprite(ctx, "pipe", cx + 6, FLOOR - 68, 3)
  if (live(cooling) && live(power)) {
    for (let i = 0; i < 8; i += 1) {
      const phase = (t * 1.4 + i * 0.13) % 1
      const x = cx - 30 + ((i * 23) % 60)
      const y = Math.round(lerp(FLOOR - 82, CUT_TOP + 10, phase))
      ctx.fillStyle = phase < 0.5 ? PALETTE.r : PALETTE.B
      ctx.fillRect(x, y, 3, 3)
    }
  }
  if (cooling === "broken") text(ctx, "X", cx, FLOOR - 100, { color: PALETTE.r, align: "center", scale: 2 })

  // COMPUTE: three racks; maths glyphs float when they think, red when they overheat.
  const rx = centre(2)
  for (let i = 0; i < 3; i += 1) drawSprite(ctx, i === 1 ? "rackLiquid" : "rackAir", rx - 36 + i * 24, FLOOR - 70, 2)
  if (live(compute) && live(power) && live(cooling)) {
    const glyphs = ["+", "×", "=", "÷"]
    for (let i = 0; i < 5; i += 1) {
      const gx = rx - 32 + ((i * 29 + Math.floor(t * 5) * 11) % 64)
      const gy = 64 + ((i * 23 + Math.floor(t * 3) * 7) % 44)
      text(ctx, glyphs[(i + Math.floor(t * 4)) % glyphs.length], gx, gy, { color: PALETTE.Y })
    }
  } else if (cooling === "broken" && live(compute)) {
    ctx.fillStyle = blink(t, 3) ? PALETTE.r : PALETTE.O
    ctx.fillRect(rx - 40, FLOOR - 74, 76, 2)
  }
  if (compute === "broken") text(ctx, "X", rx, FLOOR - 100, { color: PALETTE.r, align: "center", scale: 2 })

  // DATA: the vault and a gem; the gem glows when the model has something to know.
  const dx = centre(3)
  drawSprite(ctx, "vault", dx - 18, FLOOR - 64, 3)
  if (live(data) && live(power)) drawSprite(ctx, "gem", dx - 8, FLOOR - 86 + Math.round(Math.sin(t * 4) * 3), 2)
  if (data === "broken") text(ctx, "X", dx, FLOOR - 100, { color: PALETTE.r, align: "center", scale: 2 })

  // CONNECTIONS: the wire out of the building to the person waiting on the right.
  const wx = centre(4)
  const heroX = HERO_X
  drawSprite(ctx, "hero", heroX, FLOOR - 48, 3)
  text(ctx, "YOU", heroX + 24, FLOOR + 8, { align: "center" })
  drawSprite(ctx, "user", wx - 12, FLOOR - 48, 3)
  ctx.fillStyle = live(wires) ? PALETTE.c : PALETTE.d
  ctx.fillRect(wx + 8, FLOOR - 24, heroX - wx - 8, 3)
  if (wires === "broken") text(ctx, "X", wx, FLOOR - 100, { color: PALETTE.r, align: "center", scale: 2 })

  const all = states.every(live)
  if (all) {
    for (let i = 0; i < 3; i += 1) {
      const p = (t / 1.2 + i / 3) % 1
      drawSprite(ctx, "token", Math.round(lerp(rx, heroX - 10, p)), FLOOR - 40 - Math.round(Math.sin(p * Math.PI) * 10), 2)
    }
  } else if (states.some((state) => state === "broken") && blink(t, 2)) {
    text(ctx, "NO ANSWER", heroX + 24, FLOOR - 70, { color: PALETTE.r, align: "center" })
  }

  // Names share one row (no neighbours touch at 76.8 px per column); the longer notes
  // alternate between two rows so each one has two columns of width to itself.
  ECO_SCENE_PARTS.forEach((part, i) => {
    const state = states[i]
    text(ctx, part.name, centre(i), FLOOR + 8, { color: colour(state), align: "center" })
    const note = nerdNotes ? part.nerd : part.note
    const row = i % 2 === 0 ? FLOOR + 20 : FLOOR + 30
    text(ctx, note, centre(i), row, { color: state === "hot" ? PALETTE.Y : state === "broken" ? PALETTE.r : PALETTE.d, align: "center" })
  })
  return all
}

/** The ecosystem scene: POWER, COOLING, COMPUTE, DATA, CONNECTIONS light up in sequence, then the answer flows. */
function drawEcosystem(ctx, t) {
  const local = t - 86
  const lit = ecosystemLit(local)
  const states = ECO_SCENE_PARTS.map((_, i) => (i < lit - 1 ? "lit" : i === lit - 1 && local < 9 ? "hot" : i < lit ? "lit" : "off"))
  const all = drawCutaway(ctx, t, states, { nerdNotes: detail })
  text(ctx, "EVERY AI ANSWER", W / 2, 22, { color: PALETTE.y, align: "center", scale: 2 })
  text(ctx, "IS BORN IN A DATA CENTER", W / 2, 44, { color: PALETTE.L, align: "center" })
  if (lit > 0 && lit <= ECO_SCENE_PARTS.length) cue(`eco-${lit}`, "blip")
  if (all) cue("eco-flow", "token")
  return null
}

/** Take one away: every 1.6 s a different part breaks, and the answer stops. */
function drawTakeaway(ctx, t) {
  const local = t - 100
  const broken = Math.floor(local / 1.6) % ECO_SCENE_PARTS.length
  const states = ECO_SCENE_PARTS.map((_, i) => (i === broken ? "broken" : "lit"))
  drawCutaway(ctx, t, states, { nerdNotes: detail })
  text(ctx, "TAKE ANY ONE AWAY", W / 2, 20, { color: PALETTE.r, align: "center", scale: 2 })
  text(ctx, "AND THE AI STOPS", W / 2, 40, { color: PALETTE.L, align: "center", scale: 2 })
  cue(`take-${broken}`, "back")
  return null
}

/** Closer, cooler, better connected: the three levers, then GO. */
function drawBuild(ctx, t) {
  const local = t - 38
  const focus = Math.floor(local / 3.5) % 3
  drawSprite(ctx, "prof", 16, FLOOR - 64, 4)
  text(ctx, "COACH", 48, FLOOR + 8, { color: PALETTE.P, align: "center" })
  const lanes = [
    { x: 130, name: "CLOSER", art: "user", note: "NEAR PEOPLE" },
    { x: 250, name: "COOLER", art: "fan", note: "LIQUID OR AIR" },
    { x: 370, name: "CONNECTED", art: "token", note: "PRIVATE WIRES" },
  ]
  lanes.forEach((lane, i) => {
    const hot = focus === i
    const bob = hot ? Math.round(Math.sin(t * 6) * 3) : 0
    if (i === 0) {
      building(ctx, lane.x - 32, FLOOR - 70 + bob, 44, 44, t)
      drawSprite(ctx, "user", lane.x + 18, FLOOR - 48 + bob, 3)
    } else if (i === 1) {
      drawSprite(ctx, "rackLiquid", lane.x - 36, FLOOR - 70 + bob, 3)
      drawSprite(ctx, "fan", lane.x + 8, FLOOR - 62 + bob, 3)
    } else {
      drawSprite(ctx, "token", lane.x - 36, FLOOR - 56 + bob, 3)
      ctx.fillStyle = hot ? PALETTE.c : PALETTE.d
      ctx.fillRect(lane.x + 8, FLOOR - 40, 40, 3)
      drawSprite(ctx, "hero", lane.x + 30, FLOOR - 64 + bob, 3)
    }
    text(ctx, lane.name, lane.x + 10, FLOOR + 8, { color: hot ? PALETTE.y : PALETTE.L, align: "center" })
    text(ctx, lane.note, lane.x + 10, FLOOR + 20, { color: hot ? PALETTE.Y : PALETTE.d, align: "center" })
  })
  text(ctx, "FASTER ANSWERS", W / 2 + 40, 30, { color: PALETTE.y, align: "center", scale: 2 })
  text(ctx, "FOR LESS MONEY", W / 2 + 40, 54, { color: PALETTE.L, align: "center", scale: 2 })
  if (local > 2 && blink(t, 2)) text(ctx, "GO", W / 2 + 40, 86, { color: PALETTE.y, align: "center", scale: 2 })
  return null
}

/* Each scene chains the draw windows it was built from; the windows' absolute times are unchanged. */
const DRAW = {
  ask: drawAsk,
  ecosystem: drawEcosystem,
  takeaway: drawTakeaway,
  build: drawBuild,
  prompt: (ctx, t) => (t < 7 ? drawPrompt(ctx, t) : drawTokens(ctx, t)),
  generation: (ctx, t) => (t < 22 ? drawRetrieval(ctx, t) : t < 30 ? drawPrefill(ctx, t) : drawDecode(ctx, t)),
  factory: (ctx, t) =>
    t < 46
      ? drawLesson(ctx, t, 38, ["GPU", "CPU", "DPU", "QPU"], ["rackLiquid", "rackAir", "token", "orca"])
      : t < 54
        ? drawOrca(ctx, t)
        : drawLesson(ctx, t, 54, ["AIR", "IN ROW", "DOOR", "LIQUID"], ["fan", "rackAir", "rackAir", "rackLiquid"]),
  wires: drawNetwork,
  quest: (ctx, t) => (t < 78 ? drawLesson(ctx, t, 70, ["CHAT", "RESEARCH", "MEDICINE", "ROBOTS"], ["iconChat", "iconBook", "iconFlask", "iconCode"]) : drawQuest(ctx, t)),
}

/** The stage names across the top, with the current stage lit. */
function drawPath(ctx, stage, path = PATH) {
  ctx.fillStyle = "#0b0b17"
  ctx.fillRect(0, 3, W, 16)
  const gap = 20
  const widths = path.map((name) => name.length * 8)
  let x = Math.round((W - widths.reduce((a, b) => a + b, 0) - gap * (path.length - 1)) / 2)
  path.forEach((name, i) => {
    const lit = stage >= path.length || i === stage
    const done = i < stage
    text(ctx, name, x, 7, { color: lit ? PALETTE.y : done ? PALETTE.L : PALETTE.d })
    x += widths[i]
    if (i < path.length - 1) {
      ctx.fillStyle = done || lit ? PALETTE.L : PALETTE.d
      for (let r = 0; r < 4; r += 1) ctx.fillRect(x + 7 + r, 7 + r, 1, 8 - r * 2)
      x += gap
    }
  })
}

export function sceneAt(t, scenes = SCENES) {
  return scenes.find((scene) => t >= scene.start && t < scene.end) || scenes[scenes.length - 1]
}

/**
 * Time inside one scene, counted from the moment the player entered it.
 * Story scenes play once and hold the last frame. A looping scene wraps.
 * The returned time stays inside the scene, so the next scene never starts by itself.
 */
export function sceneTime(index, elapsed, { hold = false, scenes = SCENES } = {}) {
  const scene = scenes[Math.max(0, Math.min(scenes.length - 1, index))]
  const span = Math.max(0.001, scene.end - scene.start)
  const looping = scene.loop && !hold
  const safe = Math.max(0, Number(elapsed) || 0)
  const local = looping ? safe % span : Math.min(safe, span - 0.001)
  return { scene, t: scene.start + local, index: scenes.indexOf(scene) }
}

/** Paints one frame and returns the speech-bubble text for the HTML overlay (or null). */
export function renderIntro(ctx, t, scenes = SCENES) {
  ctx.imageSmoothingEnabled = false
  background(ctx, t)
  const scene = sceneAt(t, scenes)
  const bubble = DRAW[scene.id](ctx, t) ?? null
  const span = Math.max(0.001, scene.end - scene.start)
  const frac = (scenes.indexOf(scene) + clamp((t - scene.start) / span)) / scenes.length
  ctx.fillStyle = PALETTE.d
  ctx.fillRect(0, 0, W, 3)
  ctx.fillStyle = PALETTE.y
  ctx.fillRect(0, 0, Math.round(frac * W), 3)
  drawPath(ctx, scene.stage ?? 0, scenes === SIMPLE_SCENES ? SIMPLE_PATH : PATH)
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

export function createIntro(canvas, { onDone, onScene, onBubble, scenes = SCENES } = {}) {
  let { ctx } = fitCanvas(canvas, W, H)
  let raf = 0
  let index = 0
  let entered = 0
  let lastBubble
  let running = false
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  function paint(t) {
    const bubble = renderIntro(ctx, t, scenes)
    if (bubble !== lastBubble) {
      lastBubble = bubble
      onBubble?.(bubble)
    }
  }

  function elapsed() {
    return reduced ? 1e9 : Math.max(0, (performance.now() - entered) / 1000)
  }

  function enter(nextIndex, { sound = null } = {}) {
    index = Math.max(0, Math.min(scenes.length - 1, nextIndex))
    entered = performance.now()
    cues.clear()
    onScene?.(scenes[index])
    paint(sceneTime(index, elapsed(), { hold: reduced, scenes }).t)
    if (sound) play(sound)
  }

  function frame() {
    if (!running) return
    paint(sceneTime(index, elapsed(), { hold: reduced, scenes }).t)
    raf = requestAnimationFrame(frame)
  }

  function arm() {
    running = true
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(frame)
  }

  return {
    /** Begin at a scene (the first by default). Animation time starts at zero. */
    start(at = 0) {
      enter(at)
      arm()
    },
    next() {
      if (index >= scenes.length - 1) {
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
      return scenes[index].id
    },
    position() {
      return index
    },
    resize() {
      ctx = fitCanvas(canvas, W, H).ctx
      paint(sceneTime(index, elapsed(), { hold: reduced, scenes }).t)
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
    },
  }
}
