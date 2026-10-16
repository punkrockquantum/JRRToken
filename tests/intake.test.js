/**
 * The intake Worker (deploy/intake-worker) against an in-memory fake of the GitHub Contents API.
 * No network, no Cloudflare: the Worker is plain ESM on Web APIs, so Node runs it as is.
 */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { ConflictError, GitHubError, base64ToUtf8, createContentsClient, parseRepo, utf8ToBase64 } from "../deploy/intake-worker/src/github.mjs"
import { ATTEMPTS_HEADERS, PLAYERS_HEADERS, escapeCell, formatScore, formatTime, renderPlayersMarkdown, statusLine } from "../deploy/intake-worker/src/markdown.mjs"
import { aggregatePlayers as workerAggregate, publicLeague as workerPublic } from "../deploy/intake-worker/src/players.mjs"
import { createRateLimiter } from "../deploy/intake-worker/src/ratelimit.mjs"
import { MAX_TRIES, PLAYERS_JSON, PLAYERS_MD, StoreUnavailableError, createPlayersStore, sameAttempt } from "../deploy/intake-worker/src/store.mjs"
import { validateAttempt as workerValidate } from "../deploy/intake-worker/src/validate.mjs"
import worker, { BODY_LIMIT, createHandler, parseOrigins } from "../deploy/intake-worker/src/worker.mjs"
import { aggregatePlayers, publicLeague } from "../server/players.mjs"
import { validateAttempt } from "../server/validate.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const WORKER = path.join(ROOT, "deploy", "intake-worker", "src")
const REPO = "punkrockquantum/token-quest-players"
const TOKEN = "github_pat_TEST_ONLY_not_a_real_token"
const ORIGIN = "https://punkrockquantum.github.io"
const INTAKE = "https://token-quest-intake.example.workers.dev"
const T0 = Date.parse("2026-10-16T15:00:00.000Z")

const env = (overrides = {}) => ({ GITHUB_TOKEN: TOKEN, PLAYERS_REPO: REPO, PLAYERS_BRANCH: "main", ALLOWED_ORIGINS: ORIGIN, ...overrides })

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
 * Enough of api.github.com for the client: GET/PUT /repos/:repo/contents/:path with base64 bodies,
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

/** A handler with every side effect captured: fake GitHub, frozen clock, recorded sleeps and log lines. */
function makeHandler(gh, overrides = {}) {
  const logs = []
  const sleeps = []
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
  return { handler, logs, sleeps, tick: (ms) => (clock += ms) }
}

function headersFor({ origin = ORIGIN, ip = "203.0.113.7", headers = {} }) {
  const out = { "CF-Connecting-IP": ip, ...headers }
  if (origin !== null) out.Origin = origin
  return out
}

function post(handler, body, options = {}) {
  const { raw, environment = env() } = options
  const request = new Request(`${INTAKE}/api/attempt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersFor(options) },
    body: raw ?? JSON.stringify(body),
  })
  return handler.fetch(request, environment)
}

function get(handler, route, options = {}) {
  const { method = "GET", environment = env() } = options
  return handler.fetch(new Request(`${INTAKE}${route}`, { method, headers: headersFor(options) }), environment)
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
// GitHub client helpers
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
})

// ---------------------------------------------------------------------------------------------
// The property the user asked for: every accepted game rewrites the sheet before "ok"
// ---------------------------------------------------------------------------------------------

test("every accepted POST commits players.json and PLAYERS.md before answering ok; rows are added or updated in place", async () => {
  const gh = fakeGitHub()
  const { handler, logs, tick } = makeHandler(gh)
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
    const response = await post(handler, game)
    assert.equal(response.status, 200, `game ${n}`)
    assert.deepEqual(await response.json(), { ok: true, ...expected[index] }, `game ${n} aggregates`)

    assert.equal(gh.commitsFor(PLAYERS_JSON).length, n, `game ${n}: players.json committed once per game`)
    assert.equal(gh.commitsFor(PLAYERS_MD).length, n, `game ${n}: PLAYERS.md regenerated once per game, before the response`)
    assert.equal(gh.attempts().length, n)
    assert.equal(gh.attempts()[index].email, "ada@example.com".replace("ada", game.email.trim().toLowerCase().split("@")[0]), "stored email is lowercased and trimmed")

    const md = gh.markdown()
    assert.ok(md.includes(`Updated ${new Date(T0 + index * 1000).toISOString()} · ${expected[index].players} player${expected[index].players === 1 ? "" : "s"} · ${n} game${n === 1 ? "" : "s"}`), md.split("\n")[2])
    assert.equal(tableRows(md, "Attempts").length - 2, n, `game ${n}: the Attempts table gains exactly one row`)
    assert.equal(tableRows(md, "Players").length - 2, expected[index].players, `game ${n}: one Players row per email`)
    tick(1000)
  }

  const players = tableRows(gh.markdown(), "Players").slice(2)
  assert.deepEqual(players, [
    ["1", "Grace Hopper", "grace@example.com", "1", "1,500", "1,500", "Drug discovery", "2026-10-16 14:08", "2026-10-16 14:08"],
    ["2", "Alan Turing", "alan@example.com", "1", "1,500", "1,500", "Chat + RAG", "2026-10-16 14:25", "2026-10-16 14:25"],
    ["3", "Ada Lovelace", "ada@example.com", "3", "1,200", "1,000", "Chat", "2026-10-16 14:05", "2026-10-16 14:20"],
  ])
  assert.equal(players.filter((row) => row[2] === "ada@example.com").length, 1, "a returning player is updated in place, not added again")
  assert.equal(tableRows(gh.markdown(), "Attempts").slice(2)[0][0], "2026-10-16 14:25", "attempts are listed newest first")

  const writes = gh.requests.filter((request) => request.method === "PUT").length
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(gh.requests.filter((request) => request.method === "PUT").length, writes, "nothing is written after the response (no batching, no write-later)")
  assert.ok(gh.commits.every((commit) => !commit.message.includes("@") && !/Ada|Grace|Alan/.test(commit.message)), "commit messages carry no personal data")
  assert.ok(!logs.join("\n").includes("@") && !/Ada|Grace|Alan/.test(logs.join("\n")), "logs carry no personal data")
  assert.ok(logs.some((line) => /^POST \/api\/attempt 200 \d+ms$/.test(line)))

  const league = await (await get(handler, "/api/league")).json()
  assert.equal(league.ok, true)
  assert.equal(league.attempts, 5)
  assert.deepEqual(league.players.map((player) => [player.rank, player.name, player.attempts, player.best, player.latest, player.bestUseCase, player.fteEquivalent]), [
    [1, "Grace Hopper", 1, 1500, 1500, "Drug discovery", 2.5],
    [2, "Alan Turing", 1, 1500, 1500, "Chat + RAG", 2.5],
    [3, "Ada Lovelace", 3, 1200, 1000, "Chat", 2.5],
  ])
  assert.ok(!JSON.stringify(league).includes("@"), "the league never carries emails")

  const health = await (await get(handler, "/api/health")).json()
  assert.deepEqual(health, { ok: true, service: "token-quest-intake", repo: REPO, branch: "main", sheet: PLAYERS_MD, attempts: 5, players: 3 })
})

test("a 409 from the Contents API (someone else wrote first) re-reads, re-applies and succeeds", async () => {
  const gh = fakeGitHub()
  const { handler, sleeps } = makeHandler(gh)
  assert.equal((await post(handler, attempt())).status, 200)

  // Between our read and our write, another isolate records Grace's game.
  const grace = validateAttempt(attempt({ name: "Grace Hopper", email: "grace@example.com", score: 1500, playedAt: "2026-10-16T14:06:00.000Z" })).attempt
  gh.state.beforePut = (file) => {
    if (file === PLAYERS_JSON) gh.files.set(PLAYERS_JSON, `${JSON.stringify([...gh.attempts(), grace], null, 2)}\n`)
  }
  const response = await post(handler, attempt({ score: 1000, playedAt: "2026-10-16T14:07:00.000Z" }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, attempts: 2, best: 1000, latest: 1000, rank: 2, players: 2, newBest: true })
  assert.deepEqual(
    gh.attempts().map((item) => [item.email, item.score]),
    [["ada@example.com", 900], ["grace@example.com", 1500], ["ada@example.com", 1000]],
    "nothing lost: the other writer's game and ours are both on file",
  )
  assert.equal(sleeps.length, 1, "one jittered backoff before the retry")
  assert.ok(sleeps[0] >= 100 && sleeps[0] < 300, `backoff ${sleeps[0]}ms`)
  assert.ok(tableRows(gh.markdown(), "Attempts").length - 2 === 3 && gh.markdown().includes("· 2 players · 3 games"))

  // A conflict on the Markdown write alone is retried too (and the sheet is re-rendered from the newest truth).
  gh.state.conflictNext.add(PLAYERS_MD)
  const third = await post(handler, attempt({ score: 1100, playedAt: "2026-10-16T14:09:00.000Z" }))
  assert.equal(third.status, 200)
  assert.equal(gh.commitsFor(PLAYERS_MD).length, 3)
  assert.ok(gh.markdown().includes("· 2 players · 4 games"))
  assert.equal(sleeps.length, 2)
})

test("when GitHub cannot be written the answer is 503 store_unavailable and nothing claims success", async () => {
  const gh = fakeGitHub()
  const { handler, logs, sleeps } = makeHandler(gh)
  assert.equal((await post(handler, attempt())).status, 200)
  const before = { json: gh.commitsFor(PLAYERS_JSON).length, md: gh.commitsFor(PLAYERS_MD).length }

  gh.state.failWrites = 500
  const down = await post(handler, attempt({ score: 1000, playedAt: "2026-10-16T14:07:00.000Z" }))
  assert.equal(down.status, 503)
  assert.equal(down.headers.get("Retry-After"), "5")
  assert.deepEqual(await down.json(), { ok: false, error: "store_unavailable", message: "The player sheet could not be updated. Please try again shortly." })
  assert.deepEqual({ json: gh.commitsFor(PLAYERS_JSON).length, md: gh.commitsFor(PLAYERS_MD).length }, before, "no commit when the store failed")
  assert.equal(gh.attempts().length, 1)
  gh.state.failWrites = null

  gh.state.alwaysConflict = true
  const puts = gh.requests.filter((request) => request.method === "PUT").length
  const racing = await post(handler, attempt({ score: 1000, playedAt: "2026-10-16T14:07:00.000Z" }))
  assert.equal(racing.status, 503)
  assert.equal((await racing.json()).error, "store_unavailable")
  assert.equal(gh.requests.filter((request) => request.method === "PUT").length - puts, MAX_TRIES, "gives up after MAX_TRIES compare-and-swap attempts")
  assert.equal(sleeps.length, MAX_TRIES - 1, "backs off between tries, not after the last one")
  gh.state.alwaysConflict = false

  // Once GitHub is back the very same payload (what the client queued) goes through and the sheet moves.
  const recovered = await post(handler, attempt({ score: 1000, playedAt: "2026-10-16T14:07:00.000Z" }))
  assert.equal(recovered.status, 200)
  assert.deepEqual(await recovered.json(), { ok: true, attempts: 2, best: 1000, latest: 1000, rank: 1, players: 1, newBest: true })
  assert.equal(gh.attempts().length, 2)
  assert.equal(gh.commitsFor(PLAYERS_MD).length, before.md + 1)

  // Reads fail the same way: the league answers 503 so the game shows its local board instead.
  gh.state.failReads = 500
  assert.equal((await get(handler, "/api/league")).status, 503)
  assert.equal((await get(handler, "/api/health")).status, 503)
  gh.state.failReads = null

  // A wrong token or a repo the token cannot see: health says so, attempts are not lost.
  const badToken = await get(handler, "/api/health", { environment: env({ GITHUB_TOKEN: "github_pat_WRONG", PLAYERS_REPO: "punkrockquantum/other" }) })
  assert.equal(badToken.status, 503)
  const unconfigured = await post(handler, attempt(), { environment: env({ GITHUB_TOKEN: "" }) })
  assert.equal(unconfigured.status, 503)
  assert.equal((await unconfigured.json()).error, "not_configured")
  const log = logs.join("\n")
  assert.match(log, /store unavailable: GitHub write players\.json failed with HTTP 500/)
  assert.ok(!log.includes("@") && !log.includes("WRONG") && !log.includes(TOKEN), "logs carry neither emails nor tokens")
})

test("re-posting the same game (the client's queue replay) does not duplicate it but still refreshes PLAYERS.md", async () => {
  const gh = fakeGitHub()
  const { handler, tick } = makeHandler(gh)
  const game = attempt()
  assert.deepEqual(await (await post(handler, game)).json(), { ok: true, attempts: 1, best: 900, latest: 900, rank: 1, players: 1, newBest: true })
  tick(5000)
  const again = await (await post(handler, game)).json()
  assert.deepEqual(again, { ok: true, attempts: 1, best: 900, latest: 900, rank: 1, players: 1, newBest: true })
  assert.equal(gh.attempts().length, 1, "same email + playedAt + score is the same game")
  assert.equal(gh.commitsFor(PLAYERS_JSON).length, 1)
  assert.equal(gh.commitsFor(PLAYERS_MD).length, 2, "the sheet is regenerated anyway (repairs a half-written game)")
  assert.ok(gh.markdown().includes(`Updated ${new Date(T0 + 5000).toISOString()} · 1 player · 1 game`))
  assert.ok(sameAttempt(game, { ...game, name: "Someone Else" }) && !sameAttempt(game, { ...game, score: 901 }))

  // A different game by the same player a second later is a new row.
  const next = await (await post(handler, attempt({ playedAt: "2026-10-16T14:05:01.000Z" }))).json()
  assert.equal(next.attempts, 2)
  assert.equal(gh.attempts().length, 2)
})

test("store: a corrupt players.json is never overwritten", async () => {
  const gh = fakeGitHub()
  gh.files.set(PLAYERS_JSON, "{ not an array")
  const store = createPlayersStore({ client: createContentsClient({ token: TOKEN, repo: REPO, fetch: gh.fetch }), sleep: async () => {} })
  await assert.rejects(store.record(validateAttempt(attempt()).attempt), StoreUnavailableError)
  await assert.rejects(store.all(), /not valid JSON/)
  assert.equal(gh.commits.length, 0)
  gh.files.set(PLAYERS_JSON, '{"players": []}')
  await assert.rejects(store.record(validateAttempt(attempt()).attempt), /JSON array/)
  assert.equal(gh.commits.length, 0)
})

// ---------------------------------------------------------------------------------------------
// Edges: CORS, body limits, validation, methods, rate limit
// ---------------------------------------------------------------------------------------------

test("CORS: only the allow-listed origins get through; preflight is answered; curl without Origin works", async () => {
  const gh = fakeGitHub()
  const { handler } = makeHandler(gh)
  assert.deepEqual([...parseOrigins(" https://punkrockquantum.github.io/, punkrockquantum.github.io, http://127.0.0.1:8099 ,, ::bad")], ["https://punkrockquantum.github.io", "http://127.0.0.1:8099"])

  const allowed = await post(handler, attempt())
  assert.equal(allowed.status, 200)
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), ORIGIN)
  assert.equal(allowed.headers.get("Vary"), "Origin")
  assert.equal(allowed.headers.get("Cache-Control"), "no-store")
  assert.equal(allowed.headers.get("Content-Type"), "application/json; charset=utf-8")

  const evil = await post(handler, attempt({ playedAt: "2026-10-16T14:06:00.000Z" }), { origin: "https://evil.example" })
  assert.equal(evil.status, 403)
  assert.equal((await evil.json()).error, "cross_origin")
  assert.equal(evil.headers.get("Access-Control-Allow-Origin"), null)
  assert.equal(gh.attempts().length, 1, "a cross-origin attempt is not stored")
  assert.equal((await get(handler, "/api/league", { origin: "null" })).status, 403)

  const preflight = await get(handler, "/api/attempt", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN)
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS")
  assert.equal(preflight.headers.get("Access-Control-Allow-Headers"), "Content-Type")

  const curl = await get(handler, "/api/league", { origin: null })
  assert.equal(curl.status, 200)
  assert.equal(curl.headers.get("Access-Control-Allow-Origin"), null)

  const extra = await post(handler, attempt({ playedAt: "2026-10-16T14:07:00.000Z" }), { origin: "http://127.0.0.1:8099", environment: env({ ALLOWED_ORIGINS: `${ORIGIN}, http://127.0.0.1:8099` }) })
  assert.equal(extra.status, 200)
  assert.equal(extra.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:8099")
})

test("limits: 16 KB body cap, JSON only, consent must be true, methods and unknown routes", async () => {
  const gh = fakeGitHub()
  const { handler } = makeHandler(gh)

  const declared = await post(handler, attempt(), { headers: { "Content-Length": String(BODY_LIMIT + 1) } })
  assert.equal(declared.status, 413)
  const huge = await post(handler, attempt({ useCase: "x".repeat(BODY_LIMIT) }))
  assert.equal(huge.status, 413)
  const streamed = await handler.fetch(
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
    env(),
  )
  assert.equal(streamed.status, 413, "a chunked body is cut off at the cap too")
  assert.equal(BODY_LIMIT, 16 * 1024)

  assert.equal((await post(handler, null, { raw: JSON.stringify(attempt()), headers: { "Content-Type": "text/plain" } })).status, 415)
  const broken = await post(handler, null, { raw: "{not json" })
  assert.equal(broken.status, 400)
  assert.equal((await broken.json()).error, "bad_json")
  assert.equal((await post(handler, null, { raw: "   " })).status, 400)

  const noConsent = await post(handler, attempt({ consent: false }))
  assert.equal(noConsent.status, 400)
  const body = await noConsent.json()
  assert.equal(body.error, "invalid_attempt")
  assert.ok(body.details.includes("consent must be true"))
  assert.equal((await post(handler, attempt({ consent: "true" }))).status, 400)
  const invalid = await post(handler, attempt({ name: "<script>alert(1)</script>", email: "nope", score: -1 }))
  assert.equal(invalid.status, 400)
  const details = await invalid.json()
  assert.ok(details.details.length >= 3 && !JSON.stringify(details).includes("<script>"))
  assert.equal(gh.commits.length, 0, "rejected attempts never touch the repo")

  const wrongMethod = await get(handler, "/api/attempt")
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get("Allow"), "POST, OPTIONS")
  assert.equal((await get(handler, "/api/league", { method: "POST" })).status, 405)
  assert.equal((await get(handler, "/api/nothing")).status, 404)
  assert.equal((await get(handler, "/export.xlsx")).status, 404, "no export endpoint: the private repo is the sheet")
  const root = await get(handler, "/")
  assert.equal(root.status, 200)
  assert.match(await root.text(), /token-quest-intake/)
  assert.equal(typeof worker.fetch, "function", "the module's default export is what wrangler deploys")
})

test("rate limit: a token bucket per IP, 429 with Retry-After, refills with time, other IPs unaffected", async () => {
  const gh = fakeGitHub()
  const { handler, tick } = makeHandler(gh)
  const environment = env({ RATE_LIMIT_ATTEMPTS_PER_MINUTE: "3", RATE_LIMIT_READS_PER_MINUTE: "2" })
  for (let i = 0; i < 3; i += 1) assert.equal((await post(handler, attempt({ playedAt: `2026-10-16T14:0${i}:00.000Z` }), { environment })).status, 200)
  const limited = await post(handler, attempt({ playedAt: "2026-10-16T14:09:00.000Z" }), { environment })
  assert.equal(limited.status, 429)
  assert.deepEqual(await limited.json(), { ok: false, error: "rate_limited", message: "Too many requests from this network; try again in a moment." })
  assert.match(limited.headers.get("Retry-After"), /^\d+$/)
  assert.equal(gh.attempts().length, 3, "the throttled attempt is not stored (the client queues it)")
  assert.equal((await post(handler, attempt({ playedAt: "2026-10-16T14:09:00.000Z" }), { environment, ip: "198.51.100.9" })).status, 200, "another IP has its own bucket")
  tick(20_000)
  assert.equal((await post(handler, attempt({ playedAt: "2026-10-16T14:10:00.000Z" }), { environment })).status, 200, "one token back after 20 s at 3/min")
  assert.equal((await get(handler, "/api/league", { environment })).status, 200)
  assert.equal((await get(handler, "/api/health", { environment })).status, 200)
  assert.equal((await get(handler, "/api/league", { environment })).status, 429, "reads have their own bucket")

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
