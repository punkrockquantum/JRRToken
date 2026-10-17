import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"

/**
 * Plays Token Quest in headless Chrome as a phone (390×844, 430×932) and a portrait iPad
 * (820×1180): mobile emulation, touch, an iOS user agent, device pixel ratio 3 (2 on the iPad).
 * Title → intro → stories → every build step → review → GO → results → IMPROVE IT → final
 * results → league, in simple and nerd mode, with the same data-keys as scripts/smoke.mjs.
 *
 * Every screen passes the mobile audit: the page is never wider than the screen, every tap target
 * is 44×44 or more, the step's main action (NEXT or GO) is inside the viewport at the top, the
 * middle and the bottom of the page (the sticky bar), labels are 12px and body text 14px or more,
 * tiles and cards never overlap or spill out of their parents, and the "?" popover fits the screen.
 *
 *   SHOTS=.shots node scripts/smoke-mobile.mjs                screenshots to .shots/mobile-<vp>-<screen>.png
 *   VIEWPORTS=390x844 GAME_URL=http://127.0.0.1:8092/ node scripts/smoke-mobile.mjs
 */
const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const base = process.env.GAME_URL || "http://127.0.0.1:8080/"
const shots = process.env.SHOTS || ""
const port = Number(process.env.CDP_PORT || 9334)
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
const DEVICES = {
  "390x844": { dpr: 3, ua: IPHONE_UA, platform: "iPhone" },
  "430x932": { dpr: 3, ua: IPHONE_UA, platform: "iPhone" },
  "820x1180": { dpr: 2, ua: IPAD_UA, platform: "iPad" },
}
const VIEWPORTS = (process.env.VIEWPORTS || "390x844,430x932,820x1180").split(",").map((tag) => {
  const [width, height] = tag.split("x").map(Number)
  const device = DEVICES[tag] || { dpr: width >= 700 ? 2 : 3, ua: width >= 700 ? IPAD_UA : IPHONE_UA, platform: width >= 700 ? "iPad" : "iPhone" }
  return { tag, width, height, ...device }
})
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--autoplay-policy=no-user-gesture-required", `--remote-debugging-port=${port}`, "--window-size=1000,1400", "about:blank"], { stdio: "ignore" })

const BUILD_STEPS = ["model", "location", "gpu", "cooling", "memory", "wires", "storage", "qpu"]
/** The sentences a phone shows at 14px; everything else that carries text is a label and may be 12px. */
const BODY = ".caption p, .pitch, .tagline, .consent-copy, .tile-title, .story-card span, .coach p, .headline, .people-lead, .savings-line, .explain li, .right-try li, .learn-pop p, .toast, .ww-job, .ww-needs li, .imp-why, .step-head .fine, .share, .review-row strong, .sc-who h1, .beat-line"

/**
 * The mobile layout audit. (1) the document is never wider than the screen; (2) every visible
 * button, tile, card, rail step and "?" is at least 44×44 CSS px (an invisible ::after halo counts);
 * (3) visible text is 12px or more, and the body sentences 14px or more; (4) sibling tiles, cards,
 * lights, rail steps, gauges, chips or review rows never intersect, nor do the ecosystem names;
 * (5) nothing spills more than 2px out of its parent (positioned elements and the contents of a
 * scrolling strip excepted); (6) nothing sits beyond the left or right edge of the screen; (7) label
 * text never overflows without an ellipsis; (8) a tile or button fully on screen is not covered by
 * anything other than a pinned action bar (the step's, the review's, the sheet's) or the open popover.
 */
const AUDIT = `(() => {
  const out = []
  const BODY = ${JSON.stringify(BODY)}
  const vw = innerWidth
  const vh = innerHeight
  const root = document.scrollingElement
  if (root.scrollWidth > vw + 1) out.push('(1) page is ' + root.scrollWidth + 'px wide on a ' + vw + 'px screen')
  const resultOpen = !document.getElementById('result').hidden
  const scope = resultOpen ? document.getElementById('result') : document.getElementById('app')
  const pop = document.querySelector('.learn-pop')
  const inScope = (el) => scope.contains(el) || Boolean(pop && pop.contains(el))
  const visible = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const name = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.dataset && el.dataset.key ? '[' + el.dataset.key + ']' : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''))
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
  const fmt = (r) => Math.round(r.l) + ',' + Math.round(r.t) + ' ' + Math.round(r.w) + 'x' + Math.round(r.h)
  const scrollsX = (el) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 }
  const scrollsY = (el) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 }
  const inStrip = (el) => { let p = el.parentElement; while (p && p !== document.body) { if (scrollsX(p)) return true; p = p.parentElement } return false }
  const all = [...document.querySelectorAll('#app *, #result *, .learn-pop, .learn-pop *')].filter((el) => inScope(el) && visible(el))
  /* (2) tap targets */
  for (const el of all) {
    if (!el.matches('button, .tile, .story-card, .rail-btn, .learn-btn') || el.disabled || el.closest('.sr-only')) continue
    const r = rect(el)
    const halo = getComputedStyle(el, '::after')
    const extra = halo.position === 'absolute' && halo.content !== 'none' ? -2 * parseFloat(halo.top) : 0
    if (r.w + extra < 43.5 || r.h + extra < 43.5) out.push('(2) ' + name(el) + ' ' + fmt(r) + ' tap target under 44px')
  }
  /* (3) type floors */
  for (const el of all) {
    if (el.closest('.sr-only, canvas')) continue
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    const floor = el.matches(BODY) || el.closest(BODY) ? 14 : 12
    if (fs < floor - 0.01) out.push('(3) ' + name(el) + ' font ' + fs + 'px (floor ' + floor + '): ' + el.textContent.trim().slice(0, 30))
  }
  /* (4) sibling overlaps */
  const groups = new Map()
  for (const el of all) { if (!el.matches('.tile-wrap, .tile, .story-card, .eco-part, .rail-step, .meter, .review-row, .sc-fact, .ra-wrap, .imp-chip, .ww-chip, .stat-block, .result-row, .right-try > div, .scene-dots .dot, .step-nav .btn, .review-go .btn, .row.end .btn')) continue; const p = el.parentElement; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(el) }
  for (const bar of document.querySelectorAll('.eco-bar')) { const labels = [...bar.querySelectorAll('.eco-part b')].filter((el) => inScope(el) && visible(el)); if (labels.length) groups.set(bar, labels) }
  for (const list of groups.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const a = rect(list[i]), b = rect(list[j]); if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) out.push('(4) ' + name(list[i]) + ' ' + fmt(a) + ' overlaps sibling ' + name(list[j]) + ' ' + fmt(b)) }
  /* (5) spills out of the parent, (6) beyond the screen */
  const boxes = '.tile, .tile-wrap, .tile-copy, .tile-title, .tile-hint, .tile-rows, .impact, .story-card, .story-card *, .eco-part, .eco-light, .eco-part img, .rail-btn, .btn, .sc-fact, .sc-who, .sc-places, .sc-place, .meter, .coach, .coach p, .crowd, .review-row, .review-row *, .scenario, .feel, .step-nav, .review-go, .caption, .caption *, .crt, .intro-canvas, .scene-dots, .story-cards, .tiles, .who-where, .ww-chip, .ww-job, .ww-needs, .ra-card, .ra-card *, .learn-pop *, .result-head, .result-head *, .result-body, .result-body > *, .people-card, .people-card *, .right-try, .right-try *, .explain, .explain *, .row.end, .dr-footer, .title-card, .title-card *, .top *, .hud-item, .league li, .league li *, .enter *, .target, .target *, .round-badge, .people-badge, .people-badge *, .think *'
  for (const el of all) {
    if (!el.matches(boxes)) continue
    const a = rect(el)
    if (!inStrip(el) && (a.l < -1 || a.r > vw + 1)) out.push('(6) ' + name(el) + ' ' + fmt(a) + ' beyond the screen edge')
    const p = el.parentElement
    if (!p || p === document.body || p === document.documentElement) continue
    const cs = getComputedStyle(el)
    if (cs.position === 'absolute' || cs.position === 'fixed' || cs.transform !== 'none') {
      if (el.matches('.eco-part b')) { const bar = rect(el.closest('.eco-bar')); const over = Math.max(bar.l - a.l, a.r - bar.r, a.b - bar.b); if (over > 2) out.push('(5) ' + name(el) + ' ' + fmt(a) + ' spills out of the ecosystem bar by ' + Math.round(over) + 'px') }
      continue
    }
    if (getComputedStyle(p).display === 'contents' || inStrip(el)) continue
    const b = rect(p)
    const sideways = Math.max(b.l - a.l, a.r - b.r)
    const over = scrollsY(p) ? sideways : Math.max(sideways, b.t - a.t, a.b - b.b)
    if (over > 2) out.push('(5) ' + name(el) + ' ' + fmt(a) + ' spills out of ' + name(p) + ' ' + fmt(b) + ' by ' + Math.round(over) + 'px')
  }
  /* (7) text that overflows without a clip */
  for (const el of all) {
    if (!el.matches('.tile-title, .tile-hint, .tile-tag, .eco-part b, .rail-name, .coach p, .sc-place, .sc-fact strong, .sc-fact .fine, .review-row strong, .meter-top span, .story-card strong, .story-card span, .btn, .hud-item, .ww-chip strong, .ww-chip .fine, .imp-value, .imp-label, .ra-line, .ra-form, .caption b, .caption p, .headline, .explain li')) continue
    const cs = getComputedStyle(el)
    if ((el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) && cs.overflow !== 'hidden' && cs.overflowY !== 'hidden' && cs.textOverflow !== 'ellipsis') out.push('(7) ' + name(el) + ' text overflows ' + (el.scrollWidth - el.clientWidth) + 'x' + (el.scrollHeight - el.clientHeight) + 'px: ' + el.textContent.trim().slice(0, 40))
  }
  /* (8) covered tap targets */
  for (const el of all) {
    if (!el.matches('.tile, .story-card, .rail-btn, .btn, .learn-btn') || el.disabled) continue
    const r = rect(el)
    if (r.t < 0 || r.b > vh || r.l < 0 || r.r > vw) continue
    const hit = document.elementFromPoint(r.l + r.w / 2, r.t + r.h / 2)
    if (!hit || hit === el || el.contains(hit)) continue
    if (hit.closest('.step-nav, .review-go, .row.end, .learn-pop')) continue
    out.push('(8) ' + name(el) + ' ' + fmt(r) + ' covered by ' + name(hit))
  }
  return [...new Set(out)].join(' | ')
})()`

/** Where one element sits against the viewport: '' when fully inside, else its top..bottom. */
const inView = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return 'missing'
  const r = el.getBoundingClientRect()
  if (!(r.width > 0 && r.height > 0)) return 'has no size'
  return r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1 ? '' : 'at ' + Math.round(r.left) + ',' + Math.round(r.top) + '..' + Math.round(r.right) + ',' + Math.round(r.bottom) + ' on ' + innerWidth + 'x' + innerHeight
})()`

let ws
const errors = []
try {
  const target = await waitForTarget()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true })
    ws.addEventListener("error", reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data)
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map((a) => a.value ?? a.description).join(" "))
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const messageId = ++id
      pending.set(messageId, resolve)
      ws.send(JSON.stringify({ id: messageId, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description || "Page script failed")
    return result.result?.result?.value
  }
  const waitFor = async (expression, label) => {
    for (let i = 0; i < 120; i += 1) {
      if (await evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`Timed out waiting for ${label}`)
  }
  const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ${selector}'); el.click(); return true })()`)
  const text = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)}) || { innerText: '' }).innerText`)
  const has = (selector) => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)

  await send("Page.enable")
  await send("Runtime.enable")

  for (const { tag, width, height, dpr, ua, platform } of VIEWPORTS) {
    let audited = 0
    const shot = async (name, { full = false } = {}) => {
      if (!shots) return
      await sleep(250)
      const params = { format: "png" }
      if (full) {
        const pageHeight = await evaluate(`Math.min(document.documentElement.scrollHeight, 6000)`)
        Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: pageHeight, scale: 1 } })
      }
      const { result } = await send("Page.captureScreenshot", params)
      mkdirSync(shots, { recursive: true })
      writeFileSync(`${shots}/mobile-${tag}-${name}${full ? "-full" : ""}.png`, Buffer.from(result.data, "base64"))
    }
    /** The gate every screen passes: fonts loaded, then the audit returns nothing. */
    const layout = async (label) => {
      await sleep(150)
      await evaluate(`document.fonts.ready.then(() => true)`)
      const problems = await evaluate(AUDIT)
      if (problems) throw new Error(`${tag} ${label}: ${problems}`)
      audited += 1
    }
    /** The step's main action stays inside the viewport at the top, the middle and the bottom of the page. */
    const pinned = async (label, selector) => {
      const scrollHeight = await evaluate(`document.documentElement.scrollHeight`)
      for (const y of [0, Math.round(scrollHeight / 2), scrollHeight]) {
        await evaluate(`scrollTo(0, ${y})`)
        await sleep(80)
        const where = await evaluate(inView(selector))
        if (where) throw new Error(`${tag} ${label}: ${selector} is not inside the viewport with the page scrolled to ${y}: ${where}`)
        const disabled = await evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled`)
        if (disabled) throw new Error(`${tag} ${label}: ${selector} is disabled`)
      }
      await evaluate(`scrollTo(0, 0)`)
      await sleep(80)
    }
    const nerdOn = () => evaluate(`document.getElementById('nerd-bar').getAttribute('aria-pressed') === 'true'`)
    const setNerd = async (on) => {
      if ((await nerdOn()) !== on) {
        await click("#nerd-bar")
        await sleep(250)
      }
    }
    /** Audit a screen in simple mode, then nerd mode, then back to simple. */
    const bothModes = async (label, primary = null, { full = false } = {}) => {
      await setNerd(false)
      await layout(`${label} simple`)
      if (primary) await pinned(`${label} simple`, primary)
      await shot(`${label}-simple`)
      if (full) await shot(`${label}-simple`, { full: true })
      await setNerd(true)
      await layout(`${label} nerd`)
      if (primary) await pinned(`${label} nerd`, primary)
      await shot(`${label}-nerd`)
      await setNerd(false)
    }

    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: true, screenWidth: width, screenHeight: height })
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
    await send("Emulation.setUserAgentOverride", { userAgent: ua, platform })
    await send("Page.navigate", { url: base })
    await waitFor(`!!document.querySelector('#player-name')`, "title screen")
    await evaluate(`localStorage.clear()`)
    await send("Page.navigate", { url: base })
    await waitFor(`!!document.querySelector('#player-name')`, "title screen")
    const mobileSheet = await evaluate(`[...document.styleSheets].some((sheet) => (sheet.href || '').includes('mobile.css') && sheet.media.mediaText && matchMedia(sheet.media.mediaText).matches)`)
    if (!mobileSheet) throw new Error(`${tag}: css/mobile.css is not applied at this size`)
    const scrollable = await evaluate(`getComputedStyle(document.body).overflow + '|' + getComputedStyle(document.getElementById('app')).overflow`)
    if (scrollable !== "visible|visible") throw new Error(`${tag}: the page should scroll on a phone, saw overflow ${scrollable}`)

    /* ---------- Title ---------- */
    await layout("title")
    const inputPx = await evaluate(`parseFloat(getComputedStyle(document.querySelector('#player-name')).fontSize)`)
    if (inputPx < 16) throw new Error(`${tag}: inputs must be 16px or more so iOS does not zoom on focus, saw ${inputPx}`)
    await evaluate(`document.querySelector('#player-name').value = 'Ada Lovelace'; document.querySelector('#player-name').dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#player-email').value = 'ada@example.com'; document.querySelector('#player-email').dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#player-consent').checked = true; document.querySelector('#player-consent').dispatchEvent(new Event('change', { bubbles: true }))`)
    if (!(await evaluate(`!document.querySelector('#start-btn').disabled`))) throw new Error("START should enable after a valid name, email, and consent")
    await shot("1-title")
    await shot("1-title", { full: true })
    await evaluate(`document.querySelector('#enter-form').requestSubmit()`)

    /* ---------- Intro ---------- */
    await waitFor(`!!document.querySelector('.intro-canvas')`, "intro")
    await waitFor(`!!document.querySelector('.scene-dots .dot[aria-current="true"]')`, "intro started")
    await sleep(1200)
    const canvasFit = await evaluate(`(() => { const c = document.querySelector('.intro-canvas').getBoundingClientRect(); const host = document.querySelector('.intro .crt').getBoundingClientRect(); return { w: c.width, h: c.height, host: host.width, ratio: c.width / c.height } })()`)
    if (canvasFit.w < canvasFit.host - 2 || Math.abs(canvasFit.ratio - 16 / 9) > 0.02) throw new Error(`${tag}: the intro canvas should fill its frame at 16:9, saw ${JSON.stringify(canvasFit)}`)
    await layout("intro scene 1")
    await pinned("intro scene 1", '[data-key="intro-continue"]')
    await shot("2-intro-1")
    await click('[data-key="intro-continue"]')
    await sleep(2500)
    await layout("intro scene 2")
    await shot("2-intro-ecosystem")
    await click("#nerd-bar")
    await waitFor(`document.querySelectorAll('.scene-dots button').length === 6`, "six nerd scenes")
    await sleep(400)
    await layout("intro nerd")
    await shot("2-intro-nerd")
    await click("#nerd-bar")
    await waitFor(`document.querySelectorAll('.scene-dots button').length === 4`, "four booth scenes again")
    await sleep(450)
    for (let i = 2; i < 4; i += 1) {
      await click('[data-key="intro-continue"]')
      await sleep(600)
      await layout(`intro scene ${i + 1}`)
    }
    const last = await evaluate(`document.querySelector('[data-key="intro-continue"]').textContent`)
    if (!/START THE QUEST/.test(last)) throw new Error(`Last scene button: ${last}`)
    await shot("2-intro-last")
    await click('[data-key="intro-continue"]')

    /* ---------- Stories ---------- */
    await waitFor(`!!document.querySelector('[data-key="usecase-chat"]')`, "use-case screen")
    await bothModes("3-stories")
    await click('[data-key="more-stories"]')
    await waitFor(`document.querySelectorAll('.story-card').length === 6`, "all six jobs")
    await bothModes("3-stories-more")
    await click('[data-key="usecase-chat"]')

    /* ---------- Build: one step at a time, NEXT pinned to the bottom ---------- */
    await waitFor(`!!document.querySelector('[data-key="step-panel"]')`, "game screen")
    const picks = { model: ["model-70b", "users-large"], location: ["location-lon", "location-fra"], gpu: ["gpu-gb200"], cooling: ["cooling-super"], memory: ["memory-on"], wires: ["wires-fast"], storage: ["storage-none"], qpu: [] }
    for (const step of BUILD_STEPS) {
      await click(`[data-key="step-${step}"]`)
      await waitFor(`document.querySelector('[data-key="step-panel"]').classList.contains('step-${step}')`, `${step} step`)
      await bothModes(`4-step-${step}`, '[data-key="next"]', { full: step === "model" || step === "gpu" || step === "wires" })
      /* The current step's button stays inside the strip. */
      const railCurrent = await evaluate(inView(".rail-step.current .rail-btn"))
      if (railCurrent) throw new Error(`${tag} ${step}: the current step is not visible on the rail: ${railCurrent}`)
      if (step === "gpu") {
        /* The "?" opens a popover that fits the screen, with a finger-sized CLOSE. */
        await click(".step-panel .learn-btn")
        await waitFor(`!!document.querySelector('.learn-pop')`, "learn popover")
        const popWhere = await evaluate(inView(".learn-pop"))
        if (popWhere) throw new Error(`${tag} ${step}: the learn popover is off screen: ${popWhere}`)
        const popWidth = await evaluate(`document.querySelector('.learn-pop').getBoundingClientRect().width / innerWidth`)
        if (popWidth > 0.921) throw new Error(`${tag} ${step}: the learn popover is wider than 92vw (${Math.round(popWidth * 100)}%)`)
        await layout(`${step} learn popover`)
        await shot(`4-step-${step}-learn`)
        await click(".learn-pop .learn-close")
        await waitFor(`!document.querySelector('.learn-pop')`, "popover closed")
      }
      for (const key of picks[step]) {
        const pressed = await evaluate(`document.querySelector('[data-key="${key}"]')?.getAttribute('aria-pressed')`)
        if (pressed !== "true") {
          await click(`[data-key="${key}"]`)
          await sleep(120)
          /* The two-second reason floats inside the viewport, above the action bar. */
          const toastWhere = await evaluate(inView("#toast"))
          if (toastWhere && toastWhere !== "missing") throw new Error(`${tag} ${step}: the toast is off screen: ${toastWhere}`)
        }
        await sleep(120)
      }
      await waitFor(`!document.querySelector('[data-key="next"]').disabled`, "next enabled")
    }
    const chosen = await evaluate(`[...document.querySelectorAll('.step-panel .tile[aria-pressed="true"]')].map((t) => t.dataset.key).join(',')`)
    console.log(`picks ${tag}: ${chosen || "(qpu has no choice)"}`)

    /* ---------- Review and GO ---------- */
    await click('[data-key="step-review"]')
    await waitFor(`!!document.querySelector('[data-key="run"]')`, "review")
    const review = await text('[data-key="step-panel"]')
    for (const part of ["London + Frankfurt", "NVIDIA GB200 NVL72", "ServiceFabric"]) if (!review.includes(part)) throw new Error(`Review lacks ${part}: ${review}`)
    await bothModes("5-review", '[data-key="run"]', { full: true })
    await click('[data-key="run"]')
    await waitFor(`!document.getElementById('run-overlay').hidden && document.getElementById('run-count').textContent !== '0'`, "run overlay")
    await sleep(800)
    const floorWhere = await evaluate(inView("#floor-canvas"))
    if (floorWhere) throw new Error(`${tag}: the factory floor is off screen while it runs: ${floorWhere}`)
    await shot("6-running")
    await waitFor(`!document.getElementById('result').hidden`, "results")

    /* ---------- Results: a full-screen sheet that scrolls as one ---------- */
    const sheet = async (label, lastButton) => {
      /* The sheet opens on the score (the focused button is pinned, so focusing it scrolls nothing). */
      const scoreWhere = await evaluate(inView(".big-score"))
      if (scoreWhere) throw new Error(`${tag} ${label}: the sheet should open on the score: .big-score ${scoreWhere}`)
      await bothModes(label)
      const sheetWidth = await evaluate(`document.getElementById('result').scrollWidth <= innerWidth + 1`)
      if (!sheetWidth) throw new Error(`${tag} ${label}: the results sheet is wider than the screen`)
      await evaluate(`document.getElementById('result').scrollTop = 1e6`)
      await sleep(150)
      const where = await evaluate(inView(lastButton))
      if (where) throw new Error(`${tag} ${label}: ${lastButton} is not reachable at the end of the sheet: ${where}`)
      await layout(`${label} end`)
      await shot(`${label}-end`)
      await evaluate(`document.getElementById('result').scrollTop = 0`)
    }
    await sheet("7-results-round-1", '[data-key="next-player"]')
    const score = await evaluate(`document.querySelector('.big-score').textContent`)
    if (!(Number(String(score).replace(/,/g, "")) >= 1350)) throw new Error(`A thoughtful shopper build should score near 1,400 after GO, saw ${score}`)
    if (!(await has('[data-key="improve"]'))) throw new Error("Round one should offer IMPROVE IT")

    /* ---------- Round two: IMPROVE IT, the public internet, GO, the final sheet, the league ---------- */
    await click('[data-key="improve"]')
    await waitFor(`document.getElementById('result').hidden && !!document.querySelector('[data-key="step-panel"]')`, "round two")
    await click('[data-key="step-wires"]')
    await waitFor(`document.querySelector('[data-key="step-panel"]').classList.contains('step-wires')`, "wires step")
    await click('[data-key="wires-cheap"]')
    await sleep(150)
    await bothModes("8-round-2-wires", '[data-key="next"]')
    await click('[data-key="step-review"]')
    await waitFor(`!!document.querySelector('[data-key="run"]')`, "review two")
    await click('[data-key="run"]')
    await waitFor(`!document.getElementById('result').hidden`, "final results")
    await sheet("9-results-final", '[data-key="next-player"]')
    const finalText = await text("#result")
    for (const part of ["FINAL SCORE", "WHAT TO TRY", "PLAY AGAIN", "NEXT PLAYER"]) if (!finalText.includes(part)) throw new Error(`Final results lack ${part}`)
    await click('[data-key="next-player"]')
    await waitFor(`!!document.querySelector('.league li')`, "league row")
    await layout("league")
    await shot("10-league")
    const board = await evaluate(`document.querySelector('.league').innerText`)
    if (!board.includes("ADA LOVELACE")) throw new Error(`League missed the player: ${board}`)
    if (errors.length) throw new Error(`Page errors: ${errors.join(" | ")}`)
    console.log(`mobile smoke ok ${tag}: score ${score}, ${audited} screens passed the mobile audit`)
  }
  await evaluate(`localStorage.clear()`)
} finally {
  ws?.close()
  browser.kill()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForTarget() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`)
      const page = (await response.json()).find((item) => item.type === "page")
      if (page) return page
    } catch {
      /* Chrome is still starting. */
    }
    await sleep(150)
  }
  throw new Error("Chrome did not open a debugging port")
}
