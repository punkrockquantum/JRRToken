import { HALLS, KV_TIER, MISSION_SITES, ORCA, PLATFORMS, SITES, USE_CASES, byId } from "./data.js"
import { BUILD } from "./build-info.js"
import { DR_FOOTER, explainResult, thinkLines } from "./explain.js"
import { boothCoach } from "./booth.js"
import { plainCoach } from "./coach.js"
import { createFloor } from "./floor.js"
import { createAdvanceGate, createIntro, matchingScene, sceneCaption, scenesFor, setIntroDetail } from "./intro.js"
import { leagueCsv, leagueJson, ordinal, rankOf, sortLeague, upsertEntry } from "./league.js"
import { defaultSitePlans, evaluateBuild, formatMoney, formatScore, formatTokens, stars } from "./model.js"
import { blockedReason, peopleCount, peopleLead, savingsLine } from "./results.js"
import { attemptPayload, syncStatusLine } from "./attempt.js"
import { validateEmail, validateName } from "./names.js"
import { fetchLeague, recordAttempt } from "./sync.js"
import { isMuted, loadMute, play, setMuted, unlock } from "./sound.js"
import { spriteImg } from "./sprites.js"
import { PRESET_IDS, STORIES, autoLibrary, brainPick, choicesToBuild, cityChoices, citySites, defaultChoices, nerdChoices, simpleChoices, simpleDefaults, simplePicks, simpleTiles, simpleToChoices } from "./presets.js"

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
  moreStories: false,
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

/** A new plan for a story. The simple board opens on its three defaults; nerd mode on the full defaults. */
function freshPlan(useCaseId, nerd = false) {
  const choices = nerd ? defaultChoices(useCaseId) : simpleDefaults(useCaseId)
  return { useCase: useCaseId, choices, build: choicesToBuild(useCaseId, choices, nerd) }
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
  if (state.plan) {
    state.plan.choices = state.nerd ? nerdChoices(state.plan.useCase, state.plan.choices) : simpleChoices(state.plan.useCase, state.plan.choices)
    syncBuild()
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
  closeLearn()
  const focusKey = document.activeElement?.getAttribute?.("data-key")
  const screens = { title: titleScreen, intro: introScreen, stories: storyScreen, game: gameScreen }
  stage.replaceChildren(screens[state.screen]())
  renderHud()
  stage.scrollTop = 0
  if (focusKey) stage.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus()
}

function renderHud() {
  const top = sortLeague(state.league)[0]
  hud.replaceChildren(
    el("span", { class: "hud-item" }, [el("b", { text: "1UP " }), state.name ? state.name.toUpperCase() : "----"]),
    el("span", { class: "hud-item" }, [el("b", { text: "SCORE " }), state.result?.result?.ok ? formatScore(state.result.result.score) : (state.screen === "game" || state.screen === "stories" ? "—" : "0")]),
    el("span", { class: "hud-item" }, [el("b", { text: "HI " }), top ? formatScore(top.score) : "0"]),
  )
}

function resetRun() {
  state.name = ""
  state.email = ""
  state.consentAt = ""
  state.nerd = false
  state.moreStories = false
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
    state.plan = freshPlan(FIRST_SCENARIO, state.nerd)
    state.lessons = new Set()
    goto("intro")
  })
  requestAnimationFrame(() => input.focus())

  return el("section", { class: "title-screen" }, [
    el("div", { class: "panel title-card", "data-key": "title-card" }, [
      el("div", { class: "title-hero" }, [
        el("div", { class: "logo-art" }, [spriteImg("hero", 4), spriteImg("token", 4), spriteImg("prof", 4)]),
        el("h1", { class: "game-logo" }, [el("span", { text: "TOKEN" }), el("span", { text: "QUEST" })]),
        el("p", { class: "subtitle", text: "A DIGITAL REALTY GAME" }),
        el("p", {
          class: "pitch",
          text: "Build the best AI factory you can afford. Beat the high score!",
        }),
        el("div", { class: "scores" }, [
          el("h2", { text: "HIGH SCORES" }),
          el("div", { id: "league-slot" }, [leagueTable(null, 5)]),
          el("div", { class: "prize" }, [spriteImg("trophy", 3), el("span", { text: "TOP SCORE WINS THE PRIZE" })]),
        ]),
      ]),
      el("div", { class: "title-form" }, [form]),
    ]),
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
  if (state.intro.position() >= scenesFor(state.nerd).length - 1) {
    play("blip")
    goto("stories")
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
  let scenes = scenesFor(state.nerd)
  const canvas = el("canvas", { class: "intro-canvas", "aria-hidden": "true" })
  const capTitle = el("b", { text: scenes[0].title })
  const capTag = el("span", { class: "nerd-tag", text: "NERD", hidden: !state.nerd })
  const capText = el("p", { text: sceneCaption(scenes[0], state.nerd) })
  const capLive = el("p", { class: "caption-live" })
  const caption = el("div", { class: `caption${state.nerd ? " deep" : ""}`, "aria-live": "polite" }, [capTitle, capTag, capText, capLive])
  setIntroDetail(state.nerd)
  const dots = el("div", { class: "scene-dots" })
  const paintDots = () => dots.replaceChildren(...scenes.map((scene, index) =>
    el("button", {
      type: "button",
      class: "dot",
      "aria-label": `Scene ${index + 1}: ${scene.title}`,
      onclick: () => state.intro?.jump(index),
    }),
  ))
  paintDots()
  const back = btn("◀ BACK", () => state.intro?.prev(), { kind: "ghost", key: "intro-back", sound: null, disabled: true })
  const cont = btn("CLICK TO CONTINUE", advanceIntro, { kind: "big pulse", key: "intro-continue", sound: null })
  const mount = (at = 0) => {
    state.intro?.stop()
    state.intro = createIntro(canvas, {
      scenes,
      onScene: (scene) => {
        introGate.shown()
        showIntroCaption(scene, capTitle, capText, capTag, caption)
        const index = scenes.indexOf(scene)
        const last = index === scenes.length - 1
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
    state.intro.start(at)
  }
  /** Nerd on or off mid-intro swaps the scene set and lands on the matching scene. */
  refreshIntro = () => {
    const at = matchingScene(state.intro?.position() ?? 0, state.nerd)
    scenes = scenesFor(state.nerd)
    paintDots()
    if (state.intro) mount(at)
    else showIntroCaption(scenes[0], capTitle, capText, capTag, caption)
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
      btn("SKIP ▶▶", () => goto("stories"), { kind: "ghost", key: "intro-skip", sound: "back" }),
      cont,
    ]),
  ])
  const onKey = (event) => {
    if (state.screen !== "intro") return
    if (event.key !== "Enter") return
    if (event.repeat) return
    const key = introControl(event)
    if (key || event.target?.closest?.("button, a, input, .scene-dots")) return
    event.preventDefault()
    advanceIntro(event)
  }
  document.addEventListener("keydown", onKey)
  unbindIntro = () => {
    document.removeEventListener("keydown", onKey)
    unbindIntro = () => {}
  }
  requestAnimationFrame(() => {
    if (state.screen !== "intro") return
    const paint = () => {
      if (state.screen !== "intro") return
      mount(0)
    }
    document.fonts.load("8px 'Press Start 2P'").then(paint, paint)
  })
  return wrapEl
}

/* ---------- The game screen ---------- */

function syncBuild() {
  state.plan.build = choicesToBuild(state.plan.useCase, state.plan.choices, state.nerd)
}

function pick(patch) {
  play("select")
  const next = { ...state.plan.choices, ...patch }
  if (patch.cities != null) delete next.sitePlans
  state.plan.choices = next
  syncBuild()
  render()
}

function openStories() {
  state.moreStories = false
  goto("stories")
}

/** The three stories a booth visitor sees first. MORE reveals the rest; nerd mode shows all six. */
const FEATURED_STORIES = ["chat", "drug", "robot"]

function storyCard(item, scale) {
  const story = STORIES[item.id] || { line: item.blurb, sprite: item.icon }
  return el("button", {
    type: "button",
    class: "story-card",
    "data-key": `usecase-${item.id}`,
    onclick: () => {
      play("select")
      state.plan = freshPlan(item.id, state.nerd)
      goto("game")
    },
  }, [
    spriteImg(story.sprite, scale),
    el("strong", { text: item.name }),
    el("span", { text: story.line }),
  ])
}

function storyScreen() {
  if (state.nerd || state.moreStories) {
    return el("section", { class: "screen stories" }, [
      el("h2", { text: "WHO ARE YOU BUILDING FOR?" }),
      el("p", { class: "fine", text: "Pick a job. The factory should match it." }),
      el("div", { class: "story-cards" }, USE_CASES.map((item) => storyCard(item, 4))),
    ])
  }
  const featured = FEATURED_STORIES.map((id) => byId(USE_CASES, id)).filter(Boolean)
  return el("section", { class: "screen stories simple" }, [
    el("h2", { text: "WHO ARE YOU BUILDING FOR?" }),
    el("p", { class: "fine", text: "Pick a job. The factory should match it." }),
    el("div", { class: "story-cards featured" }, featured.map((item) => storyCard(item, 6))),
    el("div", { class: "row end" }, [
      btn("MORE JOBS ▶", () => {
        state.moreStories = true
        render()
      }, { kind: "big ghost", key: "more-stories" }),
    ]),
  ])
}

function crowdMood(result) {
  if (!result?.ok || result.overBudget || !result.slaMet || result.coverage < 0.5 || (result.farShare || 0) >= 0.2) return "sad"
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

let learnPop = null

function closeLearn() {
  learnPop?.remove()
  learnPop = null
}

function openLearn(anchor, { title, lines, nerd }) {
  closeLearn()
  const pop = el("div", { class: "learn-pop", role: "dialog", "aria-label": title }, [
    el("b", { text: title }),
    ...lines.map((line) => el("p", { text: line })),
    state.nerd && nerd ? el("p", { class: "nerd", text: nerd }) : null,
    el("button", { type: "button", class: "btn ghost learn-close", text: "CLOSE" }),
  ])
  pop.querySelector(".learn-close").addEventListener("click", closeLearn)
  document.body.append(pop)
  learnPop = pop
  const margin = 8
  const rect = anchor.getBoundingClientRect()
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - pop.offsetWidth - margin))
  let top = rect.bottom + 6
  if (top + pop.offsetHeight > window.innerHeight - margin) top = Math.max(margin, rect.top - pop.offsetHeight - 6)
  pop.style.left = `${Math.round(left)}px`
  pop.style.top = `${Math.round(top)}px`
}

function bindTile(tile, onPick, learn) {
  let timer = 0
  let held = false
  const disarm = () => clearTimeout(timer)
  tile.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return
    held = false
    disarm()
    timer = setTimeout(() => {
      held = true
      openLearn(tile, learn)
    }, 500)
  })
  tile.addEventListener("pointerup", disarm)
  tile.addEventListener("pointercancel", disarm)
  tile.addEventListener("pointerleave", disarm)
  tile.addEventListener("click", (event) => {
    if (held) {
      held = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    onPick()
  })
}

function picture({ key, art, tag = "", label, hint = "", on, lines, nerd = "", onPick, scale = 2 }) {
  const learn = { title: label, lines, nerd }
  const tile = el("button", {
    type: "button",
    class: `tile${on ? " on" : ""}`,
    "data-key": key,
    "data-nerd": nerd || null,
    "aria-pressed": on ? "true" : "false",
  }, [
    el("span", { class: "tile-art" }, [spriteImg(art, scale)]),
    el("span", { class: "tile-copy" }, [
      tag ? el("span", { class: "tile-tag", text: tag }) : null,
      el("span", { class: "tile-title", text: label }),
      hint ? el("span", { class: "tile-hint", text: hint }) : null,
    ]),
  ])
  bindTile(tile, onPick, learn)
  const ask = el("button", {
    type: "button",
    class: "learn-btn",
    "data-learn": key,
    "aria-label": `Learn about ${label}`,
    text: "?",
  })
  ask.addEventListener("pointerdown", (event) => event.stopPropagation())
  ask.addEventListener("click", (event) => {
    event.stopPropagation()
    openLearn(ask, learn)
  })
  return el("div", { class: "tile-wrap" }, [tile, ask])
}

function choiceRow(id, title, hint, wraps) {
  const selected = wraps.map((wrap) => wrap.querySelector(".tile")).find((tile) => tile?.getAttribute("aria-pressed") === "true")
  const nerd = state.nerd && selected?.dataset.nerd ? selected.dataset.nerd : ""
  return el("div", { class: `choice-row${nerd ? " has-nerd" : ""}`, "data-row": id }, [
    el("div", { class: "row-name" }, [
      el("b", { text: title }),
      el("span", { class: "fine", text: hint }),
    ]),
    el("div", { class: "tiles" }, wraps),
    nerd ? el("p", { class: "row-nerd", text: nerd }) : null,
  ])
}

function metroNames(useCaseId, cities) {
  return citySites(useCaseId, cities).map((id) => byId(SITES, id)?.metro).filter(Boolean)
}

function siteLabel(count) {
  return count === 1 ? "1 Digital Realty metro" : `${count} Digital Realty metros`
}

function siteLearn(useCaseId, count) {
  const names = metroNames(useCaseId, count)
  const list = names.join(", ") || "the city"
  return [
    `${siteLabel(count)}: ${list}.`,
    "Closer to people = faster.",
    "Putting the racks closer to the people shortens the trip the answer has to take.",
    "Each extra metro also copies the storage and the links, so it costs more.",
  ]
}

function nerdBrain(platform) {
  const spec = `${platform.hbmGB} GB HBM, ${platform.hbmTBs} TB/s, ${platform.rackKW} kW, ${formatMoney(platform.capex)}, lead ${platform.leadWeeks} weeks`
  if (platform.id !== "vr") return spec
  return `${spec}. 35 PFLOPS. Announced as NVL144.`
}

const GPU_HINT = {
  h100: "older, cheaper",
  h200: "more memory, still on air",
  b200: "newer, still on air",
  b300: "strong on air cooling",
  gb200: "GPUs working as one, needs liquid",
  gb300: "GPUs working as one, needs liquid",
  vr: "newest, long wait, huge power",
}

const GPU_LEARN = {
  h100: [
    "The GPU that kicked off the AI boom in 2022.",
    "80 GB of memory per GPU is small for today's giant models, so a big model is split across many GPUs.",
    "Pick it when you want an older, cheaper rack that arrives sooner.",
  ],
  h200: [
    "The same Hopper brain as the H100, with 141 GB of memory per GPU.",
    "Writing the answer is mostly a memory job, so this one is faster.",
    "It still fits an air-cooled hall.",
  ],
  b200: [
    "A Blackwell GPU with 180 GB of memory that still fits an air-cooled hall.",
    "Smaller numbers mean each token needs less memory.",
    "Pick it when you want a newer GPU without liquid cooling.",
  ],
  b300: [
    "Blackwell Ultra, with 288 GB of memory per GPU.",
    "It is the strongest rack that still runs on air cooling.",
    "Pick it when you want a lot of answers without waiting for a liquid hall.",
  ],
  gb200: [
    "72 GPUs joined by NVLink act as one giant GPU.",
    "Huge models love that shared memory.",
    "It runs too hot for fans, so pick it only with the liquid-cooled hall.",
  ],
  gb300: [
    "72 Blackwell Ultra GPUs joined by NVLink act as one.",
    "Built for models that think for a long time.",
    "It needs the liquid-cooled hall.",
  ],
  vr: [
    "The 2026 Vera Rubin rack has the fastest memory and a long wait for delivery.",
    "NVIDIA first counted it as 144 GPU dies in 72 packages.",
    "Pick it only when the deadline is long and the budget can take the highest price.",
  ],
}

const SIZE_TAG = { small: "SMALL", medium: "MEDIUM", big: "BIG", rubin: "NEWEST", huge: "HUGE" }

function brainRow(choices) {
  const ids = state.nerd ? PRESET_IDS.nerdBrains : PRESET_IDS.brains
  const artFor = { h100: "rackAir", h200: "rackAir", b200: "rackAir", b300: "rackAir", gb200: "rackLiquid", gb300: "rackLiquid", vr: "rackRubin" }
  const tiles = ids.map((id) => {
    const picked = brainPick(state.plan.useCase, id)
    const platform = byId(PLATFORMS, picked.platform)
    return picture({
      key: `brains-${id}`,
      art: artFor[picked.platform] || "rackAir",
      tag: SIZE_TAG[id],
      label: platform ? `NVIDIA ${platform.name} ×${picked.racks}` : id,
      hint: GPU_HINT[picked.platform] || "",
      on: choices.brains === id,
      lines: GPU_LEARN[picked.platform] || ["A rack of GPUs."],
      nerd: platform ? nerdBrain(platform) : "",
      onPick: () => pick({ brains: id }),
    })
  })
  return choiceRow("brains", "GPU", "The computers that run the AI", tiles)
}

function hostRow(choices) {
  const tiles = [
    picture({
      key: "hosts-standard",
      art: "rackAir",
      label: "Standard hosts",
      hint: "orchestration only",
      on: (choices.hosts || "standard") === "standard",
      lines: [
        "Ordinary CPU hosts run the app around the GPUs.",
        "They do not park the KV cache, and they do not isolate tenants.",
        "This is the baseline, with no extra cost in this game.",
      ],
      nerd: "Game value: no host premium.",
      onPick: () => pick({ hosts: "standard" }),
    }),
    picture({
      key: "hosts-grace",
      art: "rackAir",
      label: "Grace/Vera CPU hosts",
      hint: "big memory pool for KV",
      on: choices.hosts === "grace",
      lines: [
        "Grace or Vera class hosts keep a big memory pool beside the GPUs.",
        "That pool can park the KV cache, so a follow-up spends less time on prefill.",
        "They cost more and draw a little more power than a standard host.",
      ],
      nerd: "Game value: $450k and 12 kW per site. KV parking cuts follow-up prefill.",
      onPick: () => pick({ hosts: "grace" }),
    }),
    picture({
      key: "hosts-dpu",
      art: "token",
      label: "+ BlueField DPUs",
      hint: "secure multi-tenant",
      on: choices.hosts === "dpu",
      lines: [
        "BlueField-class DPUs move data and keep tenants apart.",
        "The GPUs are interrupted less, which matters when many customers share a hall.",
        "They add cost and a little power, and they take the security work off the GPUs.",
      ],
      nerd: "Game value: $700k and 8 kW per site. A small tenancy haircut comes off.",
      onPick: () => pick({ hosts: "dpu" }),
    }),
  ]
  return choiceRow("hosts", "CPU / DPU", "Hosts beside the GPUs", tiles)
}

function memoryRow(choices) {
  const tiles = [
    picture({
      key: "memory-off",
      art: "token",
      label: "KV cache tier OFF",
      hint: "re-reads every chat",
      on: !choices.memory,
      lines: [
        "With the KV cache off, the GPU throws away its notes at the end of each chat.",
        "The next question makes it re-read the whole conversation.",
        "Leave it off only for one-off questions.",
      ],
      nerd: "No saved chats. Prefill runs again on every turn.",
      onPick: () => pick({ memory: false }),
    }),
    picture({
      key: "memory-on",
      art: "chest",
      label: "KV cache tier ON",
      hint: "remembers the chat",
      on: choices.memory,
      lines: [
        "The KV cache is the GPU's notes on what it already read.",
        "A KV cache tier parks those notes and reloads them, so a follow-up skips the re-read.",
        "Turn it on when people keep the conversation going.",
      ],
      nerd: `Lead ${KV_TIER.leadWeeks} weeks. Parks the KV cache instead of prefill.`,
      onPick: () => pick({ memory: true }),
    }),
  ]
  return choiceRow("memory", "MEMORY", "KV cache: remembers chats so it doesn't re-read them", tiles)
}

function libraryRow(choices) {
  const tiles = [
    ["none", "Local only", "scroll", "each server's own drives", [
      "Each server keeps its own small drives.",
      "Fine for a chatbot that only needs what it already knows.",
      "It does not hold a shared search, so looking up company documents is slow.",
    ]],
    ["basic", "File & object storage", "vault", "shared documents", [
      "File and object storage holds the documents and the model files.",
      "The app can read a document before the model writes the answer.",
      "The model itself does not search.",
    ]],
    ["smart", "Vector index", "gem", "finds the right passages", [
      "A vector index finds the right passages for retrieval.",
      "The app turns the question into numbers, searches the index, and pastes the best passages into the prompt.",
      "The model never searches mid-thought.",
    ]],
  ].map(([id, label, art, hint, lines]) => picture({
    key: `library-${id}`,
    art,
    label,
    hint,
    on: choices.library === id,
    lines,
    onPick: () => pick({ library: id }),
  }))
  return choiceRow("library", "STORAGE", "Where documents live", tiles)
}

function homeRow(choices) {
  const air = byId(HALLS, "A")
  const rear = byId(HALLS, "R")
  const row = byId(HALLS, "I")
  const liquid = byId(HALLS, "B")
  const airLines = [
    "Air cooling is the fans, in-row coolers and rear door heat exchangers family. The servers breathe air.",
    `This hall handles up to ${air.maxRackKW} kW per rack and is ready now.`,
    "Air-cooled GPUs fit. A liquid-cooled GPU overheats and slows down.",
  ]
  const liquidLines = [
    "Coolant goes straight to cold plates on the chips. This is the LIQUID-COOLED HALL.",
    `Up to ${liquid.maxRackKW} kW per rack, and less power is spent on cooling.`,
    "Required for NVIDIA GB200 NVL72 and Vera Rubin.",
  ]
  const cool = picture({
    key: "home-cool",
    art: "fan",
    label: "AIR-COOLED HALL",
    hint: `fans, up to ${air.maxRackKW} kW per rack`,
    on: choices.home === "cool",
    lines: airLines,
    nerd: `PUE ${air.pue}. Fit-out ${air.fitOutWeeks} weeks. About 10–40 kW.`,
    onPick: () => pick({ home: "cool" }),
  })
  const wet = picture({
    key: "home-super",
    art: "rackLiquid",
    label: state.nerd ? "Direct Liquid Cooling" : "LIQUID-COOLED HALL",
    hint: `water to the chip, up to ${liquid.maxRackKW} kW per rack`,
    on: choices.home === "super",
    lines: liquidLines,
    nerd: `PUE ${liquid.pue}. Fit-out ${liquid.fitOutWeeks} weeks. About 100–240 kW.`,
    onPick: () => pick({ home: "super" }),
  })
  if (!state.nerd) return choiceRow("home", "DATA HALL", "How the racks are cooled", [cool, wet])
  const tiles = [
    cool,
    picture({
      key: "home-row",
      art: "rackAir",
      label: "In-row cooling",
      hint: `${row.maxRackKW} kW · PUE ${row.pue} · ${row.fitOutWeeks} wk`,
      on: choices.home === "row",
      lines: [
        "Coolers sit between the racks, so heat does not cross the whole room.",
        `Up to ${row.maxRackKW} kW per rack. PUE ${row.pue}. Lead time ${row.fitOutWeeks} weeks.`,
        "Air-cooled GPUs fit. NVL72 and Vera Rubin still need direct liquid cooling.",
      ],
      nerd: `PUE ${row.pue} is a game assumption. Fit-out ${row.fitOutWeeks} weeks.`,
      onPick: () => pick({ home: "row" }),
    }),
    picture({
      key: "home-rear",
      art: "rackAir",
      label: "Rear Door Heat Exchanger",
      hint: `${rear.maxRackKW} kW · PUE ${rear.pue} · ${rear.fitOutWeeks} wk`,
      on: choices.home === "rear",
      lines: [
        "A water-cooled door captures the hot exhaust. The servers stay air-cooled.",
        `About 40 to ${rear.maxRackKW} kW per rack. PUE ${rear.pue}. Lead time ${rear.fitOutWeeks} weeks.`,
        "Strong air-cooled GPUs fit. NVL72 and Vera Rubin still need direct liquid cooling.",
      ],
      nerd: `PUE ${rear.pue} is a game assumption. Fit-out ${rear.fitOutWeeks} weeks.`,
      onPick: () => pick({ home: "rear" }),
    }),
    wet,
  ]
  return choiceRow("home", "DATA HALL COOLING", "How the racks are cooled", tiles)
}

function siteRow(choices) {
  const cityMax = MISSION_SITES[state.plan.useCase]?.max || 1
  const tiles = []
  for (let count = 1; count <= cityMax; count += 1) {
    tiles.push(picture({
      key: `city-${count}`,
      art: "user",
      label: siteLabel(count),
      hint: metroNames(state.plan.useCase, count).join(", "),
      on: choices.cities === count,
      lines: siteLearn(state.plan.useCase, count),
      onPick: () => pick({ cities: count }),
    }))
  }
  return choiceRow("sites", "SITES", "Closer to people = faster", tiles)
}

const LINK_NAMES = {
  fabric: "ServiceFabric",
  mcp: "ServiceFabric MCP",
  cross: "Cross connect",
  fiber: "Dark fiber",
  public: "Public internet",
}

function legWords(name = "") {
  const plain = String(name).toLowerCase().replace(/\s*→\s*/, " to ")
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

function nerdLegs(result) {
  return (result?.legResults || [])
    .filter((leg) => leg.kind && leg.kind !== "off")
    .map((leg) => {
      const ms = Number.isFinite(leg.rttS) ? `${Math.round(leg.rttS * 1000)} ms` : ""
      const speed = Number.isFinite(leg.gbps) ? `${leg.gbps} Gbps` : ""
      return [legWords(leg.name), LINK_NAMES[leg.kind] || leg.kind, ms, speed].filter(Boolean).join(" ")
    })
    .join(". ")
}

function wireRow(choices, result) {
  const legs = nerdLegs(result)
  const tiles = [
    ["cheap", "Public internet", "gremlin", "fine for batch jobs, slow and jittery for live users", [
      "The public internet is the shared road everyone uses.",
      "It is fine for batch jobs that can wait, and slow and jittery for live users.",
      "Your traffic crosses several networks with no promise of a steady delay.",
    ]],
    ["peer", "Peering + eyeball networks", "user", "short paths to the ISPs your users are on", [
      "Peering swaps traffic directly with other networks at an internet exchange.",
      "Eyeball networks are the ISPs your users are already on, so the path to them is short.",
      "It is the realistic middle option: better than the open internet, not as steady as a private link.",
    ]],
    ["fast", "ServiceFabric", "token", "private links to clouds, partners and other metros in minutes", [
      "ServiceFabric is a private, on-demand link to clouds, partners and your other metros.",
      "A connection can go live in minutes once the port exists, and the delay stays predictable.",
      "ServiceFabric MCP lets an agent configure it for you: same network, faster operations.",
    ]],
    ["private", "Cross connect + Dark fiber", "chest", "your own fibre in the building and between your sites", [
      "A cross connect is your own fibre to a partner in the same building, so the delay is tiny.",
      "Dark fiber is your own glass between nearby metros, so it pays off with two or three sites.",
      "Users still reach you over ServiceFabric. Too far for fibre, and the link between sites uses ServiceFabric too.",
    ]],
  ].map(([id, label, art, hint, lines]) => {
    const wrap = picture({
      key: `wires-${id}`,
      art,
      label,
      hint,
      on: choices.wires === id,
      lines,
      nerd: choices.wires === id ? legs : "",
      onPick: () => pick({ wires: id }),
    })
    if (id === "fast" && state.nerd && choices.wires === "fast") {
      const toggle = el("button", {
        type: "button",
        class: `mcp-toggle${choices.mcp ? " on" : ""}`,
        "data-key": "wires-mcp",
        "aria-pressed": choices.mcp ? "true" : "false",
        title: "Let an agent configure it",
        text: choices.mcp ? "MCP ON" : "MCP",
      })
      toggle.addEventListener("pointerdown", (event) => event.stopPropagation())
      toggle.addEventListener("click", (event) => {
        event.stopPropagation()
        pick({ mcp: !choices.mcp })
      })
      wrap.append(toggle)
    }
    return wrap
  })
  return choiceRow("wires", "CONNECTION", "How answers travel", tiles)
}

function orcaRow(choices) {
  const tiles = [
    picture({
      key: "helper",
      art: "orca",
      label: choices.helper ? "ORCA PT-3 ON" : "ORCA PT-3 OFF",
      hint: "photonic quantum accelerator",
      on: choices.helper,
      lines: [
        "ORCA PT-3 is a photonic quantum accelerator that sits beside the GPUs.",
        "The GPUs build a binding graph of molecule and protein, and ORCA helps find the best match.",
        "It finds about twice as many strong binders as classical AI, and it does not make tokens faster.",
      ],
      nerd: `Lead ${ORCA.leadWeeks} weeks. Photonic boson sampling. London Innovation Lab, LHR19.`,
      onPick: () => pick({ helper: !choices.helper }),
    }),
  ]
  return choiceRow("orca", "ORCA", "Quantum accelerator for finding medicines", tiles)
}

/* ---------- The simple board: three decisions, three real tiles each ---------- */

const RACK_ART = { h100: "rackAir", h200: "rackAir", b200: "rackAir", b300: "rackAir", gb200: "rackLiquid", gb300: "rackLiquid", vr: "rackRubin" }
const SIMPLE_WIRE_ART = { cheap: "gremlin", peer: "user", fast: "token" }
const SIMPLE_WIRE_LEARN = {
  cheap: [
    "The public internet is the shared road everyone uses.",
    "It is fine for batch jobs that can wait, and slow and jittery for live users.",
    "Your traffic crosses several networks with no promise of a steady delay.",
  ],
  peer: [
    "Peering swaps traffic directly with other networks at an internet exchange.",
    "Eyeball networks are the ISPs your users are already on, so the path to them is short.",
    "It is the realistic middle option: better than the open internet, not as steady as a private link.",
  ],
  fast: [
    "ServiceFabric is a private, on-demand link to clouds, partners and your other metros.",
    "A connection can go live in minutes once the port exists, and the delay stays predictable.",
    "Documents and tools in the same building ride a cross connect, so that hop is tiny.",
  ],
}

function simpleHallLearn(useCaseId, hall) {
  const air = byId(HALLS, "A")
  const liquid = byId(HALLS, "B")
  if (hall.id === "cool") {
    return [
      "Air cooling is the fans, in-row coolers and rear door heat exchangers family. The servers breathe air.",
      `This hall handles up to ${air.maxRackKW} kW per rack and is ready now.`,
      "Air-cooled GPUs fit. A liquid-cooled GPU overheats and slows down.",
    ]
  }
  const base = [
    "Coolant goes straight to cold plates on the chips. This is the LIQUID-COOLED HALL.",
    `Up to ${liquid.maxRackKW} kW per rack, and less power is spent on cooling.`,
    "Required for NVIDIA GB200 NVL72 and Vera Rubin.",
  ]
  if (hall.id === "super") return base
  if (cityChoices(useCaseId)) return [base[0], ...siteLearn(useCaseId, 2).slice(0, 3)]
  return [base[0], "The KV memory tier parks the GPU's notes on each chat, so a follow-up skips the re-read.", "Turn it on when people keep the conversation going."]
}

/** What the simple board decided for the player, shown as small chips so nothing is hidden. */
function includedChips(useCaseId, choices) {
  const uc = byId(USE_CASES, useCaseId)
  const chips = []
  if (choices.memory) chips.push("KV memory on")
  const library = autoLibrary(useCaseId)
  if (library === "smart") chips.push("Vector index included")
  if (library === "basic") chips.push("File & object storage included")
  if (uc?.orca) chips.push("ORCA PT-3 included")
  return chips
}

function simpleRows(choices) {
  const id = state.plan.useCase
  const tiles = simpleTiles(id)
  const picks = simplePicks(id, choices)
  const choose = (patch) => pick(simpleToChoices(id, { ...picks, ...patch }))
  const gpus = tiles.brains.map((tile) => picture({
    key: `brains-${tile.id}`,
    art: RACK_ART[tile.platform?.id] || "rackAir",
    label: `NVIDIA ${tile.label}`,
    hint: tile.hint,
    on: picks.brains === tile.id,
    lines: GPU_LEARN[tile.platform?.id] || ["A rack of GPUs."],
    onPick: () => choose({ brains: tile.id }),
    scale: 3,
  }))
  const halls = tiles.halls.map((tile) => picture({
    key: `hall-${tile.id}`,
    art: tile.id === "cool" ? "fan" : tile.id === "super" ? "pipe" : cityChoices(id) ? "user" : "chest",
    label: tile.label,
    hint: tile.hint,
    on: picks.hall === tile.id,
    lines: simpleHallLearn(id, tile),
    onPick: () => choose({ hall: tile.id }),
    scale: 3,
  }))
  const wires = tiles.wires.map((tile) => picture({
    key: `wires-${tile.id}`,
    art: SIMPLE_WIRE_ART[tile.id],
    label: tile.label,
    hint: tile.hint,
    on: picks.wires === tile.id,
    lines: SIMPLE_WIRE_LEARN[tile.id],
    onPick: () => choose({ wires: tile.id }),
    scale: 3,
  }))
  return [
    choiceRow("brains", "GPU", "The computers that run the AI", gpus),
    choiceRow("home", "DATA HALL", "Cooling and where the racks live", halls),
    choiceRow("wires", "CONNECTION", "How answers travel", wires),
  ]
}

/** Two gauges, the crowd, one coach line and GO. Nothing a first-time visitor has to decode. */
function simpleFeel(result) {
  const spend = result.budgetSpend || 0
  const budget = result.budget || 1
  const late = result.lateWeeks > 0
  const timePct = result.liveWeeks / Math.max(result.scenario?.deadlineWeeks || 1, result.liveWeeks, 1)
  const mood = crowdMood(result)
  const happy = mood === "happy" && !late && !result.overBudget && !result.overPower
  return el("aside", { class: "feel simple" }, [
    gauge("MONEY", spend / budget, result.overBudget ? "TOO MUCH" : "OK", { bad: result.overBudget, key: "budget", art: "token" }),
    gauge("TIME", Math.min(1, timePct), late ? "LATE" : "ON TIME", { bad: late, key: "golive", art: "scroll" }),
    el("div", { class: `crowd ${mood}`, "data-mood": mood, "aria-label": mood === "happy" ? "People are happy" : "People are waiting" }, [
      spriteImg(mood === "happy" ? "user" : "gremlin", 4),
      spriteImg(mood === "happy" ? "user" : "gremlin", 4),
      spriteImg(mood === "happy" ? "user" : "gremlin", 4),
      spriteImg(mood === "happy" ? "hero" : "gremlin", 4),
      el("span", { class: "crowd-word", text: mood === "happy" ? "HAPPY" : "WAITING" }),
    ]),
    el("div", { class: `coach${happy ? " ok" : ""}`, "data-key": "coach" }, [
      spriteImg("prof", 3),
      el("p", { text: boothCoach(result) }),
    ]),
    btn("GO", () => startRun(), { kind: "big run", key: "run", sound: "start", disabled: !result.ok }),
    btn("NERD MODE", toggleNerd, { kind: "ghost nerd-toggle", key: "nerd", pressed: false, sound: "blip" }),
  ])
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
    el("div", { class: `coach${happy ? " ok" : ""}`, "data-key": "coach" }, [
      spriteImg("prof", 3),
      el("p", { text: advice }),
    ]),
    btn("GO", () => startRun(), { kind: "big run", key: "run", sound: "start", disabled: !result.ok }),
    btn(state.nerd ? "NERD ON" : "NERD MODE", toggleNerd, { kind: "ghost nerd-toggle", key: "nerd", pressed: state.nerd, sound: "blip" }),
  ])
}

const SITE_ROLES = [
  ["inference", "Infer", "Serves people here. This is what counts for speed."],
  ["training", "Train", "A separate job. It does not answer people. Enough of it makes answers a little better, and it does not make the first word faster."],
  ["edge", "Edge", "A small cache near people. The answer is still written at an inference site, one hop away."],
]

function currentPlans(result) {
  const sites = result.sites || []
  const brain = brainPick(state.plan.useCase, state.plan.choices.brains)
  const defaults = defaultSitePlans(result.platform, brain.racks, sites)
  const saved = state.plan.choices.sitePlans
  if (!saved?.length) return defaults
  return sites.map((site, index) => {
    const found = saved.find((item) => item.id === site.id)
    return found ? { id: site.id, role: found.role || "inference", powerMW: Number(found.powerMW) || 0 } : defaults[index]
  })
}

function siteDesigner(result) {
  const sites = result.sites || []
  if (sites.length < 2 || !result.platform) return null
  const plans = currentPlans(result)
  const commit = (next) => pick({
    sitePlans: next.map((item) => ({ id: item.id, role: item.role, powerMW: Math.round(item.powerMW * 100) / 100 })),
  })
  return el("div", { class: "site-designer", "data-key": "site-designer" }, [
    el("h4", { text: "EACH SITE" }),
    el("p", { class: "fine", text: "Inference serves people. Training does not answer anyone. An edge site is a small cache, then one hop to an inference site." }),
    ...sites.map((site) => {
      const plan = plans.find((item) => item.id === site.id) || { role: "inference", powerMW: 0 }
      return el("div", { class: "site-plan" }, [
        el("b", { text: site.metro }),
        el("span", { class: "fine", text: `${plan.powerMW.toFixed(2)} MW` }),
        el("button", { type: "button", class: "step", text: "−", "aria-label": `Less power in ${site.metro}`, onclick: () => commit(plans.map((item) => item.id === site.id ? { ...item, powerMW: Math.max(0, item.powerMW - 0.05) } : item)) }),
        el("button", { type: "button", class: "step", text: "+", "aria-label": `More power in ${site.metro}`, onclick: () => commit(plans.map((item) => item.id === site.id ? { ...item, powerMW: item.powerMW + 0.05 } : item)) }),
        ...SITE_ROLES.map(([role, label, hint]) => el("button", {
          type: "button",
          class: `step${plan.role === role ? " on" : ""}`,
          text: label,
          title: hint,
          "aria-pressed": plan.role === role ? "true" : "false",
          onclick: () => commit(plans.map((item) => item.id === site.id ? { ...item, role } : item)),
        })),
      ])
    }),
    result.powerThrottle < 1 ? el("p", { class: "fine", text: "Too much power for this hall, so the racks slow down." }) : null,
  ])
}

function gameScreen() {
  const uc = useCase()
  const choices = state.plan.choices
  const result = live()
  const story = STORIES[uc.id] || { line: uc.blurb, sprite: uc.icon }
  const rows = state.nerd ? [
    brainRow(choices),
    hostRow(choices),
    memoryRow(choices),
    libraryRow(choices),
    homeRow(choices),
    cityChoices(uc.id) ? siteRow(choices) : null,
    wireRow(choices, result),
    uc.orca ? orcaRow(choices) : null,
  ].filter(Boolean) : simpleRows(choices)
  const chips = state.nerd ? [] : includedChips(uc.id, choices)
  return el("section", { class: `screen game${state.nerd ? " nerd" : " simple"}` }, [
    el("div", { class: "story", "data-key": "story" }, [
      spriteImg(story.sprite, 4),
      el("p", { class: "story-line", text: story.line }),
      chips.length ? el("p", { class: "included", "data-key": "included" }, chips.map((chip) => el("span", { class: "chip", text: chip }))) : null,
      btn("NEW STORY", openStories, { kind: "big", key: "new-story" }),
    ]),
    el("div", { class: "choices", style: `grid-template-rows: repeat(${rows.length}, minmax(0, 1fr))` }, rows),
    state.nerd ? el("aside", { class: "think", "data-key": "think", "aria-label": "How we think" }, [
      el("h3", { text: "HOW WE THINK" }),
      siteDesigner(result),
      ...thinkLines(result).map((line) => el("p", { text: line })),
    ]) : null,
    state.nerd ? feel(result) : simpleFeel(result),
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

const RUN_PHASES = ["PEOPLE ARRIVE", "LINKS HUM", "GPUS THINK", "ANSWERS POP OUT"]

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
  const head = el("div", { class: "result-head" }, [
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
  ])
  const buttons = el("div", { class: "row end" }, [
    btn("PLAY AGAIN", () => {
      closeDialog("result")
      goto("game")
    }, { kind: "ghost", key: "again" }),
    btn("NEXT PLAYER", resetRun, { kind: "big", key: "next-player" }),
  ])
  const footer = el("p", { class: "dr-footer", "data-key": "dr-footer" }, [
    el("b", { text: "DIGITAL REALTY" }),
    el("span", { text: DR_FOOTER }),
  ])
  const syncLine = el("p", { class: "sync-line", "data-key": "sync-line", text: state.syncLine || syncStatusLine(null, { rank, players }) })
  const children = state.nerd
    ? [
      head,
      el("div", { class: `people-card${blocked || result.annualSavings < 0 ? " bad" : ""}`, "data-key": "people-card" }, [
        spriteImg("user", 4),
        blocked ? el("p", { class: "blocked-line", "data-key": "blocked-line", text: blocked.text }) : null,
        el("p", { class: "people-lead", text: peopleLead(result) }),
        el("p", { text: hoursLine(result.humanHoursPerYear) }),
        el("p", { class: `savings-line${blocked ? " if-only" : ""}`, text: savingsLine(result) }),
        el("p", { class: "fine nerd", text: nerdPeopleLine(result) }),
      ]),
      el("section", { class: "explain", "data-key": "explain", "aria-label": explained.title }, [
        el("h3", { text: explained.title }),
        el("ul", {}, explained.lines.map((line) => el("li", { "data-line": line.id, text: line.show }))),
      ]),
      el("p", { class: "beat-line", "data-key": "beat-line", text: beatLine(players, rank) }),
      syncLine,
      el("div", { class: "coach" }, [spriteImg("prof", 3), el("p", { text: plainCoach(result) })]),
      buttons,
      footer,
    ]
    : [
      head,
      el("p", { class: "headline", "data-key": "headline", text: explained.headline }),
      el("div", { class: `people-card${blocked || result.annualSavings < 0 ? " bad" : ""}`, "data-key": "people-card" }, [
        spriteImg("user", 4),
        blocked ? el("p", { class: "blocked-line", "data-key": "blocked-line", text: blocked.text }) : null,
        el("p", { class: "people-lead", text: peopleLead(result) }),
        el("p", { class: `savings-line${blocked ? " if-only" : ""}`, text: savingsLine(result) }),
      ]),
      el("div", { class: `coach${explained.suggestion.better ? "" : " ok"}`, "data-key": "next-step" }, [
        spriteImg("prof", 3),
        el("p", { text: explained.suggestion.text }),
      ]),
      el("p", { class: "beat-line", "data-key": "beat-line", text: beatLine(players, rank) }),
      syncLine,
      buttons,
      footer,
    ]
  root.replaceChildren(
    el("div", { class: `dialog panel result${state.nerd ? "" : " simple"}`, role: "dialog", "aria-modal": "true", "aria-labelledby": "result-title" }, children),
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
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLearn()
})
document.addEventListener("pointerdown", (event) => {
  if (!learnPop) return
  if (event.target?.closest?.(".learn-pop, .learn-btn")) return
  closeLearn()
})

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

const stamp = document.getElementById("build-stamp")
if (stamp) stamp.textContent = `BUILD ${BUILD.stamp}`

goto("title")
