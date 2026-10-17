import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { QUEUE_KEY, bindSync, fetchLeague, flushQueue, pendingCount, recordAttempt } from "../js/sync.js"
import { createApp } from "../server/app.mjs"
import { ConfigError, loadConfig, parseEnvFile, parseUpstreamUrl, withEnvFile } from "../server/config.mjs"
import { Exporter } from "../server/export.mjs"
import { mergeLeague } from "../server/merge.mjs"
import { aggregatePlayers, publicLeague } from "../server/players.mjs"
import { resolveStaticPath } from "../server/static.mjs"
import { AttemptStore, attemptKey } from "../server/store.mjs"
import { QUEUE_FILE, createUpstream, forwardPayload, parseQueueLog } from "../server/upstream.mjs"
import { validateAttempt } from "../server/validate.mjs"
import { readZip } from "../server/xlsx.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PIN = "4242"
const EMAIL = "ada@example.com"
const UPSTREAM_KEY = "test-upstream-key-not-a-real-secret"

const servers = []

/** Spawns scripts/serve.mjs on an ephemeral port with its own temp DATA_DIR and EXPORT_PATH. */
async function startServer(extraEnv = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "token-quest-test-"))
  const env = {
    ...process.env,
    DATA_DIR: path.join(dir, "data"),
    EXPORT_PATH: path.join(dir, "export", "Token Quest Leaderboard.xlsx"),
    STAFF_PIN: "",
    HOST: "",
    PORT: "",
    // Never pick up the developer's real .env or team server from the test suite.
    ENV_FILE: "off",
    UPSTREAM_URL: "",
    UPSTREAM_KEY: "",
    ...extraEnv,
  }
  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "serve.mjs"), "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 15000)
    const onData = (chunk) => {
      output += chunk
      const match = /listening on (http:\/\/[^\s]+\/)/.exec(output)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited with ${code}:\n${output}`))
    })
  })
  const handle = {
    url: url.replace(/\/$/, ""),
    dir,
    env,
    output: () => output,
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve))
        child.kill("SIGTERM")
        await exited
      }
      await rm(dir, { recursive: true, force: true })
    },
  }
  servers.push(handle)
  return handle
}

function json(method, url, body, headers = {}) {
  return fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
}

/** Sends the path verbatim (fetch would normalise "/../"). */
function raw(base, rawPath, { method = "GET", headers = {} } = {}) {
  const { hostname, port } = new URL(base)
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: rawPath, method, headers }, (res) => {
      let body = ""
      res.on("data", (chunk) => (body += chunk))
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on("error", reject)
    req.end()
  })
}

async function waitFor(check, label, timeout = 6000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

const attempt = (overrides = {}) => ({
  name: "Ada Lovelace",
  email: EMAIL,
  score: 900,
  useCase: "Chat + RAG",
  costPerMTok: 1.5,
  profitPerHour: 4200,
  fteEquivalent: 2.5,
  annualSavings: 120000,
  humanHoursPerYear: 4500,
  scenario: "London launch",
  consent: true,
  consentAt: "2026-10-08T09:00:00.000Z",
  playedAt: "2026-10-08T09:05:00.000Z",
  ...overrides,
})

test("validateAttempt normalises good input and rejects bad input", () => {
  const good = validateAttempt(attempt({ name: "  Ada   Lovelace ", email: " Ada@Example.COM ", consentAt: 1791000000000, useCase: "Chat\u0000 + RAG" }))
  assert.equal(good.ok, true)
  assert.equal(good.attempt.name, "Ada Lovelace")
  assert.equal(good.attempt.email, EMAIL)
  assert.equal(good.attempt.useCase, "Chat + RAG")
  assert.equal(good.attempt.consentAt, new Date(1791000000000).toISOString())
  assert.equal(good.attempt.playedAt, "2026-10-08T09:05:00.000Z")
  assert.equal(validateAttempt(attempt({ name: "Zoë O'Brien-Smith" })).ok, true)
  assert.equal(validateAttempt(attempt({ playedAt: undefined })).ok, true, "playedAt is optional")
  assert.equal(validateAttempt(attempt({ costPerMTok: null, profitPerHour: undefined, useCase: undefined })).ok, true)
  assert.deepEqual(
    [good.attempt.fteEquivalent, good.attempt.annualSavings, good.attempt.humanHoursPerYear, good.attempt.scenario],
    [2.5, 120000, 4500, "London launch"],
    "people-power fields are kept",
  )
  const legacy = validateAttempt(attempt({ fteEquivalent: undefined, annualSavings: undefined, humanHoursPerYear: undefined, scenario: undefined }))
  assert.equal(legacy.ok, true, "people-power fields are optional")
  assert.deepEqual([legacy.attempt.fteEquivalent, legacy.attempt.annualSavings, legacy.attempt.humanHoursPerYear, legacy.attempt.scenario], [null, null, null, ""])
  assert.equal(validateAttempt(attempt({ annualSavings: -250000 })).ok, true, "savings may be negative")
  assert.equal(validateAttempt(attempt({ scenario: " Ashburn\u0007 edge " })).attempt.scenario, "Ashburn edge")
  assert.equal(validateAttempt(attempt({ scenario: "s".repeat(80) })).attempt.scenario.length, 60, "scenario is clipped to 60 chars")

  const bad = (overrides) => validateAttempt(attempt(overrides))
  for (const [label, overrides] of [
    ["short name", { name: "A" }],
    ["long name", { name: "A".repeat(41) }],
    ["digits in name", { name: "R2 D2" }],
    ["html in name", { name: "<b>Ada</b>" }],
    ["bad email", { email: "not-an-email" }],
    ["email without tld", { email: "ada@localhost" }],
    ["negative score", { score: -1 }],
    ["string score", { score: "900" }],
    ["NaN score", { score: Number.NaN }],
    ["consent false", { consent: false }],
    ["consent string", { consent: "true" }],
    ["missing consentAt", { consentAt: undefined }],
    ["garbage consentAt", { consentAt: "yesterday" }],
    ["ancient playedAt", { playedAt: "1999-12-31T00:00:00Z" }],
    ["negative cost", { costPerMTok: -2 }],
    ["string profit", { profitPerHour: "lots" }],
    ["object useCase", { useCase: { id: "chat" } }],
    ["negative fte", { fteEquivalent: -1 }],
    ["string fte", { fteEquivalent: "3" }],
    ["infinite savings", { annualSavings: Number.POSITIVE_INFINITY }],
    ["negative hours", { humanHoursPerYear: -5 }],
    ["object scenario", { scenario: { id: "lon" } }],
  ]) {
    const result = bad(overrides)
    assert.equal(result.ok, false, label)
    assert.ok(result.errors.length > 0, label)
  }
  assert.equal(validateAttempt(null).ok, false)
  assert.equal(validateAttempt([]).ok, false)
})

test("aggregatePlayers keys by email, ranks by best score and publicLeague drops emails", () => {
  const players = aggregatePlayers([
    { ...attempt(), score: 500, playedAt: "2026-10-08T09:00:00.000Z", fteEquivalent: 1, annualSavings: 10 },
    { ...attempt(), name: "Ada L", score: 900, useCase: "RAG", costPerMTok: 0.9, fteEquivalent: 7.5, annualSavings: 300000, playedAt: "2026-10-08T09:10:00.000Z" },
    { ...attempt(), score: 700, playedAt: "2026-10-08T09:20:00.000Z", useCase: "Chat", fteEquivalent: 3, annualSavings: 20 },
    { ...attempt({ name: "Grace Hopper", email: "grace@example.com", score: 900, playedAt: "2026-10-08T09:30:00.000Z" }) },
    { ...attempt({ name: "Alan Turing", email: "alan@example.com", score: 1200, playedAt: "2026-10-08T08:00:00.000Z" }) },
  ])
  assert.deepEqual(players.map((player) => [player.rank, player.email, player.best, player.attempts, player.latest]), [
    [1, "alan@example.com", 1200, 1, 1200],
    [2, EMAIL, 900, 3, 700],
    [3, "grace@example.com", 900, 1, 900],
  ])
  const ada = players[1]
  assert.equal(ada.name, "Ada Lovelace", "name follows the latest attempt")
  assert.equal(ada.bestUseCase, "RAG")
  assert.equal(ada.bestCostPerMTok, 0.9)
  assert.equal(ada.bestFteEquivalent, 7.5, "people-power follows the best attempt")
  assert.equal(ada.bestAnnualSavings, 300000)
  assert.equal(ada.firstPlayedAt, "2026-10-08T09:00:00.000Z")
  assert.equal(ada.lastPlayedAt, "2026-10-08T09:20:00.000Z")
  const board = publicLeague(players)
  assert.deepEqual(Object.keys(board[0]).sort(), ["attempts", "best", "bestUseCase", "firstPlayedAt", "fteEquivalent", "lastPlayedAt", "latest", "name", "rank"])
  assert.equal(board[1].fteEquivalent, 7.5)
  assert.ok(!JSON.stringify(board).includes("@"))
  assert.ok(!JSON.stringify(board).includes("annualSavings"), "money details stay off the public board")
})

test("resolveStaticPath refuses private folders and file types regardless of what exists on disk", () => {
  const root = "/srv/kiosk"
  assert.equal(resolveStaticPath(root, "/index.html"), "/srv/kiosk/index.html")
  assert.equal(resolveStaticPath(root, "/js/main.js"), "/srv/kiosk/js/main.js")
  assert.equal(resolveStaticPath(root, "/img/logo.png"), "/srv/kiosk/img/logo.png", "other asset folders stay allowed")
  for (const denied of [
    "/data/attempts.jsonl",
    "/DATA/attempts.jsonl",
    "/data/",
    "/data",
    "/server/app.mjs",
    "/scripts/serve.mjs",
    "/tests/server.test.js",
    "/node_modules/x/index.js",
    "/js/notes.jsonl",
    "/assets/leaderboard.xlsx",
    "/assets/Leaderboard.XLSX",
    "/.env",
    "/js/.env.local",
    "/js/prod.env",
    "/.git/HEAD",
    "/js/../data/attempts.jsonl",
    "/%2e%2e/data/attempts.jsonl",
  ]) {
    assert.equal(resolveStaticPath(root, denied), null, `${denied} must resolve to nothing`)
  }
})

/** A throwaway "repo root" with the kiosk files plus everything that must never be served. */
async function makeFixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "token-quest-root-"))
  const files = {
    "index.html": "<!doctype html><title>Fixture Quest</title>",
    "css/game.css": "body{}",
    "js/main.js": "export {}",
    "img/logo.svg": "<svg/>",
    "data/attempts.jsonl": `${JSON.stringify(attempt({ email: "secret@example.com" }))}\n`,
    "data/Token Quest Leaderboard.xlsx": "PK fake",
    "server/app.mjs": "export const secret = 1",
    "scripts/serve.mjs": "console.log(1)",
    "tests/server.test.js": "// test",
    ".env": "STAFF_PIN=1234",
    "js/.env.local": "STAFF_PIN=1234",
    "js/debug.jsonl": "{}",
    "package.json": JSON.stringify({ name: "fixture" }),
  }
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), body)
  }
  return root
}

/** Runs createApp() in-process against a fixture root so the result never depends on this repo's ./data. */
async function listenFixtureApp(root, dataDir) {
  const store = await new AttemptStore(dataDir).init()
  const exporter = new Exporter(store, path.join(root, "export", "out.xlsx"))
  const server = createApp({ root, dataDir, exportPath: exporter.exportPath, staffPin: null, host: "127.0.0.1", lan: false }, { store, exporter })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  return { url, close: () => new Promise((resolve) => server.close(resolve)) }
}

test("static guard: a populated default ./data is 404 whatever DATA_DIR points at", async (t) => {
  const root = await makeFixtureRoot()
  const elsewhere = await mkdtemp(path.join(os.tmpdir(), "token-quest-data-"))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(elsewhere, { recursive: true, force: true })
  })
  const privatePaths = [
    "/data/attempts.jsonl",
    "/data/Token%20Quest%20Leaderboard.xlsx",
    "/data/",
    "/server/app.mjs",
    "/scripts/serve.mjs",
    "/tests/server.test.js",
    "/.env",
    "/js/.env.local",
    "/js/debug.jsonl",
    "/js/../data/attempts.jsonl",
  ]
  const configs = [
    ["default DATA_DIR (<root>/data)", path.join(root, "data")],
    ["DATA_DIR given through a relative hop", path.join(root, "js", "..", "data")],
    ["DATA_DIR somewhere else entirely", elsewhere],
  ]
  for (const [label, dataDir] of configs) {
    const app = await listenFixtureApp(root, dataDir)
    try {
      const index = await fetch(`${app.url}/`)
      assert.equal(index.status, 200, `${label}: index`)
      assert.match(await index.text(), /Fixture Quest/)
      assert.equal((await fetch(`${app.url}/js/main.js`)).status, 200, `${label}: js`)
      assert.equal((await fetch(`${app.url}/css/game.css`)).status, 200, `${label}: css`)
      assert.equal((await fetch(`${app.url}/img/logo.svg`)).status, 200, `${label}: other asset folders`)
      for (const bad of privatePaths) {
        const response = await raw(app.url, bad)
        assert.equal(response.status, 404, `${label}: ${bad}`)
        assert.ok(!response.body.includes("secret@example.com"), `${label}: ${bad} leaked an email`)
        assert.ok(!response.body.includes("STAFF_PIN"), `${label}: ${bad} leaked the env file`)
      }
    } finally {
      await app.close()
    }
  }
})

test("server: static files, API, aggregation, Excel export, staff gating", async (t) => {
  const server = await startServer({ STAFF_PIN: PIN })
  const { url } = server

  await t.test("serves index.html fresh with the right MIME types", async () => {
    const index = await fetch(`${url}/`)
    assert.equal(index.status, 200)
    assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8")
    assert.equal(index.headers.get("cache-control"), "no-store")
    assert.match(await index.text(), /<title>Token Quest/)

    const script = await fetch(`${url}/js/main.js`)
    assert.equal(script.status, 200)
    assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8")
    assert.equal(script.headers.get("cache-control"), "no-store")

    const css = await fetch(`${url}/css/game.css`)
    assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8")

    const font = await fetch(`${url}/assets/fonts/press-start-2p-latin-400-normal.woff2`)
    assert.equal(font.status, 200)
    assert.equal(font.headers.get("content-type"), "font/woff2")
    assert.match(font.headers.get("cache-control"), /max-age/)

    const head = await fetch(`${url}/index.html`, { method: "HEAD" })
    assert.equal(head.status, 200)
    assert.equal((await head.arrayBuffer()).byteLength, 0)

    assert.equal((await fetch(`${url}/nope.html`)).status, 404)
    assert.equal((await fetch(`${url}/js/`)).status, 404, "no directory listings")
    assert.equal((await fetch(`${url}/`, { method: "POST" })).status, 405)
  })

  await t.test("blocks path traversal, dot-files, private folders and the data directory", async () => {
    for (const bad of [
      "/../package.json",
      "/js/../../package.json",
      "/%2e%2e/package.json",
      "/..%2fpackage.json",
      "/.git/HEAD",
      "/.gitignore",
      "/js/%00main.js",
      "/data/attempts.jsonl",
      "/data/",
      "/server/app.mjs",
      "/server/static.mjs",
      "/scripts/serve.mjs",
      "/tests/server.test.js",
    ]) {
      const response = await raw(url, bad)
      assert.equal(response.status, 404, `${bad} must not be served`)
      assert.ok(!response.body.includes('"name": "the-hall"'), `${bad} leaked package.json`)
      assert.ok(!response.body.includes("@"), `${bad} leaked an address`)
    }
    assert.equal((await fetch(`${url}/data/attempts.jsonl`)).status, 404)
  })

  await t.test("rejects invalid attempts with 400 and never echoes input", async () => {
    const invalid = await json("POST", `${url}/api/attempt`, attempt({ email: "nope", consent: false, name: "<script>alert(1)</script>" }))
    assert.equal(invalid.status, 400)
    const body = await invalid.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, "invalid_attempt")
    assert.ok(Array.isArray(body.details) && body.details.length >= 3)
    assert.ok(!JSON.stringify(body).includes("<script>"))

    const notJson = await fetch(`${url}/api/attempt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" })
    assert.equal(notJson.status, 400)
    assert.equal((await notJson.json()).error, "bad_json")

    const wrongType = await fetch(`${url}/api/attempt`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(attempt()) })
    assert.equal(wrongType.status, 415)

    const huge = await json("POST", `${url}/api/attempt`, attempt({ useCase: "x".repeat(70 * 1024) }))
    assert.equal(huge.status, 413)

    const crossSite = await json("POST", `${url}/api/attempt`, attempt(), { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" })
    assert.equal(crossSite.status, 403)

    assert.equal((await fetch(`${url}/api/attempt`)).status, 405)
    assert.equal((await fetch(`${url}/api/nothing`)).status, 404)
    assert.equal((await fetch(`${url}/api/league`)).headers.get("content-type"), "application/json; charset=utf-8")
  })

  await t.test("records attempts and aggregates per email", async () => {
    const first = await (await json("POST", `${url}/api/attempt`, attempt({ score: 900 }))).json()
    assert.deepEqual({ ok: first.ok, attempts: first.attempts, best: first.best, rank: first.rank, newBest: first.newBest }, { ok: true, attempts: 1, best: 900, rank: 1, newBest: true })

    const second = await (
      await json("POST", `${url}/api/attempt`, attempt({ email: " ADA@Example.com ", score: 1200, useCase: "Drug discovery", fteEquivalent: 9, annualSavings: -5000, humanHoursPerYear: 16000, scenario: "Ashburn", playedAt: "2026-10-08T09:15:00.000Z" }))
    ).json()
    assert.equal(second.attempts, 2, "same email, different case -> same player")
    assert.equal(second.best, 1200)
    assert.equal(second.latest, 1200)
    assert.equal(second.rank, 1)

    const third = await (await json("POST", `${url}/api/attempt`, attempt({ score: 1000, playedAt: "2026-10-08T09:20:00.000Z" }))).json()
    assert.equal(third.attempts, 3)
    assert.equal(third.best, 1200, "best is the max, not the latest")
    assert.equal(third.latest, 1000)
    assert.equal(third.newBest, false)

    const rival = await (await json("POST", `${url}/api/attempt`, attempt({ name: "Grace Hopper", email: "grace@example.com", score: 1500, playedAt: "2026-10-08T09:25:00.000Z" }))).json()
    assert.equal(rival.rank, 1)
    assert.equal(rival.players, 2)

    const league = await (await fetch(`${url}/api/league`)).json()
    assert.equal(league.ok, true)
    assert.equal(league.attempts, 4)
    assert.deepEqual(league.players.map((player) => [player.rank, player.name, player.attempts, player.best, player.latest, player.bestUseCase, player.fteEquivalent]), [
      [1, "Grace Hopper", 1, 1500, 1500, "Chat + RAG", 2.5],
      [2, "Ada Lovelace", 3, 1200, 1000, "Drug discovery", 9],
    ])
    assert.equal(league.players[1].firstPlayedAt, "2026-10-08T09:05:00.000Z")
    assert.equal(league.players[1].lastPlayedAt, "2026-10-08T09:20:00.000Z")
    const text = JSON.stringify(league)
    assert.ok(!text.includes('"email"'), "league must not contain email keys")
    assert.ok(!text.includes("@"), "league must not contain addresses")
    assert.ok(!text.includes("annualSavings") && !text.includes("scenario"), "league exposes people-power only")

    const lines = (await readFile(path.join(server.env.DATA_DIR, "attempts.jsonl"), "utf8")).trim().split("\n")
    assert.equal(lines.length, 4)
    const stored = JSON.parse(lines[1])
    assert.equal(stored.email, EMAIL, "stored email is lowercased and trimmed")
    assert.deepEqual([stored.fteEquivalent, stored.annualSavings, stored.humanHoursPerYear, stored.scenario], [9, -5000, 16000, "Ashburn"], "people-power fields are stored")
  })

  await t.test("writes the Excel workbook to EXPORT_PATH", async () => {
    const exportPath = server.env.EXPORT_PATH
    await waitFor(() => stat(exportPath).then(() => true, () => false), "xlsx export")
    await waitFor(async () => {
      const entries = readZip(await readFile(exportPath))
      return entries.find((entry) => entry.name === "xl/worksheets/sheet2.xml")?.data.toString().split("<row ").length === 6
    }, "all four attempts in the workbook")
    const entries = readZip(await readFile(exportPath))
    assert.ok(entries.every((entry) => entry.crcOk))
    const players = entries.find((entry) => entry.name === "xl/worksheets/sheet1.xml").data.toString()
    assert.match(players, /Grace Hopper/)
    assert.match(players, /grace@example\.com/, "the staff workbook does include emails")
    assert.match(players, /<c r="C3"><v>3<\/v><\/c><c r="D3"><v>1200<\/v><\/c><c r="E3"><v>1000<\/v><\/c>/)
    assert.match(players, /<c r="L3"><v>9<\/v><\/c><c r="M3"><v>-5000<\/v><\/c>/, "best people-power and saving come from the best attempt")
    const runs = entries.find((entry) => entry.name === "xl/worksheets/sheet2.xml").data.toString()
    assert.match(runs, /<c r="E1" t="inlineStr" s="1"><is><t>Scenario<\/t><\/is><\/c>/)
    assert.match(runs, /<c r="I1" t="inlineStr" s="1"><is><t>People-power \(FTE\)<\/t><\/is><\/c><c r="J1" t="inlineStr" s="1"><is><t>Human hours \/ year<\/t><\/is><\/c><c r="K1" t="inlineStr" s="1"><is><t>Annual saving \(\$\)<\/t><\/is><\/c>/)
    assert.match(runs, /<c r="E4" t="inlineStr"><is><t>Ashburn<\/t><\/is><\/c><c r="F4"><v>1200<\/v><\/c>/, "newest first: the 09:15 run is row 4")
    assert.match(runs, /<c r="I4"><v>9<\/v><\/c><c r="J4"><v>16000<\/v><\/c><c r="K4"><v>-5000<\/v><\/c>/)
    const leftovers = (await readdir(path.dirname(exportPath))).filter((name) => name.includes(".tmp-"))
    assert.deepEqual(leftovers, [], "no temp files left behind")
  })

  await t.test("export and reset require the staff PIN", async () => {
    assert.equal((await fetch(`${url}/api/export.xlsx`)).status, 403, "no pin")
    assert.equal((await fetch(`${url}/api/export.xlsx`, { headers: { "X-Staff-Pin": "0000" } })).status, 403, "wrong pin")
    const download = await fetch(`${url}/api/export.xlsx`, { headers: { "X-Staff-Pin": PIN } })
    assert.equal(download.status, 200)
    assert.equal(download.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert.match(download.headers.get("content-disposition"), /attachment; filename="Token Quest Leaderboard\.xlsx"/)
    const bytes = Buffer.from(await download.arrayBuffer())
    assert.equal(bytes.subarray(0, 2).toString(), "PK")
    assert.ok(readZip(bytes).some((entry) => entry.name === "xl/worksheets/sheet1.xml"))

    assert.equal((await json("POST", `${url}/api/reset`, {})).status, 403)
    assert.equal((await json("POST", `${url}/api/reset`, {}, { "X-Staff-Pin": "9999" })).status, 403)
    assert.equal((await fetch(`${url}/api/league`)).ok, true, "league untouched by rejected resets")
    assert.equal((await (await fetch(`${url}/api/league`)).json()).players.length, 2)

    const reset = await (await json("POST", `${url}/api/reset`, {}, { "X-Staff-Pin": PIN })).json()
    assert.equal(reset.ok, true)
    assert.equal(reset.attempts, 4)
    assert.match(reset.archived, /^attempts-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jsonl$/)
    const files = await readdir(server.env.DATA_DIR)
    assert.ok(files.includes(reset.archived), "attempts archived, not deleted")
    assert.ok(files.includes(reset.workbook), "previous workbook archived too")
    assert.ok(!files.includes("attempts.jsonl"))
    const archived = (await readFile(path.join(server.env.DATA_DIR, reset.archived), "utf8")).trim().split("\n")
    assert.equal(archived.length, 4)

    const league = await (await fetch(`${url}/api/league`)).json()
    assert.deepEqual(league.players, [])
    const next = await (await json("POST", `${url}/api/attempt`, attempt({ score: 50 }))).json()
    assert.deepEqual([next.attempts, next.best, next.rank], [1, 50, 1], "fresh start after reset")
  })

  await t.test("js/sync.js talks to the server and queues offline attempts", async () => {
    const mem = new Map()
    const storage = {
      getItem: (key) => (mem.has(key) ? mem.get(key) : null),
      setItem: (key, value) => mem.set(key, String(value)),
      removeItem: (key) => mem.delete(key),
    }
    bindSync({ fetch: (...args) => fetch(...args), storage, baseUrl: url })

    const live = await recordAttempt(attempt({ name: "Alan Turing", email: "alan@example.com", score: 777, playedAt: undefined }))
    assert.equal(live.ok, true)
    assert.equal(live.attempts, 1)
    assert.equal(live.rank, 1)
    assert.equal(pendingCount(), 0)

    const rejected = await recordAttempt(attempt({ email: "broken" }))
    assert.equal(rejected.ok, false)
    assert.equal(rejected.error, "invalid_attempt")
    assert.equal(pendingCount(), 0, "rejected attempts are not queued")

    bindSync({ baseUrl: "http://127.0.0.1:9" })
    const offline = await recordAttempt(attempt({ name: "Alan Turing", email: "alan@example.com", score: 999, playedAt: "2026-10-08T10:00:00.000Z" }))
    assert.deepEqual(offline, { ok: false, offline: true, queued: 1 })
    assert.equal(JSON.parse(mem.get(QUEUE_KEY)).length, 1)
    assert.equal(JSON.parse(mem.get(QUEUE_KEY))[0].attempt.score, 999)
    assert.equal(await fetchLeague(), null, "league is null while offline")

    bindSync({ baseUrl: url })
    const flushed = await flushQueue()
    assert.deepEqual(flushed, { sent: 1, remaining: 0 })
    assert.equal(mem.has(QUEUE_KEY), false, "queue key removed once empty")
    const board = await fetchLeague()
    assert.equal(board[0].name, "Alan Turing")
    assert.equal(board[0].best, 999)
    assert.equal(board[0].attempts, 2)
    assert.ok(!JSON.stringify(board).includes("@"))
  })

  await t.test("logs one line per request without emails", async () => {
    const log = server.output()
    assert.match(log, /POST \/api\/attempt 200 \d+ms/)
    assert.match(log, /GET \/api\/league 200 \d+ms/)
    assert.match(log, /GET \/ 200 \d+ms/)
    assert.ok(!log.includes("@example.com"), "emails must never be logged")
    assert.ok(!/\n\s+at /.test(log), "no stack traces in the log")
  })
})

test("server: without STAFF_PIN staff routes only answer loopback callers", async () => {
  const server = await startServer({ STAFF_PIN: "" })
  await json("POST", `${server.url}/api/attempt`, attempt())
  const download = await fetch(`${server.url}/api/export.xlsx`)
  assert.equal(download.status, 200, "loopback is trusted when no pin is configured")
  assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 2).toString(), "PK")
  const reset = await (await json("POST", `${server.url}/api/reset`, {})).json()
  assert.equal(reset.ok, true)
  assert.equal(reset.attempts, 1)
  assert.match(server.output(), /STAFF_PIN not set/)
})

test("server: refuses a non-loopback HOST without --lan", async () => {
  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "serve.mjs"), "--port", "0"], { env: { ...process.env, HOST: "0.0.0.0", STAFF_PIN: "", ENV_FILE: "off", UPSTREAM_URL: "", UPSTREAM_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  child.stdout.on("data", (chunk) => (output += chunk))
  child.stderr.on("data", (chunk) => (output += chunk))
  const code = await new Promise((resolve) => child.once("exit", resolve))
  assert.equal(code, 2)
  assert.match(output, /Pass --lan/)
})

/* ---------- Several laptops, one league: write-through to the team server ---------- */

/** A kiosk-side league row the way the Worker answers a kiosk (public fields + email, bestAt, latestAt). */
function kioskRows(attempts) {
  const players = aggregatePlayers(attempts)
  return publicLeague(players).map((row, index) => ({ ...row, email: players[index].email, bestAt: players[index].bestAt, latestAt: players[index].latestAt }))
}

/**
 * Stands in for the tokenquest Worker: takes forwarded games (checking the key), serves the league
 * of everything it knows (its own "other laptops" games plus what it received), and can be told to
 * be down, to answer 503 store_unavailable, to refuse the key or to reject a game.
 */
async function fakeUpstream({ others = [] } = {}) {
  const received = []
  const state = { mode: "ok", others, hits: { attempt: 0, league: 0 } }
  const server = http.createServer((req, res) => {
    if (state.mode === "down") return req.socket.destroy()
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      const reply = (status, payload) => {
        res.statusCode = status
        res.setHeader("Content-Type", "application/json; charset=utf-8")
        res.end(JSON.stringify(payload))
      }
      if (req.headers["x-intake-key"] !== UPSTREAM_KEY) return reply(401, { ok: false, error: "bad_key", message: "wrong key" })
      if (req.method === "POST" && req.url === "/api/attempt") {
        state.hits.attempt += 1
        if (state.mode === "store_unavailable") return reply(503, { ok: false, error: "store_unavailable", message: "The player sheet could not be updated." })
        if (state.mode === "reject") return reply(400, { ok: false, error: "invalid_attempt", message: "The attempt was rejected.", details: ["nope"] })
        const attempt = JSON.parse(body)
        if (!received.some((item) => attemptKey(item.attempt) === attemptKey(attempt))) received.push({ headers: req.headers, attempt })
        const players = aggregatePlayers([...state.others, ...received.map((item) => item.attempt)])
        const player = players.find((row) => row.email === attempt.email)
        return reply(200, { ok: true, attempts: player.attempts, best: player.best, latest: player.latest, rank: player.rank, players: players.length, newBest: player.bestAt === attempt.playedAt })
      }
      if (req.method === "GET" && req.url === "/api/league") {
        state.hits.league += 1
        if (state.mode === "store_unavailable") return reply(503, { ok: false, error: "store_unavailable" })
        const all = [...state.others, ...received.map((item) => item.attempt)]
        return reply(200, { ok: true, players: kioskRows(all), attempts: all.length })
      }
      reply(404, { ok: false, error: "not_found" })
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    state,
    received,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** The kiosk app in-process, forwarding to `upstreamUrl`, with fast retries so tests do not wait 30 s. */
async function listenKiosk(upstreamUrl, { key = UPSTREAM_KEY, upstream: upstreamOptions = {}, forwardWaitMs = 2000, seed = [] } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "token-quest-kiosk-"))
  const dataDir = path.join(dir, "data")
  const logs = []
  const log = (line) => logs.push(line)
  const store = await new AttemptStore(dataDir, { log }).init()
  for (const attempt of seed) await store.add(validateAttempt(attempt).attempt)
  const exporter = new Exporter(store, path.join(dir, "out.xlsx"), { delay: 20, log })
  const upstream = await createUpstream({ url: upstreamUrl, key, dataDir, log, retryMs: 150, maxRetryMs: 400, staleMs: 0, postTimeoutMs: 1500, getTimeoutMs: 1000, ...upstreamOptions }).init()
  await upstream.backfill(store.attempts)
  const server = createApp({ root: ROOT, dataDir, exportPath: exporter.exportPath, staffPin: null, host: "127.0.0.1", lan: false }, { store, exporter, upstream, forwardWaitMs, log })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url,
    dataDir,
    store,
    upstream,
    logs,
    queueLog: async () => parseQueueLog(await readFile(path.join(dataDir, QUEUE_FILE), "utf8").catch(() => "")),
    health: async () => (await fetch(`${url}/api/health`)).json(),
    league: async () => (await fetch(`${url}/api/league`)).json(),
    post: async (body) => (await json("POST", `${url}/api/attempt`, body)).json(),
    async close() {
      await upstream.close()
      await exporter.flush()
      await new Promise((resolve) => server.close(resolve))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

const OTHER_LAPTOP = [
  attempt({ name: "Grace Hopper", email: "grace@example.com", score: 1500, useCase: "Drug discovery", fteEquivalent: 4, playedAt: "2026-10-08T09:07:00.000Z" }),
  attempt({ name: "Grace Hopper", email: "grace@example.com", score: 1400, useCase: "Chat", fteEquivalent: 3, playedAt: "2026-10-08T09:09:00.000Z" }),
  attempt({ score: 950, useCase: "RAG", playedAt: "2026-10-08T09:01:00.000Z" }),
]

test("write-through: every accepted game is forwarded with the key, and the board merges the team server's totals", async (t) => {
  const upstream = await fakeUpstream({ others: OTHER_LAPTOP.map((item) => validateAttempt(item).attempt) })
  const kiosk = await listenKiosk(upstream.url)
  t.after(async () => {
    await kiosk.close()
    await upstream.close()
  })

  const result = await kiosk.post(attempt({ score: 900 }))
  assert.deepEqual(result, { ok: true, attempts: 2, best: 950, latest: 900, rank: 2, players: 2, newBest: false, source: "merged" }, "the answer counts the game played on the other laptop too")
  assert.equal(upstream.received.length, 1)
  const forwarded = upstream.received[0]
  assert.equal(forwarded.headers["x-intake-key"], UPSTREAM_KEY)
  assert.equal(forwarded.headers["content-type"], "application/json")
  assert.deepEqual(forwarded.attempt, forwardPayload(validateAttempt(attempt({ score: 900 })).attempt), "the Worker gets the validated game, not the local id or receivedAt")
  assert.equal(forwarded.attempt.id, undefined)

  const league = await kiosk.league()
  assert.equal(league.source, "merged")
  assert.equal(league.attempts, 4)
  assert.deepEqual(league.players.map((row) => [row.rank, row.name, row.attempts, row.best, row.latest, row.bestUseCase, row.fteEquivalent]), [
    [1, "Grace Hopper", 2, 1500, 1400, "Drug discovery", 4],
    [2, "Ada Lovelace", 2, 950, 900, "RAG", 2.5],
  ])
  assert.ok(!JSON.stringify(league).includes("@"), "the merged league never carries emails")
  assert.ok(!JSON.stringify(league).includes("bestAt"), "the merged league keeps the public shape")

  const hits = upstream.state.hits.league
  await kiosk.league()
  await kiosk.league()
  assert.equal(upstream.state.hits.league, hits, "the team server's league is cached for 10 s")

  const health = await kiosk.health()
  assert.equal(health.attempts, 1, "local count stays local")
  assert.deepEqual(
    { configured: health.upstream.configured, url: health.upstream.url, key: health.upstream.key, queued: health.upstream.queued, sent: health.upstream.sent, rejected: health.upstream.rejected, lastError: health.upstream.lastError },
    { configured: true, url: upstream.url, key: true, queued: 0, sent: 1, rejected: 0, lastError: null },
  )
  assert.match(health.upstream.lastSyncAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.ok(!JSON.stringify(health).includes(UPSTREAM_KEY), "health never shows the key")

  const log = await kiosk.queueLog()
  assert.deepEqual([log.pending.size, log.sent.size, log.rejected.size], [0, 1, 0])
  assert.ok(log.sent.has(attemptKey(forwarded.attempt)))
  assert.ok(!kiosk.logs.join("\n").includes(UPSTREAM_KEY) && !kiosk.logs.join("\n").includes("@"), "logs carry neither the key nor emails")
})

test("write-through: an unreachable or failing team server never loses a game; the queue drains in order on the next game and on the timer", async (t) => {
  const upstream = await fakeUpstream()
  const kiosk = await listenKiosk(upstream.url)
  t.after(async () => {
    await kiosk.close()
    await upstream.close()
  })

  upstream.state.mode = "down"
  const first = await kiosk.post(attempt({ score: 900, playedAt: "2026-10-08T09:05:00.000Z" }))
  assert.deepEqual(first, { ok: true, attempts: 1, best: 900, latest: 900, rank: 1, players: 1, newBest: true, source: "local" }, "the player still gets an answer from what the laptop knows")
  let health = await kiosk.health()
  assert.equal(health.upstream.queued, 1)
  assert.equal(health.upstream.lastSyncAt, null)
  assert.equal(health.upstream.lastError, "team server unreachable")
  assert.match(health.upstream.nextRetryAt, /^\d{4}-/)
  assert.equal((await kiosk.league()).source, "local", "offline: the board falls back to this laptop's league")
  assert.equal((await kiosk.queueLog()).pending.size, 1, "the game is journaled on disk, not just in memory")
  assert.equal((await readFile(path.join(kiosk.dataDir, "attempts.jsonl"), "utf8")).trim().split("\n").length, 1, "and stored locally as always")

  // The team server is back: the next game flushes the queue in order before it is answered.
  upstream.state.mode = "ok"
  const second = await kiosk.post(attempt({ score: 1000, playedAt: "2026-10-08T09:10:00.000Z" }))
  assert.deepEqual([second.attempts, second.best, second.source], [2, 1000, "merged"])
  assert.deepEqual(upstream.received.map((item) => item.attempt.score), [900, 1000], "oldest first")
  health = await kiosk.health()
  assert.deepEqual([health.upstream.queued, health.upstream.sent, health.upstream.lastError], [0, 2, null])

  // The sheet behind the Worker is down (503 store_unavailable): queued again, retried on the timer.
  upstream.state.mode = "store_unavailable"
  const third = await kiosk.post(attempt({ score: 800, playedAt: "2026-10-08T09:15:00.000Z" }))
  assert.equal(third.ok, true)
  health = await kiosk.health()
  assert.equal(health.upstream.queued, 1)
  assert.match(health.upstream.lastError, /HTTP 503 store_unavailable/)
  upstream.state.mode = "ok"
  await waitFor(async () => (await kiosk.health()).upstream.queued === 0, "the retry timer to drain the queue")
  assert.deepEqual(upstream.received.map((item) => item.attempt.score), [900, 1000, 800])
  const log = await kiosk.queueLog()
  assert.deepEqual([log.pending.size, log.sent.size], [0, 3])

  // A wrong key is reported in plain words and nothing is dropped.
  const strayKey = await listenKiosk(upstream.url, { key: "not-the-key" })
  t.after(() => strayKey.close())
  await strayKey.post(attempt({ score: 500, playedAt: "2026-10-08T09:20:00.000Z" }))
  const stray = (await strayKey.health()).upstream
  assert.equal(stray.queued, 1)
  assert.match(stray.lastError, /HTTP 401 bad_key: the team server refused the key \(check UPSTREAM_KEY/)
  assert.equal(upstream.received.length, 3)
})

test("write-through: a game the team server refuses for good is kept on the laptop and does not block the others", async (t) => {
  const upstream = await fakeUpstream()
  const kiosk = await listenKiosk(upstream.url)
  t.after(async () => {
    await kiosk.close()
    await upstream.close()
  })
  upstream.state.mode = "reject"
  const refused = await kiosk.post(attempt({ score: 700, playedAt: "2026-10-08T09:05:00.000Z" }))
  assert.equal(refused.ok, true, "locally it is a normal game")
  let health = await kiosk.health()
  assert.deepEqual([health.upstream.queued, health.upstream.rejected, health.attempts], [0, 1, 1])
  upstream.state.mode = "ok"
  await kiosk.post(attempt({ score: 750, playedAt: "2026-10-08T09:06:00.000Z" }))
  assert.deepEqual(upstream.received.map((item) => item.attempt.score), [750])
  health = await kiosk.health()
  assert.deepEqual([health.upstream.queued, health.upstream.sent, health.upstream.rejected], [0, 1, 1])
  const log = await kiosk.queueLog()
  assert.deepEqual(log.rejected.get(attemptKey({ email: EMAIL, playedAt: "2026-10-08T09:05:00.000Z", score: 700 })).status, 400)
  assert.match(kiosk.logs.join("\n"), /rejected by the team server \(HTTP 400 invalid_attempt\)/)
})

test("write-through: games recorded before UPSTREAM_URL was set are sent on start-up, a restart re-sends nothing, and a replayed POST is stored once", async (t) => {
  const upstream = await fakeUpstream()
  const seed = [attempt({ score: 600, playedAt: "2026-10-08T08:00:00.000Z" }), attempt({ name: "Alan Turing", email: "alan@example.com", score: 1200, playedAt: "2026-10-08T08:30:00.000Z" })]
  const kiosk = await listenKiosk(upstream.url, { seed })
  t.after(async () => {
    await kiosk.close()
    await upstream.close()
  })
  await waitFor(async () => (await kiosk.health()).upstream.sent === 2, "the backfill")
  assert.deepEqual(upstream.received.map((item) => item.attempt.score), [600, 1200])
  assert.match(kiosk.logs.join("\n"), /2 earlier game\(s\) queued for the team server/)

  // Same data directory again (a restart): the journal says both are sent, so nothing moves.
  const again = await createUpstream({ url: upstream.url, key: UPSTREAM_KEY, dataDir: kiosk.dataDir, retryMs: 100 }).init()
  assert.equal(await again.backfill(kiosk.store.attempts), 0)
  assert.deepEqual([again.status().queued, again.status().sent], [0, 2])
  await again.close()
  assert.equal(upstream.received.length, 2)

  // The browser re-posts a game it never saw the answer for: stored once, forwarded once.
  const game = attempt({ score: 900, playedAt: "2026-10-08T09:05:00.000Z" })
  const one = await kiosk.post(game)
  const two = await kiosk.post(game)
  assert.deepEqual([one.attempts, two.attempts], [2, 2])
  assert.equal((await readFile(path.join(kiosk.dataDir, "attempts.jsonl"), "utf8")).trim().split("\n").length, 3)
  assert.equal(upstream.received.length, 3)
  assert.equal(upstream.state.hits.attempt, 3, "the replay is not even forwarded again")
})

test("mergeLeague: best is the higher score, attempts add the unconfirmed local games, players from either side are kept", () => {
  const local = [
    validateAttempt(attempt({ score: 800, useCase: "Chat", playedAt: "2026-10-08T09:00:00.000Z" })).attempt, // confirmed upstream
    validateAttempt(attempt({ name: "Ada L", score: 900, useCase: "Chat + RAG", playedAt: "2026-10-08T09:05:00.000Z" })).attempt, // still queued
    validateAttempt(attempt({ name: "Bob Builder", email: "bob@example.com", score: 700, playedAt: "2026-10-08T09:02:00.000Z" })).attempt, // upstream lost it
  ]
  const pending = new Set([attemptKey(local[1])])
  const upstream = {
    attempts: 5,
    players: kioskRows([
      validateAttempt(attempt({ score: 800, useCase: "Chat", playedAt: "2026-10-08T09:00:00.000Z" })).attempt,
      validateAttempt(attempt({ score: 950, useCase: "RAG", fteEquivalent: 9, playedAt: "2026-10-08T08:50:00.000Z" })).attempt, // another laptop
      validateAttempt(attempt({ score: 500, playedAt: "2026-10-08T08:55:00.000Z" })).attempt,
      validateAttempt(attempt({ name: "Grace Hopper", email: "grace@example.com", score: 1500, playedAt: "2026-10-08T09:07:00.000Z" })).attempt,
      validateAttempt(attempt({ name: "Grace Hopper", email: "grace@example.com", score: 1400, playedAt: "2026-10-08T09:09:00.000Z" })).attempt,
    ]),
  }
  const merged = mergeLeague(local, upstream, pending)
  assert.equal(merged.source, "merged")
  assert.equal(merged.attempts, 6, "5 on the team server + 1 not yet confirmed")
  assert.deepEqual(merged.players.map((row) => [row.rank, row.email, row.attempts, row.best, row.latest, row.name, row.bestUseCase, row.bestFteEquivalent]), [
    [1, "grace@example.com", 2, 1500, 1400, "Grace Hopper", "Chat + RAG", 2.5],
    [2, EMAIL, 4, 950, 900, "Ada L", "RAG", 9],
    [3, "bob@example.com", 1, 700, 700, "Bob Builder", "Chat + RAG", 2.5],
  ], "Ada: 3 on the team server + 1 unconfirmed here; her best and its details come from the other laptop")
  const ada = merged.players[1]
  assert.equal(ada.firstPlayedAt, "2026-10-08T08:50:00.000Z", "first played is the earliest of both sides")
  assert.equal(ada.lastPlayedAt, "2026-10-08T09:05:00.000Z", "latest follows the later game, here the local one")
  assert.ok(!JSON.stringify(publicLeague(merged.players)).includes("@"))

  // A better local score wins and brings its details; equal scores go to the earlier one.
  const better = mergeLeague([validateAttempt(attempt({ score: 2000, useCase: "Everything", fteEquivalent: 11, playedAt: "2026-10-08T09:30:00.000Z" })).attempt], upstream, new Set())
  assert.deepEqual([better.players[0].email, better.players[0].best, better.players[0].bestUseCase, better.players[0].bestFteEquivalent], [EMAIL, 2000, "Everything", 11])
  const tie = mergeLeague([validateAttempt(attempt({ score: 950, useCase: "Local tie", playedAt: "2026-10-08T08:40:00.000Z" })).attempt], upstream, new Set())
  assert.equal(tie.players.find((row) => row.email === EMAIL).bestUseCase, "Local tie", "the earlier 950 wins the tie")

  // Nothing from the team server: exactly the local league.
  const alone = mergeLeague(local, null, pending)
  assert.equal(alone.source, "local")
  assert.deepEqual(alone.players, aggregatePlayers(local))
  assert.equal(alone.attempts, 3)
  assert.equal(mergeLeague([], { players: [], attempts: 0 }).players.length, 0)
})

test("upstream helpers: the journal replays, forwardPayload strips local bookkeeping, keys match the Worker's replay rule", () => {
  const game = { id: "x", receivedAt: "now", ...validateAttempt(attempt()).attempt }
  const payload = forwardPayload(game)
  assert.deepEqual(Object.keys(payload).sort(), ["annualSavings", "consent", "consentAt", "costPerMTok", "email", "fteEquivalent", "humanHoursPerYear", "name", "playedAt", "profitPerHour", "scenario", "score", "useCase"])
  assert.equal(attemptKey(game), `${EMAIL}|2026-10-08T09:05:00.000Z|900`)
  assert.equal(attemptKey({ ...game, email: "ADA@Example.com" }), attemptKey(game))
  const text = [
    JSON.stringify({ queued: payload, at: "t1" }),
    JSON.stringify({ queued: { ...payload, score: 1 }, at: "t2" }),
    "not json",
    JSON.stringify({ sent: attemptKey(payload), at: "t3" }),
    JSON.stringify({ rejected: attemptKey({ ...payload, score: 2 }), status: 400, error: "invalid_attempt", at: "t4" }),
    JSON.stringify({ queued: { ...payload, score: 2 }, at: "t5" }),
    "",
  ].join("\n")
  const log = parseQueueLog(text)
  assert.deepEqual([...log.pending.keys()], [attemptKey({ ...payload, score: 1 })], "sent and rejected games are not pending, whatever the order of the lines")
  assert.deepEqual([...log.sent], [attemptKey(payload)])
  assert.deepEqual(log.rejected.get(attemptKey({ ...payload, score: 2 })), { status: 400, error: "invalid_attempt", at: "t4" })
  assert.equal(log.skipped, 1)
})

test("config: UPSTREAM_URL and UPSTREAM_KEY come from the environment or a git-ignored .env file; https is required off the laptop", async (t) => {
  assert.deepEqual(parseEnvFile(["# team server", "UPSTREAM_URL=https://tokenquest.example.workers.dev/ # trailing comment", 'UPSTREAM_KEY="abc=def"', "export STAFF_PIN='1234'", "KIOSK_URL = https://x.example", "garbage line", "EMPTY="].join("\r\n")), {
    UPSTREAM_URL: "https://tokenquest.example.workers.dev/",
    UPSTREAM_KEY: "abc=def",
    STAFF_PIN: "1234",
    KIOSK_URL: "https://x.example",
    EMPTY: "",
  })
  assert.equal(parseUpstreamUrl(" https://tokenquest.example.workers.dev/ "), "https://tokenquest.example.workers.dev")
  assert.equal(parseUpstreamUrl("https://example.com/quest/"), "https://example.com/quest")
  assert.equal(parseUpstreamUrl("http://127.0.0.1:8787"), "http://127.0.0.1:8787", "plain http only on loopback")
  assert.equal(parseUpstreamUrl(""), null)
  assert.equal(parseUpstreamUrl(undefined), null)
  for (const bad of ["http://tokenquest.example.workers.dev", "tokenquest.example.workers.dev", "https://user:pw@example.com", "https://example.com/?x=1", "ftp://example.com"]) {
    assert.throws(() => parseUpstreamUrl(bad), ConfigError, bad)
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "token-quest-env-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, ".env")
  await writeFile(file, "UPSTREAM_URL=https://tokenquest.example.workers.dev\nUPSTREAM_KEY=from-file\nSTAFF_PIN=9999\n")
  const loaded = withEnvFile({ ENV_FILE: file, UPSTREAM_KEY: "from-env", STAFF_PIN: "" })
  assert.equal(loaded.file, file)
  assert.deepEqual(loaded.keys, ["UPSTREAM_URL"], "only what the environment did not set, and the keys only (safe to log)")
  assert.equal(loaded.env.UPSTREAM_KEY, "from-env", "the environment wins")
  assert.equal(loaded.env.STAFF_PIN, "", "an empty environment value still counts as set")
  const config = loadConfig([], loaded.env)
  assert.deepEqual([config.upstreamUrl, config.upstreamKey], ["https://tokenquest.example.workers.dev", "from-env"])
  assert.deepEqual(withEnvFile({ ENV_FILE: "off", UPSTREAM_URL: "" }).file, null)
  assert.deepEqual(withEnvFile({ ENV_FILE: path.join(dir, "missing.env") }).keys, [])
  assert.equal(loadConfig([], {}).upstreamUrl, null)

  // End to end: the real server reads the file, says so without printing values, and forwards.
  const upstream = await fakeUpstream()
  t.after(() => upstream.close())
  await writeFile(file, `UPSTREAM_URL=${upstream.url}\nUPSTREAM_KEY=${UPSTREAM_KEY}\n`)
  const server = await startServer({ ENV_FILE: file, UPSTREAM_URL: undefined, UPSTREAM_KEY: undefined })
  await json("POST", `${server.url}/api/attempt`, attempt())
  await waitFor(() => upstream.received.length === 1, "the forward from the spawned server")
  assert.equal(upstream.received[0].headers["x-intake-key"], UPSTREAM_KEY)
  const health = await (await fetch(`${server.url}/api/health`)).json()
  assert.deepEqual([health.upstream.configured, health.upstream.url, health.upstream.sent], [true, upstream.url, 1])
  const output = server.output()
  assert.match(output, /Settings: .*\.env \(UPSTREAM_URL, UPSTREAM_KEY\)/)
  assert.match(output, /Upstream: http:\/\/127\.0\.0\.1:\d+ \(key set\)/)
  assert.ok(!output.includes(UPSTREAM_KEY), "the key is never printed")
  assert.equal((await fetch(`${server.url}/.env`)).status, 404)
})

after(async () => {
  for (const server of servers) await server.stop()
})
