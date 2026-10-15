import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { BOOTH_COACH_KEYS, boothCoach } from "../js/booth.js"
import { COACH_KEYS, coachKey, plainCoach } from "../js/coach.js"
import { USE_CASES } from "../js/data.js"
import { evaluateBuild } from "../js/model.js"
import { allSimple, choicesToBuild, simpleToChoices } from "../js/presets.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const main = readFileSync(join(root, "js/main.js"), "utf8")

const sentences = (line) => line.split(/(?<=[.!?])\s+(?=[A-Z])/).length
const simpleResult = (id, combo) => evaluateBuild(id, choicesToBuild(id, simpleToChoices(id, combo), false))

test("the booth coach has one sentence for every lesson the nerd coach knows", () => {
  assert.deepEqual(BOOTH_COACH_KEYS.slice().sort(), COACH_KEYS.slice().sort())
  for (const key of COACH_KEYS) assert.ok(key.length > 0)
  assert.equal(boothCoach(null), "Pick a GPU to start the factory.")
  assert.equal(coachKey(null), "start")
})

test("every simple build gets a single booth sentence that names a data-center decision", () => {
  const banned = /\bms\b|tok\/s|TB\/s|\bkW\b|PUE|Gbps|\$/
  const seen = new Set()
  for (const { id } of USE_CASES) {
    for (const combo of allSimple(id)) {
      const result = simpleResult(id, combo)
      const line = boothCoach(result)
      const label = `${id} ${combo.brains}/${combo.hall}/${combo.wires}/${combo.data}: ${line}`
      assert.match(line, /^[A-Z].*[.?]$/, label)
      assert.equal(sentences(line), 1, label)
      assert.doesNotMatch(line, banned, label)
      assert.match(line, /cool|hall|connection|wires|closer|memory|GPU|power|money|wallet|deadline|building|factory/i, label)
      assert.ok(line.length <= 100, `${label} (${line.length} chars)`)
      seen.add(coachKey(result))
    }
  }
  assert.ok(seen.has("far") && seen.has("wires") && seen.has("liquid"), `the simple space reaches the location, connection and cooling lessons: ${[...seen].join(", ")}`)
})

test("the booth sentence keeps the anchors the smoke reads, while the nerd line is unchanged", () => {
  const chat = (combo) => simpleResult("chat", combo)
  const far = chat({ brains: "medium", hall: "cool", wires: "peer" })
  assert.equal(coachKey(far), "far")
  assert.match(boothCoach(far), /far city.*closer/)
  assert.equal(plainCoach(far), "People in the far city are waiting. A hall closer to them answers faster.")
  const slow = chat({ brains: "medium", hall: "cool", wires: "cheap" })
  assert.equal(coachKey(slow), "wires", "chat on the public internet is a connection lesson, like its results headline")
  assert.match(boothCoach(slow), /slow connection.*slow wires/)
  assert.equal(coachKey(simpleResult("drug", { brains: "medium", hall: "plus", wires: "cheap", data: "plus" })), "wires", "the lab feed on the public internet screens fewer candidates")
  assert.equal(coachKey(simpleResult("drug", { brains: "big", hall: "super", wires: "fast", data: "plus" })), "power", "two NVL72 racks pull more than the lab's small power room feeds")
  assert.equal(coachKey(simpleResult("rag", { brains: "medium", hall: "cool", wires: "fast", data: "plus" })), "power", "six air racks only fit the rear-door hall's better PUE")
  const hot = chat({ brains: "big", hall: "cool", wires: "fast" })
  assert.equal(coachKey(hot), "liquid")
  assert.match(boothCoach(hot), /^These racks need liquid cooling, /)
  assert.equal(plainCoach(hot), "These racks need liquid cooling. Air alone cannot keep them running.")
  const nice = simpleResult("code", { brains: "big", hall: "plus", wires: "fast", data: "plus" })
  assert.equal(coachKey(nice), "nice")
  assert.equal(sentences(boothCoach(nice)), 1)
  assert.equal(plainCoach(nice), "Nice! Close, cool and connected. Can you spend a little less?")
  const chatBest = chat({ brains: "big", hall: "plus", wires: "fast", data: "on" })
  assert.ok(chatBest.slaMet && chatBest.coverage < 0.95 && chatBest.score >= 1350, `chat's best simple build keeps its promise and earns three stars: ${chatBest.coverage} ${chatBest.score}`)
  assert.equal(coachKey(chatBest), "nice", "chat's best simple build is not told it is short before GO")
  assert.equal(sentences(boothCoach(chatBest)), 1)
  const robotBest = simpleResult("robot", { brains: "big", hall: "plus", wires: "fast", data: "on" })
  assert.ok(robotBest.slaMet && robotBest.coverage >= 0.95 && robotBest.coverage < 1, `robot's best serves nearly everyone: ${robotBest.coverage}`)
  assert.equal(coachKey(robotBest), "nice")
  const shortStill = simpleResult("robot", { brains: "medium", hall: "plus", wires: "fast", data: "on" })
  assert.ok(shortStill.coverage < 0.95 && shortStill.score < 1350, `a build that really is short stays short: ${shortStill.coverage} ${shortStill.score}`)
  assert.equal(coachKey(shortStill), "short")
})

test("the simple board shows the booth sentence and the nerd board keeps the plain coach", () => {
  const simpleFeel = main.slice(main.indexOf("function simpleFeel("), main.indexOf("function gauge("))
  assert.match(simpleFeel, /boothCoach\(result\)/)
  assert.doesNotMatch(simpleFeel, /plainCoach\(/)
  const feel = main.slice(main.indexOf("function feel("), main.indexOf("function ", main.indexOf("function feel(") + 1))
  assert.match(feel, /plainCoach\(result\)/)
  assert.match(main, /import \{ boothCoach \} from "\.\/booth\.js"/)
})
