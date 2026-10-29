/**
 * Workshop mode: the session's phases and the master timer, as pure functions shared by the Worker
 * (deploy/intake-worker/src/session.mjs decides transitions with them), the facilitator page, the
 * projector board and the team iPads (which render the countdown from the server's clock).
 *
 * A session runs brief → build → readout → done. The server is the authority: a session row keeps
 * `phase`, `phaseStartedAt` (null until the facilitator starts the brief: the lobby) and the three
 * durations. Every client gets `serverNow` with the state and renders the countdown from the offset
 * between that and its own clock, so ten iPads and the projector agree to the second.
 *
 * Default run of show, 50 minutes: 0–5 brief, 5–41 build across the four stations with pitch and
 * approval, 41–50 read-out and winners. The facilitator can add or remove minutes from the phase
 * that is running.
 */

export const PHASES = ["brief", "build", "readout", "done"]
export const DEFAULT_MINUTES = { brief: 5, build: 36, readout: 9 }
export const PHASE_LABELS = { brief: "BRIEF", build: "BUILD", readout: "READ-OUT", done: "DONE" }
/** One line for the big timer's caption on every screen. */
export const PHASE_CAPTIONS = {
  lobby: "Waiting for the facilitator to start",
  brief: "Listen to the 5-minute brief",
  build: "Build: four stations, pitch each one to your architect",
  readout: "Read-out: scores, ranks and what to do differently",
  done: "Session over. Thank you for playing",
}
export const MIN_MINUTES = 1
export const MAX_MINUTES = 90

/** The facilitator's actions in order; `from` lists the phases each is allowed in. */
export const ACTIONS = {
  start_brief: { from: ["brief"], to: "brief", label: "START 5-MIN BRIEF", unstartedOnly: true },
  start_build: { from: ["brief"], to: "build", label: "START BUILD" },
  start_readout: { from: ["build"], to: "readout", label: "START READ-OUT" },
  end: { from: ["readout"], to: "done", label: "END SESSION" },
  adjust: { from: ["brief", "build", "readout"], to: null, label: "ADJUST MINUTES", startedOnly: true },
}

/** True while the session sits in the lobby: created, nobody has pressed START yet. */
export function isLobby(session) {
  return session?.phase === "brief" && !session?.phaseStartedAt
}

/** Minutes the session gives one phase (0 for "done"). */
export function phaseMinutes(session, phase = session?.phase) {
  if (phase === "brief") return Number(session?.briefMinutes ?? DEFAULT_MINUTES.brief)
  if (phase === "build") return Number(session?.buildMinutes ?? DEFAULT_MINUTES.build)
  if (phase === "readout") return Number(session?.readoutMinutes ?? DEFAULT_MINUTES.readout)
  return 0
}

/** Total planned minutes (the run of show adds up to 50 by default). */
export function totalMinutes(session) {
  return phaseMinutes(session, "brief") + phaseMinutes(session, "build") + phaseMinutes(session, "readout")
}

/** The run of show as rows: phase, minutes, and the minute it starts at. */
export function runOfShow(session) {
  let at = 0
  return ["brief", "build", "readout"].map((phase) => {
    const minutes = phaseMinutes(session, phase)
    const row = { phase, label: PHASE_LABELS[phase], minutes, startMin: at, endMin: at + minutes }
    at += minutes
    return row
  })
}

/** Whether `action` may run on this session now; `{ ok, reason }`. */
export function canAct(session, action) {
  const rule = ACTIONS[action]
  if (!rule) return { ok: false, reason: `Unknown action "${action}".` }
  if (!session) return { ok: false, reason: "No such session." }
  if (!rule.from.includes(session.phase)) return { ok: false, reason: `${rule.label} is not available in the ${PHASE_LABELS[session.phase] || session.phase} phase.` }
  if (rule.unstartedOnly && session.phaseStartedAt) return { ok: false, reason: "The brief has already started." }
  if (rule.startedOnly && !session.phaseStartedAt) return { ok: false, reason: "Start the session first." }
  return { ok: true, reason: "" }
}

/** The action the facilitator's big button should offer next, or null when the session is over. */
export function nextAction(session) {
  if (!session || session.phase === "done") return null
  if (isLobby(session)) return "start_brief"
  if (session.phase === "brief") return "start_build"
  if (session.phase === "build") return "start_readout"
  return "end"
}

/**
 * The fields a session row changes when an action runs at `nowIso`. Throws on an action the phase
 * does not allow (the Worker turns that into 409). `adjust` takes `deltaMinutes` (±) and clamps the
 * running phase's minutes to MIN_MINUTES..MAX_MINUTES.
 */
export function transition(session, action, nowIso, { deltaMinutes = 0 } = {}) {
  const verdict = canAct(session, action)
  if (!verdict.ok) throw new Error(verdict.reason)
  if (action === "adjust") {
    const delta = Math.trunc(Number(deltaMinutes) || 0)
    if (!delta) throw new Error("Say how many minutes to add or remove.")
    const key = `${session.phase}Minutes`
    const minutes = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, phaseMinutes(session) + delta))
    return { [key]: minutes }
  }
  if (action === "start_brief") return { phase: "brief", phaseStartedAt: nowIso, startedAt: nowIso }
  if (action === "start_build") return { phase: "build", phaseStartedAt: nowIso, startedAt: session.startedAt || nowIso }
  if (action === "start_readout") return { phase: "readout", phaseStartedAt: nowIso }
  return { phase: "done", phaseStartedAt: nowIso, endedAt: nowIso }
}

/**
 * The timer as every client shows it: the phase, when it ends, the seconds left (never below 0),
 * how far over the clients are when the facilitator lets a phase run on, and the caption.
 */
export function timerState(session, nowMs = Date.now()) {
  const lobby = isLobby(session)
  const phase = session?.phase || "brief"
  const minutes = phaseMinutes(session, phase)
  const startMs = session?.phaseStartedAt ? Date.parse(session.phaseStartedAt) : null
  const endsMs = startMs !== null && phase !== "done" ? startMs + minutes * 60_000 : null
  const leftMs = endsMs !== null ? endsMs - nowMs : null
  return {
    phase,
    label: lobby ? "LOBBY" : PHASE_LABELS[phase] || phase.toUpperCase(),
    caption: lobby ? PHASE_CAPTIONS.lobby : PHASE_CAPTIONS[phase] || "",
    started: !lobby && startMs !== null,
    minutes,
    phaseStartedAt: session?.phaseStartedAt || null,
    phaseEndsAt: endsMs !== null ? new Date(endsMs).toISOString() : null,
    remainingS: leftMs !== null ? Math.max(0, Math.ceil(leftMs / 1000)) : minutes * 60,
    overrunS: leftMs !== null && leftMs < 0 ? Math.ceil(-leftMs / 1000) : 0,
    totalMinutes: totalMinutes(session),
  }
}

/**
 * What a client shows between polls: the state the server sent, re-counted on the client's clock.
 * `offsetMs` = serverNow − clientNow at the last poll, so a tablet with a wrong clock still agrees
 * with the projector.
 */
export function clientTimer(state, clientNowMs = Date.now(), offsetMs = 0) {
  if (!state) return { remainingS: 0, overrunS: 0, clock: "--:--", over: false }
  if (!state.phaseEndsAt) return { remainingS: state.remainingS ?? 0, overrunS: 0, clock: formatClock(state.remainingS ?? 0), over: false }
  const leftMs = Date.parse(state.phaseEndsAt) - (clientNowMs + offsetMs)
  const remainingS = Math.max(0, Math.ceil(leftMs / 1000))
  const overrunS = leftMs < 0 ? Math.ceil(-leftMs / 1000) : 0
  return { remainingS, overrunS, clock: formatClock(remainingS), over: leftMs < 0 }
}

/** "mm:ss" (hours fold into the minutes: 61:05). */
export function formatClock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}
