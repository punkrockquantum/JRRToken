/**
 * The scores database: Cloudflare D1 (SQLite) bound to the Worker as env.DB. One row per game in
 * the `attempts` table (migrations/0001_attempts.sql), whichever browser or kiosk laptop played it,
 * so every score, name and email address is kept in one place away from the game and nothing
 * depends on a GitHub token.
 *
 * Same contract the GitHub-backed store had: record() appends one validated attempt and resolves
 * the full list, all() reads everything in arrival order, ping()/totals() say how much is there.
 * Any D1 failure is thrown as StoreUnavailableError, so the Worker answers 503 store_unavailable
 * and the clients (the browser's queue, a kiosk's journal) keep the game and retry.
 *
 * Idempotency: `replay_key` = email|playedAt|score is UNIQUE. A re-posted game (the browser's
 * retry queue, a kiosk's journal) hits ON CONFLICT DO NOTHING and is reported as `replayed`.
 *
 * Aggregation (best, attempts, latest, rank) is done in JS by players.mjs on the rows, exactly as
 * the kiosk server does it, so every device agrees on the numbers. At trade-show volumes (a few
 * thousand rows at most) that is one small read per game.
 */
import { StoreUnavailableError } from "./store.mjs"

export const TABLE = "attempts"
export const MIGRATE_HINT = "run `npx wrangler d1 migrations apply tokenquest-players --remote` from deploy/intake-worker"

const COLUMNS = ["played_at", "name", "email", "score", "use_case", "scenario", "cost_per_mtok", "profit_per_hour", "fte_equivalent", "annual_savings", "human_hours_per_year", "consent_at", "source", "replay_key"]
const SELECT = `SELECT id, ${COLUMNS.join(", ")} FROM ${TABLE} ORDER BY id`
const INSERT = `INSERT INTO ${TABLE} (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")}) ON CONFLICT(replay_key) DO NOTHING RETURNING id`
const TOTALS = `SELECT COUNT(*) AS attempts, COUNT(DISTINCT email) AS players, MAX(played_at) AS last_played_at FROM ${TABLE}`

/** email|playedAt|score: what makes two posts the same game (the kiosk's attemptKey uses the same form). */
export function replayKey(attempt) {
  return `${String(attempt?.email || "").toLowerCase()}|${attempt?.playedAt}|${attempt?.score}`
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** A validated attempt (validate.mjs shape) as the bound values of one INSERT, in COLUMNS order. */
export function toRow(attempt, { source = null } = {}) {
  return [
    attempt.playedAt,
    attempt.name,
    String(attempt.email).toLowerCase(),
    attempt.score,
    attempt.useCase || null,
    attempt.scenario || null,
    numberOrNull(attempt.costPerMTok),
    numberOrNull(attempt.profitPerHour),
    numberOrNull(attempt.fteEquivalent),
    numberOrNull(attempt.annualSavings),
    numberOrNull(attempt.humanHoursPerYear),
    attempt.consentAt,
    source || null,
    replayKey(attempt),
  ]
}

/** One row back into the attempt shape the rest of the code (players.mjs, markdown.mjs, the kiosks) expects. */
export function fromRow(row) {
  return {
    id: Number(row.id),
    playedAt: row.played_at,
    name: row.name,
    email: row.email,
    score: Number(row.score),
    useCase: row.use_case ?? "",
    costPerMTok: numberOrNull(row.cost_per_mtok),
    profitPerHour: numberOrNull(row.profit_per_hour),
    fteEquivalent: numberOrNull(row.fte_equivalent),
    annualSavings: numberOrNull(row.annual_savings),
    humanHoursPerYear: numberOrNull(row.human_hours_per_year),
    scenario: row.scenario ?? "",
    consent: true,
    consentAt: row.consent_at,
    source: row.source ?? null,
  }
}

/** The D1 error as one line staff can act on. SQLite messages carry no row contents. */
export function describeD1Error(error) {
  const message = String(error?.message || error || "unknown error").replace(/^D1_ERROR:\s*/, "").replace(/:\s*SQLITE_\w+$/, "")
  if (/no such table/i.test(message)) return `the ${TABLE} table does not exist yet: ${MIGRATE_HINT}`
  if (/no such column/i.test(message)) return `the ${TABLE} table is out of date (${message}): ${MIGRATE_HINT}`
  return message || "unknown error"
}

/**
 * @param {object} options
 * @param {D1Database} options.db   the env.DB binding (prepare/batch)
 */
export function createD1Store({ db }) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("createD1Store needs the D1 binding (env.DB)")

  function unavailable(error) {
    if (error instanceof StoreUnavailableError) return error
    return new StoreUnavailableError(`D1: ${describeD1Error(error)}`, { cause: error })
  }

  async function readAll() {
    const { results } = await db.prepare(SELECT).all()
    return (results || []).map(fromRow)
  }

  return {
    kind: "d1",

    /** Every game on file, oldest first (the order they were recorded). */
    async all() {
      try {
        return await readAll()
      } catch (error) {
        throw unavailable(error)
      }
    },

    /**
     * Appends one validated attempt (once: a replay is recognised by replay_key) and resolves
     * { attempts, replayed, id } where attempts is the full list the league is computed from.
     * The insert and the read run as one batch (one round trip, one transaction).
     */
    async record(attempt, { source = null } = {}) {
      try {
        const [inserted, rows] = await db.batch([db.prepare(INSERT).bind(...toRow(attempt, { source })), db.prepare(SELECT)])
        const row = inserted?.results?.[0] ?? null
        return { attempts: (rows?.results || []).map(fromRow), replayed: !row, id: row ? Number(row.id) : null }
      } catch (error) {
        throw unavailable(error)
      }
    },

    /** { attempts, players, lastPlayedAt } straight from SQL (cheap: no rows are loaded). */
    async totals() {
      try {
        const row = await db.prepare(TOTALS).first()
        return { attempts: Number(row?.attempts ?? 0), players: Number(row?.players ?? 0), lastPlayedAt: row?.last_played_at ?? null }
      } catch (error) {
        throw unavailable(error)
      }
    },

    /** Proves the table is there and readable; throws StoreUnavailableError otherwise. */
    async ping() {
      return this.totals()
    },
  }
}
