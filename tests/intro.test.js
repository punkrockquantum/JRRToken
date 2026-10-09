import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { GRAPH_SIZES, LESSONS, ORCA } from "../js/data.js"
import { layout } from "../js/floor.js"
import { DURATION, INPUT_HOLD_MS, PATH, SCENES, createAdvanceGate, sceneCaption, sceneTime } from "../js/intro.js"

const IDS = ["prompt", "retrieval", "generation", "helpers", "quest"]

const sentences = (value) => value.split(/(?<=[.!?])\s+/).filter(Boolean)
const words = (scene) => `${scene.title} ${sceneCaption(scene, false)}`

test("the intro walks prompt, retrieval, generation, a helper, then the quest", () => {
  assert.deepEqual(SCENES.map((scene) => scene.id), IDS)
  assert.deepEqual(PATH, ["PROMPT", "RETRIEVAL", "GENERATION"])
  assert.equal(DURATION, 70)
  for (const scene of SCENES) {
    assert.equal(typeof scene.simple, "string", `${scene.id} simple`)
    assert.equal(typeof scene.nerd, "string", `${scene.id} nerd`)
    assert.equal(sentences(scene.simple).length, 1, `${scene.id}: one simple sentence`)
    assert.ok(sentences(scene.nerd).length >= 2 && sentences(scene.nerd).length <= 3, `${scene.id}: nerd depth`)
    assert.equal(scene.note, undefined, `${scene.id}: no footnote`)
    assert.doesNotMatch(words(scene), /chunk|little pieces|prefill|decode|HBM|KV cache|vector|embedding|weights|bias|FP\d|roofline|bandwidth|GPU|ORCA|MCP|\bRAG\b/i, scene.id)
    assert.doesNotMatch(scene.nerd, /chunk|photonic chip|Gaussian boson|NVL144/i, scene.id)
    assert.doesNotMatch(scene.nerd, /over 2×|over twice/i, scene.id)
    assert.doesNotMatch(scene.nerd, /(GPU|LLM|model) (searches|fetches|looks up|retrieves)/i, scene.id)
  }
  const by = (id) => sceneCaption(SCENES.find((scene) => scene.id === id), false)
  assert.match(by("prompt"), /prompt, your question/i)
  assert.match(by("prompt"), /tokens, the small word-parts/i)
  assert.match(by("retrieval"), /documents/i)
  assert.match(by("retrieval"), /retrieval/i)
  assert.match(by("generation"), /one token at a time/i)
  assert.match(by("generation"), /generation/i)
  assert.match(by("quest"), /best factory you can afford/i)
  const nerd = SCENES.map((scene) => scene.nerd).join(" ")
  for (const term of [/token/i, /retrieval|RAG/i, /prefill/i, /KV cache/i, /decode/i, /binding graph/i, /round trip/i]) {
    assert.match(nerd, term, String(term))
  }
})

test("player copy uses the corrected hardware names", async () => {
  const { readFileSync } = await import("node:fs")
  const root = new URL("../", import.meta.url)
  const files = ["js/intro.js", "js/main.js", "js/coach.js", "js/data.js", "js/presets.js"]
  const text = files.map((file) => readFileSync(new URL(file, root), "utf8")).join("\n")
  assert.doesNotMatch(text, /Gaussian boson/i)
  assert.doesNotMatch(text, /over 2×|over twice/i)
  assert.equal(text.match(/NVL144/g)?.length, 1)
  assert.match(text, /Announced as NVL144/)
  assert.match(text, /ORCA PT-3/)
  assert.match(text, /about 2×/)
})

test("no player copy calls tokens or passages chunks", async () => {
  const { readFileSync } = await import("node:fs")
  const root = new URL("../", import.meta.url)
  for (const file of ["js/intro.js", "js/main.js", "js/coach.js", "js/presets.js", "js/floor.js", "index.html"]) {
    assert.doesNotMatch(readFileSync(new URL(file, root), "utf8"), /chunk/i, file)
  }
  assert.doesNotMatch(Object.values(LESSONS).join(" "), /chunk/i)
})

test("intro and lesson copy stays accurate", () => {
  const copy = [...SCENES.map((scene) => `${words(scene)} ${scene.nerd}`), ORCA.learn, ...GRAPH_SIZES.map((size) => size.learn), ...Object.values(LESSONS)].join("\n")
  assert.doesNotMatch(copy, /covid|mpro|sars/i)
  assert.doesNotMatch(copy, /kcal/i)
  assert.doesNotMatch(copy, /MCP[^.]{0,60} is faster/i)
  for (const scene of SCENES) {
    assert.doesNotMatch(words(scene), /(GPU|LLM|model) (searches|fetches|looks up|retrieves)/i, scene.id)
  }
})

test("each scene plays from its own start and never runs into the next scene", () => {
  assert.equal(sceneTime(0, 0).scene.id, "prompt")
  assert.equal(sceneTime(0, 0).t, SCENES[0].start)
  const held = sceneTime(0, 100)
  assert.ok(held.t > SCENES[0].end - 0.01)
  assert.ok(held.t < SCENES[0].end)
  assert.ok(sceneTime(0, 9).t >= 7, "the prompt scene turns the question into tokens")
  const generation = SCENES.findIndex((scene) => scene.id === "generation")
  assert.ok(sceneTime(generation, 12).t >= 30, "generation moves on to writing the answer")
  const quest = SCENES.length - 1
  const frozen = sceneTime(quest, 1e9, { hold: true })
  assert.equal(frozen.t, SCENES[quest].start + (SCENES[quest].end - SCENES[quest].start) - 0.001)
  assert.equal(sceneTime(SCENES.length - 1, 0).scene.id, "quest")
  assert.equal(sceneTime(-4, 0).scene.id, "prompt")
  assert.equal(sceneTime(99, 0).scene.id, "quest")
})

test("with no clicks, the scene index never changes over 10 seconds", () => {
  for (let index = 0; index < SCENES.length; index += 1) {
    const start = sceneTime(index, 0)
    const later = sceneTime(index, 10)
    assert.equal(later.index, index, SCENES[index].id)
    assert.equal(later.scene.id, start.scene.id)
  }
  const intro = readFileSync(new URL("../js/intro.js", import.meta.url), "utf8")
  const main = readFileSync(new URL("../js/main.js", import.meta.url), "utf8")
  assert.doesNotMatch(intro, /setTimeout|setInterval/)
  assert.doesNotMatch(main, /setTimeout\([\s\S]{0,120}advanceIntro|advanceIntro[\s\S]{0,80}setTimeout/)
})

test("intro gate: no auto-advance in 30 s, input inside 400 ms is ignored, input after 400 ms advances", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 })
  const gate = createAdvanceGate({ now: () => Date.now() })
  let index = 0
  let shownAt = Date.now()
  const input = (eventTime = Date.now()) => {
    if (!gate.allow(eventTime)) return false
    index += 1
    gate.shown()
    shownAt = Date.now()
    return true
  }

  for (let second = 1; second <= 30; second += 1) {
    t.mock.timers.tick(1000)
    assert.equal(sceneTime(index, (Date.now() - shownAt) / 1000).index, 0, `still scene 1 after ${second} s`)
  }
  assert.equal(index, 0)

  gate.shown()
  shownAt = Date.now()
  const launch = Date.now() - 5
  t.mock.timers.tick(INPUT_HOLD_MS + 50)
  assert.equal(input(launch), false, "the event that launched the scene is ignored")

  gate.shown()
  t.mock.timers.tick(INPUT_HOLD_MS - 1)
  assert.equal(input(), false, "input inside 400 ms is ignored")
  assert.equal(index, 0)
  t.mock.timers.tick(1)
  assert.equal(input(), true, "input after 400 ms advances")
  assert.equal(index, 1)
  assert.equal(input(), false, "a second tap straight after does not skip the next scene")
  t.mock.timers.tick(INPUT_HOLD_MS)
  assert.equal(input(), true)
  assert.equal(index, 2)
})

test("intro input listeners never double-handle the continue button", () => {
  const main = readFileSync(new URL("../js/main.js", import.meta.url), "utf8")
  assert.match(main, /introGate\.allow\(event\?\.timeStamp\)/)
  assert.match(main, /onScene: \(scene\) => \{\s*introGate\.shown\(\)/)
  assert.doesNotMatch(main, /key !== "intro-continue"/)
})

test("floor layout draws one hall per metro for the single use case", () => {
  const rows = layout({ useCase: "chat", build: { hall: "B", platform: "vr", racks: 3, sites: ["lon", "iad", "sjc"] } })
  assert.equal(rows.length, 3)
  assert.ok(rows.every((row) => row.id === "chat" && row.hall.id === "B"))
  assert.deepEqual(rows.map((row) => row.site.metro), ["London", "Ashburn", "Silicon Valley"])
  assert.deepEqual(rows.map((row) => row.racks), [1, 1, 1])
  assert.ok(rows.every((row) => row.rect.x + row.rect.w <= 320 && row.rect.y + row.rect.h < 180))
  const one = layout({ useCase: "drug", build: { hall: "A", platform: "b300", racks: 5, sites: ["lon"] } })
  assert.equal(one.length, 1)
  assert.equal(one[0].racks, 5)
})
