import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"

const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const base = process.env.GAME_URL || "http://127.0.0.1:8080/"
const shots = process.env.SHOTS || ""
const port = 9333
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--autoplay-policy=no-user-gesture-required", `--remote-debugging-port=${port}`, "--window-size=1600,1000", "about:blank"], { stdio: "ignore" })

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
    for (let i = 0; i < 60; i += 1) {
      if (await evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`Timed out waiting for ${label}`)
  }
  const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ${selector}'); el.click(); return true })()`)
  const shot = async (name) => {
    if (!shots) return
    await sleep(250)
    const { result } = await send("Page.captureScreenshot", { format: "png" })
    mkdirSync(shots, { recursive: true })
    writeFileSync(`${shots}/${name}.png`, Buffer.from(result.data, "base64"))
  }

  await send("Page.enable")
  await send("Runtime.enable")
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send("Page.navigate", { url: base })
  await waitFor(`!!document.querySelector('#player-name')`, "title screen")
  await evaluate(`localStorage.clear()`)
  await send("Page.navigate", { url: base })
  await waitFor(`!!document.querySelector('#player-name')`, "title screen")
  await evaluate(`document.fonts.ready.then(() => true)`)
  await shot("1-title")

  await evaluate(`document.querySelector('#player-name').value = 'Ada'; document.querySelector('#enter-form').requestSubmit()`)
  await waitFor(`document.querySelector('#name-error').textContent.includes('first and last')`, "name validation")
  await evaluate(`document.querySelector('#player-name').value = 'Ada Lovelace'; document.querySelector('#enter-form').requestSubmit()`)
  await waitFor(`!!document.querySelector('.intro-canvas')`, "intro")
  await sleep(14500)
  await shot("2-intro-retrieval")
  await sleep(6000)
  await shot("3-intro-prefill")
  await click('[data-key="intro-skip"]')

  await waitFor(`!!document.querySelector('[data-key="mission-chat"]')`, "missions")
  for (const m of ["chat", "rag", "drug"]) await click(`[data-key="mission-${m}"]`)
  await shot("4-missions")
  await click('[data-key="to-halls"]')
  await waitFor(`!!document.querySelector('[data-key="hall-chat-B"]')`, "halls")
  await click('[data-key="hall-chat-B"]')
  await click('[data-key="hall-rag-B"]')
  await click('[data-key="hall-drug-A"]')
  await shot("5-halls")
  await click('[data-key="to-build"]')

  await waitFor(`!!document.querySelector('[data-key="gpu-vr"]')`, "build")
  await click('[data-key="gpu-vr"]')
  await click('[data-key="kv"]')
  await shot("6-build-chat")
  await click('[data-key="next-mission"]')
  await click('[data-key="gpu-vr"]')
  await click('[data-key="data-file"]')
  await click('[data-key="kv"]')
  await click('[data-key="next-mission"]')
  const vrBlocked = await evaluate(`document.querySelector('[data-key="gpu-vr"]').disabled`)
  if (!vrBlocked) throw new Error("Vera Rubin should be blocked in the air hall")
  await click('[data-key="gpu-b300"]')
  for (let i = 0; i < 4; i += 1) await click('[data-key="racks-p1"]')
  await click('[data-key="data-file"]')
  await click('[data-key="orca"]')
  await shot("7-build-drug")
  await waitFor(`!document.querySelector('[data-key="to-floor"]').disabled`, "valid plan")
  await click('[data-key="to-floor"]')

  await waitFor(`!!document.querySelector('[data-key="run"]')`, "floor")
  await sleep(300)
  await shot("8-floor")
  await click('[data-key="run"]')
  await sleep(2500)
  await shot("9-running")
  await waitFor(`!document.getElementById('result').hidden`, "results")
  await shot("10-results")
  const score = await evaluate(`document.querySelector('.big-score').textContent`)
  const banner = await evaluate(`document.querySelector('.banner').textContent`)
  await click('[data-key="next-player"]')
  await waitFor(`!!document.querySelector('.league li')`, "league row")
  const board = await evaluate(`document.querySelector('.league').textContent`)
  if (!board.includes("ADA LOVELACE")) throw new Error(`League missed the player: ${board}`)
  if (errors.length) throw new Error(`Page errors: ${errors.join(" | ")}`)
  console.log(`smoke ok: score ${score} · ${banner}`)
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
