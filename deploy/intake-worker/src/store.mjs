/**
 * The player sheet in the private repo: players.json (source of truth, an array of validated
 * attempts) and PLAYERS.md (regenerated from it). Every record() call writes BOTH files before it
 * resolves, each as its own commit through the Contents API. No batching, no "write later": when
 * record() resolves, the sheet shows the game; when it throws StoreUnavailableError, the caller
 * answers 503 so the kiosk client keeps the attempt queued and retries.
 *
 * Concurrency: each write is a compare-and-swap on the file's blob sha. A 409/422 means the file
 * changed underneath us, so we re-read it, re-apply and try again (up to maxTries, with a jittered
 * backoff). PLAYERS.md is always re-rendered from the newest players.json we know, so a stale render
 * heals on the next game at the latest.
 *
 * Idempotency: the game client queues an attempt and re-posts it unchanged when a response was not
 * ok. An attempt with the same email, playedAt and score as one already on file is therefore the
 * same game, not a new one: it is not appended again, but PLAYERS.md is still regenerated (that
 * repairs the case where players.json was written and the Markdown write failed).
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

export function serialiseAttempts(attempts) {
  return `${JSON.stringify(attempts, null, 2)}\n`
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

  function parseAttempts(file) {
    if (!file) return []
    let parsed
    try {
      parsed = JSON.parse(file.text)
    } catch {
      throw new StoreUnavailableError(`${PLAYERS_JSON} in the players repo is not valid JSON; fix the file before more games are recorded`)
    }
    if (!Array.isArray(parsed)) throw new StoreUnavailableError(`${PLAYERS_JSON} in the players repo must contain a JSON array`)
    return parsed
  }

  async function backoff(attempt) {
    const ms = BACKOFF_BASE_MS * 2 ** (attempt - 1) + Math.floor(random() * BACKOFF_JITTER_MS)
    await sleep(ms)
  }

  /**
   * Compare-and-swap write of one file. `produce(existingFile, { retry })` returns { text, message }
   * or null to leave the file alone. Resolves { skipped, sha, commit }.
   */
  async function writeWithRetry(path, produce) {
    let retry = false
    for (let attempt = 1; attempt <= maxTries; attempt += 1) {
      const existing = retry || !cache.has(path) ? await readFresh(path) : cache.get(path)
      const next = await produce(existing, { retry })
      if (!next) return { skipped: true, sha: existing?.sha ?? null, commit: null }
      try {
        const written = await client.write(path, next.text, { sha: existing?.sha ?? null, message: next.message })
        remember(path, written.sha, next.text)
        return { skipped: false, sha: written.sha, commit: written.commit }
      } catch (error) {
        cache.delete(path)
        if (!(error instanceof ConflictError)) throw error
        log(`store: ${path} changed underneath us (try ${attempt}/${maxTries})`)
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
    /** Every attempt on file, freshly read (league and health must not trust another isolate's cache). */
    async all() {
      try {
        return parseAttempts(await readFresh(PLAYERS_JSON))
      } catch (error) {
        throw unavailable(error)
      }
    },

    /**
     * Appends one validated attempt and rewrites the sheet. Resolves
     * { attempts, replayed, commits } where attempts is the full array the sheet now shows.
     */
    async record(attempt) {
      let attempts = []
      let replayed = false
      try {
        const json = await writeWithRetry(PLAYERS_JSON, (existing) => {
          const list = parseAttempts(existing)
          if (list.some((item) => sameAttempt(item, attempt))) {
            attempts = list
            replayed = true
            return null
          }
          attempts = [...list, attempt]
          replayed = false
          return { text: serialiseAttempts(attempts), message: `Token Quest: record game ${attempts.length}` }
        })
        const markdown = await writeWithRetry(PLAYERS_MD, async (_existing, { retry }) => {
          if (retry) {
            // Somebody else wrote the sheet meanwhile: render from the newest truth, as long as it has our game.
            const latest = parseAttempts(await readFresh(PLAYERS_JSON))
            if (latest.some((item) => sameAttempt(item, attempt))) attempts = latest
          }
          const stamp = now()
          return { text: renderPlayersMarkdown(attempts, { now: stamp }), message: `Token Quest: ${statusLine(attempts, stamp)}` }
        })
        return { attempts, replayed, commits: [json.commit, markdown.commit].filter(Boolean) }
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
