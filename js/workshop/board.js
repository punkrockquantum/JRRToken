/**
 * Workshop mode: the projector board (/board/<code>). Big clock and phase, one row per table with four
 * station lights, approvals during the build and scores + ranks from the read-out on. Polls the public
 * board endpoint every 4 s; shows no emails, no host codes, no PIN.
 */
import { ApiError, codeFromLocation, createApi } from "./api.js"
import { STATIONS, STATION_IDS } from "./cfd.js"
import { clientTimer } from "./timer.js"
import { el, mount } from "./ui.js"

const POLL_MS = 4000
const LIGHT = { "not started": "", "in progress": "work", pitched: "pitched", approved: "ok", "sent back": "back" }

export function createBoard({ root = document.getElementById("app"), api = createApi(), location = globalThis.location } = {}) {
  const state = { code: codeFromLocation(location), session: null, teams: [], released: false, error: "", pollTimer: null, tickTimer: null }

  async function refresh() {
    if (!state.code) {
      state.error = "Open this page as /board/<session code>."
      render()
      return
    }
    try {
      const reply = await api.get(`/api/session/${encodeURIComponent(state.code)}/board`)
      state.session = reply.session
      state.teams = reply.teams
      state.released = reply.released
      state.error = ""
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : "The board lost its connection; retrying."
    }
    render()
  }

  function schedulePoll() {
    clearTimeout(state.pollTimer)
    state.pollTimer = setTimeout(async () => {
      if (!document.hidden) await refresh()
      schedulePoll()
    }, POLL_MS)
  }

  function render() {
    mount(root, el("section.screen.board", {}, head(), rows(), foot()))
    tick()
  }

  function tick() {
    clearInterval(state.tickTimer)
    const update = () => {
      const timer = state.session?.timer
      const node = root.querySelector(".clock .time")
      if (!node || !timer) return
      const t = clientTimer(timer, Date.now(), api.offsetMs)
      node.textContent = t.clock
      node.className = `time${t.over ? " over" : t.remainingS <= 120 && timer.started ? " warn" : ""}`
    }
    update()
    state.tickTimer = setInterval(update, 500)
  }

  function head() {
    const timer = state.session?.timer
    const t = timer ? clientTimer(timer, Date.now(), api.offsetMs) : { clock: "--:--", over: false }
    const host = (location?.host || "").replace(/^www\./, "")
    return el(
      "div.head",
      {},
      el("div", {}, el("h1", {}, state.session?.name || "TOKEN QUEST · WORKSHOP"), el("p.dim", {}, "Design a CFD supercomputer for Apex Aero Racing · four stations · pitch to your architect")),
      el("div.clock", {}, el("div.time", { className: `time${t.over ? " over" : ""}` }, t.clock), el("div.phase", {}, timer ? [el("b", {}, timer.label), ` · ${timer.caption}`] : state.error || "connecting…")),
      el("div.join-hint", {}, "JOIN ", el("span.dim", {}, `${host}/workshop`), el("br"), "CODE ", el("b", {}, state.code || "----")),
    )
  }

  function rows() {
    if (state.error && !state.session) return el("div.waiting", {}, el("p.big", {}, "BOARD"), el("p", {}, state.error))
    if (!state.teams.length) return el("div.waiting", {}, el("p.big", {}, "WAITING FOR TABLES"), el("p", {}, `Each table opens /workshop on its iPad, enters code ${state.code}, its table number, team name and architect.`))
    return el(
      "div.rows",
      {},
      ...state.teams.map((team, index) =>
        el(
          "div.team",
          { className: `team${state.released && (team.rank === 1 || (index === 0 && team.score !== null)) ? " first" : ""}` },
          el("span.pos", {}, state.released && team.rank ? `#${team.rank}` : `T${team.number}`),
          el("span.nm", {}, team.name || `Table ${team.number}`, el("small", {}, team.hostName ? `architect ${team.hostName}` : "")),
          el(
            "span.lights",
            { "aria-label": STATION_IDS.map((id) => `${STATIONS.find((s) => s.id === id).short}: ${team.stations?.[id] || "not started"}`).join(", ") },
            ...STATION_IDS.map((id) => el("span.light", { className: `light ${LIGHT[team.stations?.[id]] || ""}`.trim(), title: STATIONS.find((s) => s.id === id).short })),
          ),
          el("span.sc", {}, state.released && team.score !== null && team.score !== undefined ? String(team.score) : team.submitted ? "SUBMITTED" : `${team.approved}/4`),
        ),
      ),
    )
  }

  function foot() {
    const legend = STATIONS.map((station) => station.short).join(" · ")
    return el(
      "div.foot",
      {},
      el("span", {}, `Lights: ${legend} · blue working · yellow pitched · green approved · orange sent back`),
      el("span", {}, state.released ? "Scores: 1,000 × runs per night vs par × first-time approval × right-sized power × latency" : "Scores appear at the read-out"),
    )
  }

  async function boot() {
    render()
    await refresh()
    schedulePoll()
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh()
    })
  }

  return { boot, refresh, render, state }
}

if (typeof document !== "undefined" && document.getElementById("app")?.dataset.page === "board") {
  const board = createBoard()
  globalThis.__tqBoard = board
  board.boot()
}
