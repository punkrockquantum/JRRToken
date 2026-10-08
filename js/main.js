import { DATA_TIERS, HALLS, KV_TIER, LESSONS, ORCA, PLATFORMS, USE_CASES, byId } from "./data.js"
import { coach } from "./coach.js"
import { createFloor } from "./floor.js"
import { SCENES, createIntro } from "./intro.js"
import { ordinal, rankOf, rivalFor, sortLeague, upsertEntry } from "./league.js"
import {
  MAX_RACKS,
  PICK_COUNT,
  blankBuild,
  blankPlan,
  evaluateDeployment,
  evaluatePlan,
  formatScore,
  formatSeconds,
  formatTokens,
  planErrors,
  stars,
} from "./model.js"
import { validateName } from "./names.js"
import { isMuted, play, setMuted } from "./sound.js"
import { spriteImg } from "./sprites.js"

const LEAGUE_KEY = "token-quest-league-v1"
const STAFF_PIN = "2510"
const IDLE_MS = 180000
const RUN_MS = 5200

const state = {
  screen: "title",
  name: "",
  plan: blankPlan(),
  tab: 0,
  league: loadLeague(),
  lessons: new Set(),
  tip: null,
  intro: null,
  floor: null,
  runRaf: 0,
  running: false,
  result: null,
  staffUnlocked: false,
  clearArmed: false,
  pinError: "",
  logoClicks: 0,
}

let idleTimer = 0
let idleWarn = 0
let idleTick = 0
let logoTimer = 0

const stage = document.getElementById("stage")
const hud = document.getElementById("hud")

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

function teach(key, title, text) {
  if (key && LESSONS[key]) state.lessons.add(key)
  state.tip = { title, text }
}

function btn(label, onclick, { kind = "", disabled = false, key = null, sound = "select", aria = null } = {}) {
  return el(
    "button",
    {
      type: "button",
      class: `btn ${kind}`.trim(),
      disabled,
      "data-key": key,
      "aria-label": aria,
      onclick: (event) => {
        if (sound) play(sound)
        onclick(event)
      },
    },
    label,
  )
}

/* ---------- Screen routing ---------- */

function goto(screen) {
  stopRun()
  state.intro?.stop()
  state.intro = null
  state.floor = null
  state.screen = screen
  render()
  stage.scrollTop = 0
  poke()
}

function render() {
  const focusKey = document.activeElement?.getAttribute?.("data-key")
  const scroll = stage.scrollTop
  const screens = {
    title: titleScreen,
    intro: introScreen,
    missions: missionScreen,
    halls: hallScreen,
    build: buildScreen,
    floor: floorScreen,
  }
  stage.replaceChildren(screens[state.screen]())
  renderHud()
  stage.scrollTop = scroll
  if (focusKey) stage.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus()
}

function renderHud() {
  const top = sortLeague(state.league)[0]
  const live = state.plan.picks.length === PICK_COUNT ? evaluatePlan(state.plan) : null
  hud.replaceChildren(
    el("span", { class: "hud-item" }, [el("b", { text: "1UP " }), state.name ? state.name.toUpperCase() : "----"]),
    el("span", { class: "hud-item" }, [el("b", { text: "SCORE " }), live?.ok ? formatScore(live.score) : "0"]),
    el("span", { class: "hud-item" }, [el("b", { text: "HI " }), top ? formatScore(top.score) : "0"]),
    el("span", { class: "hud-item" }, [el("b", { text: "LESSONS " }), `${state.lessons.size}/${Object.keys(LESSONS).length}`]),
  )
}

function resetRun() {
  state.name = ""
  state.plan = blankPlan()
  state.tab = 0
  state.lessons = new Set()
  state.tip = null
  state.result = null
  closeDialog("result")
  goto("title")
}

/* ---------- Title ---------- */

function titleScreen() {
  const error = el("p", { id: "name-error", class: "form-error", role: "alert" })
  const input = el("input", {
    id: "player-name",
    name: "name",
    autocomplete: "name",
    autocapitalize: "words",
    maxlength: "40",
    placeholder: "ADA LOVELACE",
    spellcheck: "false",
  })
  const form = el("form", { id: "enter-form", class: "enter" }, [
    el("label", { for: "player-name", class: "blink-label", text: "ENTER YOUR FULL NAME" }),
    input,
    error,
    el("button", { class: "btn big", type: "submit", text: "PRESS START" }),
  ])
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    const check = validateName(input.value)
    error.textContent = check.ok ? "" : check.error
    input.setAttribute("aria-invalid", check.ok ? "false" : "true")
    if (!check.ok) {
      play("error")
      return
    }
    play("start")
    state.name = check.name
    state.plan = blankPlan()
    state.lessons = new Set()
    state.tab = 0
    goto("intro")
  })
  requestAnimationFrame(() => input.focus())

  return el("section", { class: "title-screen" }, [
    el("div", { class: "title-hero" }, [
      el("div", { class: "logo-art" }, [spriteImg("hero", 6), spriteImg("token", 6), spriteImg("prof", 6)]),
      el("h1", { class: "game-logo" }, [el("span", { text: "TOKEN" }), el("span", { text: "QUEST" })]),
      el("p", { class: "subtitle", text: "BUILD THE AI FACTORY" }),
      el("p", {
        class: "pitch",
        text: "Pick 3 AI missions. Fill 2 data halls with NVIDIA GPUs and Everpure storage. Serve the most good tokens per megawatt to win.",
      }),
      form,
    ]),
    el("aside", { class: "panel scores" }, [
      el("h2", { text: "HIGH SCORES" }),
      leagueTable(null, 10),
      el("div", { class: "prize" }, [spriteImg("trophy", 3), el("span", { text: "TOP SCORE WINS THE PRIZE" })]),
    ]),
  ])
}

function leagueTable(highlight, limit) {
  const rows = sortLeague(state.league).slice(0, limit)
  if (!rows.length) return el("p", { class: "empty", text: "NO SCORES YET. BE THE FIRST!" })
  const mine = highlight?.toLocaleLowerCase()
  const table = el("ol", { class: "league" }, rows.map((entry, index) =>
    el("li", { class: mine && entry.name.toLocaleLowerCase() === mine ? "mine" : "" }, [
      el("span", { class: "rank", text: ordinal(index + 1) }),
      el("span", { class: "lname", text: entry.name.toUpperCase() }),
      el("span", { class: "lscore", text: formatScore(entry.score) }),
    ]),
  ))
  const rank = highlight ? rankOf(state.league, highlight) : null
  if (!rank || rank <= limit) return table
  const entry = state.league.find((item) => item.name.toLocaleLowerCase() === mine)
  return el("div", {}, [table, el("p", { class: "fine", text: `YOU: ${ordinal(rank)} · ${formatScore(entry.score)}` })])
}

/* ---------- Intro ---------- */

function introScreen() {
  const canvas = el("canvas", { class: "intro-canvas", "aria-hidden": "true" })
  const capTitle = el("b", { text: SCENES[0].title })
  const capText = el("p", { text: SCENES[0].text })
  const live = el("div", { class: "caption", "aria-live": "polite" }, [capTitle, capText])
  const dots = el("div", { class: "scene-dots" }, SCENES.map((scene, index) =>
    el("button", {
      type: "button",
      class: "dot",
      "aria-label": `Scene ${index + 1}: ${scene.title}`,
      onclick: () => {
        play("blip")
        state.intro?.jump(index)
      },
    }),
  ))
  const cont = btn("CONTINUE ▶", () => goto("missions"), { kind: "big", key: "intro-continue" })
  const wrapEl = el("section", { class: "intro" }, [
    el("div", { class: "screen-head" }, [
      el("h1", { text: "HOW A TOKEN IS BORN" }),
      el("p", { class: "lede", text: "Prompt, tokens, retrieval, prefill, generation. Watch the trip from question to answer." }),
    ]),
    el("div", { class: "crt" }, [canvas, live]),
    dots,
    el("div", { class: "row" }, [
      btn("REPLAY", () => state.intro?.start(0), { kind: "ghost", key: "intro-replay" }),
      btn("SKIP ▶▶", () => goto("missions"), { kind: "ghost", key: "intro-skip" }),
      cont,
    ]),
  ])
  requestAnimationFrame(() => {
    if (state.screen !== "intro") return
    const paint = () => {
      state.intro = createIntro(canvas, {
        onScene: (scene) => {
          capTitle.textContent = scene.title
          capText.textContent = scene.text
          const index = SCENES.indexOf(scene)
          dots.querySelectorAll(".dot").forEach((dot, i) => dot.setAttribute("aria-current", i === index ? "true" : "false"))
          const keys = { tokens: "token", retrieval: "rag", prefill: "kv", generate: "ttft" }
          if (keys[scene.id]) state.lessons.add(keys[scene.id])
          renderHud()
        },
        onDone: () => cont.focus(),
      })
      state.intro.start(0)
    }
    document.fonts.load("8px 'Press Start 2P'").then(paint, paint)
  })
  return wrapEl
}

/* ---------- Missions ---------- */

function statLine(label, value) {
  return el("div", { class: "stat" }, [el("dt", { text: label }), el("dd", { text: value })])
}

function missionScreen() {
  const picks = state.plan.picks
  const cards = USE_CASES.map((useCase) => {
    const picked = picks.includes(useCase.id)
    const full = picks.length >= PICK_COUNT && !picked
    return el(
      "button",
      {
        type: "button",
        class: "card mission",
        "aria-pressed": picked ? "true" : "false",
        disabled: full,
        "data-key": `mission-${useCase.id}`,
        onclick: () => {
          play(picked ? "back" : "select")
          if (picked) {
            state.plan.picks = picks.filter((id) => id !== useCase.id)
            delete state.plan.halls[useCase.id]
          } else {
            state.plan.picks = [...picks, useCase.id]
            state.plan.builds[useCase.id] ||= blankBuild()
          }
          teach(null, useCase.name.toUpperCase(), useCase.learn)
          render()
        },
      },
      [
        el("div", { class: "card-head" }, [
          spriteImg(useCase.icon, 4),
          el("div", {}, [el("span", { class: "card-kicker", text: useCase.npc.toUpperCase() }), el("span", { class: "card-title", text: useCase.name.toUpperCase() })]),
          picked ? el("span", { class: "check", text: "✔" }) : null,
        ]),
        el("p", { class: "card-body", text: useCase.blurb }),
        el("dl", { class: "stats" }, [
          statLine("MODEL", useCase.model),
          statLine("CONTEXT", `${formatTokens(useCase.ctx)} tokens`),
          statLine("FIRST TOKEN", `≤ ${formatSeconds(useCase.ttft)}`),
          statLine("SPEED", `${useCase.tps} tok/s per user`),
          statLine("DEMAND", `${formatTokens(useCase.demand)} tok/s`),
          statLine("DATA", { none: "Not needed", helpful: "Helps a lot", required: "Required" }[useCase.data]),
        ]),
        el("p", { class: "learn" }, [el("b", { text: "LEARN " }), useCase.learn]),
      ],
    )
  })
  return el("section", { class: "screen" }, [
    progress("missions"),
    el("div", { class: "screen-head" }, [
      el("h1", { text: `CHOOSE ${PICK_COUNT} MISSIONS` }),
      el("p", { class: "lede", text: "Every mission needs different things. Scoring is fair across missions: 1,000 points is par, and 1,200 earns three stars." }),
    ]),
    el("div", { class: "grid missions" }, cards),
    profBox(),
    el("div", { class: "row end" }, [
      el("span", { class: "counter", text: `${picks.length}/${PICK_COUNT} PICKED` }),
      btn("NEXT: DATA HALLS ▶", () => goto("halls"), { kind: "big", disabled: picks.length !== PICK_COUNT, key: "to-halls" }),
    ]),
  ])
}

/* ---------- Halls ---------- */

function hallScreen() {
  const errors = planErrors(state.plan)
  const hallPanels = HALLS.map((hall) =>
    el("div", { class: `panel hall hall-${hall.cooling}` }, [
      el("div", { class: "hall-head" }, [
        spriteImg(hall.cooling === "liquid" ? "rackLiquid" : "rackAir", 3),
        el("div", {}, [el("h2", { text: hall.name.toUpperCase() }), el("p", { class: "card-kicker", text: hall.kind.toUpperCase() })]),
      ]),
      el("dl", { class: "stats" }, [
        statLine("POWER", `${hall.itMW} MW IT`),
        statLine("MAX RACK", `${hall.maxRackKW} kW`),
        statLine("PUE", hall.pue.toFixed(2)),
        statLine("COOLING", hall.cooling === "liquid" ? "Direct-to-chip liquid" : "Air + fans"),
      ]),
      el("p", { class: "learn" }, [el("b", { text: "LEARN " }), hall.learn]),
      el("div", { class: "hall-missions" }, state.plan.picks
        .filter((id) => state.plan.halls[id] === hall.id)
        .map((id) => {
          const useCase = byId(USE_CASES, id)
          return el("span", { class: "chip" }, [spriteImg(useCase.icon, 2), useCase.name.toUpperCase()])
        })),
    ]),
  )
  const assign = state.plan.picks.map((id) => {
    const useCase = byId(USE_CASES, id)
    return el("div", { class: "assign" }, [
      spriteImg(useCase.icon, 3),
      el("span", { class: "assign-name", text: useCase.name.toUpperCase() }),
      el("div", { class: "seg" }, HALLS.map((hall) =>
        el("button", {
          type: "button",
          class: "seg-btn",
          "aria-pressed": state.plan.halls[id] === hall.id ? "true" : "false",
          "data-key": `hall-${id}-${hall.id}`,
          onclick: () => {
            play("select")
            state.plan.halls[id] = hall.id
            const build = state.plan.builds[id]
            const platform = byId(PLATFORMS, build?.platform)
            if (platform && platform.cooling === "liquid" && hall.cooling !== "liquid") build.platform = null
            teach("pue", `${hall.name.toUpperCase()}: ${hall.kind.toUpperCase()}`, hall.learn)
            render()
          },
        }, hall.name.toUpperCase()),
      )),
    ])
  })
  return el("section", { class: "screen" }, [
    progress("halls"),
    el("div", { class: "screen-head" }, [
      el("h1", { text: "SEND MISSIONS TO HALLS" }),
      el("p", { class: "lede", text: "Use both halls. Only Hall B can cool the 72-GPU racks." }),
    ]),
    el("div", { class: "grid halls" }, hallPanels),
    el("div", { class: "panel assigns" }, assign),
    profBox(),
    el("div", { class: "row end" }, [
      btn("◀ BACK", () => goto("missions"), { kind: "ghost", sound: "back" }),
      el("span", { class: "counter warn", text: errors[0] || "READY!" }),
      btn("NEXT: BUILD ▶", () => {
        state.tab = 0
        goto("build")
      }, { kind: "big", disabled: errors.length > 0, key: "to-build" }),
    ]),
  ])
}

/* ---------- Build ---------- */

function racksUsedElsewhere(platformId, missionId) {
  return state.plan.picks
    .filter((id) => id !== missionId && state.plan.builds[id]?.platform === platformId)
    .reduce((sum, id) => sum + (state.plan.builds[id].racks || 0), 0)
}

function hallLoad(hallId, evaluation) {
  return evaluation.halls.find((entry) => entry.hall.id === hallId)
}

function buildScreen() {
  const picks = state.plan.picks
  const id = picks[state.tab] || picks[0]
  const useCase = byId(USE_CASES, id)
  const hall = byId(HALLS, state.plan.halls[id])
  const build = state.plan.builds[id]
  const result = evaluateDeployment(id, hall.id, build)
  const plan = evaluatePlan(state.plan)
  if (!state.tip) teach(null, "BUILD TIME!", "Pick an NVIDIA platform for this mission. Watch the meters on the right: green means good.")

  const tabs = el("div", { class: "tabs", role: "tablist" }, picks.map((pid, index) => {
    const uc = byId(USE_CASES, pid)
    const r = plan.deployments[index]
    return el("button", {
      type: "button",
      role: "tab",
      class: "tab",
      "aria-selected": index === state.tab ? "true" : "false",
      "data-key": `tab-${pid}`,
      onclick: () => {
        play("blip")
        state.tab = index
        state.tip = null
        render()
      },
    }, [
      spriteImg(uc.icon, 2),
      el("span", { text: uc.name.toUpperCase() }),
      el("span", { class: "tab-hall", text: state.plan.halls[pid] }),
      starRow(stars(r), 1.5),
    ])
  }))

  const platformCards = PLATFORMS.map((platform) => {
    const left = platform.supply - racksUsedElsewhere(platform.id, id)
    const blocked = platform.cooling === "liquid" && hall.cooling !== "liquid"
    const reason = blocked ? "NEEDS LIQUID" : left <= 0 ? "SOLD OUT" : ""
    return el("button", {
      type: "button",
      class: `card gpu ${platform.cooling}`,
      "aria-pressed": build.platform === platform.id ? "true" : "false",
      disabled: Boolean(reason),
      "data-key": `gpu-${platform.id}`,
      onclick: () => {
        play("select")
        build.platform = platform.id
        build.racks = Math.max(1, Math.min(build.racks || 1, left))
        teach(platform.domain >= 72 ? "nvlink" : "hbm", platform.name.toUpperCase(), platform.learn)
        render()
      },
    }, [
      el("div", { class: "gpu-art" }, [spriteImg(platform.sprite, 3)]),
      el("span", { class: "card-kicker", text: `${platform.family} · ${platform.year}`.toUpperCase() }),
      el("span", { class: "card-title", text: platform.name.toUpperCase() }),
      el("span", { class: "tag", text: platform.tag }),
      el("dl", { class: "mini" }, [
        statLine("HBM", `${platform.hbmGB}GB`),
        statLine("BW", `${platform.hbmTBs}TB/s`),
        statLine("GPUS", String(platform.gpusPerRack)),
        statLine("RACK", `${platform.rackKW}kW`),
      ]),
      el("span", { class: `cool ${platform.cooling}`, text: platform.cooling === "liquid" ? "LIQUID ONLY" : "AIR OK" }),
      el("span", { class: "supply", text: reason || `${left} RACKS LEFT` }),
    ])
  })

  const platform = byId(PLATFORMS, build.platform)
  const maxRacks = platform ? Math.max(1, Math.min(MAX_RACKS, platform.supply - racksUsedElsewhere(platform.id, id))) : 1
  const setRacks = (value) => {
    build.racks = Math.max(1, Math.min(maxRacks, value))
    play("blip")
    teach("rightsize", "HOW MANY RACKS?", "More racks serve more users, but every rack burns power even when idle. Aim to just meet demand.")
    render()
  }
  const rackStepper = el("div", { class: "stepper" }, [
    btn("−5", () => setRacks(build.racks - 5), { kind: "small", disabled: !platform || build.racks <= 1, key: "racks-m5", sound: null, aria: "Remove 5 racks" }),
    btn("−", () => setRacks(build.racks - 1), { kind: "small", disabled: !platform || build.racks <= 1, key: "racks-m1", sound: null, aria: "Remove a rack" }),
    el("output", { class: "rack-count", "aria-live": "polite" }, [
      el("strong", { text: String(build.racks) }),
      el("span", { text: platform ? ` RACKS · ${build.racks * platform.gpusPerRack} GPUS` : " RACKS" }),
    ]),
    btn("+", () => setRacks(build.racks + 1), { kind: "small", disabled: !platform || build.racks >= maxRacks, key: "racks-p1", sound: null, aria: "Add a rack" }),
    btn("+5", () => setRacks(build.racks + 5), { kind: "small", disabled: !platform || build.racks >= maxRacks, key: "racks-p5", sound: null, aria: "Add 5 racks" }),
  ])

  const dataCards = DATA_TIERS.map((tier) =>
    el("button", {
      type: "button",
      class: "card store",
      "aria-pressed": build.data === tier.id ? "true" : "false",
      "data-key": `data-${tier.id}`,
      onclick: () => {
        play("select")
        build.data = tier.id
        teach("rag", tier.name.toUpperCase(), tier.learn)
        render()
      },
    }, [
      spriteImg(tier.id === "local" ? "iconCode" : "vault", 3),
      el("span", { class: "card-title", text: tier.name.toUpperCase() }),
      el("span", { class: "tag", text: tier.tag }),
      el("span", { class: "fine", text: tier.kw ? `+${tier.kw} kW` : "0 kW" }),
    ]),
  )
  const kvCard = el("button", {
    type: "button",
    class: "card store toggle",
    "aria-pressed": build.kv ? "true" : "false",
    "data-key": "kv",
    onclick: () => {
      play(build.kv ? "back" : "coin")
      build.kv = !build.kv
      teach("kv", KV_TIER.name.toUpperCase(), KV_TIER.learn)
      render()
    },
  }, [
    spriteImg("chest", 3),
    el("span", { class: "card-title", text: KV_TIER.name.toUpperCase() }),
    el("span", { class: "tag", text: KV_TIER.tag }),
    el("span", { class: "fine", text: `${build.kv ? "ON" : "OFF"} · +${KV_TIER.kw} kW` }),
  ])
  const orcaCard = useCase.orca
    ? el("button", {
        type: "button",
        class: "card store toggle",
        "aria-pressed": build.orca ? "true" : "false",
        "data-key": "orca",
        onclick: () => {
          play(build.orca ? "back" : "coin")
          build.orca = !build.orca
          teach(null, ORCA.name.toUpperCase(), ORCA.learn)
          render()
        },
      }, [
        spriteImg("orca", 3),
        el("span", { class: "card-title", text: ORCA.name.toUpperCase() }),
        el("span", { class: "tag", text: ORCA.tag }),
        el("span", { class: "fine", text: `${build.orca ? "ON" : "OFF"} · +${ORCA.kw} kW` }),
      ])
    : null

  const allOk = plan.ok
  const last = state.tab === picks.length - 1
  return el("section", { class: "screen build" }, [
    progress("build"),
    tabs,
    el("div", { class: "build-grid" }, [
      el("div", { class: "build-main" }, [
        el("div", { class: "mission-strip panel" }, [
          spriteImg(useCase.icon, 4),
          el("div", {}, [
            el("h1", { text: `${useCase.name.toUpperCase()} → ${hall.name.toUpperCase()}` }),
            el("p", { class: "fine", text: `${useCase.model} · ${formatTokens(useCase.ctx)} context · TTFT ≤ ${formatSeconds(useCase.ttft)} · ${useCase.tps} tok/s/user · ${formatTokens(useCase.demand)} tok/s demand` }),
          ]),
        ]),
        profBox(),
        el("h2", { class: "step-title", text: "1 · NVIDIA PLATFORM" }),
        el("div", { class: "grid gpus" }, platformCards),
        el("h2", { class: "step-title", text: "2 · HOW MANY RACKS?" }),
        rackStepper,
        el("h2", { class: "step-title", text: "3 · EVERPURE STORAGE" }),
        el("div", { class: "grid stores" }, [...dataCards, kvCard, orcaCard]),
      ]),
      el("aside", { class: "build-side" }, [scouter(result, plan, hall)]),
    ]),
    el("div", { class: "row end" }, [
      btn("◀ BACK", () => {
        if (state.tab > 0) {
          state.tab -= 1
          state.tip = null
          render()
        } else goto("halls")
      }, { kind: "ghost", sound: "back" }),
      el("span", { class: "counter warn", text: plan.errors.find((e) => !e.startsWith("Choose an NVIDIA")) || (allOk ? "ALL SYSTEMS GO!" : "") }),
      last
        ? btn("TO THE FLOOR ▶", () => goto("floor"), { kind: "big", disabled: !allOk, key: "to-floor" })
        : btn("NEXT MISSION ▶", () => {
            state.tab += 1
            state.tip = null
            render()
          }, { kind: "big", key: "next-mission" }),
    ]),
  ])
}

function meter(label, value, max, { good = true, text = "", invert = false } = {}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return el("div", { class: `meter ${good ? "good" : "bad"}` }, [
    el("div", { class: "meter-top" }, [el("span", { text: label }), el("span", { text })]),
    el("div", { class: "meter-bar", role: "meter", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(pct * 100)) }, [
      el("i", { style: `width:${Math.round((invert ? 1 - pct : pct) * 100)}%` }),
    ]),
  ])
}

function scouter(result, plan, hall) {
  const load = hallLoad(hall.id, plan)
  const advice = coach(result)
  if (advice?.lesson) state.lessons.add(advice.lesson)
  const parts = [
    el("h2", { text: "SCOUTER" }),
    el("div", { class: `advice ${result.ok && result.bottleneck === "met" ? "ok" : ""}` }, [
      el("b", { text: advice.title }),
      el("p", { text: advice.text }),
    ]),
  ]
  if (!result.ok) {
    parts.push(el("p", { class: "fine", text: "Choose a platform to see the meters." }))
  } else {
    const uc = result.useCase
    parts.push(
      meter("DEMAND MET", result.goodput, result.demand, {
        good: result.coverage >= 0.95,
        text: `${formatTokens(result.goodput)} / ${formatTokens(result.demand)}`,
      }),
      meter("FIRST TOKEN", Math.min(result.ttft, uc.ttft * 2), uc.ttft * 2, {
        good: result.slaMet,
        text: `${formatSeconds(result.ttft)} / ${formatSeconds(uc.ttft)}`,
      }),
      meter("SPEED / USER", Math.min(result.streamTps, uc.tps * 3), uc.tps * 3, {
        good: result.streamTps >= uc.tps,
        text: `${Math.round(result.streamTps)} tok/s`,
      }),
      meter("READING PROMPTS", result.prefillShare, 1, {
        good: result.kv || result.prefillShare < 0.35,
        text: `${Math.round(result.prefillShare * 100)}% of GPU time`,
      }),
      meter("ANSWER QUALITY", result.quality, 1, {
        good: result.quality >= 1,
        text: `${Math.round(result.quality * 100)}%`,
      }),
    )
  }
  parts.push(
    meter(`${hall.name.toUpperCase()} POWER`, load.itKW, load.capKW, {
      good: !load.over,
      text: `${(load.itKW / 1000).toFixed(2)} / ${hall.itMW} MW`,
    }),
  )
  if (result.ok) {
    parts.push(
      el("div", { class: "score-box" }, [
        el("div", {}, [el("span", { class: "fine", text: "TOKENS PER MW" }), el("strong", { text: formatTokens(result.tokPerMW) })]),
        el("div", {}, [el("span", { class: "fine", text: "MISSION POINTS" }), el("strong", { class: "pts", text: formatScore(result.points) })]),
        starRow(stars(result), 3),
      ]),
    )
  }
  return el("div", { class: "panel scouter" }, parts)
}

function starRow(count, scale) {
  return el("span", { class: "stars", "aria-label": `${count} of 3 stars` }, [0, 1, 2].map((i) => spriteImg(i < count ? "star" : "starEmpty", scale)))
}

function profBox() {
  const shown = state.tip || { title: "PROF. TOKEN", text: "Tap any card to learn what it does." }
  return el("div", { class: "prof", "aria-live": "polite" }, [
    el("div", { class: "prof-art" }, [spriteImg("prof", 4)]),
    el("div", { class: "prof-bubble" }, [el("b", { text: shown.title }), el("p", { text: shown.text })]),
  ])
}

/* ---------- Floor + run ---------- */

function floorScreen() {
  const plan = evaluatePlan(state.plan)
  const canvas = el("canvas", { class: "floor-canvas", "aria-label": "Your two data halls" })
  const hudList = el("div", { class: "floor-hud" }, plan.deployments.map((item) =>
    el("div", { class: "panel mini-mission" }, [
      spriteImg(item.useCase.icon, 3),
      el("div", {}, [
        el("b", { text: item.useCase.name.toUpperCase() }),
        el("p", { class: "fine", text: `${item.racks}x ${item.platform?.name || "—"} · ${item.data.short}${item.kv ? " + KV" : ""}${item.orca ? " + ORCA" : ""}` }),
      ]),
      el("span", { class: "hall-badge", text: item.hall.id }),
    ]),
  ))
  const runBtn = btn("▶ RUN THE FACTORY", () => startRun(canvas, plan), { kind: "big run", key: "run", disabled: !plan.ok, sound: "start" })
  const view = el("section", { class: "screen floor" }, [
    progress("floor"),
    el("div", { class: "screen-head" }, [
      el("h1", { text: "YOUR AI FACTORY" }),
      el("p", { class: "lede", text: "Everything is racked and cabled. Hit RUN to open the doors to users." }),
    ]),
    el("div", { class: "floor-grid" }, [
      el("div", { class: "crt" }, [canvas]),
      el("div", { class: "floor-side" }, [
        hudList,
        el("div", { class: "panel run-meter", id: "run-meter" }, [
          el("span", { class: "fine", text: "TOKENS SERVED" }),
          el("strong", { id: "run-count", text: "0" }),
        ]),
        runBtn,
        btn("◀ BACK TO BUILD", () => goto("build"), { kind: "ghost", sound: "back" }),
      ]),
    ]),
  ])
  requestAnimationFrame(() => {
    if (state.screen !== "floor") return
    const paint = () => {
      state.floor = createFloor(canvas)
      state.floor.draw(state.plan, plan, { t: 0 })
    }
    document.fonts.load("8px 'Press Start 2P'").then(paint, paint)
  })
  return view
}

function startRun(canvas, plan) {
  if (state.running || !plan.ok || !state.floor) return
  state.running = true
  const runButton = stage.querySelector('[data-key="run"]')
  if (runButton) runButton.disabled = true
  const counter = document.getElementById("run-count")
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const duration = reduced ? 0 : RUN_MS
  const started = performance.now()
  let missSounded = false
  const frame = (now) => {
    const progressValue = duration ? Math.min(1, (now - started) / duration) : 1
    state.floor?.draw(state.plan, plan, { t: (now - started) / 1000, running: true, progress: progressValue })
    if (counter) counter.textContent = formatTokens(plan.goodput * progressValue * 60)
    if (!missSounded && progressValue > 0.4 && plan.deployments.some((item) => !item.slaMet)) {
      missSounded = true
      play("miss")
    }
    if (progressValue < 1) state.runRaf = requestAnimationFrame(frame)
    else finishRun(plan)
  }
  state.runRaf = requestAnimationFrame(frame)
}

function stopRun() {
  cancelAnimationFrame(state.runRaf)
  state.running = false
}

function finishRun(plan) {
  state.running = false
  const before = rankOf(state.league, state.name)
  const prevBest = state.league.find((e) => e.name.toLocaleLowerCase() === state.name.toLocaleLowerCase())?.score ?? null
  const entry = {
    name: state.name,
    score: plan.score,
    at: Date.now(),
    picks: state.plan.picks.slice(),
    summary: plan.deployments.map((d) => `${d.useCase.name}: ${d.racks}x ${d.platform.name}`).join(" | "),
  }
  const leaderBefore = sortLeague(state.league)[0]
  state.league = upsertEntry(state.league, entry)
  saveLeague()
  const rank = rankOf(state.league, state.name)
  state.result = {
    plan,
    rank,
    before,
    prevBest,
    newHigh: !leaderBefore || plan.score > leaderBefore.score,
    personalBest: prevBest == null || plan.score > prevBest,
  }
  play(state.result.newHigh ? "fanfare" : "coin")
  renderHud()
  showResult()
}

/* ---------- Results ---------- */

function showResult() {
  const { plan, rank, newHigh, personalBest, prevBest } = state.result
  const rival = rivalFor(state.league.filter((e) => e.name.toLocaleLowerCase() !== state.name.toLocaleLowerCase()), plan.score)
  const lessonList = [...state.lessons].map((key) => el("li", { text: LESSONS[key] }))
  const rows = plan.deployments.map((item) => {
    const advice = coach(item)
    return el("div", { class: "result-row" }, [
      spriteImg(item.useCase.icon, 3),
      el("div", { class: "rr-main" }, [
        el("b", { text: `${item.useCase.name.toUpperCase()} · HALL ${item.hall.id}` }),
        el("p", { class: "fine", text: `${item.racks}x ${item.platform.name} · ${item.data.short}${item.kv ? " + KV cache" : ""}${item.orca ? " + Orca PT3" : ""}` }),
        el("p", { class: "fine", text: `${formatTokens(item.goodput)} good tok/s · TTFT ${formatSeconds(item.ttft)} · ${formatTokens(item.tokPerMW)} tok/s per MW` }),
        el("p", { class: "tip-line", text: `${advice.title} ${advice.text}` }),
      ]),
      el("div", { class: "rr-score" }, [starRow(stars(item), 2), el("strong", { text: formatScore(item.points) })]),
    ])
  })
  const banner = newHigh
    ? el("p", { class: "banner blink", text: "NEW HIGH SCORE!" })
    : personalBest
      ? el("p", { class: "banner", text: "PERSONAL BEST!" })
      : el("p", { class: "banner dim", text: `YOUR BEST STAYS ${formatScore(prevBest)}` })
  const root = document.getElementById("result")
  root.replaceChildren(
    el("div", { class: "dialog panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "result-title" }, [
      el("div", { class: "result-head" }, [
        spriteImg(newHigh ? "trophy" : "token", 5),
        el("div", {}, [
          el("p", { class: "card-kicker", text: state.name.toUpperCase() }),
          el("h2", { id: "result-title", text: "FACTORY SCORE" }),
          el("p", { class: "big-score", text: formatScore(plan.score) }),
          banner,
        ]),
        el("div", { class: "rank-box" }, [
          el("span", { class: "fine", text: "RANK" }),
          el("strong", { text: ordinal(rank) }),
          el("span", { class: "fine", text: `OF ${state.league.length}` }),
        ]),
      ]),
      el("div", { class: "result-stats" }, [
        statBlock("GOOD TOKENS/S", formatTokens(plan.goodput)),
        statBlock("TOKENS PER MW", formatTokens(plan.tokPerMW)),
        statBlock("JOULES/TOKEN", plan.jPerToken ? plan.jPerToken.toFixed(2) : "—"),
        statBlock("FACILITY POWER", `${(plan.facilityKW / 1000).toFixed(2)} MW`),
      ]),
      el("div", { class: "result-rows" }, rows),
      plan.badges.length ? el("div", { class: "badges" }, plan.badges.map((b) => el("span", { class: "badge", title: b.text, text: b.name.toUpperCase() }))) : null,
      rival ? el("p", { class: "rival", text: `NEXT RIVAL: ${rival.name.toUpperCase()} WITH ${formatScore(rival.score)}. BEAT THEM BY ${formatScore(rival.score - plan.score + 1)}!` }) : el("p", { class: "rival", text: "YOU'RE ON TOP. HOLD THE PRIZE!" }),
      lessonList.length ? el("details", { class: "lessons" }, [el("summary", { text: `LESSONS LEARNED (${lessonList.length})` }), el("ul", {}, lessonList)]) : null,
      el("div", { class: "row end" }, [
        btn("TRY AGAIN", () => {
          closeDialog("result")
          state.tab = 0
          goto("build")
        }, { kind: "ghost", key: "again" }),
        btn("NEXT PLAYER ▶", resetRun, { kind: "big", key: "next-player" }),
      ]),
      el("p", { class: "fine", text: "Game model with rounded public specs and simplified physics. Not a vendor benchmark." }),
    ]),
  )
  root.hidden = false
  root.querySelector('[data-key="next-player"]')?.focus()
  poke()
}

function statBlock(label, value) {
  return el("div", { class: "stat-block" }, [el("span", { class: "fine", text: label }), el("strong", { text: value })])
}

function closeDialog(id) {
  const root = document.getElementById(id)
  root.hidden = true
  root.replaceChildren()
}

/* ---------- Progress ---------- */

function progress(current) {
  const steps = [
    ["missions", "MISSIONS"],
    ["halls", "HALLS"],
    ["build", "BUILD"],
    ["floor", "RUN"],
  ]
  const index = steps.findIndex(([id]) => id === current)
  return el("ol", { class: "progress" }, steps.map(([id, label], i) =>
    el("li", { class: i < index ? "done" : i === index ? "now" : "todo" }, [el("span", { text: `${i + 1}` }), label]),
  ))
}

/* ---------- Staff tools ---------- */

function openStaff() {
  state.staffUnlocked = false
  state.clearArmed = false
  state.pinError = ""
  renderStaff()
  document.getElementById("staff").hidden = false
}

function renderStaff() {
  const root = document.getElementById("staff")
  const leader = sortLeague(state.league)[0]
  const body = state.staffUnlocked
    ? [
        el("p", { text: leader ? `${leader.name} leads with ${formatScore(leader.score)}.` : "The league is empty." }),
        el("div", { class: "row" }, [
          btn("DOWNLOAD LEAGUE", downloadLeague, { key: "dl" }),
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

function downloadLeague() {
  const blob = new Blob([JSON.stringify(sortLeague(state.league), null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "token-quest-league.json"
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
  if (state.screen === "title" || !document.getElementById("staff").hidden) return
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

const muteBtn = document.getElementById("mute")
muteBtn.addEventListener("click", () => {
  setMuted(!isMuted())
  muteBtn.textContent = isMuted() ? "SOUND OFF" : "SOUND ON"
  muteBtn.setAttribute("aria-pressed", isMuted() ? "true" : "false")
  play("blip")
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

goto("title")
