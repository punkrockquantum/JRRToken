import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { GRAPH_SIZES, LESSONS, ORCA } from "../js/data.js"
import { layout } from "../js/floor.js"
import { DURATION, INPUT_HOLD_MS, PATH, SCENES, SIMPLE_PATH, SIMPLE_SCENES, createAdvanceGate, matchingScene, sceneCaption, sceneTime, scenesFor } from "../js/intro.js"

const IDS = ["prompt", "generation", "factory", "wires", "quest"]
const SIMPLE_COPY = [
  "You ask. The AI reads your words as tokens and writes the answer one token at a time.",
  "That happens in a data center: GPUs do the maths, cooling keeps them running, wires carry the answers.",
  "Closer, cooler and better connected means faster answers for less money. Build the best AI factory you can afford!",
]

const sentences = (value) => value.split(/(?<=[.!?])\s+/).filter(Boolean)
const wordCount = (value) => value.split(/\s+/).filter(Boolean).length
const words = (scene) => `${scene.title} ${sceneCaption(scene, false)}`

test("the intro is five click-through scenes: tokens, generation, the factory, the wires, the quest", () => {
  assert.equal(SCENES.length, 5)
  assert.deepEqual(SCENES.map((scene) => scene.id), IDS)
  assert.deepEqual(PATH, ["PROMPT", "GENERATION", "FACTORY", "WIRES", "QUEST"])
  assert.equal(DURATION, 86)
  const quiet = new Set(["prompt", "generation"])
  SCENES.forEach((scene, index) => {
    assert.equal(scene.stage, index, `${scene.id} lights path stage ${index}`)
    assert.ok(scene.title.startsWith(`${index + 1} · `), `${scene.id} title is numbered`)
    assert.equal(typeof scene.simple, "string", `${scene.id} simple`)
    assert.equal(typeof scene.nerd, "string", `${scene.id} nerd`)
    const simple = sentences(scene.simple)
    assert.ok(simple.length >= 1 && simple.length <= 2, `${scene.id}: simple is one or two sentences (${simple.length})`)
    assert.ok(simple.every((sentence) => wordCount(sentence) <= 25), `${scene.id}: simple sentences stay short`)
    const nerd = sentences(scene.nerd)
    assert.ok(nerd.length >= 1 && nerd.length <= 3, `${scene.id}: nerd is at most three sentences (${nerd.length})`)
    assert.ok(wordCount(scene.nerd) <= 100, `${scene.id}: nerd stays under 100 words`)
    assert.equal(scene.note, undefined, `${scene.id}: no footnote`)
    assert.equal(scene.loop, true, `${scene.id} loops`)
    assert.ok(index === 0 || scene.start === SCENES[index - 1].end, `${scene.id} starts where the last scene ends`)
    if (quiet.has(scene.id)) {
      assert.doesNotMatch(words(scene), /chunk|little pieces|prefill|decode|HBM|KV cache|vector|embedding|weights|bias|FP\d|roofline|bandwidth|ORCA|MCP|\bRAG\b/i, scene.id)
    }
    assert.doesNotMatch(`${scene.simple} ${scene.nerd}`, /chunk|photonic chip|Gaussian boson|searches storage|NVL144/i, scene.id)
    assert.doesNotMatch(scene.nerd, /over 2×|over twice/i, scene.id)
    assert.doesNotMatch(scene.nerd, /(GPU|LLM|model) (searches|fetches|looks up|retrieves)/i, scene.id)
  })
  const all = SCENES.map((scene) => `${scene.simple} ${scene.nerd}`).join(" ")
  for (const term of [/token/i, /retrieval/i, /generation/i, /\bGPU/, /\bCPU/, /\bDPU/, /\bQPU/, /\bair\b/i, /liquid/i, /peering/i, /eyeball/i, /cross connect/i, /dark fiber/i, /ServiceFabric/, /\bMCP\b/, /Digital Realty/]) {
    assert.match(all, term, String(term))
  }
  const nerd = SCENES.map((scene) => scene.nerd).join(" ")
  for (const term of [/Rear Door Heat Exchanger/, /Direct Liquid/, /tokenizer/i, /prefill/i, /KV cache/i, /decode/i, /boson sampling/i, /about 2×/, /round trip/i, /200 km/, /PlatformDIGITAL/]) {
    assert.match(nerd, term, String(term))
  }
  const by = (id) => sceneCaption(SCENES.find((scene) => scene.id === id), false)
  assert.match(by("prompt"), /prompt, your question/i)
  assert.match(by("prompt"), /tokens, small word-parts/i)
  assert.match(by("prompt"), /mathematical value/i)
  assert.match(by("generation"), /documents[^.]*: retrieval\./i)
  assert.match(by("generation"), /one token at a time: generation\./i)
  assert.match(by("factory"), /GPU[^.]*CPU[^.]*DPU[^.]*QPU/)
  assert.match(by("factory"), /air or by liquid/i)
  assert.match(by("wires"), /public internet is slow/i)
  assert.match(by("quest"), /best AI factory you can afford!/i)
  assert.deepEqual(SCENES[4].nerd.match(/\d+\+?/g), ["300+", "50+"], "the quest quotes only the 300+ sites and 50+ metros")
  assert.equal(sceneCaption(SCENES[0], true), SCENES[0].nerd)
})

test("the booth intro is three click-through scenes with the exact copy, and nerd mode keeps all five", () => {
  assert.equal(SIMPLE_SCENES.length, 3)
  assert.deepEqual(SIMPLE_SCENES.map((scene) => scene.id), ["ask", "center", "build"])
  assert.deepEqual(SIMPLE_SCENES.map((scene) => scene.title), ["1 · YOU ASK", "2 · THE DATA CENTER", "3 · YOUR QUEST"])
  assert.deepEqual(SIMPLE_SCENES.map((scene) => scene.simple), SIMPLE_COPY)
  assert.deepEqual(SIMPLE_PATH, ["ASK", "DATA CENTER", "BUILD"])
  SIMPLE_SCENES.forEach((scene, index) => {
    assert.equal(scene.stage, index, `${scene.id} lights path stage ${index}`)
    assert.equal(scene.loop, true, `${scene.id} loops`)
    assert.equal(scene.nerd, undefined, `${scene.id} has no nerd caption: nerd mode swaps to the five-scene set`)
    assert.equal(sceneCaption(scene, true), scene.simple)
    assert.ok(index === 0 || scene.start === SIMPLE_SCENES[index - 1].end, `${scene.id} starts where the last scene ends`)
    assert.ok(scene.end > scene.start, scene.id)
    assert.doesNotMatch(words(scene), /chunk|prefill|decode|HBM|KV cache|vector|embedding|FP\d|roofline|bandwidth|ORCA|MCP|\bRAG\b|PUE|peering|eyeball|cross connect|dark fiber/i, scene.id)
  })
  assert.equal(scenesFor(false), SIMPLE_SCENES)
  assert.equal(scenesFor(true), SCENES)
  assert.equal(scenesFor(), SIMPLE_SCENES)
  assert.equal(SCENES.length, 5, "nerd mode keeps the deep dive")
  /* Flipping nerd on lands on the scene that covers the same ground; flipping off folds back. */
  assert.deepEqual([0, 1, 2].map((i) => matchingScene(i, true)), [0, 2, 4])
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => matchingScene(i, false)), [0, 0, 1, 1, 2])
  assert.equal(matchingScene(9, true), 4)
  assert.equal(matchingScene(-1, false), 0)
  assert.equal(matchingScene(undefined, true), 0)
  /* The simple timeline plays each scene from its own start and holds inside it. */
  assert.equal(sceneTime(0, 0, { scenes: SIMPLE_SCENES }).scene.id, "ask")
  assert.equal(sceneTime(0, 0, { scenes: SIMPLE_SCENES }).t, 0)
  const wrapped = sceneTime(1, 100, { scenes: SIMPLE_SCENES })
  assert.equal(wrapped.index, 1)
  assert.ok(wrapped.t >= 22 && wrapped.t < 38)
  assert.equal(sceneTime(2, 10, { scenes: SIMPLE_SCENES }).scene.id, "build")
  assert.equal(sceneTime(7, 0, { scenes: SIMPLE_SCENES }).scene.id, "build")
  const frozen = sceneTime(2, 1e9, { hold: true, scenes: SIMPLE_SCENES })
  assert.equal(frozen.t, 54 - 0.001)
  for (let index = 0; index < SIMPLE_SCENES.length; index += 1) {
    assert.equal(sceneTime(index, 10, { scenes: SIMPLE_SCENES }).index, index, `${SIMPLE_SCENES[index].id} never advances on its own`)
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
  const wrapped = sceneTime(0, 100)
  assert.equal(wrapped.index, 0)
  assert.ok(wrapped.t >= SCENES[0].start && wrapped.t < SCENES[0].end)
  assert.ok(sceneTime(0, 9).t >= 7, "the prompt scene turns the question into tokens")
  const generation = SCENES.findIndex((scene) => scene.id === "generation")
  assert.ok(sceneTime(generation, 4).t < 22, "generation opens with retrieval")
  assert.ok(sceneTime(generation, 10).t >= 22 && sceneTime(generation, 10).t < 30, "generation moves on to prefill")
  assert.ok(sceneTime(generation, 20).t >= 30, "generation moves on to writing the answer")
  const factory = SCENES.findIndex((scene) => scene.id === "factory")
  assert.ok(sceneTime(factory, 10).t >= 46 && sceneTime(factory, 10).t < 54, "the factory shows the quantum helper")
  assert.ok(sceneTime(factory, 20).t >= 54, "the factory ends on cooling")
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

test("only the continue button and Enter call next()", () => {
  const main = readFileSync(new URL("../js/main.js", import.meta.url), "utf8")
  assert.equal(main.match(/\.next\(\)/g)?.length, 1)
  assert.match(main, /state\.intro\.next\(\)/)
  assert.doesNotMatch(main, /const onPointer|function onPointer|addEventListener\("pointerdown", onPointer\)/)
  const intro = main.slice(main.indexOf("function advanceIntro"), main.indexOf("function introControl"))
  assert.match(intro, /state\.intro\.next\(\)/)
  const keys = main.slice(main.indexOf("const onKey"), main.indexOf("document.addEventListener(\"keydown\", onKey)"))
  assert.match(keys, /event\.key !== "Enter"/)
  assert.doesNotMatch(keys, /event\.key !== " "/)
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
