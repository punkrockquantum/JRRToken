import assert from "node:assert/strict"
import test from "node:test"
import { attemptPayload, syncStatusLine } from "../js/attempt.js"
import { evaluateBuild } from "../js/model.js"

test("the booth payload matches the server contract for a finished run", () => {
  const playedAt = 1_760_000_000_000
  const consentAt = "2026-10-08T18:00:00.000Z"
  const result = evaluateBuild("chat", {
    hall: "B",
    platform: "vr",
    racks: 1,
    data: "local",
    kv: true,
    graphs: "large",
    sites: ["lon"],
    network: "fabric",
    fabric: { port: 10, vc: 1, dest: "internet", layer: "l2", redundant: true },
  })
  assert.equal(result.ok, true)
  const payload = attemptPayload({ name: "Ada Lovelace", email: "ada@example.com", consentAt }, result, playedAt)
  assert.deepEqual(payload, {
    name: "Ada Lovelace",
    email: "ada@example.com",
    score: result.score,
    useCase: "Customer Chat",
    costPerMTok: result.costPerM,
    profitPerHour: result.profit,
    consent: true,
    consentAt,
    playedAt,
    fteEquivalent: result.fteEquivalent,
    annualSavings: result.annualSavings,
    humanHoursPerYear: result.humanHoursPerYear,
    scenario: "chat",
  })
  assert.ok(payload.fteEquivalent > 0 && payload.fteEquivalent < 1_000_000)
  assert.ok(payload.annualSavings > 0 && payload.annualSavings < 5e9)
  assert.doesNotMatch(JSON.stringify(payload), /billion people/i)
  assert.ok(payload.score >= 0)
  assert.equal(attemptPayload({ name: "Ada Lovelace", email: "ada@example.com", consentAt }, { ...result, score: -4 }, playedAt).score, 0)
  assert.equal(syncStatusLine({ ok: true, attempts: 2, best: 1234, rank: 3, players: 7 }, { rank: 9, players: 9 }), "ATTEMPT 2 · BEST 1,234 · RANK 3 OF 7")
  assert.equal(syncStatusLine({ ok: false, offline: true }, { rank: 3, players: 7 }), "RANK 3 OF 7")
  assert.doesNotMatch(syncStatusLine({ ok: true, attempts: 1, best: 10, rank: 1, players: 1 }, { rank: 1, players: 1 }), /@/)
})
