/**
 * Workshop mode: the session API. Up to ten table teams, an architect (host) at each table, a
 * facilitator with a PIN, a 50-minute run of show (brief → build → read-out → done) and a projector
 * board, all on the same Worker and D1 database as the kiosk game. Everything here sits behind the
 * team-password gate (or the kiosk key) exactly like the rest of /api; on top of that:
 *   - team routes (/api/team/:id/...) need the team's signed token (X-Team-Token header or the
 *     tq_team cookie handed out by join),
 *   - approvals need the table's 4-digit host code,
 *   - phase changes, host-code lookups and deletion need the session's 6-digit facilitator PIN.
 * No email addresses anywhere: a team is a table number, a team name and the architect's name.
 *
 * Routes (JSON; every response carries `ok` and `serverNow`):
 *   POST   /api/session                         { name } -> session, pin, hostCodes, joinUrl, boardUrl
 *   GET    /api/session/:code                   state: session + timer, teams × stations, progress
 *   POST   /api/session/:code/phase             { pin, action: start_brief|start_build|start_readout|end|adjust, deltaMinutes }
 *   POST   /api/session/:code/join              { number, teamName, hostName } -> team, token (+ cookie)
 *   POST   /api/session/:code/hosts             { pin } -> the host codes again (facilitator page reload)
 *   GET    /api/session/:code/board             leaderboard (scores only from the read-out phase on)
 *   DELETE /api/session/:code                   { pin } or X-Facilitator-Pin: removes the session and all its rows
 *   GET    /api/team/:id                        the team's own state: decisions, statuses, timer, read-out when released
 *   GET    /api/team/:id/decision/:station      one decision
 *   PUT    /api/team/:id/decision/:station      { choices } saves (refused once approved, until the host re-opens)
 *   POST   /api/team/:id/pitch/:station         { pitch } one sentence -> status "pitched"
 *   POST   /api/team/:id/approve/:station       { hostCode, verdict: approved|sent_back|reopen, note }
 *   POST   /api/team/:id/submit                 all four approved -> scored server-side, read-out stored
 *   GET    /api/team/:id/readout                the read-out (409 not_yet before the read-out phase)
 * Errors: 400 invalid_*, 401 team_token, 403 wrong_pin / wrong_host_code, 404 no_session / no_team,
 * 409 (state), 429 rate_limited, 503 store_unavailable / not_configured.
 *
 * Rate limits (per IP, per isolate, like ratelimit.mjs elsewhere): reads for the polling iPads and
 * boards, RATE_LIMIT_WORKSHOP_PER_MINUTE (default 900: ten tables, a few hosts and a board from one
 * venue IP every 3–5 s); joins, pitches, approvals and facilitator actions,
 * RATE_LIMIT_WORKSHOP_WRITES_PER_MINUTE (default 60).
 */
import { STATION_IDS, completeChoices, stationById, validateChoices } from "../../../js/workshop/cfd.js"
import { generateReadout } from "../../../js/workshop/readout.js"
import { ACTIONS, canAct, timerState, transition } from "../../../js/workshop/timer.js"
import { parseCookies } from "./gate.mjs"
import { createRateLimiter } from "./ratelimit.mjs"
import { TEAM_COOKIE, TEAM_TOKEN_HEADER, facilitatorPin, hostCodes, isDigits, normaliseCode, secretsMatch, sessionCode, signTeamToken, teamCookie, verifyTeamToken } from "./session-auth.mjs"
import { createSessionStore } from "./session-store.mjs"

export const MAX_TEAMS = 10
export const DEFAULT_WORKSHOP_READS_PER_MINUTE = 900
export const DEFAULT_WORKSHOP_WRITES_PER_MINUTE = 60
export const NAME_MAX = 40
export const SESSION_NAME_MAX = 60
export const PITCH_MAX = 280
export const PITCH_MIN = 3
export const NOTE_MAX = 160
export const VERDICTS = ["approved", "sent_back", "reopen"]
export const STATION_STATUSES = ["not started", "in progress", "pitched", "approved", "sent back"]

const SESSION_PATH = /^\/api\/session(?:\/([A-Za-z0-9]{1,8})(?:\/(phase|join|hosts|board))?)?\/?$/
const TEAM_PATH = /^\/api\/team\/(\d{1,12})(?:\/(decision|pitch|approve|submit|readout)(?:\/([a-z]+))?)?\/?$/
const BOARD_PAGE = /^\/board\/[A-Za-z0-9]{4,6}\/?$/

/** Trims, collapses whitespace, drops control characters; "" when nothing is left. */
export function cleanText(value, max) {
  if (typeof value !== "string") return ""
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
}

/** The status word a station shows on the iPad, the facilitator grid and the board. */
export function statusOf(decision) {
  if (!decision || !decision.choices) return "not started"
  if (decision.approval === "approved") return "approved"
  if (decision.approval === "sent_back") return "sent back"
  if (decision.pitchedAt) return "pitched"
  return "in progress"
}

/** Standard competition ranking (1, 2, 2, 4) over [{ teamId, score }], highest score first. */
export function rankScores(rows) {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.teamId - b.teamId)
  const ranks = []
  let rank = 0
  sorted.forEach((row, index) => {
    if (index === 0 || row.score !== sorted[index - 1].score) rank = index + 1
    ranks.push({ teamId: row.teamId, rank })
  })
  return ranks
}

/** The workshop's pages: the only ones the login page sends a browser back to (the kiosk game always lands on /). */
export function isWorkshopPage(pathname) {
  return /^\/(workshop|host)(?:\.html)?\/?$/.test(pathname) || BOARD_PAGE.test(pathname)
}

/** GET /board/<code> is the projector page: serve board.html for it (the page reads the code from the path). */
export function rewriteWorkshopAsset(request, url) {
  if ((request.method === "GET" || request.method === "HEAD") && BOARD_PAGE.test(url.pathname)) {
    return new Request(`${url.origin}/board.html`, request)
  }
  return request
}

function positiveInt(value, fallback) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/**
 * Builds the workshop route handler. `handle(request, env, url, cors, access, helpers)` resolves a
 * Response for a workshop path or null for anything else. `helpers` come from worker.mjs:
 * { json, readJson, HttpError, gate } so errors and bodies behave exactly like the other routes.
 */
export function createSessionRoutes({ now = () => new Date(), randomBytes, log = () => {} } = {}) {
  let limiters = null

  function rateLimit(env, kind, request, HttpError) {
    if (!limiters) {
      const clock = () => now().getTime()
      limiters = {
        read: createRateLimiter({ perMinute: positiveInt(env.RATE_LIMIT_WORKSHOP_PER_MINUTE, DEFAULT_WORKSHOP_READS_PER_MINUTE), now: clock }),
        write: createRateLimiter({ perMinute: positiveInt(env.RATE_LIMIT_WORKSHOP_WRITES_PER_MINUTE, DEFAULT_WORKSHOP_WRITES_PER_MINUTE), now: clock }),
      }
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown"
    const verdict = limiters[kind].take(ip)
    if (!verdict.ok) throw new HttpError(429, "rate_limited", "Too many requests from this network; try again in a moment.", { "Retry-After": String(verdict.retryAfter) })
  }

  function storeFor(env, HttpError) {
    if (typeof env?.DB?.prepare !== "function") throw new HttpError(503, "not_configured", 'The database is not bound yet (wrangler.toml [[d1_databases]] binding = "DB").', { "Retry-After": "60" })
    return createSessionStore({ db: env.DB })
  }

  const publicSession = (session, nowMs) => ({
    code: session.code,
    name: session.name,
    phase: session.phase,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    phaseStartedAt: session.phaseStartedAt,
    briefMinutes: session.briefMinutes,
    buildMinutes: session.buildMinutes,
    readoutMinutes: session.readoutMinutes,
    timer: timerState(session, nowMs),
    nextAction: nextActionFor(session),
  })

  function nextActionFor(session) {
    for (const action of ["start_brief", "start_build", "start_readout", "end"]) if (canAct(session, action).ok) return { action, label: ACTIONS[action].label }
    return null
  }

  const teamView = (team, decisions, readout = null, { withScore = false } = {}) => {
    const mine = decisions.filter((decision) => decision.teamId === team.id)
    const stations = Object.fromEntries(STATION_IDS.map((id) => [id, statusOf(mine.find((decision) => decision.station === id))]))
    const approved = Object.values(stations).filter((status) => status === "approved").length
    return {
      id: team.id,
      number: team.number,
      name: team.name,
      hostName: team.hostName,
      joined: Boolean(team.joinedAt),
      joinedAt: team.joinedAt,
      submitted: Boolean(team.submittedAt),
      submittedAt: team.submittedAt,
      stations,
      approved,
      sendBacks: mine.reduce((sum, decision) => sum + decision.sendBacks, 0),
      score: withScore && readout ? readout.score : null,
      rank: withScore && readout ? readout.rank : null,
    }
  }

  const decisionView = (decision) =>
    decision
      ? {
          station: decision.station,
          choices: decision.choices,
          pitch: decision.pitch,
          pitchedAt: decision.pitchedAt,
          approvedAt: decision.approvedAt,
          approval: decision.approval,
          hostNote: decision.hostNote,
          attempts: decision.attempts,
          sendBacks: decision.sendBacks,
          status: statusOf(decision),
          locked: decision.approval === "approved",
        }
      : null

  const readoutView = (readout, teamsScored) =>
    readout
      ? { score: readout.score, rank: readout.rank, teams: teamsScored, wentWell: readout.wentWell, doDifferently: readout.doDifferently, architectNotes: readout.detail?.architectNotes || [], closing: readout.detail?.closing || "", summary: readout.detail?.summary || "", detail: readout.detail?.detail || null, createdAt: readout.createdAt }
      : null

  /** Scores a team from its decisions (missing stations take the defaults) and stores the read-out. */
  async function scoreTeam(store, team, decisions, { rank = null, teams = null, nowIso }) {
    const mine = decisions.filter((decision) => decision.teamId === team.id)
    const choices = completeChoices(Object.fromEntries(mine.map((decision) => [decision.station, decision.choices])))
    const readout = generateReadout({ choices, decisions: mine, rank, teams, teamName: team.name || `Team ${team.number}` })
    await store.saveReadout(team.id, {
      score: readout.score,
      rank,
      wentWell: readout.wentWell,
      doDifferently: readout.doDifferently,
      detail: { summary: readout.summary, closing: readout.closing, architectNotes: readout.architectNotes, detail: readout.detail },
      createdAt: nowIso,
    })
    return readout
  }

  /** The read-out phase: every joined team is scored and ranked. */
  async function scoreSession(store, session, nowIso) {
    const teams = (await store.listTeams(session.code)).filter((team) => team.joinedAt)
    const decisions = await store.listSessionDecisions(session.code)
    const scored = []
    for (const team of teams) {
      const readout = await scoreTeam(store, team, decisions, { nowIso })
      scored.push({ teamId: team.id, score: readout.score })
    }
    await store.setRanks(rankScores(scored))
    return scored.length
  }

  async function requireSession(store, codeText, HttpError) {
    const code = normaliseCode(codeText)
    if (!code) throw new HttpError(404, "no_session", "That session code is not valid.")
    const session = await store.getSession(code)
    if (!session) throw new HttpError(404, "no_session", "No session with that code. Check it with the facilitator.")
    return session
  }

  async function requirePin(body, request, session, HttpError) {
    const pin = typeof body?.pin === "string" ? body.pin.trim() : request.headers.get("X-Facilitator-Pin") || ""
    if (!(await secretsMatch(pin, session.facilitatorPin))) throw new HttpError(403, "wrong_pin", "That is not this session's facilitator PIN.")
  }

  async function requireTeam(store, request, idText, gate, HttpError) {
    const id = Number(idText)
    const team = Number.isInteger(id) && id > 0 ? await store.getTeam(id) : null
    if (!team) throw new HttpError(404, "no_team", "No such team.")
    const token = request.headers.get(TEAM_TOKEN_HEADER) || parseCookies(request.headers.get("Cookie")).get(TEAM_COOKIE) || ""
    const claims = token ? await verifyTeamToken(token, gate.secret, now().getTime()) : null
    if (!claims || claims.teamId !== team.id || claims.code !== team.sessionCode) throw new HttpError(401, "team_token", "This iPad is not signed in as that team. Join again from the session code.")
    const session = await store.getSession(team.sessionCode)
    if (!session) throw new HttpError(404, "no_session", "This team's session is gone.")
    return { team, session }
  }

  function requireStation(stationText, HttpError) {
    if (!STATION_IDS.includes(stationText)) throw new HttpError(404, "no_station", `Stations are ${STATION_IDS.join(", ")}.`)
    return stationText
  }

  function buildPhaseOnly(session, HttpError) {
    if (session.phase === "readout" || session.phase === "done") throw new HttpError(409, "locked_phase", "The build phase is over; decisions are locked.")
  }

  return {
    async handle(request, env, url, cors, access, helpers) {
      const { json, readJson, HttpError, gate } = helpers
      const method = request.method.toUpperCase()
      const sessionMatch = SESSION_PATH.exec(url.pathname)
      const teamMatch = TEAM_PATH.exec(url.pathname)
      if (!sessionMatch && !teamMatch) return null
      const nowDate = now()
      const nowIso = nowDate.toISOString()
      const nowMs = nowDate.getTime()
      const reply = (status, payload, headers = {}) => json(status, { ok: status < 400, serverNow: nowIso, ...payload }, { ...cors, ...headers })
      const store = storeFor(env, HttpError)

      if (sessionMatch) {
        const [, codeText, sub] = sessionMatch

        /* POST /api/session: a new session with ten tables and their host codes. */
        if (!codeText) {
          if (method !== "POST") throw new HttpError(405, "method_not_allowed", "POST a JSON body { name } to create a session.", { Allow: "POST, OPTIONS" })
          rateLimit(env, "write", request, HttpError)
          const body = await readJson(request)
          const name = cleanText(body?.name, SESSION_NAME_MAX) || "Workshop"
          let code = null
          for (let attempt = 0; attempt < 6 && !code; attempt += 1) {
            const candidate = sessionCode(randomBytes)
            if (!(await store.sessionExists(candidate))) code = candidate
          }
          if (!code) throw new HttpError(503, "no_code", "Could not draw a free session code; try again.")
          const codes = hostCodes(MAX_TEAMS, randomBytes)
          const pin = facilitatorPin(randomBytes)
          const session = await store.createSession({ code, name, pin, createdAt: nowIso, teams: codes.map((hostCode, index) => ({ number: index + 1, hostCode })) })
          const teams = await store.listTeams(code)
          log(`workshop session created (${teams.length} tables)`)
          return reply(201, {
            session: publicSession(session, nowMs),
            pin,
            hostCodes: teams.map((team) => ({ number: team.number, hostCode: team.hostCode })),
            joinUrl: `${url.origin}/workshop?code=${code}`,
            boardUrl: `${url.origin}/board/${code}`,
            hostUrl: `${url.origin}/host?code=${code}`,
            teams: teams.map((team) => teamView(team, [])),
          })
        }

        /* DELETE /api/session/:code */
        if (!sub && method === "DELETE") {
          rateLimit(env, "write", request, HttpError)
          const session = await requireSession(store, codeText, HttpError)
          const body = request.headers.get("content-type")?.includes("application/json") ? await readJson(request) : null
          await requirePin(body, request, session, HttpError)
          await store.deleteSession(session.code)
          log("workshop session deleted")
          return reply(200, { deleted: session.code })
        }

        /* GET /api/session/:code and GET /api/session/:code/board */
        if (method === "GET" && (!sub || sub === "board")) {
          rateLimit(env, "read", request, HttpError)
          const session = await requireSession(store, codeText, HttpError)
          const teams = await store.listTeams(session.code)
          const decisions = await store.listSessionDecisions(session.code)
          const released = session.phase === "readout" || session.phase === "done"
          const readouts = await store.listReadouts(session.code)
          const byTeam = new Map(readouts.map((readout) => [readout.teamId, readout]))
          if (sub === "board") {
            const rows = teams
              .filter((team) => team.joinedAt)
              .map((team) => teamView(team, decisions, byTeam.get(team.id), { withScore: released }))
              .sort((a, b) => (released ? (b.score ?? -1) - (a.score ?? -1) || a.number - b.number : b.approved - a.approved || a.number - b.number))
            return reply(200, { session: publicSession(session, nowMs), released, teams: rows })
          }
          /* Scores show here from the read-out on, or earlier to the facilitator (PIN header); nobody sees host codes or the PIN. */
          const pinOk = await secretsMatch(request.headers.get("X-Facilitator-Pin") || "", session.facilitatorPin)
          const rows = teams.map((team) => teamView(team, decisions, byTeam.get(team.id), { withScore: released || pinOk || Boolean(access?.key) }))
          const progress = {
            joined: rows.filter((team) => team.joined).length,
            submitted: rows.filter((team) => team.submitted).length,
            approved: rows.reduce((sum, team) => sum + team.approved, 0),
            of: rows.filter((team) => team.joined).length * STATION_IDS.length,
          }
          return reply(200, { session: publicSession(session, nowMs), teams: rows, progress, released })
        }

        if (method !== "POST") throw new HttpError(405, "method_not_allowed", "Use GET or POST here.", { Allow: "GET, POST, OPTIONS" })
        rateLimit(env, "write", request, HttpError)
        const session = await requireSession(store, codeText, HttpError)
        const body = await readJson(request)

        /* POST /api/session/:code/phase */
        if (sub === "phase") {
          await requirePin(body, request, session, HttpError)
          const action = typeof body?.action === "string" ? body.action : ""
          const verdict = canAct(session, action)
          if (!verdict.ok) throw new HttpError(409, "bad_action", verdict.reason)
          let fields
          try {
            fields = transition(session, action, nowIso, { deltaMinutes: body?.deltaMinutes })
          } catch (error) {
            throw new HttpError(400, "invalid_action", error.message)
          }
          const updated = await store.updateSession(session.code, fields)
          let scored = null
          if (action === "start_readout") scored = await scoreSession(store, updated, nowIso)
          log(`workshop phase ${action}`)
          return reply(200, { session: publicSession(updated, nowMs), scored })
        }

        /* POST /api/session/:code/hosts */
        if (sub === "hosts") {
          await requirePin(body, request, session, HttpError)
          const teams = await store.listTeams(session.code)
          return reply(200, { hostCodes: teams.map((team) => ({ number: team.number, hostCode: team.hostCode, name: team.name, hostName: team.hostName })) })
        }

        /* POST /api/session/:code/join */
        if (sub === "join") {
          if (session.phase === "done") throw new HttpError(409, "session_over", "This session has ended.")
          const number = Number(body?.number)
          if (!(Number.isInteger(number) && number >= 1 && number <= MAX_TEAMS)) throw new HttpError(400, "invalid_team", `Team number must be 1 to ${MAX_TEAMS}.`)
          const teamName = cleanText(body?.teamName, NAME_MAX)
          const hostName = cleanText(body?.hostName, NAME_MAX)
          if (!teamName) throw new HttpError(400, "invalid_team_name", "Give your team a name.")
          if (!hostName) throw new HttpError(400, "invalid_host_name", "Who is the architect at your table?")
          const team = await store.getTeamByNumber(session.code, number)
          if (!team) throw new HttpError(404, "no_team", "That table does not exist in this session.")
          if (team.joinedAt && team.name && team.name.toLowerCase() !== teamName.toLowerCase()) throw new HttpError(409, "team_taken", `Table ${number} is already playing as "${team.name}". Pick your own number, or use the same team name to rejoin.`)
          const joined = await store.joinTeam(team.id, { name: teamName, hostName, joinedAt: team.joinedAt || nowIso })
          const token = await signTeamToken({ teamId: joined.id, code: session.code }, gate.secret, { now: nowMs })
          log(`workshop table ${number} joined`)
          const decisions = await store.listDecisions(joined.id)
          return reply(200, { team: teamView(joined, decisions), token, session: publicSession(session, nowMs) }, { "Set-Cookie": teamCookie(token) })
        }

        throw new HttpError(404, "not_found", "No such workshop route.")
      }

      /* ---------- team routes ---------- */
      const [, idText, sub, stationText] = teamMatch
      rateLimit(env, method === "GET" ? "read" : "write", request, HttpError)
      const { team, session } = await requireTeam(store, request, idText, gate, HttpError)
      const released = session.phase === "readout" || session.phase === "done"

      if (!sub) {
        if (method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET here.", { Allow: "GET, OPTIONS" })
        const decisions = await store.listDecisions(team.id)
        const readout = released ? await store.getReadout(team.id) : null
        const teamsScored = readout ? (await store.listReadouts(session.code)).length : null
        const view = teamView(team, decisions)
        return reply(200, {
          team: view,
          session: publicSession(session, nowMs),
          decisions: Object.fromEntries(STATION_IDS.map((id) => [id, decisionView(decisions.find((decision) => decision.station === id))])),
          canSubmit: view.approved === STATION_IDS.length && !team.submittedAt && !released,
          readout: readoutView(readout, teamsScored),
        })
      }

      if (sub === "readout") {
        if (method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET here.", { Allow: "GET, OPTIONS" })
        if (!released) throw new HttpError(409, "not_yet", "The read-out opens when the facilitator starts the read-out phase.")
        const readout = await store.getReadout(team.id)
        if (!readout) throw new HttpError(404, "no_readout", "This team has no read-out yet.")
        const teamsScored = (await store.listReadouts(session.code)).length
        return reply(200, { team: teamView(team, await store.listDecisions(team.id), readout, { withScore: true }), readout: readoutView(readout, teamsScored) })
      }

      if (sub === "submit") {
        if (method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST here.", { Allow: "POST, OPTIONS" })
        buildPhaseOnly(session, HttpError)
        const decisions = await store.listDecisions(team.id)
        const approved = STATION_IDS.filter((id) => statusOf(decisions.find((decision) => decision.station === id)) === "approved")
        if (approved.length !== STATION_IDS.length) throw new HttpError(409, "not_approved", `Every station needs the architect's approval first (${approved.length} of ${STATION_IDS.length}).`)
        if (team.submittedAt) throw new HttpError(409, "already_submitted", "This build is already in.")
        const readout = await scoreTeam(store, team, decisions, { nowIso })
        const updated = await store.markSubmitted(team.id, nowIso)
        log("workshop build submitted")
        return reply(200, { team: teamView(updated, decisions), submittedAt: nowIso, scored: true, score: access?.key ? readout.score : undefined })
      }

      const station = requireStation(stationText, HttpError)

      if (sub === "decision") {
        if (method === "GET") return reply(200, { decision: decisionView(await store.getDecision(team.id, station)) })
        if (method !== "PUT") throw new HttpError(405, "method_not_allowed", "GET or PUT a decision.", { Allow: "GET, PUT, OPTIONS" })
        buildPhaseOnly(session, HttpError)
        const existing = await store.getDecision(team.id, station)
        if (existing?.approval === "approved") throw new HttpError(409, "approved_locked", "This station is approved and locked. Ask your architect to re-open it.")
        const body = await readJson(request)
        const checked = validateChoices(station, body?.choices)
        if (!checked.ok) return reply(400, { error: "invalid_choices", message: "Those choices are not on this station's tiles.", details: checked.errors })
        const saved = await store.saveDecision(team.id, station, checked.choices, nowIso)
        return reply(200, { decision: decisionView(saved) })
      }

      if (sub === "pitch") {
        if (method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST here.", { Allow: "POST, OPTIONS" })
        buildPhaseOnly(session, HttpError)
        const existing = await store.getDecision(team.id, station)
        if (!existing) throw new HttpError(409, "no_decision", `Pick your ${stationById(station).name} tiles first.`)
        if (existing.approval === "approved") throw new HttpError(409, "approved_locked", "This station is already approved.")
        const body = await readJson(request)
        const pitch = cleanText(body?.pitch, PITCH_MAX)
        if (pitch.length < PITCH_MIN) throw new HttpError(400, "invalid_pitch", "Write one sentence on why this is the right call.")
        const pitched = await store.pitchDecision(team.id, station, pitch, nowIso)
        return reply(200, { decision: decisionView(pitched) })
      }

      if (sub === "approve") {
        if (method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST here.", { Allow: "POST, OPTIONS" })
        buildPhaseOnly(session, HttpError)
        const body = await readJson(request)
        const hostCode = typeof body?.hostCode === "string" ? body.hostCode.trim() : ""
        if (!isDigits(hostCode, 4) || !(await secretsMatch(hostCode, team.hostCode))) throw new HttpError(403, "wrong_host_code", "That is not this table's host code.")
        const verdict = typeof body?.verdict === "string" ? body.verdict : ""
        if (!VERDICTS.includes(verdict)) throw new HttpError(400, "invalid_verdict", `verdict must be one of ${VERDICTS.join(", ")}.`)
        const note = cleanText(body?.note, NOTE_MAX)
        const existing = await store.getDecision(team.id, station)
        if (!existing) throw new HttpError(409, "no_decision", "Nothing to judge yet: the team has not chosen.")
        if (verdict === "reopen") {
          if (existing.approval !== "approved") throw new HttpError(409, "not_approved", "Only an approved station can be re-opened.")
          return reply(200, { decision: decisionView(await store.reopenDecision(team.id, station, nowIso)) })
        }
        if (!existing.pitchedAt || existing.approval !== null) throw new HttpError(409, "not_pitched", existing.approval === "approved" ? "Already approved." : "The team has not pitched this station yet.")
        if (verdict === "sent_back" && !note) throw new HttpError(400, "invalid_note", "Tap a reason for sending it back.")
        const judged = await store.judgeDecision(team.id, station, { approval: verdict, note: note || null, at: nowIso })
        log(`workshop ${station} ${verdict}`)
        return reply(200, { decision: decisionView(judged) })
      }

      throw new HttpError(404, "not_found", "No such workshop route.")
    },
  }
}
