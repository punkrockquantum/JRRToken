import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const base = process.env.GAME_URL || "http://127.0.0.1:8080/"
const shots = process.env.SHOTS || ""
const port = 9333
const VIEWPORTS = (process.env.VIEWPORTS || "1920x1080,1600x1000").split(",").map((v) => v.split("x").map(Number))
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--autoplay-policy=no-user-gesture-required", `--remote-debugging-port=${port}`, "--window-size=1920,1080", "about:blank"], { stdio: "ignore" })

/** Fails if the page scrolls, a panel clips its content, or a control sits outside the viewport. */
const FITS = `(() => {
  const problems = []
  const root = document.scrollingElement
  if (root.scrollHeight > innerHeight + 1 || root.scrollWidth > innerWidth + 1) problems.push('page scrolls ' + root.scrollWidth + 'x' + root.scrollHeight)
  const stage = document.getElementById('stage')
  if (stage.scrollHeight > stage.clientHeight + 1) problems.push('stage scrolls by ' + (stage.scrollHeight - stage.clientHeight) + 'px')
  for (const box of document.querySelectorAll('.screen, .title-screen, .title-card, .intro, .choices, .feel, .story, .story-cards, #result:not([hidden]) .dialog, #result:not([hidden]) .people-card')) {
    if (box.scrollHeight > box.clientHeight + 2) problems.push((box.className || box.id) + ' clips ' + (box.scrollHeight - box.clientHeight) + 'px')
  }
  const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
  for (const el of document.querySelectorAll('[data-key], button, input, canvas, a')) {
    if (!visible(el)) continue
    if (document.getElementById('result').hidden === false && !el.closest('#result')) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1) problems.push((el.dataset.key || el.id || el.tagName) + ' at ' + Math.round(r.top) + '..' + Math.round(r.bottom))
  }
  return problems.join('; ')
})()`

/** Every tile must be the thing under its own centre: nothing may cover the options. */
const UNOBSTRUCTED = `(() => {
  const bad = []
  for (const tile of document.querySelectorAll('.choices .tile')) {
    const r = tile.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (!hit || !(hit === tile || tile.contains(hit))) bad.push((tile.dataset.key || '?') + ' under ' + (hit ? (hit.className || hit.tagName) : 'nothing'))
  }
  return bad.join('; ')
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
    for (let i = 0; i < 80; i += 1) {
      if (await evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`Timed out waiting for ${label}`)
  }
  const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ${selector}'); el.click(); return true })()`)

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
    await evaluate(`document.querySelector('#staff-pin').value = '2510'; [...document.querySelectorAll('#staff button')].find((b) => b.textContent === 'UNLOCK').click()`)
    await waitFor(`document.querySelector('[data-key="dl-xlsx"]') && !document.querySelector('[data-key="dl-xlsx"]').disabled`, "excel download")
    await click('[data-key="dl-xlsx"]')
    const downloaded = await evaluate(`fetch('/api/export.xlsx', { headers: { 'X-Staff-Pin': '2510' }, cache: 'no-store' }).then((res) => res.status + ' ' + (res.headers.get('content-type') || ''))`)
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

  for (const [width, height] of VIEWPORTS) {
    const tag = `${width}x${height}`
    const shot = async (name) => {
      if (!shots) return
      await sleep(250)
      const { result } = await send("Page.captureScreenshot", { format: "png" })
      mkdirSync(shots, { recursive: true })
      writeFileSync(`${shots}/${tag}-${name}.png`, Buffer.from(result.data, "base64"))
    }
    const shotClip = async (name, selector) => {
      if (!shots) return
      await sleep(250)
      const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
      const { result } = await send("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: 1 } })
      mkdirSync(shots, { recursive: true })
      writeFileSync(`${shots}/${tag}-${name}.png`, Buffer.from(result.data, "base64"))
    }
    const fits = async (label) => {
      await sleep(120)
      const problems = await evaluate(FITS)
      if (problems) throw new Error(`${tag} ${label}: ${problems}`)
    }
    const unobstructed = async (label) => {
      await sleep(120)
      const covered = await evaluate(UNOBSTRUCTED)
      if (covered) throw new Error(`${tag} ${label}: tiles are covered: ${covered}`)
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
    await evaluate(`document.fonts.ready.then(() => true)`)
    await fits("title")
    const titleNerd = await evaluate(`(() => { const b = document.getElementById('nerd-bar'); return b ? b.getAttribute('aria-pressed') + '|' + b.textContent.trim() : '' })()`)
    if (titleNerd !== "false|NERD MODE") throw new Error(`Top-bar nerd toggle on the title: ${titleNerd}`)
    const link = await evaluate(`(() => { const a = document.querySelector('.consent-copy a'); return a.target + ' ' + a.rel + ' ' + a.href })()`)
    if (link !== "_blank noopener noreferrer https://www.digitalrealty.com/about/legal/privacy") throw new Error(`Privacy link is wrong: ${link}`)
    if (await evaluate(`document.querySelector('#player-consent').checked`)) throw new Error("Consent must start unticked")
    const muteOff = await evaluate(`document.querySelector('#mute').getAttribute('aria-pressed') + '|' + document.querySelector('#mute').textContent.trim()`)
    if (muteOff !== "false|SOUND ON") throw new Error(`Mute should start off: ${muteOff}`)
    await click("#mute")
    const muteOn = await evaluate(`document.querySelector('#mute').getAttribute('aria-pressed') + '|' + document.querySelector('#mute').textContent.trim() + '|' + localStorage.getItem('token-quest-muted')`)
    if (muteOn !== "true|SOUND OFF|1") throw new Error(`Mute did not engage: ${muteOn}`)
    await click("#mute")
    const muteAgain = await evaluate(`document.querySelector('#mute').getAttribute('aria-pressed') + '|' + localStorage.getItem('token-quest-muted')`)
    if (muteAgain !== "false|0") throw new Error(`Unmute failed: ${muteAgain}`)
    await click("#mute")

    await evaluate(`document.querySelector('#player-name').value = 'Ada'; document.querySelector('#player-name').dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#enter-form').requestSubmit()`)
    await waitFor(`document.querySelector('#name-error').textContent.includes('first and last')`, "name validation")
    await evaluate(`document.querySelector('#player-name').value = 'Ada Lovelace'; document.querySelector('#player-name').dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#player-email').value = 'ada@example.com'; document.querySelector('#player-email').dispatchEvent(new Event('input', { bubbles: true }))`)
    if (!(await evaluate(`document.querySelector('#start-btn').disabled`))) throw new Error("START should stay disabled until consent is checked")
    await evaluate(`document.querySelector('#player-consent').checked = true; document.querySelector('#player-consent').dispatchEvent(new Event('change', { bubbles: true }))`)
    if (!(await evaluate(`!document.querySelector('#start-btn').disabled`))) throw new Error("START should enable after a valid name, email, and consent")
    await shot("1-title")
    await evaluate(`document.querySelector('#enter-form').requestSubmit()`)

    /* ---------- Intro: three booth scenes, nerd mode swaps to the five-scene deep dive ---------- */
    await waitFor(`!!document.querySelector('.intro-canvas')`, "intro")
    const SIMPLE_COPY = [
      "You ask. The AI reads your words as tokens and writes the answer one token at a time.",
      "That happens in a data center: GPUs do the maths, cooling keeps them running, wires carry the answers.",
      "Closer, cooler and better connected means faster answers for less money. Build the best AI factory you can afford!",
    ]
    const dotCount = () => evaluate(`document.querySelectorAll('.scene-dots button').length`)
    const sceneCount = await dotCount()
    if (sceneCount !== 3) throw new Error(`Expected 3 booth intro scenes, saw ${sceneCount}`)
    if (!(await evaluate(`!!document.querySelector('[data-key="nerd-toggle"]')`))) throw new Error("Intro nerd toggle is missing")
    if (await evaluate(`document.querySelector('[data-key="nerd-toggle"]').getAttribute('aria-pressed') !== 'false'`)) throw new Error("Intro nerd mode should start off")
    if (!(await evaluate(`!!document.querySelector('[data-key="intro-skip"]')`))) throw new Error("SKIP is missing")
    const sceneState = `document.querySelector('.caption b').textContent + '|' + document.querySelector('.caption p').textContent + '|' + [...document.querySelectorAll('.scene-dots .dot')].findIndex((d) => d.getAttribute('aria-current') === 'true')`
    await waitFor(`!!document.querySelector('.scene-dots .dot[aria-current="true"]')`, "intro started")
    const firstScene = await evaluate(sceneState)
    if (firstScene !== `1 · YOU ASK|${SIMPLE_COPY[0]}|0`) throw new Error(`The intro should open on scene 1 with its caption: ${firstScene}`)
    await sleep(10000)
    const stillFirst = await evaluate(sceneState)
    if (stillFirst !== firstScene) throw new Error(`The intro moved on without a click: ${firstScene} -> ${stillFirst}`)
    await click('[data-key="intro-continue"]')
    await click('[data-key="intro-continue"]')
    await sleep(450)
    const afterDouble = await evaluate(sceneState)
    if (!/\|1$/.test(afterDouble)) throw new Error(`A fast double click should move one scene only: ${afterDouble}`)
    await click('[data-key="intro-back"]')
    await sleep(450)
    if (!/\|0$/.test(await evaluate(sceneState))) throw new Error("BACK did not return to scene 1")
    if (!(await evaluate(`!!document.getElementById('nerd-bar')`))) throw new Error("Top-bar nerd toggle is missing on the intro")
    let seen = ""
    for (let i = 0; i < sceneCount; i += 1) {
      const title = await evaluate(`document.querySelector('.caption b').textContent`)
      if (!title || title === seen) throw new Error(`Scene ${i + 1} did not advance (still ${title})`)
      seen = title
      if (!title.startsWith(`${i + 1} · `)) throw new Error(`Scene ${i + 1} title is not numbered: ${title}`)
      const caption = await evaluate(`document.querySelector('.caption p').textContent`)
      if (caption !== SIMPLE_COPY[i]) throw new Error(`Scene ${i + 1} copy drifted: ${caption}`)
      const label = await evaluate(`document.querySelector('[data-key="intro-continue"]').textContent`)
      if (i === 0 && !/CLICK TO CONTINUE/.test(label)) throw new Error(`First scene button: ${label}`)
      if (i === sceneCount - 1 && !/START THE QUEST/.test(label)) throw new Error(`Last scene button: ${label}`)
      await fits(`intro scene ${i + 1}`)
      await sleep(i === 0 ? 7000 : 2500)
      await shot(`2-intro-${i + 1}`)
      if (i === 1) {
        await click('[data-key="nerd-toggle"]')
        await waitFor(`document.querySelectorAll('.scene-dots button').length === 5`, "five nerd scenes")
        await waitFor(`/HBM bandwidth|Rear Door Heat Exchanger/.test(document.querySelector('.caption p').textContent) && !document.querySelector('.nerd-tag').hidden`, "nerd caption")
        const nerdState = await evaluate(sceneState)
        if (!/^3 · THE FACTORY\|.+\|2$/.test(nerdState)) throw new Error(`Nerd on should land on the matching deep-dive scene: ${nerdState}`)
        const nerdPx = await evaluate(`parseFloat(getComputedStyle(document.querySelector('.caption.deep p')).fontSize)`)
        if (!(nerdPx >= 14)) throw new Error(`Nerd caption font is ${nerdPx}px`)
        if (await evaluate(`document.getElementById('nerd-bar').getAttribute('aria-pressed') !== 'true'`)) throw new Error("Top-bar nerd toggle did not follow the intro toggle")
        const journey = await evaluate(`[...document.querySelectorAll('.scene-dots button')].map((b) => b.getAttribute('aria-label')).join(' ')`)
        for (const stage of ["PROMPT → TOKENS", "RETRIEVAL → GENERATION", "THE FACTORY", "THE WIRES", "YOUR QUEST"]) if (!journey.includes(stage)) throw new Error(`Nerd intro lacks the ${stage} scene: ${journey}`)
        await fits("intro nerd")
        await shot("2-intro-nerd")
        await click('[data-key="nerd-toggle"]')
        await waitFor(`document.querySelectorAll('.scene-dots button').length === 3`, "three booth scenes again")
        const backState = await evaluate(sceneState)
        if (backState !== `2 · THE DATA CENTER|${SIMPLE_COPY[1]}|1`) throw new Error(`Nerd off should fold back to the matching booth scene: ${backState}`)
        await sleep(450) /* the re-mounted scene drops input for its first 400 ms, like any fresh scene */
      }
      if (i < sceneCount - 1) {
        await click('[data-key="intro-continue"]')
        await sleep(450)
      }
    }
    const quest = await evaluate(`document.querySelector('.caption p').textContent`)
    if (!/best AI factory you can afford!/.test(quest)) throw new Error(`Quest caption: ${quest}`)
    const boothJourney = await evaluate(`[...document.querySelectorAll('.scene-dots button')].map((b) => b.getAttribute('aria-label')).join(' ')`)
    for (const stage of ["YOU ASK", "THE DATA CENTER", "YOUR QUEST"]) if (!boothJourney.includes(stage)) throw new Error(`Booth intro lacks the ${stage} scene: ${boothJourney}`)
    const stamp = await evaluate(`document.getElementById('build-stamp').textContent`)
    if (!/^BUILD \d{10}-[a-f0-9]{7}$/.test(stamp)) throw new Error(`Build stamp missing: ${stamp}`)
    await click('[data-key="intro-continue"]')

    /* ---------- Use case: three big cards, MORE reveals the other three ---------- */
    await waitFor(`!!document.querySelector('[data-key="usecase-chat"]')`, "use-case screen")
    if (await evaluate(`!!document.querySelector('[data-key="score"]')`)) throw new Error("Score should stay hidden until GO")
    const featured = await evaluate(`[...document.querySelectorAll('.story-card')].map((card) => card.dataset.key).join(',')`)
    if (featured !== "usecase-chat,usecase-drug,usecase-robot") throw new Error(`Simple use-case screen should show three featured jobs: ${featured}`)
    if (!(await evaluate(`!!document.querySelector('[data-key="more-stories"]')`))) throw new Error("MORE button is missing")
    const cardShort = await evaluate(`Math.min(...[...document.querySelectorAll('.story-card, .stories .btn')].map((el) => el.getBoundingClientRect().height))`)
    if (cardShort < 64) throw new Error(`A use-case tap target is under 64px (${cardShort})`)
    const cardText = await evaluate(`document.querySelector('.story-cards').innerText`)
    for (const name of ["Customer Chat", "Drug Discovery", "Robotics"]) if (!cardText.includes(name)) throw new Error(`Featured cards lack ${name}: ${cardText}`)
    await fits("use case")
    await shot("2b-usecase")
    await click('[data-key="more-stories"]')
    await waitFor(`document.querySelectorAll('.story-card').length === 6`, "all six jobs")
    if (await evaluate(`!!document.querySelector('[data-key="more-stories"]')`)) throw new Error("MORE should disappear once every job is shown")
    await fits("use case, all jobs")
    await shot("2c-usecase-more")
    await click('[data-key="usecase-chat"]')

    /* ---------- Build (simple): three decisions, three tiles each ---------- */
    await waitFor(`!!document.querySelector('[data-key="story"]')`, "game screen")
    if (await evaluate(`!!document.querySelector('[data-key="score"]')`)) throw new Error("The build screen should not show a score")
    if (await evaluate(`!!document.querySelector('.progress, [data-key="next"]')`)) throw new Error("The step rail should be gone")
    const story = await evaluate(`document.querySelector('[data-key="story"]').innerText`)
    if (!/Shoppers want quick answers/.test(story) || !/NEW STORY/.test(story)) throw new Error(`Story line: ${story}`)
    if (!/KV memory on/.test(story)) throw new Error(`Chat should show its hidden memory default as a chip: ${story}`)
    for (const g of ["budget", "golive"]) if (!(await evaluate(`!!document.querySelector('[data-gauge="${g}"]')`))) throw new Error(`Missing the ${g} gauge`)
    for (const g of ["power", "people", "speed", "demand", "cost"]) if (await evaluate(`!!document.querySelector('[data-gauge="${g}"]')`)) throw new Error(`The simple board should hide the ${g} gauge`)
    if (await evaluate(`document.querySelector('[data-key="nerd"]').getAttribute('aria-pressed') !== 'false'`)) throw new Error("Nerd mode should stay off into the game")
    if (await evaluate(`document.getElementById('nerd-bar').getAttribute('aria-pressed') !== 'false'`)) throw new Error("Top-bar nerd toggle should show OFF in the game")
    await click('#nerd-bar')
    if (await evaluate(`document.querySelector('[data-key="nerd"]').getAttribute('aria-pressed') !== 'true'`)) throw new Error("Top-bar nerd toggle did not turn the game nerd mode on")
    await click('[data-key="nerd"]')
    if (await evaluate(`document.getElementById('nerd-bar').getAttribute('aria-pressed') !== 'false'`)) throw new Error("Game nerd toggle did not update the top bar")
    const banned = await evaluate(`(() => {
      const text = document.querySelector('.screen.game').innerText
      const rules = [/TB\\/s/, /PFLOPS/, /\\bPF\\b/, /\\bms\\b/, /\\$/, /\\bPUE\\b/, /\\bkW\\b/, /ever\\s*pure/i]
      return rules.filter((rule) => rule.test(text)).map(String).join(', ')
    })()`)
    if (banned) throw new Error(`Default game screen leaked jargon: ${banned}`)
    const rows = await evaluate(`[...document.querySelectorAll('.row-name')].map((row) => row.innerText).join('\\n')`)
    for (const title of ["GPU", "DATA HALL", "CONNECTION"]) if (!rows.includes(title)) throw new Error(`Row title missing: ${title}\n${rows}`)
    for (const title of ["CPU / DPU", "STORAGE", "MEMORY", "SITES", "ORCA"]) if (rows.includes(title)) throw new Error(`Simple board should hide ${title}\n${rows}`)
    for (const hint of ["The computers that run the AI", "Cooling and where the racks live", "How answers travel"]) if (!rows.includes(hint)) throw new Error(`Row hint missing: ${hint}\n${rows}`)
    const shape = await evaluate(`[...document.querySelectorAll('.choice-row')].map((row) => row.querySelectorAll('.tile').length).join(',')`)
    if (shape !== "3,3,3") throw new Error(`Simple board should be 3 rows of 3 tiles: ${shape}`)
    const names = await evaluate(`[...document.querySelectorAll('.screen.game .tile-title')].map((p) => p.textContent).join(' | ')`)
    for (const name of ["NVIDIA HGX B300 ×6", "NVIDIA GB200 NVL72 ×2", "NVIDIA Vera Rubin NVL72 ×1", "Air-cooled hall", "Liquid-cooled hall", "Liquid-cooled in 2 metros", "Public internet", "Peering + eyeballs", "ServiceFabric"]) if (!names.includes(name)) throw new Error(`Tile names lack ${name}: ${names}`)
    const hints = await evaluate(`[...document.querySelectorAll('.screen.game .tile-hint')].map((p) => p.textContent).join(' | ')`)
    for (const hint of ["strongest rack on air", "72 GPUs as one, liquid", "arrives late", "fans, ready now", "water to the chip", "London + Frankfurt", "slow at peaks", "home networks", "private lane"]) if (!hints.includes(hint)) throw new Error(`Tile hints lack ${hint}: ${hints}`)
    if (/\d/.test(hints.replace(/72 GPUs/g, ""))) throw new Error(`Simple hints should carry no numbers beyond the 72-GPU rack: ${hints}`)
    const pressed = await evaluate(`[...document.querySelectorAll('.choices .tile[aria-pressed="true"]')].map((t) => t.dataset.key).join(',')`)
    if (pressed !== "brains-medium,hall-cool,wires-peer") throw new Error(`Opening picture should be the middle GPU, the air hall and peering: ${pressed}`)
    await unobstructed("simple board")
    const askCount = await evaluate(`document.querySelectorAll('.learn-btn').length`)
    const tileCount = await evaluate(`document.querySelectorAll('.choices .tile').length`)
    if (askCount !== tileCount) throw new Error(`Every tile needs a ? button, saw ${askCount} of ${tileCount}`)
    await click('[data-learn="brains-medium"]')
    await waitFor(`!!document.querySelector('.learn-pop')`, "learn popover")
    const learned = await evaluate(`document.querySelector('.learn-pop').innerText`)
    if (!/Blackwell Ultra/.test(learned) || !/288 GB/.test(learned)) throw new Error(`B300 learn popover: ${learned}`)
    const popBox = await evaluate(`(() => { const r = document.querySelector('.learn-pop').getBoundingClientRect(); return r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 })()`)
    if (!popBox) throw new Error("Learn popover does not fit on screen")
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    if (await evaluate(`!!document.querySelector('.learn-pop')`)) throw new Error("Escape did not close the learn popover")
    await click('[data-learn="brains-big"]')
    await waitFor(`/NVLink/.test(document.querySelector('.learn-pop')?.innerText || '')`, "GB200 learn")
    await evaluate(`document.querySelector('.story').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
    if (await evaluate(`!!document.querySelector('.learn-pop')`)) throw new Error("A tap outside did not close the learn popover")
    /* Tile copy must sit inside its tile; on the simple board it may not even be line-clamped. */
    const CLIPPED = (strict) => `(() => {
      const bad = []
      for (const tile of document.querySelectorAll('.choices .tile')) {
        const box = tile.getBoundingClientRect()
        for (const el of tile.querySelectorAll('.tile-title, .tile-hint, .tile-tag')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0) continue
          if (r.bottom > box.bottom + 1 || r.right > box.right - 18 || r.top < box.top - 1) bad.push(el.textContent.slice(0, 32))
          else if (${strict ? "true" : "false"} && el.scrollHeight > el.clientHeight + 2) bad.push('clamped: ' + el.textContent.slice(0, 32))
        }
      }
      return bad.join(' | ')
    })()`
    const clipped = await evaluate(CLIPPED(true))
    if (clipped) throw new Error(`Tile text is clipped: ${clipped}`)
    const halls = await evaluate(`document.querySelector('[data-row="home"]').innerText`)
    if (!/Air-cooled hall/.test(halls) || !/Liquid-cooled hall/.test(halls) || !/Liquid-cooled in 2 metros/.test(halls) || /PUE|kW/.test(halls)) throw new Error(`Hall tiles: ${halls}`)
    const TAP = `Math.min(...[...document.querySelectorAll('.screen.game .tile, .screen.game .btn')].map((el) => el.getBoundingClientRect().height))`
    const short = await evaluate(TAP)
    if (short < 64) throw new Error(`A tap target is under 64px (${short})`)
    const mood = await evaluate(`document.querySelector('[data-mood]').dataset.mood + '|' + document.querySelector('.crowd-word').textContent`)
    if (mood !== "sad|WAITING") throw new Error(`Chat on one metro over peering should show a waiting crowd: ${mood}`)
    const coach = await evaluate(`document.querySelector('[data-key="coach"]').innerText`)
    if (!/far city|closer/i.test(coach)) throw new Error(`The coach should name the location decision: ${coach}`)
    await fits("game default")
    await shot("3-game-simple")

    await click('[data-key="wires-cheap"]')
    await waitFor(`document.querySelector('[data-mood]').dataset.mood === 'sad'`, "sad crowd")
    const slowCoach = await evaluate(`document.querySelector('[data-key="coach"]').innerText`)
    if (!/slow connection|slow wires/i.test(slowCoach)) throw new Error(`The coach should name the connection decision: ${slowCoach}`)
    await fits("sad crowd")
    await shot("4-sad")

    /* ---------- Drug discovery: ORCA and storage are hidden defaults, shown as chips ---------- */
    await click('[data-key="new-story"]')
    await waitFor(`!!document.querySelector('[data-key="usecase-drug"]')`, "use-case screen again")
    if (await evaluate(`document.querySelectorAll('.story-card').length !== 3`)) throw new Error("NEW STORY should return to the three featured jobs")
    await click('[data-key="usecase-drug"]')
    await waitFor(`/Scientists want new medicines/.test(document.querySelector('[data-key="story"]').innerText)`, "medicine story")
    const drugChips = await evaluate(`document.querySelector('[data-key="included"]').innerText`)
    if (!/ORCA PT-3 included/.test(drugChips) || !/File & object storage included/.test(drugChips)) throw new Error(`Drug discovery should show its hidden defaults: ${drugChips}`)
    if (await evaluate(`!!document.querySelector('[data-row="orca"], [data-key="helper"]')`)) throw new Error("The simple board should not show an ORCA row")
    const drugGpus = await evaluate(`[...document.querySelectorAll('[data-row="brains"] .tile-title')].map((el) => el.textContent).join(' | ')`)
    if (!drugGpus.includes("NVIDIA HGX B300 ×4") || !drugGpus.includes("NVIDIA GB200 NVL72 ×2")) throw new Error(`Medicine GPUs: ${drugGpus}`)
    const drugHalls = await evaluate(`[...document.querySelectorAll('[data-row="home"] .tile-title')].map((el) => el.textContent).join(' | ')`)
    if (!drugHalls.includes("Liquid-cooled + KV memory")) throw new Error(`Single-site stories should offer KV memory as the third hall: ${drugHalls}`)
    const drugText = await evaluate(`document.querySelector('.screen.game').innerText`)
    if (/\$|5,000,000/.test(drugText)) throw new Error("The medicine story leaked a price")
    await fits("medicine story")
    await shot("3-orca")
    await click('[data-key="new-story"]')
    await waitFor(`!!document.querySelector('[data-key="usecase-chat"]')`, "use cases")
    await click('[data-key="usecase-chat"]')
    await waitFor(`/Shoppers want quick answers/.test(document.querySelector('[data-key="story"]').innerText)`, "back to shoppers")

    /* ---------- Cooling lesson, then the thoughtful build ---------- */
    await click('[data-key="brains-big"]')
    const hot = await evaluate(`document.querySelector('[data-key="coach"]').innerText`)
    if (!/These racks need liquid cooling/.test(hot)) throw new Error(`Liquid racks in the air hall should warn: ${hot}`)
    await fits("cooling warning")
    await shotClip("3-cooling-air", '[data-row="home"]')
    await shot("3-cooling-warning")
    await click('[data-key="hall-plus"]')
    await click('[data-key="wires-fast"]')
    await shotClip("3-cooling-liquid", '[data-row="home"]')
    if (await evaluate(`!!document.querySelector('[data-key="score"]')`)) throw new Error("Score appeared on the build screen before GO")
    const built = await evaluate(`document.querySelector('[data-mood]').dataset.mood + '|' + document.querySelector('[data-key="coach"]').innerText`)
    if (!/^happy\|/.test(built)) throw new Error(`The thoughtful build should please the crowd: ${built}`)

    /* ---------- Nerd mode: the full board, same picks ---------- */
    await click('[data-key="nerd"]')
    await waitFor(`!!document.querySelector('[data-key="think"]')`, "how we think")
    await waitFor(`!!document.querySelector('[data-key="site-designer"]')`, "per-site designer")
    const nerdText = await evaluate(`document.querySelector('.screen.game').innerText`)
    if (!/TB\/s/.test(nerdText) || !/\bkW\b/.test(nerdText) || !/PUE/.test(nerdText) || !/\bms\b/.test(nerdText)) throw new Error(`Nerd mode should reveal the numbers: ${nerdText.slice(0, 400)}`)
    if (!/Users to site/.test(nerdText)) throw new Error(`Nerd mode should show the connection legs: ${nerdText.slice(0, 400)}`)
    if (!/HOW WE THINK/.test(nerdText) || !/tok\/s/.test(nerdText)) throw new Error(`How-we-think panel is missing: ${nerdText.slice(0, 500)}`)
    for (const name of ["CPU / DPU", "STORAGE", "MEMORY", "SITES", "Rear Door Heat Exchanger", "In-row cooling", "Direct Liquid Cooling", "Standard hosts", "Cross connect + Dark fiber"]) if (!nerdText.includes(name)) throw new Error(`Nerd mode should expose ${name}`)
    if (!(await evaluate(`!!document.querySelector('[data-key="wires-mcp"]')`))) throw new Error("ServiceFabric should carry the MCP toggle in nerd mode")
    const nerdPressed = await evaluate(`[...document.querySelectorAll('.choices .tile[aria-pressed="true"]')].map((t) => t.dataset.key).join(',')`)
    if (nerdPressed !== "brains-big,hosts-standard,memory-on,library-none,home-super,city-2,wires-fast") throw new Error(`Nerd board should carry the simple picks across: ${nerdPressed}`)
    for (const g of ["budget", "power", "golive", "speed", "demand", "cost", "people"]) if (!(await evaluate(`!!document.querySelector('[data-gauge="${g}"]')`))) throw new Error(`Nerd mode lacks the ${g} gauge`)
    const people = await evaluate(`document.querySelector('[data-key="people-count"]').textContent`)
    if (!/= about [\d,]+ people/.test(people)) throw new Error(`People-power gauge: ${people}`)
    if (/billion people/i.test(people)) throw new Error(`People-power gauge is not credible: ${people}`)
    await unobstructed("nerd mode")
    const nerdShort = await evaluate(TAP)
    if (nerdShort < 64) throw new Error(`A nerd-mode tap target is under 64px (${nerdShort})`)
    const nerdClipped = await evaluate(CLIPPED(false))
    if (nerdClipped) throw new Error(`Nerd tile text is clipped: ${nerdClipped}`)
    await shot("3-think")
    await fits("nerd mode")
    await shot("3-nerd")
    await waitFor(`!!document.querySelector('[data-key="brains-huge"]')`, "nerd brains")
    await click('[data-key="brains-huge"]')
    await waitFor(`document.querySelector('[data-gauge="budget"]').classList.contains('bad')`, "budget gauge red")
    const overGauge = await evaluate(`(() => { const g = document.querySelector('[data-gauge="people"]'); return (g.classList.contains('off') ? 'off|' : 'on|') + g.innerText })()`)
    if (!/^off\|/.test(overGauge) || !/OVER BUDGET/.test(overGauge)) throw new Error(`People-power gauge should dim with an over-budget tag: ${overGauge}`)
    const overCoach = await evaluate(`document.querySelector('[data-key="coach"]').innerText`)
    if (!/Too many GPUs for your wallet/.test(overCoach)) throw new Error(`Over-budget coach line is wrong: ${overCoach}`)
    await fits("nerd over budget")
    await shot("8-nerd-huge")
    await click('[data-key="brains-big"]')
    await click('[data-key="nerd"]')
    if (await evaluate(`/TB\\/s/.test(document.querySelector('.screen.game').innerText)`)) throw new Error("Nerd details stayed after turning nerd mode off")
    if (!(await evaluate(`/GB200 NVL72/.test(document.querySelector('.screen.game').innerText)`))) throw new Error("Product names should stay visible with nerd mode off")
    const backPressed = await evaluate(`[...document.querySelectorAll('.choices .tile[aria-pressed="true"]')].map((t) => t.dataset.key).join(',')`)
    if (backPressed !== "brains-big,hall-plus,wires-fast") throw new Error(`Simple board should keep the picks after nerd mode: ${backPressed}`)
    await fits("game built")
    await shot("3-game")

    /* ---------- GO: simple results ---------- */
    await click('[data-key="run"]')
    await waitFor(`!document.getElementById('run-overlay').hidden && document.getElementById('run-count').textContent !== '0'`, "run overlay")
    await sleep(1200)
    await shot("5-running")
    await waitFor(`!document.getElementById('result').hidden`, "results")
    await fits("results")
    await shot("6-results")
    const score = await evaluate(`document.querySelector('.big-score').textContent`)
    if (!(Number(String(score).replace(/,/g, "")) >= 1350)) throw new Error(`A thoughtful shopper build should score near 1,400 after GO, saw ${score}`)
    const resultText = await evaluate(`document.getElementById('result').innerText`)
    if (/ada@example\.com/i.test(resultText)) throw new Error("Results showed the player email")
    for (const part of ["RANK", "PLAY AGAIN", "NEXT PLAYER", "does the work of", "You beat", "DIGITAL REALTY", "Built in a Digital Realty data center: power, cooling and connections ready."]) if (!resultText.includes(part)) throw new Error(`Results lack ${part}`)
    if (!/Saving about/.test(resultText)) throw new Error(`Results lack the savings line: ${resultText}`)
    const headline = await evaluate(`document.querySelector('[data-key="headline"]').textContent`)
    if (!/^Your liquid-cooled hall in London and Frankfurt answered \d+% of shoppers in a blink over ServiceFabric: close, cool and connected\.$/.test(headline)) throw new Error(`Results headline: ${headline}`)
    const nextStep = await evaluate(`document.querySelector('[data-key="next-step"]').innerText`)
    if (!/This is the best build\./.test(nextStep)) throw new Error(`Best build should say so: ${nextStep}`)
    if (await evaluate(`!!document.querySelector('[data-key="explain"]')`)) throw new Error("Simple results should not show the full explanation")
    if (/\bms\b|Gbps|tok\/s|\bkW\b|human hours/.test(resultText)) throw new Error(`Simple results show nerd numbers: ${resultText}`)
    const starCount = await evaluate(`document.querySelectorAll('.result-head .stars img[alt*="star" i], .result-head .stars img').length`)
    if (starCount !== 3) throw new Error(`Results should show three star slots, saw ${starCount}`)
    console.log(`headline ${tag}: ${headline}`)
    await click('#nerd-bar')
    await waitFor(`!!document.querySelector('[data-key="explain"]') && /\\bms\\b|tok\\/s/.test(document.querySelector('[data-key="explain"]').innerText)`, "nerd explanation")
    if (await evaluate(`document.getElementById('nerd-bar').getAttribute('aria-pressed') !== 'true'`)) throw new Error("Top-bar nerd toggle should show ON on the results")
    const explainNerd = await evaluate(`(() => { const s = document.querySelector('[data-key="explain"]'); return s.querySelector('h3').textContent + '\\n' + [...s.querySelectorAll('li')].map((li) => li.textContent).join('\\n') })()`)
    if (!explainNerd.startsWith("WHAT YOU BUILT AND WHY IT SCORED THIS WAY")) throw new Error(`Nerd results lack the explanation: ${explainNerd}`)
    const bullets = explainNerd.split("\n").length - 1
    if (bullets < 5 || bullets > 7) throw new Error(`Explanation should have 5-7 bullets, saw ${bullets}`)
    for (const name of ["GB200 NVL72", "liquid-cooled hall", "KV cache tier", "ServiceFabric"]) if (!explainNerd.includes(name)) throw new Error(`Explanation lacks ${name}: ${explainNerd}`)
    if (!/human hours/.test(await evaluate(`document.getElementById('result').innerText`))) throw new Error("Nerd results should keep the hours line")
    await fits("results nerd")
    await shot("7-explain-nerd")
    console.log(`explain ${tag}:\n${explainNerd}`)
    await click('#nerd-bar')
    await waitFor(`!!document.querySelector('[data-key="headline"]') && !document.querySelector('[data-key="explain"]')`, "simple results again")
    const syncLine = await readSyncLine("first run")
    if (booth) noteAttempt(syncLine, "first run")
    else {
      if (!/RANK \d+ OF \d+/.test(syncLine)) throw new Error(`Offline results should show the local rank: ${syncLine}`)
      if (/@/.test(syncLine)) throw new Error("Sync line showed an email")
      const queued = await evaluate(`localStorage.getItem('token-quest-sync-queue') || ''`)
      if (!queued.includes("ada@example.com")) throw new Error("Offline attempt was not queued for the booth server")
    }

    /* ---------- Play again: the naive build (biggest GPU, air hall, public internet) ---------- */
    await click('[data-key="again"]')
    await waitFor(`!!document.querySelector('[data-key="brains-rubin"]')`, "play again")
    if (await evaluate(`!!document.querySelector('[data-key="brains-huge"]')`)) throw new Error("The four-rack Vera Rubin tile should be nerd-only")
    await click('[data-key="brains-rubin"]')
    await click('[data-key="hall-cool"]')
    await click('[data-key="wires-cheap"]')
    const naiveCoach = await evaluate(`document.querySelector('[data-key="coach"]').innerText`)
    if (!/liquid cooling/i.test(naiveCoach)) throw new Error(`Vera Rubin in the air hall should warn about cooling: ${naiveCoach}`)
    await fits("naive build")
    await shot("8-naive")
    await click('[data-key="run"]')
    await waitFor(`!document.getElementById('result').hidden`, "naive results")
    const naiveScore = await evaluate(`document.querySelector('.big-score').textContent`)
    if (naiveScore !== "0") throw new Error(`The naive build should score 0, saw ${naiveScore}`)
    await fits("naive results")
    await shot("9-naive-results")
    const naiveText = await evaluate(`document.getElementById('result').innerText`)
    const naiveHeadline = await evaluate(`document.querySelector('[data-key="headline"]').textContent`)
    if (!/overheated in the air-cooled hall in London: these racks need liquid cooling to run at full speed\.$/.test(naiveHeadline)) throw new Error(`Naive headline should blame the cooling: ${naiveHeadline}`)
    if (!/would have scored about|No single change/.test(naiveText)) throw new Error(`Naive results should point at a better tile: ${naiveText}`)
    if (/Saving about/.test(naiveText)) throw new Error(`A zero-score result must not claim the saving: ${naiveText}`)
    if (!(await evaluate(`document.querySelector('[data-key="people-card"]').classList.contains('bad')`))) throw new Error("A zero-score people card should be red")
    if (booth) {
      const secondLine = await readSyncLine("second run")
      const secondAttempt = noteAttempt(secondLine, "second run")
      if (secondAttempt === 2 && !boothChecked) await assertBoothWorkbook()
    }

    await click('[data-key="next-player"]')
    await waitFor(`!!document.querySelector('.league li')`, "league row")
    const board = await evaluate(`document.querySelector('.league').innerText`)
    if (!board.includes("ADA LOVELACE")) throw new Error(`League missed the player: ${board}`)
    if (/@/.test(board)) throw new Error(`League board showed an email: ${board}`)
    const cleared = await evaluate(`document.querySelector('#player-name').value + '|' + document.querySelector('#player-email').value + '|' + document.querySelector('#player-consent').checked`)
    if (cleared !== "||false") throw new Error(`Next player still sees the last entry: ${cleared}`)
    const muteKept = await evaluate(`document.querySelector('#mute').getAttribute('aria-pressed') + '|' + localStorage.getItem('token-quest-muted')`)
    if (muteKept !== "true|1") throw new Error(`Reset cleared the kiosk mute: ${muteKept}`)
    const stored = await evaluate(`localStorage.getItem('token-quest-league-v1')`)
    if (!stored.includes("ada@example.com")) throw new Error("League entry did not keep the email for staff export")
    if (!/"useCase":"chat"/.test(stored) || !/"costPerM":/.test(stored)) throw new Error(`League entry lacks scenario or $/M: ${stored}`)
    if (booth && !boothChecked) await resetBooth()
    if (errors.length) throw new Error(`Page errors: ${errors.join(" | ")}`)
    console.log(`smoke ok ${tag}: score ${score}`)
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
