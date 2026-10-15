import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { DATA_HOMES, USE_CASES, USER_BASES } from "../js/data.js"
import { MAP_H, MAP_W, mapCaption, mapPoints } from "../js/map.js"
import { metroOffers } from "../js/model.js"
import { simpleDefaults, stepValue } from "../js/steps.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const main = readFileSync(join(root, "js/main.js"), "utf8")
const css = readFileSync(join(root, "css/game.css"), "utf8")

test("every story's map holds its users, its data home and the metros on offer, all inside the frame", () => {
  for (const useCase of USE_CASES) {
    const picked = stepValue(useCase.id, "location", simpleDefaults(useCase.id))
    const { width, height, points, links } = mapPoints(useCase.id, picked)
    assert.equal(width, MAP_W)
    assert.equal(height, MAP_H)
    const users = points.filter((p) => p.kind === "users")
    const data = points.filter((p) => p.kind === "data")
    const metros = points.filter((p) => p.kind === "metro")
    assert.equal(users.length, USER_BASES[useCase.id].places.length, `${useCase.id} user places`)
    assert.equal(data.length, 1, `${useCase.id} data home`)
    assert.ok(data[0].label.includes(DATA_HOMES[useCase.id].city), `${useCase.id} data label ${data[0].label}`)
    if (data[0].far) assert.match(data[0].label, /^◀ |▶$/, "a far data home points off the map")
    assert.deepEqual(metros.map((m) => m.id), metroOffers(useCase.id).map((offer) => offer.id), `${useCase.id} metros on offer`)
    for (const p of points) {
      assert.ok(p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height, `${useCase.id} ${p.label} at ${p.x},${p.y}`)
      assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y), "whole pixels")
      assert.ok(p.label, "every point is labelled")
    }
    const on = metros.filter((m) => m.on)
    assert.deepEqual(on.map((m) => m.id), picked, `${useCase.id} chosen metros light up`)
    assert.equal(links.length, picked.length * (users.length + 1), `${useCase.id} one link per chosen metro per place`)
    for (const link of links) {
      assert.ok(link.from.kind === "metro" && link.from.on)
      assert.ok(["users", "data"].includes(link.kind))
      assert.ok(Number.isInteger(link.km) && link.km >= 0)
    }
    /* North is up and east is right. */
    const byLat = [...points].sort((a, b) => b.lat - a.lat)
    assert.ok(byLat[0].y <= byLat[byLat.length - 1].y, `${useCase.id}: the northernmost point is highest`)
    const byLon = [...points].sort((a, b) => a.lon - b.lon)
    assert.ok(byLon[0].x <= byLon[byLon.length - 1].x, `${useCase.id}: the westernmost point is leftmost`)
  }
})

test("labels stay inside the frame, never sit on each other, and a twin label is said once", () => {
  for (const useCase of USE_CASES) {
    for (const picked of [[], ["lon"], ["fra", "ams"]]) {
      const { width, height, points } = mapPoints(useCase.id, picked)
      const labelled = points.filter((p) => p.labelText)
      const distinct = new Set(points.map((p) => p.label))
      assert.ok(labelled.length >= distinct.size, `${useCase.id}: every distinct name is written at least once`)
      for (const label of distinct) assert.ok(labelled.some((p) => p.labelText === label), `${useCase.id}: ${label} is written`)
      for (const p of labelled) {
        const half = p.labelText.length * 4.6 / 2
        assert.ok(p.labelX - half >= 0 && p.labelX + half <= width, `${useCase.id} ${p.labelText} x ${p.labelX} inside the frame`)
        assert.ok(p.labelY >= 8 && p.labelY <= height, `${useCase.id} ${p.labelText} y ${p.labelY}`)
      }
      for (let i = 0; i < labelled.length; i += 1) {
        for (let j = i + 1; j < labelled.length; j += 1) {
          const a = labelled[i]
          const b = labelled[j]
          const apart = Math.abs(a.labelX - b.labelX) >= (a.labelText.length + b.labelText.length) * 4.6 / 2 + 2 || Math.abs(a.labelY - b.labelY) >= 10
          assert.ok(apart, `${useCase.id} ${picked.join("+") || "none"}: ${a.labelText} (${a.labelX},${a.labelY}) sits on ${b.labelText} (${b.labelX},${b.labelY})`)
        }
      }
    }
  }
  const rag = mapPoints("rag", ["lon"]).points
  const londons = rag.filter((p) => p.label === "London")
  assert.equal(londons.length, 2, "London is both the users and a metro")
  assert.equal(londons.filter((p) => p.labelText).length, 1, "but it is written once")
})

test("the map spreads out: London and Frankfurt are not drawn on top of each other, even beside Ashburn", () => {
  const { points } = mapPoints("chat", ["lon", "fra"])
  const lon = points.find((p) => p.kind === "metro" && p.id === "lon")
  const fra = points.find((p) => p.kind === "metro" && p.id === "fra")
  const ashburn = points.find((p) => p.kind === "data")
  assert.ok(Math.hypot(lon.x - fra.x, lon.y - fra.y) >= 40, "London and Frankfurt are well apart once Ashburn is pinned to the edge")
  assert.ok(ashburn.x < lon.x, "Ashburn sits west of London")
  assert.ok(ashburn.far && ashburn.x === 10, "Ashburn is pinned to the western edge")
  assert.ok(!lon.far && !fra.far)
  assert.ok(mapPoints("rag", ["lon"]).points.every((p) => !p.far), "a European data home sits inside the frame")
  const chatUsers = points.filter((p) => p.kind === "users")
  assert.deepEqual(chatUsers.map((p) => p.label), ["London", "Frankfurt"])
  assert.ok(chatUsers[0].share > chatUsers[1].share, "shares ride along for the dot size")
})

test("the caption quotes the nearest trips, and asks for a metro when none is chosen", () => {
  assert.equal(mapCaption("chat", []), "Pick a metro to measure the trips.")
  assert.match(mapCaption("chat", ["lon"]), /^in the nearest users' own city · 5,9\d\d km to the model and data$/)
  assert.match(mapCaption("chat", ["par"]), /^\d{3} km to the nearest users · 6,1\d\d km to the model and data$/)
  assert.match(mapCaption("rag", ["fra"]), /^6\d\d km to the nearest users · \d km to the model and data$/)
  assert.match(mapCaption("drug", ["lon"]), /^(7|8)\d km to the nearest users · 4\d\d km to the model and data$/)
  assert.equal(mapPoints("nonsense").points.length, 0)
  assert.deepEqual(mapPoints("nonsense").links, [])
})

test("the LOCATION step draws the tiny map and the stylesheet dresses it", () => {
  assert.match(main, /import \{ mapCaption, mapPoints \} from "\.\/map\.js"/)
  assert.match(main, /function tinyMap\(id, choices\)/)
  assert.match(main, /stepId === "location" \? tinyMap\(id, choices\) : null/)
  assert.match(main, /"data-key": "tiny-map"/)
  assert.match(main, /"data-key": "map-caption"/)
  assert.match(main, /createElementNS\(SVG_NS, tag\)/)
  for (const rule of [".map-wrap {", ".tiny-map {", ".tiny-map .map-link.users {", ".tiny-map .map-link.data {", ".tiny-map .map-metro.on circle {", ".map-legend {"]) {
    assert.ok(css.includes(rule), rule)
  }
})
