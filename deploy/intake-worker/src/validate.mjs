/**
 * Strict validation for POST /api/attempt bodies. Returns normalised values only;
 * unknown fields are dropped and nothing from the input is echoed in error messages.
 *
 * This is a copy of server/validate.mjs so the Worker deploys on its own. tests/intake.test.js
 * checks the two stay identical: change both or the test fails.
 */
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' \u2019-]*$/u
// The WHATWG HTML "valid e-mail address" pattern, with a dot required in the domain.
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}/
const MIN_TIME = Date.UTC(2000, 0, 1)
const MAX_TIME = Date.UTC(2100, 0, 1)
const MAX_SCORE = 1e9
const MAX_MONEY = 1e12
const MAX_USE_CASE = 120
const MAX_SCENARIO = 60

export function parseTime(value) {
  let ms
  if (typeof value === "number") ms = value
  else if (typeof value === "string" && ISO_RE.test(value.trim())) ms = Date.parse(value.trim())
  else return null
  if (!Number.isFinite(ms) || ms < MIN_TIME || ms > MAX_TIME) return null
  return new Date(ms).toISOString()
}

function optionalNumber(value, { min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null) return { value: null }
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return { error: true }
  return { value }
}

export function cleanText(value, max) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

/**
 * @returns {{ ok: true, attempt: object } | { ok: false, errors: string[] }}
 */
export function validateAttempt(body, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, errors: ["body must be a JSON object"] }
  const errors = []

  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : ""
  if (name.length < 2 || name.length > 40 || !NAME_RE.test(name)) errors.push("name must be 2-40 characters using letters, spaces, apostrophes or hyphens")

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) errors.push("email must be a valid email address")

  const score = body.score
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > MAX_SCORE) errors.push("score must be a finite number of at least 0")

  if (body.consent !== true) errors.push("consent must be true")

  const consentAt = parseTime(body.consentAt)
  if (!consentAt) errors.push("consentAt must be an ISO 8601 date or epoch milliseconds")

  const playedAt = body.playedAt === undefined || body.playedAt === null ? now.toISOString() : parseTime(body.playedAt)
  if (!playedAt) errors.push("playedAt must be an ISO 8601 date or epoch milliseconds")

  let useCase = ""
  if (body.useCase !== undefined && body.useCase !== null) {
    if (typeof body.useCase !== "string") errors.push("useCase must be a string")
    else useCase = cleanText(body.useCase, MAX_USE_CASE)
  }

  const cost = optionalNumber(body.costPerMTok, { min: 0, max: MAX_MONEY })
  if (cost.error) errors.push("costPerMTok must be a finite number of at least 0, or null")
  const profit = optionalNumber(body.profitPerHour, { min: -MAX_MONEY, max: MAX_MONEY })
  if (profit.error) errors.push("profitPerHour must be a finite number, or null")

  // People-power: how many people's work the factory does, and what that saves per year.
  const fte = optionalNumber(body.fteEquivalent, { min: 0, max: MAX_MONEY })
  if (fte.error) errors.push("fteEquivalent must be a finite number of at least 0, or null")
  const savings = optionalNumber(body.annualSavings, { min: -MAX_MONEY, max: MAX_MONEY })
  if (savings.error) errors.push("annualSavings must be a finite number, or null")
  const hours = optionalNumber(body.humanHoursPerYear, { min: 0, max: MAX_MONEY })
  if (hours.error) errors.push("humanHoursPerYear must be a finite number of at least 0, or null")

  let scenario = ""
  if (body.scenario !== undefined && body.scenario !== null) {
    if (typeof body.scenario !== "string") errors.push("scenario must be a string")
    else scenario = cleanText(body.scenario, MAX_SCENARIO)
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    attempt: {
      playedAt,
      name,
      email,
      score,
      useCase,
      costPerMTok: cost.value,
      profitPerHour: profit.value,
      fteEquivalent: fte.value,
      annualSavings: savings.value,
      humanHoursPerYear: hours.value,
      scenario,
      consent: true,
      consentAt,
    },
  }
}
