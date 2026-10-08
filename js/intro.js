import { PALETTE, drawSprite } from "./sprites.js"
import { play } from "./sound.js"

export const W = 320
export const H = 180
const FONT = "'Press Start 2P', monospace"

const PROMPT = "WHAT IS OUR TRAVEL POLICY?"
const WORDS = ["WHAT", " IS", " OUR", " TRAVEL", " POLICY", "?"]
const IDS = [3923, 374, 1057, 5944, 4947, 30]
const ANSWER = ["UP", " TO", " 3", " NIGHTS", ".", " BOOK", " IN", " THE", " PORTAL", "."]

export const SCENES = [
  { id: "prompt", start: 0, end: 6, title: "1 PROMPT", text: "You type a question." },
  { id: "tokens", start: 6, end: 12, title: "2 TOKENS", text: "AI reads text as tokens. One token is about 4 letters." },
  { id: "retrieval", start: 12, end: 19, title: "3 RETRIEVAL", text: "Everpure finds the right documents and adds them to the prompt. That's RAG." },
  { id: "prefill", start: 19, end: 26, title: "4 PREFILL", text: "The GPU reads it all at once and keeps notes: the KV cache." },
  { id: "generate", start: 26, end: 34, title: "5 GENERATION", text: "Then it writes one token at a time. Faster tokens, happier users." },
  { id: "quest", start: 34, end: 42, title: "YOUR QUEST", text: "Serve the most good tokens per megawatt. Beat the high score!" },
]
export const DURATION = SCENES[SCENES.length - 1].end

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const ease = (t) => 1 - Math.pow(1 - clamp(t), 3)
const lerp = (a, b, t) => a + (b - a) * t

function text(ctx, value, x, y, { size = 8, color = PALETTE.w, align = "left" } = {}) {
  ctx.font = `${size}px ${FONT}`
  ctx.textAlign = align
  ctx.textBaseline = "top"
  ctx.fillStyle = PALETTE.k
  ctx.fillText(value, x + 1, y + 1)
  ctx.fillStyle = color
  ctx.fillText(value, x, y)
}

function wrap(ctx, value, maxWidth, size) {
  ctx.font = `${size}px ${FONT}`
  const words = value.split(" ")
  const lines = []
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function box(ctx, x, y, w, h, fill = PALETTE.w, border = PALETTE.k) {
  ctx.fillStyle = border
  ctx.fillRect(x - 2, y, w + 4, h)
  ctx.fillRect(x, y - 2, w, h + 4)
  ctx.fillStyle = fill
  ctx.fillRect(x, y, w, h)
}

function bubble(ctx, x, y, w, value, { size = 4, tailX = null, color = PALETTE.k } = {}) {
  const lines = wrap(ctx, value, w - 10, size)
  const h = lines.length * (size + 4) + 8
  box(ctx, x, y, w, h)
  if (tailX != null) {
    ctx.fillStyle = PALETTE.w
    ctx.fillRect(tailX, y + h, 6, 3)
    ctx.fillRect(tailX + 1, y + h + 3, 3, 3)
  }
  lines.forEach((line, index) => {
    ctx.font = `${size}px ${FONT}`
    ctx.textAlign = "left"
    ctx.textBaseline = "top"
    ctx.fillStyle = color
    ctx.fillText(line, x + 5, y + 5 + index * (size + 4))
  })
  return h
}

function background(ctx, t) {
  ctx.fillStyle = "#101028"
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 40; i += 1) {
    const sx = (i * 73) % W
    const sy = (i * 37) % 70
    if ((Math.floor(t * 2) + i) % 7 === 0) continue
    ctx.fillStyle = i % 3 ? "#3a3a6a" : "#8080c0"
    ctx.fillRect(sx, sy, 1, 1)
  }
  ctx.fillStyle = "#1c1c40"
  ctx.fillRect(0, 128, W, 52)
  ctx.fillStyle = "#26265a"
  for (let x = 0; x < W; x += 16) ctx.fillRect(x, 128, 1, 52)
  for (let y = 128; y < H; y += 10) ctx.fillRect(0, y, W, 1)
}

function tokenRow(ctx, t, x0, y, count, { idsAlpha = 1, bob = true } = {}) {
  for (let i = 0; i < count; i += 1) {
    const x = x0 + i * 20
    const dy = bob ? Math.round(Math.sin(t * 6 + i) * 1.5) : 0
    drawSprite(ctx, (Math.floor(t * 3) + i) % 9 === 0 ? "token2" : "token", x, y + dy)
    if (idsAlpha > 0) {
      ctx.globalAlpha = idsAlpha
      text(ctx, String(IDS[i] ?? ""), x + 5, y + 13, { size: 4, color: PALETTE.Y, align: "center" })
      ctx.globalAlpha = 1
    }
  }
}

function drawPrompt(ctx, t) {
  const local = t / 6
  drawSprite(ctx, Math.floor(t * 4) % 2 ? "hero" : "hero2", 34, 104, 1.5)
  drawSprite(ctx, "iconCode", 66, 112, 1.5)
  const typed = PROMPT.slice(0, Math.floor(clamp((t - 0.6) / 3.2) * PROMPT.length))
  bubble(ctx, 40, 40, 170, typed + (Math.floor(t * 3) % 2 ? "_" : ""), { size: 4, tailX: 52 })
  if (local > 0.85) text(ctx, "ENTER!", 220, 60, { size: 8, color: PALETTE.L })
}

function drawTokens(ctx, t) {
  const local = (t - 6) / 6
  drawSprite(ctx, "hero", 34, 104, 1.5)
  const split = ease(local * 1.6)
  WORDS.forEach((word, i) => {
    const sx = 50 + i * 26
    const tx = 60 + i * 34
    const x = lerp(sx, tx, split)
    const y = lerp(48, 70, split)
    const colors = [PALETTE.B, PALETTE.L, PALETTE.O, PALETTE.P, PALETTE.c, PALETTE.y]
    box(ctx, x, y, Math.max(16, word.trim().length * 4 + 8), 12, colors[i])
    text(ctx, word.trim(), x + 4, y + 4, { size: 4, color: PALETTE.k })
  })
  if (local > 0.45) {
    const pop = ease((local - 0.45) * 3)
    ctx.globalAlpha = pop
    tokenRow(ctx, t, 64, 100, WORDS.length, { idsAlpha: pop })
    ctx.globalAlpha = 1
    text(ctx, "6 TOKENS", 250, 104, { size: 4, color: PALETTE.y })
  }
}

function drawRetrieval(ctx, t) {
  const local = (t - 12) / 7
  const march = ease(local * 1.4)
  drawSprite(ctx, "vault", 236, 76, 2.5)
  text(ctx, "EVERPURE", 256, 66, { size: 4, color: PALETTE.o, align: "center" })
  tokenRow(ctx, t, lerp(64, 100, march), 100, WORDS.length, { idsAlpha: 0.6 })
  if (local > 0.45) {
    const fly = ease((local - 0.45) * 2.2)
    for (let i = 0; i < 4; i += 1) {
      const x = lerp(236, 34 + i * 14, fly)
      const y = lerp(88, 102, fly) - Math.sin(fly * Math.PI) * 40
      drawSprite(ctx, "scroll", x, y, 1.25)
    }
    if (local > 0.5 && local < 0.55) play("coin")
    text(ctx, "+ 3 DOCS FOUND", 150, 52, { size: 4, color: PALETTE.L, align: "center" })
  }
  if (local > 0.2 && local < 0.6) {
    ctx.fillStyle = Math.floor(t * 8) % 2 ? PALETTE.O : PALETTE.o
    ctx.fillRect(232, 72, 48, 2)
  }
}

function drawPrefill(ctx, t) {
  const local = (t - 19) / 7
  drawSprite(ctx, "rackRubin", 140, 48, 3)
  text(ctx, "NVIDIA GPU", 158, 38, { size: 4, color: PALETTE.L, align: "center" })
  const intake = ease(local * 1.8)
  for (let i = 0; i < 10; i += 1) {
    const isDoc = i >= 6
    const startX = 20 + i * 12
    const x = lerp(startX, 150, intake)
    const y = lerp(110, 90, intake)
    if (intake < 0.98) drawSprite(ctx, isDoc ? "scroll" : "token", x, y)
  }
  if (local > 0.4) {
    const glow = Math.floor(t * 10) % 2
    ctx.fillStyle = glow ? PALETTE.L : PALETTE.G
    ctx.fillRect(140, 46, 36, 2)
    drawSprite(ctx, "chest", 214, 112, 2)
    text(ctx, "KV CACHE", 226, 102, { size: 4, color: PALETTE.c, align: "center" })
    const drops = Math.floor((local - 0.4) * 14)
    for (let i = 0; i < Math.min(drops, 6); i += 1) {
      const phase = clamp((local - 0.4) * 14 - i)
      const x = lerp(170, 220 + (i % 3) * 6, ease(phase))
      const y = lerp(80, 104 + Math.floor(i / 3) * 4, ease(phase))
      drawSprite(ctx, "gem", x, y)
    }
    const ttft = Math.min(0.4, (local - 0.4) * 0.8)
    text(ctx, `TTFT ${ttft.toFixed(2)}s`, 20, 56, { size: 4, color: PALETTE.y })
  }
}

function drawGenerate(ctx, t) {
  const local = (t - 26) / 8
  drawSprite(ctx, "rackRubin", 140, 48, 3)
  drawSprite(ctx, "chest", 214, 112, 2)
  drawSprite(ctx, "hero", 30, 104, 1.5)
  const count = Math.min(ANSWER.length, Math.floor(local * 1.25 * ANSWER.length))
  const answer = ANSWER.slice(0, count).join("")
  bubble(ctx, 20, 34, 110, answer || " ", { size: 4, tailX: 34 })
  const phase = (local * 1.25 * ANSWER.length) % 1
  if (count < ANSWER.length) {
    drawSprite(ctx, "token", lerp(146, 70, ease(phase)), lerp(84, 70, ease(phase)) - Math.sin(phase * Math.PI) * 12)
    if (phase < 0.1) play("token")
    ctx.fillStyle = PALETTE.c
    ctx.fillRect(216, 110, 20, 2)
  }
  text(ctx, "TTFT 0.40s", 200, 40, { size: 4, color: PALETTE.y })
  text(ctx, `${Math.min(count * 4 + 2, 42)} TOK/S`, 200, 52, { size: 4, color: PALETTE.L })
}

function drawQuest(ctx, t) {
  const local = (t - 34) / 8
  drawSprite(ctx, "prof", 40, 70, 3)
  drawSprite(ctx, "rackAir", 200, 84, 2)
  drawSprite(ctx, "rackLiquid", 228, 84, 2)
  drawSprite(ctx, "rackRubin", 256, 84, 2)
  drawSprite(ctx, "vault", 284, 100, 1.5)
  bubble(
    ctx,
    100,
    24,
    200,
    "I'M PROF. TOKEN! PICK 3 MISSIONS, FILL 2 DATA HALLS WITH NVIDIA + EVERPURE, AND SERVE THE MOST GOOD TOKENS PER MEGAWATT.",
    { size: 4, tailX: 108 },
  )
  if (local > 0.5 && Math.floor(t * 2) % 2) {
    text(ctx, "PRESS START", 220, 134, { size: 4, color: PALETTE.y, align: "center" })
  }
}

const DRAW = {
  prompt: drawPrompt,
  tokens: drawTokens,
  retrieval: drawRetrieval,
  prefill: drawPrefill,
  generate: drawGenerate,
  quest: drawQuest,
}

export function sceneAt(t) {
  return SCENES.find((scene) => t >= scene.start && t < scene.end) || SCENES[SCENES.length - 1]
}

export function renderIntro(ctx, t) {
  ctx.imageSmoothingEnabled = false
  background(ctx, t)
  const scene = sceneAt(t)
  DRAW[scene.id](ctx, t)
  ctx.fillStyle = PALETTE.d
  ctx.fillRect(0, 0, W, 3)
  ctx.fillStyle = PALETTE.y
  ctx.fillRect(0, 0, Math.round((t / DURATION) * W), 3)
}

export function createIntro(canvas, { onDone, onScene } = {}) {
  canvas.width = W * 2
  canvas.height = H * 2
  const ctx = canvas.getContext("2d")
  ctx.setTransform(2, 0, 0, 2, 0, 0)
  let raf = 0
  let start = 0
  let last = null
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  function frame(now) {
    const t = (now - start) / 1000
    if (t >= DURATION) {
      renderIntro(ctx, DURATION - 0.01)
      onDone?.()
      return
    }
    const scene = sceneAt(t)
    if (scene.id !== last) {
      last = scene.id
      onScene?.(scene)
      play("blip")
    }
    renderIntro(ctx, t)
    raf = requestAnimationFrame(frame)
  }

  return {
    start(at = 0) {
      cancelAnimationFrame(raf)
      last = null
      if (reduced) {
        renderIntro(ctx, SCENES[SCENES.length - 1].start + 1)
        onScene?.(SCENES[SCENES.length - 1])
        return
      }
      start = performance.now() - at * 1000
      raf = requestAnimationFrame(frame)
    },
    jump(sceneIndex) {
      const scene = SCENES[Math.max(0, Math.min(SCENES.length - 1, sceneIndex))]
      this.start(scene.start)
    },
    current() {
      return last
    },
    stop() {
      cancelAnimationFrame(raf)
    },
  }
}
