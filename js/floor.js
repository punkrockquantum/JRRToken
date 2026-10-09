import { HALLS, NETWORKS, PLATFORMS, SITES, USE_CASES, byId } from "./data.js"
import { DESTINATIONS } from "./network.js"
import { PALETTE, drawSprite, fitCanvas, text } from "./sprites.js"

export const FW = 320
export const FH = 180
const MAX_DRAWN = 8
const WIRE_Y = 146
/** Fractional part in [0, 1), including when time goes negative. */
const wrap = (value) => ((value % 1) + 1) % 1

function label(ctx, value, x, y, color = PALETTE.w) {
  text(ctx, value, x, y, { color })
}

function splitRacks(racks, count) {
  return Array.from({ length: count }, (_, i) => Math.floor(racks / count) + (i < racks % count ? 1 : 0))
}

/** One hall per metro, side by side above the network wire. */
export function layout(plan) {
  const build = plan?.build || {}
  const hall = byId(HALLS, build.hall) || HALLS[0]
  const sites = (build.sites || []).map((id) => byId(SITES, id)).filter(Boolean)
  const count = Math.max(1, sites.length)
  const gap = 6
  const w = Math.floor((FW - 8 - gap * (count - 1)) / count)
  const racks = splitRacks(Math.max(0, Number(build.racks) || 0), count)
  return (sites.length ? sites : [null]).map((site, index) => {
    const rect = { x: 4 + index * (w + gap), y: 14, w, h: WIRE_Y - 22 }
    return { id: plan?.useCase, site, hall, rect, x: rect.x + 6, y: rect.y + 14, racks: racks[index], build }
  })
}

function drawHall(ctx, row) {
  const { rect, hall, site } = row
  const liquid = hall.cooling === "liquid"
  ctx.fillStyle = PALETTE.k
  ctx.fillRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4)
  ctx.fillStyle = liquid ? "#18284c" : "#2a2a3c"
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.fillStyle = liquid ? "#203666" : "#34344a"
  for (let x = rect.x; x < rect.x + rect.w; x += 10) ctx.fillRect(x, rect.y, 1, rect.h)
  for (let y = rect.y; y < rect.y + rect.h; y += 10) ctx.fillRect(rect.x, y, rect.w, 1)
  const name = site ? site.metro.toUpperCase() : "—"
  const max = Math.floor((rect.w - 8) / 8)
  label(ctx, name.length > max ? name.slice(0, max) : name, rect.x + 4, rect.y + 3, PALETTE.y)
  label(ctx, liquid ? "COLD" : "COOL", rect.x, 3, liquid ? PALETTE.B : PALETTE.g)
}

function along(points, p) {
  if (points.length < 2) return points[0] || { x: 0, y: 0 }
  const span = points.length - 1
  const x = Math.max(0, Math.min(0.999, p)) * span
  const i = Math.floor(x)
  const f = x - i
  return {
    x: points[i].x + (points[i + 1].x - points[i].x) * f,
    y: points[i].y + (points[i + 1].y - points[i].y) * f,
  }
}

function drawSite(ctx, row, result, t, running) {
  const useCase = byId(USE_CASES, row.id)
  const platform = byId(PLATFORMS, row.build.platform)
  if (!useCase || !platform) {
    label(ctx, "EMPTY", row.x, row.y + 18, PALETTE.d)
    return null
  }
  const perRow = Math.max(1, Math.floor((row.rect.w - 12) / 14))
  const drawn = Math.min(row.racks, MAX_DRAWN, perRow * 2)
  const spots = []
  for (let i = 0; i < drawn; i += 1) {
    const x = row.x + (i % perRow) * 14
    const y = row.y + 4 + Math.floor(i / perRow) * 16
    drawSprite(ctx, platform.sprite, x, y, 1)
    if (running && Math.floor(Math.max(0, t) * 8 + i) % 3 === 0) {
      ctx.fillStyle = PALETTE.L
      ctx.fillRect(x + 3, y + 4, 2, 1)
    }
    spots.push({ x: x + 6, y: y + 10 })
  }
  if (row.racks > drawn) label(ctx, `+${row.racks - drawn}`, row.x, row.y + 40, PALETTE.w)
  let sx = row.x
  const sy = row.y + 54
  const storage = []
  if (row.build.data && row.build.data !== "local") {
    drawSprite(ctx, "vault", sx, sy, 1)
    storage.push({ x: sx + 8, y: sy + 8 })
    sx += 20
  }
  if (row.build.kv) {
    drawSprite(ctx, "chest", sx, sy, 1)
    storage.push({ x: sx + 6, y: sy + 6 })
    sx += 18
  }
  const orcaAt = useCase.orca && row.build.orca ? { x: sx + 8, y: sy + 8 } : null
  if (orcaAt) drawSprite(ctx, "orca", sx, sy, 1)
  if (result?.ok && running && (!result.slaMet || result.coverage < 0.5)) drawSprite(ctx, "gremlin", row.rect.x + row.rect.w - 20, row.y + 4, 1)
  if (result?.overSpace) label(ctx, "FULL", row.rect.x + row.rect.w - 36, row.rect.y + row.rect.h - 10, PALETTE.r)
  const door = { x: row.rect.x + row.rect.w / 2, y: row.rect.y + row.rect.h }
  if (!running || !spots.length) return door
  const gpu = spots[0]
  const mid = storage[0] || gpu
  const path = [door, mid, gpu]
  if (orcaAt) path.push(orcaAt, gpu)
  path.push(door)
  for (let i = 0; i < 3; i += 1) {
    const p = wrap(t * 0.35 + i / 3)
    const pos = along(path, p)
    const sprite = orcaAt && p > 0.4 && p < 0.7 ? "gem" : p > 0.62 ? "token" : "scroll"
    drawSprite(ctx, sprite, pos.x, pos.y, 1)
  }
  return door
}

/** The wire under the halls, its destinations, and when it goes live. */
function drawWire(ctx, doors, result, t, running) {
  const net = result?.net
  const link = result?.network || byId(NETWORKS, "fabric")
  const needs = net?.needs || ["internet"]
  const unreached = net?.unreached || []
  ctx.fillStyle = link.id === "public" ? PALETTE.o : PALETTE.c
  ctx.fillRect(4, WIRE_Y, FW - 8, 2)
  for (const door of doors) ctx.fillRect(Math.round(door.x), door.y, 2, WIRE_Y - door.y)
  const late = (result?.lateWeeks || 0) > 0
  label(ctx, late ? "LATE" : "ON TIME", 4, WIRE_Y + 6, late ? PALETTE.o : PALETTE.c)
  const slot = Math.floor((FW - 8) / Math.max(1, needs.length))
  needs.forEach((dest, i) => {
    const plainDest = { internet: "PEOPLE", cloud: "FILES", partner: "TOOLS", metro: "CITIES" }
    const name = plainDest[dest] || (DESTINATIONS.find((d) => d.id === dest)?.short || dest).toUpperCase()
    const miss = unreached.includes(dest)
    label(ctx, `${miss ? "x" : ">"}${name.slice(0, 8)}`, 4 + i * slot, WIRE_Y + 18, miss ? PALETTE.o : PALETTE.L)
  })
  if (running) {
    ctx.fillStyle = PALETTE.w
    for (let i = 0; i < 3; i += 1) ctx.fillRect(4 + Math.round(wrap(t * 0.5 + i / 3) * (FW - 12)), WIRE_Y - 1, 3, 4)
    drawTruck(ctx, t, (result?.lateWeeks || 0) > 0)
    if (result?.overPower) drawLightning(ctx, t)
  }
}

function drawTruck(ctx, t, late) {
  const x = Math.round(wrap(t * (late ? 0.12 : 0.28)) * (FW - 28))
  ctx.fillStyle = late ? PALETTE.r : PALETTE.y
  ctx.fillRect(x, 158, 18, 8)
  ctx.fillRect(x + 3, 154, 10, 5)
  ctx.fillStyle = PALETTE.k
  ctx.fillRect(x + 2, 164, 4, 4)
  ctx.fillRect(x + 12, 164, 4, 4)
}

function drawLightning(ctx, t) {
  if (Math.floor(t * 8) % 2) return
  ctx.fillStyle = PALETTE.y
  ctx.fillRect(FW - 18, 6, 3, 8)
  ctx.fillRect(FW - 22, 12, 3, 8)
  ctx.fillRect(FW - 14, 18, 3, 8)
}

export function createFloor(canvas) {
  function draw(plan, result, { t = 0, running = false } = {}) {
    const time = Math.max(0, Number(t) || 0)
    const ctx = fitCanvas(canvas, FW, FH).ctx
    ctx.fillStyle = "#101028"
    ctx.fillRect(0, 0, FW, FH)
    const rows = layout(plan)
    canvas.dataset.sites = String(rows.filter((row) => row.site).length)
    canvas.dataset.network = plan?.build?.network || ""
    const doors = []
    for (const row of rows) {
      try {
        drawHall(ctx, row)
        const door = drawSite(ctx, row, result, time, running)
        if (door) doors.push(door)
      } catch (err) {
        console.error(err)
      }
    }
    try {
      drawWire(ctx, doors, result, time, running)
    } catch (err) {
      console.error(err)
    }
  }

  return { draw }
}
