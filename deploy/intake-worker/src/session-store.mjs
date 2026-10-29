/**
 * Workshop mode storage: the `sessions`, `teams`, `decisions` and `readouts` tables
 * (migrations/0002_sessions.sql) on the same D1 database as the scores (env.DB). Plain SQL with
 * bound parameters; every D1 failure is rethrown as StoreUnavailableError so the Worker answers
 * 503 and the iPads keep polling. Rows come back as camelCase objects; host codes and the PIN are
 * read here and compared in session.mjs, never logged.
 */
import { describeD1Error } from "./d1store.mjs"
import { StoreUnavailableError } from "./store.mjs"

const SESSION_COLUMNS = "code, name, created_at, phase, phase_started_at, started_at, ended_at, brief_minutes, build_minutes, readout_minutes, facilitator_pin"
const TEAM_COLUMNS = "id, session_code, number, name, host_name, host_code, created_at, joined_at, submitted_at"
const DECISION_COLUMNS = "id, team_id, station, choices, pitch, pitched_at, approved_at, approval, host_note, attempts, send_backs, updated_at"
const READOUT_COLUMNS = "id, team_id, score, rank, went_well, do_differently, detail, created_at"

export function sessionFromRow(row) {
  if (!row) return null
  return {
    code: row.code,
    name: row.name,
    createdAt: row.created_at,
    phase: row.phase,
    phaseStartedAt: row.phase_started_at ?? null,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
    briefMinutes: Number(row.brief_minutes),
    buildMinutes: Number(row.build_minutes),
    readoutMinutes: Number(row.readout_minutes),
    facilitatorPin: row.facilitator_pin,
  }
}

export function teamFromRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    sessionCode: row.session_code,
    number: Number(row.number),
    name: row.name ?? null,
    hostName: row.host_name ?? null,
    hostCode: row.host_code,
    createdAt: row.created_at,
    joinedAt: row.joined_at ?? null,
    submittedAt: row.submitted_at ?? null,
  }
}

function parseJson(text, fallback) {
  if (typeof text !== "string") return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

export function decisionFromRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    station: row.station,
    choices: parseJson(row.choices, {}),
    pitch: row.pitch ?? null,
    pitchedAt: row.pitched_at ?? null,
    approvedAt: row.approved_at ?? null,
    approval: row.approval ?? null,
    hostNote: row.host_note ?? null,
    attempts: Number(row.attempts ?? 0),
    sendBacks: Number(row.send_backs ?? 0),
    updatedAt: row.updated_at,
  }
}

export function readoutFromRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    score: Number(row.score),
    rank: row.rank === null || row.rank === undefined ? null : Number(row.rank),
    wentWell: parseJson(row.went_well, []),
    doDifferently: parseJson(row.do_differently, []),
    detail: parseJson(row.detail, null),
    createdAt: row.created_at,
  }
}

/**
 * @param {object} options
 * @param {D1Database} options.db   the env.DB binding
 */
export function createSessionStore({ db }) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("createSessionStore needs the D1 binding (env.DB)")

  function unavailable(error) {
    if (error instanceof StoreUnavailableError) return error
    return new StoreUnavailableError(`D1: ${describeD1Error(error).replace(/the attempts table does not exist/g, "the workshop tables (sessions, teams, decisions, readouts) do not exist").replace(/the attempts table/g, "the workshop tables")}`, { cause: error })
  }

  const guard = async (work) => {
    try {
      return await work()
    } catch (error) {
      throw unavailable(error)
    }
  }

  return {
    /** Creates the session and its teams (with host codes) in one batch; resolves the session. */
    createSession({ code, name, pin, createdAt, teams }) {
      return guard(async () => {
        const statements = [
          db.prepare(`INSERT INTO sessions (code, name, created_at, phase, facilitator_pin) VALUES (?, ?, ?, 'brief', ?)`).bind(code, name, createdAt, pin),
          ...teams.map((team) => db.prepare(`INSERT INTO teams (session_code, number, host_code, created_at) VALUES (?, ?, ?, ?)`).bind(code, team.number, team.hostCode, createdAt)),
        ]
        await db.batch(statements)
        return this.getSession(code)
      })
    },

    /** True when the code is taken (so a fresh one can be drawn). */
    sessionExists(code) {
      return guard(async () => Boolean(await db.prepare(`SELECT code FROM sessions WHERE code = ?`).bind(code).first()))
    },

    getSession(code) {
      return guard(async () => sessionFromRow(await db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE code = ?`).bind(code).first()))
    },

    /** Applies the camelCase fields a transition returns (js/workshop/timer.js). */
    updateSession(code, fields) {
      return guard(async () => {
        const map = { phase: "phase", phaseStartedAt: "phase_started_at", startedAt: "started_at", endedAt: "ended_at", briefMinutes: "brief_minutes", buildMinutes: "build_minutes", readoutMinutes: "readout_minutes" }
        const sets = []
        const values = []
        for (const [key, column] of Object.entries(map)) {
          if (key in fields) {
            sets.push(`${column} = ?`)
            values.push(fields[key] ?? null)
          }
        }
        if (!sets.length) return this.getSession(code)
        await db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE code = ?`).bind(...values, code).run()
        return this.getSession(code)
      })
    },

    /** Removes a session and everything under it (a throwaway smoke session, or a facilitator's mistake). */
    deleteSession(code) {
      return guard(async () => {
        await db.batch([
          db.prepare(`DELETE FROM readouts WHERE team_id IN (SELECT id FROM teams WHERE session_code = ?)`).bind(code),
          db.prepare(`DELETE FROM decisions WHERE team_id IN (SELECT id FROM teams WHERE session_code = ?)`).bind(code),
          db.prepare(`DELETE FROM teams WHERE session_code = ?`).bind(code),
          db.prepare(`DELETE FROM sessions WHERE code = ?`).bind(code),
        ])
      })
    },

    listTeams(code) {
      return guard(async () => ((await db.prepare(`SELECT ${TEAM_COLUMNS} FROM teams WHERE session_code = ? ORDER BY number`).bind(code).all()).results || []).map(teamFromRow))
    },

    getTeam(id) {
      return guard(async () => teamFromRow(await db.prepare(`SELECT ${TEAM_COLUMNS} FROM teams WHERE id = ?`).bind(id).first()))
    },

    getTeamByNumber(code, number) {
      return guard(async () => teamFromRow(await db.prepare(`SELECT ${TEAM_COLUMNS} FROM teams WHERE session_code = ? AND number = ?`).bind(code, number).first()))
    },

    /** A table joins: name, architect, time. */
    joinTeam(id, { name, hostName, joinedAt }) {
      return guard(async () => {
        await db.prepare(`UPDATE teams SET name = ?, host_name = ?, joined_at = ? WHERE id = ?`).bind(name, hostName, joinedAt, id).run()
        return this.getTeam(id)
      })
    },

    markSubmitted(id, at) {
      return guard(async () => {
        await db.prepare(`UPDATE teams SET submitted_at = ? WHERE id = ?`).bind(at, id).run()
        return this.getTeam(id)
      })
    },

    listDecisions(teamId) {
      return guard(async () => ((await db.prepare(`SELECT ${DECISION_COLUMNS} FROM decisions WHERE team_id = ? ORDER BY id`).bind(teamId).all()).results || []).map(decisionFromRow))
    },

    /** Every decision of every team in a session, for the facilitator grid and the board. */
    listSessionDecisions(code) {
      return guard(async () => ((await db.prepare(`SELECT d.${DECISION_COLUMNS.split(", ").join(", d.")} FROM decisions d JOIN teams t ON t.id = d.team_id WHERE t.session_code = ? ORDER BY d.id`).bind(code).all()).results || []).map(decisionFromRow))
    },

    getDecision(teamId, station) {
      return guard(async () => decisionFromRow(await db.prepare(`SELECT ${DECISION_COLUMNS} FROM decisions WHERE team_id = ? AND station = ?`).bind(teamId, station).first()))
    },

    /** Saves the choices; a sent-back station goes back to "in progress" (approval cleared, send-backs kept). */
    saveDecision(teamId, station, choices, at) {
      return guard(async () => {
        await db
          .prepare(
            `INSERT INTO decisions (team_id, station, choices, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(team_id, station) DO UPDATE SET choices = excluded.choices, approval = CASE WHEN decisions.approval = 'sent_back' THEN NULL ELSE decisions.approval END, pitched_at = CASE WHEN decisions.approval = 'sent_back' THEN NULL ELSE decisions.pitched_at END, updated_at = excluded.updated_at`,
          )
          .bind(teamId, station, JSON.stringify(choices), at)
          .run()
        return this.getDecision(teamId, station)
      })
    },

    pitchDecision(teamId, station, pitch, at) {
      return guard(async () => {
        await db.prepare(`UPDATE decisions SET pitch = ?, pitched_at = ?, approval = NULL, approved_at = NULL, attempts = attempts + 1, updated_at = ? WHERE team_id = ? AND station = ?`).bind(pitch, at, at, teamId, station).run()
        return this.getDecision(teamId, station)
      })
    },

    /** The architect's verdict: approved (locks the station) or sent_back (counts against the score). */
    judgeDecision(teamId, station, { approval, note, at }) {
      return guard(async () => {
        if (approval === "approved") {
          /* An approval without a note keeps the last SEND BACK reason, so the read-out can quote it. */
          await db.prepare(`UPDATE decisions SET approval = 'approved', approved_at = ?, host_note = COALESCE(?, host_note), updated_at = ? WHERE team_id = ? AND station = ?`).bind(at, note, at, teamId, station).run()
        } else {
          await db.prepare(`UPDATE decisions SET approval = 'sent_back', approved_at = NULL, host_note = ?, send_backs = send_backs + 1, updated_at = ? WHERE team_id = ? AND station = ?`).bind(note, at, teamId, station).run()
        }
        return this.getDecision(teamId, station)
      })
    },

    /** The architect re-opens an approved station: back to "in progress", nothing counted. */
    reopenDecision(teamId, station, at) {
      return guard(async () => {
        await db.prepare(`UPDATE decisions SET approval = NULL, approved_at = NULL, pitched_at = NULL, updated_at = ? WHERE team_id = ? AND station = ?`).bind(at, teamId, station).run()
        await db.prepare(`UPDATE teams SET submitted_at = NULL WHERE id = ?`).bind(teamId).run()
        return this.getDecision(teamId, station)
      })
    },

    saveReadout(teamId, { score, rank, wentWell, doDifferently, detail, createdAt }) {
      return guard(async () => {
        await db
          .prepare(
            `INSERT INTO readouts (team_id, score, rank, went_well, do_differently, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(team_id) DO UPDATE SET score = excluded.score, rank = excluded.rank, went_well = excluded.went_well, do_differently = excluded.do_differently, detail = excluded.detail, created_at = excluded.created_at`,
          )
          .bind(teamId, score, rank ?? null, JSON.stringify(wentWell), JSON.stringify(doDifferently), detail ? JSON.stringify(detail) : null, createdAt)
          .run()
        return this.getReadout(teamId)
      })
    },

    getReadout(teamId) {
      return guard(async () => readoutFromRow(await db.prepare(`SELECT ${READOUT_COLUMNS} FROM readouts WHERE team_id = ?`).bind(teamId).first()))
    },

    listReadouts(code) {
      return guard(async () => ((await db.prepare(`SELECT r.${READOUT_COLUMNS.split(", ").join(", r.")} FROM readouts r JOIN teams t ON t.id = r.team_id WHERE t.session_code = ? ORDER BY r.score DESC, r.created_at`).bind(code).all()).results || []).map(readoutFromRow))
    },

    /** Sets the ranks after the read-out scoring: [{ teamId, rank }]. */
    setRanks(pairs) {
      return guard(async () => {
        if (!pairs.length) return
        await db.batch(pairs.map(({ teamId, rank }) => db.prepare(`UPDATE readouts SET rank = ? WHERE team_id = ?`).bind(rank, teamId)))
      })
    },

    /** How many sessions exist (health). */
    countSessions() {
      return guard(async () => Number((await db.prepare(`SELECT COUNT(*) AS n FROM sessions`).first())?.n ?? 0))
    },
  }
}
