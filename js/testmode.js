/**
 * TEST MODE (user: "Create a test mode, where the player info or score isn't saved. Put a
 * toggle for this on the first page only.").
 *
 * The toggle lives on the title screen. While it is on, a run is built, scored and shown like
 * any other, but nothing about it is kept: no league entry, no booth upload (so nothing reaches
 * the kiosk server, the Excel export or the players sheet), nothing in localStorage. The form
 * may stay blank because there is nothing to store. The next player (NEXT PLAYER, the idle
 * reset) always starts with the toggle off.
 */
import { attemptPayload, syncStatusLine } from "./attempt.js"
import { rankOf, upsertEntry } from "./league.js"
import { roundEntry } from "./rounds.js"

export const TEST_MODE_LINE = "Test mode: not saved"
export const TEST_MODE_BADGE = "TEST MODE"

/** START needs a valid name, email and consent; in test mode nothing is stored, so the form may stay blank. */
export function canStart({ testMode = false, nameOk = false, emailOk = false, consent = false } = {}) {
  return Boolean(testMode) || Boolean(nameOk && emailOk && consent)
}

/** The next player always starts with test mode off. */
export function testModeAfterReset() {
  return false
}

/**
 * What a finished run does with the player's data. Outside test mode the league gains the
 * entry (`hooks.saveLeague` gets the new board), the booth gets the payload
 * (`hooks.recordAttempt`, whose promise is returned as `upload`) and the line shows the rank.
 * In test mode neither hook is called, the league is returned untouched and the line says so.
 */
export function settleAttempt({ testMode = false, league = [], player = {}, result, rounds = [], at = Date.now(), story = "" } = {}, hooks = {}) {
  if (testMode) {
    return { saved: false, league, entry: null, rank: null, players: league.length, syncLine: TEST_MODE_LINE, payload: null, upload: null }
  }
  const entry = roundEntry(player, result, rounds, { at, story })
  const next = upsertEntry(league, entry)
  hooks.saveLeague?.(next)
  const rank = rankOf(next, player.name)
  const payload = attemptPayload(player, result, entry.at)
  const upload = hooks.recordAttempt?.(payload) ?? null
  return { saved: true, league: next, entry, rank, players: next.length, syncLine: syncStatusLine(null, { rank, players: next.length }), payload, upload }
}
