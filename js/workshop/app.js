/**
 * Workshop mode, the team iPad (/workshop?code=ABCD). One table, one architect, four stations.
 *
 *   JOIN      session code, table number, team name, architect's name
 *   HOME      the timer, the scenario card and the four station tiles with their status
 *   STATION   three tile rows at most, a live "what this does" line, PITCH
 *   APPROVAL  the architect types the table's 4-digit host code: APPROVE or SEND BACK (one-tap reason)
 *   SUBMIT    all four approved → SUBMIT BUILD (scored on the server; the number waits for the read-out)
 *   READ-OUT  score and rank, what went well, what to do differently, the architect's notes
 *
 * State lives on the Worker (session.mjs); this page polls its own team every 4 s and renders from the
 * reply. The timer counts on the device clock corrected by the server offset (api.js). Nothing here is
 * secret: the host code is typed by the architect each time, never stored.
 */
import { ApiError, codeFromLocation, createApi, createStore } from "./api.js"
import { SCENARIO, STATIONS, STATION_IDS, completeChoices, evaluateWorkshop, formatMoney, metroFacts, powerTileTitle, stationById, stationLine, tileLearn, tileOf } from "./cfd.js"
import { clientTimer } from "./timer.js"
import { el, keypad, mount, statusChip, toast } from "./ui.js"

const POLL_MS = 4000
const SEND_BACK_REASONS = ["cost", "power", "latency", "risk", "wrong tool"]
const STORE_KEY = "tq_workshop_team"

export function createApp({ root = document.getElementById("app"), api = createApi(), store = createStore(STORE_KEY), location = globalThis.location } = {}) {
  const state = {
    screen: "join",
    code: "",
    teamId: null,
    token: null,
    team: null,
    session: null,
    decisions: {},
    canSubmit: false,
    readout: null,
    stationId: null,
    draft: {},
    sheet: null,
    error: "",
    busy: false,
    lastToast: "",
    joinNumber: null,
    pollTimer: null,
    tickTimer: null,
    saveTimer: null,
  }

  /* ---------- data ---------- */

  async function refresh({ render: rerender = true } = {}) {
    if (!state.teamId) return
    try {
      const reply = await api.get(`/api/team/${state.teamId}`)
      state.team = reply.team
      state.session = reply.session
      state.decisions = reply.decisions
      state.canSubmit = reply.canSubmit
      state.readout = reply.readout
      for (const id of STATION_IDS) if (reply.decisions[id]?.choices && !state.draft[id]) state.draft[id] = { ...reply.decisions[id].choices }
      const released = state.session.phase === "readout" || state.session.phase === "done"
      if (released && state.readout && state.screen !== "readout" && state.screen !== "station") state.screen = "readout"
      if (released && state.screen === "station" && !state.sheet) state.screen = state.readout ? "readout" : "home"
      state.error = ""
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 404) && error.code !== "unauthorised") {
        leave(error.message)
        return
      }
      state.error = error.message
      if (state.screen !== "join" && state.error !== state.lastToast) {
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

  function leave(message) {
    clearTimeout(state.pollTimer)
    store.save(null)
    api.setTeamToken(null)
    Object.assign(state, { screen: "join", teamId: null, token: null, team: null, session: null, decisions: {}, readout: null, draft: {}, sheet: null, stationId: null, error: message || "" })
    render()
  }

  async function join({ code, number, teamName, hostName }) {
    state.busy = true
    state.error = ""
    render()
    try {
      const reply = await api.post(`/api/session/${encodeURIComponent(code)}/join`, { number, teamName, hostName })
      state.code = reply.session.code
      state.teamId = reply.team.id
      state.token = reply.token
      api.setTeamToken(reply.token)
      store.save({ code: state.code, teamId: state.teamId, token: state.token, number: reply.team.number, teamName: reply.team.name })
      state.screen = "home"
      state.busy = false
      await refresh({ render: false })
      schedulePoll()
      toast(`Table ${reply.team.number} is in. Welcome, ${reply.team.name}.`, "ok")
    } catch (error) {
      state.busy = false
      state.error = error.message
    }
    render()
  }

  function decisionFor(stationId) {
    return state.decisions[stationId] || null
  }

  function draftComplete(stationId) {
    const station = stationById(stationId)
    const draft = state.draft[stationId] || {}
    return station.decisions.every((decision) => decision.tiles.some((tile) => tile.id === draft[decision.id]))
  }

  /**
   * The whole build as it stands: the draft at this station, the saved choices at the others. A station
   * nobody has decided yet is assumed to fit (an OEM design made for the GPU, a hall that cools it, the
   * smallest power block that carries it, ServiceFabric), so the live line shows what THIS station's
   * tiles do rather than punishing a table for the stations it has not reached. `assumed` lists them.
   */
  function currentChoices(stationId) {
    const chosen = {}
    for (const id of STATION_IDS) {
      const value = id === stationId ? state.draft[id] : state.draft[id] || decisionFor(id)?.choices
      if (value && stationById(id).decisions.every((decision) => value[decision.id])) chosen[id] = { ...value }
    }
    const assumed = STATION_IDS.filter((id) => !chosen[id])
    const out = { ...chosen }
    const gpu = out.cfd?.gpu || "h200"
    if (!out.cfd) out.cfd = { gpu: "h200", size: "medium", fabric: "infiniband" }
    if (!out.oems) out.oems = { design: (stationById("oems").decisions[0].tiles.find((tile) => tile.fits.includes(gpu)) || {}).id || "air-node" }
    if (!out.connectivity) out.connectivity = { product: "fabric" }
    if (!out.dcpower) {
      const design = tileOf("oems", "design", out.oems.design)
      out.dcpower = { metro: "lon", cooling: design?.cooling === "liquid" ? "liquid" : "air", power: "block-0" }
      for (const power of ["block-0", "block-1", "block-2"]) {
        out.dcpower.power = power
        if (evaluateWorkshop(out).power.shortKW === 0) break
      }
    }
    const choices = completeChoices(out)
    choices.assumed = assumed
    return choices
  }

  function pickTile(stationId, decisionId, tileId) {
    const decision = decisionFor(stationId)
    if (decision && (decision.locked || decision.status === "pitched")) return
    state.draft[stationId] = { ...(state.draft[stationId] || {}), [decisionId]: tileId }
    render()
    if (!draftComplete(stationId)) return
    clearTimeout(state.saveTimer)
    state.saveTimer = setTimeout(() => saveDecision(stationId), 350)
  }

  async function saveDecision(stationId) {
    try {
      const reply = await api.put(`/api/team/${state.teamId}/decision/${stationId}`, { choices: state.draft[stationId] })
      state.decisions[stationId] = reply.decision
      render()
    } catch (error) {
      toast(error.message, "bad")
      await refresh()
    }
  }

  async function pitch(stationId, text) {
    try {
      const reply = await api.post(`/api/team/${state.teamId}/pitch/${stationId}`, { pitch: text })
      state.decisions[stationId] = reply.decision
      state.sheet = { kind: "host", stationId, mode: "judge" }
      render()
    } catch (error) {
      toast(error.message, "bad")
    }
  }

  async function judge(stationId, { hostCode, verdict, note }) {
    try {
      const reply = await api.post(`/api/team/${state.teamId}/approve/${stationId}`, { hostCode, verdict, note })
      state.decisions[stationId] = reply.decision
      state.sheet = null
      if (verdict === "approved") toast(`${stationById(stationId).name} approved by your architect.`, "ok")
      else if (verdict === "sent_back") toast(`Sent back: ${note}. Change your tiles and pitch again.`, "warn")
      else {
        state.draft[stationId] = { ...reply.decision.choices }
        toast(`${stationById(stationId).name} re-opened.`, "")
      }
      await refresh()
    } catch (error) {
      toast(error.message, "bad")
      state.sheet?.node?.resetKeypad?.()
    }
  }

  async function submitBuild() {
    try {
      await api.post(`/api/team/${state.teamId}/submit`)
      toast("Build submitted. Your score comes with the read-out.", "ok")
      await refresh()
    } catch (error) {
      toast(error.message, "bad")
      await refresh()
    }
  }

  /* ---------- rendering ---------- */

  function render() {
    const nodes = []
    if (state.screen !== "join") nodes.push(topBar())
    if (state.screen === "join") nodes.push(joinScreen())
    else if (state.screen === "home") nodes.push(homeScreen())
    else if (state.screen === "station") nodes.push(stationScreen())
    else if (state.screen === "readout") nodes.push(readoutScreen())
    if (state.sheet) nodes.push(sheet())
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
    const session = state.session
    const timer = session?.timer
    const t = timer ? clientTimer(timer, Date.now(), api.offsetMs) : { clock: "--:--", over: false }
    return el(
      "div.clock",
      {},
      el("div.time", { className: `time${t.over ? " over" : ""}` }, t.clock),
      el("div.phase", {}, timer ? [el("b", {}, timer.label), ` · ${timer.caption}`] : "connecting…"),
    )
  }

  function topBar() {
    const team = state.team
    return el(
      "header.top",
      {},
      el("div.who", {}, el("b", {}, team ? `TABLE ${team.number} · ${team.name}` : "TOKEN QUEST"), el("span", {}, team?.hostName ? `Architect: ${team.hostName} · session ${state.code}` : `session ${state.code}`)),
      clockNode(),
      el(
        "div.actions",
        {},
        state.screen !== "home" ? el("button.btn.ghost.tiny", { type: "button", onclick: () => ((state.screen = "home"), (state.sheet = null), render()) }, "HOME") : null,
        state.readout && state.screen !== "readout" ? el("button.btn.yellow.tiny", { type: "button", onclick: () => ((state.screen = "readout"), render()) }, "READ-OUT") : null,
        el(
          "button.btn.ghost.tiny",
          {
            type: "button",
            onclick: () => {
              if (globalThis.confirm?.("Leave this table on this iPad? Your team's decisions stay on the server.") !== false) leave("")
            },
          },
          "LEAVE",
        ),
      ),
    )
  }

  function joinScreen() {
    const saved = store.load()
    const code = state.code || saved?.code || ""
    const fields = { code, teamName: saved?.teamName || "", hostName: "" }
    const codeInput = el("input.code", { id: "code", name: "code", value: code, maxlength: 6, autocapitalize: "characters", autocomplete: "off", spellcheck: false, placeholder: "ABCD", oninput: (e) => (fields.code = e.target.value) })
    const teamInput = el("input", { id: "teamName", name: "teamName", value: fields.teamName, maxlength: 40, autocomplete: "off", placeholder: "e.g. Downforce Dynamos", oninput: (e) => (fields.teamName = e.target.value) })
    const hostInput = el("input", { id: "hostName", name: "hostName", maxlength: 40, autocomplete: "off", placeholder: "The architect leading this table", oninput: (e) => (fields.hostName = e.target.value) })
    const tableButtons = Array.from({ length: 10 }, (_, i) => i + 1).map((n) =>
      el("button", { type: "button", "aria-pressed": String(state.joinNumber === n), onclick: () => ((state.joinNumber = n), render()) }, String(n)),
    )
    const submit = (event) => {
      event?.preventDefault()
      const number = state.joinNumber
      if (!fields.code || fields.code.replace(/[^A-Za-z0-9]/g, "").length < 4) return showError("Type the 4-letter session code from the screen.")
      if (!number) return showError("Tap your table number.")
      if (!fields.teamName.trim()) return showError("Give your team a name.")
      if (!fields.hostName.trim()) return showError("Who is the architect at your table?")
      return join({ code: fields.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase(), number, teamName: fields.teamName.trim(), hostName: fields.hostName.trim() })
    }
    const showError = (message) => {
      state.error = message
      render()
    }
    return el(
      "section.screen.join",
      {},
      el(
        "form.panel",
        { onsubmit: submit, autocomplete: "off" },
        el("h1", {}, "TOKEN QUEST ", el("span", {}, "WORKSHOP")),
        el("p.dim.small", { style: { textAlign: "center" } }, `Design a CFD supercomputer for ${SCENARIO.team}. One table, one architect, four stations, 50 minutes.`),
        el("div.fields", {}, el("div.field", {}, el("label", { for: "code" }, "SESSION CODE"), codeInput), el("div.field", {}, el("label", { for: "teamName" }, "TEAM NAME"), teamInput)),
        el("div.field", {}, el("label", {}, "TABLE NUMBER"), el("div.tables", {}, tableButtons)),
        el("div.field", {}, el("label", { for: "hostName" }, "YOUR ARCHITECT (TABLE HOST)"), hostInput),
        state.error ? el("p.error", { role: "alert" }, state.error) : null,
        el("button.btn.go.big.wide", { type: "submit", disabled: state.busy }, state.busy ? "JOINING…" : "JOIN THE TABLE"),
      ),
    )
  }

  function choiceSummary(stationId) {
    const choices = state.draft[stationId] || decisionFor(stationId)?.choices
    if (!choices) return ""
    const station = stationById(stationId)
    const metro = (state.draft.dcpower || decisionFor("dcpower")?.choices)?.metro || "lon"
    return station.decisions
      .map((decision) => {
        const tile = tileOf(stationId, decision.id, choices[decision.id])
        if (!tile) return null
        return decision.id === "power" ? powerTileTitle(metro, tile.id) : tile.title
      })
      .filter(Boolean)
      .join(" · ")
  }

  function homeScreen() {
    const session = state.session
    const phase = session?.phase
    const tiles = STATIONS.map((station, index) => {
      const decision = decisionFor(station.id)
      const status = decision?.status || "not started"
      const kind = { approved: "approved", "sent back": "back", pitched: "pitched" }[status] || ""
      return el(
        "button.station-tile",
        { type: "button", className: `station-tile ${kind}`.trim(), onclick: () => ((state.stationId = station.id), (state.screen = "station"), render()), "data-station": station.id },
        el("div.head", {}, el("span.num", {}, `STATION ${index + 1}`), statusChip(status)),
        el("div.name", {}, station.name),
        el("p.why", {}, station.why),
        el("p.choice", {}, choiceSummary(station.id) || "Tap to decide"),
      )
    })
    const approvedCount = state.team?.approved || 0
    let footer
    if (phase === "readout" || phase === "done") footer = state.readout ? el("button.btn.yellow.big", { type: "button", onclick: () => ((state.screen = "readout"), render()) }, "SEE YOUR READ-OUT") : el("p.note", {}, "The read-out is being prepared…")
    else if (state.team?.submitted) footer = el("p.note.lime", {}, "BUILD SUBMITTED ✓ Your score comes with the read-out. Your architect can still re-open a station.")
    else footer = el("button.btn.go.big", { type: "button", disabled: !state.canSubmit, onclick: submitBuild }, "SUBMIT BUILD")
    return el(
      "section.screen.home",
      {},
      el(
        "aside.panel.scenario",
        {},
        el("h2", {}, `${SCENARIO.team} `, el("small", {}, "(fictional team)")),
        el("div.brief", {}, SCENARIO.brief.map((line) => el("p", {}, line))),
        el(
          "div.targets",
          {},
          el("div.target", {}, el("b", {}, `${SCENARIO.parRuns} runs a night`), el("span", {}, "overnight CFD runs, par")),
          el("div.target", {}, el("b", {}, `${formatMoney(SCENARIO.budget)} budget`), el("span", {}, "capex, all in")),
          el("div.target", {}, el("b", {}, `${SCENARIO.goLiveWeeks} weeks`), el("span", {}, "to go-live")),
          el("div.target", {}, el("b", {}, `${SCENARIO.vizTargetMs} ms · ${SCENARIO.ingestTargetH} h`), el("span", {}, "3D view frame · night's data home")),
        ),
      ),
      el("div.stations", {}, tiles),
      el("div.footer", {}, el("p.note", {}, `${approvedCount} of 4 stations approved${state.team?.sendBacks ? ` · ${state.team.sendBacks} send-back${state.team.sendBacks === 1 ? "" : "s"}` : ""}. Pitch each station to your architect; SUBMIT when all four are approved.`), footer),
    )
  }

  function stationScreen() {
    const station = stationById(state.stationId)
    const decision = decisionFor(station.id)
    const status = decision?.status || "not started"
    const locked = Boolean(decision?.locked) || status === "pitched"
    const draft = state.draft[station.id] || {}
    const metro = (state.draft.dcpower || decisionFor("dcpower")?.choices)?.metro || "lon"
    const complete = draftComplete(station.id)
    const choices = complete ? currentChoices(station.id) : null
    const result = choices ? evaluateWorkshop(choices) : null
    const assumedNote = choices?.assumed?.length ? ` (${choices.assumed.map((id) => stationById(id).short).join(", ")} not decided yet: assumed to fit)` : ""
    const released = state.session?.phase === "readout" || state.session?.phase === "done"

    const rows = station.decisions.map((row) =>
      el(
        "div.decision",
        {},
        el("div.label", {}, row.name.toUpperCase()),
        el(
          "div.tiles",
          {},
          row.tiles.map((tile) => {
            const title = row.id === "power" ? `${powerTileTitle(metro, tile.id)} · ${tile.title}` : tile.title
            const on = draft[row.id] === tile.id
            return el(
              "div.tile",
              { className: `tile${on ? " on" : ""}`, "data-tile": `${row.id}:${tile.id}` },
              el(
                "button.pick",
                { type: "button", "aria-pressed": String(on), disabled: locked || released, onclick: () => pickTile(station.id, row.id, tile.id) },
                el("span.t", {}, title),
                el("span.l", {}, tile.line),
                row.id === "metro" ? el("span.facts", {}, metroFacts(tile.id)) : null,
              ),
              el("button.learn", { type: "button", "aria-label": `About ${tile.title}`, onclick: () => openLearn(station.id, row.id, tile.id, metro) }, "?"),
            )
          }),
        ),
      ),
    )

    const live = el("div.live", {}, el("b", {}, "WHAT THIS DOES"), el("span.grow", {}, result ? [stationLine(station.id, result), assumedNote ? el("span.dim", {}, assumedNote) : null] : "Pick one tile in each row to see what it does."))

    const statusBits = [statusChip(status)]
    if (status === "sent back" && decision?.hostNote) statusBits.push(el("span.red", {}, `Reason: ${decision.hostNote}. Change your tiles, then pitch again.`))
    else if (status === "pitched") statusBits.push(el("span", {}, "Hand the iPad to your architect."))
    else if (status === "approved") statusBits.push(el("span.lime", {}, "Locked. Your architect can re-open it."))
    else if (!complete) statusBits.push(el("span", {}, "Choose a tile in every row."))
    else statusBits.push(el("span", {}, "Saved. Pitch it when the table agrees."))

    const buttons = []
    if (released) buttons.push(el("span.dim.small", {}, "The build phase is over."))
    else if (status === "approved") buttons.push(el("button.btn.ghost", { type: "button", onclick: () => openHost(station.id, "reopen") }, "ARCHITECT: RE-OPEN"))
    else if (status === "pitched") buttons.push(el("button.btn.yellow.big", { type: "button", onclick: () => openHost(station.id, "judge") }, "ARCHITECT: APPROVE / SEND BACK"))
    else buttons.push(el("button.btn.go.big", { type: "button", disabled: !complete || !decision, onclick: () => openPitch(station.id) }, "PITCH TO YOUR ARCHITECT"))

    return el(
      "section.screen.station",
      { "data-station": station.id },
      el("div.row.spread", {}, el("h2.yellow", {}, `${station.name}`), el("p.why.grow", {}, station.why)),
      el("div.decisions", {}, rows),
      live,
      el("div.actions", {}, el("div.status", {}, statusBits), el("div.row", {}, buttons)),
    )
  }

  function readoutScreen() {
    const r = state.readout
    if (!r) {
      return el("section.screen.waiting", {}, el("p.big", {}, "READ-OUT"), el("p", {}, "Your read-out appears here when the facilitator starts the read-out phase."))
    }
    const rankText = r.rank ? `RANK ${r.rank} OF ${r.teams}` : "SCORED"
    return el(
      "section.screen.readout",
      {},
      el(
        "div.panel.hero",
        {},
        el("div.score", {}, String(r.score)),
        el("div", {}, el("div.rank", {}, `${state.team?.name || "YOUR TEAM"} · ${rankText}`), el("p.summary", {}, r.summary || "")),
        el("div.row.no-print", {}, el("button.btn.ghost.tiny", { type: "button", onclick: () => globalThis.print?.() }, "PRINT")),
      ),
      el("div.panel.col.well", {}, el("h2", {}, "WHAT WENT WELL"), el("ul", {}, r.wentWell.map((line) => el("li", {}, line)))),
      el("div.panel.col.diff", {}, el("h2", {}, "WHAT YOU COULD HAVE DONE DIFFERENTLY"), el("ul", {}, r.doDifferently.map((line) => el("li", {}, line)))),
      el("div.panel.col.notes", {}, el("h2", {}, "YOUR ARCHITECT'S NOTES"), r.architectNotes.length ? el("ul", {}, r.architectNotes.map((line) => el("li", {}, line))) : el("p.dim.small", {}, "No send-backs: every pitch was approved first time.")),
      el("div.panel.closing", {}, el("p", {}, r.closing)),
    )
  }

  /* ---------- sheets ---------- */

  function openLearn(stationId, decisionId, tileId, metro) {
    const tile = tileOf(stationId, decisionId, tileId)
    state.sheet = { kind: "learn", title: decisionId === "power" ? `${powerTileTitle(metro, tileId)} · ${tile.title}` : tile.title, text: tileLearn(stationId, decisionId, tileId, metro) }
    render()
  }

  function openPitch(stationId) {
    state.sheet = { kind: "pitch", stationId, text: decisionFor(stationId)?.pitch || "" }
    render()
  }

  function openHost(stationId, mode) {
    state.sheet = { kind: "host", stationId, mode }
    render()
  }

  function closeSheet() {
    state.sheet = null
    render()
  }

  function sheet() {
    const s = state.sheet
    let body
    if (s.kind === "learn") {
      body = el("div.panel.sheet", { role: "dialog", "aria-modal": "true" }, el("h2", {}, s.title), el("p.text", {}, s.text), el("div.row", { style: { justifyContent: "flex-end" } }, el("button.btn.ghost", { type: "button", onclick: closeSheet }, "CLOSE")))
    } else if (s.kind === "pitch") {
      const station = stationById(s.stationId)
      const area = el("textarea", { id: "pitch", maxlength: 280, placeholder: `One sentence: why is this the right ${station.name} call for ${SCENARIO.team}?`, oninput: (e) => (s.text = e.target.value) }, s.text)
      body = el(
        "form.panel.sheet",
        {
          role: "dialog",
          "aria-modal": "true",
          onsubmit: (e) => {
            e.preventDefault()
            if (s.text.trim().length < 3) return toast("Write one sentence first.", "warn")
            return pitch(s.stationId, s.text.trim())
          },
        },
        el("h2", {}, `PITCH · ${station.name}`),
        el("p.hint", {}, `Your build so far: ${choiceSummary(s.stationId)}. Say why, in one sentence, then hand the iPad to your architect.`),
        el("div.field", {}, el("label", { for: "pitch" }, "YOUR PITCH"), area),
        el("div.row", { style: { justifyContent: "flex-end" } }, el("button.btn.ghost", { type: "button", onclick: closeSheet }, "BACK"), el("button.btn.go.big", { type: "submit" }, "PITCH IT")),
      )
      setTimeout(() => area.focus(), 0)
    } else {
      const station = stationById(s.stationId)
      const decision = decisionFor(s.stationId)
      let code = ""
      let reason = ""
      const approve = el("button.btn.go.big.wide", { type: "button", disabled: true, onclick: () => judge(s.stationId, { hostCode: code, verdict: "approved" }) }, "APPROVE")
      const sendBack = el("button.btn.big.wide", { type: "button", disabled: true, onclick: () => judge(s.stationId, { hostCode: code, verdict: "sent_back", note: reason }) }, "SEND BACK")
      const reopen = el("button.btn.yellow.big.wide", { type: "button", disabled: true, onclick: () => judge(s.stationId, { hostCode: code, verdict: "reopen" }) }, "RE-OPEN THIS STATION")
      const sync = () => {
        const ready = code.length === 4
        approve.disabled = !ready
        sendBack.disabled = !ready || !reason
        reopen.disabled = !ready
      }
      const pad = keypad({ length: 4, onchange: (value) => ((code = value), sync()) })
      const reasons = el(
        "div.reasons",
        {},
        SEND_BACK_REASONS.map((label) =>
          el(
            "button.reason",
            {
              type: "button",
              "aria-pressed": "false",
              onclick: (e) => {
                reason = reason === label ? "" : label
                for (const node of e.currentTarget.parentNode.children) node.setAttribute("aria-pressed", String(node.textContent.toLowerCase() === reason))
                sync()
              },
            },
            label,
          ),
        ),
      )
      const judging = s.mode === "judge"
      body = el(
        "div.panel.sheet.host",
        { role: "dialog", "aria-modal": "true" },
        el("h2", {}, judging ? `ARCHITECT APPROVAL · ${station.name}` : `RE-OPEN · ${station.name}`),
        el("p.hint", {}, judging ? "Architect: hear the pitch, then type your 4-digit host code and decide. SEND BACK needs a reason." : "Architect: type your host code to unlock this station so the team can change it."),
        judging ? el("blockquote.pitch-quote", {}, `“${decision?.pitch || "…"}”`, el("br"), el("span.dim", {}, `Build: ${choiceSummary(s.stationId)}`)) : el("div.pitch-quote", {}, `Approved build: ${choiceSummary(s.stationId)}`),
        pad,
        judging ? el("div.verdicts", {}, approve, sendBack) : el("div.verdicts", {}, reopen),
        judging ? reasons : null,
        el("div.row", { style: { justifyContent: "flex-end" } }, el("button.btn.ghost", { type: "button", onclick: closeSheet }, "CANCEL")),
      )
      body.resetKeypad = () => pad.reset()
      s.node = body
    }
    return el("div.sheet-back", { onclick: (e) => e.target === e.currentTarget && s.kind === "learn" && closeSheet() }, body)
  }

  /* ---------- boot ---------- */

  async function boot() {
    const saved = store.load()
    state.code = codeFromLocation(location) || saved?.code || ""
    if (saved?.token && saved?.teamId && (!codeFromLocation(location) || codeFromLocation(location) === saved.code)) {
      state.teamId = saved.teamId
      state.token = saved.token
      state.code = saved.code
      api.setTeamToken(saved.token)
      state.screen = "home"
      await refresh({ render: false })
      if (state.teamId) schedulePoll()
    }
    render()
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.teamId) refresh()
    })
  }

  return { boot, refresh, state, render, join, leave }
}

if (typeof document !== "undefined" && document.getElementById("app")) {
  const app = createApp()
  globalThis.__tqWorkshop = app
  app.boot()
}
