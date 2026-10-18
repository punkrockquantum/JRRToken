/**
 * Token Quest on one URL: a Cloudflare Worker that serves the whole game (Workers Static Assets
 * from dist/, binding ASSETS) and, on the same origin, the small JSON API that keeps every score,
 * name and email address in a D1 database (SQLite, binding DB, d1store.mjs), whichever browser or
 * kiosk laptop the game was played on.
 *
 * Routing (wrangler.toml): `run_worker_first = true`, so EVERY request passes through this script:
 * the team-access gate first, then either the uploaded assets (env.ASSETS: index.html, js/, css/,
 * assets/, dist/404.html for unknown paths) or the /api routes and the /staff page. The script
 * re-applies the cache rules from deploy/static/_headers itself, because Workers skip _headers when
 * the script runs first.
 *
 * Team access (gate.mjs): when the ACCESS_PASSWORD secret is set, anything but /api/health needs a
 * valid `tq_session` cookie. Without one, GET/HEAD requests get the 8-bit login page (200) and /api
 * requests get 401 unauthorised. POST /login (same-origin form, per-IP limited, constant-time
 * compare, 1 s delay on a miss) sets the cookie (HttpOnly, Secure, SameSite=Lax, 14 days) and
 * redirects to /; GET /logout clears it. Without ACCESS_PASSWORD the game is open (local dev).
 *
 * Kiosk laptops (server/upstream.mjs in the game repo) have no cookie: they send the INTAKE_KEY
 * secret as `X-Intake-Key` (constant-time compare). The key opens the /api routes and /staff only,
 * never the game files; a header that does not match (or an unset INTAKE_KEY) is 401 bad_key, so a
 * laptop with a stale key sees the problem in its own health instead of queuing for ever. Key
 * callers get their own, larger rate bucket and a league that carries email/bestAt/latestAt so the
 * laptop can merge its local games per player (it strips the email again before its browser sees
 * anything).
 *
 * API (same contract as the kiosk server, see js/sync.js in the game repo):
 *   POST /api/attempt      JSON body -> { ok, attempts, best, latest, rank, players, newBest }
 *                          400 invalid_attempt · 401 unauthorised / bad_key · 413 too_large · 415 unsupported_media_type
 *                          429 rate_limited · 503 store_unavailable (D1 could not be written: the client queues
 *                          and retries) · 503 not_configured (no DB binding: same client behaviour)
 *   GET  /api/league       { ok, players: [{ rank, name, attempts, best, latest, bestUseCase, fteEquivalent,
 *                            firstPlayedAt, lastPlayedAt }], attempts }      (never includes emails for browsers;
 *                          with the key each row also has email, bestAt, latestAt)
 *   GET  /api/health       public: { ok, service, gate, configured }; with a session or the key also
 *                          { session, store: { kind: "d1", ok, attempts, players, lastOkAt, lastError, lastErrorAt },
 *                          mirror: { enabled, ... } }. Always 200: store.ok says whether the table can be
 *                          read right now; store.lastError keeps the newest failure in plain words.
 * Staff (session cookie or the key; names and emails included):
 *   GET  /api/export.csv   every game, UTF-8 BOM + CRLF so Excel opens it cleanly (csv.mjs)
 *   GET  /api/export.md    PLAYERS.md rendered on request from the rows (markdown.mjs)
 *   GET  /api/players.json every game as a JSON array (the shape players.json always had)
 *   GET  /staff            the 8-bit staff page: players, counts, download buttons (staff.mjs)
 *   There is deliberately no delete or reset route; clearing the table is a wrangler command
 *   (HOSTING.md, "Scores database (D1)").
 *
 * Every accepted attempt is in D1 before the 200 goes out, so "ok" means "it is on file". The
 * optional GitHub mirror of players.json + PLAYERS.md (store.mjs; MIRROR_MARKDOWN = "true" plus
 * PLAYERS_REPO and the GITHUB_TOKEN secret) runs afterwards in ctx.waitUntil and can never fail a
 * game; its state is in health under `mirror`.
 *
 * Origins: the game itself is same-origin, so it needs no CORS. Other browser origins (the GitHub
 * Pages copy, a local preview) are allowed only when listed in ALLOWED_ORIGINS, and only while the
 * gate is off: the session cookie is SameSite=Lax, so a cross-site page can never carry it.
 *
 * Environment (wrangler.toml [vars] + `wrangler secret put ...`; secrets never live in files):
 *   DB                                binding; the D1 database tokenquest-players ([[d1_databases]])
 *   ACCESS_PASSWORD                   secret; the team password (gate on when set)
 *   SESSION_SECRET                    secret; random 32+ bytes that sign the session cookie
 *   INTAKE_KEY                        secret; `openssl rand -hex 24`, the kiosk laptops' UPSTREAM_KEY
 *   MIRROR_MARKDOWN                   "true" turns the GitHub mirror on (default off)
 *   GITHUB_TOKEN                      secret; mirror only: fine-grained PAT, Contents read/write on PLAYERS_REPO
 *   PLAYERS_REPO / PLAYERS_BRANCH     mirror only: "owner/repo" of the private repo, branch (default "main")
 *   ALLOWED_ORIGINS                   comma-separated extra browser origins allowed to call the API
 *   RATE_LIMIT_ATTEMPTS_PER_MINUTE    per IP, default 20     RATE_LIMIT_READS_PER_MINUTE  per IP, default 60
 *   RATE_LIMIT_LOGINS_PER_MINUTE      per IP, default 10     RATE_LIMIT_KIOSK_PER_MINUTE  per IP, default 120 (key callers)
 *
 * Plain ESM on Web APIs only, so Node can import it for tests (tests/intake.test.js,
 * tests/gate.test.js) and `node --check` works on every file here. Nothing in this file logs names,
 * email addresses, passwords, keys or cookies.
 */
import { csvFilename, renderAttemptsCsv } from "./csv.mjs"
import { createD1Store } from "./d1store.mjs"
import { LOGIN_PAGE_HEADERS, SESSION_COOKIE, clearSessionCookie, constantTimeEqual, createSession, loginPage, parseCookies, sessionCookie, verifySession } from "./gate.mjs"
import { GitHubError, createContentsClient } from "./github.mjs"
import { renderPlayersMarkdown } from "./markdown.mjs"
import { aggregatePlayers, findPlayer, publicLeague } from "./players.mjs"
import { createRateLimiter } from "./ratelimit.mjs"
import { staffPage } from "./staff.mjs"
import { PLAYERS_MD, StoreUnavailableError, createPlayersStore } from "./store.mjs"
import { validateAttempt } from "./validate.mjs"

export const BODY_LIMIT = 16 * 1024
export const LOGIN_BODY_LIMIT = 4 * 1024
export const WRONG_PASSWORD_DELAY_MS = 1000
export const DEFAULT_ALLOWED_ORIGINS = "https://punkrockquantum.github.io"
export const DEFAULT_ATTEMPTS_PER_MINUTE = 20
export const DEFAULT_READS_PER_MINUTE = 60
export const DEFAULT_LOGINS_PER_MINUTE = 10
export const DEFAULT_KIOSK_PER_MINUTE = 120
export const INTAKE_KEY_HEADER = "X-Intake-Key"
export const SERVICE = "tokenquest"
export const STAFF_PATH = "/staff"
const NOT_CONFIGURED = 'not configured: bind the D1 database (wrangler.toml [[d1_databases]] binding = "DB")'

/**
 * One line staff can act on, from a store or mirror failure. D1 errors already arrive described
 * (d1store.mjs). For the GitHub mirror the status code says what is wrong: 404 is the usual one
 * (the fine-grained PAT was not given access to PLAYERS_REPO, or the repo or branch name is wrong),
 * 401 an expired or revoked token, 403 a token without Contents: write.
 */
export function describeStoreError(error) {
  const github = error instanceof GitHubError ? error : error?.cause instanceof GitHubError ? error.cause : null
  if (!github) return String(error?.message || "unknown error")
  const where = `${github.operation} ${github.status || "network"}`
  const hint =
    github.status === 404
      ? "token has no access to PLAYERS_REPO (give the fine-grained PAT that repository, or fix PLAYERS_REPO / PLAYERS_BRANCH)"
      : github.status === 401
        ? "GitHub rejected the token (expired or revoked): make a new PAT and run wrangler secret put GITHUB_TOKEN"
        : github.status === 403
          ? "token lacks Contents: Read and write, or GitHub is rate limiting it"
          : github.status === 0
            ? "GitHub could not be reached"
            : github.status === 409 || github.status === 422
              ? "the file kept changing underneath the Worker"
              : `GitHub answered HTTP ${github.status}`
  return `${where}: ${hint}`
}

/** The league for kiosks (X-Intake-Key): the public fields plus what merging by player needs. */
export function kioskLeague(players) {
  return publicLeague(players).map((row, index) => ({ ...row, email: players[index].email, bestAt: players[index].bestAt, latestAt: players[index].latestAt }))
}

/** Cache rules for the game files, the same as deploy/static/_headers (which Workers skip when the script runs first). */
const ASSET_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }
const FONT_CACHE = "public, max-age=31536000, immutable"
const PAGE_CACHE = "no-store"

class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message)
    this.status = status
    this.code = code
    this.headers = headers
  }
}

/** "https://a.example, b.example/" -> Set { "https://a.example", "https://b.example" } */
export function parseOrigins(value) {
  const origins = new Set()
  for (const entry of String(value ?? "").split(",")) {
    const text = entry.trim()
    if (!text) continue
    try {
      origins.add(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).origin.toLowerCase())
    } catch {
      /* ignore an unparsable entry rather than fail every request */
    }
  }
  return origins
}

function normaliseOrigin(origin) {
  try {
    return new URL(origin).origin.toLowerCase()
  } catch {
    return null
  }
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}

function json(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  })
}

function positiveInt(value, fallback) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function redirect(location, headers = {}) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", ...headers } })
}

function html(status, body, headers = {}) {
  return new Response(body, { status, headers: { ...LOGIN_PAGE_HEADERS, ...headers } })
}

/**
 * The team password and the cookie-signing secret. The gate is on exactly when ACCESS_PASSWORD is a
 * non-empty secret. Without SESSION_SECRET the signing key is derived from the password (so forgetting
 * the second secret never opens the game); health reports which one is in use.
 */
export function gateConfig(env) {
  const password = typeof env.ACCESS_PASSWORD === "string" ? env.ACCESS_PASSWORD.replace(/\r?\n$/, "") : ""
  const explicit = typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET.trim() : ""
  return {
    enabled: password.length > 0,
    password,
    secret: explicit || `tokenquest-derived-session-key:${password}`,
    session: explicit ? "secret" : "derived",
  }
}

/** Re-serves an asset response with the cache and hardening headers the game expects. */
function withAssetHeaders(response, pathname) {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(ASSET_HEADERS)) headers.set(name, value)
  headers.set("Cache-Control", /\.(woff2?|ttf|otf)$/i.test(pathname) ? FONT_CACHE : PAGE_CACHE)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/** Reads at most `limit` bytes; anything longer is refused before it is buffered. */
async function readBody(request, limit) {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "too_large", `Body must be at most ${limit} bytes.`)
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      throw new HttpError(413, "too_large", `Body must be at most ${limit} bytes.`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function readJson(request) {
  const type = String(request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
  if (type !== "application/json") throw new HttpError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.")
  const text = new TextDecoder().decode(await readBody(request, BODY_LIMIT))
  if (!text.trim()) throw new HttpError(400, "empty_body", "Request body is empty.")
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, "bad_json", "Request body is not valid JSON.")
  }
}

/**
 * Builds the fetch handler. Everything with side effects is injectable so tests run without
 * Cloudflare or GitHub: { fetch, now, random, sleep, log }.
 */
export function createHandler(deps = {}) {
  const { fetch: fetchImpl = (...args) => globalThis.fetch(...args), now = () => new Date(), random = Math.random, sleep, log = (line) => console.log(line) } = deps
  const mirrors = new Map()
  let limiters = null
  /**
   * The last thing the database (and the mirror) did in this isolate, so /api/health can show staff
   * why games are queuing. lastError is kept until a WRITE succeeds; lastOkAt is the last successful
   * write.
   */
  let storeStatus = { lastError: null, lastErrorAt: null, lastOkAt: null }
  let mirrorStatus = { lastError: null, lastErrorAt: null, lastOkAt: null }

  function storeFailed(error) {
    storeStatus = { ...storeStatus, lastError: describeStoreError(error), lastErrorAt: now().toISOString() }
  }

  function storeWrote() {
    storeStatus = { lastError: null, lastErrorAt: null, lastOkAt: now().toISOString() }
  }

  function hasDb(env) {
    return typeof env?.DB?.prepare === "function" && typeof env.DB.batch === "function"
  }

  /** The scores database. Without the binding every write and read is 503 not_configured (the clients queue). */
  function storeFor(env) {
    if (!hasDb(env)) throw new HttpError(503, "not_configured", "The scores database is not bound yet (wrangler.toml [[d1_databases]] binding = \"DB\").", { "Retry-After": "60" })
    return createD1Store({ db: env.DB })
  }

  /** The optional GitHub mirror: on only when MIRROR_MARKDOWN is "true" and the repo + token are there. */
  function mirrorConfig(env) {
    const repo = String(env.PLAYERS_REPO || "").trim()
    const branch = String(env.PLAYERS_BRANCH || "").trim() || "main"
    const token = typeof env.GITHUB_TOKEN === "string" ? env.GITHUB_TOKEN.trim() : ""
    const wanted = String(env.MIRROR_MARKDOWN ?? "").trim().toLowerCase() === "true"
    return { enabled: wanted && Boolean(repo && token), wanted, repo, branch, token }
  }

  function mirrorFor(env) {
    const { enabled, repo, branch, token } = mirrorConfig(env)
    if (!enabled) return null
    const key = `${repo}@${branch}\n${token}` // in memory only: a rotated token must not reuse the old client
    let mirror = mirrors.get(key)
    if (!mirror) {
      let client
      try {
        client = createContentsClient({ token, repo, branch, fetch: fetchImpl })
      } catch {
        return null // PLAYERS_REPO is not owner/repo: the mirror stays off, health says so
      }
      mirror = createPlayersStore({ client, now, random, sleep, log })
      mirrors.set(key, mirror)
    }
    return mirror
  }

  /** After a game: rewrite the mirror from the rows, off the request's critical path, never failing it. */
  function publishMirror(env, attempts, ctx) {
    const mirror = mirrorFor(env)
    if (!mirror) return
    const work = mirror
      .publish(attempts)
      .then(() => {
        mirrorStatus = { lastError: null, lastErrorAt: null, lastOkAt: now().toISOString() }
      })
      .catch((error) => {
        mirrorStatus = { ...mirrorStatus, lastError: describeStoreError(error), lastErrorAt: now().toISOString() }
        log(`mirror failed: ${mirrorStatus.lastError}`)
      })
    if (typeof ctx?.waitUntil === "function") ctx.waitUntil(work)
  }

  function mirrorHealth(env) {
    const { enabled, wanted, repo, branch } = mirrorConfig(env)
    if (!enabled) return wanted ? { enabled: false, lastError: "MIRROR_MARKDOWN is true but PLAYERS_REPO or the GITHUB_TOKEN secret is missing" } : { enabled: false }
    return { enabled: true, kind: "github", repo, branch, sheet: PLAYERS_MD, ok: mirrorStatus.lastError === null, ...mirrorStatus }
  }

  /** Every row, for the staff downloads. */
  async function allAttempts(env) {
    return storeFor(env).all()
  }

  function download(body, type, filename, headers = {}) {
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
        ...headers,
      },
    })
  }

  function rateLimit(env, kind, request) {
    if (!limiters) {
      const clock = () => now().getTime()
      limiters = {
        attempt: createRateLimiter({ perMinute: positiveInt(env.RATE_LIMIT_ATTEMPTS_PER_MINUTE, DEFAULT_ATTEMPTS_PER_MINUTE), now: clock }),
        read: createRateLimiter({ perMinute: positiveInt(env.RATE_LIMIT_READS_PER_MINUTE, DEFAULT_READS_PER_MINUTE), now: clock }),
        login: createRateLimiter({ perMinute: positiveInt(env.RATE_LIMIT_LOGINS_PER_MINUTE, DEFAULT_LOGINS_PER_MINUTE), now: clock }),
        kiosk: createRateLimiter({ perMinute: positiveInt(env.RATE_LIMIT_KIOSK_PER_MINUTE, DEFAULT_KIOSK_PER_MINUTE), now: clock }),
      }
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown"
    const verdict = limiters[kind].take(ip)
    if (!verdict.ok) throw new HttpError(429, "rate_limited", "Too many requests from this network; try again in a moment.", { "Retry-After": String(verdict.retryAfter) })
  }

  /**
   * Kiosk laptops authenticate with the INTAKE_KEY secret instead of a cookie. A header that is
   * present but wrong (or set while the Worker has no INTAKE_KEY) is refused outright, so a
   * misconfigured laptop sees 401 in its own health instead of silently filling its queue.
   */
  async function keyAuthorised(request, env) {
    const given = request.headers.get(INTAKE_KEY_HEADER)
    if (given === null) return false
    const configured = typeof env.INTAKE_KEY === "string" ? env.INTAKE_KEY.trim() : ""
    if (!configured || !(await constantTimeEqual(given.trim(), configured))) {
      throw new HttpError(401, "bad_key", `The ${INTAKE_KEY_HEADER} header does not match the Worker's INTAKE_KEY secret.`)
    }
    return true
  }

  async function hasSession(request, gate) {
    if (!gate.enabled) return true
    const cookie = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE)
    return cookie ? verifySession(cookie, gate.secret, now().getTime()) : false
  }

  /** POST /login: same-origin form post, per-IP limited, constant-time compare, 1 s delay on a miss. */
  async function login(request, env, url, gate) {
    const origin = normaliseOrigin(request.headers.get("Origin"))
    if (origin !== null && origin !== url.origin.toLowerCase()) throw new HttpError(403, "cross_origin", "Log in from the game's own page.")
    try {
      rateLimit(env, "login", request)
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) return html(429, loginPage({ error: "Too many tries. Wait a minute and try again." }), error.headers)
      throw error
    }
    const type = String(request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
    if (type !== "application/x-www-form-urlencoded") throw new HttpError(415, "unsupported_media_type", "Submit the login form.")
    const form = new URLSearchParams(new TextDecoder().decode(await readBody(request, LOGIN_BODY_LIMIT)))
    const given = form.get("password") ?? ""
    if (given && (await constantTimeEqual(given, gate.password))) {
      const value = await createSession(gate.secret, { now: now().getTime() })
      return redirect("/", { "Set-Cookie": sessionCookie(value) })
    }
    if (sleep) await sleep(WRONG_PASSWORD_DELAY_MS)
    else await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS))
    return html(401, loginPage({ error: "Wrong password" }))
  }

  /**
   * The gate, before anything else. Resolves a Response to send instead, or null when the request may
   * go on to the assets or the API. /api/health stays public (it carries no personal data).
   */
  async function gateCheck(request, env, url, gate) {
    const method = request.method.toUpperCase()
    const { pathname } = url
    if (pathname === "/logout") return redirect("/", { "Set-Cookie": clearSessionCookie() })
    if (pathname === "/login") {
      if (!gate.enabled) return redirect("/")
      if (method === "POST") return login(request, env, url, gate)
      if (method === "GET" || method === "HEAD") return (await hasSession(request, gate)) ? redirect("/") : html(200, loginPage())
      throw new HttpError(405, "method_not_allowed", "Use GET or POST here.", { Allow: "GET, POST" })
    }
    if (!gate.enabled || pathname === "/api/health" || (await hasSession(request, gate))) return null
    if (pathname.startsWith("/api/")) throw new HttpError(401, "unauthorised", "Log in to Token Quest first, then play again.")
    if (method === "GET" || method === "HEAD") return html(200, loginPage())
    throw new HttpError(401, "unauthorised", "Log in to Token Quest first.")
  }

  async function route(request, env, url, cors, access, ctx) {
    const method = request.method.toUpperCase()
    const { pathname } = url

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, Allow: "GET, POST, OPTIONS" } })

    if (pathname === "/api/attempt") {
      if (method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST here.", { Allow: "POST, OPTIONS" })
      rateLimit(env, access.key ? "kiosk" : "attempt", request)
      const body = await readJson(request)
      const checked = validateAttempt(body, now())
      if (!checked.ok) return json(400, { ok: false, error: "invalid_attempt", message: "The attempt was rejected.", details: checked.errors }, cors)
      const store = storeFor(env)
      // "web" = a browser on the team URL, "kiosk" = a laptop's write-through (the key): which device sent it.
      const { attempts, replayed } = await store.record(checked.attempt, { source: access.key ? "kiosk" : "web" })
      storeWrote()
      if (!replayed) publishMirror(env, attempts, ctx)
      const players = aggregatePlayers(attempts)
      const player = findPlayer(players, checked.attempt.email)
      return json(
        200,
        {
          ok: true,
          attempts: player.attempts,
          best: player.best,
          latest: player.latest,
          rank: player.rank,
          players: players.length,
          newBest: player.best === checked.attempt.score && player.bestAt === checked.attempt.playedAt,
        },
        cors,
      )
    }

    if (pathname === "/api/league") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET here.", { Allow: "GET, OPTIONS" })
      rateLimit(env, access.key ? "kiosk" : "read", request)
      const attempts = await storeFor(env).all()
      const players = aggregatePlayers(attempts)
      // Kiosks merge by player, so with the key the rows carry the email; browsers never see it.
      return json(200, { ok: true, players: access.key ? kioskLeague(players) : publicLeague(players), attempts: attempts.length }, cors)
    }

    if (pathname === "/api/health") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET here.", { Allow: "GET, OPTIONS" })
      rateLimit(env, access.key ? "kiosk" : "read", request)
      const configured = hasDb(env)
      const summary = { ok: true, service: SERVICE, gate: access.gate, configured }
      // Public (no session): just the flags, nothing about how full the database is.
      if (access.gate && !access.authorised) return json(200, summary, cors)
      const base = { ...summary, session: access.gate ? access.session : null }
      if (!configured) {
        return json(200, { ...base, store: { kind: "d1", ok: false, attempts: null, players: null, lastOkAt: null, lastError: NOT_CONFIGURED, lastErrorAt: null }, mirror: mirrorHealth(env), message: "The scores database is not bound yet: add the [[d1_databases]] binding DB to wrangler.toml and redeploy." }, cors)
      }
      // Health answers 200 whatever the database is doing and says in `store` what is wrong (ok = the
      // table can be read right now; lastError = the newest failure, kept until a game is written),
      // so staff and the kiosks' own health can show it. Games are still refused with 503 meanwhile.
      try {
        const totals = await storeFor(env).totals()
        return json(200, { ...base, store: { kind: "d1", ok: true, attempts: totals.attempts, players: totals.players, lastPlayedAt: totals.lastPlayedAt, ...storeStatus }, mirror: mirrorHealth(env) }, cors)
      } catch (error) {
        if (!(error instanceof StoreUnavailableError)) throw error
        storeFailed(error)
        log(`store unavailable: ${storeStatus.lastError}`)
        return json(200, { ...base, store: { kind: "d1", ok: false, attempts: null, players: null, lastPlayedAt: null, ...storeStatus }, mirror: mirrorHealth(env) }, cors)
      }
    }

    // Staff downloads (a session or the key; the gate has already refused anonymous /api callers).
    if (pathname === "/api/export.csv" || pathname === "/api/export.md" || pathname === "/api/players.json") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET here.", { Allow: "GET, OPTIONS" })
      rateLimit(env, access.key ? "kiosk" : "read", request)
      const attempts = await allAttempts(env)
      if (pathname === "/api/export.csv") return download(renderAttemptsCsv(attempts), "text/csv; charset=utf-8", csvFilename(now()), cors)
      if (pathname === "/api/export.md") return download(renderPlayersMarkdown(attempts, { now: now() }), "text/markdown; charset=utf-8", PLAYERS_MD, cors)
      return json(200, attempts, { ...cors, "X-Robots-Tag": "noindex, nofollow" })
    }

    if (pathname === STAFF_PATH) {
      if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method_not_allowed", "Use GET here.", { Allow: "GET, HEAD" })
      rateLimit(env, access.key ? "kiosk" : "read", request)
      const attempts = await allAttempts(env)
      return html(200, staffPage({ players: aggregatePlayers(attempts), attempts: attempts.length, now: now(), gate: access.gate }))
    }

    if (pathname === "/api/export.xlsx" || pathname === "/api/reset") {
      throw new HttpError(404, "not_found", pathname === "/api/reset" ? "There is no reset here: clear the table with wrangler d1 execute (HOSTING.md, \"Scores database (D1)\")." : "There is no Excel export here: GET /api/export.csv opens in Excel (or open /staff).")
    }
    if (pathname.startsWith("/api/")) throw new HttpError(404, "not_found", "No such API route.")
    if (pathname === "/" && method === "GET") {
      return new Response(`${SERVICE}: POST /api/attempt, GET /api/league, GET /api/health; staff: GET /staff, /api/export.csv, /api/export.md, /api/players.json\n`, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      })
    }
    throw new HttpError(404, "not_found", "Nothing here but the API.")
  }

  /** The routes this script answers itself; everything else outside them is a game file. */
  function isScriptPath(pathname) {
    return pathname.startsWith("/api/") || pathname === STAFF_PATH
  }

  /** True when the request is for the game files rather than the API or the staff page, and an assets binding exists. */
  function isAssetRequest(url, env) {
    return !isScriptPath(url.pathname) && typeof env?.ASSETS?.fetch === "function"
  }

  return {
    async fetch(request, env = {}, ctx) {
      const started = Date.now()
      const url = new URL(request.url)
      const gate = gateConfig(env)
      const origin = request.headers.get("Origin")
      const requestOrigin = normaliseOrigin(origin)
      const sameOrigin = requestOrigin !== null && requestOrigin === url.origin.toLowerCase()
      const allowed = parseOrigins(env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS)
      const crossOriginOk = origin !== null && !sameOrigin && allowed.has(requestOrigin)
      const cors = crossOriginOk ? corsHeaders(origin) : {}
      let response
      try {
        // A kiosk's key opens the API and the staff page (never the game files); a wrong key is a 401 before anything else.
        const key = isScriptPath(url.pathname) && (await keyAuthorised(request, env))
        const gated = key ? null : await gateCheck(request, env, url, gate)
        if (gated) {
          response = gated
        } else if (isAssetRequest(url, env)) {
          // The game itself: static assets (index.html, js/, css/, assets/, 404.html) served as uploaded.
          return withAssetHeaders(await env.ASSETS.fetch(request), url.pathname)
        } else {
          if (origin !== null && !sameOrigin && !crossOriginOk) throw new HttpError(403, "cross_origin", "This origin may not use the Token Quest API.")
          const authorised = key || !gate.enabled || (await hasSession(request, gate))
          response = await route(request, env, url, cors, { gate: gate.enabled, authorised, key, session: gate.session }, ctx)
        }
      } catch (error) {
        if (error instanceof HttpError) {
          response = json(error.status, { ok: false, error: error.code, message: error.message }, { ...cors, ...error.headers })
        } else if (error instanceof StoreUnavailableError) {
          storeFailed(error)
          log(`store unavailable: ${storeStatus.lastError}`)
          response = json(503, { ok: false, error: "store_unavailable", message: "The scores database could not be reached. Please try again shortly." }, { ...cors, "Retry-After": "5" })
        } else {
          log(`error: ${request.method} ${url.pathname} -> ${error?.name || "Error"}: ${error?.message || "unknown"}`)
          response = json(500, { ok: false, error: "internal", message: "Something went wrong on the server." }, cors)
        }
      }
      log(`${request.method} ${url.pathname} ${response.status} ${Date.now() - started}ms`)
      return response
    },
  }
}

export default createHandler()
