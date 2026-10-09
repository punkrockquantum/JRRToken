/** Pure aggregation of attempts into players (keyed by lowercased email). */

function later(a, b) {
  return (a || "") >= (b || "")
}

/**
 * Groups attempts by email. Returns players sorted by best score (desc); ties go to whoever
 * reached that score first, then by name. Includes email: use publicLeague() for the UI.
 */
export function aggregatePlayers(attempts) {
  const byEmail = new Map()
  for (const attempt of attempts) {
    const key = String(attempt.email || "").toLowerCase()
    if (!key) continue
    let player = byEmail.get(key)
    if (!player) {
      player = {
        name: attempt.name,
        email: key,
        attempts: 0,
        best: -Infinity,
        bestAt: null,
        bestUseCase: "",
        bestCostPerMTok: null,
        bestFteEquivalent: null,
        bestAnnualSavings: null,
        latest: attempt.score,
        latestAt: attempt.playedAt,
        firstPlayedAt: attempt.playedAt,
        lastPlayedAt: attempt.playedAt,
        consent: true,
        consentAt: attempt.consentAt || null,
      }
      byEmail.set(key, player)
    }
    player.attempts += 1
    player.consent = player.consent && attempt.consent === true
    if (attempt.consentAt && (!player.consentAt || attempt.consentAt < player.consentAt)) player.consentAt = attempt.consentAt
    if (attempt.playedAt < player.firstPlayedAt) player.firstPlayedAt = attempt.playedAt
    if (later(attempt.playedAt, player.lastPlayedAt)) {
      player.lastPlayedAt = attempt.playedAt
      player.latest = attempt.score
      player.latestAt = attempt.playedAt
      player.name = attempt.name
    }
    if (attempt.score > player.best || (attempt.score === player.best && attempt.playedAt < player.bestAt)) {
      player.best = attempt.score
      player.bestAt = attempt.playedAt
      player.bestUseCase = attempt.useCase || ""
      player.bestCostPerMTok = attempt.costPerMTok ?? null
      player.bestFteEquivalent = attempt.fteEquivalent ?? null
      player.bestAnnualSavings = attempt.annualSavings ?? null
    }
  }
  return [...byEmail.values()]
    .sort((a, b) => b.best - a.best || String(a.bestAt).localeCompare(String(b.bestAt)) || a.name.localeCompare(b.name))
    .map((player, index) => ({ ...player, rank: index + 1 }))
}

/** The shape the game UI receives. Never includes email, consent, cost or savings details. */
export function publicLeague(players) {
  return players.map((player) => ({
    rank: player.rank,
    name: player.name,
    attempts: player.attempts,
    best: player.best,
    latest: player.latest,
    bestUseCase: player.bestUseCase,
    fteEquivalent: player.bestFteEquivalent,
    firstPlayedAt: player.firstPlayedAt,
    lastPlayedAt: player.lastPlayedAt,
  }))
}

export function findPlayer(players, email) {
  const key = String(email || "").toLowerCase()
  return players.find((player) => player.email === key) || null
}
