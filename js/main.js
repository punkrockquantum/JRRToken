import { DATA_HOMES, PLATFORMS, SCENARIOS, SITES, USE_CASES, byId } from "./data.js"
import { designCard, designFor, designLines, designsFor, referenceDesign } from "./refarch.js"
import { BUILD } from "./build-info.js"
import { drHelp } from "./drhelp.js"
import { DR_FOOTER, explainResult, thinkLines } from "./explain.js"
import { ecoHint, ecoQuestion, ecoSummary, ecosystem } from "./eco.js"
import { detailLine, wireImpact } from "./impact.js"
import { plainCoach } from "./coach.js"
import { createFloor } from "./floor.js"
import { createAdvanceGate, createIntro, matchingScene, sceneCaption, scenesFor, setIntroDetail } from "./intro.js"
import { leagueCsv, leagueJson, ordinal, rankOf, sortLeague, upsertEntry } from "./league.js"
import { mapCaption, mapPoints } from "./map.js"
import { STAR_POINTS, defaultSitePlans, evaluateBuild, formatMoney, formatScore, formatTokens, stars } from "./model.js"
import { blockedReason, peopleCount, peopleLead, savingsLine } from "./results.js"
import { attemptPayload, syncStatusLine } from "./attempt.js"
import { validateEmail, validateName } from "./names.js"
import { fetchLeague, recordAttempt } from "./sync.js"
import { isMuted, loadMute, play, setMuted, unlock } from "./sound.js"
import { spriteImg } from "./sprites.js"
import { STORIES, brainPick, choicesToBuild, maxMetros, nerdChoices, simpleChoices } from "./presets.js"
import { BUILD_STEP_IDS, STEPS, STEP_IDS, applyTile, nextStep, prevStep, qpuRelevant, simpleDefaults, stepIndex, stepTiles, stepValue, untouchedSteps } from "./steps.js"
import { canImprove, roundEntry, roundHint, roundLine } from "./rounds.js"

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
  toast: null,
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

/** A new plan for a story: the opening defaults, the LOCATION step, round one of two. */
function freshPlan(useCaseId, nerd = false) {
  const choices = simpleDefaults(useCaseId)
  return { useCase: useCaseId, choices, build: choicesToBuild(useCaseId, choices, nerd), step: "location", round: 1, rounds: [] }
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


const TAGLINE = "Every AI answer is born in a data center."
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
        el("p", { class: "tagline", "data-key": "tagline", text: TAGLINE }),
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

/* ---------- The game screen: a stepped build ---------- */

const TOAST_MS = 2000
let toastTimer = 0

function syncBuild() {
  state.plan.build = choicesToBuild(state.plan.useCase, state.plan.choices, state.nerd)
}

/** Nerd-only patches (MCP, site plans) that are not tiles. */
function pick(patch) {
  play("select")
  const next = { ...state.plan.choices, ...patch }
  state.plan.choices = next
  syncBuild()
  render()
}

/** The two-second reason that pops up when a tile is picked. The screen re-renders, so the text lives in state. */
function flashWhy(text) {
  clearTimeout(toastTimer)
  state.toast = text || null
  if (!text) return
  toastTimer = setTimeout(() => {
    state.toast = null
    document.getElementById("toast")?.remove()
  }, TOAST_MS)
}

function pickTile(stepId, tile) {
  play("select")
  state.plan.choices = applyTile(state.plan.useCase, stepId, tile.id, state.plan.choices)
  syncBuild()
  flashWhy(tile.why)
  render()
}

function gotoStep(stepId) {
  if (!STEP_IDS.includes(stepId)) return
  state.plan.step = stepId
  flashWhy(null)
  render()
  stage.querySelector(".step-panel")?.scrollTo?.(0, 0)
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

function picture({ key, art, tag = "", label, hint = "", on, lines, nerd = "", onPick, scale = 2, locked = false, extra = null }) {
  const learn = { title: label, lines, nerd }
  const tile = el("button", {
    type: "button",
    class: `tile${on ? " on" : ""}${locked ? " locked" : ""}`,
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
    extra,
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

/**
 * TOKEN IMPACT strip on a connectivity tile: first token against the target, how the stream
 * feels, how idle the wire leaves the GPUs, and one plain sentence. Nerd adds the per-leg line.
 */
function impactStrip(impact, key) {
  const chip = (label, value, state, part) =>
    el("span", { class: `imp-chip ${state}`, "data-part": part, "data-state": state }, [
      el("span", { class: "imp-label", text: label }),
      el("b", { class: "imp-value", text: value }),
    ])
  return el("span", { class: "impact", "data-key": `impact-${key}` }, [
    el("span", { class: "imp-row" }, [
      chip("FIRST TOKEN", impact.firstToken.label, impact.firstToken.state, "first"),
      chip("STREAM", impact.stream.feel, impact.stream.state, "stream"),
      chip("GPU IDLE", impact.idle.label, impact.idle.state, "idle"),
    ]),
    el("span", { class: "imp-why", "data-part": "why", text: impact.why }),
    state.nerd ? el("span", { class: "imp-nerd", "data-part": "nerd", text: detailLine(impact.detail) }) : null,
  ])
}

/* ---------- Scenario card, rail, ecosystem bar ---------- */

function responseWords(seconds) {
  if (!Number.isFinite(seconds)) return "—"
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds} s`
}

/** The brief every step shows: who the users are, where the model and data live, and the limits. */
function scenarioCard(uc) {
  const scenario = SCENARIOS[uc.id] || {}
  const home = DATA_HOMES[uc.id]
  const story = STORIES[uc.id] || { line: uc.blurb, sprite: uc.icon }
  const fact = (label, value, key) => el("div", { class: "sc-fact", "data-key": `fact-${key}` }, [el("span", { class: "fine", text: label }), el("strong", { text: value })])
  return el("div", { class: "scenario panel", "data-key": "scenario" }, [
    el("div", { class: "sc-who" }, [
      spriteImg(story.sprite, 3),
      el("div", {}, [
        el("h1", { text: uc.name }),
        el("p", { class: "fine story-line", text: story.line }),
      ]),
    ]),
    el("div", { class: "sc-places" }, [
      el("p", { class: "sc-place", "data-key": "users-place" }, [el("b", { text: "USERS " }), scenario.users || scenario.where || ""]),
      el("p", { class: "sc-place", "data-key": "data-place" }, [el("b", { text: "MODEL & DATA " }), home ? `${home.what} in ${home.label}` : "beside the GPUs"]),
    ]),
    el("div", { class: "sc-facts" }, [
      fact("DEMAND", `${formatTokens(uc.demand)} tok/s`, "demand"),
      fact("RESPONSE", responseWords(uc.ttft), "response"),
      fact("BUDGET", formatMoney(scenario.budget), "budget"),
      fact("POWER", `${scenario.powerMW} MW`, "power"),
      fact("DEADLINE", `Week ${scenario.deadlineWeeks}`, "deadline"),
    ]),
    btn("NEW STORY", openStories, { kind: "ghost", key: "new-story" }),
  ])
}

function rail(stepId) {
  const current = stepIndex(stepId)
  return el("ol", { class: "rail", "data-key": "rail", "aria-label": "Build steps" }, STEPS.map((step, index) => {
    const here = index === current
    const done = index < current
    return el("li", { class: `rail-step${here ? " current" : done ? " done" : ""}`, "aria-current": here ? "step" : null }, [
      el("button", {
        type: "button",
        class: "rail-btn",
        "data-key": `step-${step.id}`,
        "aria-label": `Step ${index + 1}: ${step.title}`,
        onclick: () => {
          play("blip")
          gotoStep(step.id)
        },
      }, [
        el("span", { class: "rail-num", text: String(index + 1) }),
        el("span", { class: "rail-name", text: step.short }),
      ]),
    ])
  }))
}

/** Five lights: POWER, COOLING, COMPUTE, DATA, CONNECTIONS. Green, amber or red from the live evaluation. */
function ecoBar(result, { detail = false } = {}) {
  const parts = ecosystem(result)
  return el("div", { class: `eco-bar${detail ? " detail" : ""}`, "data-key": "eco-bar", role: "list", "aria-label": "The ecosystem" }, parts.map((part) =>
    el("div", { class: `eco-part ${part.state}`, role: "listitem", "data-part": part.id, "data-state": part.state, title: part.why }, [
      el("span", { class: "eco-light", "aria-hidden": "true" }),
      spriteImg(part.art, 2),
      el("b", { text: part.name }),
      detail ? el("span", { class: "eco-why", text: part.why }) : null,
    ]),
  ))
}

/** The three star thresholds as a target line. No live score before GO. */
function targetLine() {
  return el("div", { class: "target", "data-key": "target" }, [
    el("span", { class: "fine", text: "TARGET" }),
    ...STAR_POINTS.map((points, index) => el("span", { class: "target-step" }, [starRow(index + 1, 1), el("b", { text: formatScore(points) })])),
  ])
}

/* ---------- Steps ---------- */

function stepNav(stepId) {
  const index = stepIndex(stepId)
  const last = index >= STEP_IDS.length - 1
  return el("div", { class: "step-nav" }, [
    btn("◀ BACK", () => gotoStep(prevStep(stepId)), { kind: "ghost", key: "back", sound: "back", disabled: index === 0 }),
    last ? null : btn(nextStep(stepId) === "review" ? "REVIEW ▶" : "NEXT ▶", () => gotoStep(nextStep(stepId)), { kind: "big", key: "next", sound: "blip" }),
  ])
}

function stepPanel(stepId, result) {
  const id = state.plan.useCase
  const choices = state.plan.choices
  const step = STEPS[stepIndex(stepId)]
  if (stepId === "review") return reviewPanel(result)
  const tiles = stepTiles(id, stepId, state.nerd)
  const value = stepValue(id, stepId, choices)
  const isOn = (tile) => (stepId === "location" ? value.includes(tile.id) : value === tile.id)
  const wraps = tiles.map((tile) => {
    const impact = stepId === "wires" ? wireImpact(id, choices, tile.id, state.nerd) : null
    const wrap = picture({
      key: `${stepId}-${tile.id}`,
      art: tile.art,
      tag: tile.tag || "",
      label: tile.label,
      hint: tile.hint,
      on: isOn(tile),
      lines: tile.lines,
      nerd: impact ? detailLine(impact.detail) : tile.nerd || "",
      onPick: () => (tile.locked ? gotoStep(nextStep(stepId)) : pickTile(stepId, tile)),
      scale: state.nerd ? 2 : 3,
      locked: Boolean(tile.locked),
      extra: impact ? impactStrip(impact, tile.id) : null,
    })
    if (stepId === "wires" && tile.id === "fast" && state.nerd && isOn(tile)) {
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
  const selected = tiles.find(isOn)
  // The wires step carries its nerd detail on every tile's TOKEN IMPACT strip, not under the grid;
  // the GPU step carries it in the reference-architecture panel's title.
  const nerdLine = state.nerd && stepId !== "wires" && stepId !== "gpu" ? selected?.nerd || "" : ""
  const max = maxMetros(id)
  const subtitle = stepId === "location"
    ? `${step.hint}${max > 1 ? `: pick up to ${max}` : ""}. ${metroSummary(id, choices)}`
    : stepId === "qpu" && !qpuRelevant(id)
      ? "No choice here. Read why, then NEXT."
      : step.hint
  return el("section", { class: `step-panel step-${stepId}`, "data-key": "step-panel", "aria-labelledby": "step-title" }, [
    el("div", { class: "step-head" }, [
      el("h2", { id: "step-title", text: `${stepIndex(stepId) + 1}. ${step.title}` }),
      el("p", { class: "fine", "data-key": "step-hint", text: subtitle }),
    ]),
    stepId === "location" ? tinyMap(id, choices) : null,
    el("div", { class: `tiles count-${wraps.length}` }, wraps),
    nerdLine ? el("p", { class: "row-nerd", "data-key": "step-nerd", text: nerdLine }) : null,
    stepId === "gpu" && state.nerd ? refarchPanel(result, selected) : null,
    stepNav(stepId),
  ])
}

/**
 * Nerd GPU step: the reference architectures behind the chosen rack, one small card each, the
 * platform's own design first. A tap picks one; hold or "?" opens the whole anonymised datasheet.
 */
function refarchPanel(result, selected) {
  const id = state.plan.useCase
  const choices = state.plan.choices
  const brain = brainPick(id, choices.brains || "medium")
  const platform = byId(PLATFORMS, brain.platform)
  if (!platform) return null
  const hallId = state.plan.build.hall
  const gpus = brain.racks * platform.gpusPerRack
  const designs = designsFor(platform.id)
  const current = designFor(platform.id, choices.refarch) || referenceDesign(platform.id)
  const cards = designs.map((design) => {
    const on = design.id === current?.id
    const card = designCard(design, platform.id, hallId, gpus)
    /* A hotter or later box can tip a build over its power room or past the deadline: say so before the pick. */
    const alt = on ? result : evaluateBuild(id, { ...state.plan.build, refarch: design.id })
    if (alt.overPower && !(on || result.overPower)) card.warn = "over the power room"
    else if (alt.overBudget && !(on || result.overBudget)) card.warn = "over the budget"
    else if (alt.lateWeeks > (result.lateWeeks || 0) && !on) card.warn = "past the deadline"
    const learn = { title: `${card.title} · NVIDIA ${platform.name}`, lines: designLines(design, platform.id, hallId, gpus), nerd: "" }
    const button = el("button", {
      type: "button",
      class: `ra-card${on ? " on" : ""}${card.warn ? " warn" : ""}`,
      "data-key": `refarch-${design.id}`,
      "aria-pressed": on ? "true" : "false",
    }, [
      el("span", { class: "ra-head" }, [el("b", { text: design.letter }), el("span", { class: "ra-form", text: design.form })]),
      el("span", { class: "ra-line", text: card.spec }),
      el("span", { class: "ra-line", text: card.density }),
      el("span", { class: `ra-line ${card.warn ? "warn" : "dim"}`, text: card.warn ? `${card.lead} · ${card.warn}` : card.lead }),
    ])
    bindTile(button, () => pick({ refarch: design.id }), learn)
    const ask = el("button", { type: "button", class: "learn-btn", "data-learn": `refarch-${design.id}`, "aria-label": `Learn about design ${design.letter}`, text: "?" })
    ask.addEventListener("pointerdown", (event) => event.stopPropagation())
    ask.addEventListener("click", (event) => {
      event.stopPropagation()
      openLearn(ask, learn)
    })
    return el("div", { class: "ra-wrap" }, [button, ask])
  })
  return el("div", { class: "refarch", "data-key": "refarch" }, [
    el("div", { class: "ra-title" }, [
      el("h3", { text: `REFERENCE ARCHITECTURES · ${gpus} GPUs · ${result.hall?.name || "hall"}, ${result.hall?.maxRackKW || 0} kW a rack` }),
      selected?.nerd ? el("span", { class: "fine", "data-key": "step-nerd", text: selected.nerd }) : null,
    ]),
    el("div", { class: `ra-cards count-${designs.length}` }, cards),
  ])
}

function metroSummary(id, choices) {
  const picked = stepValue(id, "location", choices).map((site) => byId(SITES, site)?.metro || site)
  return picked.length > 1 ? `Chosen: ${picked.join(" + ")}.` : `Chosen: ${picked[0] || "none"}.`
}

const SVG_NS = "http://www.w3.org/2000/svg"

function svgEl(tag, props = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === "text") node.textContent = value
    else node.setAttribute(key, String(value))
  }
  for (const child of [].concat(children)) if (child) node.append(child)
  return node
}

/** The tiny map: users, the model and data home, the metros on offer, and the trips the chosen metros make. */
function tinyMap(id, choices) {
  const picked = stepValue(id, "location", choices)
  const { width, height, points, links } = mapPoints(id, picked)
  const svg = svgEl("svg", { class: "tiny-map", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Map: ${mapCaption(id, picked)}` }, [
    ...links.map((link) => svgEl("line", { class: `map-link ${link.kind}`, x1: link.from.x, y1: link.from.y, x2: link.to.x, y2: link.to.y })),
    ...points.map((p) => {
      const label = p.labelText ? svgEl("text", { x: p.labelX, y: p.labelY, text: p.labelText }) : null
      if (p.kind === "users") {
        return svgEl("g", { class: "map-users" }, [
          svgEl("circle", { cx: p.x, cy: p.y, r: 4 + Math.round(5 * (p.share || 0)) }),
          label,
        ])
      }
      if (p.kind === "data") {
        return svgEl("g", { class: "map-data" }, [
          svgEl("rect", { x: p.x - 5, y: p.y - 5, width: 10, height: 10, transform: `rotate(45 ${p.x} ${p.y})` }),
          label,
        ])
      }
      return svgEl("g", { class: `map-metro${p.on ? " on" : ""}`, "data-metro": p.id }, [
        svgEl("circle", { cx: p.x, cy: p.y, r: p.on ? 5 : 3.5 }),
        label,
      ])
    }),
  ])
  return el("figure", { class: "map-wrap", "data-key": "tiny-map" }, [
    svg,
    el("figcaption", { class: "fine map-legend" }, [
      el("span", { class: "legend users", text: "users" }),
      el("span", { class: "legend data", text: "model & data" }),
      el("span", { class: "legend metro", text: "Digital Realty metro" }),
      el("span", { class: "map-caption", "data-key": "map-caption", text: mapCaption(id, picked) }),
    ]),
  ])
}

/** The summary before GO: one line per step with a CHANGE button, the opening defaults called out, and the target. */
function reviewPanel(result) {
  const id = state.plan.useCase
  const choices = state.plan.choices
  const untouched = new Set(untouchedSteps(id, choices))
  const rows = BUILD_STEP_IDS.filter((stepId) => stepId !== "qpu" || qpuRelevant(id)).map((stepId) => {
    const step = STEPS[stepIndex(stepId)]
    const value = stepValue(id, stepId, choices)
    const tiles = stepTiles(id, stepId, state.nerd)
    const label = stepId === "location"
      ? value.map((site) => byId(SITES, site)?.metro || site).join(" + ")
      : tiles.find((tile) => tile.id === value)?.label || stepTiles(id, stepId, !state.nerd).find((tile) => tile.id === value)?.label || String(value)
    return el("div", { class: `review-row${untouched.has(stepId) ? " untouched" : ""}`, "data-key": `review-${stepId}` }, [
      el("span", { class: "fine", text: step.title }),
      el("strong", { text: label }),
      untouched.has(stepId) ? el("span", { class: "fine untouched-tag", text: "opening default" }) : null,
      btn("CHANGE", () => gotoStep(stepId), { kind: "ghost small", key: `change-${stepId}`, sound: "blip" }),
    ])
  })
  const summary = ecoSummary(result)
  const roundWord = state.plan.round === 2 ? "ROUND 2: IMPROVE IT" : "REVIEW"
  return el("section", { class: "step-panel step-review", "data-key": "step-panel", "aria-labelledby": "step-title" }, [
    el("div", { class: "step-head" }, [
      el("h2", { id: "step-title", text: `${STEPS.length}. ${roundWord}` }),
      el("p", { class: "fine", "data-key": "step-hint", text: result.ok ? `${summary.green} of 5 parts of the ecosystem are green${summary.red ? `, ${summary.red} red` : ""}${summary.amber ? `, ${summary.amber} amber` : ""}. Change anything, then GO.` : "Pick a GPU to light the ecosystem." }),
    ]),
    el("div", { class: "review-rows" }, rows),
    ecoBar(result, { detail: true }),
    /* BACK, the target and GO share one row so the panel never scrolls on the booth screen. */
    el("div", { class: "review-go" }, [
      btn("◀ BACK", () => gotoStep(prevStep("review")), { kind: "ghost", key: "back", sound: "back" }),
      targetLine(),
      btn("GO", () => startRun(), { kind: "big run", key: "run", sound: "start", disabled: !result.ok }),
    ]),
  ])
}

/* ---------- The side panel: gauges, crowd, coach question ---------- */

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

function roundBadge() {
  const round = state.plan.round || 1
  const first = state.plan.rounds?.[0]
  return el("div", { class: "round-badge", "data-key": "round" }, [
    el("span", { class: "fine", text: `ROUND ${round} OF 2` }),
    first ? el("span", { class: "fine", text: `Round 1: ${formatScore(first.score)}` }) : null,
  ])
}

/** One coach sentence. When a part of the ecosystem is amber or red it is a question about that part. */
function coachLine(result) {
  const hint = ecoHint(result)
  const amber = hint && hint.state !== "green"
  return el("div", { class: `coach${amber ? "" : " ok"}`, "data-key": "coach", "data-part": hint?.id || "" }, [
    spriteImg("prof", 3),
    el("p", { text: ecoQuestion(result) }),
  ])
}

function feel(result) {
  const spend = result.budgetSpend || 0
  const budget = result.budget || 1
  const late = result.lateWeeks > 0
  const powerPct = result.powerMW > 0 ? result.powerUsedMW / result.powerMW : 0
  const timePct = result.liveWeeks / Math.max(result.scenario?.deadlineWeeks || 1, result.liveWeeks, 1)
  const mood = crowdMood(result)
  const onReview = state.plan.step === "review"
  const crowdScale = state.nerd ? 3 : 4
  return el("aside", { class: `feel${state.nerd ? "" : " simple"}` }, [
    targetLine(),
    gauge("MONEY", spend / budget, state.nerd ? `${formatMoney(spend)} / ${formatMoney(budget)}` : (result.overBudget ? "TOO MUCH" : "OK"), { bad: result.overBudget, key: "budget", art: "token" }),
    ...(state.nerd ? [
      gauge("POWER", powerPct, `${(result.powerUsedMW || 0).toFixed(2)} MW`, { bad: result.overPower, key: "power", art: "fan" }),
    ] : []),
    gauge("TIME", Math.min(1, timePct), state.nerd ? `Week ${Math.ceil(result.liveWeeks || 0)}` : (late ? "LATE" : "ON TIME"), { bad: late, key: "golive", art: "scroll" }),
    ...(state.nerd ? [
      gauge("SPEED", result.slaMet ? 1 : 0.3, Number.isFinite(result.ttft) ? `${result.ttft.toFixed(2)} s` : "—", { bad: !result.slaMet, key: "speed" }),
      gauge("CROWD", result.coverage, `${Math.round((result.coverage || 0) * 100)}% served`, { bad: result.coverage < 0.5, key: "demand" }),
      gauge("PRICE", Number.isFinite(result.costPerM) ? Math.min(1, (result.useCase?.parCost || 1) / result.costPerM) : 0, Number.isFinite(result.costPerM) ? formatMoney(result.costPerM) : "—", { bad: !(result.costPerM <= (result.useCase?.parCost || Infinity)), key: "cost" }),
      peopleBadge(result),
    ] : []),
    roundBadge(),
    el("div", { class: `crowd ${mood}`, "data-mood": mood, "aria-label": mood === "happy" ? "People are happy" : "People are waiting" }, [
      spriteImg(mood === "happy" ? "user" : "gremlin", crowdScale),
      spriteImg(mood === "happy" ? "user" : "gremlin", crowdScale),
      spriteImg(mood === "happy" ? "user" : "gremlin", crowdScale),
      spriteImg(mood === "happy" ? "hero" : "gremlin", crowdScale),
      state.nerd ? null : el("span", { class: "crowd-word", text: mood === "happy" ? "HAPPY" : "WAITING" }),
    ]),
    coachLine(result),
    onReview ? null : btn("REVIEW ▶", () => gotoStep("review"), { kind: "big", key: "to-review", sound: "blip" }),
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
  const result = live()
  const stepId = STEP_IDS.includes(state.plan.step) ? state.plan.step : "location"
  return el("section", { class: `screen game${state.nerd ? " nerd" : " simple"} on-${stepId}` }, [
    scenarioCard(uc),
    el("div", { class: "eco-strip" }, [ecoBar(result), rail(stepId)]),
    stepPanel(stepId, result),
    state.nerd ? el("aside", { class: "think", "data-key": "think", "aria-label": "How we think" }, [
      el("h3", { text: "HOW WE THINK" }),
      siteDesigner(result),
      ...thinkLines(result).map((line) => el("p", { text: line })),
    ]) : null,
    feel(result),
    el("p", { class: "fine price-note", text: "Game numbers are estimates." }),
    state.toast ? el("div", { class: "toast", id: "toast", role: "status", "aria-live": "polite", text: state.toast }) : null,
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
  const plan = state.plan
  plan.rounds = [...(plan.rounds || []), { score: result.score, result, choices: { ...plan.choices } }]
  const entry = roundEntry({ name: state.name, email: state.email, consentAt: state.consentAt }, result, plan.rounds, {
    at: Date.now(),
    story: STORIES[result.useCase.id]?.line || result.useCase.name,
  })
  const leaderBefore = sortLeague(state.league)[0]
  state.league = upsertEntry(state.league, entry)
  saveLeague()
  const localRank = rankOf(state.league, state.name)
  state.syncLine = syncStatusLine(null, { rank: localRank, players: state.league.length })
  state.result = {
    result,
    round: plan.rounds.length,
    rounds: plan.rounds,
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

function improveIt(hint) {
  closeDialog("result")
  state.plan.round = 2
  state.plan.step = hint?.step && STEP_IDS.includes(hint.step) ? hint.step : "location"
  state.result = null
  renderHud()
  goto("game")
}

function playAgain() {
  closeDialog("result")
  state.plan = freshPlan(state.plan.useCase, state.nerd)
  state.result = null
  renderHud()
  goto("game")
}

/** "What you got right / what to try": green parts on the left; red and amber on the right. Round one shows only the single hint. */
function rightAndTry(result, { final }) {
  const parts = ecosystem(result)
  const right = parts.filter((part) => part.state === "green")
  const hint = roundHint(result)
  const tries = final ? parts.filter((part) => part.state !== "green") : hint ? [hint] : []
  const item = (part) => el("li", { "data-part": part.id, text: final ? `${part.name}: ${part.why}` : part.text || part.why })
  return el("div", { class: "right-try", "data-key": "right-try" }, [
    el("div", { class: "right" }, [
      el("h3", { text: "WHAT YOU GOT RIGHT" }),
      right.length ? el("ul", {}, right.map(item)) : el("p", { class: "fine", text: "Nothing is green yet. Every part of the ecosystem needs a look." }),
    ]),
    el("div", { class: "try" }, [
      el("h3", { text: final ? "WHAT TO TRY" : "ONE HINT" }),
      tries.length ? el("ul", {}, tries.map(item)) : el("p", { class: "fine", text: "Every part is green. Spend a little less and keep it that way." }),
    ]),
  ])
}

function showResult() {
  const { result, rank, players, newHigh, personalBest, prevBest, rounds = [], round = 1 } = state.result
  const uc = result.useCase
  const story = STORIES[uc.id]?.line || ""
  const blocked = blockedReason(result)
  const explained = explainResult(result, state.plan.choices, { nerd: state.nerd })
  const helped = drHelp(result, state.plan.choices, { nerd: state.nerd })
  const improvable = canImprove(rounds)
  const hint = roundHint(result)
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
      el("h2", { id: "result-title", text: improvable ? `ROUND ${round} SCORE` : "FINAL SCORE" }),
      el("p", { class: "big-score", text: formatScore(improvable ? result.score : Math.max(...rounds.map((item) => item.score))) }),
      starRow(stars(improvable ? result : rounds.reduce((best, item) => (item.score > best.score ? item : best), rounds[0]).result), 3),
      el("p", { class: "round-line", "data-key": "round-line", text: roundLine(rounds) }),
      banner,
    ]),
    el("div", { class: "rank-box" }, [
      el("span", { class: "fine", text: "RANK" }),
      el("strong", { text: ordinal(rank) }),
      el("span", { class: "fine", text: `OF ${players}` }),
    ]),
  ])
  const buttons = el("div", { class: "row end" }, [
    btn("PLAY AGAIN", playAgain, { kind: "ghost", key: "again" }),
    improvable ? btn("IMPROVE IT ▶", () => improveIt(hint), { kind: "big pulse", key: "improve", sound: "start" }) : null,
    btn("NEXT PLAYER", resetRun, { kind: improvable ? "ghost" : "big", key: "next-player" }),
  ])
  const footer = el("p", { class: "dr-footer", "data-key": "dr-footer" }, [
    el("b", { text: "DIGITAL REALTY" }),
    el("span", { text: DR_FOOTER }),
  ])
  const syncLine = el("p", { class: "sync-line", "data-key": "sync-line", text: state.syncLine || syncStatusLine(null, { rank, players }) })
  const people = el("div", { class: `people-card${blocked || result.annualSavings < 0 ? " bad" : ""}`, "data-key": "people-card" }, [
    spriteImg("user", 4),
    blocked ? el("p", { class: "blocked-line", "data-key": "blocked-line", text: blocked.text }) : null,
    el("p", { class: "people-lead", text: peopleLead(result) }),
    state.nerd ? el("p", { text: hoursLine(result.humanHoursPerYear) }) : null,
    el("p", { class: `savings-line${blocked ? " if-only" : ""}`, text: savingsLine(result) }),
    state.nerd ? el("p", { class: "fine nerd", text: nerdPeopleLine(result) }) : null,
  ])
  /* The head and the buttons stay put; everything between them scrolls as one body. */
  const body = el("div", { class: "result-body", "data-key": "result-body" }, [
    el("p", { class: "headline", "data-key": "headline", text: explained.headline }),
    ecoBar(result),
    rightAndTry(result, { final: !improvable }),
    state.nerd ? el("section", { class: "explain", "data-key": "explain", "aria-label": explained.title }, [
      el("h3", { text: explained.title }),
      el("ul", {}, explained.lines.map((line) => el("li", { "data-line": line.id, text: line.show }))),
    ]) : null,
    /* Both modes: how Digital Realty would have helped this build; nerd mode adds the numbers. */
    el("section", { class: "explain dr-help", "data-key": "dr-help", "aria-label": helped.title }, [
      el("h3", { text: helped.title }),
      el("ul", {}, helped.lines.map((line) => el("li", { "data-line": line.id, text: line.show }))),
    ]),
    people,
    state.nerd && !improvable ? el("div", { class: "coach" }, [spriteImg("prof", 3), el("p", { text: plainCoach(result) })]) : null,
    el("p", { class: "beat-line", "data-key": "beat-line", text: beatLine(players, rank) }),
    syncLine,
  ])
  const children = [head, body, buttons, footer]
  root.replaceChildren(
    el("div", { class: `dialog panel result${state.nerd ? "" : " simple"}${improvable ? " round-one" : " final"}`, role: "dialog", "aria-modal": "true", "aria-labelledby": "result-title" }, children),
  )
  root.hidden = false
  root.querySelector(improvable ? '[data-key="improve"]' : '[data-key="next-player"]')?.focus()
  poke()
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
