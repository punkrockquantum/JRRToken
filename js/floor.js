import { HALLS, PLATFORMS, USE_CASES, byId } from "./data.js"
import { PALETTE, drawSprite } from "./sprites.js"

export const FW = 320
export const FH = 180
const FONT = "'Press Start 2P', monospace"
const MAX_DRAWN = 9

function label(ctx, value, x, y, color = PALETTE.w, size = 4, align = "left") {
  ctx.font = `${size}px ${FONT}`
  ctx.textAlign = align
  ctx.textBaseline = "top"
  ctx.fillStyle = PALETTE.k
  ctx.fillText(value, x + 1, y + 1)
  ctx.fillStyle = color
  ctx.fillText(value, x, y)
}

function hallRect(index) {
  return { x: 6 + index * 158, y: 14, w: 150, h: 148 }
}

function drawHall(ctx, hall, rect, t) {
  const liquid = hall.cooling === "liquid"
  ctx.fillStyle = PALETTE.k
  ctx.fillRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4)
  ctx.fillStyle = liquid ? "#18284c" : "#2a2a3c"
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.fillStyle = liquid ? "#203666" : "#34344a"
  for (let x = rect.x; x < rect.x + rect.w; x += 10) ctx.fillRect(x, rect.y, 1, rect.h)
  for (let y = rect.y; y < rect.y + rect.h; y += 10) ctx.fillRect(rect.x, y, rect.w, 1)
  if (liquid) {
    ctx.fillStyle = PALETTE.b
    ctx.fillRect(rect.x + 2, rect.y + 2, rect.w - 4, 3)
    ctx.fillStyle = PALETTE.B
    const flow = Math.floor(t * 20) % 8
    for (let x = rect.x + 2 + flow; x < rect.x + rect.w - 4; x += 8) ctx.fillRect(x, rect.y + 3, 3, 1)
  } else {
    for (let i = 0; i < 4; i += 1) drawSprite(ctx, "fan", rect.x + 8 + i * 36, rect.y + 2, 0.8)
  }
  ctx.fillStyle = PALETTE.k
  ctx.fillRect(rect.x + rect.w / 2 - 12, rect.y + rect.h - 4, 24, 6)
  ctx.fillStyle = PALETTE.y
  ctx.fillRect(rect.x + rect.w / 2 - 10, rect.y + rect.h - 2, 20, 2)
  label(ctx, `${hall.name.toUpperCase()} · ${hall.kind.toUpperCase()}`, rect.x + 4, rect.y - 11, liquid ? PALETTE.B : PALETTE.g)
}

function rackSprite(platformId) {
  return byId(PLATFORMS, platformId)?.sprite || "rackAir"
}

export function layout(plan) {
  const rows = []
  HALLS.forEach((hall, hallIndex) => {
    const rect = hallRect(hallIndex)
    const here = (plan.picks || []).filter((id) => plan.halls?.[id] === hall.id)
    here.forEach((id, slot) => {
      rows.push({ id, hall, rect, x: rect.x + 6, y: rect.y + 16 + slot * 64, build: plan.builds?.[id] || {} })
    })
  })
  return rows
}

function drawMission(ctx, row, deployment, t, running) {
  const useCase = byId(USE_CASES, row.id)
  drawSprite(ctx, useCase.icon, row.x, row.y, 0.75)
  label(ctx, useCase.name.toUpperCase(), row.x + 12, row.y + 1, PALETTE.y)
  const racks = Math.max(0, Number(row.build.racks) || 0)
  const sprite = rackSprite(row.build.platform)
  if (!row.build.platform) {
    label(ctx, "NO GPUS YET", row.x, row.y + 22, PALETTE.d)
    return []
  }
  const drawn = Math.min(racks, MAX_DRAWN)
  const spots = []
  for (let i = 0; i < drawn; i += 1) {
    const x = row.x + i * 13
    const y = row.y + 12
    const blink = running && Math.floor(t * 8 + i) % 3 === 0
    drawSprite(ctx, sprite, x, y)
    if (blink) {
      ctx.fillStyle = PALETTE.L
      ctx.fillRect(x + 3, y + 3, 2, 1)
    }
    spots.push({ x: x + 6, y: y + 10 })
  }
  if (racks > drawn) label(ctx, `+${racks - drawn}`, row.x + drawn * 13 + 1, row.y + 20, PALETTE.w)
  const name = byId(PLATFORMS, row.build.platform)?.name || ""
  label(ctx, `${racks}x ${name}`.toUpperCase(), row.x, row.y + 35, PALETTE.L)
  let sx = row.x
  const sy = row.y + 42
  if (row.build.data && row.build.data !== "local") {
    drawSprite(ctx, "vault", sx, sy, 0.75)
    sx += 14
  }
  if (row.build.kv) {
    drawSprite(ctx, "chest", sx, sy + 3, 0.9)
    sx += 13
  }
  if (row.build.orca && useCase.orca) {
    drawSprite(ctx, "orca", sx, sy + 3, 0.75)
    sx += 14
  }
  if (deployment?.ok && !deployment.slaMet && running) {
    const bob = Math.sin(t * 6) * 2
    drawSprite(ctx, "gremlin", row.x + 110, row.y + 16 + bob)
  }
  return spots
}

export function createFloor(canvas) {
  canvas.width = FW * 2
  canvas.height = FH * 2
  const ctx = canvas.getContext("2d")
  ctx.setTransform(2, 0, 0, 2, 0, 0)
  ctx.imageSmoothingEnabled = false

  function draw(plan, evaluation, { t = 0, running = false, progress = 0 } = {}) {
    ctx.fillStyle = "#101028"
    ctx.fillRect(0, 0, FW, FH)
    HALLS.forEach((hall, index) => drawHall(ctx, hall, hallRect(index), t))
    const rows = layout(plan)
    for (const row of rows) {
      const deployment = evaluation?.deployments?.find((item) => item.useCase?.id === row.id)
      const spots = drawMission(ctx, row, deployment, t, running)
      if (!running || !spots.length || !deployment?.ok) continue
      const door = { x: row.rect.x + row.rect.w / 2, y: row.rect.y + row.rect.h - 6 }
      const rate = Math.max(1, Math.round(6 * Math.min(1, deployment.coverage)))
      for (let i = 0; i < rate; i += 1) {
        const phase = (t * 0.9 + i / rate + row.y * 0.01) % 1
        const spot = spots[(i * 3 + Math.floor(t)) % spots.length]
        const x = spot.x + (door.x - spot.x) * phase - 5
        const y = spot.y + (door.y - spot.y) * phase - 5 - Math.sin(phase * Math.PI) * 8
        drawSprite(ctx, Math.floor(t * 6 + i) % 2 ? "token" : "token2", x, y, 0.8)
      }
    }
    HALLS.forEach((hall, index) => {
      const rect = hallRect(index)
      const queue = running ? Math.max(0, 5 - Math.floor(progress * 5)) : 5
      for (let i = 0; i < queue; i += 1) {
        drawSprite(ctx, "user", rect.x + rect.w / 2 - 28 + i * 12, rect.y + rect.h + 4, 1)
      }
    })
  }

  return { draw }
}
