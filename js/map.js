/**
 * The tiny map on the LOCATION step: where the users are, where the model and data live, and
 * the Digital Realty metros on offer. Pure geometry; main.js draws the result as SVG.
 */

import { DATA_HOMES, SITES, USER_BASES } from "./data.js"
import { kmBetween, metroOffers } from "./model.js"

export const MAP_W = 240
export const MAP_H = 150
const PAD = 22

function byId(list, id) {
  return list.find((row) => row.id === id)
}

/**
 * Equirectangular fit of the given points onto MAP_W × MAP_H with a margin. Longitude is scaled
 * by the cosine of the middle latitude so Europe is not squashed; a single point sits in the middle.
 */
function projector(points) {
  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const stretch = Math.max(0.2, Math.cos((midLat * Math.PI) / 180))
  const xs = lons.map((lon) => lon * stretch)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxLat - minLat, 1)
  const scale = Math.min((MAP_W - 2 * PAD) / spanX, (MAP_H - 2 * PAD) / spanY)
  const offsetX = (MAP_W - spanX * scale) / 2
  const offsetY = (MAP_H - spanY * scale) / 2
  return (p) => ({
    x: Math.round(offsetX + (p.lon * stretch - minX) * scale),
    y: Math.round(offsetY + (maxLat - p.lat) * scale),
  })
}

/** Roughly how wide a label is at the map's 8px pixel font. */
const CHAR_PX = 4.6
const LABEL_H = 10

/**
 * Give every point a label position that stays inside the frame and off its neighbours.
 * Labels start below their point in the top half and above it in the bottom half; a label that
 * would sit on an earlier one flips side, and a point sharing a spot with a same-named point
 * drops its label (the London metro and the London users are one word).
 */
function placeLabels(points) {
  const placed = []
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  for (const p of sorted) {
    const width = p.label.length * CHAR_PX
    const twin = placed.find((q) => q.label === p.label && Math.hypot(q.x - p.x, q.y - p.y) < 6)
    if (twin) {
      p.labelText = ""
      continue
    }
    const clampX = (x) => Math.round(Math.min(MAP_W - width / 2 - 2, Math.max(width / 2 + 2, x)))
    const clampY = (y) => Math.round(Math.min(MAP_H - 2, Math.max(8, y)))
    const spots = {
      below: { x: clampX(p.x), y: clampY(p.y + 15) },
      above: { x: clampX(p.x), y: clampY(p.y - 9) },
      right: { x: clampX(p.x + 9 + width / 2), y: clampY(p.y + 3) },
      left: { x: clampX(p.x - 9 - width / 2), y: clampY(p.y + 3) },
    }
    const order = p.y < MAP_H / 2 ? ["below", "above", "right", "left"] : ["above", "below", "right", "left"]
    const clashes = (spot) => placed.some((q) => q.labelText && Math.abs(q.labelX - spot.x) < (q.labelText.length * CHAR_PX + width) / 2 + 2 && Math.abs(q.labelY - spot.y) < LABEL_H)
    const side = order.find((name) => !clashes(spots[name])) || order[0]
    p.labelText = p.label
    p.labelX = spots[side].x
    p.labelY = spots[side].y
    p.labelSide = side
    placed.push(p)
  }
}

/**
 * Points and links for one story. `picked` is the list of chosen metro ids. Each point carries
 * kind (users, data, metro), x, y, label and `on` for chosen metros; users carry their share.
 * Labels come placed: labelText (empty when a twin already says it), labelX, labelY.
 * Links join each chosen metro to the data home and to every user place, with the distance.
 */
export function mapPoints(useCaseId, picked = []) {
  const users = (USER_BASES[useCaseId]?.places || []).map((place) => ({ kind: "users", ...place, label: place.city }))
  const home = DATA_HOMES[useCaseId]
  const data = home ? [{ kind: "data", lat: home.lat, lon: home.lon, label: home.city, city: home.city }] : []
  const chosen = new Set(picked)
  const metros = metroOffers(useCaseId)
    .map((offer) => byId(SITES, offer.id))
    .filter(Boolean)
    .map((site) => ({ kind: "metro", id: site.id, lat: site.lat, lon: site.lon, label: site.metro, on: chosen.has(site.id) }))
  const all = [...users, ...data, ...metros]
  if (!all.length) return { width: MAP_W, height: MAP_H, points: [], links: [] }
  /*
   * Fit the frame to the users and the metros. A data home an ocean away would crush them into
   * a corner, so when it lands outside the frame it is pinned to the edge and flagged `far`.
   */
  const cluster = [...users, ...metros]
  const project = projector(cluster.length ? cluster : all)
  const edge = 10
  const points = all.map((p) => {
    const xy = project(p)
    const inside = xy.x >= edge && xy.x <= MAP_W - edge && xy.y >= edge && xy.y <= MAP_H - edge
    if (inside || p.kind !== "data") return { ...p, ...xy, far: false }
    const label = `${xy.x < edge ? "◀ " : ""}${p.label}${xy.x > MAP_W - edge ? " ▶" : ""}`
    return { ...p, label, x: Math.min(MAP_W - edge, Math.max(edge, xy.x)), y: Math.min(MAP_H - edge, Math.max(edge, xy.y)), far: true }
  })
  placeLabels(points)
  const links = []
  for (const metro of points.filter((p) => p.kind === "metro" && p.on)) {
    for (const target of points.filter((p) => p.kind !== "metro")) {
      links.push({ kind: target.kind, from: metro, to: target, km: Math.round(kmBetween(metro, target)) })
    }
  }
  return { width: MAP_W, height: MAP_H, points, links }
}

/** One caption under the map: how far the chosen metros sit from the users and the data. */
export function mapCaption(useCaseId, picked = []) {
  const { links } = mapPoints(useCaseId, picked)
  if (!links.length) return "Pick a metro to measure the trips."
  const userLinks = links.filter((link) => link.kind === "users")
  const dataLinks = links.filter((link) => link.kind === "data")
  const nearestUsers = userLinks.length ? Math.min(...userLinks.map((link) => link.km)) : null
  const nearestData = dataLinks.length ? Math.min(...dataLinks.map((link) => link.km)) : null
  const parts = []
  if (nearestUsers != null) parts.push(nearestUsers < 30 ? "in the nearest users' own city" : `${nearestUsers.toLocaleString("en-GB")} km to the nearest users`)
  if (nearestData != null) parts.push(`${nearestData.toLocaleString("en-GB")} km to the model and data`)
  return parts.join(" · ")
}
