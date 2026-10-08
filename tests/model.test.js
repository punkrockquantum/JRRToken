import assert from "node:assert/strict"
import test from "node:test"
import { coach } from "../js/coach.js"
import { HALLS, PLATFORMS, USE_CASES } from "../js/data.js"
import { ordinal, rankOf, rivalFor, sortLeague, upsertEntry } from "../js/league.js"
import { evaluateDeployment, evaluatePlan, planErrors, stars } from "../js/model.js"
import { validateName } from "../js/names.js"

const build = (overrides = {}) => ({ platform: "b300", racks: 4, data: "file", kv: false, orca: false, ...overrides })

test("the roster runs from H100 to Vera Rubin and the halls differ in cooling", () => {
  const ids = PLATFORMS.map((p) => p.id)
  assert.deepEqual(ids, ["h100", "h200", "b200", "b300", "gb200", "gb300", "vr"])
  assert.ok(PLATFORMS.filter((p) => p.domain === 72).every((p) => p.cooling === "liquid"))
  assert.deepEqual(HALLS.map((h) => h.cooling), ["air", "liquid"])
  assert.ok(!USE_CASES.some((u) => /train/i.test(u.name)))
})

test("liquid-only racks are refused in the air hall", () => {
  const result = evaluateDeployment("chat", "A", build({ platform: "gb300", racks: 1 }))
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /liquid cooling/)
  assert.equal(evaluateDeployment("chat", "B", build({ platform: "gb300", racks: 1 })).ok, true)
})

test("a giant model spills off one NVLink domain on HGX H100", () => {
  const h100 = evaluateDeployment("research", "B", build({ platform: "h100", racks: 4 }))
  const nvl = evaluateDeployment("research", "B", build({ platform: "gb300", racks: 1 }))
  assert.equal(h100.fits, false)
  assert.equal(h100.bottleneck, "fit")
  assert.equal(nvl.fits, true)
  assert.ok(nvl.points > h100.points * 3)
})

test("RAG without Everpure data is slow and poorly grounded", () => {
  const local = evaluateDeployment("rag", "B", build({ data: "local", racks: 18 }))
  const vector = evaluateDeployment("rag", "B", build({ data: "vector", racks: 18 }))
  assert.equal(local.slaMet, false)
  assert.equal(local.quality, 0.55)
  assert.equal(vector.slaMet, true)
  assert.ok(vector.ttft < local.ttft)
  assert.ok(vector.points > local.points * 4)
})

test("the Everpure KV cache stops agents re-reading context", () => {
  const off = evaluateDeployment("code", "B", build({ racks: 12 }))
  const on = evaluateDeployment("code", "B", build({ racks: 12, kv: true }))
  assert.ok(on.prefillShare < off.prefillShare)
  assert.ok(on.ttft < off.ttft)
  assert.ok(on.goodput > off.goodput)
  assert.equal(coach(off).title, "STOP RE-READING!")
})

test("Vera Rubin's HBM4 bandwidth beats GB300 per megawatt on chat", () => {
  const vr = evaluateDeployment("chat", "B", build({ platform: "vr", racks: 1, data: "local", kv: true }))
  const gb = evaluateDeployment("chat", "B", build({ platform: "gb300", racks: 3, data: "local", kv: true }))
  assert.ok(vr.streamTps > gb.streamTps)
  assert.ok(vr.tokPerMW > gb.tokPerMW)
  assert.ok(vr.points > gb.points)
})

test("oversizing wastes power and costs points", () => {
  const right = evaluateDeployment("drug", "A", build({ racks: 5, orca: true }))
  const huge = evaluateDeployment("drug", "A", build({ racks: 24, orca: true }))
  assert.ok(right.coverage >= 0.95)
  assert.equal(huge.bottleneck, "oversized")
  assert.ok(right.points > huge.points * 3)
})

test("Orca PT3 only applies to drug discovery", () => {
  const without = evaluateDeployment("drug", "A", build({ racks: 3 }))
  const withOrca = evaluateDeployment("drug", "A", build({ racks: 3, orca: true }))
  const chat = evaluateDeployment("chat", "A", build({ racks: 3, orca: true }))
  assert.ok(withOrca.throughput > without.throughput)
  assert.equal(chat.orca, false)
})

test("a plan needs three missions across both halls, inside power and supply", () => {
  assert.ok(planErrors({ picks: ["chat"], halls: {}, builds: {} }).some((e) => /Choose 3/.test(e)))
  const oneHall = { picks: ["chat", "rag", "drug"], halls: { chat: "B", rag: "B", drug: "B" }, builds: {} }
  assert.ok(planErrors(oneHall).includes("Use both data halls."))

  const greedy = {
    picks: ["chat", "rag", "code"],
    halls: { chat: "B", rag: "B", code: "A" },
    builds: {
      chat: build({ platform: "vr", racks: 3, data: "local" }),
      rag: build({ platform: "vr", racks: 2 }),
      code: build({ racks: 4 }),
    },
  }
  const supply = evaluatePlan(greedy)
  assert.equal(supply.ok, false)
  assert.ok(supply.errors.some((e) => /Only 4 Vera Rubin/.test(e)))

  const hot = {
    picks: ["chat", "rag", "drug"],
    halls: { chat: "A", rag: "A", drug: "B" },
    builds: {
      chat: build({ racks: 30, data: "local" }),
      rag: build({ racks: 20 }),
      drug: build({ platform: "gb300", racks: 1 }),
    },
  }
  assert.ok(evaluatePlan(hot).errors.some((e) => /Hall A is over/.test(e)))
})

test("a sharp plan scores about par on every mission", () => {
  const plan = {
    picks: ["chat", "rag", "drug"],
    halls: { chat: "B", rag: "B", drug: "A" },
    builds: {
      chat: build({ platform: "vr", racks: 1, data: "local", kv: true }),
      rag: build({ platform: "vr", racks: 1, kv: true }),
      drug: build({ racks: 5, orca: true }),
    },
  }
  const result = evaluatePlan(plan)
  assert.equal(result.ok, true, result.errors.join(" "))
  assert.ok(result.score > 3000)
  for (const item of result.deployments) {
    assert.ok(item.points > 800, `${item.useCase.id} ${item.points}`)
    assert.ok(stars(item) >= 2, `${item.useCase.id} stars`)
  }
  assert.ok(result.badges.some((b) => b.id === "rubin"))
  const late = evaluateDeployment("rag", "B", build({ data: "local", racks: 18 }))
  assert.equal(stars(late), 0)
})

test("full names are required, and the league keeps each player's best", () => {
  assert.equal(validateName("  Ada   Lovelace ").name, "Ada Lovelace")
  assert.equal(validateName("Anne-Marie O'Neill").ok, true)
  assert.equal(validateName("José Martínez").ok, true)
  assert.equal(validateName("Madonna").ok, false)
  assert.equal(validateName("Player 1").ok, false)

  const league = upsertEntry([{ name: "Ada Lovelace", score: 3000, at: 1 }], { name: "ada lovelace", score: 2500, at: 2 })
  assert.equal(league[0].score, 3000)
  const next = upsertEntry(league, { name: "Grace Hopper", score: 3200, at: 3 })
  assert.equal(sortLeague(next)[0].name, "Grace Hopper")
  assert.equal(rankOf(next, "ada lovelace"), 2)
  assert.equal(rivalFor(next, 3100).name, "Grace Hopper")
  assert.equal(rivalFor(next, 3300), null)
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal), ["1ST", "2ND", "3RD", "4TH", "11TH", "12TH", "13TH", "21ST"])
})
