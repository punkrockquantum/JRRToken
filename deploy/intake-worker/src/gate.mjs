/**
 * Team access gate: the pure parts (cookie format, signing, parsing, the login page). The HTTP flow
 * lives in worker.mjs. Web APIs only (WebCrypto HMAC-SHA256, TextEncoder, btoa/atob) so Node runs
 * the tests without Cloudflare.
 *
 * Session cookie `tq_session` = base64url(expiryMs) + "." + base64url(HMAC-SHA256(expiryMs, secret)).
 * Nothing about the user is stored anywhere: a valid signature on an unexpired expiry is the whole
 * session, and rotating SESSION_SECRET logs everybody out.
 */

export const SESSION_COOKIE = "tq_session"
export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60
const COOKIE_FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function base64urlEncode(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function base64urlDecode(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) return null
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)))
}

export function constantTimeEqualBytes(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Compares two strings in constant time without leaking their length (both are hashed first). */
export async function constantTimeEqual(a, b) {
  const [da, db] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(String(a))), crypto.subtle.digest("SHA-256", encoder.encode(String(b)))])
  return constantTimeEqualBytes(new Uint8Array(da), new Uint8Array(db))
}

/** A fresh session value that expires maxAgeSeconds from `now` (epoch ms). */
export async function createSession(secret, { now = Date.now(), maxAgeSeconds = SESSION_MAX_AGE_SECONDS } = {}) {
  const expiry = String(now + maxAgeSeconds * 1000)
  return `${base64urlEncode(encoder.encode(expiry))}.${base64urlEncode(await hmac(expiry, secret))}`
}

/** True only for a well-formed value whose signature matches and whose expiry is still ahead of `now`. */
export async function verifySession(value, secret, now = Date.now()) {
  if (typeof value !== "string" || value.length > 200) return false
  const parts = value.split(".")
  if (parts.length !== 2) return false
  const expiryBytes = base64urlDecode(parts[0])
  const signature = base64urlDecode(parts[1])
  if (!expiryBytes || !signature) return false
  const expiry = decoder.decode(expiryBytes)
  if (!/^\d{1,16}$/.test(expiry)) return false
  if (!constantTimeEqualBytes(signature, await hmac(expiry, secret))) return false
  return Number(expiry) > now
}

export function parseCookies(header) {
  const cookies = new Map()
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=")
    if (index === -1) continue
    const name = part.slice(0, index).trim()
    if (name && !cookies.has(name)) cookies.set(name, part.slice(index + 1).trim())
  }
  return cookies
}

export function sessionCookie(value, maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  return `${SESSION_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; ${COOKIE_FLAGS}`
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; ${COOKIE_FLAGS}`
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
}

/** Headers for the login page: never cached, never framed, no scripts, the form may only post here. */
export const LOGIN_PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
}

/** The 8-bit login screen: inline CSS only, a monospace stand-in for the game's pixel font, one field, ENTER. */
export function loginPage({ error = "" } = {}) {
  return `<!DOCTYPE html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Token Quest — team login</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b17; color: #f8d038; font-family: "Press Start 2P", ui-monospace, Menlo, Consolas, "Courier New", monospace; text-transform: uppercase; letter-spacing: 0.08em; }
      main { width: min(92vw, 440px); padding: 28px 24px 22px; background: #15152a; border: 4px solid #f8d038; box-shadow: 8px 8px 0 #000, inset 0 0 0 4px #0b0b17; }
      h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.4; text-shadow: 3px 3px 0 #000; }
      h1 span { color: #fff; }
      p { margin: 0 0 18px; font-size: 11px; line-height: 1.8; color: #9fd0ff; }
      label { display: block; font-size: 11px; margin-bottom: 8px; }
      input { width: 100%; padding: 12px; font: inherit; font-size: 15px; letter-spacing: 0.15em; color: #fff; background: #0b0b17; border: 4px solid #f8d038; border-radius: 0; outline: none; text-transform: none; }
      input:focus { border-color: #fff; }
      button { margin-top: 16px; width: 100%; padding: 14px; font: inherit; font-size: 15px; font-weight: 700; color: #0b0b17; background: #f8d038; border: 0; border-radius: 0; box-shadow: 4px 4px 0 #000; cursor: pointer; }
      button:hover { background: #fff; }
      button:active { transform: translate(4px, 4px); box-shadow: none; }
      .error { color: #ff6b6b; font-size: 11px; margin: 14px 0 0; min-height: 1.8em; }
      .fine { margin: 18px 0 0; font-size: 9px; color: #6f7a9c; }
      .fine a { color: #9fd0ff; }
    </style>
  </head>
  <body>
    <main>
      <h1>Token <span>Quest</span></h1>
      <p>Team access · enter the password you were given</p>
      <form method="post" action="/login" autocomplete="off">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus required maxlength="200" />
        <button type="submit">Enter</button>
        <p class="error" role="alert" aria-live="polite">${escapeHtml(error)}</p>
      </form>
      <p class="fine">Press Enter to play. Your browser stays logged in for 14 days · <a href="/logout">log out</a></p>
    </main>
  </body>
</html>
`
}
