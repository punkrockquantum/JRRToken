/**
 * Optional mirror of the sheet to a private GitHub repo: players.json (every attempt) and
 * PLAYERS.md (the staff tables), both rewritten from the D1 rows after a game. OFF by default and
 * nothing depends on it: the D1 database (d1store.mjs) is the source of truth, a game is answered
 * from D1 alone, and the mirror runs afterwards (ctx.waitUntil). It is on only when
 * MIRROR_MARKDOWN = "true" and PLAYERS_REPO + the GITHUB_TOKEN secret are set; failures show up in
 * /api/health under `mirror` and never fail a game.
 *
 * Concurrency: each write is a compare-and-swap on the file's blob sha. A 409/422 means the file
 * changed underneath us, so we re-read it and write again (up to maxTries, with a jittered backoff).
 * Both files are always rendered from the list the caller passes, so a stale mirror heals on the
 * next game at the latest.
 *
 * StoreUnavailableError lives here because both stores throw it: the Worker turns it into
 * 503 store_unavailable so the browser queue and the kiosk journals keep the game and retry.
 */
import { ConflictError, GitHubError } from "./github.mjs"
import { renderPlayersMarkdown, statusLine } from "./markdown.mjs"

export const PLAYERS_JSON = "players.json"
export const PLAYERS_MD = "PLAYERS.md"
export const MAX_TRIES = 3
const BACKOFF_BASE_MS = 100
const BACKOFF_JITTER_MS = 200

export class StoreUnavailableError extends Error {
  constructor(message, { cause, status = null } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = "StoreUnavailableError"
    this.status = status
  }
}

export function sameAttempt(a, b) {
  return Boolean(a && b) && a.email === b.email && a.playedAt === b.playedAt && a.score === b.score
}

/** The players.json text: the validated attempts only (no database ids), the way the file always looked. */
export function serialiseAttempts(attempts) {
  const rows = attempts.map(({ id, source, ...attempt }) => attempt)
  return `${JSON.stringify(rows, null, 2)}\n`
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {object} options
 * @param {ReturnType<import("./github.mjs").createContentsClient>} options.client
 * @param {() => Date} [options.now]
 * @param {() => number} [options.random]   for the backoff jitter (tests pass () => 0)
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {number} [options.maxTries]
 * @param {(line: string) => void} [options.log]  never receives names or emails
 */
export function createPlayersStore({ client, now = () => new Date(), random = Math.random, sleep = defaultSleep, maxTries = MAX_TRIES, log = () => {} }) {
  /** Last known { sha, text } per path. A stale entry only costs one conflict round-trip. */
  const cache = new Map()

  function remember(path, sha, text) {
    cache.set(path, { sha, text })
  }

  async function readFresh(path) {
    const file = await client.read(path)
    if (file) remember(path, file.sha, file.text)
    else cache.delete(path)
    return file
  }

  async function backoff(attempt) {
    const ms = BACKOFF_BASE_MS * 2 ** (attempt - 1) + Math.floor(random() * BACKOFF_JITTER_MS)
    await sleep(ms)
  }

  /**
   * Compare-and-swap write of one file. `produce(existingFile)` returns { text, message } or null to
   * leave the file alone. Resolves { skipped, sha, commit }.
   */
  async function writeWithRetry(path, produce) {
    let retry = false
    for (let attempt = 1; attempt <= maxTries; attempt += 1) {
      const existing = retry || !cache.has(path) ? await readFresh(path) : cache.get(path)
      const next = await produce(existing)
      if (!next) return { skipped: true, sha: existing?.sha ?? null, commit: null }
      try {
        const written = await client.write(path, next.text, { sha: existing?.sha ?? null, message: next.message })
        remember(path, written.sha, next.text)
        return { skipped: false, sha: written.sha, commit: written.commit }
      } catch (error) {
        cache.delete(path)
        if (!(error instanceof ConflictError)) throw error
        log(`mirror: ${path} changed underneath us (try ${attempt}/${maxTries})`)
        retry = true
        if (attempt < maxTries) await backoff(attempt)
      }
    }
    throw new StoreUnavailableError(`${path} kept changing; gave up after ${maxTries} tries`)
  }

  function unavailable(error) {
    cache.clear() // start the next attempt from a fresh read: the file may have been repaired or replaced
    if (error instanceof StoreUnavailableError) return error
    if (error instanceof GitHubError) return new StoreUnavailableError(error.message, { cause: error, status: error.status })
    return new StoreUnavailableError("The players repo could not be updated", { cause: error })
  }

  return {
    kind: "github",

    /**
     * Rewrites players.json and PLAYERS.md from `attempts` (the D1 rows, oldest first). players.json
     * is skipped when it already has exactly this content; PLAYERS.md is always re-stamped.
     * Resolves { commits } (the commit shas made) or throws StoreUnavailableError.
     */
    async publish(attempts) {
      try {
        const text = serialiseAttempts(attempts)
        const json = await writeWithRetry(PLAYERS_JSON, (existing) => (existing?.text === text ? null : { text, message: `Token Quest: ${attempts.length} game${attempts.length === 1 ? "" : "s"} on file` }))
        const stamp = now()
        const markdown = await writeWithRetry(PLAYERS_MD, () => ({ text: renderPlayersMarkdown(attempts, { now: stamp }), message: `Token Quest: ${statusLine(attempts, stamp)}` }))
        return { commits: [json.commit, markdown.commit].filter(Boolean) }
      } catch (error) {
        throw unavailable(error)
      }
    },

    /** Checks the repo is reachable with this token. Throws StoreUnavailableError otherwise. */
    async ping() {
      try {
        await client.ping()
      } catch (error) {
        throw unavailable(error)
      }
    },
  }
}
