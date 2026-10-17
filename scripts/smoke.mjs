import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Walks the booth flow in headless Chrome at the kiosk viewports and the two iPad landscape
 * sizes, in simple and nerd mode: title → intro → stories → every build step → review → GO →
 * results → IMPROVE IT → results → league. Every screen passes a layout audit (nothing scrolls,
 * overlaps, spills or covers a tile; every control is finger-sized; tile text stays readable)
 * and, when the booth server is up, the sync line, the workbook and the staff reset are checked.
 *
 *   SHOTS=.shots node scripts/smoke.mjs      screenshots per screen
 *   VIEWPORTS=1600x1000 node scripts/smoke.mjs
 */
const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const base = process.env.GAME_URL || "http://127.0.0.1:8080/"
const shots = process.env.SHOTS || ""
const port = 9333
const VIEWPORTS = (process.env.VIEWPORTS || "1920x1080,1600x1000,1180x820,1024x768").split(",").map((v) => v.split("x").map(Number))
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--autoplay-policy=no-user-gesture-required", `--remote-debugging-port=${port}`, "--window-size=1920,1080", "about:blank"], { stdio: "ignore" })

const SIMPLE_COPY = [
  "You ask. The AI reads your words as tokens and writes the answer one token at a time.",
  "Every AI answer is born in a data center: power feeds it, cooling keeps it alive, GPUs think, data gives it something to know, and connections carry the answer to you.",
  "Take any one away and the AI stops: no power, no maths; no cooling, no GPUs; no data, nothing to know; no connection, no answer.",
  "Closer, cooler and better connected means faster answers for less money. Build the best AI factory you can afford!",
]
const BUILD_STEPS = ["model", "location", "gpu", "cooling", "memory", "wires", "storage", "qpu"]

/** Fails if the page scrolls, a panel clips its content, or a control sits outside the viewport. */
const FITS = `(() => {
  const problems = []
  const root = document.scrollingElement
  if (root.scrollHeight > innerHeight + 1 || root.scrollWidth > innerWidth + 1) problems.push('page scrolls ' + root.scrollWidth + 'x' + root.scrollHeight)
  const stage = document.getElementById('stage')
  if (stage.scrollHeight > stage.clientHeight + 1) problems.push('stage scrolls by ' + (stage.scrollHeight - stage.clientHeight) + 'px')
  const resultOpen = document.getElementById('result').hidden === false
  for (const box of document.querySelectorAll('.screen, .title-screen, .title-card, .intro, .step-panel, .side, .story, .story-cards, #result:not([hidden]) .dialog')) {
    if (resultOpen && !box.closest('#result')) continue
    if (box.scrollHeight > box.clientHeight + 2) problems.push((box.className || box.id) + ' clips ' + (box.scrollHeight - box.clientHeight) + 'px')
  }
  const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
  for (const el of document.querySelectorAll('[data-key], button, input, canvas, a')) {
    if (!visible(el)) continue
    if (resultOpen && !el.closest('#result')) continue
    if (el.closest('.result-body')) continue /* the one scroll container on the results */
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1) problems.push((el.dataset.key || el.id || el.tagName) + ' at ' + Math.round(r.top) + '..' + Math.round(r.bottom))
  }
  return problems.join('; ')
})()`

/**
 * The overlap audit. (a) sibling tiles, cards, lights, rail steps, gauges or review rows whose
 * boxes intersect; (b) an element spilling more than 2px outside its parent (absolutely
 * positioned or animated elements and content inside the one scroll container excepted);
 * (c) anything outside the viewport; (d) a tile or button whose centre is covered by something
 * else; (e) tile or label text that overflows without a clip; (f) a panel that scrolls;
 * (g) a tap target under 44×44 CSS px (an invisible ::after halo counts); (h) tile or story text
 * under 12px, anything else under 9px of the pixel font.
 */
const OVERLAP = `(() => {
  const sel = '.tile, .panel, .gauge, .eco-bar *, .rail-step, .step-panel, .story-card, .scouter, .coach, #result:not([hidden]) *, .side *, button, .map-wrap, .review-row, .target, .scenario *'
  const visible = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const name = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.dataset && el.dataset.key ? '[' + el.dataset.key + ']' : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''))
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
  const fmt = (r) => Math.round(r.l) + ',' + Math.round(r.t) + ' ' + Math.round(r.w) + 'x' + Math.round(r.h)
  const out = []
  const resultOpen = !document.getElementById('result').hidden
  const els = [...document.querySelectorAll(sel)].filter(visible).filter((el) => !resultOpen || el.closest('#result'))
  const groups = new Map()
  for (const el of els) { if (!el.matches('.tile, .story-card, .eco-part, .rail-step, .gauge, .review-row, .sc-fact')) continue; const p = el.parentElement; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(el) }
  for (const list of groups.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const a = rect(list[i]), b = rect(list[j]); if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) out.push('(a) ' + name(list[i]) + ' ' + fmt(a) + ' overlaps sibling ' + name(list[j]) + ' ' + fmt(b)) }
  const scrolls = (el) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 }
  const scrolledContent = (el) => { let p = el.parentElement; while (p && p !== document.body) { if (scrolls(p)) { const a = rect(el), b = rect(p); return a.l >= b.l - 1 && a.r <= b.r + 1 } p = p.parentElement } return false }
  for (const el of els) {
    const p = el.parentElement
    if (!p || p === document.body || p === document.documentElement) continue
    const cs = getComputedStyle(el)
    if (cs.position === 'absolute' || cs.position === 'fixed' || cs.transform !== 'none') continue
    if (getComputedStyle(p).display === 'contents') continue
    const a = rect(el), b = rect(p)
    const sideways = Math.max(b.l - a.l, a.r - b.r)
    const over = scrolls(p) ? sideways : Math.max(sideways, b.t - a.t, a.b - b.b)
    if (over > 2 && !(scrolledContent(el) && sideways <= 2)) out.push('(b) ' + name(el) + ' ' + fmt(a) + ' exceeds parent ' + name(p) + ' ' + fmt(b) + ' by ' + Math.round(over) + 'px')
  }
  for (const el of els) { const a = rect(el); if (scrolledContent(el)) continue; if (a.l < -1 || a.t < -1 || a.r > innerWidth + 1 || a.b > innerHeight + 1) out.push('(c) ' + name(el) + ' ' + fmt(a) + ' beyond viewport') }
  for (const el of els) { if (!el.matches('.tile, .story-card, .rail-btn, .btn')) continue; if (el.disabled || scrolledContent(el)) continue; const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (!hit || !(hit === el || el.contains(hit))) out.push('(d) ' + name(el) + ' ' + fmt(rect(el)) + ' covered by ' + (hit ? name(hit) : 'nothing')) }
  for (const el of document.querySelectorAll('.tile .tile-title, .tile .tile-hint, .eco-part b, .rail-name, .coach p, .sc-place, .sc-fact strong, .review-row strong, .gauge *')) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    if ((el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) && cs.overflow !== 'hidden' && cs.overflowY !== 'hidden' && cs.textOverflow !== 'ellipsis') out.push('(e) ' + name(el) + ' text overflows ' + (el.scrollWidth - el.clientWidth) + 'x' + (el.scrollHeight - el.clientHeight) + 'px: ' + el.textContent.trim().slice(0, 40))
  }
  for (const box of document.querySelectorAll('.step-panel, .side, .screen, #result:not([hidden]) .dialog')) if (visible(box) && (!resultOpen || box.closest('#result')) && box.scrollHeight > box.clientHeight + 2) out.push('(f) ' + name(box) + ' scrolls by ' + (box.scrollHeight - box.clientHeight) + 'px')
  for (const el of document.querySelectorAll('button, .tile, .story-card')) { if (!visible(el) || el.disabled || el.closest('.sr-only')) continue; if (resultOpen && !el.closest('#result')) continue; const r = rect(el); const halo = getComputedStyle(el, '::after'); const extra = halo.position === 'absolute' && halo.content !== 'none' ? -2 * parseFloat(halo.top) : 0; if (r.w + extra < 44 || r.h + extra < 44) out.push('(g) ' + name(el) + ' ' + fmt(r) + ' tap target under 44px') }
  for (const el of document.querySelectorAll('.tile *, .eco-part *, .rail-step *, .coach *, .meter *, .review-row *, .sc-fact *, .map-wrap figcaption *, .btn, .story-card *')) { if (!visible(el) || !el.textContent.trim() || el.children.length) continue; const fs = parseFloat(getComputedStyle(el).fontSize); const floor = el.matches('.tile-title, .tile-hint, .story-card strong, .story-card span') ? 12 : 9; if (fs < floor) out.push('(h) ' + name(el) + ' font ' + fs + 'px (floor ' + floor + '): ' + el.textContent.trim().slice(0, 30)) }
  return [...new Set(out)].join(' | ')
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

  let booth = false
  let boothKnown = false
  let boothChecked = false
  let lastAttempt = 0

  const readSyncLine = async (label) => {
    if (booth) await waitFor(`/^ATTEMPT \\d+ · BEST .+ · RANK \\d+ OF \\d+$/.test(document.querySelector('[data-key="sync-line"]').textContent)`, `server sync line (${label})`)
    const line = await evaluate(`document.querySelector('[data-key="sync-line"]').textContent`)
    if (/@/.test(line)) throw new Error(`Sync line showed an email: ${line}`)
    return line
  }
  const noteAttempt = (line, label) => {
    const match = /^ATTEMPT (\d+) · BEST .+ · RANK \d+ OF \d+$/.exec(line)
    if (!match) throw new Error(`Server results line (${label}): ${line}`)
    const attempt = Number(match[1])
    if (lastAttempt && attempt !== lastAttempt + 1) throw new Error(`Attempts should increment by one, saw ${lastAttempt} then ${attempt} (${line})`)
    lastAttempt = attempt
    console.log(`sync ${label}: ${line}`)
    return attempt
  }
  const assertBoothWorkbook = async () => {
    const league = await evaluate(`fetch('/api/league', { cache: 'no-store' }).then((res) => res.json())`)
    const player = (league.players || []).find((item) => item.name === "Ada Lovelace")
    if (!player || player.attempts !== 2) throw new Error(`League should show Ada with 2 attempts: ${JSON.stringify(league)}`)
    if ("email" in player || JSON.stringify(league).includes("@")) throw new Error(`League JSON included an email: ${JSON.stringify(league)}`)
    console.log(`league: ${JSON.stringify({ name: player.name, attempts: player.attempts, best: player.best, rank: player.rank, latest: player.latest })}`)
    const exportPath = process.env.EXPORT_PATH
    const dataDir = process.env.DATA_DIR
    if (!exportPath || !dataDir) throw new Error("EXPORT_PATH and DATA_DIR are required while the booth server is up")
    let info = null
    for (let i = 0; i < 25; i += 1) {
      if (existsSync(exportPath)) {
        info = workbookInfo(exportPath)
        if (info.hasName && info.hasEmail && info.data2 >= 2) break
      }
      await sleep(200)
    }
    if (!info?.hasName || !info.hasEmail) throw new Error(`Workbook is missing the player: ${exportPath} ${JSON.stringify(info)}`)
    if (info.data2 !== 2) throw new Error(`Sheet2 should hold two attempt rows, saw ${info.data2} data rows (${info.rows2} XML rows)`)
    console.log(`xlsx: ${exportPath} sheet1 ${info.rows1} XML rows, sheet2 ${info.rows2} XML rows (${info.data2} attempts)`)
  }
  const resetBooth = async () => {
    for (let i = 0; i < 5; i += 1) await click("#logo")
    await waitFor(`!document.getElementById('staff').hidden`, "staff dialog")
    await evaluate(`document.querySelector('#staff-pin').value = '8462'; [...document.querySelectorAll('#staff button')].find((b) => b.textContent === 'UNLOCK').click()`)
    await waitFor(`document.querySelector('[data-key="dl-xlsx"]') && !document.querySelector('[data-key="dl-xlsx"]').disabled`, "excel download")
    await click('[data-key="dl-xlsx"]')
    const downloaded = await evaluate(`fetch('/api/export.xlsx', { headers: { 'X-Staff-Pin': '8462' }, cache: 'no-store' }).then((res) => res.status + ' ' + (res.headers.get('content-type') || ''))`)
    if (!/^200 /.test(downloaded) || !/spreadsheetml\.sheet/.test(downloaded)) throw new Error(`Excel download failed: ${downloaded}`)
    console.log(`excel download: ${downloaded}`)
    await evaluate(`window.confirm = () => true`)
    const before = new Set(readdirSync(process.env.DATA_DIR))
    await click('[data-key="reset-server"]')
    await click('[data-key="reset-server"]')
    let archivedName = ""
    for (let i = 0; i < 30 && !archivedName; i += 1) {
      archivedName = readdirSync(process.env.DATA_DIR).find((name) => /^attempts-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jsonl$/.test(name) && !before.has(name)) || ""
      if (!archivedName) await sleep(100)
    }
    if (!archivedName) throw new Error(`Reset did not archive attempts: ${readdirSync(process.env.DATA_DIR).join(", ")}`)
    const kept = readFileSync(join(process.env.DATA_DIR, archivedName), "utf8").trim().split("\n").filter(Boolean)
    if (kept.length !== 2 || !kept.some((line) => line.includes("ada@example.com"))) throw new Error(`Archive should keep both runs: ${kept.length} lines`)
    if (existsSync(join(process.env.DATA_DIR, "attempts.jsonl"))) {
      const live = readFileSync(join(process.env.DATA_DIR, "attempts.jsonl"), "utf8").trim()
      if (live) throw new Error("Reset left the live attempt log in place")
    }
    console.log(`reset archived ${kept.length} attempts to ${archivedName}`)
    await evaluate(`[...document.querySelectorAll('#staff button')].find((b) => b.textContent === 'CLOSE').click()`)
    lastAttempt = 0
    boothChecked = true
  }

  await send("Page.enable")
  await send("Runtime.enable")

  let audited = 0
  for (const [width, height] of VIEWPORTS) {
    const tag = `${width}x${height}`
    const shot = async (name) => {
      if (!shots) return
      await sleep(250)
      const { result } = await send("Page.captureScreenshot", { format: "png" })
      mkdirSync(shots, { recursive: true })
      writeFileSync(`${shots}/${tag}-${name}.png`, Buffer.from(result.data, "base64"))
    }
    /** The layout gate every screen passes: fits, and the overlap audit returns nothing. */
    const layout = async (label) => {
      await sleep(150)
      await evaluate(`document.fonts.ready.then(() => true)`)
      const problems = await evaluate(FITS)
      if (problems) throw new Error(`${tag} ${label}: ${problems}`)
      const overlaps = await evaluate(OVERLAP)
      if (overlaps) throw new Error(`${tag} ${label}: layout overlaps: ${overlaps}`)
      audited += 1
    }
    const nerdOn = () => evaluate(`document.getElementById('nerd-bar').getAttribute('aria-pressed') === 'true'`)
    const setNerd = async (on) => {
      if ((await nerdOn()) !== on) {
        await click("#nerd-bar")
        await sleep(250)
      }
    }
    /** Audit a screen in simple mode, then nerd mode, then back to simple. */
    const bothModes = async (label) => {
      await setNerd(false)
      await layout(`${label} simple`)
      await shot(`${label}-simple`)
      await setNerd(true)
      await layout(`${label} nerd`)
      await shot(`${label}-nerd`)
      await setNerd(false)
    }

    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false })
    await send("Page.navigate", { url: base })
    await waitFor(`!!document.querySelector('#player-name')`, "title screen")
    await evaluate(`localStorage.clear()`)
    await send("Page.navigate", { url: base })
    await waitFor(`!!document.querySelector('#player-name')`, "title screen")
    if (!boothKnown) {
      boothKnown = true
      booth = await evaluate(`fetch('/api/health', { cache: 'no-store' }).then((res) => res.ok).catch(() => false)`)
      console.log(booth ? "booth server is up" : "booth server is offline; checking the local queue")
    }

    /* ---------- Title ---------- */
    await layout("title")
    const titleNerd = await evaluate(`(() => { const b = document.getElementById('nerd-bar'); return b ? b.getAttribute('aria-pressed') + '|' + b.textContent.trim() : '' })()`)
    if (titleNerd !== "false|NERD MODE") throw new Error(`Top-bar nerd toggle on the title: ${titleNerd}`)
    const tagline = await text(".title-screen, .title-card")
    if (!/Every AI answer is born in a data center\./.test(tagline)) throw new Error(`Title tagline is missing: ${tagline.slice(0, 200)}`)
    const link = await evaluate(`(() => { const a = document.querySelector('.consent-copy a'); return a.target + ' ' + a.rel + ' ' + a.href })()`)
    if (link !== "_blank noopener noreferrer https://www.digitalrealty.com/about/legal/privacy") throw new Error(`Privacy link is wrong: ${link}`)
    if (await evaluate(`document.querySelector('#player-consent').checked`)) throw new Error("Consent must start unticked")
    await click("#mute")
    const muteOn = await evaluate(`document.querySelector('#mute').getAttribute('aria-pressed') + '|' + localStorage.getItem('token-quest-muted')`)
    if (muteOn !== "true|1") throw new Error(`Mute did not engage: ${muteOn}`)
    await evaluate(`document.querySelector('#player-name').value = 'Ada'; document.querySelector('#player-name').dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#enter-form').requestSubmit()`)
    await waitFor(`document.querySelector('#name-error').textContent.includes('first and last')`, "name validation")
    await evaluate(`document.querySelector('#player-name').value = 'Ada Lovelace'; document.querySelector('#player-name').dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#player-email').value = 'ada@example.com'; document.querySelector('#player-email').dispatchEvent(new Event('input', { bubbles: true }))`)
    if (!(await evaluate(`document.querySelector('#start-btn').disabled`))) throw new Error("START should stay disabled until consent is checked")
    await evaluate(`document.querySelector('#player-consent').checked = true; document.querySelector('#player-consent').dispatchEvent(new Event('change', { bubbles: true }))`)
    if (!(await evaluate(`!document.querySelector('#start-btn').disabled`))) throw new Error("START should enable after a valid name, email, and consent")
    await shot("1-title")
    await evaluate(`document.querySelector('#enter-form').requestSubmit()`)

    /* ---------- Intro: four booth scenes with the ecosystem cutaway; nerd mode swaps to six ---------- */
    await waitFor(`!!document.querySelector('.intro-canvas')`, "intro")
    const dotCount = () => evaluate(`document.querySelectorAll('.scene-dots button').length`)
    if ((await dotCount()) !== 4) throw new Error(`Expected 4 booth intro scenes, saw ${await dotCount()}`)
    await waitFor(`!!document.querySelector('.scene-dots .dot[aria-current="true"]')`, "intro started")
    const sceneState = `document.querySelector('.caption b').textContent + '|' + document.querySelector('.caption p').textContent + '|' + [...document.querySelectorAll('.scene-dots .dot')].findIndex((d) => d.getAttribute('aria-current') === 'true')`
    const firstScene = await evaluate(sceneState)
    if (!firstScene.endsWith(`|${SIMPLE_COPY[0]}|0`)) throw new Error(`The intro should open on scene 1 with its caption: ${firstScene}`)
    await sleep(1200)
    await layout("intro scene 1")
    await shot("2-intro-1")
    for (let i = 1; i < 4; i += 1) {
      await click('[data-key="intro-continue"]')
      await sleep(600)
      const caption = await evaluate(`document.querySelector('.caption p').textContent`)
      if (caption !== SIMPLE_COPY[i]) throw new Error(`Scene ${i + 1} copy drifted: ${caption}`)
      await layout(`intro scene ${i + 1}`)
      if (i === 1) {
        await sleep(2500)
        await shot("2-intro-ecosystem")
        await click("#nerd-bar")
        await waitFor(`document.querySelectorAll('.scene-dots button').length === 6`, "six nerd scenes")
        await layout("intro nerd")
        await shot("2-intro-nerd")
        await click("#nerd-bar")
        await waitFor(`document.querySelectorAll('.scene-dots button').length === 4`, "four booth scenes again")
        await sleep(450)
      }
    }
    const last = await evaluate(`document.querySelector('[data-key="intro-continue"]').textContent`)
    if (!/START THE QUEST/.test(last)) throw new Error(`Last scene button: ${last}`)
    const stamp = await evaluate(`document.getElementById('build-stamp').textContent`)
    if (!/^BUILD \d{10}-[a-f0-9]{7}$/.test(stamp)) throw new Error(`Build stamp missing: ${stamp}`)
    await click('[data-key="intro-continue"]')

    /* ---------- Stories ---------- */
    await waitFor(`!!document.querySelector('[data-key="usecase-chat"]')`, "use-case screen")
    const featured = await evaluate(`[...document.querySelectorAll('.story-card')].map((card) => card.dataset.key).join(',')`)
    if (featured !== "usecase-chat,usecase-drug,usecase-robot") throw new Error(`Simple use-case screen should show three featured jobs: ${featured}`)
    await bothModes("3-stories")
    await click('[data-key="more-stories"]')
    await waitFor(`document.querySelectorAll('.story-card').length === 6`, "all six jobs")
    await bothModes("3-stories-more")
    await click('[data-key="usecase-chat"]')

    /* ---------- Build: one step at a time, the ecosystem bar on every one ---------- */
    await waitFor(`!!document.querySelector('[data-key="step-panel"]')`, "game screen")
    if (await has('[data-key="score"]')) throw new Error("The build screen should not show a score")
    const scenario = await text('[data-key="scenario"]')
    for (const part of ["Shoppers want quick answers", "USERS", "MODEL & DATA", "NEW STORY"]) if (!scenario.includes(part)) throw new Error(`Scenario card lacks ${part}: ${scenario}`)
    const lights = await evaluate(`[...document.querySelectorAll('[data-key="eco-bar"] .eco-part')].map((p) => p.dataset.part + ':' + p.dataset.state).join(',')`)
    if (!/^power:\w+,cooling:\w+,compute:\w+,data:\w+,connections:\w+$/.test(lights)) throw new Error(`Ecosystem bar: ${lights}`)
    const picks = { model: ["model-70b", "users-large"], location: ["location-lon", "location-fra"], gpu: ["gpu-gb200"], cooling: ["cooling-super"], memory: ["memory-on"], wires: ["wires-fast"], storage: ["storage-none"], qpu: [] }
    for (const step of BUILD_STEPS) {
      await click(`[data-key="step-${step}"]`)
      await waitFor(`document.querySelector('[data-key="step-panel"]').classList.contains('step-${step}')`, `${step} step`)
      if (step === "model") {
        /* The first step: three model sizes on one row, three crowd sizes on the next, one of each pressed. */
        const rows = await evaluate(`['row-model', 'row-users'].map((row) => document.querySelectorAll('[data-key="' + row + '"] .tile').length).join(',')`)
        if (rows !== "3,3") throw new Error(`MODEL & USERS should show 3 model tiles and 3 users tiles, saw ${rows}`)
        const pressed = await evaluate(`[...document.querySelectorAll('.step-model .tile[aria-pressed="true"]')].map((t) => t.dataset.key).join(',')`)
        if (pressed !== "model-70b,users-large") throw new Error(`The shopper story should open on 70B and the crowd it was written for: ${pressed}`)
        const usersHint = await text('[data-key="users-medium"] .tile-hint')
        if (!/at once · .*tok\/s/.test(usersHint)) throw new Error(`A users tile should say how many ask at once and what that demands: ${usersHint}`)
        const labels = await evaluate(`[...document.querySelectorAll('[data-key="row-users"] .tile .tile-title')].map((t) => t.textContent.trim()).join(',')`)
        if (labels !== "10K shoppers a month,100K shoppers a month,1M shoppers a month") throw new Error(`The crowd tiles should read as enterprise sizes: ${labels}`)
        /* Picking the small crowd shrinks the budget and the demand on the scenario card; the default restores them. */
        await click('[data-key="users-small"]')
        await sleep(150)
        const smallCard = await text('[data-key="scenario"]')
        if (!/10K shoppers a month/.test(smallCard) || !/\$360k/.test(smallCard)) throw new Error(`The scenario card should follow the crowd: ${smallCard}`)
      }
      if (step === "location") {
        if (!(await has('[data-key="who-where"]'))) throw new Error("The LOCATION step should show who asks and where the data lives")
        const rows = await evaluate(`[...document.querySelectorAll('.step-location .tile')].map((t) => t.querySelectorAll('.tile-row').length)`)
        if (!rows.length || rows.some((n) => n < 2)) throw new Error(`Every metro tile should list its audience and data trips: ${JSON.stringify(rows)}`)
        const brief = await text('[data-key="ww-needs"]')
        if (!/tokens a second/.test(brief) || !/First word within/.test(brief)) throw new Error(`The job brief should carry the demand and first-word target: ${brief}`)
      }
      const tiles = await evaluate(`document.querySelectorAll('.step-panel .tile').length`)
      if (step === "gpu") {
        /* Six real NVIDIA racks on a 3×2 grid, cheapest first, each with its name, its rack count and whether the hall needs liquid. */
        if (tiles !== 6) throw new Error(`gpu: the simple board shows six GPU tiles, saw ${tiles}`)
        const titles = await evaluate(`[...document.querySelectorAll('.step-gpu .tile .tile-title')].map((t) => t.textContent.trim())`)
        if (titles.some((title) => !/^NVIDIA .+ ×\d+$/.test(title))) throw new Error(`Every GPU tile should read "NVIDIA <rack> ×N": ${titles.join(" | ")}`)
        const tags = await evaluate(`[...document.querySelectorAll('.step-gpu .tile .tile-tag')].map((t) => t.textContent.trim())`)
        if (tags.length !== 6 || tags.some((tag) => !/^(INCLUDED · AIR|NEEDS LIQUID( · 2026)?)$/.test(tag))) throw new Error(`Every GPU tile should say included or needs liquid: ${tags.join(" | ")}`)
        const grid = await evaluate(`(() => {
          const boxes = [...document.querySelectorAll('.step-gpu .tile')].map((t) => t.getBoundingClientRect())
          const rows = new Set(boxes.map((b) => Math.round(b.top)))
          return { rows: rows.size, perRow: boxes.filter((b) => Math.round(b.top) === Math.round(boxes[0].top)).length }
        })()`)
        if (grid.rows !== 2 || grid.perRow !== 3) throw new Error(`The GPU tiles should sit on two rows of three, saw ${grid.rows} rows of ${grid.perRow}`)
      } else if (step !== "qpu" && tiles !== 3 && step !== "location" && step !== "model") throw new Error(`${step}: the simple board shows 3 tiles, saw ${tiles}`)
      const simpleText = await text(".screen.game")
      const jargon = ["TB/s", "PFLOPS", "PUE"].filter((word) => simpleText.includes(word))
      if (jargon.length) throw new Error(`${step}: the simple board leaked ${jargon.join(", ")}`)
      await bothModes(`4-step-${step}`)
      for (const key of picks[step]) {
        const pressed = await evaluate(`document.querySelector('[data-key="${key}"]')?.getAttribute('aria-pressed')`)
        if (pressed !== "true") await click(`[data-key="${key}"]`)
        await sleep(120)
      }
      const coach = await text('[data-key="coach"]')
      if (!/\?\s*$/.test(coach) && !/green/i.test(coach)) throw new Error(`${step}: the coach should ask one question: ${coach}`)
    }
    const chosen = await evaluate(`[...document.querySelectorAll('.step-panel .tile[aria-pressed="true"]')].map((t) => t.dataset.key).join(',')`)
    console.log(`picks ${tag}: ${chosen || "(qpu has no choice)"}`)

    /* ---------- Review and GO ---------- */
    await click('[data-key="step-review"]')
    await waitFor(`!!document.querySelector('[data-key="run"]')`, "review")
    const review = await text('[data-key="step-panel"]')
    /* "1,350" is the three-star target; the word TARGET itself is tucked away on the compact iPad board. */
    for (const part of ["London + Frankfurt", "NVIDIA GB200 NVL72", "ServiceFabric", "1,350"]) if (!review.includes(part)) throw new Error(`Review lacks ${part}: ${review}`)
    const greens = await evaluate(`document.querySelectorAll('.step-panel .eco-bar.detail .eco-part.green').length`)
    if (greens !== 5) throw new Error(`The thoughtful shopper build should light all five parts green, saw ${greens}`)
    await bothModes("5-review")
    await click('[data-key="run"]')
    await waitFor(`!document.getElementById('run-overlay').hidden && document.getElementById('run-count').textContent !== '0'`, "run overlay")
    await sleep(800)
    await shot("6-running")
    await waitFor(`!document.getElementById('result').hidden`, "results")
    await bothModes("7-results-round-1")
    const score = await evaluate(`document.querySelector('.big-score').textContent`)
    if (!(Number(String(score).replace(/,/g, "")) >= 1350)) throw new Error(`A thoughtful shopper build should score near 1,400 after GO, saw ${score}`)
    const resultText = await text("#result")
    if (/ada@example\.com/i.test(resultText)) throw new Error("Results showed the player email")
    for (const part of ["ROUND 1 SCORE", "Round 1:", "WHAT YOU GOT RIGHT", "IMPROVE IT", "NEXT PLAYER", "DIGITAL REALTY", "HOW DIGITAL REALTY WOULD HAVE HELPED"]) if (!resultText.includes(part)) throw new Error(`Round-one results lack ${part}`)
    if (await has('[data-key="explain"]')) throw new Error("Simple results should not show the full explanation")
    /* HOW DIGITAL REALTY WOULD HAVE HELPED sits in both modes: four to six lines naming the chosen metros. */
    const drLines = async (mode) => {
      const lines = await evaluate(`[...document.querySelectorAll('[data-key="dr-help"] li')].map((li) => li.textContent)`)
      if (lines.length < 4 || lines.length > 6) throw new Error(`${mode}: HOW DIGITAL REALTY WOULD HAVE HELPED should have 4-6 lines, saw ${lines.length}`)
      if (!/London|Frankfurt/.test(lines[0])) throw new Error(`${mode}: the DR place line should name the metro: ${lines[0]}`)
      if (!/300\+ data centers in 50\+ metros/.test(lines[lines.length - 1])) throw new Error(`${mode}: the DR closing line should quote the published facts: ${lines[lines.length - 1]}`)
      return lines
    }
    const simpleDr = await drLines("simple")
    await setNerd(true)
    await waitFor(`!!document.querySelector('[data-key="explain"]')`, "nerd explanation")
    const bullets = await evaluate(`document.querySelectorAll('[data-key="explain"] li').length`)
    if (bullets < 5 || bullets > 7) throw new Error(`Explanation should have 5-7 bullets, saw ${bullets}`)
    const nerdDr = await drLines("nerd")
    if (!(nerdDr[0].length > simpleDr[0].length)) throw new Error("Nerd mode should add numbers to the DR place line")
    console.log(`dr-help ${tag}: ${simpleDr.length} lines simple, ${nerdDr.length} nerd`)
    await setNerd(false)
    const syncLine = await readSyncLine("first run")
    if (booth) noteAttempt(syncLine, "first run")
    else {
      if (!/RANK \d+ OF \d+/.test(syncLine)) throw new Error(`Offline results should show the local rank: ${syncLine}`)
      const queued = await evaluate(`localStorage.getItem('token-quest-sync-queue') || ''`)
      if (!queued.includes("ada@example.com")) throw new Error("Offline attempt was not queued for the booth server")
    }

    /* ---------- Round two: IMPROVE IT, make it worse on purpose, the final score keeps the best ---------- */
    await click('[data-key="improve"]')
    await waitFor(`document.getElementById('result').hidden && !!document.querySelector('[data-key="step-panel"]')`, "round two")
    const roundBadge = await text('[data-key="round"]')
    if (!/ROUND 2 OF 2/.test(roundBadge)) throw new Error(`Round two should be announced: ${roundBadge}`)
    await click('[data-key="step-wires"]')
    await waitFor(`document.querySelector('[data-key="step-panel"]').classList.contains('step-wires')`, "wires step")
    await click('[data-key="wires-cheap"]')
    await sleep(150)
    const cheapCoach = await text('[data-key="coach"]')
    if (!/\?\s*$/.test(cheapCoach)) throw new Error(`The coach should question the public internet: ${cheapCoach}`)
    await bothModes("8-round-2-wires")
    await click('[data-key="step-review"]')
    await waitFor(`!!document.querySelector('[data-key="run"]')`, "review two")
    await bothModes("8-round-2-review")
    await click('[data-key="run"]')
    await waitFor(`!document.getElementById('result').hidden`, "final results")
    await bothModes("9-results-final")
    const finalText = await text("#result")
    const roundLine = await evaluate(`document.querySelector('[data-key="round-line"]').textContent`)
    if (!/^Round 1: 1,\d{3} → Round 2: \d{1,3}(,\d{3})? \([−+±]\d/.test(roundLine)) throw new Error(`Round line: ${roundLine}`)
    const finalScore = await evaluate(`document.querySelector('.big-score').textContent`)
    if (finalScore !== score) throw new Error(`The final score should keep the better round (${score}), saw ${finalScore}`)
    for (const part of ["FINAL SCORE", "WHAT TO TRY", "PLAY AGAIN", "NEXT PLAYER"]) if (!finalText.includes(part)) throw new Error(`Final results lack ${part}`)
    if (await has('[data-key="improve"]')) throw new Error("IMPROVE IT should be gone after round two")
    console.log(`rounds ${tag}: ${roundLine}`)
    if (booth) {
      const secondLine = await readSyncLine("second run")
      const secondAttempt = noteAttempt(secondLine, "second run")
      if (secondAttempt === 2 && !boothChecked) await assertBoothWorkbook()
    }

    /* ---------- League and the next player ---------- */
    await click('[data-key="next-player"]')
    await waitFor(`!!document.querySelector('.league li')`, "league row")
    await layout("league")
    await shot("10-league")
    const board = await evaluate(`document.querySelector('.league').innerText`)
    if (!board.includes("ADA LOVELACE")) throw new Error(`League missed the player: ${board}`)
    if (/@/.test(board)) throw new Error(`League board showed an email: ${board}`)
    const cleared = await evaluate(`document.querySelector('#player-name').value + '|' + document.querySelector('#player-email').value + '|' + document.querySelector('#player-consent').checked`)
    if (cleared !== "||false") throw new Error(`Next player still sees the last entry: ${cleared}`)
    const stored = await evaluate(`localStorage.getItem('token-quest-league-v1')`)
    if (!stored.includes("ada@example.com")) throw new Error("League entry did not keep the email for staff export")
    if (!/"round1":1\d{3}/.test(stored) || !/"round2":\d+/.test(stored)) throw new Error(`League entry lacks both rounds: ${stored}`)
    if (booth && !boothChecked) await resetBooth()
    /* ---------- TEST MODE (first viewport only): a blank form starts, the run is shown, nothing is saved ---------- */
    if (width === VIEWPORTS[0][0] && height === VIEWPORTS[0][1]) await testModePass()
    if (errors.length) throw new Error(`Page errors: ${errors.join(" | ")}`)
    console.log(`smoke ok ${tag}: score ${score}, ${audited} screens passed the layout audit`)

    async function testModePass() {
      const attemptsOnServer = async () => (booth ? (await evaluate(`fetch('/api/league', { cache: 'no-store' }).then((res) => res.json())`)).players?.reduce((sum, item) => sum + (item.attempts || 0), 0) ?? 0 : null)
      const serverBefore = await attemptsOnServer()
      const leagueBefore = await evaluate(`localStorage.getItem('token-quest-league-v1')`)
      const toggle = await evaluate(`(() => { const b = document.querySelector('[data-key="test-mode"]'); return b ? b.getAttribute('aria-pressed') + '|' + b.textContent.trim() : '' })()`)
      if (toggle !== "false|TEST MODE") throw new Error(`The title should offer TEST MODE, off: ${toggle}`)
      if (!(await evaluate(`document.querySelector('#start-btn').disabled`))) throw new Error("START should be disabled on a blank form with test mode off")
      await click('[data-key="test-mode"]')
      await sleep(120)
      const on = await evaluate(`document.querySelector('[data-key="test-mode"]').getAttribute('aria-pressed') + '|' + !document.querySelector('#start-btn').disabled + '|' + (document.querySelector('[data-key="test-badge"]') || { textContent: '' }).textContent`)
      if (on !== "true|true|TEST MODE") throw new Error(`Test mode on should enable START on a blank form and badge the HUD: ${on}`)
      await layout("title test mode")
      await shot("11-title-test-mode")
      await evaluate(`document.querySelector('#enter-form').requestSubmit()`)
      await waitFor(`!!document.querySelector('.intro-canvas')`, "intro (test mode)")
      /* Each scene holds its CONTINUE for a moment against double taps; step through the four scenes. */
      await waitFor(`!!document.querySelector('.scene-dots .dot[aria-current="true"]')`, "intro started (test mode)")
      for (let i = 0; i < 4; i += 1) {
        await sleep(900)
        await click('[data-key="intro-continue"]')
      }
      await waitFor(`!!document.querySelector('[data-key="usecase-chat"]')`, "stories (test mode)")
      await click('[data-key="usecase-chat"]')
      await waitFor(`!!document.querySelector('[data-key="step-panel"]')`, "game (test mode)")
      const badge = await text('[data-key="test-badge"]')
      if (badge !== "TEST MODE") throw new Error(`The HUD should carry the TEST MODE badge on the build screen: ${badge}`)
      await layout("test mode build")
      await click('[data-key="step-review"]')
      await waitFor(`!!document.querySelector('[data-key="run"]')`, "review (test mode)")
      await click('[data-key="run"]')
      await waitFor(`!document.getElementById('result').hidden`, "results (test mode)")
      await layout("test mode results")
      await shot("11-results-test-mode")
      const testLine = await text('[data-key="sync-line"]')
      if (testLine !== "Test mode: not saved") throw new Error(`Test-mode results should say they are not saved: ${testLine}`)
      const rankBox = await text('[data-key="rank-box"]')
      if (!/TEST MODE[\s\S]*NOT SAVED/.test(rankBox)) throw new Error(`Test-mode rank box: ${rankBox}`)
      if (await has('[data-key="beat-line"]')) throw new Error("Test-mode results should not claim to beat anyone")
      const hudBadge = await text('[data-key="test-badge"]')
      if (hudBadge !== "TEST MODE") throw new Error("The HUD badge should stay on the results")
      const leagueAfter = await evaluate(`localStorage.getItem('token-quest-league-v1')`)
      if (leagueAfter !== leagueBefore) throw new Error(`Test mode wrote to the league: ${leagueAfter}`)
      const queue = await evaluate(`localStorage.getItem('token-quest-sync-queue')`)
      if (queue && JSON.parse(queue).length) throw new Error(`Test mode queued an attempt: ${queue}`)
      const serverAfter = await attemptsOnServer()
      if (serverAfter !== serverBefore) throw new Error(`Test mode reached the booth server: ${serverBefore} → ${serverAfter} attempts`)
      await click('[data-key="next-player"]')
      await waitFor(`!!document.querySelector('[data-key="test-mode"]')`, "title after test mode")
      const off = await evaluate(`document.querySelector('[data-key="test-mode"]').getAttribute('aria-pressed') + '|' + document.querySelector('#start-btn').disabled + '|' + !document.querySelector('[data-key="test-badge"]')`)
      if (off !== "false|true|true") throw new Error(`NEXT PLAYER should switch test mode off again: ${off}`)
      console.log(`test mode ${tag}: not saved (league and booth unchanged), toggle reset for the next player`)
    }
  }
  await evaluate(`localStorage.clear()`)
} finally {
  ws?.close()
  browser.kill()
}

function workbookInfo(file) {
  const out = execFileSync("python3", ["-c", `
import re, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
sheets = [z.read(f"xl/worksheets/sheet{n}.xml").decode() for n in (1, 2)]
def rows(xml):
    return len(re.findall(r"<row ", xml))
print(rows(sheets[0]))
print(rows(sheets[1]))
print("Ada Lovelace" in sheets[0])
print("ada@example.com" in sheets[0])
`, file], { encoding: "utf8" }).trim().split("\n")
  const [rows1, rows2, hasName, hasEmail] = out
  return { rows1: Number(rows1), rows2: Number(rows2), data2: Number(rows2) - 1, hasName: hasName === "True", hasEmail: hasEmail === "True" }
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
