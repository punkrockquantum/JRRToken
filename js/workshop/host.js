/**
 * Workshop mode: the facilitator page (/host). One laptop runs the room: create the session, hand the
 * join code / QR to the tables and a host code to each architect, press the phase buttons (brief →
 * build → read-out → end), nudge the clock, and watch the teams × stations grid fill up. The timer is
 * the server's; this page only displays it.
 *
 * The session code and PIN stay in this browser (localStorage) so a reload resumes the room. The PIN
 * never goes to the projector: open /board/<code> on that screen instead.
 */
import { ApiError, codeFromLocation, createApi, createStore } from "./api.js"
import { STATIONS, STATION_IDS } from "./cfd.js"
import { qrSvg } from "./qr.js"
import { PHASE_LABELS, clientTimer, isLobby, runOfShow } from "./timer.js"
import { el, keypad, mount, toast } from "./ui.js"

const POLL_MS = 4000
const STORE_KEY = "tq_workshop_host"
const STATUS_CLASS = { "not started": "idle", "in progress": "work", pitched: "pitched", approved: "ok", "sent back": "back" }
const STATUS_SHORT = { "not started": "—", "in progress": "WORK", pitched: "PITCH", approved: "OK", "sent back": "BACK" }
const CONFIRM = {
  start_readout: "Start the read-out? Every table is scored and ranked now, and decisions lock.",
  end: "End the session? Tables see their read-out until they leave; nothing else changes.",
}

export function createHost({ root = document.getElementById("app"), api = createApi(), store = createStore(STORE_KEY), location = globalThis.location } = {}) {
  const state = {
    screen: "create",
    code: "",
    pin: "",
    session: null,
    teams: [],
    progress: null,
    hostCodes: [],
    joinUrl: "",
    boardUrl: "",
    showCodes: true,
    busy: false,
    error: "",
    lastToast: "",
    pollTimer: null,
    tickTimer: null,
  }

  /* ---------- data ---------- */

  function remember() {
    store.save({ code: state.code, pin: state.pin, hostCodes: state.hostCodes, joinUrl: state.joinUrl, boardUrl: state.boardUrl })
  }

  function forget(message = "") {
    clearTimeout(state.pollTimer)
    store.save(null)
    api.setFacilitatorPin(null)
    Object.assign(state, { screen: "create", code: "", pin: "", session: null, teams: [], progress: null, hostCodes: [], joinUrl: "", boardUrl: "", error: message })
    if (globalThis.history?.replaceState) globalThis.history.replaceState(null, "", "/host")
    render()
  }

  function urlsFor(code) {
    const origin = location?.origin || ""
    return { joinUrl: `${origin}/workshop?code=${code}`, boardUrl: `${origin}/board/${code}` }
  }

  async function refresh({ render: rerender = true } = {}) {
    if (!state.code) return
    try {
      const reply = await api.get(`/api/session/${encodeURIComponent(state.code)}`)
      state.session = reply.session
      state.teams = reply.teams
      state.progress = reply.progress
      state.error = ""
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        forget(error.message)
        return
      }
      state.error = error.message
      if (state.error !== state.lastToast) {
        state.lastToast = state.error
        toast(state.error, error instanceof ApiError && error.code === "offline" ? "warn" : "bad")
      }
      return
    }
    if (rerender) render()
  }

  function schedulePoll() {
    clearTimeout(state.pollTimer)
    state.pollTimer = setTimeout(async () => {
      if (!document.hidden) await refresh()
      schedulePoll()
    }, POLL_MS)
  }

  function enter({ code, pin, hostCodes, joinUrl, boardUrl, session = null, teams = [] }) {
    state.code = code
    state.pin = pin
    state.hostCodes = hostCodes
    state.joinUrl = joinUrl || urlsFor(code).joinUrl
    state.boardUrl = boardUrl || urlsFor(code).boardUrl
    state.session = session
    state.teams = teams
    state.screen = "run"
    state.error = ""
    api.setFacilitatorPin(pin)
    remember()
    if (globalThis.history?.replaceState) globalThis.history.replaceState(null, "", `/host?code=${code}`)
  }

  async function createSession(name) {
    state.busy = true
    state.error = ""
    render()
    try {
      const reply = await api.post("/api/session", { name })
      enter({ code: reply.session.code, pin: reply.pin, hostCodes: reply.hostCodes, joinUrl: reply.joinUrl, boardUrl: reply.boardUrl, session: reply.session, teams: reply.teams })
      state.busy = false
      await refresh({ render: false })
      schedulePoll()
      toast(`Session ${reply.session.code} is open. Hand out the host codes, then START 5-MIN BRIEF.`, "ok", { ms: 4000 })
    } catch (error) {
      state.busy = false
      state.error = error.message
    }
    render()
  }

  /** A reload on another browser: the code from the URL plus the PIN re-fetches the host codes. */
  async function resume(code, pin) {
    state.busy = true
    state.error = ""
    render()
    try {
      api.setFacilitatorPin(pin)
      const reply = await api.post(`/api/session/${encodeURIComponent(code)}/hosts`, { pin })
      enter({ code, pin, hostCodes: reply.hostCodes, ...urlsFor(code) })
      state.busy = false
      await refresh({ render: false })
      schedulePoll()
      toast(`Back in session ${code}.`, "ok")
    } catch (error) {
      api.setFacilitatorPin(null)
      state.busy = false
      state.error = error.message
    }
    render()
  }

  async function act(action, extra = {}) {
    if (CONFIRM[action] && globalThis.confirm?.(CONFIRM[action]) === false) return
    state.busy = true
    render()
    try {
      const reply = await api.post(`/api/session/${encodeURIComponent(state.code)}/phase`, { pin: state.pin, action, ...extra })
      state.session = reply.session
      if (action === "start_readout") toast(`Read-out started: ${reply.scored} table${reply.scored === 1 ? "" : "s"} scored. Tables show their read-out now.`, "ok", { ms: 4000 })
      else if (action === "adjust") toast(`${PHASE_LABELS[reply.session.phase]} is now ${reply.session[`${reply.session.phase}Minutes`]} minutes.`, "ok")
      else toast(`${reply.session.timer.label}: ${reply.session.timer.caption}.`, "ok")
    } catch (error) {
      toast(error.message, "bad")
    }
    state.busy = false
    await refresh({ render: false })
    render()
  }

  async function deleteSession() {
    if (globalThis.confirm?.(`Delete session ${state.code} and everything in it? Tables lose their read-outs.`) === false) return
    try {
      await api.del(`/api/session/${encodeURIComponent(state.code)}`, { pin: state.pin })
      toast(`Session ${state.code} deleted.`, "ok")
      forget("")
    } catch (error) {
      toast(error.message, "bad")
    }
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text)
      toast(`${what} copied.`, "ok")
    } catch {
      toast(`Copy did not work here; the ${what.toLowerCase()} is ${text}`, "warn", { ms: 5000 })
    }
  }

  /* ---------- rendering ---------- */

  function render() {
    const nodes = []
    if (state.screen === "run") nodes.push(topBar(), runScreen())
    else if (state.screen === "resume") nodes.push(resumeScreen())
    else nodes.push(createScreen())
    mount(root, nodes)
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

  function clockNode() {
    const timer = state.session?.timer
    const t = timer ? clientTimer(timer, Date.now(), api.offsetMs) : { clock: "--:--", over: false }
    return el("div.clock", {}, el("div.time", { className: `time${t.over ? " over" : ""}` }, t.clock), el("div.phase", {}, timer ? [el("b", {}, timer.label), ` · ${timer.caption}`] : "connecting…"))
  }

  function topBar() {
    return el(
      "header.top",
      {},
      el("div.who", {}, el("b", {}, `FACILITATOR · ${state.session?.name || "Workshop"}`), el("span", {}, `session ${state.code} · ${state.teams.filter((team) => team.joined).length} of ${state.teams.length || 10} tables in`)),
      clockNode(),
      el(
        "div.actions",
        {},
        el("a.btn.blue.tiny", { href: state.boardUrl, target: "_blank", rel: "noopener" }, "PROJECTOR BOARD"),
        el("button.btn.ghost.tiny", { type: "button", onclick: () => ((state.showCodes = !state.showCodes), render()) }, state.showCodes ? "HIDE CODES" : "SHOW CODES"),
        el(
          "button.btn.ghost.tiny",
          {
            type: "button",
            onclick: () => {
              if (globalThis.confirm?.("Leave this session on this laptop? It keeps running; come back with the code and PIN.") !== false) forget("")
            },
          },
          "LEAVE",
        ),
      ),
    )
  }

  function createScreen() {
    const input = el("input", { id: "session-name", name: "name", type: "text", maxLength: 60, autocomplete: "off", placeholder: "e.g. Apex Aero Racing · Tuesday AM", value: "" })
    const form = el(
      "form.panel",
      {
        onsubmit: (event) => {
          event.preventDefault()
          if (!state.busy) createSession(input.value.trim() || "Workshop")
        },
      },
      el("h1", {}, "TOKEN QUEST · ", el("span", {}, "WORKSHOP"), " · FACILITATOR"),
      el("p.dim", {}, "Create a session for up to 10 tables. You get a join code and QR for the iPads, a 4-digit host code for each architect, and a 6-digit PIN for this page."),
      el("div.field", {}, el("label", { htmlFor: "session-name" }, "SESSION NAME (optional)"), input),
      el("div.targets", {}, el("p", {}, el("b", {}, "RUN OF SHOW"), " · 0–5 brief · 5–41 build · 41–50 read-out")),
      state.error ? el("p.red", { role: "alert" }, state.error) : null,
      el("button.btn.go.big.wide", { type: "submit", disabled: state.busy }, state.busy ? "CREATING…" : "CREATE SESSION"),
      el("p.small.dim", {}, "Already running one? Open /host?code=XXXX and enter its PIN. Teams join at /workshop; the projector shows /board/<code>."),
    )
    return el("section.screen.join", {}, el("div.create", {}, form))
  }

  function resumeScreen() {
    const code = state.code
    const pad = keypad({ length: 6, onsubmit: (pin) => resume(code, pin) })
    return el(
      "section.screen.join",
      {},
      el(
        "div.panel.create",
        {},
        el("h1", {}, "RESUME SESSION ", el("span", {}, code)),
        el("p.dim", {}, "Enter this session's 6-digit facilitator PIN (shown when it was created)."),
        pad,
        state.error ? el("p.red", { role: "alert" }, state.error) : null,
        el("div.fields", {}, el("button.btn.ghost", { type: "button", onclick: () => forget("") }, "START A NEW SESSION INSTEAD"), el("button.btn.go", { type: "button", disabled: state.busy, onclick: () => (pad.value().length === 6 ? resume(code, pad.value()) : toast("Six digits.", "warn")) }, state.busy ? "CHECKING…" : "RESUME")),
      ),
    )
  }

  function runScreen() {
    return el("section.screen.host", {}, sidePanel(), mainPanel())
  }

  function sidePanel() {
    const byNumber = new Map(state.teams.map((team) => [team.number, team]))
    return el(
      "div.side",
      {},
      el(
        "div.panel",
        {},
        el("h2", {}, "JOIN CODE ", el("small", {}, "— iPads open /workshop")),
        el("div.code-big", {}, state.code),
        el("div.qr", { "aria-hidden": "true", html: qrSvg(state.joinUrl, { label: `Join session ${state.code}` }) }),
        el("p.url", {}, state.joinUrl),
        el("div.fields", {}, el("button.btn.ghost.tiny", { type: "button", onclick: () => copy(state.joinUrl, "Join link") }, "COPY JOIN LINK"), el("button.btn.ghost.tiny", { type: "button", onclick: () => copy(state.boardUrl, "Board link") }, "COPY BOARD LINK")),
      ),
      el(
        "div.panel",
        {},
        el("h2", {}, "HOST CODES ", el("small", {}, "— one per architect, keep off the projector")),
        state.showCodes
          ? el(
              "div.codes",
              {},
              ...state.hostCodes.map((entry) => {
                const team = byNumber.get(entry.number)
                return el("div", { title: team?.joined ? `Table ${entry.number}: ${team.name} (architect ${team.hostName})` : `Table ${entry.number}: not joined yet` }, el("span", {}, `T${entry.number}`), el("b", {}, entry.hostCode), el("span", {}, team?.joined ? team.name : "—"))
              }),
            )
          : el("p.dim", {}, "Hidden. SHOW CODES brings them back."),
        el("p.pin", {}, "FACILITATOR PIN ", el("b", {}, state.showCodes ? state.pin : "••••••"), " · needed to resume this page elsewhere"),
      ),
    )
  }

  function phaseBar() {
    const session = state.session
    const phase = session?.phase || "brief"
    const lobby = isLobby(session)
    const order = ["brief", "build", "readout", "done"]
    const current = order.indexOf(phase)
    const steps = order.map((p, index) => {
      const minutes = p === "done" ? "" : ` ${session?.[`${p}Minutes`] ?? ""}'`
      const cls = `step${index < current || (index === current && !lobby && p !== "done") ? (index < current ? " done" : " on") : ""}${p === "done" && phase === "done" ? " done" : ""}`
      return el("span", { className: cls }, `${PHASE_LABELS[p]}${minutes}`)
    })
    const next = session?.nextAction
    const canAdjust = session && !lobby && phase !== "done"
    return el(
      "div.phase-bar",
      {},
      el("div.steps", {}, lobby ? el("span.step.on", {}, "LOBBY") : null, ...steps),
      el(
        "div.controls",
        {},
        next
          ? el("button.btn.go.big", { type: "button", disabled: state.busy, onclick: () => act(next.action) }, next.label)
          : el("button.btn.ghost", { type: "button", disabled: state.busy, onclick: deleteSession }, "DELETE SESSION"),
        el("span.spacer"),
        el("span.small.dim", {}, canAdjust ? "This phase:" : ""),
        el("button.btn.ghost.tiny", { type: "button", disabled: !canAdjust || state.busy, onclick: () => act("adjust", { deltaMinutes: -1 }) }, "−1 MIN"),
        el("button.btn.ghost.tiny", { type: "button", disabled: !canAdjust || state.busy, onclick: () => act("adjust", { deltaMinutes: 1 }) }, "+1 MIN"),
        el("button.btn.ghost.tiny", { type: "button", disabled: !canAdjust || state.busy, onclick: () => act("adjust", { deltaMinutes: 5 }) }, "+5 MIN"),
      ),
    )
  }

  function progressLine() {
    const p = state.progress
    const rows = runOfShow(state.session || {})
    const show = rows.map((row) => `${row.label} ${row.startMin}–${row.endMin}`).join(" · ")
    return el("p.small.dim", {}, p ? `${p.joined} tables in · ${p.approved} of ${p.of} stations approved · ${p.submitted} builds submitted · ` : "", show)
  }

  function grid() {
    const released = state.session?.phase === "readout" || state.session?.phase === "done"
    const head = el(
      "tr",
      {},
      el("th", {}, "#"),
      el("th", {}, "TEAM · ARCHITECT"),
      ...STATIONS.map((station) => el("th", { title: station.name }, station.short)),
      el("th", { title: "Stations approved" }, "OK"),
      el("th", { title: "Send-backs" }, "SB"),
      el("th", { style: { textAlign: "right" } }, released ? "RANK · SCORE" : "SCORE"),
    )
    const scoreCell = (team) => {
      if (!team.joined) return ""
      const score = team.score !== null && team.score !== undefined ? String(team.score) : null
      if (released) return `${team.rank ? `#${team.rank} · ` : ""}${score || "—"}`
      if (team.submitted) return `SUBMITTED${score ? ` · ${score}` : ""}`
      return score || "—"
    }
    const rows = state.teams.map((team) =>
      el(
        "tr",
        { className: team.joined ? "" : "off" },
        el("td.n", {}, String(team.number)),
        el("td.name", {}, team.joined ? [team.name, el("small", {}, team.hostName || "")] : "—"),
        ...STATION_IDS.map((id) => {
          const status = team.stations?.[id] || "not started"
          return el("td", {}, team.joined ? el("span.chip", { className: `chip ${STATUS_CLASS[status] || "idle"}` }, STATUS_SHORT[status] || status) : "")
        }),
        el("td", {}, team.joined ? `${team.approved}/4` : ""),
        el("td", {}, team.joined ? String(team.sendBacks) : ""),
        el("td.sc", {}, scoreCell(team)),
      ),
    )
    return el("div.grid-wrap", {}, el("table.grid", {}, el("thead", {}, head), el("tbody", {}, ...rows)))
  }

  function mainPanel() {
    return el("div.main", {}, el("div.panel", {}, phaseBar(), progressLine()), el("div.panel", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column" } }, el("h2", {}, "TABLES × STATIONS ", el("small", {}, "— refreshes every 4 s; scores are yours to see early, tables see them at the read-out")), grid()))
  }

  /* ---------- boot ---------- */

  async function boot() {
    const saved = store.load()
    const fromUrl = codeFromLocation(location)
    if (saved?.code && saved?.pin && (!fromUrl || fromUrl === saved.code)) {
      enter({ ...saved })
      render()
      await refresh({ render: false })
      schedulePoll()
      render()
      return
    }
    if (fromUrl) {
      state.code = fromUrl
      state.screen = "resume"
    }
    render()
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.screen === "run") refresh()
    })
  }

  return { boot, refresh, render, state, act, createSession, resume, forget }
}

if (typeof document !== "undefined" && document.getElementById("app")?.dataset.page === "host") {
  const host = createHost()
  globalThis.__tqHost = host
  host.boot()
}
