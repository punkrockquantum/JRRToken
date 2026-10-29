/**
 * Workshop mode: the codes and tokens. Session codes (4 characters, no 0/O/1/I), host codes (4 digits,
 * one per table, distinct within a session), the facilitator PIN (6 digits) and the team token (a
 * signed value the iPad keeps after joining). Web APIs only (crypto.getRandomValues, WebCrypto HMAC),
 * so Node runs the tests without Cloudflare. Nothing here logs a code.
 *
 * Team token = base64url("<teamId>.<sessionCode>.<expiryMs>") + "." + base64url(HMAC-SHA256(payload, secret)).
 * The secret is the gate's session secret (worker.mjs gateConfig), so rotating SESSION_SECRET ends every
 * table's token too. Sent back as JSON and as the `tq_team` cookie (HttpOnly, Secure, SameSite=Lax,
 * Path=/api/team); the API accepts the X-Team-Token header or the cookie.
 */
import { base64urlDecode, base64urlEncode, constantTimeEqual, constantTimeEqualBytes } from "./gate.mjs"

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const SESSION_CODE_LENGTH = 4
export const HOST_CODE_LENGTH = 4
export const PIN_LENGTH = 6
export const TEAM_TOKEN_MAX_AGE_SECONDS = 8 * 60 * 60
export const TEAM_COOKIE = "tq_team"
export const TEAM_TOKEN_HEADER = "X-Team-Token"
const TEAM_COOKIE_FLAGS = "Path=/api/team; HttpOnly; Secure; SameSite=Lax"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** `count` uniform integers in [0, max) from crypto.getRandomValues (rejection sampling, no modulo bias). */
export function randomInts(count, max, randomBytes = defaultRandomBytes) {
  if (!(Number.isInteger(max) && max > 0 && max <= 65536)) throw new RangeError("max must be 1..65536")
  const out = []
  const limit = 65536 - (65536 % max)
  while (out.length < count) {
    const bytes = randomBytes(2 * (count - out.length) * 2)
    for (let i = 0; i + 1 < bytes.length && out.length < count; i += 2) {
      const value = (bytes[i] << 8) | bytes[i + 1]
      if (value < limit) out.push(value % max)
    }
  }
  return out
}

function defaultRandomBytes(length) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/** A session code: 4 characters from the unambiguous alphabet. */
export function sessionCode(randomBytes) {
  return randomInts(SESSION_CODE_LENGTH, CODE_ALPHABET.length, randomBytes)
    .map((index) => CODE_ALPHABET[index])
    .join("")
}

function digits(length, randomBytes) {
  return randomInts(length, 10, randomBytes).join("")
}

/** `count` distinct 4-digit host codes, none of them a run of one digit (0000, 1111...). */
export function hostCodes(count, randomBytes) {
  const codes = new Set()
  while (codes.size < count) {
    const code = digits(HOST_CODE_LENGTH, randomBytes)
    if (/^(\d)\1+$/.test(code)) continue
    codes.add(code)
  }
  return [...codes]
}

/** The facilitator PIN: 6 digits. */
export function facilitatorPin(randomBytes) {
  return digits(PIN_LENGTH, randomBytes)
}

/** Upper-cases and strips a typed code; null unless it is 4 to 6 characters of the alphabet (0, O, 1 and I are never in a code). */
export function normaliseCode(text) {
  const clean = String(text ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
  if (clean.length < 4 || clean.length > 6) return null
  return [...clean].every((char) => CODE_ALPHABET.includes(char)) ? clean : null
}

/** True for a string of exactly `length` digits. */
export function isDigits(text, length) {
  return typeof text === "string" && new RegExp(`^\\d{${length}}$`).test(text)
}

/** Constant-time compare of two short secrets (host code, PIN). */
export async function secretsMatch(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || !given || !expected) return false
  return constantTimeEqual(given, expected)
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)))
}

/** A signed team token for `teamId` in session `code`, expiring maxAgeSeconds from `now` (epoch ms). */
export async function signTeamToken({ teamId, code }, secret, { now = Date.now(), maxAgeSeconds = TEAM_TOKEN_MAX_AGE_SECONDS } = {}) {
  const payload = `${Number(teamId)}.${code}.${now + maxAgeSeconds * 1000}`
  return `${base64urlEncode(encoder.encode(payload))}.${base64urlEncode(await hmac(payload, secret))}`
}

/** { teamId, code, expiry } for a well-formed, correctly signed, unexpired token; null otherwise. */
export async function verifyTeamToken(token, secret, now = Date.now()) {
  if (typeof token !== "string" || token.length > 300) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const payloadBytes = base64urlDecode(parts[0])
  const signature = base64urlDecode(parts[1])
  if (!payloadBytes || !signature) return null
  const payload = decoder.decode(payloadBytes)
  const match = /^(\d{1,12})\.([A-Z2-9]{4,6})\.(\d{1,16})$/.exec(payload)
  if (!match) return null
  if (!constantTimeEqualBytes(signature, await hmac(payload, secret))) return null
  const expiry = Number(match[3])
  if (!(expiry > now)) return null
  return { teamId: Number(match[1]), code: match[2], expiry }
}

export function teamCookie(token, maxAgeSeconds = TEAM_TOKEN_MAX_AGE_SECONDS) {
  return `${TEAM_COOKIE}=${token}; Max-Age=${maxAgeSeconds}; ${TEAM_COOKIE_FLAGS}`
}

export function clearTeamCookie() {
  return `${TEAM_COOKIE}=; Max-Age=0; ${TEAM_COOKIE_FLAGS}`
}
