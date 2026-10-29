/**
 * The workshop's run of show: the phase state machine and the server-authoritative timer
 * (js/workshop/timer.js), shared by the Worker, the iPads, the facilitator page and the board.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { ACTIONS, DEFAULT_MINUTES, MAX_MINUTES, MIN_MINUTES, PHASES, canAct, clientTimer, formatClock, isLobby, nextAction, phaseMinutes, runOfShow, timerState, totalMinutes, transition } from "../js/workshop/timer.js"

const T0 = Date.parse("2026-11-05T09:00:00.000Z")
const iso = (ms) => new Date(ms).toISOString()
const lobby = () => ({ phase: "brief", phaseStartedAt: null, startedAt: null, endedAt: null, briefMinutes: 5, buildMinutes: 36, readoutMinutes: 9 })

test("timer: the run of show is 5 + 36 + 9 = 50 minutes by default", () => {
  assert.deepEqual(PHASES, ["brief", "build", "readout", "done"])
  assert.deepEqual(DEFAULT_MINUTES, { brief: 5, build: 36, readout: 9 })
  assert.equal(totalMinutes(lobby()), 50)
  assert.deepEqual(
    runOfShow(lobby()).map((row) => [row.phase, row.startMin, row.endMin]),
    [
      ["brief", 0, 5],
      ["build", 5, 41],
      ["readout", 41, 50],
    ],
  )
  assert.equal(isLobby(lobby()), true)
  assert.equal(phaseMinutes({ ...lobby(), phase: "build" }), 36)
  assert.equal(phaseMinutes({ ...lobby(), phase: "done" }), 0)
})

test("timer: the state machine only moves forward, one phase at a time, and adjusts only a running phase", () => {
  const session = lobby()
  assert.equal(canAct(session, "start_brief").ok, true)
  assert.equal(canAct(session, "start_build").ok, true, "a facilitator who briefed without the timer can go straight to BUILD")
  assert.deepEqual(transition(session, "start_build", iso(T0)), { phase: "build", phaseStartedAt: iso(T0), startedAt: iso(T0) })
  assert.equal(canAct(session, "start_readout").ok, false)
  assert.equal(canAct(session, "end").ok, false)
  assert.equal(canAct(session, "adjust").ok, false)
  assert.equal(canAct(session, "dance").ok, false)
  assert.deepEqual(nextAction(session), "start_brief")

  const brief = { ...session, ...transition(session, "start_brief", iso(T0)) }
  assert.deepEqual([brief.phase, brief.phaseStartedAt, brief.startedAt], ["brief", iso(T0), iso(T0)])
  assert.equal(canAct(brief, "start_brief").ok, false, "no second brief")
  assert.equal(canAct(brief, "adjust").ok, true)
  assert.equal(nextAction(brief), "start_build")

  const build = { ...brief, ...transition(brief, "start_build", iso(T0 + 300_000)) }
  assert.deepEqual([build.phase, build.phaseStartedAt, build.startedAt], ["build", iso(T0 + 300_000), iso(T0)])
  assert.equal(canAct(build, "end").ok, false, "the read-out comes before the end")
  const readout = { ...build, ...transition(build, "start_readout", iso(T0 + 2_460_000)) }
  assert.equal(readout.phase, "readout")
  const done = { ...readout, ...transition(readout, "end", iso(T0 + 3_000_000)) }
  assert.deepEqual([done.phase, done.endedAt], ["done", iso(T0 + 3_000_000)])
  assert.equal(nextAction(done), null)
  for (const action of Object.keys(ACTIONS)) assert.equal(canAct(done, action).ok, false, `${action} after the end`)
  assert.throws(() => transition(done, "start_build", iso(T0)), /after|over|ended|done/i)
})

test("timer: adjust adds or removes whole minutes from the running phase, clamped to 1..90", () => {
  const brief = { ...lobby(), ...transition(lobby(), "start_brief", iso(T0)) }
  assert.deepEqual(transition(brief, "adjust", iso(T0), { deltaMinutes: 2 }), { briefMinutes: 7 })
  assert.deepEqual(transition(brief, "adjust", iso(T0), { deltaMinutes: -1 }), { briefMinutes: 4 })
  assert.deepEqual(transition(brief, "adjust", iso(T0), { deltaMinutes: -10 }), { briefMinutes: MIN_MINUTES })
  assert.deepEqual(transition(brief, "adjust", iso(T0), { deltaMinutes: 500 }), { briefMinutes: MAX_MINUTES })
  assert.deepEqual(transition(brief, "adjust", iso(T0), { deltaMinutes: "1.9" }), { briefMinutes: 6 }, "whole minutes only")
  assert.throws(() => transition(brief, "adjust", iso(T0), { deltaMinutes: 0 }), /minutes/)
  assert.throws(() => transition(brief, "adjust", iso(T0), { deltaMinutes: "soon" }), /minutes/)
  const build = { ...brief, ...transition(brief, "start_build", iso(T0)) }
  assert.deepEqual(transition(build, "adjust", iso(T0), { deltaMinutes: 5 }), { buildMinutes: 41 })
  assert.equal(totalMinutes({ ...build, buildMinutes: 41 }), 55)
})

test("timer: timerState is authoritative on the server clock; remaining counts down, overrun counts up, the lobby shows the full brief", () => {
  const session = lobby()
  const idle = timerState(session, T0)
  assert.deepEqual([idle.phase, idle.label, idle.started, idle.minutes, idle.remainingS, idle.overrunS, idle.phaseEndsAt, idle.totalMinutes], ["brief", "LOBBY", false, 5, 300, 0, null, 50])
  assert.ok(idle.caption.length > 0)
  const build = { ...session, phase: "build", phaseStartedAt: iso(T0), startedAt: iso(T0) }
  const early = timerState(build, T0 + 90_000)
  assert.deepEqual([early.label, early.started, early.minutes, early.remainingS, early.overrunS, early.phaseEndsAt], ["BUILD", true, 36, 36 * 60 - 90, 0, iso(T0 + 36 * 60_000)])
  const late = timerState(build, T0 + 37 * 60_000)
  assert.deepEqual([late.remainingS, late.overrunS, late.phaseEndsAt], [0, 60, iso(T0 + 36 * 60_000)])
  assert.deepEqual([timerState(build, T0 + 36 * 60_000 + 500).remainingS, timerState(build, T0 + 36 * 60_000 + 500).overrunS], [0, 1], "partial seconds round up")
  assert.equal(timerState({ ...build, phase: "done", endedAt: iso(T0) }, T0).label, "DONE")
  assert.equal(timerState({ ...build, phase: "readout", readoutMinutes: 9 }, T0).remainingS, 540)
})

test("timer: clientTimer counts on the device clock, corrected by the server offset, and formatClock is mm:ss", () => {
  const state = timerState({ ...lobby(), phase: "build", phaseStartedAt: iso(T0), startedAt: iso(T0) }, T0)
  const deviceAheadBy = 5_000
  const t = clientTimer(state, T0 + 60_000 + deviceAheadBy, -deviceAheadBy)
  assert.deepEqual([t.remainingS, t.overrunS, t.clock, t.over], [36 * 60 - 60, 0, "35:00", false])
  const over = clientTimer(state, T0 + 40 * 60_000, 0)
  assert.deepEqual([over.remainingS, over.overrunS, over.clock, over.over], [0, 4 * 60, "00:00", true])
  const idle = clientTimer(timerState(lobby(), T0), T0 + 10 ** 9, 0)
  assert.deepEqual([idle.remainingS, idle.clock, idle.over], [300, "05:00", false], "an unstarted phase does not count down")
  assert.equal(formatClock(0), "00:00")
  assert.equal(formatClock(59), "00:59")
  assert.equal(formatClock(2160), "36:00")
  assert.equal(formatClock(-5), "00:00")
  assert.equal(formatClock(3600 + 61), "61:01")
})
