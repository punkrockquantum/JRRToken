/**
 * Token Quest intake: a Cloudflare Worker that receives finished games from the public static demo
 * and keeps the player sheet in a separate PRIVATE GitHub repo (players.json + PLAYERS.md).
 *
 * Routes (same contract as the kiosk server, see js/sync.js in the game repo):
 *   POST /api/attempt   JSON body -> { ok, attempts, best, latest, rank, players, newBest }
 *                       400 invalid_attempt · 413 too_large · 415 unsupported_media_type · 429 rate_limited
 *                       503 store_unavailable (the sheet could not be written: the client queues and retries)
 *   GET  /api/league    { ok, players: [{ rank, name, attempts, best, latest, bestUseCase, fteEquivalent,
 *                         firstPlayedAt, lastPlayedAt }], attempts }      (never includes emails)
 *   GET  /api/health    { ok, service, repo, branch, attempts, players }  (503 when GitHub is unreachable)
 *
 * Every accepted attempt is committed to players.json AND PLAYERS.md before the 200 goes out:
 * nothing is deferred to ctx.waitUntil, so "ok" means "it is on the sheet".
 *
 * Environment (wrangler.toml [vars] + `wrangler secret put GITHUB_TOKEN`):
 *   GITHUB_TOKEN                      secret; fine-grained PAT, Contents read/write on PLAYERS_REPO only
 *   PLAYERS_REPO                      "owner/repo" of the private players repo
 *   PLAYERS_BRANCH                    default "main"
 *   ALLOWED_ORIGINS                   comma-separated browser origins allowed to call the API
 *   RATE_LIMIT_ATTEMPTS_PER_MINUTE    per IP, default 20     RATE_LIMIT_READS_PER_MINUTE  per IP, default 60
 *
 * Plain ESM on Web APIs only, so Node can import it for tests (tests/intake.test.js) and
 * `node --check` works on every file here. Nothing in this file logs names or email addresses.
 */
import { createContentsClient } from "./github.mjs"
import { aggregatePlayers, findPlayer, publicLeague } from "./players.mjs"
import { createRateLimiter } from "./ratelimit.mjs"
import { PLAYERS_MD, StoreUnavailableError, createPlayersStore } from "./store.mjs"
import { validateAttempt } from "./validate.mjs"

export const BODY_LIMIT = 16 * 1024
export const DEFAULT_ALLOWED_ORIGINS = "https://punkrockquantum.github.io"
export const DEFAULT_ATTEMPTS_PER_MINUTE = 20
export const DEFAULT_READS_PER_MINUTE = 60
const SERVICE = "token-quest-intake"

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
  const stores = new Map()
  let limiters = null

  function storeFor(env) {
    const repo = String(env.PLAYERS_REPO || "").trim()
    const branch = String(env.PLAYERS_BRANCH || "").trim() || "main"
    const token = typeof env.GITHUB_TOKEN === "string" ? env.GITHUB_TOKEN.trim() : ""
    if (!repo || !token) throw new HttpError(503, "not_configured", "The intake service is missing PLAYERS_REPO or GITHUB_TOKEN.", { "Retry-After": "60" })
    const key = `${repo}@${branch}`
    let store = stores.get(key)
    if (!store) {
      let client
      try {
        client = createContentsClient({ token, repo, branch, fetch: fetchImpl })
      } catch {
        throw new HttpError(503, "not_configured", "PLAYERS_REPO must look like owner/repo.", { "Retry-After": "60" })
      }
      store = createPlayersStore({ client, now, random, sleep, log })
      stores.set(key, store)
    }
    return store
  }

  function rateLimit(env, kind, request) {
    if (!limiters) {
      const clock = () => now().getTime()
      limiters = {
        attempt: createRateLimiter({ perMinute: positiveInt(env.RATE_LIMIT_ATTEMPTS_PER_MINUTE, DEFAULT_ATTEMPTS_PER_MINUTE), now: clock }),
        read: createRateLimiter({ perMinute: positiveInt(env.RATE_LIMIT_READS_PER_MINUTE, DEFAULT_READS_PER_MINUTE), now: clock }),
      }
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown"
    const verdict = limiters[kind].take(ip)
    if (!verdict.ok) throw new HttpError(429, "rate_limited", "Too many requests from this network; try again in a moment.", { "Retry-After": String(verdict.retryAfter) })
  }

  async function route(request, env, url, cors) {
    const method = request.method.toUpperCase()
    const { pathname } = url

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, Allow: "GET, POST, OPTIONS" } })

    if (pathname === "/api/attempt") {
      if (method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST here.", { Allow: "POST, OPTIONS" })
      rateLimit(env, "attempt", request)
      const body = await readJson(request)
      const checked = validateAttempt(body, now())
      if (!checked.ok) return json(400, { ok: false, error: "invalid_attempt", message: "The attempt was rejected.", details: checked.errors }, cors)
      const store = storeFor(env)
      const { attempts } = await store.record(checked.attempt)
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
      rateLimit(env, "read", request)
      const attempts = await storeFor(env).all()
      return json(200, { ok: true, players: publicLeague(aggregatePlayers(attempts)), attempts: attempts.length }, cors)
    }

    if (pathname === "/api/health") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET here.", { Allow: "GET, OPTIONS" })
      rateLimit(env, "read", request)
      const store = storeFor(env)
      await store.ping()
      const attempts = await store.all()
      return json(
        200,
        {
          ok: true,
          service: SERVICE,
          repo: String(env.PLAYERS_REPO).trim(),
          branch: String(env.PLAYERS_BRANCH || "").trim() || "main",
          sheet: PLAYERS_MD,
          attempts: attempts.length,
          players: aggregatePlayers(attempts).length,
        },
        cors,
      )
    }

    if (pathname.startsWith("/api/")) throw new HttpError(404, "not_found", "No such API route.")
    if (pathname === "/" && method === "GET") {
      return new Response(`${SERVICE}: POST /api/attempt, GET /api/league, GET /api/health\n`, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      })
    }
    throw new HttpError(404, "not_found", "Nothing here but the API.")
  }

  return {
    async fetch(request, env = {}, _ctx) {
      const started = Date.now()
      const url = new URL(request.url)
      const origin = request.headers.get("Origin")
      const allowed = parseOrigins(env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS)
      const originOk = origin !== null && allowed.has(normaliseOrigin(origin))
      const cors = originOk ? corsHeaders(origin) : {}
      let response
      try {
        if (origin !== null && !originOk) throw new HttpError(403, "cross_origin", "This origin may not use the intake service.")
        response = await route(request, env, url, cors)
      } catch (error) {
        if (error instanceof HttpError) {
          response = json(error.status, { ok: false, error: error.code, message: error.message }, { ...cors, ...error.headers })
        } else if (error instanceof StoreUnavailableError) {
          log(`store unavailable: ${error.message}`)
          response = json(503, { ok: false, error: "store_unavailable", message: "The player sheet could not be updated. Please try again shortly." }, { ...cors, "Retry-After": "5" })
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
