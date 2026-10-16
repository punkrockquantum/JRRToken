import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { USE_CASES } from "../js/data.js"
import { ECO_PARTS, ecoHint, ecoQuestion, ecoSummary, ecosystem } from "../js/eco.js"
import { upsertEntry } from "../js/league.js"
import { evaluateBuild } from "../js/model.js"
import { COMBO, choicesToBuild, hasCombo, wireIds } from "../js/presets.js"
import { MAX_ROUNDS, canImprove, finalScore, roundEntry, roundHint, roundLine } from "../js/rounds.js"
import { BUILD_STEP_IDS, STEPS, STEP_IDS, allSimple, applyTile, describeChoices, nextStep, prevStep, qpuRelevant, simpleDefaults, stepIndex, stepTiles, stepValue, untouchedSteps } from "../js/steps.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const main = readFileSync(join(root, "js/main.js"), "utf8")

const sentences = (line) => line.split(/(?<=[.!?])\s+(?=[A-Z])/).length
const simpleResult = (id, combo) => evaluateBuild(id, choicesToBuild(id, combo, false))
const STATES = new Set(["green", "amber", "red"])

/* ---------- The ecosystem bar ---------- */

test("the ecosystem is five parts in order, dark until a GPU is picked", () => {
  assert.deepEqual(ECO_PARTS.map((part) => part.id), ["power", "cooling", "compute", "data", "connections"])
  assert.deepEqual(ECO_PARTS.map((part) => part.name), ["POWER", "COOLING", "COMPUTE", "DATA", "CONNECTIONS"])
  const dark = ecosystem(null)
  assert.equal(dark.length, 5)
  assert.ok(dark.every((part) => part.state === "off"))
  assert.equal(ecoHint(null), null)
  assert.equal(ecoQuestion(null), "Pick a GPU to start the factory.")
  assert.deepEqual(ecoSummary({ ok: false }), { ...ecoSummary({ ok: false }), green: 0, amber: 0, red: 0 })
})

test("every simple build lights all five parts, each with a plain reason and a question for anything not green", () => {
  const banned = /\bms\b|tok\/s|TB\/s|\bkW\b|\bMW\b|PUE|Gbps|\$/
  const seen = new Set()
  for (const { id } of USE_CASES) {
    for (const combo of allSimple(id)) {
      const result = simpleResult(id, combo)
      const parts = ecosystem(result)
      const label = `${id} ${describeChoices(id, combo)}`
      assert.equal(parts.length, 5, label)
      for (const part of parts) {
        assert.ok(STATES.has(part.state), `${label}: ${part.id} is ${part.state}`)
        assert.match(part.why, /^[A-Z0-9].*[.!]$/, `${label}: ${part.id} why "${part.why}"`)
        assert.ok(part.why.length <= 200, `${label}: ${part.id} why is ${part.why.length} chars`)
        assert.ok(BUILD_STEP_IDS.includes(part.step), `${label}: ${part.id} points at step ${part.step}`)
        if (part.state !== "green") assert.match(part.ask, /^(Would|Is|Can) .*\?$/, `${label}: ${part.id} ask "${part.ask}"`)
        else assert.equal(part.ask, "", `${label}: a green ${part.id} asks nothing`)
        seen.add(`${part.id}:${part.state}`)
      }
      const hint = ecoHint(result)
      const firstRed = parts.find((part) => part.state === "red")
      const firstAmber = parts.find((part) => part.state === "amber")
      assert.equal(hint?.id ?? null, (firstRed || firstAmber)?.id ?? null, `${label}: the hint is the first red part, else the first amber`)
      const question = ecoQuestion(result)
      assert.match(question, /^[A-Z].*[.?]$/, `${label}: ${question}`)
      assert.ok(sentences(question) <= (hint ? 1 : 2), `${label}: one question (${question})`)
      assert.doesNotMatch(question, banned, `${label}: ${question}`)
      assert.ok(question.length <= 110, `${label}: ${question} (${question.length} chars)`)
      const summary = ecoSummary(result)
      assert.equal(summary.green + summary.amber + summary.red, 5, label)
    }
  }
  for (const part of ECO_PARTS) {
    assert.ok(seen.has(`${part.id}:green`), `${part.id} can be green`)
    assert.ok(seen.has(`${part.id}:amber`) || seen.has(`${part.id}:red`), `${part.id} can be lit amber or red`)
  }
  for (const key of ["power:red", "cooling:red", "compute:red", "data:red", "connections:red", "cooling:amber", "data:amber", "connections:amber"]) {
    assert.ok(seen.has(key), `the simple space reaches ${key}: ${[...seen].sort().join(", ")}`)
  }
})

test("the best simple build of every story is all green, and the known mistakes light the right part", () => {
  for (const { id } of USE_CASES) {
    let best = null
    for (const combo of allSimple(id)) {
      const result = simpleResult(id, combo)
      if (!best || result.score > best.result.score) best = { combo, result }
    }
    assert.ok(best.result.score >= 1390, `${id} best ${best.result.score}`)
    const states = ecosystem(best.result).map((part) => part.state)
    assert.deepEqual(states, ["green", "green", "green", "green", "green"], `${id} best ${describeChoices(id, best.combo)} is ${states.join("/")}`)
    assert.equal(ecoHint(best.result), null, id)
    assert.match(ecoQuestion(best.result), /Every part is lit/)
  }
  const chat = (patch) => simpleResult("chat", { ...simpleDefaults("chat"), ...patch })
  const hot = ecoHint(chat({ brains: "big", home: "cool", wires: "fast" }))
  assert.equal(hot.id, "cooling")
  assert.equal(hot.state, "red")
  assert.match(hot.why, /needs cold plates/)
  assert.equal(hot.step, "cooling")
  const jitter = ecoHint(chat({ wires: "cheap" }))
  assert.equal(jitter.id, "connections")
  assert.match(jitter.why, /public internet adds jitter/)
  assert.equal(jitter.step, "wires")
  const far = ecosystem(chat({ wires: "fast", brains: "big", home: "super", memory: true })).find((part) => part.id === "connections")
  assert.equal(far.state, "red", "one metro in London leaves the Frankfurt shoppers too far away")
  assert.match(far.why, /too far from London/)
  assert.equal(far.step, "location")
  const noIndex = ecosystem(simpleResult("rag", { ...simpleDefaults("rag"), metros: ["fra"], home: "rear", wires: "fast", memory: true, library: "none" })).find((part) => part.id === "data")
  assert.equal(noIndex.state, "red")
  assert.match(noIndex.why, /local drives hold none/)
  const browned = ecosystem(simpleResult("rag", { ...simpleDefaults("rag"), brains: "big", home: "super" })).find((part) => part.id === "power")
  assert.equal(browned.state, "red", "two NVL72 racks blow the head office's power room")
  assert.match(browned.why, /brown out/)
  const late = ecosystem(simpleResult("robot", { ...simpleDefaults("robot"), brains: "rubin", home: "super", wires: "fast" })).find((part) => part.id === "compute")
  assert.equal(late.state, "red")
  assert.match(late.why, /Vera Rubin NVL72 arrives in week \d+/)
})

/* ---------- Two rounds ---------- */

test("two rounds: the final score is the better round, and the results line shows the improvement", () => {
  assert.equal(MAX_ROUNDS, 2)
  assert.equal(finalScore([]), 0)
  assert.equal(finalScore([{ score: 812 }]), 812)
  assert.equal(finalScore([{ score: 812 }, { score: 1400 }]), 1400)
  assert.equal(finalScore([{ score: 1400 }, { score: 812 }]), 1400)
  assert.equal(roundLine([]), "")
  assert.equal(roundLine([{ score: 812 }]), "Round 1: 812")
  assert.equal(roundLine([{ score: 812 }, { score: 1400 }]), "Round 1: 812 → Round 2: 1,400 (+588)")
  assert.equal(roundLine([{ score: 1400 }, { score: 812 }]), "Round 1: 1,400 → Round 2: 812 (−588)")
  assert.equal(roundLine([{ score: 900 }, { score: 900 }]), "Round 1: 900 → Round 2: 900 (±0)")
  assert.equal(canImprove([]), true)
  assert.equal(canImprove([{ score: 1 }]), true)
  assert.equal(canImprove([{ score: 1 }, { score: 2 }]), false)
})

test("the single hint between rounds names the first red or amber part, never the answer", () => {
  const chat = (patch) => simpleResult("chat", { ...simpleDefaults("chat"), ...patch })
  const hint = roundHint(chat({ brains: "big", home: "cool", wires: "fast" }))
  assert.equal(hint.id, "cooling")
  assert.equal(hint.state, "red")
  assert.equal(hint.step, "cooling")
  assert.match(hint.text, /^COOLING: .*\.$/)
  assert.doesNotMatch(hint.text, /Liquid-cooled hall|pick the/i, "the hint describes the problem, not the tile to press")
  let best = null
  for (const combo of allSimple("chat")) {
    const result = chat(combo)
    if (!best || result.score > best.score) best = result
  }
  assert.equal(roundHint(best), null)
  assert.equal(roundHint(null), null)
})

test("the league entry after any round stores both rounds and keeps the better one as the score", () => {
  const first = simpleResult("chat", simpleDefaults("chat"))
  const second = simpleResult("chat", { ...simpleDefaults("chat"), metros: ["lon", "fra"], brains: "big", home: "super", wires: "fast", memory: true })
  assert.ok(second.score > first.score)
  const player = { name: "Ada", email: "ada@example.com", consentAt: "2026-01-01T00:00:00.000Z" }
  const one = roundEntry(player, first, [{ score: first.score, result: first }], { at: 5, story: "Shoppers want quick answers." })
  assert.equal(one.score, first.score)
  assert.equal(one.round1, first.score)
  assert.equal(one.round2, null)
  assert.equal(one.name, "Ada")
  assert.equal(one.email, "ada@example.com")
  assert.equal(one.consent, true)
  assert.equal(one.consentAt, player.consentAt)
  assert.equal(one.useCase, "chat")
  assert.equal(one.at, 5)
  assert.match(one.summary, /^Shoppers want quick answers\. \d[\d,]* points\.$/)
  const two = roundEntry(player, second, [{ score: first.score, result: first }, { score: second.score, result: second }], { at: 9 })
  assert.equal(two.score, second.score)
  assert.equal(two.round1, first.score)
  assert.equal(two.round2, second.score)
  assert.equal(two.fteEquivalent, second.fteEquivalent)
  assert.match(two.summary, /\(Round 1: [\d,]+ → Round 2: [\d,]+ \(\+[\d,]+\)\)\.$/)
  const worse = roundEntry(player, first, [{ score: second.score, result: second }, { score: first.score, result: first }], { at: 9 })
  assert.equal(worse.score, second.score, "a worse second round keeps the first round's score")
  assert.equal(worse.fteEquivalent, second.fteEquivalent, "and the first round's people-power")
  /* The board row is replaced by round two even when the score stands still, so both rounds reach the league. */
  const afterOne = upsertEntry([], roundEntry(player, second, [{ score: second.score, result: second }], { at: 5 }))
  assert.equal(afterOne[0].round2, null)
  const afterTwo = upsertEntry(afterOne, worse)
  assert.equal(afterTwo.length, 1)
  assert.equal(afterTwo[0].score, second.score)
  assert.equal(afterTwo[0].round1, second.score)
  assert.equal(afterTwo[0].round2, first.score, "a level best still records the second round")
  const stranger = upsertEntry(afterTwo, { ...worse, round2: 1, score: second.score - 1, at: 11 })
  assert.equal(stranger[0].round2, first.score, "a lower score never overwrites the row")
})

/* ---------- The stepped build ---------- */

test("the build is eight steps in order, and the step helpers never fall off the rail", () => {
  assert.deepEqual(STEP_IDS, ["location", "gpu", "cooling", "memory", "wires", "storage", "qpu", "review"])
  assert.deepEqual(STEPS.map((step) => step.title), ["LOCATION", "GPU", "COOLING", "MEMORY", "CONNECTIVITY", "STORAGE", "QPU", "REVIEW"])
  assert.deepEqual(BUILD_STEP_IDS, STEP_IDS.slice(0, -1))
  assert.equal(stepIndex("location"), 0)
  assert.equal(stepIndex("review"), 7)
  assert.equal(stepIndex("nope"), 0)
  assert.equal(nextStep("location"), "gpu")
  assert.equal(nextStep("qpu"), "review")
  assert.equal(nextStep("review"), "review")
  assert.equal(prevStep("location"), "location")
  assert.equal(prevStep("review"), "qpu")
  for (const step of STEPS) assert.ok(step.hint.length > 0 && step.short.length <= 5, step.id)
})

test("every step offers three tiles on the simple board, a short list of metros, and the QPU only to drug discovery", () => {
  for (const { id, orca } of USE_CASES) {
    const location = stepTiles(id, "location")
    assert.equal(location.length, 4, `${id} short list`)
    for (const tile of location) {
      assert.match(tile.tag, /^USERS: [\d,]+ KM · DATA: [\d,]+ KM$/, `${id} ${tile.label} ${tile.tag}`)
      assert.ok(tile.rows.every((row) => /^(same city|[\d,]+ km)$/.test(row.text)), `${id} ${tile.label} rows`)
      assert.ok(tile.lines.length === 3, `${id} ${tile.label} lines`)
      assert.match(tile.why, /^[A-Z][^.]+\./, `${id} ${tile.label} why`)
    }
    for (const stepId of ["gpu", "cooling", "memory", "wires", "storage"]) {
      const tiles = stepTiles(id, stepId)
      /* CONNECTIVITY adds a fourth tile, COMBO, only where a mixture pays (RAG, coding, research, robots). */
      assert.equal(tiles.length, stepId === "wires" && hasCombo(id) ? 4 : 3, `${id} ${stepId}`)
      assert.ok(stepTiles(id, stepId, true).length >= tiles.length, `${id} ${stepId} nerd offers at least the simple tiles`)
      for (const tile of tiles) {
        assert.ok(tile.label.length > 0 && tile.label.length <= 32, `${id} ${stepId} label "${tile.label}"`)
        const words = tile.hint.split(/[\s,+]+/).filter(Boolean).length
        assert.ok(words >= 3 && words <= 7, `${id} ${stepId} hint "${tile.hint}" has ${words} words`)
        assert.doesNotMatch(`${tile.label} ${tile.hint}`, /TB\/s|PFLOPS|\bPUE\b|\bms\b|\$/, `${id} ${tile.label}`)
        assert.ok(Array.isArray(tile.lines) && tile.lines.length >= 2, `${id} ${stepId} ${tile.id} learn lines`)
        assert.ok(tile.why.length > 0 && tile.why.length <= 120, `${id} ${stepId} ${tile.id} why "${tile.why}"`)
        assert.ok(tile.patch && Object.keys(tile.patch).length > 0, `${id} ${stepId} ${tile.id} sets something`)
      }
    }
    assert.deepEqual(stepTiles(id, "wires").map((tile) => tile.label), ["Public internet", "Peering + eyeballs", "ServiceFabric", ...(hasCombo(id) ? ["COMBO"] : [])], id)
    if (hasCombo(id)) {
      const comboTile = stepTiles(id, "wires").find((tile) => tile.id === "combo")
      assert.deepEqual(comboTile.parts, COMBO[id].parts, `${id} COMBO names its legs`)
      assert.ok(comboTile.lines.length === COMBO[id].parts.length + 1, `${id} COMBO learn lines list every leg`)
      assert.ok(comboTile.why.length > 0, `${id} COMBO why`)
    }
    assert.deepEqual(hasCombo(id), ["rag", "code", "research", "robot"].includes(id), `${id}: COMBO only where mixing pays`)
    assert.deepEqual(stepTiles(id, "cooling").map((tile) => tile.label), ["Air-cooled hall", "Rear-door hall", "Liquid-cooled hall"], id)
    assert.deepEqual(stepTiles(id, "memory").map((tile) => tile.label), ["KV cache OFF", "KV cache ON", "KV cache ON + CPU host memory"], id)
    assert.deepEqual(stepTiles(id, "storage").map((tile) => tile.label), ["Local only", "File & object", "Vector index"], id)
    assert.equal(stepTiles(id, "gpu")[2].label, "NVIDIA Vera Rubin NVL72 ×1", id)
    assert.equal(qpuRelevant(id), Boolean(orca), id)
    const qpu = stepTiles(id, "qpu")
    if (orca) assert.deepEqual(qpu.map((tile) => tile.label), ["No QPU", "ORCA PT-3"])
    else {
      assert.equal(qpu.length, 1)
      assert.equal(qpu[0].locked, true)
      assert.equal(qpu[0].label, "Not needed for this job")
    }
  }
  assert.deepEqual(stepTiles("chat", "gpu").map((tile) => tile.label), ["NVIDIA HGX B300 ×6", "NVIDIA GB200 NVL72 ×2", "NVIDIA Vera Rubin NVL72 ×1"])
  assert.deepEqual(stepTiles("code", "gpu").map((tile) => tile.label), ["NVIDIA HGX B300 ×6", "NVIDIA GB200 NVL72 ×3", "NVIDIA Vera Rubin NVL72 ×1"])
  assert.deepEqual(stepTiles("robot", "gpu").map((tile) => tile.label), ["NVIDIA HGX H100 ×2", "NVIDIA HGX H200 ×2", "NVIDIA Vera Rubin NVL72 ×1"])
  assert.deepEqual(stepTiles("chat", "location").map((tile) => tile.id), ["lon", "fra", "ams", "par"])
  assert.deepEqual(stepTiles("code", "location").map((tile) => tile.id), ["iad", "sjc", "dfw", "chi"])
})

test("picking a tile patches the choice set; metros toggle up to the story's maximum and the last one stays", () => {
  for (const { id } of USE_CASES) {
    const defaults = simpleDefaults(id)
    assert.deepEqual([defaults.brains, defaults.home, defaults.wires, defaults.library, defaults.memory, defaults.helper, defaults.hosts, defaults.mcp], ["medium", "cool", "peer", "none", false, false, "standard", false], id)
    assert.equal(defaults.metros.length, 1, `${id} opens on one metro`)
    assert.deepEqual(untouchedSteps(id, defaults), BUILD_STEP_IDS.filter((stepId) => stepId !== "qpu" || qpuRelevant(id)), id)
    for (const stepId of ["gpu", "cooling", "memory", "wires", "storage"]) {
      for (const tile of stepTiles(id, stepId)) {
        const next = applyTile(id, stepId, tile.id, defaults)
        assert.equal(stepValue(id, stepId, next), tile.id, `${id} ${stepId} ${tile.id}`)
      }
    }
    assert.equal(stepValue(id, "qpu", applyTile(id, "qpu", "orca", defaults)), qpuRelevant(id) ? "orca" : "none", id)
    const home = defaults.metros[0]
    assert.deepEqual(applyTile(id, "location", home, defaults).metros, [home], `${id}: the last metro cannot be removed`)
  }
  const chat = simpleDefaults("chat")
  assert.deepEqual(applyTile("chat", "location", "fra", chat).metros, ["lon", "fra"])
  const three = applyTile("chat", "location", "ams", applyTile("chat", "location", "fra", chat))
  assert.deepEqual(three.metros, ["lon", "fra", "ams"])
  assert.deepEqual(applyTile("chat", "location", "par", three).metros, ["fra", "ams", "par"], "a fourth metro pushes out the oldest")
  assert.deepEqual(applyTile("chat", "location", "fra", three).metros, ["lon", "ams"])
  const rag = simpleDefaults("rag")
  assert.deepEqual(applyTile("rag", "location", "fra", rag).metros, ["fra"], "a one-metro story swaps metros")
  const memoryOn = applyTile("chat", "memory", "plus", chat)
  assert.deepEqual([memoryOn.memory, memoryOn.hosts], [true, "grace"])
  assert.deepEqual(untouchedSteps("chat", memoryOn), ["location", "gpu", "cooling", "wires", "storage"])
  assert.equal(describeChoices("chat", chat), "NVIDIA HGX B300 ×6, air cooling in London, with the KV cache off, on Peering + eyeballs, local only storage")
  assert.match(describeChoices("drug", applyTile("drug", "qpu", "orca", simpleDefaults("drug"))), /, with ORCA PT-3$/)
})

test("the simple space is every metro set times three tiles on five steps, times the QPU choice", () => {
  for (const { id, orca } of USE_CASES) {
    const combos = allSimple(id)
    const metroSets = new Set(combos.map((combo) => combo.metros.join("+")))
    const perSet = 81 * wireIds(id).length
    assert.equal(combos.length, metroSets.size * perSet * (orca ? 2 : 1), id)
    assert.ok(combos.every((combo) => combo.mcp === false && combo.metros.length >= 1), id)
  }
  assert.equal(allSimple("chat").length, 14 * 243, "four metros, up to three at a time")
  assert.equal(allSimple("rag").length, 4 * 324, "a fourth connectivity tile, COMBO")
  assert.equal(allSimple("drug").length, 4 * 243 * 2)
  assert.equal(allSimple("robot").length, 10 * 324, "four metros, up to two at a time")
})

/* ---------- The game screen wiring ---------- */

test("the game screen is the stepped build: scenario card, ecosystem bar, rail, step panel, coach question", () => {
  assert.match(main, /import \{ ecoHint, ecoQuestion, ecoSummary, ecosystem \} from "\.\/eco\.js"/)
  assert.match(main, /from "\.\/steps\.js"/)
  assert.match(main, /import \{ canImprove, roundEntry, roundHint, roundLine \} from "\.\/rounds\.js"/)
  assert.doesNotMatch(main, /booth\.js|boothCoach/)
  for (const fn of ["scenarioCard", "rail", "ecoBar", "stepPanel", "reviewPanel", "coachLine", "targetLine", "improveIt"]) assert.match(main, new RegExp(`function ${fn}\\(`), fn)
  const coach = main.slice(main.indexOf("function coachLine("), main.indexOf("function feel("))
  assert.match(coach, /ecoQuestion\(result\)/)
  assert.doesNotMatch(coach, /plainCoach\(/)
  const feel = main.slice(main.indexOf("function feel("), main.indexOf("const SITE_ROLES"))
  assert.match(feel, /coachLine\(result\)/)
  assert.match(feel, /gauge\("MONEY"/)
  assert.match(feel, /gauge\("TIME"/)
  assert.match(feel, /state\.nerd \? \[\s*gauge\("POWER"/)
  const game = main.slice(main.indexOf("function gameScreen("), main.indexOf("/* ---------- Run"))
  assert.match(game, /scenarioCard\(uc\)/)
  assert.match(game, /ecoBar\(result\), rail\(stepId\)/)
  assert.match(game, /stepPanel\(stepId, result\)/)
  assert.match(main, /step: "location", round: 1, rounds: \[\]/)
  assert.match(main, /btn\("IMPROVE IT ▶"/)
  assert.match(main, /text: roundLine\(rounds\)/)
  assert.match(main, /"data-key": "users-place"/)
  assert.match(main, /"data-key": "data-place"/)
  assert.match(main, /"data-key": "eco-bar"/)
  assert.match(main, /"data-key": "target"/)
  const css = readFileSync(join(root, "css/game.css"), "utf8")
  for (const selector of [".eco-bar {", ".eco-part.red", ".rail {", ".step-panel {", ".step-nav {", ".scenario .sc-facts {"]) assert.ok(css.includes(selector), selector)
})
