import { HALLS, PLATFORMS, SITES, USE_CASES, byId } from "./data.js"
import { explainResult } from "./explain.js"
import { plainCoach } from "./coach.js"
import { createFloor } from "./floor.js"
import { SCENES, createAdvanceGate, createIntro, sceneCaption, setIntroDetail } from "./intro.js"
import { leagueCsv, leagueJson, ordinal, rankOf, sortLeague, upsertEntry } from "./league.js"
import { evaluateBuild, formatMoney, formatScore, formatTokens, stars } from "./model.js"
import { blockedReason, peopleCount, peopleLead, savingsLine } from "./results.js"
import { attemptPayload, syncStatusLine } from "./attempt.js"
import { validateEmail, validateName } from "./names.js"
import { fetchLeague, recordAttempt } from "./sync.js"
import { isMuted, loadMute, play, setMuted, unlock } from "./sound.js"
import { spriteImg } from "./sprites.js"
import { STORIES, brainPick, choicesToBuild, cityChoices, citySites, defaultChoices } from "./presets.js"

const LEAGUE_KEY = "token-quest-league-v1"
const STAFF_PIN = "2510"
const IDLE_MS = 180000
const RUN_MS = 4600
const FIRST_SCENARIO = "chat"

const state = {
  screen: "title",
  name: "",
  email: "",
  consentAt: "",
  nerd: false,
  plan: freshPlan(FIRST_SCENARIO),
  league: loadLeague(),
  serverLeague: null,
  serverUp: null,
  lessons: new Set(),
  tip: null,
  intro: null,
  floor: null,
  runRaf: 0,
  running: false,
  result: null,
  syncLine: "",
  staffUnlocked: false,
  staffPin: "",
  clearArmed: false,
  resetArmed: false,
  pinError: "",
  logoClicks: 0,
}

let idleTimer = 0
let idleWarn = 0
let idleTick = 0
let logoTimer = 0

const stage = document.getElementById("stage")
const hud = document.getElementById("hud")

function freshPlan(useCaseId) {
  const choices = defaultChoices(useCaseId)
  return { useCase: useCaseId, choices, build: choicesToBuild(useCaseId, choices) }
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === "class") node.className = value
    else if (key === "text") node.textContent = value
    else if (key === "style") node.setAttribute("style", value)
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value)
    } else node.setAttribute(key, value === true ? "" : String(value))
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

function loadLeague() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEAGUE_KEY) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry) => entry && typeof entry.name === "string" && Number.isFinite(entry.score))
  } catch {
    return []
  }
}

function saveLeague() {
  try {
    localStorage.setItem(LEAGUE_KEY, JSON.stringify(state.league))
  } catch {
    /* The in-memory board still works if storage is blocked. */
  }
}

function btn(label, onclick, { kind = "", disabled = false, key = null, sound = "select", aria = null, pressed = null, title = null } = {}) {
  return el(
    "button",
    {
      type: "button",
      class: `btn ${kind}`.trim(),
      disabled,
      title,
      "data-key": key,
      "aria-label": aria,
      "aria-pressed": pressed == null ? null : pressed ? "true" : "false",
      onclick: (event) => {
        onclick(event)
        if (sound) play(sound)
      },
    },
    label,
  )
}

const useCase = () => byId(USE_CASES, state.plan.useCase)
const live = () => evaluateBuild(state.plan.useCase, state.plan.build)
const storyIds = () => USE_CASES.map((item) => item.id)

/* ---------- Screen routing ---------- */

let unbindIntro = () => {}
let introGate = createAdvanceGate()
let refreshIntro = () => {}

function paintNerd() {
  const bar = document.getElementById("nerd-bar")
  if (!bar) return
  bar.textContent = state.nerd ? "NERD ON" : "NERD MODE"
  bar.setAttribute("aria-pressed", state.nerd ? "true" : "false")
}

/** One nerd switch for every screen. The intro keeps its place; other screens redraw. */
function toggleNerd() {
  state.nerd = !state.nerd
  paintNerd()
  setIntroDetail(state.nerd)
  if (state.screen === "intro") {
    refreshIntro()
    return
  }
  if (state.screen === "title") {
    const slot = document.getElementById("league-slot")
    if (slot) slot.replaceChildren(leagueTable(null, 5))
    return
  }
  render()
  const result = document.getElementById("result")
  if (result && !result.hidden && state.result) showResult()
}

function goto(screen) {
  unbindIntro()
  stopRun()
  state.intro?.stop()
  state.intro = null
  state.floor = null
  state.screen = screen
  render()
  stage.scrollTop = 0
  if (screen === "title") refreshServerLeague()
  poke()
}

function render() {
  const focusKey = document.activeElement?.getAttribute?.("data-key")
  const screens = { title: titleScreen, intro: introScreen, game: gameScreen }
  stage.replaceChildren(screens[state.screen]())
  renderHud()
  stage.scrollTop = 0
  if (focusKey) stage.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus()
}

function renderHud() {
  const top = sortLeague(state.league)[0]
  const result = state.screen === "game" ? live() : null
  hud.replaceChildren(
    el("span", { class: "hud-item" }, [el("b", { text: "1UP " }), state.name ? state.name.toUpperCase() : "----"]),
    el("span", { class: "hud-item" }, [el("b", { text: "SCORE " }), result?.ok ? formatScore(result.score) : "0"]),
    el("span", { class: "hud-item" }, [el("b", { text: "HI " }), top ? formatScore(top.score) : "0"]),
  )
}

function resetRun() {
  state.name = ""
  state.email = ""
  state.consentAt = ""
  state.nerd = false
  paintNerd()
  state.plan = freshPlan(FIRST_SCENARIO)
  state.syncLine = ""
  state.lessons = new Set()
  state.tip = null
  state.result = null
  closeDialog("result")
  goto("title")
}

/* ---------- Title ---------- */


const CONSENT_BODY = "By sharing your information, you agree that Digital Realty may use your personal data to contact you, in accordance with Digital Realty's Privacy Practices. You may unsubscribe from communications at any time by using the unsubscribe link included in our messages."
const CONSENT_MORE = "For more information, see our Privacy Practices:"
const PRIVACY_URL = "https://www.digitalrealty.com/about/legal/privacy"

function titleScreen() {
  const nameError = el("p", { id: "name-error", class: "form-error", role: "alert" })
  const emailError = el("p", { id: "email-error", class: "form-error", role: "alert" })
  const consentError = el("p", { id: "consent-error", class: "form-error", role: "alert" })
  const input = el("input", {
    id: "player-name",
    name: "name",
    autocomplete: "name",
    autocapitalize: "words",
    maxlength: "40",
    placeholder: "ADA LOVELACE",
    spellcheck: "false",
    "aria-describedby": "name-error",
  })
  const email = el("input", {
    id: "player-email",
    name: "email",
    type: "email",
    autocomplete: "email",
    inputmode: "email",
    maxlength: "254",
    placeholder: "ENTER YOUR EMAIL",
    spellcheck: "false",
    "aria-describedby": "email-error",
  })
  const consent = el("input", {
    id: "player-consent",
    name: "consent",
    type: "checkbox",
    "aria-describedby": "consent-error",
  })
  const startBtn = el("button", { class: "btn big", type: "submit", id: "start-btn", disabled: true, text: "START" })
  const refreshStart = () => {
    const nameOk = validateName(input.value).ok
    const emailOk = validateEmail(email.value).ok
    if (nameOk) nameError.textContent = ""
    if (emailOk) emailError.textContent = ""
    if (consent.checked) consentError.textContent = ""
    startBtn.disabled = !(nameOk && emailOk && consent.checked)
  }
  input.addEventListener("input", refreshStart)
  email.addEventListener("input", refreshStart)
  consent.addEventListener("change", () => {
    state.consentAt = consent.checked ? new Date().toISOString() : ""
    refreshStart()
  })
  const form = el("form", { id: "enter-form", class: "enter" }, [
    el("label", { for: "player-name", class: "blink-label", text: "ENTER YOUR FULL NAME" }),
    input,
    nameError,
    el("label", { for: "player-email", text: "ENTER YOUR EMAIL" }),
    email,
    emailError,
    el("div", { class: "consent" }, [
      consent,
      el("label", { for: "player-consent", class: "consent-copy" }, [
        CONSENT_BODY,
        el("br"),
        el("br"),
        `${CONSENT_MORE} `,
        el("a", { href: PRIVACY_URL, target: "_blank", rel: "noopener noreferrer", text: PRIVACY_URL }),
      ]),
    ]),
    consentError,
    startBtn,
  ])
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    const nameCheck = validateName(input.value)
    const emailCheck = validateEmail(email.value)
    nameError.textContent = nameCheck.ok ? "" : nameCheck.error
    emailError.textContent = emailCheck.ok ? "" : emailCheck.error
    consentError.textContent = consent.checked ? "" : "Check the box to continue."
    input.setAttribute("aria-invalid", nameCheck.ok ? "false" : "true")
    email.setAttribute("aria-invalid", emailCheck.ok ? "false" : "true")
    consent.setAttribute("aria-invalid", consent.checked ? "false" : "true")
    refreshStart()
    if (!nameCheck.ok || !emailCheck.ok || !consent.checked) {
      play("error")
      if (!nameCheck.ok) input.focus()
      else if (!emailCheck.ok) email.focus()
      else consent.focus()
      return
    }
    unlock()
    play("start")
    state.name = nameCheck.name
    state.email = emailCheck.email
    if (!state.consentAt) state.consentAt = new Date().toISOString()
    state.plan = freshPlan(FIRST_SCENARIO)
    state.lessons = new Set()
    goto("intro")
  })
  requestAnimationFrame(() => input.focus())

  return el("section", { class: "title-screen" }, [
    el("div", { class: "title-hero" }, [
      el("div", { class: "logo-art" }, [spriteImg("hero", 5), spriteImg("token", 5), spriteImg("prof", 5)]),
      el("h1", { class: "game-logo" }, [el("span", { text: "TOKEN" }), el("span", { text: "QUEST" })]),
      el("p", { class: "subtitle", text: "A DIGITAL REALTY GAME" }),
      el("p", {
        class: "pitch",
        text: "Build the best factory you can afford. Beat the high score!",
      }),
      el("div", { class: "panel scores" }, [
        el("h2", { text: "HIGH SCORES" }),
        el("div", { id: "league-slot" }, [leagueTable(null, 5)]),
        el("div", { class: "prize" }, [spriteImg("trophy", 3), el("span", { text: "TOP SCORE WINS THE PRIZE" })]),
      ]),
    ]),
    el("div", { class: "panel title-form" }, [form]),
  ])
}

function leagueRows(limit) {
  if (Array.isArray(state.serverLeague)) {
    return state.serverLeague.slice(0, limit).map((entry) => ({
      name: entry.name,
      score: entry.best,
      rank: entry.rank,
      attempts: entry.attempts,
      label: entry.bestUseCase || "",
    }))
  }
  return sortLeague(state.league).slice(0, limit).map(({ name, score, useCase: id, fteEquivalent }, index) => ({
    name,
    score,
    rank: index + 1,
    attempts: null,
    label: byId(USE_CASES, id)?.npc?.toUpperCase() || "",
    fte: fteEquivalent,
  }))
}

function refreshServerLeague() {
  fetchLeague().then((players) => {
    state.serverLeague = players
    const slot = document.getElementById("league-slot")
    if (!slot || state.screen !== "title") return
    slot.replaceChildren(leagueTable(null, 5))
  }).catch(() => {})
}

function leagueTable(highlight, limit) {
  const rows = leagueRows(limit)
  if (!rows.length) return el("p", { class: "empty", text: "NO SCORES YET. BE THE FIRST!" })
  const mine = highlight?.toLocaleLowerCase()
  const table = el("ol", { class: "league" }, rows.map((entry) =>
    el("li", { class: mine && entry.name.toLocaleLowerCase() === mine ? "mine" : "" }, [
      el("span", { class: "rank", text: ordinal(entry.rank) }),
      el("span", { class: "lname", text: `${entry.name.toUpperCase()}${entry.attempts ? ` ×${entry.attempts}` : ""}` }),
      el("span", { class: "lcase", text: entry.label }),
      el("span", { class: "lscore", text: formatScore(entry.score) }),
      state.nerd && entry.fte ? el("span", { class: "fine", text: `${peopleCount(entry.fte)} people` }) : null,
    ]),
  ))
  const rank = highlight ? rankOf(state.league, highlight) : null
  if (!rank || rank <= limit) return table
  const entry = state.league.find((item) => item.name.toLocaleLowerCase() === mine)
  return el("div", {}, [table, el("p", { class: "fine", text: `YOU: ${ordinal(rank)} · ${formatScore(entry.score)}` })])
}

/* ---------- Intro ---------- */

function advanceIntro(event) {
  if (state.screen !== "intro" || !state.intro) return
  if (!introGate.allow(event?.timeStamp)) return
  if (state.intro.current() === SCENES[SCENES.length - 1].id) {
    play("blip")
    goto("game")
    return
  }
  state.intro.next()
}

function introControl(event) {
  return event.target?.closest?.("[data-key]")?.dataset?.key || ""
}

function showIntroCaption(scene, capTitle, capText, capTag, caption) {
  capTitle.textContent = scene.title
  capText.textContent = sceneCaption(scene, state.nerd)
  capTag.hidden = !state.nerd
  caption.classList.toggle("deep", state.nerd)
  setIntroDetail(state.nerd)
}

function introScreen() {
  unbindIntro()
  introGate = createAdvanceGate()
  const canvas = el("canvas", { class: "intro-canvas", "aria-hidden": "true" })
  const capTitle = el("b", { text: SCENES[0].title })
  const capTag = el("span", { class: "nerd-tag", text: "NERD", hidden: !state.nerd })
  const capText = el("p", { text: sceneCaption(SCENES[0], state.nerd) })
  const capLive = el("p", { class: "caption-live" })
  const caption = el("div", { class: `caption${state.nerd ? " deep" : ""}`, "aria-live": "polite" }, [capTitle, capTag, capText, capLive])
  setIntroDetail(state.nerd)
  const dots = el("div", { class: "scene-dots" }, SCENES.map((scene, index) =>
    el("button", {
      type: "button",
      class: "dot",
      "aria-label": `Scene ${index + 1}: ${scene.title}`,
      onclick: () => state.intro?.jump(index),
    }),
  ))
  const back = btn("◀ BACK", () => state.intro?.prev(), { kind: "ghost", key: "intro-back", sound: null, disabled: true })
  const cont = btn("CLICK TO CONTINUE", advanceIntro, { kind: "big", key: "intro-continue", sound: null })
  refreshIntro = () => {
    const scene = SCENES.find((item) => item.id === state.intro?.current()) || SCENES[0]
    showIntroCaption(scene, capTitle, capText, capTag, caption)
    const toggle = document.querySelector('[data-key="nerd-toggle"]')
    if (toggle) {
      toggle.textContent = state.nerd ? "NERD ON" : "NERD MODE"
      toggle.setAttribute("aria-pressed", state.nerd ? "true" : "false")
    }
  }
  const wrapEl = el("section", { class: "intro" }, [
    el("div", { class: "crt" }, [canvas]),
    caption,
    dots,
    el("div", { class: "row" }, [
      back,
      btn(state.nerd ? "NERD ON" : "NERD MODE", toggleNerd, { kind: "ghost", key: "nerd-toggle", pressed: state.nerd, sound: "blip" }),
      btn("SKIP ▶▶", () => goto("game"), { kind: "ghost", key: "intro-skip", sound: "back" }),
      cont,
    ]),
  ])
  const onKey = (event) => {
    if (state.screen !== "intro") return
    if (event.key !== "Enter" && event.key !== " ") return
    if (event.repeat) return
    const key = introControl(event)
    if (key || event.target?.closest?.("button, a, input, .scene-dots")) return
    event.preventDefault()
    advanceIntro(event)
  }
  const onPointer = (event) => {
    if (state.screen !== "intro") return
    if (event.target?.closest?.("button, a, input")) return
    advanceIntro(event)
  }
  document.addEventListener("keydown", onKey)
  document.addEventListener("pointerdown", onPointer)
  unbindIntro = () => {
    document.removeEventListener("keydown", onKey)
    document.removeEventListener("pointerdown", onPointer)
    unbindIntro = () => {}
  }
  requestAnimationFrame(() => {
    if (state.screen !== "intro") return
    const paint = () => {
      state.intro = createIntro(canvas, {
        onScene: (scene) => {
          introGate.shown()
          showIntroCaption(scene, capTitle, capText, capTag, caption)
          const index = SCENES.indexOf(scene)
          const last = index === SCENES.length - 1
          cont.textContent = last ? "START THE QUEST" : "CLICK TO CONTINUE"
          cont.setAttribute("aria-label", last ? "PRESS START" : "CLICK TO CONTINUE")
          back.disabled = index === 0
          dots.querySelectorAll(".dot").forEach((dot, i) => dot.setAttribute("aria-current", i === index ? "true" : "false"))
          if (scene.lesson) state.lessons.add(scene.lesson)
        },
        onBubble: (value) => {
          capLive.textContent = value || ""
        },
      })
      state.intro.start()
    }
    document.fonts.load("8px 'Press Start 2P'").then(paint, paint)
  })
  return wrapEl
}

/* ---------- The game screen ---------- */

function syncBuild() {
  state.plan.build = choicesToBuild(state.plan.useCase, state.plan.choices)
}

function pick(patch) {
  play("select")
  state.plan.choices = { ...state.plan.choices, ...patch }
  syncBuild()
  render()
}

function nextStory() {
  const ids = storyIds()
  const index = ids.indexOf(state.plan.useCase)
  state.plan = freshPlan(ids[(index + 1) % ids.length])
  render()
}

function crowdMood(result) {
  if (!result?.ok || result.overBudget || !result.slaMet || result.coverage < 0.5) return "sad"
  return "happy"
}

/** Count the people number up once the badge is on screen. */
function animatePeople(node, target) {
  const finalText = `= ${peopleCount(target)} people`
  node.textContent = finalText
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  if (reduced || !(target > 0)) return
  const start = performance.now()
  const duration = 450
  const tick = (now) => {
    if (!node.isConnected) return
    const t = Math.min(1, (now - start) / duration)
    const eased = 1 - (1 - t) ** 3
    node.textContent = `= ${peopleCount(target * eased)} people`
    if (t < 1) requestAnimationFrame(tick)
    else node.textContent = finalText
  }
  requestAnimationFrame(tick)
}

function hoursCount(hours) {
  const n = Math.max(0, Number(hours) || 0)
  if (n >= 1e9) return `about ${String(Math.round((n / 1e9) * 10) / 10).replace(/\.0$/, "")} billion`
  if (n >= 1e6) return `about ${String(Math.round((n / 1e6) * 10) / 10).replace(/\.0$/, "")} million`
  return `about ${Math.round(n).toLocaleString("en-GB")}`
}

function workerSprites(fte) {
  if (!(fte > 1)) return 1
  return Math.max(1, Math.min(8, Math.round(Math.log10(fte))))
}

function picture({ key, art, label, hint, on, product = "", nerd = "" }) {
  return el("button", {
    type: "button",
    class: `tile${on ? " on" : ""}`,
    "data-key": key,
    "aria-pressed": on ? "true" : "false",
  }, [
    el("span", { class: "tile-art" }, [spriteImg(art, 3)]),
    el("span", { class: "tile-title", text: label }),
    hint ? el("span", { class: "tile-hint", text: hint }) : null,
    product ? el("span", { class: "tile-product", text: product }) : null,
    state.nerd && nerd ? el("span", { class: "nerd", text: nerd }) : null,
  ])
}

function metroLine(useCaseId, cities) {
  return citySites(useCaseId, cities).map((id) => byId(SITES, id)?.metro).filter(Boolean).join(", ")
}

function choiceRow(id, title, hint, tiles) {
  return el("div", { class: "choice-row", "data-row": id }, [
    el("div", { class: "row-name" }, [
      el("b", { text: title }),
      el("span", { class: "fine", text: hint }),
    ]),
    el("div", { class: "tiles" }, tiles),
  ])
}

function nerdBrain(platform) {
  const spec = `${platform.rackKW} kW, ${platform.hbmTBs} TB/s`
  if (platform.id !== "vr") return spec
  return `${spec}. Announced as NVL144. 35 PF dense NVFP4 (50 PF sparse peak)`
}

function brainRow(choices) {
  const tiles = [
    ["small", "SMALL", "A little", "rackAir"],
    ["medium", "MEDIUM", "A fair bit", "rackAir"],
    ["big", "BIG", "A lot", "rackLiquid"],
    ["huge", "HUGE", "Too much", "rackRubin"],
  ].map(([id, label, hint, art]) => {
    const pick = brainPick(state.plan.useCase, id)
    const platform = byId(PLATFORMS, pick.platform)
    const selected = choices.brains === id
    return picture({
      key: `brains-${id}`,
      art,
      label,
      hint,
      on: selected,
      product: platform ? `${platform.name} ×${pick.racks}` : "",
      nerd: selected && platform ? nerdBrain(platform, pick.racks) : "",
    })
  })
  tiles.forEach((node, index) => {
    const id = ["small", "medium", "big", "huge"][index]
    node.addEventListener("click", () => pick({ brains: id }))
  })
  return choiceRow("brains", "BRAINS", "How big should the computers be?", tiles)
}

function memoryRow(uc, choices) {
  const tiles = [
    picture({ key: "memory-off", art: "token", label: "OFF", hint: "Starts fresh", on: !choices.memory, nerd: "No saved chats" }),
    picture({ key: "memory-on", art: "chest", label: "ON", hint: "Remembers", on: choices.memory, product: "KV cache tier", nerd: "Saves the chat so it is not read again" }),
  ]
  tiles[0].addEventListener("click", () => pick({ memory: false }))
  tiles[1].addEventListener("click", () => pick({ memory: true }))
  if (uc.orca) {
    const helper = picture({
      key: "helper",
      art: "orca",
      label: "LAB HELPER",
      hint: "Finds medicines",
      on: choices.helper,
      product: "ORCA PT-3",
      nerd: "Photonic boson sampling. London Innovation Lab, LHR19",
    })
    helper.addEventListener("click", () => pick({ helper: !choices.helper }))
    tiles.push(helper)
  }
  return choiceRow("memory", "MEMORY", "Remembers chats so it doesn't re-read them.", tiles)
}

function libraryRow(choices) {
  const products = { none: "", basic: "File & object", smart: "Vector index" }
  const tiles = [
    ["none", "NONE", "Nothing", "scroll"],
    ["basic", "BASIC", "A shelf", "vault"],
    ["smart", "SMART", "Fast find", "gem"],
  ].map(([id, label, hint, art]) => picture({
    key: `library-${id}`,
    art,
    label,
    hint,
    on: choices.library === id,
    product: products[id],
  }))
  tiles.forEach((node, index) => {
    const id = ["none", "basic", "smart"][index]
    node.addEventListener("click", () => pick({ library: id }))
  })
  return choiceRow("library", "LIBRARY", "Finds the right documents fast.", tiles)
}

function homeRow(choices) {
  const air = byId(HALLS, "A")
  const liquid = byId(HALLS, "B")
  const tiles = [
    picture({
      key: "home-cool",
      art: "fan",
      label: "AIR-COOLED HALL",
      hint: "Ready now. Hot computers slow down.",
      on: choices.home === "cool",
      nerd: `${air.maxRackKW} kW per rack. PUE ${air.pue}`,
    }),
    picture({
      key: "home-super",
      art: "rackLiquid",
      label: "LIQUID-COOLED HALL",
      hint: "Fits big computers. Weeks to prepare.",
      on: choices.home === "super",
      nerd: `${liquid.maxRackKW} kW per rack. PUE ${liquid.pue}`,
    }),
  ]
  tiles[0].addEventListener("click", () => pick({ home: "cool" }))
  tiles[1].addEventListener("click", () => pick({ home: "super" }))
  if (cityChoices(state.plan.useCase)) {
    for (const count of [1, 2, 3]) {
      const tile = picture({
        key: `city-${count}`,
        art: "user",
        label: String(count),
        hint: count === 1 ? "One city" : `${count} cities`,
        on: choices.cities === count,
        product: metroLine(state.plan.useCase, count),
      })
      tile.addEventListener("click", () => pick({ cities: count }))
      tiles.push(tile)
    }
  }
  const hint = cityChoices(state.plan.useCase) ? "Closer to people = faster." : "A colder hall holds bigger brains."
  return choiceRow("home", "HOME", hint, tiles)
}

function wireRow(choices) {
  const products = {
    cheap: "Public internet",
    fast: "ServiceFabric",
    private: "Cross connect + ServiceFabric + Dark fiber",
    mix: "ServiceFabric + MCP mix",
  }
  const tiles = [
    ["cheap", "CHEAP", "Slow road", "gremlin"],
    ["fast", "FAST", "Quick road", "token"],
    ["private", "PRIVATE", "Secret road", "chest"],
    ["mix", "MIX", "Best mix", "gem"],
  ].map(([id, label, hint, art]) => picture({
    key: `wires-${id}`,
    art,
    label,
    hint,
    on: choices.wires === id,
    product: products[id],
  }))
  tiles.forEach((node, index) => {
    const id = ["cheap", "fast", "private", "mix"][index]
    node.addEventListener("click", () => pick({ wires: id }))
  })
  return choiceRow("wires", "WIRES", "How the answers travel.", tiles)
}

function gauge(label, pct, text, { bad = false, key = null, art = null } = {}) {
  const clamped = Math.max(0, Math.min(1, pct || 0))
  return el("div", { class: `meter ${bad ? "bad" : "good"}`, "data-gauge": key }, [
    el("div", { class: "meter-top" }, [
      art ? spriteImg(art, 2) : null,
      el("span", { text: label }),
      el("span", { text }),
    ]),
    el("div", { class: "meter-bar", role: "meter", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(clamped * 100)) }, [
      el("i", { style: `width:${Math.round(clamped * 100)}%` }),
    ]),
  ])
}

function starRow(count, scale) {
  return el("span", { class: "stars", "aria-label": `${count} of 3 stars` }, [0, 1, 2].map((i) => spriteImg(i < count ? "star" : "starEmpty", scale)))
}

function peopleBadge(result) {
  const fte = result.fteEquivalent || 0
  const count = workerSprites(fte)
  const unaffordable = Boolean(result.overBudget)
  const badge = el("div", { class: `people-badge${unaffordable ? " off" : ""}`, "data-gauge": "people", "data-key": "people" }, [
    el("div", { class: "workers", "aria-hidden": "true" }, Array.from({ length: count }, () => spriteImg("user", 2))),
    el("div", { class: "people-copy" }, [
      el("span", { class: "fine" }, [
        "PEOPLE-POWER",
        unaffordable ? el("span", { class: "over-tag", "data-key": "over-tag", text: "OVER BUDGET" }) : null,
      ]),
      el("strong", { "data-key": "people-count", text: `= ${peopleCount(fte)} people` }),
    ]),
  ])
  const node = badge.querySelector("[data-key='people-count']")
  if (node) requestAnimationFrame(() => animatePeople(node, fte))
  return badge
}

function feel(result) {
  const spend = result.budgetSpend || 0
  const budget = result.budget || 1
  const late = result.lateWeeks > 0
  const powerPct = result.powerMW > 0 ? result.powerUsedMW / result.powerMW : 0
  const timePct = result.liveWeeks / Math.max(result.scenario?.deadlineWeeks || 1, result.liveWeeks, 1)
  const mood = crowdMood(result)
  const advice = plainCoach(result)
  const happy = mood === "happy" && !late && !result.overBudget && !result.overPower
  return el("aside", { class: "feel" }, [
    gauge("MONEY", spend / budget, state.nerd ? `${formatMoney(spend)} / ${formatMoney(budget)}` : (result.overBudget ? "TOO MUCH" : "OK"), { bad: result.overBudget, key: "budget", art: "token" }),
    gauge("POWER", powerPct, state.nerd ? `${result.powerUsedMW.toFixed(2)} MW` : (result.overPower ? "TOO MUCH" : "OK"), { bad: result.overPower, key: "power", art: "fan" }),
    gauge("TIME", Math.min(1, timePct), state.nerd ? `Week ${Math.ceil(result.liveWeeks)}` : (late ? "LATE" : "ON TIME"), { bad: late, key: "golive", art: "scroll" }),
    ...(state.nerd ? [
      gauge("SPEED", result.slaMet ? 1 : 0.3, Number.isFinite(result.ttft) ? `${result.ttft.toFixed(2)} s` : "—", { bad: !result.slaMet, key: "speed" }),
      gauge("CROWD", result.coverage, `${Math.round(result.coverage * 100)}% served`, { bad: result.coverage < 0.5, key: "demand" }),
      gauge("PRICE", Number.isFinite(result.costPerM) ? Math.min(1, (result.useCase?.parCost || 1) / result.costPerM) : 0, Number.isFinite(result.costPerM) ? formatMoney(result.costPerM) : "—", { bad: !(result.costPerM <= (result.useCase?.parCost || Infinity)), key: "cost" }),
    ] : []),
    peopleBadge(result),
    el("div", { class: `crowd ${mood}`, "data-mood": mood, "aria-label": mood === "happy" ? "People are happy" : "People are waiting" }, [
      spriteImg(mood === "happy" ? "user" : "gremlin", 3),
      spriteImg(mood === "happy" ? "user" : "gremlin", 3),
      spriteImg(mood === "happy" ? "user" : "gremlin", 3),
      spriteImg(mood === "happy" ? "hero" : "gremlin", 3),
    ]),
    el("div", { class: "score-row", "data-key": "score" }, [
      el("span", { class: "fine", text: "SCORE" }),
      el("strong", { text: formatScore(result.score) }),
      starRow(stars(result), 2),
    ]),
    el("div", { class: `coach${happy ? " ok" : ""}`, "data-key": "coach" }, [
      spriteImg("prof", 3),
      el("p", { text: advice }),
    ]),
    btn("GO", () => startRun(), { kind: "big run", key: "run", sound: "start", disabled: !result.ok }),
    btn(state.nerd ? "NERD ON" : "NERD MODE", toggleNerd, { kind: "ghost nerd-toggle", key: "nerd", pressed: state.nerd, sound: "blip" }),
  ])
}

function gameScreen() {
  const uc = useCase()
  const choices = state.plan.choices
  const result = live()
  const story = STORIES[uc.id] || { line: uc.blurb, sprite: uc.icon }
  return el("section", { class: "screen game" }, [
    el("div", { class: "story", "data-key": "story" }, [
      spriteImg(story.sprite, 4),
      el("p", { class: "story-line", text: story.line }),
      btn("NEW STORY", nextStory, { kind: "big", key: "new-story" }),
    ]),
    el("div", { class: "choices" }, [
      brainRow(choices),
      memoryRow(uc, choices),
      libraryRow(choices),
      homeRow(choices),
      wireRow(choices),
    ]),
    feel(result),
    el("p", { class: "fine price-note", text: "Game numbers are estimates." }),
    el("div", { class: "run-overlay", id: "run-overlay", hidden: true }, [
      el("div", { class: "crt" }, [el("canvas", { class: "floor-canvas", id: "floor-canvas", "aria-label": "Your factory at work" })]),
      el("div", { class: "run-meter" }, [
        el("span", { class: "fine", id: "run-phase", text: "READY" }),
        el("span", { class: "fine", text: "ANSWERS" }),
        el("strong", { id: "run-count", text: "0" }),
      ]),
    ]),
  ])
}

/* ---------- Run ---------- */

const RUN_PHASES = ["PEOPLE ARRIVE", "WIRES HUM", "BRAINS THINK", "ANSWERS POP OUT"]

function startRun() {
  if (state.running) return
  const result = live()
  if (!result?.ok) {
    play("error")
    return
  }
  unlock()
  state.running = true
  const overlay = document.getElementById("run-overlay")
  const canvas = document.getElementById("floor-canvas")
  overlay.hidden = false
  stage.querySelector('[data-key="run"]')?.setAttribute("disabled", "")
  state.floor = createFloor(canvas)
  const counter = document.getElementById("run-count")
  const phase = document.getElementById("run-phase")
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const duration = reduced ? 0 : RUN_MS
  const started = performance.now()
  let missSounded = false
  let finished = false
  let drawFailed = false
  let nextTick = 0.15
  const frame = (now) => {
    if (finished || state.screen !== "game") return
    const elapsed = Math.max(0, now - started)
    const progress = duration ? Math.min(1, elapsed / duration) : 1
    if (counter) counter.textContent = formatTokens(result.goodTok * progress * 60)
    if (phase) {
      const label = RUN_PHASES[Math.min(RUN_PHASES.length - 1, Math.floor(progress * RUN_PHASES.length))]
      phase.textContent = result.lateWeeks > 0 && progress < 0.7 ? "TRUCKS ARE LATE" : label
    }
    try {
      state.floor?.draw(state.plan, result, { t: elapsed / 1000, running: true, progress })
    } catch (error) {
      if (!drawFailed) console.error("Factory floor failed to draw", error)
      drawFailed = true
    }
    if (!missSounded && progress > 0.4 && crowdMood(result) === "sad") {
      missSounded = true
      play("miss")
    }
    const seconds = elapsed / 1000
    if (progress > 0 && progress < 1 && seconds >= nextTick) {
      const tps = result.goodTok || 0
      play("token", { pitch: 0.75 + Math.min(1.5, tps / 1_500_000) })
      nextTick = seconds + Math.max(0.08, Math.min(0.45, 1_200_000 / Math.max(tps, 1)))
    }
    if (progress < 1) state.runRaf = requestAnimationFrame(frame)
    else {
      finished = true
      finishRun(result)
    }
  }
  const go = () => {
    state.runRaf = requestAnimationFrame(frame)
  }
  document.fonts?.load?.("16px 'Press Start 2P'").then(go, go) ?? go()
}

function stopRun() {
  cancelAnimationFrame(state.runRaf)
  state.running = false
}

function finishRun(result) {
  state.running = false
  const prevBest = state.league.find((entry) => entry.name.toLocaleLowerCase() === state.name.toLocaleLowerCase())?.score ?? null
  const entry = {
    name: state.name,
    email: state.email,
    consent: true,
    consentAt: state.consentAt || Date.now(),
    score: result.score,
    useCase: result.useCase.id,
    costPerM: Number.isFinite(result.costPerM) ? Math.round(result.costPerM * 10000) / 10000 : null,
    fteEquivalent: result.fteEquivalent,
    annualSavings: result.annualSavings,
    at: Date.now(),
    summary: `${STORIES[result.useCase.id]?.line || result.useCase.name} ${formatScore(result.score)} points.`,
  }
  const leaderBefore = sortLeague(state.league)[0]
  state.league = upsertEntry(state.league, entry)
  saveLeague()
  const localRank = rankOf(state.league, state.name)
  state.syncLine = syncStatusLine(null, { rank: localRank, players: state.league.length })
  state.result = {
    result,
    rank: localRank,
    players: state.league.length,
    prevBest,
    newHigh: !leaderBefore || result.score > leaderBefore.score,
    personalBest: prevBest == null || result.score > prevBest,
  }
  const payload = attemptPayload({ name: state.name, email: state.email, consentAt: state.consentAt }, result, entry.at)
  recordAttempt(payload).then((sync) => {
    if (!state.result || state.result.result !== result) return
    state.syncLine = syncStatusLine(sync, { rank: localRank, players: state.league.length })
    if (sync?.ok) {
      state.result.rank = sync.rank
      state.result.players = sync.players
    }
    const line = document.querySelector("[data-key='sync-line']")
    if (line) line.textContent = state.syncLine
    const beat = document.querySelector("[data-key='beat-line']")
    if (beat) beat.textContent = beatLine(state.result.players, state.result.rank)
  }).catch(() => {})
  play("fanfare")
  renderHud()
  showResult()
}

function beatLine(players, rank) {
  const beaten = Math.max(0, (players || 1) - (rank || 1))
  return beaten === 1 ? "You beat 1 player" : `You beat ${beaten} players`
}

function hoursLine(hours) {
  const phrase = hoursCount(hours)
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} human hours a year`
}

function nerdPeopleLine(result) {
  const share = Math.round((result.share || 0) * 100)
  const cap = Math.round(result.fteCap || 0).toLocaleString("en-GB")
  const note = result.peopleCapped ? " (capped at realistic scale)" : ""
  return `Game guess: ${result.humanMinutes} minutes a task, ${share}% of the work, cap ${cap} people, ${formatMoney(result.loadedCost)} a person.${note}`
}

/* ---------- Results ---------- */

function showResult() {
  const { result, rank, players, newHigh, personalBest, prevBest } = state.result
  const uc = result.useCase
  const story = STORIES[uc.id]?.line || ""
  const blocked = blockedReason(result)
  const explained = explainResult(result, state.plan.choices, { nerd: state.nerd })
  const banner = newHigh
    ? el("p", { class: "banner blink", text: "NEW HIGH SCORE!" })
    : personalBest
      ? el("p", { class: "banner", text: "PERSONAL BEST!" })
      : el("p", { class: "banner dim", text: `YOUR BEST STAYS ${formatScore(prevBest)}` })
  const root = document.getElementById("result")
  root.replaceChildren(
    el("div", { class: "dialog panel result", role: "dialog", "aria-modal": "true", "aria-labelledby": "result-title" }, [
      el("div", { class: "result-head" }, [
        spriteImg(newHigh ? "trophy" : uc.icon, 5),
        el("div", {}, [
          el("p", { class: "card-kicker", text: story }),
          el("h2", { id: "result-title", text: "SCORE" }),
          el("p", { class: "big-score", text: formatScore(result.score) }),
          starRow(stars(result), 3),
          banner,
        ]),
        el("div", { class: "rank-box" }, [
          el("span", { class: "fine", text: "RANK" }),
          el("strong", { text: ordinal(rank) }),
          el("span", { class: "fine", text: `OF ${players}` }),
        ]),
      ]),
      el("div", { class: `people-card${blocked || result.annualSavings < 0 ? " bad" : ""}`, "data-key": "people-card" }, [
        spriteImg("user", 4),
        blocked ? el("p", { class: "blocked-line", "data-key": "blocked-line", text: blocked.text }) : null,
        el("p", { class: "people-lead", text: peopleLead(result) }),
        el("p", { text: hoursLine(result.humanHoursPerYear) }),
        el("p", { class: `savings-line${blocked ? " if-only" : ""}`, text: savingsLine(result) }),
        state.nerd ? el("p", { class: "fine nerd", text: nerdPeopleLine(result) }) : null,
      ]),
      el("section", { class: "explain", "data-key": "explain", "aria-label": explained.title }, [
        el("h3", { text: explained.title }),
        el("ul", {}, explained.lines.map((line) => el("li", { "data-line": line.id, text: line.show }))),
      ]),
      el("p", { class: "beat-line", "data-key": "beat-line", text: beatLine(players, rank) }),
      el("p", { class: "sync-line", "data-key": "sync-line", text: state.syncLine || syncStatusLine(null, { rank, players }) }),
      el("div", { class: "coach" }, [spriteImg("prof", 3), el("p", { text: plainCoach(result) })]),
      el("div", { class: "row end" }, [
        btn("PLAY AGAIN", () => {
          closeDialog("result")
          goto("game")
        }, { kind: "ghost", key: "again" }),
        btn("NEXT PLAYER", resetRun, { kind: "big", key: "next-player" }),
      ]),
    ]),
  )
  root.hidden = false
  root.querySelector('[data-key="next-player"]')?.focus()
  poke()
}

function statBlock(label, value, bad = false) {
  return el("div", { class: `stat-block${bad ? " bad" : ""}` }, [el("span", { class: "fine", text: label }), el("strong", { text: value })])
}

function closeDialog(id) {
  const root = document.getElementById(id)
  root.hidden = true
  root.replaceChildren()
}

/* ---------- Staff tools ---------- */

function openStaff() {
  state.staffUnlocked = false
  state.clearArmed = false
  state.resetArmed = false
  state.pinError = ""
  state.serverUp = null
  renderStaff()
  document.getElementById("staff").hidden = false
  probeServer()
}

function probeServer() {
  fetch("/api/health", { cache: "no-store" }).then((res) => {
    state.serverUp = res.ok
    if (!document.getElementById("staff").hidden) renderStaff()
  }).catch(() => {
    state.serverUp = false
    if (!document.getElementById("staff").hidden) renderStaff()
  })
}

async function downloadExcel() {
  const res = await fetch("/api/export.xlsx", { headers: { "X-Staff-Pin": state.staffPin }, cache: "no-store" })
  if (!res.ok) {
    state.pinError = "EXPORT FAILED"
    renderStaff()
    return
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "token-quest-attempts.xlsx"
  link.click()
  URL.revokeObjectURL(url)
}

async function resetServerLeague() {
  if (!state.resetArmed) {
    state.resetArmed = true
    renderStaff()
    return
  }
  if (!window.confirm("Reset the server league? This archives the current attempts and clears them.")) {
    state.resetArmed = false
    renderStaff()
    return
  }
  const res = await fetch("/api/reset", { method: "POST", headers: { "X-Staff-Pin": state.staffPin }, cache: "no-store" })
  state.resetArmed = false
  state.pinError = res.ok ? "SERVER LEAGUE CLEARED" : "RESET FAILED"
  if (res.ok) state.serverLeague = []
  renderStaff()
}

function renderStaff() {
  const root = document.getElementById("staff")
  const leader = sortLeague(state.league)[0]
  const body = state.staffUnlocked
    ? [
        el("p", { text: leader ? `${leader.name} leads with ${formatScore(leader.score)} points.` : "The league is empty." }),
        el("p", { class: "fine", text: "EXPORT COLUMNS: NAME, EMAIL, SCORE, USE CASE, $ PER M TOKENS, TIME, CONSENT." }),
        el("div", { class: "row" }, [
          btn("DOWNLOAD JSON", () => downloadText("token-quest-league.json", leagueJson(state.league), "application/json"), { key: "dl" }),
          btn("DOWNLOAD CSV", () => downloadText("token-quest-league.csv", leagueCsv(state.league), "text/csv"), { key: "dl-csv" }),
          btn("DOWNLOAD EXCEL", () => downloadExcel(), { key: "dl-xlsx", disabled: state.serverUp !== true, title: state.serverUp === true ? "Download the booth workbook." : "The booth server is offline." }),
          btn(state.resetArmed ? "CONFIRM SERVER RESET" : "RESET SERVER LEAGUE", () => resetServerLeague(), { kind: "ghost", key: "reset-server", disabled: state.serverUp !== true, title: state.serverUp === true ? "Archive and clear the server league." : "The booth server is offline." }),
          btn(state.clearArmed ? "CONFIRM CLEAR" : "CLEAR LEAGUE", () => {
            if (!state.clearArmed) {
              state.clearArmed = true
              renderStaff()
              return
            }
            state.league = []
            state.clearArmed = false
            saveLeague()
            renderStaff()
            render()
          }, { kind: "ghost", key: "clear" }),
        ]),
      ]
    : [
        el("label", { for: "staff-pin", text: "STAFF PIN" }),
        el("input", { id: "staff-pin", type: "password", inputmode: "numeric", maxlength: "8" }),
        el("p", { class: "form-error", text: state.pinError }),
        btn("UNLOCK", () => {
          const value = document.getElementById("staff-pin").value
          if (value === STAFF_PIN) {
            state.staffUnlocked = true
            state.staffPin = value
            state.pinError = ""
          } else state.pinError = "WRONG PIN"
          renderStaff()
        }),
      ]
  root.replaceChildren(
    el("div", { class: "dialog panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "staff-title" }, [
      el("h2", { id: "staff-title", text: "BOOTH TOOLS" }),
      ...body,
      btn("CLOSE", () => closeDialog("staff"), { kind: "ghost", sound: "back" }),
    ]),
  )
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/* ---------- Idle + global controls ---------- */

function hideIdle() {
  const banner = document.getElementById("idle")
  banner.hidden = true
  clearInterval(idleTick)
}

function showIdle() {
  let left = 20
  const banner = document.getElementById("idle")
  banner.hidden = false
  banner.textContent = `STILL THERE? RESETTING IN ${left}`
  idleTick = setInterval(() => {
    left -= 1
    banner.textContent = `STILL THERE? RESETTING IN ${left}`
    if (left <= 0) clearInterval(idleTick)
  }, 1000)
}

function poke() {
  clearTimeout(idleTimer)
  clearTimeout(idleWarn)
  hideIdle()
  if (!document.getElementById("staff").hidden) return
  idleWarn = setTimeout(showIdle, IDLE_MS - 20000)
  idleTimer = setTimeout(() => {
    if (state.running) return poke()
    resetRun()
  }, IDLE_MS)
}

document.getElementById("logo").addEventListener("click", () => {
  state.logoClicks += 1
  clearTimeout(logoTimer)
  logoTimer = setTimeout(() => {
    state.logoClicks = 0
  }, 2000)
  if (state.logoClicks >= 5) {
    state.logoClicks = 0
    openStaff()
  }
})

const nerdBar = document.getElementById("nerd-bar")
paintNerd()
nerdBar?.addEventListener("click", () => {
  unlock()
  toggleNerd()
  play("blip")
})

const muteBtn = document.getElementById("mute")
function paintMute() {
  muteBtn.textContent = isMuted() ? "SOUND OFF" : "SOUND ON"
  muteBtn.setAttribute("aria-pressed", isMuted() ? "true" : "false")
}
loadMute()
paintMute()
muteBtn.addEventListener("click", () => {
  unlock()
  setMuted(!isMuted())
  paintMute()
  if (!isMuted()) play("blip")
})
document.addEventListener("pointerdown", () => unlock(), { capture: true })

document.getElementById("present").addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
    else await document.exitFullscreen()
  } catch {
    /* Fullscreen can be refused; the game still runs in the window. */
  }
})

document.addEventListener("pointerdown", poke)
document.addEventListener("keydown", (event) => {
  poke()
  if (event.key !== "Escape") return
  if (!document.getElementById("staff").hidden) closeDialog("staff")
})

goto("title")
