/**
 * The CSV download of every game (GET /api/export.csv): one row per attempt in the order they were
 * recorded, the database's column names as the header, RFC 4180 quoting, CRLF line ends and a UTF-8
 * byte-order mark so Excel opens it with the right encoding on a double-click. Pure functions.
 *
 * Cells that start with =, +, -, @, a tab or a carriage return are prefixed with an apostrophe so a
 * crafted email address or job name can never run as a formula when the sheet is opened in Excel.
 */
export const BOM = "\uFEFF"
export const CSV_COLUMNS = ["played_at", "name", "email", "score", "use_case", "scenario", "cost_per_mtok", "profit_per_hour", "fte_equivalent", "annual_savings", "human_hours_per_year", "consent_at", "source"]
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value) {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : ""
  let text = String(value)
  if (FORMULA_START.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvRow(cells) {
  return cells.map(csvCell).join(",")
}

/** The values of one attempt in CSV_COLUMNS order. */
export function attemptCells(attempt) {
  return [
    attempt.playedAt,
    attempt.name,
    attempt.email,
    attempt.score,
    attempt.useCase || "",
    attempt.scenario || "",
    attempt.costPerMTok ?? null,
    attempt.profitPerHour ?? null,
    attempt.fteEquivalent ?? null,
    attempt.annualSavings ?? null,
    attempt.humanHoursPerYear ?? null,
    attempt.consentAt,
    attempt.source ?? null,
  ]
}

/** The whole file, BOM first, header then one line per attempt, every line CRLF-terminated. */
export function renderAttemptsCsv(attempts) {
  const lines = [csvRow(CSV_COLUMNS)]
  for (const attempt of attempts) lines.push(csvRow(attemptCells(attempt)))
  return `${BOM}${lines.join("\r\n")}\r\n`
}

/** token-quest-players-2026-10-17.csv */
export function csvFilename(now = new Date()) {
  return `token-quest-players-${new Date(now).toISOString().slice(0, 10)}.csv`
}
