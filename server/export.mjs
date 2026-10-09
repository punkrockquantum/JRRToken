/** Builds the leaderboard workbook and writes it atomically (temp file + rename), coalescing bursts. */
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { aggregatePlayers } from "./players.mjs"
import { buildXlsx } from "./xlsx.mjs"

const PLAYER_COLUMNS = [
  { header: "Name", width: 26 },
  { header: "Email", width: 32 },
  { header: "Attempts", width: 10 },
  { header: "Best Score", width: 12 },
  { header: "Latest Score", width: 13 },
  { header: "Best Cost per 1M tokens ($)", width: 26 },
  { header: "Best Use Case", width: 28 },
  { header: "First Played", width: 24 },
  { header: "Last Played", width: 24 },
  { header: "Consent", width: 9 },
  { header: "Consent At", width: 24 },
  { header: "Best people-power", width: 18 },
  { header: "Best annual saving", width: 19 },
]

const ATTEMPT_COLUMNS = [
  { header: "Played At", width: 24 },
  { header: "Name", width: 26 },
  { header: "Email", width: 32 },
  { header: "Use Case", width: 28 },
  { header: "Scenario", width: 24 },
  { header: "Score", width: 10 },
  { header: "Cost per 1M tokens ($)", width: 22 },
  { header: "Profit per hour ($)", width: 20 },
  { header: "People-power (FTE)", width: 19 },
  { header: "Human hours / year", width: 19 },
  { header: "Annual saving ($)", width: 18 },
]

const money = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null)

/** Two sheets: Players (one row per email, ranked) and Attempts (every run, newest first). */
export function buildWorkbook(attempts, { now = new Date() } = {}) {
  const players = aggregatePlayers(attempts).map((player) => [
    player.name,
    player.email,
    player.attempts,
    player.best,
    player.latest,
    money(player.bestCostPerMTok),
    player.bestUseCase || null,
    player.firstPlayedAt,
    player.lastPlayedAt,
    player.consent === true,
    player.consentAt,
    money(player.bestFteEquivalent),
    money(player.bestAnnualSavings),
  ])
  const runs = attempts
    .slice()
    .sort((a, b) => String(b.playedAt).localeCompare(String(a.playedAt)))
    .map((attempt) => [
      attempt.playedAt,
      attempt.name,
      attempt.email,
      attempt.useCase || null,
      attempt.scenario || null,
      attempt.score,
      money(attempt.costPerMTok),
      money(attempt.profitPerHour),
      money(attempt.fteEquivalent),
      money(attempt.humanHoursPerYear),
      money(attempt.annualSavings),
    ])
  return buildXlsx(
    [
      { name: "Players", columns: PLAYER_COLUMNS, rows: players },
      { name: "Attempts", columns: ATTEMPT_COLUMNS, rows: runs },
    ],
    { title: "Token Quest Leaderboard", created: now },
  )
}

/** Writes `buffer` to `target` via a temp file in the same directory so readers never see a partial file. */
export async function writeAtomic(target, buffer) {
  await mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`
  try {
    await writeFile(temp, buffer)
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

export class Exporter {
  constructor(store, exportPath, { delay = 1000, log = () => {} } = {}) {
    this.store = store
    this.exportPath = exportPath
    this.delay = delay
    this.log = log
    this.timer = null
    this.pending = null
    this.dirty = false
    this.writing = null
    this.lastError = null
  }

  /** Regenerates the workbook about `delay` ms from now; repeated calls inside that window are coalesced. */
  schedule() {
    this.dirty = true
    if (this.timer) return this.pending
    this.pending = new Promise((resolve) => {
      this.timer = setTimeout(() => {
        this.timer = null
        resolve(this.flush())
      }, this.delay)
      this.timer.unref?.()
    })
    return this.pending
  }

  /** Writes immediately (awaiting any write already in progress). Resolves true on success. */
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    while (this.writing) await this.writing
    if (!this.dirty) return this.lastError === null
    this.dirty = false
    this.writing = (async () => {
      try {
        const attempts = await this.store.all()
        await writeAtomic(this.exportPath, buildWorkbook(attempts))
        this.lastError = null
        this.log(`export: wrote ${attempts.length} attempt(s) to ${this.exportPath}`)
        return true
      } catch (error) {
        this.lastError = error
        this.log(`export: could not write ${this.exportPath}: ${error.message}`)
        return false
      } finally {
        this.writing = null
      }
    })()
    return this.writing
  }

  /** Keeps a copy of the current workbook next to the archived attempts before a reset. */
  async archiveTo(target) {
    try {
      await copyFile(this.exportPath, target)
      return target
    } catch (error) {
      if (error.code !== "ENOENT") this.log(`export: could not archive ${this.exportPath}: ${error.message}`)
      return null
    }
  }
}
