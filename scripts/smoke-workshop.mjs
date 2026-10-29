#!/usr/bin/env node
/**
 * Workshop smoke: headless Chrome walks a whole session the way a room would. A facilitator laptop
 * creates the session on /host; three table iPads (separate browser contexts, 1180×820 and 1024×768)
 * join, decide, pitch and get approved or sent back by their architect; one submits; the facilitator
 * presses BRIEF → BUILD → +1 MIN → READ-OUT → END; the projector board (1920×1080) is read before and
 * after the scores release; each iPad shows its read-out. Every screen passes a layout audit: no page
 * scroll, nothing outside the viewport, sibling tiles that do not overlap, tap targets of 44 px, pixel
 * text of 8 px or more, no console errors.
 *
 *   node scripts/smoke-workshop.mjs                 in-process dev server (in-memory D1), no network
 *   SHOTS=.shots node scripts/smoke-workshop.mjs    screenshots per screen
 *   WORKSHOP_URL=https://… WORKSHOP_PASSWORD=… node scripts/smoke-workshop.mjs
 *                                                   a throwaway session on a live deployment, deleted at the end
 *   node --test scripts/smoke-workshop.mjs          the same, under the test runner
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = Number(process.env.SMOKE_PORT || 9348)
const TEAM_VIEWPORTS = (process.env.VIEWPORTS || "1180x820,1024x768").split(",").map((v) => v.split("x").map(Number))
const BOARD_VIEWPORT = [1920, 1080]
const HOST_VIEWPORT = [1180, 820]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The build each table pitches: a thoughtful one, a middle one, and the trap (sent back once at OEMs). */
const TABLES = [
  { number: 1, name: "Downforce Dynamos", architect: "Grace", choices: { connectivity: { product: "combo" }, oems: { design: "nvl72-rack" }, dcpower: { metro: "lon", cooling: "liquid", power: "block-0" }, cfd: { gpu: "gb200", size: "small", fabric: "nvlink" } }, submit: true },
  { number: 2, name: "Slipstream", architect: "Ada", choices: { connectivity: { product: "fabric" }, oems: { design: "air-node" }, dcpower: { metro: "fra", cooling: "air", power: "block-0" }, cfd: { gpu: "h200", size: "medium", fabric: "infiniband" } }, submit: false },
  { number: 3, name: "Vortex", architect: "Linus", choices: { connectivity: { product: "public" }, oems: { design: "air-node" }, dcpower: { metro: "par", cooling: "air", power: "block-2" }, cfd: { gpu: "rtx", size: "large", fabric: "ethernet" } }, sendBack: { station: "oems", reason: "cost" }, submit: false },
]

/* ---------- layout audit (runs in the page) ---------- */

/** Nothing scrolls at page level, every control sits inside the viewport, tap targets are 44 px, text is 8 px+. */
const AUDIT = `(() => {
  const out = []
  const root = document.scrollingElement
  if (root.scrollHeight > innerHeight + 1 || root.scrollWidth > innerWidth + 1) out.push('page scrolls ' + root.scrollWidth + 'x' + root.scrollHeight + ' in ' + innerWidth + 'x' + innerHeight)
  const visible = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + (el.dataset && el.dataset.tile ? '[' + el.dataset.tile + ']' : '')
  const fmt = (r) => Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
  const sheetOpen = !!document.querySelector('.sheet')
  const inScroller = (el) => { let p = el.parentElement; while (p && p !== document.body) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) return true; p = p.parentElement } return false }
  for (const el of document.querySelectorAll('button, input, textarea, a, .tile, .station-tile, .panel, .sheet')) {
    if (!visible(el)) continue
    if (sheetOpen && !el.closest('.sheet') && !el.closest('.top')) continue
    if (inScroller(el)) continue
    const r = el.getBoundingClientRect()
    if (r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1) out.push('(c) ' + name(el) + ' ' + fmt(r) + ' outside the viewport')
  }
  for (const el of document.querySelectorAll('button, a.btn')) {
    if (!visible(el) || el.disabled) continue
    if (sheetOpen && !el.closest('.sheet') && !el.closest('.top')) continue
    const r = el.getBoundingClientRect()
    if (r.width < 44 || r.height < 44) out.push('(g) ' + name(el) + ' ' + fmt(r) + ' tap target under 44px')
  }
  const groups = new Map()
  for (const el of document.querySelectorAll('.tile, .station-tile, .decision, .target, .codes > div, .board .team')) { if (!visible(el)) continue; const p = el.parentElement; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(el) }
  for (const list of groups.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const a = list[i].getBoundingClientRect(), b = list[j].getBoundingClientRect(); if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push('(a) ' + name(list[i]) + ' ' + fmt(a) + ' overlaps ' + name(list[j]) + ' ' + fmt(b)) }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  let node
  while ((node = walker.nextNode())) {
    if (!node.textContent.trim()) continue
    const el = node.parentElement
    if (!el || seen.has(el) || el.closest('.sr-only, #toast') || !visible(el)) continue
    seen.add(el)
    const px = parseFloat(getComputedStyle(el).fontSize)
    if (px < 8) out.push('(h) ' + name(el) + ' text ' + px.toFixed(1) + 'px')
  }
  for (const el of document.querySelectorAll('.tile .line, .station-tile, .decision h3, .scenario p, .targets .target, .live')) {
    if (!visible(el) || inScroller(el)) continue
    if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflowY !== 'auto') out.push('(e) ' + name(el) + ' text overflows by ' + (el.scrollHeight - el.clientHeight) + 'px')
  }
  return out.join('; ')
})()`

/* ---------- CDP ---------- */

class Browser {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`))
        else resolve(message.result)
        return
      }
      if (message.method && message.sessionId) this.listeners.get(message.sessionId)?.(message)
    })
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.id
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  /** A fresh browser context (own cookies and localStorage) with one page attached as a flat session. */
  async newPage(label, [width, height]) {
    const { browserContextId } = await this.send("Target.createBrowserContext")
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank", browserContextId, width, height })
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true })
    const page = new Page(this, sessionId, label, browserContextId)
    this.listeners.set(sessionId, (message) => page.onEvent(message))
    await page.send("Runtime.enable")
    await page.send("Page.enable")
    await page.setViewport(width, height)
    return page
  }
}

class Page {
  constructor(browser, sessionId, label, contextId) {
    this.browser = browser
    this.sessionId = sessionId
    this.label = label
    this.contextId = contextId
    this.errors = []
    this.width = 0
    this.height = 0
  }

  onEvent(message) {
    if (message.method === "Runtime.exceptionThrown") this.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") this.errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "))
    if (message.method === "Page.javascriptDialogOpening") this.send("Page.handleJavaScriptDialog", { accept: true })
  }

  send(method, params) {
    return this.browser.send(method, params, this.sessionId)
  }

  async setViewport(width, height) {
    this.width = width
    this.height = height
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false })
  }

  async goto(url) {
    await this.send("Page.navigate", { url })
    await sleep(900)
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    if (exceptionDetails) throw new Error(`${this.label}: ${exceptionDetails.exception?.description || exceptionDetails.text}`)
    return result?.value
  }

  async click(selector, { wait = 350 } = {}) {
    const ok = await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)
    if (!ok) throw new Error(`${this.label}: nothing matches ${selector}`)
    await sleep(wait)
  }

  async clickText(selector, text, { wait = 350 } = {}) {
    const ok = await this.evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true })()`)
    if (!ok) throw new Error(`${this.label}: no ${selector} reads "${text}"`)
    await sleep(wait)
  }

  async type(selector, value) {
    await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  }

  text(selector) {
    return this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText || ''`)
  }

  async waitFor(expression, { timeout = 12000, every = 250, what = expression } = {}) {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      if (await this.evaluate(expression)) return
      await sleep(every)
    }
    throw new Error(`${this.label}: timed out waiting for ${what}`)
  }

  async screenshot(dir, name) {
    if (!dir) return
    const { data } = await this.send("Page.captureScreenshot", { format: "png" })
    writeFileSync(join(dir, `${name}.png`), Buffer.from(data, "base64"))
  }
}

/* ---------- the walk ---------- */

export async function runWorkshopSmoke({ baseUrl, password = "", shots = "", log = console.log, cleanup = true } = {}) {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} (set CHROME=/path/to/chrome)`)
  if (shots) mkdirSync(shots, { recursive: true })
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(process.env.TMPDIR || "/tmp", `tq-workshop-smoke-${process.pid}`)}`, "--window-size=1920,1080", "about:blank"], { stdio: "ignore" })
  const audited = []
  const problems = []
  let browser
  let created = null
  let pages = []
  try {
    let version
    for (let i = 0; i < 80 && !version; i += 1) {
      try {
        version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      } catch {
        await sleep(250)
      }
    }
    if (!version) throw new Error("Chrome did not open its debugging port")
    const ws = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true })
      ws.addEventListener("error", reject, { once: true })
    })
    browser = new Browser(ws)

    const audit = async (page, screen) => {
      const found = await page.evaluate(AUDIT)
      audited.push(`${page.label}@${page.width}x${page.height}:${screen}`)
      if (found) problems.push(`${page.label} ${page.width}x${page.height} ${screen}: ${found}`)
      await page.screenshot(shots, `${String(audited.length).padStart(2, "0")}-${page.label}-${page.width}x${page.height}-${screen}`)
    }

    const login = async (page, next) => {
      if (!password) return
      await page.goto(`${baseUrl}/login?next=${encodeURIComponent(next)}`)
      await page.type("#password", password)
      await page.click("form button[type=submit], form input[type=submit]", { wait: 1200 })
    }

    /* 1. The facilitator creates the session. */
    const host = await browser.newPage("host", HOST_VIEWPORT)
    pages.push(host)
    await login(host, "/host")
    await host.goto(`${baseUrl}/host`)
    await host.evaluate("localStorage.clear(); true")
    await host.goto(`${baseUrl}/host`)
    await host.waitFor("!!document.querySelector('#session-name')", { what: "the create form" })
    await audit(host, "create")
    await host.type("#session-name", "Smoke · Apex Aero Racing")
    await host.click(".create button[type=submit]", { wait: 1500 })
    await host.waitFor("!!document.querySelector('.code-big')", { what: "the session code" })
    created = { code: await host.text(".code-big"), pin: await host.evaluate("__tqHost.state.pin"), hostCodes: JSON.parse(await host.evaluate("JSON.stringify(__tqHost.state.hostCodes)")) }
    if (!/^[A-Z2-9]{4,6}$/.test(created.code) || !/^\d{6}$/.test(created.pin) || created.hostCodes.length !== 10) throw new Error(`unexpected session ${JSON.stringify(created)}`)
    log(`session ${created.code} created (${created.hostCodes.length} host codes)`)
    await audit(host, "lobby")

    /* 2. The projector board, empty. */
    const board = await browser.newPage("board", BOARD_VIEWPORT)
    pages.push(board)
    await login(board, `/board/${created.code}`)
    await board.goto(`${baseUrl}/board/${created.code}`)
    await board.waitFor("!!document.querySelector('.board .join-hint b')", { what: "the board" })
    await audit(board, "waiting")

    /* 3. Three tables join on iPads; the first two at 1180×820, the third at 1024×768. */
    const teams = []
    for (const [index, table] of TABLES.entries()) {
      const viewport = TEAM_VIEWPORTS[Math.min(index, TEAM_VIEWPORTS.length - 1)]
      const page = await browser.newPage(`table${table.number}`, viewport)
      pages.push(page)
      await login(page, `/workshop?code=${created.code}`)
      await page.goto(`${baseUrl}/workshop?code=${created.code}`)
      await page.waitFor("!!document.querySelector('.tables button')", { what: "the join screen" })
      if (index === 0) await audit(page, "join")
      await page.click(`.tables button:nth-child(${table.number})`)
      await page.type("#teamName", table.name)
      await page.type("#hostName", table.architect)
      await page.click(".join button[type=submit]", { wait: 1200 })
      await page.waitFor("!!document.querySelector('.home')", { what: "the home screen" })
      await audit(page, "home")
      teams.push({ ...table, page, hostCode: created.hostCodes.find((row) => row.number === table.number).hostCode })
    }

    /* 4. The facilitator starts the brief, then the build. */
    await host.clickText(".phase-bar .btn.go", "START 5-MIN BRIEF", { wait: 900 })
    await host.waitFor("document.querySelector('.clock .phase')?.innerText.includes('BRIEF')", { what: "the brief phase" })
    await audit(host, "brief")
    await host.clickText(".phase-bar .btn.go", "START BUILD", { wait: 900 })
    await host.waitFor("document.querySelector('.clock .phase')?.innerText.includes('BUILD')", { what: "the build phase" })
    await host.clickText(".phase-bar .btn", "+1 MIN", { wait: 900 })
    if ((await host.evaluate("__tqHost.state.session.buildMinutes")) !== 37) throw new Error("+1 MIN did not take")

    /* 5. Every table works the four stations: tiles → PITCH → architect code → APPROVE (or SEND BACK first). */
    const stations = ["connectivity", "oems", "dcpower", "cfd"]
    for (const team of teams) {
      const { page } = team
      for (const station of stations) {
        await page.click(`[data-station=${station}]`, { wait: 500 })
        await page.waitFor("!!document.querySelector('.station')", { what: `the ${station} station` })
        for (const [decision, tile] of Object.entries(team.choices[station])) await page.click(`[data-tile="${decision}:${tile}"] .pick`, { wait: 200 })
        await sleep(700)
        if (station === "cfd" || station === "dcpower") await audit(page, `station-${station}`)
        const verdicts = team.sendBack?.station === station ? ["SEND BACK", "APPROVE"] : ["APPROVE"]
        for (const verdict of verdicts) {
          await page.waitFor("!document.querySelector('.actions .btn.go')?.disabled", { what: "PITCH enabled" })
          await page.click(".actions .btn.go", { wait: 400 })
          await page.waitFor("!!document.querySelector('#pitch')", { what: "the pitch sheet" })
          if (station === "cfd" && team.number === 1) await audit(page, "pitch")
          await page.type("#pitch", `${team.name}: this is the right ${station} call for the budget and the runs.`)
          await page.click(".sheet button[type=submit]", { wait: 900 })
          await page.waitFor("!!document.querySelector('.keypad')", { what: "the architect sheet" })
          if (station === "cfd" && team.number === 1) await audit(page, "architect")
          for (const digit of team.hostCode) await page.clickText(".key", digit, { wait: 60 })
          await sleep(200)
          if (verdict === "SEND BACK") await page.clickText(".reason", team.sendBack.reason, { wait: 150 })
          await page.clickText(".verdicts .btn", verdict, { wait: 1000 })
          await page.waitFor("!document.querySelector('.sheet')", { what: "the sheet to close" })
        }
        await page.waitFor("document.querySelector('.actions .status')?.innerText.includes('APPROVED')", { what: `${station} approved` })
        if (station === "oems" && team.sendBack) await audit(page, "approved-after-sendback")
        await page.clickText(".top .actions .btn", "HOME", { wait: 500 })
      }
      await page.waitFor("!!document.querySelector('.home')", { what: "home after four stations" })
      await audit(page, "home-approved")
      if (team.submit) {
        await page.clickText(".footer .btn.go", "SUBMIT BUILD", { wait: 1200 })
        await page.waitFor("document.querySelector('.footer')?.innerText.includes('SUBMITTED')", { what: "the submit confirmation" })
        await audit(page, "submitted")
      }
      log(`${team.name}: four stations approved${team.sendBack ? " (one send-back)" : ""}${team.submit ? ", build submitted" : ""}`)
    }

    /* 6. Facilitator grid and board during the build. */
    await host.waitFor("document.querySelectorAll('table.grid .chip.ok').length >= 12", { what: "twelve approvals in the grid" })
    await audit(host, "build-grid")
    await board.waitFor("document.querySelectorAll('.board .team').length === 3", { what: "three rows on the board" })
    await audit(board, "build")
    const boardBefore = await board.text(".board .rows")
    if (/\b1[0-9]{3}\b/.test(boardBefore)) throw new Error(`the board shows a score before the read-out: ${boardBefore}`)

    /* 7. READ-OUT: scores release; every iPad shows its read-out; the board ranks. */
    await host.clickText(".phase-bar .btn.go", "START READ-OUT", { wait: 1500 })
    await host.waitFor("document.querySelector('.clock .phase')?.innerText.includes('READ-OUT')", { what: "the read-out phase" })
    await host.waitFor("document.querySelectorAll('table.grid td.sc').length && [...document.querySelectorAll('table.grid td.sc')].filter((td) => /#\\d/.test(td.innerText)).length === 3", { what: "three ranks in the grid" })
    await audit(host, "readout-grid")
    await board.waitFor("document.querySelectorAll('.board .team .pos').length === 3 && document.querySelector('.board .team .pos').innerText.startsWith('#')", { what: "ranked rows on the board" })
    await audit(board, "readout")
    const scores = []
    for (const team of teams) {
      await team.page.waitFor("!!document.querySelector('.readout')", { what: `${team.name}'s read-out`, timeout: 15000 })
      await audit(team.page, "readout")
      const text = await team.page.text(".readout")
      for (const heading of ["WHAT WENT WELL", "WHAT YOU COULD HAVE DONE DIFFERENTLY"]) if (!text.includes(heading)) throw new Error(`${team.name}'s read-out lacks ${heading}`)
      const score = Number(await team.page.text(".readout .score"))
      scores.push({ name: team.name, score, rank: await team.page.text(".readout .rank") })
      if (team.sendBack && !/sent back once \(cost\)/.test(text)) throw new Error(`${team.name}'s read-out does not quote the architect's send-back`)
      if (!/Digital Realty/.test(text)) throw new Error(`${team.name}'s read-out lacks the closing line`)
    }
    if (!(scores[0].score > scores[1].score && scores[1].score > scores[2].score)) throw new Error(`scores out of order: ${JSON.stringify(scores)}`)
    log(`read-out: ${scores.map((row) => `${row.name} ${row.score}`).join(" · ")}`)

    /* 8. The second iPad size on the read-out and the home screen, then END. */
    await teams[0].page.setViewport(...TEAM_VIEWPORTS[TEAM_VIEWPORTS.length - 1])
    await sleep(300)
    await audit(teams[0].page, "readout")
    await host.clickText(".phase-bar .btn.go", "END SESSION", { wait: 1200 })
    await host.waitFor("document.querySelector('.clock .phase')?.innerText.includes('DONE')", { what: "the session to end" })
    await audit(host, "done")

    const errors = pages.flatMap((page) => page.errors.map((error) => `${page.label}: ${error}`))
    if (errors.length) problems.push(`console errors: ${errors.join(" | ")}`)
    if (problems.length) throw new Error(`layout audit failed:\n- ${problems.join("\n- ")}`)
    log(`smoke ok: ${audited.length} screens passed the layout audit (${TEAM_VIEWPORTS.map((v) => v.join("x")).join(", ")} tables; board ${BOARD_VIEWPORT.join("x")})`)
    return { code: created.code, audited: audited.length, scores }
  } catch (error) {
    /* A failing step leaves a picture of every screen behind. */
    if (shots) for (const page of pages) await page.screenshot(shots, `fail-${page.label}`).catch(() => {})
    throw error
  } finally {
    if (created && cleanup && browser && pages[0]) {
      try {
        await pages[0].evaluate(`fetch('/api/session/${created.code}', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Facilitator-Pin': '${created.pin}' }, body: '{}' }).then((r) => r.status)`)
      } catch {
        /* a session that is already gone is fine */
      }
    }
    try {
      browser?.ws.close()
    } catch {
      /* closing */
    }
    chrome.kill("SIGKILL")
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const remote = process.env.WORKSHOP_URL || ""
  const shots = process.env.SHOTS || ""
  let server = null
  let baseUrl = remote.replace(/\/$/, "")
  if (!baseUrl) {
    const { startWorkshopServer } = await import("./workshop-dev-server.mjs")
    server = await startWorkshopServer({ port: 0 })
    baseUrl = server.url
  }
  try {
    await runWorkshopSmoke({ baseUrl, password: process.env.WORKSHOP_PASSWORD || "", shots })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    await server?.close()
  }
}
