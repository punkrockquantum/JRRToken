/**
 * The team-access gate of the tokenquest Worker (deploy/intake-worker/src/gate.mjs + worker.mjs):
 * pure Node, a fake ASSETS binding, a tiny fake of the GitHub Contents API and Node's WebCrypto.
 * The password used here is a test fixture, never the real team password (that one is a Worker
 * secret and lives in no file).
 */
import assert from "node:assert/strict"
import test from "node:test"
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, base64urlDecode, base64urlEncode, clearSessionCookie, constantTimeEqual, createSession, loginPage, parseCookies, sessionCookie, verifySession } from "../deploy/intake-worker/src/gate.mjs"
import { PLAYERS_MD } from "../deploy/intake-worker/src/store.mjs"
import { SERVICE, WRONG_PASSWORD_DELAY_MS, createHandler, gateConfig } from "../deploy/intake-worker/src/worker.mjs"

const SITE = "https://tokenquest.example.workers.dev"
const PASSWORD = "correct horse battery staple (test fixture)"
const SECRET = "test-session-secret-not-used-anywhere-real"
const TOKEN = "github_pat_TEST_ONLY_not_a_real_token"
const REPO = "punkrockquantum/token-quest-players"
const T0 = Date.parse("2026-10-16T16:00:00.000Z")

/** Just enough of api.github.com for one attempt and one league read: files in a Map, no sha checks. */
function fakeGitHub() {
  const files = new Map()
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  return {
    files,
    async fetch(url, init = {}) {
      const { pathname } = new URL(url)
      if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return json(401, { message: "Bad credentials" })
      if (pathname === `/repos/${REPO}`) return json(200, { full_name: REPO })
      const file = decodeURIComponent(pathname.replace(`/repos/${REPO}/contents/`, ""))
      if ((init.method || "GET") === "GET") {
        if (!files.has(file)) return json(404, { message: "Not Found" })
        return json(200, { type: "file", sha: `sha-${files.get(file).length}`, encoding: "base64", content: Buffer.from(files.get(file)).toString("base64") })
      }
      const body = JSON.parse(init.body)
      files.set(file, Buffer.from(body.content, "base64").toString("utf8"))
      return json(201, { content: { sha: `sha-${files.get(file).length}` }, commit: { sha: "c1" } })
    },
  }
}

function fakeAssets(served) {
  return {
    fetch: async (request) => {
      const { pathname } = new URL(request.url)
      served.push(pathname)
      return new Response(`asset ${pathname}`, { status: pathname === "/missing" ? 404 : 200, headers: { "Content-Type": pathname.endsWith(".woff2") ? "font/woff2" : "text/html; charset=utf-8", ETag: '"abc"' } })
    },
  }
}

function makeSite(envOverrides = {}) {
  const served = []
  const sleeps = []
  const logs = []
  const gh = fakeGitHub()
  let clock = T0
  const handler = createHandler({
    fetch: gh.fetch,
    now: () => new Date(clock),
    random: () => 0.5,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    log: (line) => logs.push(line),
  })
  const env = {
    ASSETS: fakeAssets(served),
    ACCESS_PASSWORD: PASSWORD,
    SESSION_SECRET: SECRET,
    GITHUB_TOKEN: TOKEN,
    PLAYERS_REPO: REPO,
    PLAYERS_BRANCH: "main",
    ALLOWED_ORIGINS: "https://punkrockquantum.github.io",
    ...envOverrides,
  }
  const request = (route, init = {}) => handler.fetch(new Request(`${SITE}${route}`, init), env)
  const login = (password, { headers = {}, ...init } = {}) =>
    request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: SITE, "CF-Connecting-IP": "203.0.113.7", ...headers },
      body: new URLSearchParams({ password }).toString(),
      ...init,
    })
  return { handler, env, request, login, served, sleeps, logs, gh, tick: (ms) => (clock += ms) }
}

const attempt = () => ({ name: "Ada Lovelace", email: "ada@example.com", score: 900, consent: true, consentAt: "2026-10-16T15:00:00.000Z", playedAt: "2026-10-16T15:05:00.000Z" })

function cookieFrom(response) {
  const header = response.headers.get("Set-Cookie")
  assert.ok(header, "expected a Set-Cookie header")
  return header.split(";")[0]
}

test("gate.mjs: sessions are signed, expire, and reject tampering; cookies carry the right flags", async () => {
  for (const bytes of [new Uint8Array([]), new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]), new TextEncoder().encode("1761234567890")]) {
    assert.deepEqual([...base64urlDecode(base64urlEncode(bytes))], [...bytes])
  }
  assert.equal(base64urlDecode("not base64url!"), null)
  assert.equal(base64urlEncode(new Uint8Array([251, 255])).includes("+"), false, "URL-safe alphabet, no padding")

  const value = await createSession(SECRET, { now: T0 })
  assert.match(value, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
  assert.equal(await verifySession(value, SECRET, T0), true)
  assert.equal(await verifySession(value, SECRET, T0 + SESSION_MAX_AGE_SECONDS * 1000 - 1), true, "valid right up to expiry")
  assert.equal(await verifySession(value, SECRET, T0 + SESSION_MAX_AGE_SECONDS * 1000), false, "expired")
  assert.equal(await verifySession(value, "another secret", T0), false, "wrong key")
  const [expiry, signature] = value.split(".")
  const flipped = signature[0] === "A" ? "B" : "A"
  assert.equal(await verifySession(`${expiry}.${flipped}${signature.slice(1)}`, SECRET, T0), false, "tampered signature")
  const later = base64urlEncode(new TextEncoder().encode(String(T0 + 10 * 365 * 24 * 3600 * 1000)))
  assert.equal(await verifySession(`${later}.${signature}`, SECRET, T0), false, "tampered expiry")
  for (const bad of ["", "x", "a.b.c", `${expiry}.`, `.${signature}`, 42, null, undefined, "x".repeat(300)]) assert.equal(await verifySession(bad, SECRET, T0), false, String(bad))

  assert.equal(await constantTimeEqual("abc", "abc"), true)
  assert.equal(await constantTimeEqual("abc", "abd"), false)
  assert.equal(await constantTimeEqual("abc", "abcd"), false)
  assert.equal(await constantTimeEqual("", ""), true)

  assert.equal(sessionCookie("v"), "tq_session=v; Max-Age=1209600; Path=/; HttpOnly; Secure; SameSite=Lax")
  assert.equal(clearSessionCookie(), "tq_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax")
  assert.deepEqual([...parseCookies("a=1; tq_session=x.y; b=two=2;  ;novalue; a=dup")], [["a", "1"], ["tq_session", "x.y"], ["b", "two=2"]])
  assert.equal(SESSION_COOKIE, "tq_session")

  const page = loginPage({ error: "<b>Wrong</b> & \"quoted\"" })
  assert.ok(page.includes("&lt;b&gt;Wrong&lt;/b&gt; &amp; &quot;quoted&quot;"), "the error line is HTML-escaped")
  assert.ok(!page.includes("<script"), "no scripts on the login page")
  assert.ok(!/https?:\/\//.test(page.replace(/<!DOCTYPE[^>]*>/, "")), "no external assets on the login page")
  assert.deepEqual(gateConfig({}), { enabled: false, password: "", secret: "tokenquest-derived-session-key:", session: "derived" })
  assert.deepEqual(gateConfig({ ACCESS_PASSWORD: "pw\n", SESSION_SECRET: " s " }), { enabled: true, password: "pw", secret: "s", session: "secret" })
  assert.equal(gateConfig({ ACCESS_PASSWORD: "pw" }).secret, "tokenquest-derived-session-key:pw")
})

test("no cookie: the game is the login page, nothing from dist/ leaks, /api needs a session, /api/health stays public", async () => {
  const site = makeSite()
  for (const route of ["/", "/index.html", "/js/main.js", "/css/game.css", "/missing"]) {
    const response = await site.request(route)
    assert.equal(response.status, 200, route)
    assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8")
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    assert.equal(response.headers.get("X-Frame-Options"), "DENY")
    assert.match(response.headers.get("Content-Security-Policy"), /form-action 'self'/)
    const body = await response.text()
    assert.ok(body.includes('<form method="post" action="/login"') && body.includes('name="password"') && body.includes(">Enter<"), route)
    assert.ok(body.includes("TOKEN") || body.includes("Token"), "it says Token Quest")
  }
  assert.deepEqual(site.served, [], "no asset is fetched for an anonymous visitor")
  assert.equal((await site.request("/login")).status, 200)

  const api = await site.request("/api/attempt", { method: "POST", headers: { "Content-Type": "application/json", Origin: SITE }, body: JSON.stringify(attempt()) })
  assert.equal(api.status, 401)
  assert.deepEqual(await api.json(), { ok: false, error: "unauthorised", message: "Log in to Token Quest first, then play again." })
  assert.equal((await site.request("/api/league")).status, 401)
  assert.equal(site.gh.files.size, 0, "nothing reached the sheet")

  const health = await site.request("/api/health")
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { ok: true, service: SERVICE, gate: true, configured: true }, "public health: flags only, no repo name, no counts")
  const posted = await site.request("/", { method: "POST" })
  assert.equal(posted.status, 401, "non-GET requests without a session get JSON, not a page")
})

test("the right password sets the session cookie and redirects; the wrong one is delayed and refused", async () => {
  const site = makeSite()
  const ok = await site.login(PASSWORD)
  assert.equal(ok.status, 303)
  assert.equal(ok.headers.get("Location"), "/")
  const cookie = ok.headers.get("Set-Cookie")
  assert.match(cookie, /^tq_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Max-Age=1209600; Path=\/; HttpOnly; Secure; SameSite=Lax$/)
  assert.deepEqual(site.sleeps, [], "no delay on success")
  assert.equal(await verifySession(cookieFrom(ok).split("=")[1], SECRET, T0), true)

  const wrong = await site.login("not it")
  assert.equal(wrong.status, 401)
  assert.equal(wrong.headers.get("Set-Cookie"), null)
  assert.equal(wrong.headers.get("Content-Type"), "text/html; charset=utf-8")
  assert.ok((await wrong.text()).includes("Wrong password"))
  assert.deepEqual(site.sleeps, [WRONG_PASSWORD_DELAY_MS], "one second before answering a miss")

  const empty = await site.login("")
  assert.equal(empty.status, 401)
  const almost = await site.login(`${PASSWORD} `)
  assert.equal(almost.status, 401, "a trailing space is a different password")
  const crossSite = await site.login(PASSWORD, { headers: { Origin: "https://evil.example" } })
  assert.equal(crossSite.status, 403, "the form must be posted from the game's own origin")
  const notForm = await site.request("/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: SITE }, body: JSON.stringify({ password: PASSWORD }) })
  assert.equal(notForm.status, 415)
  assert.equal((await site.request("/login", { method: "DELETE" })).status, 405)
  assert.ok(!site.logs.join("\n").includes(PASSWORD), "the password is never logged")
})

test("with a valid cookie the game and the API are served with the right cache headers; bad cookies are not", async () => {
  const site = makeSite()
  const cookie = cookieFrom(await site.login(PASSWORD))

  const index = await site.request("/", { headers: { Cookie: cookie } })
  assert.equal(await index.text(), "asset /")
  assert.equal(index.headers.get("Cache-Control"), "no-store")
  assert.equal(index.headers.get("X-Content-Type-Options"), "nosniff")
  assert.equal(index.headers.get("ETag"), '"abc"', "asset headers survive")
  const font = await site.request("/assets/fonts/press-start-2p-latin-400-normal.woff2", { headers: { Cookie: cookie } })
  assert.equal(font.headers.get("Cache-Control"), "public, max-age=31536000, immutable")
  assert.equal(font.headers.get("Content-Type"), "font/woff2")
  const missing = await site.request("/missing", { headers: { Cookie: `other=1; ${cookie}; more=2` } })
  assert.equal(missing.status, 404, "unknown paths fall through to the assets' 404 page")
  assert.deepEqual(site.served, ["/", "/assets/fonts/press-start-2p-latin-400-normal.woff2", "/missing"])

  assert.equal((await site.request("/login", { headers: { Cookie: cookie } })).status, 303, "already logged in: straight to the game")

  const posted = await site.request("/api/attempt", { method: "POST", headers: { "Content-Type": "application/json", Origin: SITE, Cookie: cookie }, body: JSON.stringify(attempt()) })
  assert.equal(posted.status, 200)
  assert.equal((await posted.json()).attempts, 1)
  assert.ok(site.gh.files.has(PLAYERS_MD), "the sheet was written")
  const health = await (await site.request("/api/health", { headers: { Cookie: cookie } })).json()
  assert.deepEqual(health, { ok: true, service: SERVICE, gate: true, configured: true, session: "secret", repo: REPO, branch: "main", sheet: PLAYERS_MD, attempts: 1, players: 1 })

  const [name, value] = cookie.split("=")
  const [expiry, signature] = value.split(".")
  const tampered = `${name}=${expiry}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`
  const tamperedPage = await site.request("/", { headers: { Cookie: tampered } })
  assert.equal(tamperedPage.status, 200)
  assert.ok((await tamperedPage.text()).includes('action="/login"'), "tampered cookie: login page")
  site.tick(SESSION_MAX_AGE_SECONDS * 1000 + 1)
  const expired = await site.request("/", { headers: { Cookie: cookie } })
  assert.ok((await expired.text()).includes('action="/login"'), "expired cookie: login page")
  assert.equal((await site.request("/api/league", { headers: { Cookie: cookie } })).status, 401, "expired cookie: API refused")
  assert.equal(site.served.length, 3, "neither bad cookie reached the assets")
  for (const garbage of ["tq_session=garbage", "tq_session=", "tq_session=a.b", `tq_session=${value}x`]) {
    assert.ok((await (await site.request("/", { headers: { Cookie: garbage } })).text()).includes('action="/login"'), garbage)
  }
})

test("logout clears the cookie; the per-IP login limiter answers 429 with the page", async () => {
  const site = makeSite({ RATE_LIMIT_LOGINS_PER_MINUTE: "3" })
  const out = await site.request("/logout")
  assert.equal(out.status, 303)
  assert.equal(out.headers.get("Location"), "/")
  assert.equal(out.headers.get("Set-Cookie"), "tq_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax")

  for (let i = 0; i < 3; i += 1) assert.equal((await site.login("nope")).status, 401)
  const limited = await site.login(PASSWORD)
  assert.equal(limited.status, 429, "even the right password waits once the bucket is empty")
  assert.match(limited.headers.get("Retry-After"), /^\d+$/)
  assert.equal(limited.headers.get("Set-Cookie"), null)
  assert.ok((await limited.text()).includes("Too many tries"))
  assert.equal((await site.login(PASSWORD, { headers: { "CF-Connecting-IP": "198.51.100.9" } })).status, 303, "another IP is not affected")
  site.tick(60_000)
  assert.equal((await site.login(PASSWORD)).status, 303, "the bucket refills")
  assert.equal(site.sleeps.filter((ms) => ms === WRONG_PASSWORD_DELAY_MS).length, 3)
})

test("gate off: without ACCESS_PASSWORD the game is open and health says gate:false; a derived signing key still works", async () => {
  const open = makeSite({ ACCESS_PASSWORD: undefined, SESSION_SECRET: undefined })
  assert.equal(await (await open.request("/")).text(), "asset /")
  assert.equal(await (await open.request("/js/main.js")).text(), "asset /js/main.js")
  assert.equal((await open.request("/login")).status, 303, "nothing to log in to")
  assert.equal((await open.request("/logout")).status, 303)
  const health = await (await open.request("/api/health")).json()
  assert.equal(health.gate, false)
  assert.equal(health.configured, true)
  assert.equal(health.session, null)
  assert.equal((await open.request("/api/league")).status, 200, "the API is open too")

  const derived = makeSite({ SESSION_SECRET: undefined })
  assert.ok((await (await derived.request("/")).text()).includes('action="/login"'), "the gate is on with just the password")
  const cookie = cookieFrom(await derived.login(PASSWORD))
  assert.equal(await (await derived.request("/", { headers: { Cookie: cookie } })).text(), "asset /")
  assert.equal((await (await derived.request("/api/health", { headers: { Cookie: cookie } })).json()).session, "derived")
  assert.equal(await verifySession(cookie.split("=")[1], SECRET, T0), false, "a derived key is not the test secret")
})
