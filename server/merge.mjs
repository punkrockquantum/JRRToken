/**
 * One league from two sources: this laptop's attempts and the team server's league (which already
 * contains everything this laptop managed to forward, plus every other laptop's games and the
 * games played on the hosted site itself). Pure functions, no I/O.
 */
import { aggregatePlayers } from "./players.mjs"
import { attemptKey } from "./store.mjs"

function later(a, b) {
  return (a || "") >= (b || "")
}

function fromUpstream(player) {
  return {
    name: player.name,
    email: String(player.email).toLowerCase(),
    attempts: Number(player.attempts) || 0,
    best: Number(player.best),
    bestAt: player.bestAt ?? null,
    bestUseCase: player.bestUseCase || "",
    bestFteEquivalent: player.fteEquivalent ?? null,
    latest: Number(player.latest),
    latestAt: player.latestAt ?? null,
    firstPlayedAt: player.firstPlayedAt ?? null,
    lastPlayedAt: player.lastPlayedAt ?? null,
  }
}

/**
 * @param {object[]} localAttempts   this laptop's attempts.jsonl records
 * @param {{ players: object[], attempts: number } | null} upstream   the team server's league (with emails), or null
 * @param {Set<string>} pendingKeys   attemptKey() of local games the team server has not confirmed yet
 * @returns {{ players: object[], attempts: number, source: "merged" | "local" }}  players ranked, with emails (use publicLeague() for the UI)
 *
 * Per player (by email): best = the higher best (ties: the earlier one); latest and name follow the
 * later lastPlayedAt; attempts = the team server's count + this laptop's not-yet-confirmed games
 * (the confirmed ones are already in the server's count), never less than what this laptop has on
 * file. Players only one side knows about are taken as they are.
 */
export function mergeLeague(localAttempts, upstream, pendingKeys = new Set()) {
  const local = aggregatePlayers(localAttempts)
  if (!upstream || !Array.isArray(upstream.players)) return { players: local, attempts: localAttempts.length, source: "local" }

  const pendingByEmail = new Map()
  let pendingTotal = 0
  for (const attempt of localAttempts) {
    if (!pendingKeys.has(attemptKey(attempt))) continue
    const email = String(attempt.email || "").toLowerCase()
    pendingByEmail.set(email, (pendingByEmail.get(email) || 0) + 1)
    pendingTotal += 1
  }

  const merged = new Map()
  for (const player of upstream.players) {
    if (!player || typeof player.email !== "string" || !player.email) continue
    const row = fromUpstream(player)
    if (!Number.isFinite(row.best)) continue
    merged.set(row.email, row)
  }
  for (const mine of local) {
    const theirs = merged.get(mine.email)
    if (!theirs) {
      merged.set(mine.email, { ...mine })
      continue
    }
    theirs.attempts = Math.max(theirs.attempts + (pendingByEmail.get(mine.email) || 0), mine.attempts)
    if (mine.best > theirs.best || (mine.best === theirs.best && theirs.bestAt !== null && mine.bestAt < theirs.bestAt)) {
      theirs.best = mine.best
      theirs.bestAt = mine.bestAt
      theirs.bestUseCase = mine.bestUseCase
      theirs.bestFteEquivalent = mine.bestFteEquivalent
    }
    if (theirs.lastPlayedAt === null || later(mine.lastPlayedAt, theirs.lastPlayedAt)) {
      theirs.lastPlayedAt = mine.lastPlayedAt
      theirs.latest = mine.latest
      theirs.latestAt = mine.latestAt
      theirs.name = mine.name
    }
    if (theirs.firstPlayedAt === null || mine.firstPlayedAt < theirs.firstPlayedAt) theirs.firstPlayedAt = mine.firstPlayedAt
  }

  const players = [...merged.values()]
    .sort((a, b) => b.best - a.best || String(a.bestAt ?? "").localeCompare(String(b.bestAt ?? "")) || String(a.name).localeCompare(String(b.name)))
    .map((player, index) => ({ ...player, rank: index + 1 }))
  const attempts = Math.max((Number(upstream.attempts) || 0) + pendingTotal, localAttempts.length)
  return { players, attempts, source: "merged" }
}
