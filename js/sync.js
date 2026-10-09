/**
 * Token Quest kiosk <-> local server sync (no framework, same origin, offline-tolerant).
 *
 * Call recordAttempt() from the end-of-run handler. If the server is unreachable the payload is
 * queued in localStorage ("token-quest-sync-queue") and retried on the next call, on page load
 * and when the browser comes back online. Nothing here ever shows the UI an email address.
 *
 * ---------------------------------------------------------------------------------------
 * PAYLOAD for recordAttempt(payload)  ->  POST /api/attempt  (JSON)
 * ---------------------------------------------------------------------------------------
 *   name           string          2-40 chars: letters, spaces, apostrophes, hyphens
 *   email          string          valid address; the server lowercases it and keys players by it
 *   score          number          finite, >= 0  (plan.score)
 *   useCase        string?         <= 120 chars, e.g. mission names joined with " + " (optional)
 *   costPerMTok    number | null?  dollars per 1M tokens for the run, finite >= 0 (optional)
 *   profitPerHour  number | null?  dollars per hour, may be negative (optional)
 *   fteEquivalent  number | null?  people-power: full-time people the factory replaces, finite >= 0 (optional)
 *   annualSavings  number | null?  dollars saved per year vs. people, may be negative (optional)
 *   humanHoursPerYear number | null? human hours of work done per year, finite >= 0 (optional)
 *   scenario       string?         <= 60 chars, the scenario card played (optional)
 *   consent        true            must be literally true or the server rejects the attempt
 *   consentAt      string | number ISO date or epoch ms when the player ticked consent
 *   playedAt       string | number? ISO date or epoch ms; filled in with "now" if omitted
 *
 * RESOLVED VALUE of recordAttempt()
 *   { ok: true, attempts, best, latest, rank, players, newBest }
 *        attempts  number of runs recorded for this email (including this one)
 *        best      best score for this email          latest   score of this run
 *        rank      1-based rank among all players by best score
 *        players   total number of players            newBest  true when this run set the best
 *   { ok: false, offline: true, queued }      server unreachable; queued for retry (queued = queue length)
 *   { ok: false, error, message, details? }   server rejected it (validation); not retried
 *
 * fetchLeague()  ->  GET /api/league  ->  array sorted by best desc, or null when offline:
 *   [{ rank, name, attempts, best, latest, bestUseCase, fteEquivalent, firstPlayedAt, lastPlayedAt }]
 *   (fteEquivalent is the best attempt's people-power, or null when the game did not send it)
 *
 * flushQueue()   ->  { sent, remaining }   retries queued attempts in order.
 * ---------------------------------------------------------------------------------------
 */

export const QUEUE_KEY = "token-quest-sync-queue"
const MAX_QUEUE = 500
const MAX_TRIES = 25
const TIMEOUT_MS = 6000

const deps = {
  fetch: typeof fetch === "function" ? (...args) => fetch(...args) : null,
  storage: typeof localStorage !== "undefined" ? localStorage : null,
  baseUrl: "",
}

/** Test hook: swap fetch, storage or the base URL. Returns the active bindings. */
export function bindSync(overrides = {}) {
  Object.assign(deps, overrides)
  return { ...deps }
}

function readQueue() {
  try {
    const raw = deps.storage?.getItem(QUEUE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(items) {
  try {
    if (!deps.storage) return
    if (items.length) deps.storage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE)))
    else deps.storage.removeItem(QUEUE_KEY)
  } catch {
    /* Storage full or disabled: the attempt is still reported as offline. */
  }
}

async function request(path, init = {}) {
  if (!deps.fetch) return { transport: "offline" }
  const controller = typeof AbortController === "function" ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null
  try {
    const response = await deps.fetch(`${deps.baseUrl}${path}`, { cache: "no-store", signal: controller?.signal, ...init })
    const data = await response.json().catch(() => null)
    if (response.status >= 500) return { transport: "retry", data }
    return { transport: "ok", status: response.status, data: data ?? { ok: false, error: "bad_response", message: "The server sent an unreadable reply." } }
  } catch {
    return { transport: "offline" }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function postAttempt(attempt) {
  return request("/api/attempt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attempt), keepalive: true })
}

function enqueue(attempt) {
  const queue = readQueue()
  queue.push({ attempt, queuedAt: new Date().toISOString(), tries: 0 })
  writeQueue(queue)
  return Math.min(queue.length, MAX_QUEUE)
}

/** Records one finished run. Never throws. */
export async function recordAttempt(payload) {
  const attempt = { ...payload, playedAt: payload?.playedAt ?? new Date().toISOString() }
  await flushQueue().catch(() => {})
  const result = await postAttempt(attempt)
  if (result.transport === "ok") return result.data
  return { ok: false, offline: true, queued: enqueue(attempt) }
}

/** Public league for the board. Resolves null when the server cannot be reached. */
export async function fetchLeague() {
  const result = await request("/api/league", { method: "GET" })
  if (result.transport !== "ok" || !result.data?.ok || !Array.isArray(result.data.players)) return null
  return result.data.players
}

let flushing = null

/** Sends queued attempts in order. Stops at the first network failure; drops attempts the server rejects. */
export function flushQueue() {
  if (flushing) return flushing
  flushing = (async () => {
    let queue = readQueue()
    let sent = 0
    while (queue.length) {
      const [head, ...rest] = queue
      const result = await postAttempt(head.attempt)
      if (result.transport === "offline") break
      if (result.transport === "retry") {
        head.tries = (head.tries || 0) + 1
        if (head.tries < MAX_TRIES) {
          writeQueue(queue)
          break
        }
      } else if (result.data?.ok) sent += 1
      queue = rest
      writeQueue(queue)
    }
    return { sent, remaining: queue.length }
  })().finally(() => {
    flushing = null
  })
  return flushing
}

/** Number of attempts waiting to be sent. */
export function pendingCount() {
  return readQueue().length
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("online", () => flushQueue().catch(() => {}))
  setTimeout(() => flushQueue().catch(() => {}), 0)
}
