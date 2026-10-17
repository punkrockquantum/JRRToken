import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { fetchHealth } from "../js/health.js"
import { TITLE_ROWS, displayName, sharedScoresHint, titleBoard } from "../js/league.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const main = readFileSync(join(root, "js/main.js"), "utf8")
const smoke = readFileSync(join(root, "scripts/smoke.mjs"), "utf8")

/* User: "I don't see the league table on the first page updating properly. This should just display the first
 * name & last name top 3 based on current info in players.md" */

const shared = [
  { rank: 3, name: "Grace Hopper", attempts: 4, best: 1210, latest: 900 },
  { rank: 1, name: "Ada  Lovelace ", attempts: 2, best: 1400, latest: 1400 },
  { rank: 2, name: "alan turing", attempts: 1, best: 1388, latest: 1388 },
  { rank: 4, name: "Katherine Johnson", attempts: 1, best: 1100, latest: 1100 },
  { rank: 5, name: "Broken Row", attempts: 1, best: null },
]

test("the title board is exactly the top three by best score from the shared sheet, names as entered", () => {
  assert.equal(TITLE_ROWS, 3)
  const board = titleBoard(shared, [{ name: "Local Hero", score: 9999, at: 1 }])
  assert.equal(board.source, "shared", "the sheet wins over the browser's own league whenever the API answered")
  assert.deepEqual(board.rows, [
    { rank: 1, name: "Ada Lovelace", score: 1400 },
    { rank: 2, name: "alan turing", score: 1388 },
    { rank: 3, name: "Grace Hopper", score: 1210 },
  ])
  assert.equal(displayName("  ada   lovelace "), "ada lovelace", "whitespace tidied, case kept as entered")
  assert.equal(displayName(null), "")
  const empty = titleBoard([], [{ name: "Local Hero", score: 9999, at: 1 }])
  assert.deepEqual(empty, { source: "shared", rows: [] }, "an empty sheet shows no scores yet, not the local league")
})

test("the browser's own league stands in only when the API is unreachable", () => {
  const local = [
    { name: "Local Hero", score: 900, at: 2 },
    { name: "Second Local", score: 1200, at: 1 },
    { name: "Third", score: 300, at: 3 },
    { name: "Fourth", score: 100, at: 4 },
  ]
  const board = titleBoard(null, local)
  assert.equal(board.source, "local")
  assert.deepEqual(board.rows.map((row) => [row.rank, row.name, row.score]), [[1, "Second Local", 1200], [2, "Local Hero", 900], [3, "Third", 300]])
  assert.deepEqual(titleBoard(undefined, []), { source: "local", rows: [] })
})

test("the shared-scores hint shows only when health says the hosted sheet is not configured", async () => {
  assert.equal(sharedScoresHint({ ok: true, configured: false }), "shared scores offline")
  assert.equal(sharedScoresHint({ ok: true, configured: true }), "")
  assert.equal(sharedScoresHint({ ok: true, service: "token-quest", attempts: 2 }), "", "the kiosk server has no sheet flag and no hint")
  assert.equal(sharedScoresHint(null), "")
  /* fetchHealth never throws: a JSON body comes back as is, anything else is null. */
  const okFetch = async (url) => ({ json: async () => ({ ok: true, configured: false, url }) })
  const health = await fetchHealth(okFetch, "")
  assert.deepEqual(health, { ok: true, configured: false, url: "/api/health" })
  assert.equal(await fetchHealth(async () => ({ json: async () => "nope" }), ""), null)
  assert.equal(await fetchHealth(async () => { throw new Error("down") }, ""), null)
  assert.equal(await fetchHealth(null, ""), null)
})

test("the title re-reads the sheet every time it shows and renders rank, name and score only", () => {
  assert.match(main, /if \(screen === "title"\) refreshServerLeague\(\)/, "goto('title') re-fetches: on load, after every game, after a staff action")
  assert.match(main, /fetchLeague\(\)\.then\(\(players\) => \{\s*state\.serverLeague = players/)
  assert.match(main, /fetchHealth\(\)\.then\(\(health\) => \{\s*state\.serverHealth = health/)
  assert.match(main, /titleBoard\(state\.serverLeague, state\.league, TITLE_ROWS\)/)
  assert.match(main, /text: "No scores yet\. Be the first!"/)
  assert.match(main, /el\("span", \{ class: "lname", text: entry\.name \}\)/, "the name as entered, no upper-casing, no attempt count")
  assert.doesNotMatch(main, /class: "lcase"/, "no story label on the title board")
  assert.match(smoke, /if \(!board\.includes\("Ada Lovelace"\)\)/, "the smoke checks the finished player tops the board")
})
