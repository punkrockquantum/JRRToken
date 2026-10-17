/**
 * Write-through to the team server (UPSTREAM_URL, the tokenquest Worker), so that scores from
 * every kiosk laptop end up in one place and no game is lost whichever laptop it was played on.
 *
 * Every accepted attempt is appended to the local store first (Excel keeps working offline) and
 * then forwarded to `${UPSTREAM_URL}/api/attempt` with the X-Intake-Key header. The forward is
 * journaled in DATA_DIR/upstream-queue.jsonl BEFORE it is tried, as an append-only log of
 *   { "queued": <attempt>, "at": ... }     the game still has to reach the team server
 *   { "sent": "<key>", "at": ... }         the team server confirmed it
 *   { "rejected": "<key>", "status", "error", "at" }   the team server refused it for good (400)
 * so a crash, a closed laptop or a day of bad venue Wi-Fi never loses a forward: whatever is
 * queued and not sent is retried in order, every 30 s (doubling to 2 min while it keeps failing),
 * on the next game, and on start-up. On start-up, local games that were never journaled (recorded
 * before UPSTREAM_URL was set) are queued too. Retries are idempotent: the Worker treats the same
 * email + playedAt + score as the same game.
 *
 * The league the kiosk shows merges the local attempts with the team server's league (fetched with
 * the key, cached for 10 s; a copy up to 2 min old stands in while the server is unreachable, then
 * the board falls back to local only). See merge.mjs for the maths.
 *
 * Log lines carry counts, HTTP statuses and error codes: never names, emails or the key.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { attemptKey } from "./store.mjs"

export const QUEUE_FILE = "upstream-queue.jsonl"
export const RETRY_MS = 30_000
export const MAX_RETRY_MS = 120_000
export const LEAGUE_CACHE_MS = 10_000
export const LEAGUE_STALE_MS = 120_000
export const POST_TIMEOUT_MS = 8_000
export const GET_TIMEOUT_MS = 2_000
export const USER_AGENT = "token-quest-kiosk"

/** What the Worker validates. Local bookkeeping (id, receivedAt) stays on the laptop. */
export function forwardPayload(record) {
  const { playedAt, name, email, score, useCase, costPerMTok, profitPerHour, fteEquivalent, annualSavings, humanHoursPerYear, scenario, consent, consentAt } = record
  return { playedAt, name, email, score, useCase, costPerMTok, profitPerHour, fteEquivalent, annualSavings, humanHoursPerYear, scenario, consent, consentAt }
}

/** Replays the journal. Returns { pending: Map<key, attempt>, sent: Set<key>, rejected: Map<key, info>, skipped }. */
export function parseQueueLog(text) {
  const pending = new Map()
  const sent = new Set()
  const rejected = new Map()
  let skipped = 0
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      skipped += 1
      continue
    }
    if (!entry || typeof entry !== "object") {
      skipped += 1
    } else if (entry.queued && typeof entry.queued === "object") {
      const key = attemptKey(entry.queued)
      if (!sent.has(key) && !rejected.has(key)) pending.set(key, entry.queued)
    } else if (typeof entry.sent === "string") {
      sent.add(entry.sent)
      pending.delete(entry.sent)
    } else if (typeof entry.rejected === "string") {
      rejected.set(entry.rejected, { status: entry.status ?? null, error: entry.error ?? null, at: entry.at ?? null })
      pending.delete(entry.rejected)
    } else skipped += 1
  }
  return { pending, sent, rejected, skipped }
}

/** Stands in when UPSTREAM_URL is not set: everything stays local. */
export function disabledUpstream() {
  return {
    configured: false,
    enqueue: async () => null,
    waitFor: async () => null,
    backfill: async () => 0,
    league: async () => null,
    pendingKeys: () => new Set(),
    status: () => ({ configured: false }),
    flush: async () => ({ sent: 0, pending: 0 }),
    close() {},
  }
}

function describeFailure(status, data) {
  if (status === 0) return "team server unreachable"
  const code = data?.error ? ` ${data.error}` : ""
  if (status === 401 || status === 403) return `HTTP ${status}${code}: the team server refused the key (check UPSTREAM_KEY against the Worker's INTAKE_KEY secret)`
  if (status === 404 || status === 405) return `HTTP ${status}${code}: UPSTREAM_URL does not look like the Token Quest Worker`
  if (status === 429) return `HTTP 429${code}: the team server is rate limiting this network`
  return `HTTP ${status}${code}`
}

/**
 * @param {object} options
 * @param {string} options.url            UPSTREAM_URL (no trailing slash)
 * @param {string|null} options.key       UPSTREAM_KEY, sent as X-Intake-Key
 * @param {string} options.dataDir        where upstream-queue.jsonl lives
 * @param {Function} [options.fetch]      injectable for tests
 * @param {() => Date} [options.now]
 * @param {(line: string) => void} [options.log]
 * @param {number} [options.retryMs]      first retry delay (default 30 s)
 * @param {number} [options.maxRetryMs]   backoff ceiling (default 2 min)
 * @param {number} [options.cacheMs]      how long a fetched league is reused (default 10 s)
 * @param {number} [options.staleMs]      how long a stale league stands in while offline (default 2 min)
 */
export function createUpstream({
  url,
  key = null,
  dataDir,
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => new Date(),
  log = () => {},
  retryMs = RETRY_MS,
  maxRetryMs = MAX_RETRY_MS,
  cacheMs = LEAGUE_CACHE_MS,
  staleMs = LEAGUE_STALE_MS,
  postTimeoutMs = POST_TIMEOUT_MS,
  getTimeoutMs = GET_TIMEOUT_MS,
}) {
  if (!url) throw new Error("createUpstream needs a url")
  const file = path.join(dataDir, QUEUE_FILE)
  /** key -> { attempt, tries, settled: Promise, resolve } in arrival order */
  const pending = new Map()
  const sent = new Set()
  const rejected = new Map()
  let journal = Promise.resolve()
  let flushing = null
  let roundEnd = null
  let timer = null
  let failures = 0
  let lastSyncAt = null
  let lastError = null
  let lastErrorAt = null
  let nextRetryAt = null
  let closed = false
  let cache = null // { players, attempts, fetchedAt }
  let fetchingLeague = null

  const stamp = () => now().toISOString()

  /** Journal writes run one at a time and never throw: a full disk costs durability across a restart, not the game. */
  function appendLine(entry) {
    const line = `${JSON.stringify(entry)}\n`
    const run = journal
      .then(async () => {
        await mkdir(dataDir, { recursive: true })
        await appendFile(file, line, "utf8")
      })
      .catch((error) => {
        log(`upstream: could not write ${file}: ${error.message}`)
      })
    journal = run
    return run
  }

  function headers(extra = {}) {
    const base = { "User-Agent": USER_AGENT, ...extra }
    if (key) base["X-Intake-Key"] = key
    return base
  }

  async function call(route, init, timeoutMs) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${url}${route}`, { ...init, signal: controller.signal })
      const data = await response.json().catch(() => null)
      return { status: response.status, ok: response.ok, data }
    } catch {
      return { status: 0, ok: false, data: null }
    } finally {
      clearTimeout(timeout)
    }
  }

  function makeEntry(attempt) {
    let resolve
    const settled = new Promise((done) => {
      resolve = done
    })
    return { attempt, tries: 0, settled, resolve }
  }

  function schedule() {
    if (closed || timer || !pending.size) return
    const delay = failures > 1 ? Math.min(retryMs * 2 ** (failures - 1), maxRetryMs) : retryMs
    nextRetryAt = new Date(now().getTime() + delay).toISOString()
    timer = setTimeout(() => {
      timer = null
      nextRetryAt = null
      flush().catch(() => {})
    }, delay)
    timer.unref?.()
  }

  /** Sends what is pending, in order, until the queue is empty or the server stops cooperating. */
  function flush() {
    if (flushing) return flushing
    let endRound
    roundEnd = new Promise((done) => {
      endRound = done
    })
    flushing = (async () => {
      let sentNow = 0
      while (pending.size && !closed) {
        const [queueKey, entry] = pending.entries().next().value
        entry.tries += 1
        const result = await call("/api/attempt", { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(forwardPayload(entry.attempt)) }, postTimeoutMs)
        if (result.ok && result.data?.ok === true) {
          pending.delete(queueKey)
          sent.add(queueKey)
          await appendLine({ sent: queueKey, at: stamp() })
          sentNow += 1
          failures = 0
          lastError = null
          lastSyncAt = stamp()
          cache = null // the next league read must include this game
          entry.resolve({ ok: true, data: result.data })
          continue
        }
        if (result.status === 400 || result.status === 413 || result.status === 415) {
          // The team server will never take this one (it validates with the same rules, so this
          // means a version mismatch). It stays on the laptop and in the Excel file; health counts it.
          pending.delete(queueKey)
          const info = { status: result.status, error: result.data?.error ?? null, at: stamp() }
          rejected.set(queueKey, info)
          await appendLine({ rejected: queueKey, status: info.status, error: info.error, at: info.at })
          log(`upstream: a game was rejected by the team server (HTTP ${info.status}${info.error ? ` ${info.error}` : ""}); it is kept locally`)
          entry.resolve({ ok: false, rejected: true, status: result.status, data: result.data })
          continue
        }
        // Unreachable, 5xx, 429, store_unavailable, a wrong key: keep the order, try again later.
        failures += 1
        lastError = describeFailure(result.status, result.data)
        lastErrorAt = stamp()
        log(`upstream: ${lastError}; ${pending.size} game(s) queued, retrying${failures > 1 ? ` (failure ${failures})` : ""}`)
        break
      }
      return { sent: sentNow, pending: pending.size }
    })().finally(() => {
      flushing = null
      endRound()
      schedule()
    })
    return flushing
  }

  return {
    configured: true,
    url,

    /** Replays the journal. Call once before serving. */
    async init() {
      await mkdir(dataDir, { recursive: true })
      let text = ""
      try {
        text = await readFile(file, "utf8")
      } catch (error) {
        if (error.code !== "ENOENT") throw error
      }
      const parsed = parseQueueLog(text)
      if (parsed.skipped) log(`warning: skipped ${parsed.skipped} unreadable line(s) in ${file}`)
      for (const [queueKey, attempt] of parsed.pending) pending.set(queueKey, makeEntry(attempt))
      for (const queueKey of parsed.sent) sent.add(queueKey)
      for (const [queueKey, info] of parsed.rejected) rejected.set(queueKey, info)
      return this
    },

    /**
     * Queues `record` (journaled first) and starts sending. Resolves as soon as the game is on the
     * journal: true when it is (still) pending, false when the team server already has it. Use
     * waitFor() to wait a bounded time for the outcome; never await delivery here.
     */
    async enqueue(record) {
      const queueKey = attemptKey(record)
      if (sent.has(queueKey) || rejected.has(queueKey)) return false
      if (!pending.has(queueKey)) {
        pending.set(queueKey, makeEntry(record))
        await appendLine({ queued: forwardPayload(record), at: stamp() })
      }
      if (!closed) flush().catch(() => {})
      return true
    },

    /** Queues every local game the journal has never seen (recorded before UPSTREAM_URL was set). */
    async backfill(records) {
      let added = 0
      for (const record of records) {
        const queueKey = attemptKey(record)
        if (pending.has(queueKey) || sent.has(queueKey) || rejected.has(queueKey)) continue
        pending.set(queueKey, makeEntry(record))
        await appendLine({ queued: forwardPayload(record), at: stamp() })
        added += 1
      }
      if (added) log(`upstream: ${added} earlier game(s) queued for the team server`)
      if (pending.size && !closed) flush().catch(() => {})
      return added
    },

    /**
     * Waits up to `ms` for the game with `queueKey` to be settled (sent or rejected), or for the
     * current sending round to end (the server is down: no point waiting longer). Resolves the
     * outcome, or null when still pending.
     */
    async waitFor(queueKey, ms) {
      const entry = pending.get(queueKey)
      if (!entry) return sent.has(queueKey) ? { ok: true } : rejected.has(queueKey) ? { ok: false, rejected: true } : null
      let timeout
      const waited = await Promise.race([
        entry.settled,
        (roundEnd ?? Promise.resolve()).then(() => null),
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(null), ms)
          timeout.unref?.()
        }),
      ])
      clearTimeout(timeout)
      return waited
    },

    /**
     * The team server's league (players WITH emails, for merging), or null when it cannot be
     * reached and nothing recent is cached. Resolves { players, attempts, fetchedAt, stale }.
     */
    async league() {
      const age = cache ? now().getTime() - Date.parse(cache.fetchedAt) : Infinity
      if (cache && age < cacheMs) return cache
      if (!fetchingLeague) {
        fetchingLeague = (async () => {
          const result = await call("/api/league", { method: "GET", headers: headers() }, getTimeoutMs)
          if (result.ok && result.data?.ok === true && Array.isArray(result.data.players)) {
            cache = { players: result.data.players, attempts: Number(result.data.attempts) || 0, fetchedAt: stamp(), stale: false }
            return cache
          }
          lastError = describeFailure(result.status, result.data)
          lastErrorAt = stamp()
          if (cache && now().getTime() - Date.parse(cache.fetchedAt) < staleMs) return { ...cache, stale: true }
          return null
        })().finally(() => {
          fetchingLeague = null
        })
      }
      return fetchingLeague
    },

    /** Keys of local games the team server has not confirmed yet. */
    pendingKeys() {
      return new Set(pending.keys())
    },

    status() {
      return {
        configured: true,
        url,
        key: Boolean(key),
        queued: pending.size,
        sent: sent.size,
        rejected: rejected.size,
        lastSyncAt,
        lastError,
        lastErrorAt,
        nextRetryAt,
        leagueCachedAt: cache?.fetchedAt ?? null,
      }
    },

    flush,

    close() {
      closed = true
      if (timer) clearTimeout(timer)
      timer = null
      return journal
    },
  }
}
