/**
 * TEST MODE (user: "Create a test mode, where the player info or score isn't saved. Put a
 * toggle for this on the first page only."): the title toggle, the start gate, and the
 * finish-of-run state machine with the save hooks spied on.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { evaluateBuild } from "../js/model.js"
import { choicesToBuild, expertChoices } from "../js/presets.js"
import { TEST_MODE_BADGE, TEST_MODE_LINE, canStart, settleAttempt, testModeAfterReset } from "../js/testmode.js"

const main = readFileSync(new URL("../js/main.js", import.meta.url), "utf8")
const css = readFileSync(new URL("../css/game.css", import.meta.url), "utf8")
const result = evaluateBuild("chat", choicesToBuild("chat", expertChoices("chat"), true))
const player = { name: "Ada Lovelace", email: "ada@example.com", consentAt: "2026-10-08T18:00:00.000Z" }

/** A run through the finish with both hooks spied on. */
function finish(testMode, league = []) {
  const calls = { saveLeague: [], recordAttempt: [] }
  const hooks = {
    saveLeague: (board) => calls.saveLeague.push(board),
    recordAttempt: (payload) => {
      calls.recordAttempt.push(payload)
      return Promise.resolve({ ok: true, attempts: 1, best: payload.score, rank: 1, players: 1 })
    },
  }
  const settled = settleAttempt({ testMode, league, player, result, rounds: [{ score: result.score, result }], at: 1_760_000_000_000, story: "Shoppers" }, hooks)
  return { settled, calls }
}

test("test mode off: a finished run joins the league, is saved, is uploaded, and the line shows the rank", async () => {
  const { settled, calls } = finish(false)
  assert.equal(settled.saved, true)
  assert.equal(calls.saveLeague.length, 1, "the league is saved once")
  assert.equal(calls.recordAttempt.length, 1, "the booth gets one payload")
  assert.equal(settled.league.length, 1)
  assert.equal(settled.league[0].name, "Ada Lovelace")
  assert.equal(settled.league[0].email, "ada@example.com")
  assert.deepEqual(calls.saveLeague[0], settled.league, "the saved board is the new league")
  assert.equal(calls.recordAttempt[0].email, "ada@example.com")
  assert.equal(calls.recordAttempt[0].score, result.score)
  assert.equal(settled.rank, 1)
  assert.equal(settled.players, 1)
  assert.equal(settled.syncLine, "RANK 1 OF 1")
  assert.equal((await settled.upload).ok, true)
})

test("test mode on: nothing is saved, nothing is uploaded, the league is untouched, and the line says so", () => {
  const existing = [{ name: "Grace Hopper", email: "grace@example.com", score: 900, at: 1, consent: true, consentAt: "2026-10-08T18:00:00.000Z", useCase: "chat" }]
  const { settled, calls } = finish(true, existing)
  assert.equal(settled.saved, false)
  assert.equal(calls.saveLeague.length, 0, "the league is never saved")
  assert.equal(calls.recordAttempt.length, 0, "the booth is never called")
  assert.equal(settled.league, existing, "the same league object comes back")
  assert.equal(settled.entry, null)
  assert.equal(settled.payload, null)
  assert.equal(settled.upload, null)
  assert.equal(settled.rank, null)
  assert.equal(settled.players, 1)
  assert.equal(settled.syncLine, TEST_MODE_LINE)
  assert.equal(TEST_MODE_LINE, "Test mode: not saved")
  assert.equal(TEST_MODE_BADGE, "TEST MODE")
  /* A blank player is fine in test mode: there is nothing to store. */
  const blank = settleAttempt({ testMode: true, league: existing, player: { name: "", email: "" }, result, rounds: [{ score: result.score, result }] }, { saveLeague: () => assert.fail("saved"), recordAttempt: () => assert.fail("uploaded") })
  assert.equal(blank.saved, false)
})

test("the start gate: consent, a name and an email are required unless test mode is on; the next player starts with it off", () => {
  assert.equal(canStart({ testMode: false, nameOk: true, emailOk: true, consent: true }), true)
  assert.equal(canStart({ testMode: false, nameOk: true, emailOk: true, consent: false }), false, "no consent, no start")
  assert.equal(canStart({ testMode: false, nameOk: false, emailOk: true, consent: true }), false, "no name, no start")
  assert.equal(canStart({ testMode: false, nameOk: true, emailOk: false, consent: true }), false, "no email, no start")
  assert.equal(canStart({ testMode: true }), true, "test mode starts with a blank form")
  assert.equal(canStart({ testMode: true, nameOk: false, emailOk: false, consent: false }), true)
  assert.equal(canStart(), false)
  assert.equal(testModeAfterReset(), false)
})

test("the title screen carries the toggle, the HUD the badge, the results the not-saved line, and the resets clear it", () => {
  assert.match(main, /"data-key": "test-mode"/, "the toggle is on the title screen")
  assert.equal((main.match(/"data-key": "test-mode"/g) || []).length, 1, "one toggle, on the first page only")
  assert.match(main, /function titleScreen\(\)[\s\S]*"data-key": "test-mode"[\s\S]*function refreshServerLeague/, "the toggle is built inside titleScreen")
  assert.match(main, /testMode: false,/, "default off")
  assert.match(main, /state\.testMode = testModeAfterReset\(\)/, "resetRun (NEXT PLAYER and the idle reset) turns it off")
  assert.match(main, /idleTimer = setTimeout\(\(\) => \{\s*if \(state\.running\) return poke\(\)\s*resetRun\(\)/, "the idle reset goes through resetRun")
  assert.match(main, /btn\("NEXT PLAYER", resetRun/, "NEXT PLAYER goes through resetRun")
  assert.match(main, /startBtn\.disabled = !canStart\(\{ testMode: state\.testMode, nameOk, emailOk, consent: consent\.checked \}\)/)
  assert.match(main, /state\.testMode \? el\("span", \{ class: "hud-item hud-test", "data-key": "test-badge", text: TEST_MODE_BADGE \}\) : null/, "the HUD badge on every screen")
  assert.match(main, /settleAttempt\(\s*\{\s*testMode: state\.testMode,/, "finishRun settles through the pure state machine")
  assert.match(main, /settled\.upload\?\.then\(/, "the upload promise comes from the settlement")
  assert.doesNotMatch(main, /upsertEntry\(|attemptPayload\(|recordAttempt\(/, "main.js no longer saves or uploads on its own")
  assert.match(main, /text: saved \? state\.syncLine \|\| syncStatusLine\(null, \{ rank, players \}\) : TEST_MODE_LINE/, "the results line says not saved")
  assert.match(main, /"data-key": "rank-box" \}, \[\s*el\("span", \{ class: "fine", text: "TEST MODE" \}\),\s*el\("strong", \{ text: "—" \}\),\s*el\("span", \{ class: "fine", text: "NOT SAVED" \}\)/, "the rank box says not saved")
  assert.match(main, /if \(state\.testMode\) \{\s*\/\* Nothing is stored in test mode[\s\S]*?state\.email = ""\s*state\.consentAt = ""/, "a test run never carries an email or a consent stamp")
  assert.match(css, /\.start-row \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/, "START and the pill share one row")
  assert.match(css, /\.test-toggle \{ min-height: 44px;/, "a finger-sized pill")
  assert.match(css, /\.hud-item\.hud-test \{/, "a badge style")
})
