/**
 * js/sync.js against the hosted intake: where the /api calls go, what gets queued for a retry,
 * and how scripts/build-static.mjs injects the intake URL into dist/index.html.
 */
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { QUEUE_KEY, bindSync, fetchLeague, flushQueue, pendingCount, recordAttempt, resolveIntakeBase } from "../js/sync.js"
import { build, injectIntake, intakeScript, normaliseIntakeUrl } from "../scripts/build-static.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const INTAKE = "https://token-quest-intake.example.workers.dev"

const attempt = (overrides = {}) => ({
  name: "Ada Lovelace",
  email: "ada@example.com",
  score: 900,
  useCase: "Chat + RAG",
  consent: true,
  consentAt: "2026-10-16T14:00:00.000Z",
  playedAt: "2026-10-16T14:05:00.000Z",
  ...overrides,
})

function memoryStorage() {
  const mem = new Map()
  return {
    mem,
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => mem.set(key, String(value)),
    removeItem: (key) => mem.delete(key),
  }
}

/** A fetch that answers from a script of [status, body] replies and records every call. */
function scriptedFetch(replies) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null })
    const next = replies.length > 1 ? replies.shift() : replies[0]
    if (next === "offline") throw new TypeError("fetch failed")
    const [status, body] = next
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  }
  return { fetch, calls }
}

test("resolveIntakeBase: absolute http(s) URLs without a trailing slash, same origin for everything else", () => {
  assert.equal(resolveIntakeBase(undefined), "")
  assert.equal(resolveIntakeBase(""), "")
  assert.equal(resolveIntakeBase("   "), "")
  assert.equal(resolveIntakeBase(42), "")
  assert.equal(resolveIntakeBase("/api"), "", "relative paths mean same origin")
  assert.equal(resolveIntakeBase("ftp://x.example"), "")
  assert.equal(resolveIntakeBase("javascript:alert(1)"), "")
  assert.equal(resolveIntakeBase(`${INTAKE}/`), INTAKE)
  assert.equal(resolveIntakeBase(` ${INTAKE}// `), INTAKE)
  assert.equal(resolveIntakeBase("http://127.0.0.1:8787"), "http://127.0.0.1:8787")
  assert.equal(resolveIntakeBase("https://example.com/intake/"), "https://example.com/intake")
  assert.equal(resolveIntakeBase("https://user:pw@example.com"), "", "credentials are refused")
  assert.equal(resolveIntakeBase("https://example.com/?x=1"), "", "query strings are refused")
  assert.equal(bindSync().baseUrl, "", "no window.TOKEN_QUEST_INTAKE here, so the kiosk default applies")
})

test("recordAttempt, fetchLeague and flushQueue call the intake base URL", async () => {
  const storage = memoryStorage()
  const { fetch, calls } = scriptedFetch([
    [200, { ok: true, attempts: 1, best: 900, latest: 900, rank: 1, players: 1, newBest: true }],
    [200, { ok: true, players: [{ rank: 1, name: "Ada Lovelace", attempts: 1, best: 900, latest: 900, bestUseCase: "Chat + RAG", fteEquivalent: null }], attempts: 1 }],
  ])
  bindSync({ fetch, storage, baseUrl: resolveIntakeBase(`${INTAKE}/`) })

  const result = await recordAttempt(attempt())
  assert.equal(result.ok, true)
  assert.equal(result.rank, 1)
  assert.equal(calls[0].url, `${INTAKE}/api/attempt`)
  assert.equal(calls[0].method, "POST")
  assert.equal(calls[0].body.email, "ada@example.com")

  const board = await fetchLeague()
  assert.equal(calls[1].url, `${INTAKE}/api/league`)
  assert.equal(board[0].name, "Ada Lovelace")
  assert.equal(pendingCount(), 0)

  bindSync({ baseUrl: "" })
  await recordAttempt(attempt({ playedAt: "2026-10-16T14:06:00.000Z" }))
  assert.equal(calls[2].url, "/api/attempt", "same origin when no intake is configured (the kiosk)")
})

test("a 5xx, a 429 or a store_unavailable body keeps the attempt queued; a 400 drops it", async () => {
  const storage = memoryStorage()
  const game = attempt({ playedAt: "2026-10-16T14:07:00.000Z" })

  const unavailable = scriptedFetch([[503, { ok: false, error: "store_unavailable", message: "The player sheet could not be updated." }]])
  bindSync({ fetch: unavailable.fetch, storage, baseUrl: INTAKE })
  assert.deepEqual(await recordAttempt(game), { ok: false, offline: true, queued: 1 })
  assert.equal(JSON.parse(storage.mem.get(QUEUE_KEY))[0].attempt.playedAt, game.playedAt, "the queued payload is the one that was posted, unchanged")

  const wrongStatus = scriptedFetch([[200, { ok: false, error: "store_unavailable", message: "stored nowhere" }]])
  bindSync({ fetch: wrongStatus.fetch })
  const flushed = await flushQueue()
  assert.deepEqual(flushed, { sent: 0, remaining: 1 }, "store_unavailable is retried whatever the status code")
  assert.equal(JSON.parse(storage.mem.get(QUEUE_KEY))[0].tries, 1)

  const throttled = scriptedFetch([[429, { ok: false, error: "rate_limited", message: "slow down" }]])
  bindSync({ fetch: throttled.fetch })
  assert.deepEqual(await flushQueue(), { sent: 0, remaining: 1 }, "429 is a retry, not a rejection")
  assert.deepEqual(await recordAttempt(attempt({ playedAt: "2026-10-16T14:08:00.000Z" })), { ok: false, offline: true, queued: 2 })

  const offline = scriptedFetch(["offline"])
  bindSync({ fetch: offline.fetch })
  assert.deepEqual(await flushQueue(), { sent: 0, remaining: 2 })
  assert.equal(await fetchLeague(), null)

  const rejected = scriptedFetch([[400, { ok: false, error: "invalid_attempt", message: "The attempt was rejected.", details: ["email must be a valid email address"] }]])
  bindSync({ fetch: rejected.fetch })
  const bad = await recordAttempt(attempt({ email: "nope", playedAt: "2026-10-16T14:09:00.000Z" }))
  assert.equal(bad.error, "invalid_attempt")
  assert.equal(pendingCount(), 0, "a 400 drops the live attempt and also the two queued ones (the server rejected them)")

  const recovering = scriptedFetch([[503, { ok: false, error: "store_unavailable" }]])
  bindSync({ fetch: recovering.fetch })
  await recordAttempt(game)
  assert.equal(pendingCount(), 1)
  const healthy = scriptedFetch([[200, { ok: true, attempts: 1, best: 900, latest: 900, rank: 1, players: 1, newBest: true }]])
  bindSync({ fetch: healthy.fetch })
  assert.deepEqual(await flushQueue(), { sent: 1, remaining: 0 })
  assert.equal(healthy.calls[0].url, `${INTAKE}/api/attempt`)
  assert.deepEqual(healthy.calls[0].body, game, "the retried payload is identical, so the Worker treats it as the same game")
  assert.equal(storage.mem.has(QUEUE_KEY), false)
})

test("build-static: the intake URL is validated and injected as one script line before </head>", async () => {
  assert.equal(normaliseIntakeUrl(undefined), "")
  assert.equal(normaliseIntakeUrl("  "), "")
  assert.equal(normaliseIntakeUrl(`${INTAKE}/`), INTAKE)
  assert.equal(normaliseIntakeUrl("https://example.com/intake//"), "https://example.com/intake")
  assert.throws(() => normaliseIntakeUrl("token-quest-intake.example.workers.dev"), /absolute URL/)
  assert.throws(() => normaliseIntakeUrl("ftp://example.com"), /http\(s\)/)
  assert.throws(() => normaliseIntakeUrl(`${INTAKE}?x=1`), /query/)
  assert.throws(() => normaliseIntakeUrl("https://user:pw@example.com"), /credentials/)

  assert.equal(intakeScript(INTAKE), `<script>window.TOKEN_QUEST_INTAKE = "${INTAKE}"</script>`)
  assert.ok(!intakeScript("https://example.com/</script><script>alert(1)//").includes("</script><script>"), "a hostile URL cannot close the script tag")

  const html = "<!DOCTYPE html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body></body>\n</html>\n"
  assert.equal(injectIntake(html, ""), html, "nothing is injected without an intake URL")
  const injected = injectIntake(html, INTAKE)
  assert.ok(injected.includes(`    <title>x</title>\n    ${intakeScript(INTAKE)}\n  </head>`), injected)
  assert.equal(injected.split("TOKEN_QUEST_INTAKE").length - 1, 1)
  assert.throws(() => injectIntake("<html><body></body></html>", INTAKE), /<\/head>/)
})

test("build-static: dist/index.html carries the intake URL only when the build was given one", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "token-quest-dist-"))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const plain = await build({ out: path.join(dir, "plain"), base: "/JRRToken" })
  const plainHtml = await readFile(path.join(plain.dist, "index.html"), "utf8")
  assert.ok(!plainHtml.includes("TOKEN_QUEST_INTAKE"), "no INTAKE_URL: the hosted game is the local-league demo")
  assert.equal(plain.intake, "")

  const logs = []
  const hosted = await build({ out: path.join(dir, "hosted"), base: "/JRRToken", intake: INTAKE, log: (line) => logs.push(line) })
  const hostedHtml = await readFile(path.join(hosted.dist, "index.html"), "utf8")
  assert.equal(hostedHtml.split("TOKEN_QUEST_INTAKE").length - 1, 1)
  assert.ok(hostedHtml.indexOf(intakeScript(INTAKE)) < hostedHtml.indexOf("</head>"), "the intake line runs before the module script")
  assert.ok(hostedHtml.indexOf(intakeScript(INTAKE)) < hostedHtml.indexOf('<script type="module"'))
  assert.ok(logs.some((line) => line.includes(`intake URL: ${INTAKE}`)), logs.join("\n"))
  assert.equal(await readFile(path.join(ROOT, "index.html"), "utf8").then((source) => source.includes("TOKEN_QUEST_INTAKE")), false, "the source index.html is never touched")

  // The CLI reads INTAKE_URL from the environment, which is how the Pages workflow passes it.
  const out = path.join(dir, "cli")
  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "build-static.mjs"), "--out", out, "--base", "/JRRToken"], {
    env: { ...process.env, INTAKE_URL: `${INTAKE}/` },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  child.stdout.on("data", (chunk) => (output += chunk))
  child.stderr.on("data", (chunk) => (output += chunk))
  const code = await new Promise((resolve) => child.once("exit", resolve))
  assert.equal(code, 0, output)
  assert.ok((await readFile(path.join(out, "index.html"), "utf8")).includes(intakeScript(INTAKE)), "trailing slash normalised, script present")
  assert.match(output, /intake URL: https:\/\/token-quest-intake\.example\.workers\.dev/)

  const bad = spawn(process.execPath, [path.join(ROOT, "scripts", "build-static.mjs"), "--out", path.join(dir, "bad")], { env: { ...process.env, INTAKE_URL: "not a url" }, stdio: ["ignore", "pipe", "pipe"] })
  let badOutput = ""
  bad.stderr.on("data", (chunk) => (badOutput += chunk))
  assert.equal(await new Promise((resolve) => bad.once("exit", resolve)), 2)
  assert.match(badOutput, /INTAKE_URL must be an absolute URL/)
})
