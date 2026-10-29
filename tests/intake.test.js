/**
 * The tokenquest Worker (deploy/intake-worker) against an in-memory D1 (tests/helpers/fake-d1.mjs:
 * Node's own SQLite running the real migration and the real SQL) and an in-memory fake of the
 * GitHub Contents API for the optional mirror. No network, no Cloudflare: the Worker is plain ESM
 * on Web APIs, so Node runs it as is.
 */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { BOM, CSV_COLUMNS, csvCell, csvFilename, renderAttemptsCsv } from "../deploy/intake-worker/src/csv.mjs"
import { MIGRATE_HINT, createD1Store, describeD1Error, fromRow, replayKey, toRow } from "../deploy/intake-worker/src/d1store.mjs"
import { ConflictError, GitHubError, base64ToUtf8, createContentsClient, parseRepo, utf8ToBase64 } from "../deploy/intake-worker/src/github.mjs"
import { ATTEMPTS_HEADERS, PLAYERS_HEADERS, escapeCell, formatScore, formatTime, renderPlayersMarkdown, statusLine } from "../deploy/intake-worker/src/markdown.mjs"
import { aggregatePlayers as workerAggregate, publicLeague as workerPublic } from "../deploy/intake-worker/src/players.mjs"
import { createRateLimiter } from "../deploy/intake-worker/src/ratelimit.mjs"
import { countLine, staffPage } from "../deploy/intake-worker/src/staff.mjs"
import { MAX_TRIES, PLAYERS_JSON, PLAYERS_MD, StoreUnavailableError, createPlayersStore, sameAttempt, serialiseAttempts } from "../deploy/intake-worker/src/store.mjs"
import { validateAttempt as workerValidate } from "../deploy/intake-worker/src/validate.mjs"
import worker, { BODY_LIMIT, SERVICE, STAFF_PATH, createHandler, describeStoreError, parseOrigins } from "../deploy/intake-worker/src/worker.mjs"
import { aggregatePlayers, publicLeague } from "../server/players.mjs"
import { validateAttempt } from "../server/validate.mjs"
import { fakeD1, migrationFiles } from "./helpers/fake-d1.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const WORKER = path.join(ROOT, "deploy", "intake-worker", "src")
const REPO = "punkrockquantum/token-quest-players"
const TOKEN = "github_pat_TEST_ONLY_not_a_real_token"
const ORIGIN = "https://punkrockquantum.github.io"
const INTAKE = "https://tokenquest.example.workers.dev"
const T0 = Date.parse("2026-10-16T15:00:00.000Z")

const attempt = (overrides = {}) => ({
  name: "Ada Lovelace",
  email: "ada@example.com",
  score: 900,
  useCase: "Chat + RAG",
  costPerMTok: 1.5,
  profitPerHour: 4200,
  fteEquivalent: 2.5,
  annualSavings: 120000,
  humanHoursPerYear: 4500,
  scenario: "London launch",
  consent: true,
  consentAt: "2026-10-16T14:00:00.000Z",
  playedAt: "2026-10-16T14:05:00.000Z",
  ...overrides,
})

/** Git's blob sha, which is what the Contents API reports and compares. */
function blobSha(text) {
  return createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex")
}

/**
 * Enough of api.github.com for the mirror: GET/PUT /repos/:repo/contents/:path with base64 bodies,
 * sha compare-and-swap (409 on a stale sha, 422 on a missing one) and GET /repos/:repo for ping().
 * Hooks let a test inject faults: a concurrent writer before a PUT, a forced 409, or hard failures.
 */
function fakeGitHub() {
  const files = new Map()
  const commits = []
  const requests = []
  const state = { beforePut: null, conflictNext: new Set(), alwaysConflict: false, failWrites: null, failReads: null }
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

  async function fetch(url, init = {}) {
    const method = (init.method || "GET").toUpperCase()
    const { pathname } = new URL(url)
    requests.push({ method, path: pathname })
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return json(401, { message: "Bad credentials" })
    if (!init.headers?.["User-Agent"]) return json(403, { message: "Request forbidden by administrative rules. Please make sure your request has a User-Agent header" })
    if (pathname === `/repos/${REPO}`) return json(200, { full_name: REPO, private: true })
    const match = new RegExp(`^/repos/${REPO}/contents/(.+)$`).exec(pathname)
    if (!match) return json(404, { message: "Not Found" })
    const file = decodeURIComponent(match[1])

    if (method === "GET") {
      if (state.failReads) return json(state.failReads, { message: "boom" })
      if (!files.has(file)) return json(404, { message: "Not Found" })
      const text = files.get(file)
      const content = Buffer.from(text, "utf8").toString("base64").replace(/(.{60})/g, "$1\n")
      return json(200, { type: "file", path: file, sha: blobSha(text), size: Buffer.byteLength(text), encoding: "base64", content })
    }
    if (method === "PUT") {
      if (state.failWrites) return json(state.failWrites, { message: "boom" })
      const body = JSON.parse(init.body)
      if (state.beforePut) {
        const hook = state.beforePut
        state.beforePut = null
        hook(file)
      }
      if (state.alwaysConflict || state.conflictNext.delete(file)) return json(409, { message: `${file} does not match ${body.sha}` })
      const exists = files.has(file)
      if (exists && !body.sha) return json(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' })
      if (exists && body.sha !== blobSha(files.get(file))) return json(409, { message: `${file} does not match ${body.sha}` })
      if (!exists && body.sha) return json(422, { message: "Invalid request." })
      const text = Buffer.from(body.content, "base64").toString("utf8")
      files.set(file, text)
      commits.push({ path: file, message: body.message, text, committer: body.committer, branch: body.branch })
      return json(exists ? 200 : 201, { content: { path: file, sha: blobSha(text) }, commit: { sha: `c${commits.length}`, message: body.message } })
    }
    return json(405, { message: "nope" })
  }

  return {
    fetch,
    files,
    commits,
    requests,
    state,
    commitsFor: (file) => commits.filter((commit) => commit.path === file),
    attempts: () => JSON.parse(files.get(PLAYERS_JSON) || "[]"),
    markdown: () => files.get(PLAYERS_MD) || "",
  }
}

/**
 * A handler with every side effect captured: its own in-memory D1, a fake GitHub for the mirror,
 * a frozen clock, recorded sleeps, log lines and the promises handed to ctx.waitUntil.
 */
function makeSite(envOverrides = {}, overrides = {}) {
  const logs = []
  const sleeps = []
  const pending = []
  const d1 = fakeD1()
  const gh = fakeGitHub()
  let clock = T0
  const handler = createHandler({
    fetch: gh.fetch,
    now: () => new Date(clock),
    random: () => 0.5,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    log: (line) => logs.push(line),
    ...overrides,
  })
  const env = (more = {}) => ({ DB: d1, ALLOWED_ORIGINS: ORIGIN, ...envOverrides, ...more })
  const ctx = { waitUntil: (promise) => pending.push(promise) }
  return { handler, d1, gh, logs, sleeps, pending, env, ctx, tick: (ms) => (clock += ms), settle: () => Promise.all(pending.splice(0)) }
}

function headersFor({ origin = ORIGIN, ip = "203.0.113.7", headers = {} }) {
  const out = { "CF-Connecting-IP": ip, ...headers }
  if (origin !== null) out.Origin = origin
  return out
}

function post(site, body, options = {}) {
  const { raw, environment = site.env() } = options
  const request = new Request(`${INTAKE}/api/attempt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersFor(options) },
    body: raw ?? JSON.stringify(body),
  })
  return site.handler.fetch(request, environment, site.ctx)
}

function get(site, route, options = {}) {
  const { method = "GET", environment = site.env() } = options
  return site.handler.fetch(new Request(`${INTAKE}${route}`, { method, headers: headersFor(options) }), environment, site.ctx)
}

/** The table that follows a "## Heading" line: [headerCells, alignCells, ...rowCells]. */
function tableRows(markdown, heading) {
  const section = markdown.split(`## ${heading}\n`)[1]?.split(/\n## /)[0] || ""
  return section
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.slice(1, -1).split(" | ").map((cell) => cell.trim()))
}

// ---------------------------------------------------------------------------------------------
// Parity with the kiosk server
// ---------------------------------------------------------------------------------------------

test("validate.mjs and players.mjs are the kiosk server's files with a different header comment", async () => {
  const strip = (source) => source.replace(/^\/\*\*[\s\S]*?\*\/\n/, "").trim()
  for (const name of ["validate.mjs", "players.mjs"]) {
    const [server, copy] = await Promise.all([readFile(path.join(ROOT, "server", name), "utf8"), readFile(path.join(WORKER, name), "utf8")])
    assert.equal(strip(copy), strip(server), `${name}: the Worker copy drifted from server/${name}; change both`)
  }
  const cases = [
    attempt(),
    attempt({ name: "  Zoë   O'Brien-Smith ", email: " Ada@Example.COM ", consentAt: 1791000000000, useCase: "Chat\u0000 + RAG", playedAt: undefined }),
    attempt({ name: "<b>Ada</b>", email: "nope", score: -1, consent: false }),
    attempt({ fteEquivalent: "3", annualSavings: Number.POSITIVE_INFINITY, scenario: { id: "x" } }),
    null,
    [],
    "text",
  ]
  const now = new Date(T0)
  for (const body of cases) assert.deepEqual(workerValidate(body, now), validateAttempt(body, now))
  const attempts = [attempt({ score: 500 }), attempt({ score: 900, playedAt: "2026-10-16T14:10:00.000Z" }), attempt({ name: "Grace Hopper", email: "grace@example.com", score: 900, playedAt: "2026-10-16T14:30:00.000Z" })]
  assert.deepEqual(workerAggregate(attempts), aggregatePlayers(attempts))
  assert.deepEqual(workerPublic(workerAggregate(attempts)), publicLeague(aggregatePlayers(attempts)))
})

// ---------------------------------------------------------------------------------------------
// PLAYERS.md generator (pure)
// ---------------------------------------------------------------------------------------------

test("PLAYERS.md: empty sheet has the title, the status line and both table headers", () => {
  const md = renderPlayersMarkdown([], { now: new Date(T0) })
  assert.match(md, /^# Token Quest players\n/)
  assert.ok(md.includes("\nUpdated 2026-10-16T15:00:00.000Z · 0 players · 0 games\n"), md)
  assert.equal(tableRows(md, "Players")[0].join("|"), PLAYERS_HEADERS.join("|"))
  assert.equal(tableRows(md, "Attempts")[0].join("|"), ATTEMPTS_HEADERS.join("|"))
  assert.ok(md.includes("_No players yet._") && md.includes("_No games yet._"))
  assert.equal(statusLine([attempt()], T0), "Updated 2026-10-16T15:00:00.000Z · 1 player · 1 game")
})

test("PLAYERS.md: players aggregate by lowercased email, sort by best score, attempts are counted and listed newest first", () => {
  const attempts = [
    attempt({ score: 500, playedAt: "2026-10-16T09:00:00.000Z", useCase: "Chat" }),
    attempt({ name: "Ada L", email: "Ada@Example.com", score: 900, playedAt: "2026-10-16T09:10:00.000Z", useCase: "RAG" }),
    attempt({ name: "Grace Hopper", email: "grace@example.com", score: 900, playedAt: "2026-10-16T09:30:00.000Z" }),
    attempt({ name: "Alan Turing", email: "alan@example.com", score: 1200, playedAt: "2026-10-16T08:00:00.000Z", useCase: "" }),
  ]
  const md = renderPlayersMarkdown(attempts, { now: new Date(T0) })
  assert.ok(md.includes("Updated 2026-10-16T15:00:00.000Z · 3 players · 4 games"))
  const players = tableRows(md, "Players").slice(2)
  assert.deepEqual(players, [
    ["1", "Alan Turing", "alan@example.com", "1", "1,200", "1,200", "—", "2026-10-16 08:00", "2026-10-16 08:00"],
    ["2", "Ada L", "ada@example.com", "2", "900", "900", "RAG", "2026-10-16 09:00", "2026-10-16 09:10"],
    ["3", "Grace Hopper", "grace@example.com", "1", "900", "900", "Chat + RAG", "2026-10-16 09:30", "2026-10-16 09:30"],
  ])
  const runs = tableRows(md, "Attempts").slice(2)
  assert.deepEqual(runs.map((row) => [row[0], row[2], row[4]]), [
    ["2026-10-16 09:30", "grace@example.com", "900"],
    ["2026-10-16 09:10", "ada@example.com", "900"],
    ["2026-10-16 09:00", "ada@example.com", "500"],
    ["2026-10-16 08:00", "alan@example.com", "1,200"],
  ])
  assert.ok(!md.includes("Ada@Example.com"), "emails are lowercased everywhere in the sheet")
  assert.equal(formatScore(1234567.6), "1,234,568")
  assert.equal(formatScore("x"), "—")
  assert.equal(formatTime("2026-10-16T09:05:33.123Z"), "2026-10-16 09:05")
  assert.equal(formatTime(""), "")
})

test("PLAYERS.md: pipes, backslashes, newlines and angle brackets cannot break or decorate the tables", () => {
  assert.equal(escapeCell("a|b"), "a\\|b")
  assert.equal(escapeCell("a\\|b"), "a\\\\\\|b")
  assert.equal(escapeCell("line one\r\nline two\nthree"), "line one line two three")
  assert.equal(escapeCell("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)>")
  assert.equal(escapeCell(null), "")
  const md = renderPlayersMarkdown([attempt({ useCase: "Chat | RAG\nwith <b>html</b>", name: "Ada\\Lovelace" })], { now: new Date(T0) })
  const runs = tableRows(md, "Attempts")
  assert.equal(runs.length, 3, "header, alignment and exactly one attempt row")
  assert.equal(runs[2].length, ATTEMPTS_HEADERS.length, "the escaped pipe did not add a column")
  assert.equal(runs[2][3], "Chat \\| RAG with &lt;b>html&lt;/b>")
  assert.equal(runs[2][1], "Ada\\\\Lovelace")
  assert.ok(!md.includes("<b>"), md)
})

// ---------------------------------------------------------------------------------------------
// The scores database (d1store.mjs) on the real migration
// ---------------------------------------------------------------------------------------------

test("d1store: the migration creates the table; record() appends once per game, all() keeps arrival order, totals() count players by email", async () => {
  assert.deepEqual(migrationFiles(), ["0001_attempts.sql", "0002_sessions.sql"])
  const d1 = fakeD1()
  const store = createD1Store({ db: d1 })
  assert.equal(store.kind, "d1")
  assert.deepEqual(await store.totals(), { attempts: 0, players: 0, lastPlayedAt: null })
  assert.deepEqual(await store.all(), [])

  const ada = validateAttempt(attempt()).attempt
  const first = await store.record(ada, { source: "web" })
  assert.equal(first.replayed, false)
  assert.equal(first.id, 1)
  assert.equal(first.attempts.length, 1)
  assert.deepEqual(first.attempts[0], { id: 1, ...ada, source: "web" }, "a row reads back as the validated attempt plus id and source")
  assert.equal(d1.state.batches, 1, "insert + read is one round trip")

  const again = await store.record(ada, { source: "kiosk" })
  assert.deepEqual([again.replayed, again.id, again.attempts.length], [true, null, 1], "same email + playedAt + score: stored once, whoever re-posts it")
  assert.equal(d1.rows()[0].source, "web", "the first arrival's source stays")

  const grace = validateAttempt(attempt({ name: "Grace Hopper", email: " GRACE@Example.com ", score: 1500, playedAt: "2026-10-16T14:08:00.000Z", useCase: "", scenario: "", costPerMTok: null, fteEquivalent: undefined })).attempt
  const adaAgain = validateAttempt(attempt({ score: 1200, playedAt: "2026-10-16T14:12:00.000Z" })).attempt
  await store.record(grace, { source: "kiosk" })
  const third = await store.record(adaAgain)
  assert.deepEqual(third.attempts.map((row) => [row.id, row.email, row.score, row.source]), [[1, "ada@example.com", 900, "web"], [2, "grace@example.com", 1500, "kiosk"], [3, "ada@example.com", 1200, null]], "oldest first, emails lowercased")
  assert.deepEqual(await store.totals(), { attempts: 3, players: 2, lastPlayedAt: "2026-10-16T14:12:00.000Z" })
  assert.deepEqual(await store.ping(), await store.totals())
  const back = (await store.all())[1]
  assert.deepEqual([back.useCase, back.scenario, back.costPerMTok, back.fteEquivalent, back.consent], ["", "", null, null, true], "NULL columns come back as the validator's empty values")

  assert.equal(replayKey(ada), "ada@example.com|2026-10-16T14:05:00.000Z|900")
  assert.equal(replayKey({ email: "ADA@Example.com", playedAt: ada.playedAt, score: 900 }), replayKey(ada))
  assert.deepEqual(toRow(ada, { source: "web" }), ["2026-10-16T14:05:00.000Z", "Ada Lovelace", "ada@example.com", 900, "Chat + RAG", "London launch", 1.5, 4200, 2.5, 120000, 4500, "2026-10-16T14:00:00.000Z", "web", replayKey(ada)])
  assert.deepEqual(fromRow(d1.rows()[0]), { id: 1, ...ada, source: "web" })
  assert.deepEqual(d1.rows().map((row) => row.replay_key), [replayKey(ada), replayKey(grace), replayKey(adaAgain)])

  // Failures surface as StoreUnavailableError with a line staff can act on; nothing else leaks.
  d1.state.fail = new Error("D1_ERROR: no such table: attempts: SQLITE_ERROR")
  await assert.rejects(store.record(ada), (error) => error instanceof StoreUnavailableError && error.message === `D1: the attempts table does not exist yet: ${MIGRATE_HINT}`)
  await assert.rejects(store.all(), StoreUnavailableError)
  await assert.rejects(store.totals(), StoreUnavailableError)
  assert.equal(describeD1Error(new Error("D1_ERROR: no such column: source: SQLITE_ERROR")), `the attempts table is out of date (no such column: source): ${MIGRATE_HINT}`)
  assert.equal(describeD1Error(new Error("D1_ERROR: database is locked")), "database is locked")
  assert.equal(describeStoreError(new StoreUnavailableError("D1: database is locked")), "D1: database is locked")
  assert.throws(() => createD1Store({ db: {} }), TypeError)
  d1.state.fail = null
  assert.equal((await store.record(ada)).replayed, true, "back to normal once the fault is gone")
})

// ---------------------------------------------------------------------------------------------
// The property the user asked for: every accepted game is in the database before "ok"
// ---------------------------------------------------------------------------------------------

test("every accepted POST is in D1 before answering ok; aggregates, league and health follow the rows", async () => {
  const site = makeSite()
  const games = [
    attempt({ score: 900, playedAt: "2026-10-16T14:05:00.000Z" }),
    attempt({ name: "Grace Hopper", email: "grace@example.com", score: 1500, useCase: "Drug discovery", playedAt: "2026-10-16T14:08:00.000Z" }),
    attempt({ email: " ADA@Example.com ", score: 1200, useCase: "Chat", playedAt: "2026-10-16T14:12:00.000Z" }),
    attempt({ score: 1000, useCase: "RAG", playedAt: "2026-10-16T14:20:00.000Z" }),
    attempt({ name: "Alan Turing", email: "alan@example.com", score: 1500, playedAt: "2026-10-16T14:25:00.000Z" }),
  ]
  const expected = [
    { attempts: 1, best: 900, latest: 900, rank: 1, players: 1, newBest: true },
    { attempts: 1, best: 1500, latest: 1500, rank: 1, players: 2, newBest: true },
    { attempts: 2, best: 1200, latest: 1200, rank: 2, players: 2, newBest: true },
    { attempts: 3, best: 1200, latest: 1000, rank: 2, players: 2, newBest: false },
    { attempts: 1, best: 1500, latest: 1500, rank: 2, players: 3, newBest: true },
  ]

  for (const [index, game] of games.entries()) {
    const n = index + 1
    const response = await post(site, game)
    assert.equal(response.status, 200, `game ${n}`)
    assert.deepEqual(await response.json(), { ok: true, ...expected[index] }, `game ${n} aggregates`)
    assert.equal(site.d1.count(), n, `game ${n}: one row per game, written before the response`)
    assert.equal(site.d1.state.batches, n, `game ${n}: one round trip to the database per game`)
    const row = site.d1.rows()[index]
    assert.equal(row.email, game.email.trim().toLowerCase(), "stored email is lowercased and trimmed")
    assert.equal(row.source, "web", "a browser on the team URL")
    assert.equal(row.replay_key, `${row.email}|${game.playedAt}|${game.score}`)
    site.tick(1000)
  }

  const statements = site.d1.state.statements
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(site.d1.state.statements, statements, "nothing is written after the response (no batching, no write-later)")
  assert.deepEqual(site.pending, [], "no mirror work was scheduled: the mirror is off by default")
  assert.deepEqual(site.gh.commits, [], "GitHub is not touched")
  assert.ok(!site.logs.join("\n").includes("@") && !/Ada|Grace|Alan/.test(site.logs.join("\n")), "logs carry no personal data")
  assert.ok(site.logs.some((line) => /^POST \/api\/attempt 200 \d+ms$/.test(line)))

  const league = await (await get(site, "/api/league")).json()
  assert.equal(league.ok, true)
  assert.equal(league.attempts, 5)
  assert.deepEqual(league.players.map((player) => [player.rank, player.name, player.attempts, player.best, player.latest, player.bestUseCase, player.fteEquivalent]), [
    [1, "Grace Hopper", 1, 1500, 1500, "Drug discovery", 2.5],
    [2, "Alan Turing", 1, 1500, 1500, "Chat + RAG", 2.5],
    [3, "Ada Lovelace", 3, 1200, 1000, "Chat", 2.5],
  ])
  assert.ok(!JSON.stringify(league).includes("@"), "the league never carries emails")

  const health = await (await get(site, "/api/health")).json()
  assert.deepEqual(health, {
    ok: true,
    service: SERVICE,
    gate: false,
    configured: true,
    session: null,
    store: { kind: "d1", ok: true, attempts: 5, players: 3, lastPlayedAt: "2026-10-16T14:25:00.000Z", lastError: null, lastErrorAt: null, lastOkAt: "2026-10-16T15:00:04.000Z" },
    mirror: { enabled: false },
  })
})

test("re-posting the same game (a browser's queue replay or a kiosk's journal) is stored once and answers the same numbers", async () => {
  const site = makeSite()
  const game = attempt()
  assert.deepEqual(await (await post(site, game)).json(), { ok: true, attempts: 1, best: 900, latest: 900, rank: 1, players: 1, newBest: true })
  site.tick(5000)
  const again = await (await post(site, game)).json()
  assert.deepEqual(again, { ok: true, attempts: 1, best: 900, latest: 900, rank: 1, players: 1, newBest: true })
  assert.equal(site.d1.count(), 1, "same email + playedAt + score is the same game")
  assert.ok(sameAttempt(game, { ...game, name: "Someone Else" }) && !sameAttempt(game, { ...game, score: 901 }))

  // A different game by the same player a second later is a new row.
  const next = await (await post(site, attempt({ playedAt: "2026-10-16T14:05:01.000Z" }))).json()
  assert.equal(next.attempts, 2)
  assert.equal(site.d1.count(), 2)
})

test("when D1 fails the answer is 503 store_unavailable, nothing claims success, and health says why; no binding is 503 not_configured", async () => {
  const site = makeSite()
  assert.equal((await post(site, attempt())).status, 200)

  site.d1.state.fail = new Error("D1_ERROR: database is locked: SQLITE_BUSY")
  const down = await post(site, attempt({ score: 1000, playedAt: "2026-10-16T14:07:00.000Z" }))
  assert.equal(down.status, 503)
  assert.equal(down.headers.get("Retry-After"), "5")
  assert.deepEqual(await down.json(), { ok: false, error: "store_unavailable", message: "The scores database could not be reached. Please try again shortly." })
  assert.equal((await get(site, "/api/league")).status, 503, "reads fail the same way: the game shows its local board instead")
  const health = await get(site, "/api/health")
  assert.equal(health.status, 200, "health stays 200 and says in `store` what is wrong")
  const { store } = await health.json()
  assert.deepEqual(store, { kind: "d1", ok: false, attempts: null, players: null, lastPlayedAt: null, lastError: "D1: database is locked", lastErrorAt: "2026-10-16T15:00:00.000Z", lastOkAt: "2026-10-16T15:00:00.000Z" })
  site.d1.state.fail = null
  assert.equal(site.d1.count(), 1)

  // Once the database is back the very same payload (what the client queued) goes through.
  const recovered = await post(site, attempt({ score: 1000, playedAt: "2026-10-16T14:07:00.000Z" }))
  assert.equal(recovered.status, 200)
  assert.deepEqual(await recovered.json(), { ok: true, attempts: 2, best: 1000, latest: 1000, rank: 1, players: 1, newBest: true })
  assert.deepEqual((await (await get(site, "/api/health")).json()).store, { kind: "d1", ok: true, attempts: 2, players: 1, lastPlayedAt: "2026-10-16T14:07:00.000Z", lastError: null, lastErrorAt: null, lastOkAt: "2026-10-16T15:00:00.000Z" }, "a successful write clears the error")

  // The table is missing (migration not applied): the hint names the command.
  const fresh = makeSite({ DB: fakeD1({ migrate: false }) })
  const noTable = await post(fresh, attempt())
  assert.equal(noTable.status, 503)
  assert.equal((await noTable.json()).error, "store_unavailable")
  assert.match((await (await get(fresh, "/api/health")).json()).store.lastError, /^D1: the attempts table does not exist yet: run `npx wrangler d1 migrations apply tokenquest-players --remote`/)

  // No DB binding at all (wrangler.toml without [[d1_databases]]): nothing is lost, the clients queue.
  const unbound = await post(site, attempt(), { environment: site.env({ DB: undefined }) })
  assert.equal(unbound.status, 503)
  assert.equal((await unbound.json()).error, "not_configured")
  const unboundHealth = await (await get(site, "/api/health", { environment: site.env({ DB: undefined }) })).json()
  assert.equal(unboundHealth.configured, false)
  assert.equal(unboundHealth.store.ok, false)
  assert.match(unboundHealth.store.lastError, /^not configured: bind the D1 database/)
  assert.match(unboundHealth.message, /\[\[d1_databases\]\]/)
  const log = site.logs.join("\n")
  assert.match(log, /store unavailable: D1: database is locked/)
  assert.ok(!log.includes("@") && !log.includes(TOKEN), "logs carry neither emails nor tokens")
})

// ---------------------------------------------------------------------------------------------
// Staff access: the downloads and the page
// ---------------------------------------------------------------------------------------------

test("csv.mjs: RFC 4180 quoting, CRLF, a UTF-8 BOM, and no cell can start a formula", () => {
  assert.equal(csvCell("plain"), "plain")
  assert.equal(csvCell("Zoë O'Brien-Smith"), "Zoë O'Brien-Smith")
  assert.equal(csvCell("a,b"), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"')
  assert.equal(csvCell("cr\r\nlf"), '"cr\r\nlf"')
  assert.equal(csvCell(" padded "), '" padded "')
  assert.equal(csvCell(null), "")
  assert.equal(csvCell(undefined), "")
  assert.equal(csvCell(""), "")
  assert.equal(csvCell(0), "0")
  assert.equal(csvCell(-500), "-500", "numbers are never guarded or quoted")
  assert.equal(csvCell(1.5), "1.5")
  assert.equal(csvCell(Number.NaN), "")
  assert.equal(csvCell("=1+1@example.com"), "'=1+1@example.com", "a crafted email cannot run as a formula in Excel")
  assert.equal(csvCell("+44 20"), "'+44 20")
  assert.equal(csvCell("-minus"), "'-minus")
  assert.equal(csvCell("@handle"), "'@handle")
  assert.equal(csvCell("\tx"), "'\tx")
  assert.equal(csvCell('=HYPERLINK("x"),y'), `"'=HYPERLINK(""x""),y"`)

  const csv = renderAttemptsCsv([
    { ...validateAttempt(attempt()).attempt, source: "web" },
    { ...validateAttempt(attempt({ name: "Grace Hopper", email: "grace@example.com", score: 1500, useCase: 'Drug "discovery", fast', scenario: "", costPerMTok: null, profitPerHour: -500, fteEquivalent: undefined, annualSavings: null, humanHoursPerYear: undefined, playedAt: "2026-10-16T14:08:00.000Z" })).attempt, source: "kiosk" },
  ])
  assert.ok(csv.startsWith(BOM), "BOM first so Excel reads UTF-8")
  assert.equal(BOM, "\uFEFF")
  const lines = csv.slice(1).split("\r\n")
  assert.deepEqual(lines, [
    CSV_COLUMNS.join(","),
    "2026-10-16T14:05:00.000Z,Ada Lovelace,ada@example.com,900,Chat + RAG,London launch,1.5,4200,2.5,120000,4500,2026-10-16T14:00:00.000Z,web",
    '2026-10-16T14:08:00.000Z,Grace Hopper,grace@example.com,1500,"Drug ""discovery"", fast",,,-500,,,,2026-10-16T14:00:00.000Z,kiosk',
    "",
  ])
  assert.deepEqual(CSV_COLUMNS, ["played_at", "name", "email", "score", "use_case", "scenario", "cost_per_mtok", "profit_per_hour", "fte_equivalent", "annual_savings", "human_hours_per_year", "consent_at", "source"])
  assert.equal(renderAttemptsCsv([]), `${BOM}${CSV_COLUMNS.join(",")}\r\n`)
  assert.equal(csvFilename(new Date(T0)), "token-quest-players-2026-10-16.csv")
  assert.equal(countLine({ players: 1, attempts: 1, now: T0 }), "1 player · 1 game · updated 2026-10-16 15:00 UTC")
  assert.equal(countLine({ players: 3, attempts: 5, now: T0 }), "3 players · 5 games · updated 2026-10-16 15:00 UTC")
})

test("staff downloads: export.csv, export.md and players.json carry every game with names and emails; /staff renders players and counts", async () => {
  const site = makeSite()
  const games = [
    attempt({ score: 900, playedAt: "2026-10-16T14:05:00.000Z" }),
    attempt({ name: "Grace O'Hopper", email: "grace.o'hopper@example.com", score: 1500, useCase: "Drug discovery", playedAt: "2026-10-16T14:08:00.000Z" }),
    attempt({ score: 1200, useCase: "Chat, fast", playedAt: "2026-10-16T14:12:00.000Z" }),
  ]
  for (const game of games) assert.equal((await post(site, game)).status, 200)
  site.tick(60_000)

  const csv = await get(site, "/api/export.csv")
  assert.equal(csv.status, 200)
  assert.equal(csv.headers.get("Content-Type"), "text/csv; charset=utf-8")
  assert.equal(csv.headers.get("Content-Disposition"), 'attachment; filename="token-quest-players-2026-10-16.csv"')
  assert.equal(csv.headers.get("Cache-Control"), "no-store")
  assert.equal(csv.headers.get("X-Robots-Tag"), "noindex, nofollow")
  // Response.text() strips a leading BOM (per the Fetch spec), so look at the bytes Excel will see.
  const bytes = new Uint8Array(await csv.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "the UTF-8 byte-order mark is on the wire")
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
  assert.ok(text.startsWith(BOM))
  const lines = text.slice(1).split("\r\n")
  assert.equal(lines[0], CSV_COLUMNS.join(","))
  assert.equal(lines.length, 5, "header + 3 games + the final line end")
  assert.equal(lines[1], "2026-10-16T14:05:00.000Z,Ada Lovelace,ada@example.com,900,Chat + RAG,London launch,1.5,4200,2.5,120000,4500,2026-10-16T14:00:00.000Z,web")
  assert.ok(lines[2].startsWith("2026-10-16T14:08:00.000Z,Grace O'Hopper,grace.o'hopper@example.com,1500,Drug discovery,"))
  assert.ok(lines[3].includes(',"Chat, fast",'), "a comma in a job name is quoted")

  const md = await get(site, "/api/export.md")
  assert.equal(md.status, 200)
  assert.equal(md.headers.get("Content-Type"), "text/markdown; charset=utf-8")
  assert.equal(md.headers.get("Content-Disposition"), 'attachment; filename="PLAYERS.md"')
  const sheet = await md.text()
  assert.ok(sheet.includes("Updated 2026-10-16T15:01:00.000Z · 2 players · 3 games"), "rendered on request from the rows")
  assert.deepEqual(tableRows(sheet, "Players").slice(2).map((row) => [row[1], row[2], row[3], row[4]]), [
    ["Grace O'Hopper", "grace.o'hopper@example.com", "1", "1,500"],
    ["Ada Lovelace", "ada@example.com", "2", "1,200"],
  ])
  assert.equal(tableRows(sheet, "Attempts").length - 2, 3)

  const json = await get(site, "/api/players.json")
  assert.equal(json.status, 200)
  assert.equal(json.headers.get("Content-Type"), "application/json; charset=utf-8")
  assert.equal(json.headers.get("Cache-Control"), "no-store")
  const rows = await json.json()
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0], { id: 1, ...validateAttempt(games[0]).attempt, source: "web" }, "the shape players.json always had, plus id and source")
  assert.deepEqual(rows.map((row) => row.email), ["ada@example.com", "grace.o'hopper@example.com", "ada@example.com"])
  assert.equal(serialiseAttempts(rows), `${JSON.stringify(games.map((game) => validateAttempt(game).attempt), null, 2)}\n`, "the mirror's players.json strips the database fields")

  const page = await get(site, STAFF_PATH)
  assert.equal(page.status, 200)
  assert.equal(page.headers.get("Content-Type"), "text/html; charset=utf-8")
  assert.equal(page.headers.get("Cache-Control"), "no-store")
  assert.equal(page.headers.get("X-Robots-Tag"), "noindex, nofollow")
  assert.match(page.headers.get("Content-Security-Policy"), /default-src 'none'/)
  const body = await page.text()
  assert.ok(body.includes("2 players · 3 games · updated 2026-10-16 15:01 UTC"), "the count line")
  assert.ok(body.includes('href="/api/export.csv"') && body.includes(">Download CSV<"), "Download CSV button")
  assert.ok(body.includes('href="/api/export.md"') && body.includes(">Download PLAYERS.md<"), "Download PLAYERS.md button")
  assert.ok(body.includes("Grace O&#39;Hopper") && body.includes("grace.o&#39;hopper@example.com"), "names and emails are HTML-escaped")
  const cells = [...body.matchAll(/<tr><td class="n">(\d+)<\/td><td>([^<]*)<\/td><td class="mail">([^<]*)<\/td><td class="n">(\d+)<\/td><td class="n">([^<]*)<\/td><td class="n">([^<]*)<\/td><td class="t">([^<]*)<\/td><\/tr>/g)].map((m) => m.slice(1))
  assert.deepEqual(cells, [
    ["1", "Grace O&#39;Hopper", "grace.o&#39;hopper@example.com", "1", "1,500", "1,500", "2026-10-16 14:08"],
    ["2", "Ada Lovelace", "ada@example.com", "2", "1,200", "1,200", "2026-10-16 14:12"],
  ])
  assert.ok(!body.includes("<script"), "no scripts on the staff page")
  assert.ok(!body.includes('href="/logout"'), "no log-out link while the gate is off")
  assert.ok(staffPage({ players: [], attempts: 0, now: T0 }).includes("No games yet"), "an empty database says so")
  assert.ok(staffPage({ players: [], attempts: 0, now: T0, gate: true }).includes('href="/logout"'))

  assert.equal((await get(site, "/api/export.csv", { method: "POST" })).status, 405)
  assert.equal((await get(site, STAFF_PATH, { method: "POST" })).status, 405)
  const noDelete = await get(site, "/api/reset", { method: "POST" })
  assert.equal(noDelete.status, 404)
  assert.match((await noDelete.json()).message, /wrangler d1 execute/, "no deletion endpoint: clearing is a wrangler command")
  assert.ok(!site.logs.join("\n").includes("@"), "the downloads are logged as paths only")
})

// ---------------------------------------------------------------------------------------------
// The optional GitHub mirror
// ---------------------------------------------------------------------------------------------

test("mirror: off unless MIRROR_MARKDOWN is true with a repo and token; on, it rewrites players.json and PLAYERS.md after each game without ever failing one", async () => {
  const mirrored = { MIRROR_MARKDOWN: "true", GITHUB_TOKEN: TOKEN, PLAYERS_REPO: REPO, PLAYERS_BRANCH: "main" }

  // Off by default, and off (with a reason) when asked for but not set up.
  const off = makeSite({ GITHUB_TOKEN: TOKEN, PLAYERS_REPO: REPO })
  assert.equal((await post(off, attempt())).status, 200)
  assert.deepEqual(off.pending, [])
  assert.deepEqual((await (await get(off, "/api/health")).json()).mirror, { enabled: false })
  const halfway = makeSite({ MIRROR_MARKDOWN: "true", PLAYERS_REPO: REPO })
  assert.equal((await post(halfway, attempt())).status, 200)
  assert.deepEqual((await (await get(halfway, "/api/health")).json()).mirror, { enabled: false, lastError: "MIRROR_MARKDOWN is true but PLAYERS_REPO or the GITHUB_TOKEN secret is missing" })
  assert.equal(halfway.gh.requests.length, 0)

  // On: the game is answered from D1, then both files are rewritten from the rows in ctx.waitUntil.
  const site = makeSite(mirrored)
  const first = await post(site, attempt())
  assert.equal(first.status, 200)
  assert.equal(site.pending.length, 1, "one piece of background work per new game")
  await site.settle()
  assert.deepEqual(site.gh.attempts(), [validateAttempt(attempt()).attempt], "players.json is the validated attempts, without database ids")
  assert.ok(site.gh.markdown().includes("· 1 player · 1 game"))
  assert.equal(site.gh.commitsFor(PLAYERS_JSON).length, 1)
  assert.equal(site.gh.commitsFor(PLAYERS_MD).length, 1)
  assert.ok(site.gh.commits.every((commit) => !commit.message.includes("@") && !/Ada|Grace/.test(commit.message)), "commit messages carry no personal data")

  // A replay stores nothing and mirrors nothing; a new game rewrites both files.
  assert.equal((await post(site, attempt())).status, 200)
  assert.equal(site.pending.length, 0, "a replayed game schedules no mirror work")
  site.tick(1000)
  assert.equal((await post(site, attempt({ name: "Grace Hopper", email: "grace@example.com", score: 1500, playedAt: "2026-10-16T14:08:00.000Z" }))).status, 200)
  await site.settle()
  assert.equal(site.gh.attempts().length, 2)
  assert.ok(site.gh.markdown().includes("Updated 2026-10-16T15:00:01.000Z · 2 players · 2 games"))
  const health = await (await get(site, "/api/health")).json()
  assert.deepEqual(health.mirror, { enabled: true, kind: "github", repo: REPO, branch: "main", sheet: PLAYERS_MD, ok: true, lastError: null, lastErrorAt: null, lastOkAt: "2026-10-16T15:00:01.000Z" })

  // Somebody else wrote the sheet meanwhile: the compare-and-swap re-reads and writes again.
  site.gh.state.conflictNext.add(PLAYERS_MD)
  assert.equal((await post(site, attempt({ score: 1000, playedAt: "2026-10-16T14:09:00.000Z" }))).status, 200)
  await site.settle()
  assert.equal(site.sleeps.length, 1, "one jittered backoff before the retry")
  assert.ok(site.sleeps[0] >= 100 && site.sleeps[0] < 300, `backoff ${site.sleeps[0]}ms`)
  assert.ok(site.gh.markdown().includes("· 2 players · 3 games"))

  // GitHub refuses the write (the usual 404: the PAT was not given the repo): the game is still ok,
  // D1 has it, and health names the cause under `mirror`, not `store`.
  site.gh.state.failWrites = 404
  site.tick(1000)
  const stillOk = await post(site, attempt({ score: 1100, playedAt: "2026-10-16T14:10:00.000Z" }))
  assert.equal(stillOk.status, 200)
  assert.equal((await stillOk.json()).attempts, 3)
  await site.settle()
  assert.equal(site.d1.count(), 4)
  const broken = await (await get(site, "/api/health")).json()
  assert.equal(broken.store.ok, true)
  assert.equal(broken.store.attempts, 4)
  assert.equal(broken.mirror.ok, false)
  assert.match(broken.mirror.lastError, /^write 404: token has no access to PLAYERS_REPO/)
  assert.equal(broken.mirror.lastErrorAt, "2026-10-16T15:00:02.000Z")
  assert.equal(broken.mirror.lastOkAt, "2026-10-16T15:00:01.000Z")
  assert.match(site.logs.join("\n"), /mirror failed: write 404: token has no access to PLAYERS_REPO/)
  site.gh.state.failWrites = null
  assert.equal((await post(site, attempt({ score: 1150, playedAt: "2026-10-16T14:11:00.000Z" }))).status, 200)
  await site.settle()
  assert.equal((await (await get(site, "/api/health")).json()).mirror.ok, true, "the next successful mirror clears the error")
  assert.equal(site.gh.attempts().length, 5, "the mirror catches up with every row, including the one it missed")
  assert.ok(!site.logs.join("\n").includes("@") && !site.logs.join("\n").includes(TOKEN))

  // The mirror store on its own: a corrupt or foreign players.json is simply overwritten with the truth,
  // and it gives up after MAX_TRIES compare-and-swap conflicts.
  const gh = fakeGitHub()
  const sleeps = []
  const store = createPlayersStore({ client: createContentsClient({ token: TOKEN, repo: REPO, fetch: gh.fetch }), random: () => 0, sleep: async (ms) => sleeps.push(ms) })
  gh.files.set(PLAYERS_JSON, "{ not an array")
  const rows = [validateAttempt(attempt()).attempt]
  await store.publish(rows)
  assert.deepEqual(gh.attempts(), rows)
  await store.publish(rows)
  assert.equal(gh.commitsFor(PLAYERS_JSON).length, 1, "unchanged players.json is not committed again")
  assert.equal(gh.commitsFor(PLAYERS_MD).length, 2, "PLAYERS.md is re-stamped every time")
  gh.state.alwaysConflict = true
  await assert.rejects(store.publish(rows), StoreUnavailableError)
  assert.equal(sleeps.length, MAX_TRIES - 1, "backs off between tries, not after the last one")
  gh.state.alwaysConflict = false
  await assert.rejects(createPlayersStore({ client: createContentsClient({ token: "github_pat_WRONG", repo: REPO, fetch: gh.fetch }) }).ping(), (error) => error instanceof StoreUnavailableError && error.status === 401 && !error.message.includes("WRONG"))
})

// ---------------------------------------------------------------------------------------------
// GitHub client helpers (used by the mirror)
// ---------------------------------------------------------------------------------------------

test("github.mjs: base64 is UTF-8 safe both ways, repo slugs are checked and errors carry no content", async () => {
  for (const text of ["Zoë O'Brien — ✓ 東京", "", "plain", JSON.stringify([attempt()])]) assert.equal(base64ToUtf8(utf8ToBase64(text)), text)
  assert.equal(base64ToUtf8("aGVs\nbG8="), "hello", "GitHub wraps base64 at 60 columns")
  assert.deepEqual(parseRepo(" punkrockquantum/token-quest-players "), { owner: "punkrockquantum", repo: "token-quest-players" })
  assert.equal(parseRepo("nope"), null)
  assert.equal(parseRepo("a/b/c"), null)
  assert.throws(() => createContentsClient({ token: TOKEN, repo: "nope" }), /owner\/repo/)
  assert.throws(() => createContentsClient({ token: "", repo: REPO }), /GITHUB_TOKEN/)

  const gh = fakeGitHub()
  const client = createContentsClient({ token: TOKEN, repo: REPO, fetch: gh.fetch })
  assert.equal(await client.read(PLAYERS_JSON), null, "missing file reads as null")
  const created = await client.write(PLAYERS_JSON, "[]\n", { message: "create" })
  assert.equal(created.sha, blobSha("[]\n"))
  assert.deepEqual(await client.read(PLAYERS_JSON), { text: "[]\n", sha: created.sha })
  await assert.rejects(client.write(PLAYERS_JSON, "[1]\n", { sha: "stale", message: "update" }), ConflictError)
  await assert.rejects(client.write(PLAYERS_JSON, "[1]\n", { message: "update without sha" }), ConflictError)
  gh.state.failWrites = 500
  await assert.rejects(client.write(PLAYERS_JSON, "[1]\n", { sha: created.sha, message: "x" }), (error) => error instanceof GitHubError && error.status === 500 && !error.message.includes("[1]"))
  gh.state.failWrites = null
  const wrong = createContentsClient({ token: "github_pat_WRONG", repo: REPO, fetch: gh.fetch })
  await assert.rejects(wrong.ping(), (error) => error instanceof GitHubError && error.status === 401 && !error.message.includes("WRONG"))
  assert.ok(gh.commits.every((commit) => commit.branch === "main" && commit.committer?.name === "Token Quest intake"))
  assert.equal(describeStoreError(new GitHubError(404, "write", PLAYERS_JSON)), "write 404: token has no access to PLAYERS_REPO (give the fine-grained PAT that repository, or fix PLAYERS_REPO / PLAYERS_BRANCH)")
  assert.equal(describeStoreError(new StoreUnavailableError("wrapped", { cause: new GitHubError(401, "read", PLAYERS_MD) })), "read 401: GitHub rejected the token (expired or revoked): make a new PAT and run wrangler secret put GITHUB_TOKEN")
})

// ---------------------------------------------------------------------------------------------
// Edges: CORS, body limits, validation, methods, rate limit
// ---------------------------------------------------------------------------------------------

test("CORS: only the allow-listed origins get through; preflight is answered; curl without Origin works", async () => {
  const site = makeSite()
  assert.deepEqual([...parseOrigins(" https://punkrockquantum.github.io/, punkrockquantum.github.io, http://127.0.0.1:8099 ,, ::bad")], ["https://punkrockquantum.github.io", "http://127.0.0.1:8099"])

  const allowed = await post(site, attempt())
  assert.equal(allowed.status, 200)
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), ORIGIN)
  assert.equal(allowed.headers.get("Vary"), "Origin")
  assert.equal(allowed.headers.get("Cache-Control"), "no-store")
  assert.equal(allowed.headers.get("Content-Type"), "application/json; charset=utf-8")

  const evil = await post(site, attempt({ playedAt: "2026-10-16T14:06:00.000Z" }), { origin: "https://evil.example" })
  assert.equal(evil.status, 403)
  assert.equal((await evil.json()).error, "cross_origin")
  assert.equal(evil.headers.get("Access-Control-Allow-Origin"), null)
  assert.equal(site.d1.count(), 1, "a cross-origin attempt is not stored")
  assert.equal((await get(site, "/api/league", { origin: "null" })).status, 403)

  const preflight = await get(site, "/api/attempt", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN)
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS")
  assert.equal(preflight.headers.get("Access-Control-Allow-Headers"), "Content-Type")

  const curl = await get(site, "/api/league", { origin: null })
  assert.equal(curl.status, 200)
  assert.equal(curl.headers.get("Access-Control-Allow-Origin"), null)

  const extra = await post(site, attempt({ playedAt: "2026-10-16T14:07:00.000Z" }), { origin: "http://127.0.0.1:8099", environment: site.env({ ALLOWED_ORIGINS: `${ORIGIN}, http://127.0.0.1:8099` }) })
  assert.equal(extra.status, 200)
  assert.equal(extra.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:8099")
})

test("limits: 16 KB body cap, JSON only, consent must be true, methods and unknown routes", async () => {
  const site = makeSite()

  const declared = await post(site, attempt(), { headers: { "Content-Length": String(BODY_LIMIT + 1) } })
  assert.equal(declared.status, 413)
  const huge = await post(site, attempt({ useCase: "x".repeat(BODY_LIMIT) }))
  assert.equal(huge.status, 413)
  const streamed = await site.handler.fetch(
    new Request(`${INTAKE}/api/attempt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.7" },
      body: new ReadableStream({
        start(controller) {
          for (let i = 0; i < 20; i += 1) controller.enqueue(new TextEncoder().encode("x".repeat(1024)))
          controller.close()
        },
      }),
      duplex: "half",
    }),
    site.env(),
  )
  assert.equal(streamed.status, 413, "a chunked body is cut off at the cap too")
  assert.equal(BODY_LIMIT, 16 * 1024)

  assert.equal((await post(site, null, { raw: JSON.stringify(attempt()), headers: { "Content-Type": "text/plain" } })).status, 415)
  const broken = await post(site, null, { raw: "{not json" })
  assert.equal(broken.status, 400)
  assert.equal((await broken.json()).error, "bad_json")
  assert.equal((await post(site, null, { raw: "   " })).status, 400)

  const noConsent = await post(site, attempt({ consent: false }))
  assert.equal(noConsent.status, 400)
  const body = await noConsent.json()
  assert.equal(body.error, "invalid_attempt")
  assert.ok(body.details.includes("consent must be true"))
  assert.equal((await post(site, attempt({ consent: "true" }))).status, 400)
  const invalid = await post(site, attempt({ name: "<script>alert(1)</script>", email: "nope", score: -1 }))
  assert.equal(invalid.status, 400)
  const details = await invalid.json()
  assert.ok(details.details.length >= 3 && !JSON.stringify(details).includes("<script>"))
  assert.equal(site.d1.count(), 0, "rejected attempts never touch the database")

  const wrongMethod = await get(site, "/api/attempt")
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get("Allow"), "POST, OPTIONS")
  assert.equal((await get(site, "/api/league", { method: "POST" })).status, 405)
  assert.equal((await get(site, "/api/nothing")).status, 404)
  const xlsx = await get(site, "/api/export.xlsx")
  assert.equal(xlsx.status, 404, "no Excel endpoint: the CSV opens in Excel")
  assert.match((await xlsx.json()).message, /export\.csv/)
  const root = await get(site, "/")
  assert.equal(root.status, 200)
  assert.match(await root.text(), /tokenquest: POST \/api\/attempt.*GET \/staff/, "without an assets binding the root is a plain-text index of the API")
  assert.equal(typeof worker.fetch, "function", "the module's default export is what wrangler deploys")
})

test("one origin: the game is served from env.ASSETS, /api/* and /staff by the handler, and same-origin posts need no CORS", async () => {
  const site = makeSite()
  const served = []
  const ASSETS = {
    fetch: async (request) => {
      const { pathname } = new URL(request.url)
      served.push(pathname)
      return new Response(`asset ${pathname}`, { status: pathname === "/missing" ? 404 : 200, headers: { "Content-Type": "text/plain" } })
    },
  }
  const environment = site.env({ ASSETS })

  for (const route of ["/", "/index.html", "/js/main.js", "/css/game.css", "/assets/fonts/x.woff2", "/missing", "/api", "/staff.html"]) {
    const response = await site.handler.fetch(new Request(`${INTAKE}${route}`, { headers: { Origin: "https://evil.example" } }), environment)
    assert.equal(await response.text(), `asset ${route}`, `${route} comes straight from the assets binding, whatever the Origin header says`)
  }
  assert.deepEqual(served, ["/", "/index.html", "/js/main.js", "/css/game.css", "/assets/fonts/x.woff2", "/missing", "/api", "/staff.html"])

  const health = await site.handler.fetch(new Request(`${INTAKE}/api/health`), environment)
  assert.equal(health.status, 200)
  assert.equal(health.headers.get("Content-Type"), "application/json; charset=utf-8")
  assert.deepEqual(await health.json(), {
    ok: true,
    service: SERVICE,
    gate: false,
    configured: true,
    session: null,
    store: { kind: "d1", ok: true, attempts: 0, players: 0, lastPlayedAt: null, lastError: null, lastErrorAt: null, lastOkAt: null },
    mirror: { enabled: false },
  })
  assert.equal((await site.handler.fetch(new Request(`${INTAKE}/api/nothing`), environment)).status, 404)
  assert.equal((await (await site.handler.fetch(new Request(`${INTAKE}/api/nothing`), environment)).json()).error, "not_found")
  const noExport = await site.handler.fetch(new Request(`${INTAKE}/api/export.xlsx`), environment)
  assert.equal(noExport.status, 404)
  assert.match((await noExport.json()).message, /export\.csv/)
  const staff = await site.handler.fetch(new Request(`${INTAKE}${STAFF_PATH}`), environment)
  assert.equal(staff.status, 200)
  assert.ok((await staff.text()).includes("0 players · 0 games"), "/staff is the script's page, not an asset")
  assert.equal(served.length, 8, "no /api or /staff request ever touched the assets binding")

  // The game on the Worker posts with its own origin (browsers send Origin on every POST): allowed, no CORS headers needed.
  const sameOrigin = await post(site, attempt(), { origin: new URL(INTAKE).origin, environment })
  assert.equal(sameOrigin.status, 200)
  assert.equal(sameOrigin.headers.get("Access-Control-Allow-Origin"), null)
  assert.equal(site.d1.count(), 1)
  const pagesCopy = await post(site, attempt({ playedAt: "2026-10-16T14:06:00.000Z" }), { origin: ORIGIN, environment })
  assert.equal(pagesCopy.status, 200, "the GitHub Pages copy stays on the allowlist")
  assert.equal(pagesCopy.headers.get("Access-Control-Allow-Origin"), ORIGIN)
  assert.equal((await post(site, attempt(), { origin: "https://evil.example", environment })).status, 403)

  // Without the DB binding the game still loads; health says so and attempts are queued by the client.
  const unbound = site.env({ ASSETS, DB: undefined })
  const pending = await (await site.handler.fetch(new Request(`${INTAKE}/api/health`), unbound)).json()
  assert.equal(pending.ok, true)
  assert.equal(pending.configured, false)
  assert.equal(pending.store.attempts, null)
  assert.match(pending.message, /d1_databases/)
  const queued = await post(site, attempt(), { origin: new URL(INTAKE).origin, environment: unbound })
  assert.equal(queued.status, 503)
  assert.equal((await queued.json()).error, "not_configured")
})

test("rate limit: a token bucket per IP, 429 with Retry-After, refills with time, other IPs unaffected", async () => {
  const site = makeSite({ RATE_LIMIT_ATTEMPTS_PER_MINUTE: "3", RATE_LIMIT_READS_PER_MINUTE: "2" })
  for (let i = 0; i < 3; i += 1) assert.equal((await post(site, attempt({ playedAt: `2026-10-16T14:0${i}:00.000Z` }))).status, 200)
  const limited = await post(site, attempt({ playedAt: "2026-10-16T14:09:00.000Z" }))
  assert.equal(limited.status, 429)
  assert.deepEqual(await limited.json(), { ok: false, error: "rate_limited", message: "Too many requests from this network; try again in a moment." })
  assert.match(limited.headers.get("Retry-After"), /^\d+$/)
  assert.equal(site.d1.count(), 3, "the throttled attempt is not stored (the client queues it)")
  assert.equal((await post(site, attempt({ playedAt: "2026-10-16T14:09:00.000Z" }), { ip: "198.51.100.9" })).status, 200, "another IP has its own bucket")
  site.tick(20_000)
  assert.equal((await post(site, attempt({ playedAt: "2026-10-16T14:10:00.000Z" }))).status, 200, "one token back after 20 s at 3/min")
  assert.equal((await get(site, "/api/league")).status, 200)
  assert.equal((await get(site, "/api/health")).status, 200)
  assert.equal((await get(site, "/api/export.csv")).status, 429, "reads (league, health, the downloads, /staff) share one bucket")

  let now = 0
  const limiter = createRateLimiter({ perMinute: 60, capacity: 2, now: () => now, maxKeys: 3 })
  assert.deepEqual([limiter.take("a").ok, limiter.take("a").ok, limiter.take("a")], [true, true, { ok: false, retryAfter: 1 }])
  now += 1000
  assert.equal(limiter.take("a").ok, true)
  limiter.take("b")
  limiter.take("c")
  now += 60_000
  limiter.take("d")
  assert.ok(limiter.size <= 3, "idle buckets are pruned when the map is full")
})
