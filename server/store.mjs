/**
 * Append-only attempt store: one JSON object per line in DATA_DIR/attempts.jsonl.
 * Writes are serialised; the in-memory copy is reloaded if the file changes on disk.
 * Nothing here ever deletes data: reset() renames the file to attempts-<timestamp>.jsonl.
 */
import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises"
import path from "node:path"

export const ATTEMPTS_FILE = "attempts.jsonl"

/** The identity of a game everywhere (kiosk, Worker, queue): same email, playedAt and score = same game. */
export function attemptKey(attempt) {
  return `${String(attempt?.email || "").toLowerCase()}|${attempt?.playedAt}|${attempt?.score}`
}

export function sameAttempt(a, b) {
  return Boolean(a && b) && String(a.email).toLowerCase() === String(b.email).toLowerCase() && a.playedAt === b.playedAt && a.score === b.score
}

async function signatureOf(file) {
  try {
    const info = await stat(file)
    return `${info.size}:${info.mtimeMs}`
  } catch (error) {
    if (error.code === "ENOENT") return "missing"
    throw error
  }
}

export function parseAttemptLines(text) {
  const attempts = []
  let skipped = 0
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      if (record && typeof record === "object" && typeof record.email === "string" && typeof record.score === "number") attempts.push(record)
      else skipped += 1
    } catch {
      skipped += 1
    }
  }
  return { attempts, skipped }
}

export function archiveStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19)
}

export class AttemptStore {
  constructor(dataDir, { log = () => {} } = {}) {
    this.dataDir = dataDir
    this.file = path.join(dataDir, ATTEMPTS_FILE)
    this.attempts = []
    this.signature = null
    this.log = log
    this.queue = Promise.resolve()
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true })
    await this.reload()
    return this
  }

  /** Runs file operations one at a time so concurrent requests cannot interleave writes. */
  serial(task) {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  async reload() {
    const signature = await signatureOf(this.file)
    if (signature === "missing") {
      this.attempts = []
      this.signature = signature
      return
    }
    const { attempts, skipped } = parseAttemptLines(await readFile(this.file, "utf8"))
    if (skipped) this.log(`warning: skipped ${skipped} unreadable line(s) in ${this.file}`)
    this.attempts = attempts
    this.signature = signature
  }

  async refresh() {
    if ((await signatureOf(this.file)) !== this.signature) await this.reload()
  }

  async all() {
    await this.serial(() => this.refresh())
    return this.attempts.slice()
  }

  async append(attempt) {
    const record = { id: randomUUID(), receivedAt: new Date().toISOString(), ...attempt }
    await mkdir(this.dataDir, { recursive: true })
    await appendFile(this.file, `${JSON.stringify(record)}\n`, "utf8")
    this.attempts.push(record)
    this.signature = await signatureOf(this.file)
    return record
  }

  /** Appends a validated attempt and returns the stored record. */
  add(attempt) {
    return this.serial(async () => {
      await this.refresh()
      return this.append(attempt)
    })
  }

  /**
   * Like add(), but a game already on file (same email, playedAt and score) is returned as it is
   * instead of being stored twice: the browser re-posts an attempt unchanged when it never saw the
   * answer. Resolves { record, replayed }.
   */
  addOnce(attempt) {
    return this.serial(async () => {
      await this.refresh()
      const existing = this.attempts.find((item) => sameAttempt(item, attempt))
      if (existing) return { record: existing, replayed: true }
      return { record: await this.append(attempt), replayed: false }
    })
  }

  /** Moves the current file aside and starts fresh. Returns { archived, attempts }. */
  reset() {
    return this.serial(async () => {
      await this.refresh()
      const count = this.attempts.length
      let archived = null
      if ((await signatureOf(this.file)) !== "missing") {
        archived = path.join(this.dataDir, `attempts-${archiveStamp()}.jsonl`)
        await rename(this.file, archived)
      }
      this.attempts = []
      this.signature = await signatureOf(this.file)
      return { archived, attempts: count }
    })
  }
}
