import assert from "node:assert/strict"
import test from "node:test"
import { SITES, USE_CASES, byId } from "../js/data.js"
import { FIBER_MAX_KM, evaluateBuild, kmBetween } from "../js/model.js"
import { COMBO, choicesToBuild, expertChoices, hasCombo, simpleChoices, wireIds } from "../js/presets.js"
import { allSimple, stepTiles } from "../js/steps.js"

const score = (id, choices, nerd = false) => evaluateBuild(id, choicesToBuild(id, choices, nerd))

test("COMBO is offered only where a mixture pays, and it is the best wire for robots, coding agents, RAG and research", () => {
  assert.deepEqual(USE_CASES.filter(({ id }) => hasCombo(id)).map(({ id }) => id), ["rag", "code", "research", "robot"])
  assert.deepEqual(wireIds("chat"), ["cheap", "peer", "fast"])
  assert.deepEqual(wireIds("robot"), ["cheap", "peer", "fast", "combo"])
  assert.deepEqual(wireIds("code", true), ["cheap", "peer", "fast", "private", "combo"])
  for (const id of ["robot", "code", "rag", "research"]) {
    const base = expertChoices(id)
    const scores = Object.fromEntries(wireIds(id).map((wires) => [wires, score(id, { ...base, wires }).score]))
    const best = Object.entries(scores).reduce((a, b) => (b[1] > a[1] ? b : a))[0]
    assert.equal(best, "combo", `${id}: ${JSON.stringify(scores)}`)
    assert.ok(scores.combo > scores.fast, `${id}: COMBO ${scores.combo} beats ServiceFabric everywhere ${scores.fast}`)
  }
})

test("a chatbot on one metro does best on ServiceFabric or peering; the batch screen still works on the open internet", () => {
  const chat = expertChoices("chat")
  const single = { ...chat, metros: ["lon"] }
  const scores = Object.fromEntries(wireIds("chat").map((wires) => [wires, score("chat", { ...single, wires }).score]))
  const best = Object.entries(scores).reduce((a, b) => (b[1] > a[1] ? b : a))[0]
  assert.ok(best === "fast" || best === "peer", `chat single-site best is ${best}: ${JSON.stringify(scores)}`)
  const drug = expertChoices("drug")
  const internet = score("drug", { ...drug, wires: "cheap" })
  assert.equal(internet.slaMet, true, "batch work is not SLA-killed")
  assert.ok(internet.score >= 400, `drug on the open internet still scores ${internet.score}`)
  assert.ok(internet.score < score("drug", { ...drug, wires: "fast" }).score, "but a fat private pipe screens more")
})

test("COMBO routes each leg as the tile says, bills every product, and lights dark fiber only within fibre reach", () => {
  for (const id of ["rag", "code", "research", "robot"]) {
    const combo = COMBO[id]
    const useCase = byId(USE_CASES, id)
    for (const picks of allSimple(id).filter((item) => item.wires === "combo").slice(0, 40)) {
      const build = choicesToBuild(id, picks, false)
      const places = picks.metros.map((metro) => byId(SITES, metro))
      const regional = places.every((a) => places.every((b) => kmBetween(a, b) <= FIBER_MAX_KM))
      for (const leg of useCase.legs) {
        const route = build.routes[leg.id]
        if (!route) continue
        let want = combo.legs[leg.id] ?? combo.legs.all ?? "fabric"
        if (leg.role === "inter" && want === "fiber" && !regional) want = "fabric"
        assert.equal(route.kind, want, `${id} ${leg.id} on ${picks.metros.join("+")}`)
      }
      const result = evaluateBuild(id, build)
      assert.ok(result.ok, `${id} COMBO evaluates`)
      assert.ok((result.warnings || []).every((line) => !/falls back to the public internet/.test(line)), `${id} COMBO legs are all legal: ${result.warnings}`)
      const kinds = Object.values(build.routes).map((route) => route.kind).filter((kind) => kind !== "off")
      if (kinds.length >= 2) assert.ok(new Set(kinds).size >= 2, `${id} COMBO really mixes products on ${picks.metros.join("+")}: ${kinds}`)
    }
  }
  /* Robots: the plant's carrier lands on a cross connect, and the miles beyond it are fibre physics, not zero. */
  const robot = evaluateBuild("robot", choicesToBuild("robot", { ...expertChoices("robot"), wires: "combo" }, false))
  const users = (robot.legResults || []).find((leg) => leg.id === "users")
  assert.ok(users && users.kind === "cross", "robot ingress rides the plant cross connect")
  assert.ok(users.rttS > 0.001 && users.rttS < 0.01, `plant to Frankfurt is a few ms, saw ${users.rttS}`)
  /* Coding agents: Ashburn + Silicon Valley are too far for dark fiber, Ashburn + Chicago are not. */
  const far = choicesToBuild("code", { ...expertChoices("code"), metros: ["iad", "sjc"], wires: "combo" }, false)
  const near = choicesToBuild("code", { ...expertChoices("code"), metros: ["iad", "chi"], wires: "combo" }, false)
  assert.equal(far.routes.inter.kind, "fabric")
  assert.equal(near.routes.inter.kind, "fiber")
  const nearResult = evaluateBuild("code", near)
  assert.ok(nearResult.leadParts.find((part) => part.id === "network").weeks >= 10, "dark fiber waits out its lead time")
})

test("the COMBO tile reads as a plain mix on the board and own-fibre picks snap onto it", () => {
  for (const id of ["rag", "code", "research", "robot"]) {
    const tile = stepTiles(id, "wires").find((item) => item.id === "combo")
    assert.equal(tile.label, "COMBO")
    assert.ok(tile.parts.length >= 3 && tile.parts.every((part) => /→/.test(part)), `${id} parts name a leg and a product`)
    assert.doesNotMatch(tile.parts.join(" "), /\bms\b|Gbps|\$/, `${id} the tile stays plain`)
    assert.equal(simpleChoices(id, { ...expertChoices(id), wires: "private" }).wires, "combo", `${id} own fibre snaps onto COMBO`)
  }
  assert.equal(simpleChoices("chat", { ...expertChoices("chat"), wires: "private" }).wires, "fast", "a chatbot has no COMBO: own fibre snaps onto ServiceFabric")
  assert.equal(stepTiles("chat", "wires").find((item) => item.id === "combo"), undefined)
})
