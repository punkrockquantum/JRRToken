/**
 * PLAYERS.md: the staff "sheet" kept in the private players repo. Pure functions, no I/O, so Node
 * can unit test them (tests/intake.test.js). The Worker regenerates the whole file from players.json
 * after every recorded game, so the file never drifts from the source of truth for long.
 *
 * Layout:
 *   # Token Quest players
 *   Updated <ISO> · <n> players · <m> games
 *   ## Players   | # | Name | Email | Attempts | Best score | Latest score | Best job | First played | Last played |
 *                sorted by best score (desc), ties to whoever got there first
 *   ## Attempts  | Played at | Name | Email | Job | Score |   newest first
 */
import { aggregatePlayers } from "./players.mjs"

export const PLAYERS_HEADERS = ["#", "Name", "Email", "Attempts", "Best score", "Latest score", "Best job", "First played (UTC)", "Last played (UTC)"]
export const ATTEMPTS_HEADERS = ["Played at (UTC)", "Name", "Email", "Job", "Score"]
const PLAYERS_ALIGN = ["---:", "---", "---", "---:", "---:", "---:", "---", "---", "---"]
const ATTEMPTS_ALIGN = ["---", "---", "---", "---", "---:"]

/** One table cell: no newlines, pipes or backslashes escape, "<" neutralised so no HTML slips into the sheet. */
export function escapeCell(value) {
  const text = value === null || value === undefined ? "" : String(value)
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/</g, "&lt;")
    .replace(/\s+/g, " ")
    .trim()
}

function cell(value) {
  const escaped = escapeCell(value)
  return escaped || "—"
}

export function formatScore(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return "—"
  return Math.round(n).toLocaleString("en-GB")
}

/** "2026-10-08 09:25" from an ISO string; anything else is shown as is. */
export function formatTime(iso) {
  const text = String(iso || "")
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(text)
  return match ? `${match[1]} ${match[2]}` : text
}

function row(cells) {
  return `| ${cells.join(" | ")} |`
}

function table(headers, align, rows, emptyLine) {
  const lines = [row(headers.map(cell)), row(align)]
  for (const cells of rows) lines.push(row(cells))
  if (!rows.length) lines.push("", emptyLine)
  return lines.join("\n")
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

/** The one-line status at the top: "Updated <ISO> · 3 players · 5 games". */
export function statusLine(attempts, now) {
  const players = aggregatePlayers(attempts).length
  return `Updated ${new Date(now).toISOString()} · ${plural(players, "player")} · ${plural(attempts.length, "game")}`
}

export function playersRows(players) {
  return players.map((player) => [
    String(player.rank),
    cell(player.name),
    cell(player.email),
    String(player.attempts),
    formatScore(player.best),
    formatScore(player.latest),
    cell(player.bestUseCase),
    formatTime(player.firstPlayedAt),
    formatTime(player.lastPlayedAt),
  ])
}

export function attemptsRows(attempts) {
  return [...attempts]
    .map((attempt, index) => ({ attempt, index }))
    .sort((a, b) => String(b.attempt.playedAt).localeCompare(String(a.attempt.playedAt)) || b.index - a.index)
    .map(({ attempt }) => [formatTime(attempt.playedAt), cell(attempt.name), cell(String(attempt.email || "").toLowerCase()), cell(attempt.useCase), formatScore(attempt.score)])
}

/**
 * Renders the whole sheet. `attempts` is the players.json array (validated attempts in the order
 * they were recorded); `now` stamps the "Updated" line.
 */
export function renderPlayersMarkdown(attempts, { now = new Date() } = {}) {
  const list = Array.isArray(attempts) ? attempts : []
  const players = aggregatePlayers(list)
  return [
    "# Token Quest players",
    "",
    statusLine(list, now),
    "",
    "Private sheet for the Token Quest booth. The intake Worker rewrites this file after every game;",
    "`players.json` next to it is the source of truth. Names and email addresses live only here: delete",
    "the repo once the event is over and the leads have been handed on.",
    "",
    "## Players",
    "",
    table(PLAYERS_HEADERS, PLAYERS_ALIGN, playersRows(players), "_No players yet._"),
    "",
    "## Attempts",
    "",
    table(ATTEMPTS_HEADERS, ATTEMPTS_ALIGN, attemptsRows(list), "_No games yet._"),
    "",
  ].join("\n")
}
