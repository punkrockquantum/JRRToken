import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { GRAPH_SIZES, LESSONS, ORCA } from "../js/data.js"
import { layout } from "../js/floor.js"
import { DURATION, ECO_SCENE_PARTS, INPUT_HOLD_MS, PATH, SCENES, SIMPLE_PATH, SIMPLE_SCENES, createAdvanceGate, ecoLabelBoxes, ecosystemLit, matchingScene, sceneAt, sceneCaption, sceneTime, scenesFor } from "../js/intro.js"

const IDS = ["prompt", "generation", "ecosystem", "factory", "wires", "quest"]
const SIMPLE_COPY = [
  "You ask. The AI reads your words as tokens and writes the answer one token at a time.",
  "Every AI answer is born in a data center: power feeds it, cooling keeps it alive, GPUs think, data gives it something to know, and connections carry the answer to you.",
  "Take any one away and the AI stops: no power, no maths; no cooling, no GPUs; no data, nothing to know; no connection, no answer.",
  "Closer, cooler and better connected means faster answers for less money. Build the best AI factory you can afford!",
]

const sentences = (value) => value.split(/(?<=[.!?])\s+/).filter(Boolean)
const wordCount = (value) => value.split(/\s+/).filter(Boolean).length
const words = (scene) => `${scene.title} ${sceneCaption(scene, false)}`

/** Scene windows share one absolute timeline; they must not overlap, so sceneAt never picks the wrong one. */
function disjoint(scenes) {
  const sorted = [...scenes].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i].start >= sorted[i - 1].end, `${sorted[i].id} overlaps ${sorted[i - 1].id}`)
  for (const scene of scenes) assert.equal(sceneAt(scene.start, scenes).id, scene.id, `${scene.id} owns its window`)
}

test("the intro is six click-through scenes: tokens, generation, the ecosystem, the factory, the wires, the quest", () => {
  assert.equal(SCENES.length, 6)
  assert.deepEqual(SCENES.map((scene) => scene.id), IDS)
  assert.deepEqual(PATH, ["PROMPT", "GENERATION", "ECOSYSTEM", "FACTORY", "WIRES", "QUEST"])
  assert.equal(DURATION, 86)
  disjoint(SCENES)
  const quiet = new Set(["prompt", "generation"])
  SCENES.forEach((scene, index) => {
    assert.equal(scene.stage, index, `${scene.id} lights path stage ${index}`)
    assert.ok(scene.title.startsWith(`${index + 1} · `), `${scene.id} title is numbered`)
    assert.equal(typeof scene.simple, "string", `${scene.id} simple`)
    assert.equal(typeof scene.nerd, "string", `${scene.id} nerd`)
    const simple = sentences(scene.simple)
    assert.ok(simple.length >= 1 && simple.length <= 2, `${scene.id}: simple is one or two sentences (${simple.length})`)
    assert.ok(simple.every((sentence) => wordCount(sentence) <= 32), `${scene.id}: simple sentences stay short`)
    const nerd = sentences(scene.nerd)
    assert.ok(nerd.length >= 1 && nerd.length <= 3, `${scene.id}: nerd is at most three sentences (${nerd.length})`)
    assert.ok(wordCount(scene.nerd) <= 100, `${scene.id}: nerd stays under 100 words`)
    assert.equal(scene.note, undefined, `${scene.id}: no footnote`)
    assert.equal(scene.loop, true, `${scene.id} loops`)
    assert.ok(scene.end > scene.start, scene.id)
    /* The ecosystem cutaway was drawn later, so it owns a window after the quest; every other scene chains on. */
    const previous = SCENES[index - 1]
    if (index > 0 && scene.id !== "ecosystem") assert.equal(scene.start, previous.id === "ecosystem" ? SCENES[index - 2].end : previous.end, `${scene.id} starts where the last scene ends`)
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
  assert.match(by("ecosystem"), /^Every AI answer is born in a data center: power feeds it, cooling keeps it alive, GPUs think, data gives it something to know, and connections carry the answer to you\.$/)
  const quest = SCENES.find((scene) => scene.id === "quest")
  assert.deepEqual(quest.nerd.match(/\d+\+?/g), ["300+", "50+"], "the quest quotes only the 300+ sites and 50+ metros")
  assert.equal(sceneCaption(SCENES[0], true), SCENES[0].nerd)
})

test("the ecosystem cutaway names the five parts in the bar's order and lights them one at a time", () => {
  assert.deepEqual(ECO_SCENE_PARTS.map((part) => part.id), ["power", "cooling", "compute", "data", "connections"])
  assert.deepEqual(ECO_SCENE_PARTS.map((part) => part.name), ["POWER", "COOLING", "COMPUTE", "DATA", "CONNECTIONS"])
  for (const part of ECO_SCENE_PARTS) {
    assert.ok(part.note.length > 0 && part.note === part.note.toUpperCase(), `${part.id} note is a short caption`)
    assert.ok(part.nerd.length > 0, `${part.id} has a nerd note`)
  }
  assert.equal(ecosystemLit(-1), 0)
  assert.equal(ecosystemLit(0), 1)
  assert.equal(ecosystemLit(1.7), 1)
  assert.equal(ecosystemLit(1.8), 2)
  assert.equal(ecosystemLit(7.2), 5)
  assert.equal(ecosystemLit(60), 5, "never more than five")
  const ecosystem = SCENES.find((scene) => scene.id === "ecosystem")
  assert.ok(ecosystem.end - ecosystem.start >= 1.8 * ECO_SCENE_PARTS.length + 3, "the window is long enough to light every part and let the answer flow")
  assert.match(ecosystem.nerd, /PUE/)
  assert.match(ecosystem.nerd, /200 km per millisecond/)
  assert.match(ecosystem.nerd, /take any one of the five away/i)
})

test("the cutaway's labels never overlap each other, the frame, or the title band", () => {
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  for (const nerdNotes of [false, true]) {
    const boxes = ecoLabelBoxes({ nerdNotes })
    const labels = boxes.filter((box) => box.text !== "frame" && box.text !== "title")
    const frame = boxes.find((box) => box.text === "frame")
    const title = boxes.find((box) => box.text === "title")
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        assert.ok(!overlaps(labels[i], labels[j]), `"${labels[i].text}" collides with "${labels[j].text}" (nerd ${nerdNotes})`)
      }
      assert.ok(labels[i].x >= frame.x && labels[i].x + labels[i].w <= frame.x + frame.w, `"${labels[i].text}" leaves the frame`)
      assert.ok(labels[i].y + labels[i].h <= frame.y + frame.h, `"${labels[i].text}" falls below the frame`)
    }
    assert.ok(frame.y >= title.y + title.h, "the frame starts below the two-line title band")
  }
})

test("the booth intro is four click-through scenes with the exact copy, and nerd mode keeps all six", () => {
  assert.equal(SIMPLE_SCENES.length, 4)
  assert.deepEqual(SIMPLE_SCENES.map((scene) => scene.id), ["ask", "ecosystem", "takeaway", "build"])
  assert.deepEqual(SIMPLE_SCENES.map((scene) => scene.title), ["1 · YOU ASK", "2 · THE ECOSYSTEM", "3 · TAKE ONE AWAY", "4 · YOUR QUEST"])
  assert.deepEqual(SIMPLE_SCENES.map((scene) => scene.simple), SIMPLE_COPY)
  assert.deepEqual(SIMPLE_PATH, ["ASK", "ECOSYSTEM", "TAKE ONE AWAY", "BUILD"])
  disjoint(SIMPLE_SCENES)
  SIMPLE_SCENES.forEach((scene, index) => {
    assert.equal(scene.stage, index, `${scene.id} lights path stage ${index}`)
    assert.equal(scene.loop, true, `${scene.id} loops`)
    if (scene.id === "ecosystem") {
      assert.equal(scene.nerd, SCENES.find((item) => item.id === "ecosystem").nerd, "the cutaway is shared with the deep dive, numbers and all")
    } else {
      assert.equal(scene.nerd, undefined, `${scene.id} has no nerd caption: nerd mode swaps to the six-scene set`)
      assert.equal(sceneCaption(scene, true), scene.simple)
    }
    assert.ok(scene.end > scene.start, scene.id)
    assert.doesNotMatch(words(scene), /chunk|prefill|decode|HBM|KV cache|vector|embedding|FP\d|roofline|bandwidth|ORCA|MCP|\bRAG\b|PUE|peering|eyeball|cross connect|dark fiber/i, scene.id)
  })
  assert.equal(scenesFor(false), SIMPLE_SCENES)
  assert.equal(scenesFor(true), SCENES)
  assert.equal(scenesFor(), SIMPLE_SCENES)
  assert.equal(SCENES.length, 6, "nerd mode keeps the deep dive")
  /* Flipping nerd on lands on the scene that covers the same ground; flipping off folds back. */
  assert.deepEqual([0, 1, 2, 3].map((i) => matchingScene(i, true)), [0, 2, 2, 5])
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => matchingScene(i, false)), [0, 0, 1, 3, 3, 3])
  assert.equal(matchingScene(9, true), 5)
  assert.equal(matchingScene(-1, false), 0)
  assert.equal(matchingScene(undefined, true), 0)
  /* The simple timeline plays each scene from its own start and holds inside it. */
  assert.equal(sceneTime(0, 0, { scenes: SIMPLE_SCENES }).scene.id, "ask")
  assert.equal(sceneTime(0, 0, { scenes: SIMPLE_SCENES }).t, 0)
  const wrapped = sceneTime(1, 100, { scenes: SIMPLE_SCENES })
  assert.equal(wrapped.index, 1)
  assert.ok(wrapped.t >= 86 && wrapped.t < 100, `the ecosystem loops inside its own window (${wrapped.t})`)
  assert.equal(sceneTime(2, 10, { scenes: SIMPLE_SCENES }).scene.id, "takeaway")
  assert.equal(sceneTime(3, 10, { scenes: SIMPLE_SCENES }).scene.id, "build")
  assert.equal(sceneTime(7, 0, { scenes: SIMPLE_SCENES }).scene.id, "build")
  const frozen = sceneTime(3, 1e9, { hold: true, scenes: SIMPLE_SCENES })
  assert.equal(frozen.t, 54 - 0.001)
  for (let index = 0; index < SIMPLE_SCENES.length; index += 1) {
    assert.equal(sceneTime(index, 10, { scenes: SIMPLE_SCENES }).index, index, `${SIMPLE_SCENES[index].id} never advances on its own`)
  }
})

const PLAYER_COPY_FILES = ["js/intro.js", "js/main.js", "js/coach.js", "js/data.js", "js/presets.js", "js/steps.js", "js/eco.js", "js/rounds.js", "js/explain.js"]

test("player copy uses the corrected hardware names", async () => {
  const { readFileSync } = await import("node:fs")
  const root = new URL("../", import.meta.url)
  const text = PLAYER_COPY_FILES.map((file) => readFileSync(new URL(file, root), "utf8")).join("\n")
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
  for (const file of [...PLAYER_COPY_FILES, "js/floor.js", "index.html"]) {
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
