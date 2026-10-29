/**
 * Workshop mode on the Worker: sessions, tables, decisions, pitches, approvals, submit, phases, board
 * and read-outs against the in-memory D1 (tests/helpers/fake-d1.mjs runs both migrations). No
 * network, no Cloudflare.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { createSession as createGateSession, loginPage, safeNextPath, sessionCookie } from "../deploy/intake-worker/src/gate.mjs"
import { CODE_ALPHABET, TEAM_COOKIE, hostCodes, normaliseCode, randomInts, sessionCode, signTeamToken, verifyTeamToken } from "../deploy/intake-worker/src/session-auth.mjs"
import { createSessionStore } from "../deploy/intake-worker/src/session-store.mjs"
import { cleanText, isWorkshopPage, rankScores, rewriteWorkshopAsset, statusOf } from "../deploy/intake-worker/src/session.mjs"
import { createHandler, gateConfig } from "../deploy/intake-worker/src/worker.mjs"
import { STATION_IDS, scoreWorkshop } from "../js/workshop/cfd.js"
import { fakeD1 } from "./helpers/fake-d1.mjs"

const ORIGIN = "https://tokenquest.example.workers.dev"
const T0 = Date.parse("2026-11-05T09:00:00.000Z")

const BEST = {
  connectivity: { product: "combo" },
  oems: { design: "nvl72-rack" },
  dcpower: { metro: "lon", cooling: "liquid", power: "block-0" },
  cfd: { gpu: "gb200", size: "small", fabric: "nvlink" },
}
const BEST_SCORE = scoreWorkshop(BEST)
const TRAP = {
  connectivity: { product: "public" },
  oems: { design: "air-node" },
  dcpower: { metro: "par", cooling: "air", power: "block-2" },
  cfd: { gpu: "rtx", size: "large", fabric: "ethernet" },
}

/** A Worker with its own D1 and a frozen clock. */
function site(envOverrides = {}) {
  const logs = []
  const d1 = fakeD1()
  let clock = T0
  const handler = createHandler({ now: () => new Date(clock), log: (line) => logs.push(line), sleep: async () => {} })
  const env = { DB: d1, ...envOverrides }
  const call = async (method, path, { body, headers = {}, ip = "203.0.113.9", raw } = {}) => {
    const init = { method, headers: { "CF-Connecting-IP": ip, ...headers } }
    if (body !== undefined || raw !== undefined) {
      init.headers["Content-Type"] = "application/json"
      init.body = raw ?? JSON.stringify(body)
    }
    const response = await handler.fetch(new Request(`${ORIGIN}${path}`, init), env, { waitUntil() {} })
    const text = await response.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* html */
    }
    return { status: response.status, json, text, headers: response.headers }
  }
  return { handler, d1, env, logs, call, tick: (ms) => (clock += ms), get now() { return clock } }
}

async function createWorkshop(s, name = "Aero workshop") {
  const created = await s.call("POST", "/api/session", { body: { name } })
  assert.equal(created.status, 201, created.text)
  return created.json
}

async function joinTable(s, code, number, teamName, hostName = "Ada") {
  const joined = await s.call("POST", `/api/session/${code}/join`, { body: { number, teamName, hostName } })
  assert.equal(joined.status, 200, joined.text)
  return { team: joined.json.team, token: joined.json.token, headers: { "X-Team-Token": joined.json.token } }
}

/** Decide, pitch and approve one station for a team. */
async function approveStation(s, table, hostCode, station, choices, { sendBackFirst = false } = {}) {
  const put = await s.call("PUT", `/api/team/${table.team.id}/decision/${station}`, { body: { choices }, headers: table.headers })
  assert.equal(put.status, 200, put.text)
  if (sendBackFirst) {
    const pitched = await s.call("POST", `/api/team/${table.team.id}/pitch/${station}`, { body: { pitch: "Because it is cheap." }, headers: table.headers })
    assert.equal(pitched.status, 200, pitched.text)
    const back = await s.call("POST", `/api/team/${table.team.id}/approve/${station}`, { body: { hostCode, verdict: "sent_back", note: "cost" }, headers: table.headers })
    assert.equal(back.status, 200, back.text)
    assert.equal(back.json.decision.status, "sent back")
    const again = await s.call("PUT", `/api/team/${table.team.id}/decision/${station}`, { body: { choices }, headers: table.headers })
    assert.equal(again.json.decision.status, "in progress")
  }
  const pitched = await s.call("POST", `/api/team/${table.team.id}/pitch/${station}`, { body: { pitch: "It gives the engineers real FP64 and keeps the data close." }, headers: table.headers })
  assert.equal(pitched.status, 200, pitched.text)
  assert.equal(pitched.json.decision.status, "pitched")
  const ok = await s.call("POST", `/api/team/${table.team.id}/approve/${station}`, { body: { hostCode, verdict: "approved" }, headers: table.headers })
  assert.equal(ok.status, 200, ok.text)
  assert.equal(ok.json.decision.status, "approved")
  assert.equal(ok.json.decision.locked, true)
  return ok.json.decision
}

// ---------------------------------------------------------------------------------------------
// Codes and tokens
// ---------------------------------------------------------------------------------------------

test("session-auth: codes come from the unambiguous alphabet, host codes are distinct 4-digit, ints are unbiased in range", () => {
  for (let i = 0; i < 50; i += 1) {
    const code = sessionCode()
    assert.match(code, /^[A-Z2-9]{4}$/)
    assert.ok([...code].every((char) => CODE_ALPHABET.includes(char)))
  }
  const codes = hostCodes(10)
  assert.equal(new Set(codes).size, 10)
  for (const code of codes) {
    assert.match(code, /^\d{4}$/)
    assert.doesNotMatch(code, /^(\d)\1+$/)
  }
  const ints = randomInts(500, 7)
  assert.ok(ints.every((n) => Number.isInteger(n) && n >= 0 && n < 7))
  assert.throws(() => randomInts(1, 0), RangeError)
  assert.equal(normaliseCode(" ab cd "), "ABCD")
  assert.equal(normaliseCode("abcde7"), "ABCDE7")
  assert.equal(normaliseCode("ABC"), null, "too short")
  assert.equal(normaliseCode("ABC0"), null, "0 is never in a code")
  assert.equal(normaliseCode("ABCI"), null, "I is never in a code")
  assert.equal(normaliseCode(null), null)
})

test("session-auth: a team token verifies for its team and session, not after expiry, not with another secret, not when tampered", async () => {
  const token = await signTeamToken({ teamId: 7, code: "ABCD" }, "secret-one", { now: T0, maxAgeSeconds: 60 })
  assert.deepEqual(await verifyTeamToken(token, "secret-one", T0 + 1000), { teamId: 7, code: "ABCD", expiry: T0 + 60_000 })
  assert.equal(await verifyTeamToken(token, "secret-one", T0 + 61_000), null, "expired")
  assert.equal(await verifyTeamToken(token, "secret-two", T0), null, "other secret")
  const [payload, signature] = token.split(".")
  assert.equal(await verifyTeamToken(`${payload}.${signature.slice(0, -2)}AA`, "secret-one", T0), null, "tampered signature")
  assert.equal(await verifyTeamToken(`${payload}x.${signature}`, "secret-one", T0), null, "tampered payload")
  assert.equal(await verifyTeamToken("nope", "secret-one", T0), null)
  assert.equal(await verifyTeamToken(42, "secret-one", T0), null)
})

test("session.mjs helpers: cleanText, statusOf, rankScores, the board page rewrite", () => {
  assert.equal(cleanText("  Red\u0000  Bulls \n racing  ", 40), "Red Bulls racing")
  assert.equal(cleanText("x".repeat(100), 10), "xxxxxxxxxx")
  assert.equal(cleanText(42, 10), "")
  assert.equal(statusOf(null), "not started")
  assert.equal(statusOf({ choices: { a: 1 } }), "in progress")
  assert.equal(statusOf({ choices: { a: 1 }, pitchedAt: "t" }), "pitched")
  assert.equal(statusOf({ choices: { a: 1 }, pitchedAt: "t", approval: "approved" }), "approved")
  assert.equal(statusOf({ choices: { a: 1 }, pitchedAt: "t", approval: "sent_back" }), "sent back")
  assert.deepEqual(
    rankScores([
      { teamId: 1, score: 900 },
      { teamId: 2, score: 1400 },
      { teamId: 3, score: 900 },
      { teamId: 4, score: 100 },
    ]),
    [
      { teamId: 2, rank: 1 },
      { teamId: 1, rank: 2 },
      { teamId: 3, rank: 2 },
      { teamId: 4, rank: 4 },
    ],
  )
  const url = new URL(`${ORIGIN}/board/ABCD`)
  const rewritten = rewriteWorkshopAsset(new Request(url, { headers: { Cookie: "tq_session=x" } }), url)
  assert.equal(rewritten.url, `${ORIGIN}/assets/workshop/board.html`)
  assert.equal(rewritten.headers.get("Cookie"), "tq_session=x")
  const join = new URL(`${ORIGIN}/workshop?code=ABCD`)
  assert.equal(rewriteWorkshopAsset(new Request(join), join).url, `${ORIGIN}/assets/workshop/workshop.html`)
  const host = new URL(`${ORIGIN}/host/`)
  assert.equal(rewriteWorkshopAsset(new Request(host), host).url, `${ORIGIN}/assets/workshop/host.html`)
  const other = new URL(`${ORIGIN}/js/workshop/app.js`)
  const same = new Request(other)
  assert.equal(rewriteWorkshopAsset(same, other), same)
  const post = new Request(url, { method: "POST" })
  assert.equal(rewriteWorkshopAsset(post, url), post)
  for (const page of ["/workshop", "/workshop.html", "/host", "/host/", "/board/ABCD", "/board/abcd23/"]) assert.equal(isWorkshopPage(page), true, page)
  for (const page of ["/", "/index.html", "/staff", "/board", "/board/ABC", "/board/ABCD/x", "/workshops", "/js/workshop/app.js"]) assert.equal(isWorkshopPage(page), false, page)
})

test("gate: safeNextPath keeps same-origin paths and refuses everything else; the login form carries next", async () => {
  assert.equal(safeNextPath("/workshop?code=ABCD"), "/workshop?code=ABCD")
  assert.equal(safeNextPath("/board/ABCD"), "/board/ABCD")
  assert.equal(safeNextPath("/"), "/")
  assert.equal(safeNextPath("//evil.example/x"), "/")
  assert.equal(safeNextPath("/\\evil.example"), "/")
  assert.equal(safeNextPath("https://evil.example/"), "/")
  assert.equal(safeNextPath("/a b"), "/")
  assert.equal(safeNextPath("/a\nb"), "/")
  assert.equal(safeNextPath(`/${"a".repeat(300)}`), "/")
  assert.equal(safeNextPath(null), "/")
  assert.ok(loginPage({ next: "/workshop?code=ABCD" }).includes('action="/login?next=%2Fworkshop%3Fcode%3DABCD"'))
  assert.ok(loginPage().includes('action="/login"'))
  assert.ok(loginPage({ next: "//evil.example" }).includes('action="/login"'))
})

// ---------------------------------------------------------------------------------------------
// The store on the real migration
// ---------------------------------------------------------------------------------------------

test("session-store: create, join, decide, pitch, judge, re-open, read-outs and ranks on the migrated tables", async () => {
  const d1 = fakeD1()
  const store = createSessionStore({ db: d1 })
  const now = new Date(T0).toISOString()
  assert.equal(await store.sessionExists("ABCD"), false)
  const session = await store.createSession({ code: "ABCD", name: "Test", pin: "123456", createdAt: now, teams: [{ number: 1, hostCode: "4242" }, { number: 2, hostCode: "9876" }] })
  assert.deepEqual([session.code, session.phase, session.phaseStartedAt, session.briefMinutes, session.buildMinutes, session.readoutMinutes, session.facilitatorPin], ["ABCD", "brief", null, 5, 36, 9, "123456"])
  assert.equal(await store.sessionExists("ABCD"), true)
  const teams = await store.listTeams("ABCD")
  assert.deepEqual(teams.map((team) => [team.number, team.hostCode, team.name, team.joinedAt]), [[1, "4242", null, null], [2, "9876", null, null]])
  const joined = await store.joinTeam(teams[0].id, { name: "Red", hostName: "Ada", joinedAt: now })
  assert.deepEqual([joined.name, joined.hostName, joined.joinedAt], ["Red", "Ada", now])
  assert.equal((await store.getTeamByNumber("ABCD", 2)).id, teams[1].id)

  let decision = await store.saveDecision(joined.id, "cfd", BEST.cfd, now)
  assert.deepEqual([decision.station, decision.choices, decision.approval, decision.attempts, decision.sendBacks], ["cfd", BEST.cfd, null, 0, 0])
  decision = await store.pitchDecision(joined.id, "cfd", "Because FP64.", now)
  assert.deepEqual([decision.pitch, decision.pitchedAt, decision.attempts], ["Because FP64.", now, 1])
  decision = await store.judgeDecision(joined.id, "cfd", { approval: "sent_back", note: "cost", at: now })
  assert.deepEqual([decision.approval, decision.hostNote, decision.sendBacks, decision.approvedAt], ["sent_back", "cost", 1, null])
  decision = await store.saveDecision(joined.id, "cfd", { ...BEST.cfd, size: "medium" }, now)
  assert.deepEqual([decision.approval, decision.pitchedAt, decision.sendBacks, decision.choices.size], [null, null, 1, "medium"], "editing after a send-back clears the verdict and keeps the count")
  decision = await store.pitchDecision(joined.id, "cfd", "Medium then.", now)
  decision = await store.judgeDecision(joined.id, "cfd", { approval: "approved", note: null, at: now })
  assert.deepEqual([decision.approval, decision.approvedAt, decision.attempts], ["approved", now, 2])
  decision = await store.reopenDecision(joined.id, "cfd", now)
  assert.deepEqual([decision.approval, decision.approvedAt, decision.pitchedAt], [null, null, null])
  assert.equal((await store.listSessionDecisions("ABCD")).length, 1)

  await store.saveReadout(joined.id, { score: 1234, rank: null, wentWell: ["a"], doDifferently: ["b"], detail: { x: 1 }, createdAt: now })
  await store.saveReadout(joined.id, { score: 1300, rank: null, wentWell: ["a2"], doDifferently: ["b2"], detail: null, createdAt: now })
  const readout = await store.getReadout(joined.id)
  assert.deepEqual([readout.score, readout.rank, readout.wentWell, readout.doDifferently, readout.detail], [1300, null, ["a2"], ["b2"], null], "a second save replaces the first")
  await store.setRanks([{ teamId: joined.id, rank: 1 }])
  assert.equal((await store.getReadout(joined.id)).rank, 1)
  assert.equal((await store.listReadouts("ABCD")).length, 1)
  const updated = await store.updateSession("ABCD", { phase: "build", phaseStartedAt: now, startedAt: now, buildMinutes: 40 })
  assert.deepEqual([updated.phase, updated.phaseStartedAt, updated.buildMinutes], ["build", now, 40])
  assert.equal(await store.countSessions(), 1)
  await store.deleteSession("ABCD")
  assert.equal(await store.getSession("ABCD"), null)
  assert.equal((await store.listTeams("ABCD")).length, 0)
  assert.equal(await store.getReadout(joined.id), null)

  d1.state.fail = new Error("D1_ERROR: no such table: sessions: SQLITE_ERROR")
  await assert.rejects(store.getSession("ABCD"), (error) => error.name === "StoreUnavailableError" && /workshop tables .* do not exist yet: run `npx wrangler d1 migrations apply/.test(error.message))
})

// ---------------------------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------------------------

test("API: creating a session gives a code, ten tables with host codes, a PIN and the URLs; the state is a lobby", async () => {
  const s = site()
  const created = await createWorkshop(s)
  assert.match(created.session.code, /^[A-Z2-9]{4}$/)
  assert.match(created.pin, /^\d{6}$/)
  assert.equal(created.hostCodes.length, 10)
  assert.equal(new Set(created.hostCodes.map((row) => row.hostCode)).size, 10)
  assert.deepEqual(created.hostCodes.map((row) => row.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(created.joinUrl, `${ORIGIN}/workshop?code=${created.session.code}`)
  assert.equal(created.boardUrl, `${ORIGIN}/board/${created.session.code}`)
  assert.equal(created.session.name, "Aero workshop")
  assert.deepEqual([created.session.phase, created.session.timer.label, created.session.timer.started, created.session.timer.remainingS, created.session.timer.totalMinutes], ["brief", "LOBBY", false, 300, 50])
  assert.deepEqual(created.session.nextAction, { action: "start_brief", label: "START 5-MIN BRIEF" })
  assert.ok(created.teams.every((team) => team.joined === false && Object.values(team.stations).every((status) => status === "not started")))
  assert.ok(!JSON.stringify(created).includes("@"), "no email addresses anywhere in workshop mode")

  const state = await s.call("GET", `/api/session/${created.session.code.toLowerCase()}`)
  assert.equal(state.status, 200, "codes are case-insensitive")
  assert.equal(state.json.teams.length, 10)
  assert.deepEqual(state.json.progress, { joined: 0, submitted: 0, approved: 0, of: 0 })
  assert.ok(!("hostCodes" in state.json) && !("pin" in state.json) && !JSON.stringify(state.json).includes(created.pin), "the state never leaks codes")
  assert.equal((await s.call("GET", "/api/session/ZZZZ")).json.error, "no_session")
  assert.equal((await s.call("GET", "/api/session/0OIL")).json.error, "no_session")
  assert.equal((await s.call("GET", "/api/session")).status, 405)
  const empty = await s.call("POST", "/api/session", { body: {} })
  assert.equal(empty.json.session.name, "Workshop")
  assert.ok(s.logs.some((line) => /workshop session created/.test(line)) && !s.logs.some((line) => line.includes(created.session.code)), "logs never carry the code")
})

test("API: joining a table hands out a token and a cookie; numbers, names and takeovers are checked", async () => {
  const s = site()
  const created = await createWorkshop(s)
  const code = created.session.code
  const joined = await s.call("POST", `/api/session/${code}/join`, { body: { number: 3, teamName: "  Downforce  Dynamos ", hostName: "Grace" } })
  assert.equal(joined.status, 200, joined.text)
  assert.deepEqual([joined.json.team.number, joined.json.team.name, joined.json.team.hostName, joined.json.team.joined], [3, "Downforce Dynamos", "Grace", true])
  assert.match(joined.json.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assert.match(joined.headers.get("Set-Cookie"), new RegExp(`^${TEAM_COOKIE}=${joined.json.token.replace(/[-]/g, "\\-")}; Max-Age=28800; Path=/api/team; HttpOnly; Secure; SameSite=Lax$`))
  const claims = await verifyTeamToken(joined.json.token, gateConfig(s.env).secret, s.now)
  assert.deepEqual([claims.teamId, claims.code], [joined.json.team.id, code])

  assert.equal((await s.call("POST", `/api/session/${code}/join`, { body: { number: 0, teamName: "x", hostName: "y" } })).json.error, "invalid_team")
  assert.equal((await s.call("POST", `/api/session/${code}/join`, { body: { number: 11, teamName: "x", hostName: "y" } })).json.error, "invalid_team")
  assert.equal((await s.call("POST", `/api/session/${code}/join`, { body: { number: 2, teamName: "", hostName: "y" } })).json.error, "invalid_team_name")
  assert.equal((await s.call("POST", `/api/session/${code}/join`, { body: { number: 2, teamName: "x", hostName: " " } })).json.error, "invalid_host_name")
  const taken = await s.call("POST", `/api/session/${code}/join`, { body: { number: 3, teamName: "Other Team", hostName: "Bob" } })
  assert.equal(taken.status, 409)
  assert.equal(taken.json.error, "team_taken")
  const rejoin = await s.call("POST", `/api/session/${code}/join`, { body: { number: 3, teamName: "downforce dynamos", hostName: "Grace" } })
  assert.equal(rejoin.status, 200, "the same team name re-joins (an iPad that lost its token)")
  assert.equal(rejoin.json.team.id, joined.json.team.id)
  assert.equal((await s.call("POST", `/api/session/ZZZZ/join`, { body: { number: 1, teamName: "x", hostName: "y" } })).status, 404)
  assert.equal((await s.call("POST", `/api/session/${code}/join`, { raw: "{not json" })).json.error, "bad_json")
  const state = await s.call("GET", `/api/session/${code}`)
  assert.equal(state.json.progress.joined, 1)
  assert.equal(state.json.teams[2].hostName, "Grace")
})

test("API: team routes need the team's own token; decisions validate, pitch, approve, send back, lock and re-open", async () => {
  const s = site()
  const created = await createWorkshop(s)
  const code = created.session.code
  const t1 = await joinTable(s, code, 1, "Red", "Ada")
  const t2 = await joinTable(s, code, 2, "Blue", "Bob")
  const host1 = created.hostCodes.find((row) => row.number === 1).hostCode
  const host2 = created.hostCodes.find((row) => row.number === 2).hostCode

  assert.equal((await s.call("GET", `/api/team/${t1.team.id}`)).json.error, "team_token", "no token")
  assert.equal((await s.call("GET", `/api/team/${t1.team.id}`, { headers: t2.headers })).json.error, "team_token", "another team's token")
  assert.equal((await s.call("GET", `/api/team/${t1.team.id}`, { headers: { Cookie: `${TEAM_COOKIE}=${t1.token}` } })).status, 200, "the cookie works too")
  assert.equal((await s.call("GET", `/api/team/999`, { headers: t1.headers })).json.error, "no_team")
  const mine = await s.call("GET", `/api/team/${t1.team.id}`, { headers: t1.headers })
  assert.deepEqual(Object.keys(mine.json.decisions), STATION_IDS)
  assert.ok(Object.values(mine.json.decisions).every((decision) => decision === null))
  assert.equal(mine.json.canSubmit, false)
  assert.equal(mine.json.readout, null)
  assert.equal(mine.json.session.code, code)

  assert.equal((await s.call("GET", `/api/team/${t1.team.id}/decision/qpu`, { headers: t1.headers })).json.error, "no_station")
  const bad = await s.call("PUT", `/api/team/${t1.team.id}/decision/cfd`, { body: { choices: { gpu: "gb200", size: "huge", fabric: "nvlink", extra: 1 } }, headers: t1.headers })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error, "invalid_choices")
  assert.ok(bad.json.details.some((line) => line.startsWith("size:")) && bad.json.details.some((line) => line.startsWith("extra")))
  assert.equal((await s.call("PUT", `/api/team/${t1.team.id}/decision/cfd`, { body: { choices: "gb200" }, headers: t1.headers })).json.error, "invalid_choices")

  const saved = await s.call("PUT", `/api/team/${t1.team.id}/decision/cfd`, { body: { choices: BEST.cfd }, headers: t1.headers })
  assert.equal(saved.status, 200, saved.text)
  assert.deepEqual([saved.json.decision.status, saved.json.decision.choices, saved.json.decision.locked], ["in progress", BEST.cfd, false])
  assert.equal((await s.call("GET", `/api/team/${t1.team.id}/decision/cfd`, { headers: t1.headers })).json.decision.status, "in progress")

  assert.equal((await s.call("POST", `/api/team/${t1.team.id}/pitch/oems`, { body: { pitch: "Nothing chosen yet" }, headers: t1.headers })).json.error, "no_decision")
  assert.equal((await s.call("POST", `/api/team/${t1.team.id}/pitch/cfd`, { body: { pitch: "no" }, headers: t1.headers })).json.error, "invalid_pitch")
  assert.equal((await s.call("POST", `/api/team/${t1.team.id}/approve/cfd`, { body: { hostCode: host1, verdict: "approved" }, headers: t1.headers })).json.error, "not_pitched")
  const pitched = await s.call("POST", `/api/team/${t1.team.id}/pitch/cfd`, { body: { pitch: "One rack of GB200 gives 3 PFLOPS of FP64 inside the budget." }, headers: t1.headers })
  assert.deepEqual([pitched.json.decision.status, pitched.json.decision.attempts], ["pitched", 1])

  const wrong = await s.call("POST", `/api/team/${t1.team.id}/approve/cfd`, { body: { hostCode: host2, verdict: "approved" }, headers: t1.headers })
  assert.equal(wrong.status, 403)
  assert.equal(wrong.json.error, "wrong_host_code", "another table's host code does not approve this table")
  assert.equal((await s.call("POST", `/api/team/${t1.team.id}/approve/cfd`, { body: { hostCode: "12", verdict: "approved" }, headers: t1.headers })).json.error, "wrong_host_code")
  assert.equal((await s.call("POST", `/api/team/${t1.team.id}/approve/cfd`, { body: { hostCode: host1, verdict: "maybe" }, headers: t1.headers })).json.error, "invalid_verdict")
  assert.equal((await s.call("POST", `/api/team/${t1.team.id}/approve/cfd`, { body: { hostCode: host1, verdict: "sent_back" }, headers: t1.headers })).json.error, "invalid_note")
  const back = await s.call("POST", `/api/team/${t1.team.id}/approve/cfd`, { body: { hostCode: host1, verdict: "sent_back", note: "power" }, headers: t1.headers })
  assert.deepEqual([back.json.decision.status, back.json.decision.sendBacks, back.json.decision.hostNote], ["sent back", 1, "power"])
  assert.equal((await s.call("POST", `/api/team/${t1.team.id}/approve/cfd`, { body: { hostCode: host1, verdict: "approved" }, headers: t1.headers })).json.error, "not_pitched", "a sent-back station must be pitched again")
  const edited = await s.call("PUT", `/api/team/${t1.team.id}/decision/cfd`, { body: { choices: { ...BEST.cfd, size: "medium" } }, headers: t1.headers })
  assert.deepEqual([edited.json.decision.status, edited.json.decision.sendBacks], ["in progress", 1])
  await s.call("POST", `/api/team/${t1.team.id}/pitch/cfd`, { body: { pitch: "Two racks then, still inside the budget." }, headers: t1.headers })
  const approved = await s.call("POST", `/api/team/${t1.team.id}/approve/cfd`, { body: { hostCode: host1, verdict: "approved" }, headers: t1.headers })
  assert.deepEqual([approved.json.decision.status, approved.json.decision.locked, approved.json.decision.attempts, approved.json.decision.sendBacks], ["approved", true, 2, 1])
  assert.equal((await s.call("PUT", `/api/team/${t1.team.id}/decision/cfd`, { body: { choices: BEST.cfd }, headers: t1.headers })).json.error, "approved_locked")
  assert.equal((await s.call("POST", `/api/team/${t1.team.id}/pitch/cfd`, { body: { pitch: "Again?" }, headers: t1.headers })).json.error, "approved_locked")
  assert.equal((await s.call("POST", `/api/team/${t1.team.id}/approve/oems`, { body: { hostCode: host1, verdict: "reopen" }, headers: t1.headers })).json.error, "no_decision")
  const reopened = await s.call("POST", `/api/team/${t1.team.id}/approve/cfd`, { body: { hostCode: host1, verdict: "reopen" }, headers: t1.headers })
  assert.deepEqual([reopened.json.decision.status, reopened.json.decision.locked, reopened.json.decision.sendBacks], ["in progress", false, 1])
  assert.equal((await s.call("POST", `/api/team/${t1.team.id}/approve/cfd`, { body: { hostCode: host1, verdict: "reopen" }, headers: t1.headers })).json.error, "not_approved")

  const state = await s.call("GET", `/api/session/${code}`)
  const row = state.json.teams.find((team) => team.number === 1)
  assert.deepEqual([row.stations.cfd, row.sendBacks, row.approved], ["in progress", 1, 0])
  assert.ok(!s.logs.some((line) => line.includes(host1) || line.includes(host2)), "host codes are never logged")
})

test("API: submit needs four approvals; the facilitator runs the phases with the PIN; scores and ranks come out at the read-out", async () => {
  const s = site()
  const created = await createWorkshop(s)
  const code = created.session.code
  const pin = created.pin
  const hostOf = (n) => created.hostCodes.find((row) => row.number === n).hostCode
  const red = await joinTable(s, code, 1, "Red", "Ada")
  const blue = await joinTable(s, code, 2, "Blue", "Bob")
  const green = await joinTable(s, code, 3, "Green", "Cy")

  assert.equal((await s.call("POST", `/api/team/${red.team.id}/submit`, { headers: red.headers })).json.error, "not_approved")
  for (const station of STATION_IDS) await approveStation(s, red, hostOf(1), station, BEST[station])
  const mine = await s.call("GET", `/api/team/${red.team.id}`, { headers: red.headers })
  assert.equal(mine.json.canSubmit, true)
  assert.equal(mine.json.team.approved, 4)
  const submitted = await s.call("POST", `/api/team/${red.team.id}/submit`, { headers: red.headers })
  assert.equal(submitted.status, 200, submitted.text)
  assert.deepEqual([submitted.json.scored, submitted.json.team.submitted, "score" in submitted.json], [true, true, false], "the score is not shown to the table at submit")
  assert.equal((await s.call("POST", `/api/team/${red.team.id}/submit`, { headers: red.headers })).json.error, "already_submitted")
  assert.equal((await s.call("GET", `/api/team/${red.team.id}/readout`, { headers: red.headers })).json.error, "not_yet")
  assert.equal((await s.call("GET", `/api/team/${red.team.id}`, { headers: red.headers })).json.readout, null, "the iPad does not see the read-out before the phase")

  /* Blue walks into the trap (and is sent back once at OEMs); Green decides two stations and never pitches. */
  for (const station of STATION_IDS) await approveStation(s, blue, hostOf(2), station, TRAP[station], { sendBackFirst: station === "oems" })
  await s.call("POST", `/api/team/${blue.team.id}/submit`, { headers: blue.headers })
  await s.call("PUT", `/api/team/${green.team.id}/decision/cfd`, { body: { choices: BEST.cfd }, headers: green.headers })
  await s.call("PUT", `/api/team/${green.team.id}/decision/oems`, { body: { choices: BEST.oems }, headers: green.headers })

  /* The board before the read-out: progress, no scores. */
  let board = await s.call("GET", `/api/session/${code}/board`)
  assert.equal(board.json.released, false)
  assert.deepEqual(board.json.teams.map((team) => [team.number, team.approved, team.submitted, team.score]), [[1, 4, true, null], [2, 4, true, null], [3, 0, false, null]])
  /* The facilitator (PIN header) sees scores as they come in. */
  const facilitatorView = await s.call("GET", `/api/session/${code}`, { headers: { "X-Facilitator-Pin": pin } })
  assert.equal(facilitatorView.json.teams[0].score, BEST_SCORE)
  assert.equal((await s.call("GET", `/api/session/${code}`)).json.teams[0].score, null)

  /* Phases. */
  assert.equal((await s.call("POST", `/api/session/${code}/phase`, { body: { pin: "000000", action: "start_brief" } })).json.error, "wrong_pin")
  assert.equal((await s.call("POST", `/api/session/${code}/phase`, { body: { pin, action: "end" } })).json.error, "bad_action")
  assert.equal((await s.call("POST", `/api/session/${code}/phase`, { body: { pin, action: "adjust", deltaMinutes: 1 } })).json.error, "bad_action", "no adjusting in the lobby")
  const brief = await s.call("POST", `/api/session/${code}/phase`, { body: { pin, action: "start_brief" } })
  assert.equal(brief.status, 200, brief.text)
  assert.deepEqual([brief.json.session.phase, brief.json.session.timer.started, brief.json.session.timer.remainingS, brief.json.session.timer.label], ["brief", true, 300, "BRIEF"])
  assert.equal(brief.json.session.phaseStartedAt, new Date(T0).toISOString())
  s.tick(60_000)
  let state = await s.call("GET", `/api/session/${code}`)
  assert.equal(state.json.session.timer.remainingS, 240)
  assert.equal(state.json.serverNow, new Date(T0 + 60_000).toISOString())
  const longer = await s.call("POST", `/api/session/${code}/phase`, { body: { pin, action: "adjust", deltaMinutes: 2 } })
  assert.deepEqual([longer.json.session.briefMinutes, longer.json.session.timer.remainingS, longer.json.session.timer.totalMinutes], [7, 360, 52])
  assert.equal((await s.call("POST", `/api/session/${code}/phase`, { body: { pin, action: "adjust", deltaMinutes: 0 } })).json.error, "invalid_action")
  assert.equal((await s.call("POST", `/api/session/${code}/phase`, { body: { pin, action: "start_brief" } })).json.error, "bad_action", "the brief cannot start twice")
  const build = await s.call("POST", `/api/session/${code}/phase`, { body: { pin, action: "start_build" } })
  assert.deepEqual([build.json.session.phase, build.json.session.timer.remainingS, build.json.session.nextAction.action], ["build", 36 * 60, "start_readout"])
  s.tick(37 * 60_000)
  state = await s.call("GET", `/api/session/${code}`)
  assert.deepEqual([state.json.session.timer.remainingS, state.json.session.timer.overrunS], [0, 60], "an overrun counts up, the clients show 00:00")

  const readout = await s.call("POST", `/api/session/${code}/phase`, { body: { pin, action: "start_readout" } })
  assert.equal(readout.status, 200, readout.text)
  assert.deepEqual([readout.json.session.phase, readout.json.scored], ["readout", 3], "every joined table is scored, submitted or not")
  assert.equal((await s.call("PUT", `/api/team/${green.team.id}/decision/cfd`, { body: { choices: BEST.cfd }, headers: green.headers })).json.error, "locked_phase")
  assert.equal((await s.call("POST", `/api/team/${green.team.id}/submit`, { headers: green.headers })).json.error, "locked_phase")

  const redOut = await s.call("GET", `/api/team/${red.team.id}/readout`, { headers: red.headers })
  assert.equal(redOut.status, 200, redOut.text)
  assert.deepEqual([redOut.json.readout.score, redOut.json.readout.rank, redOut.json.readout.teams], [BEST_SCORE, 1, 3])
  assert.equal(redOut.json.readout.wentWell.length, 3)
  assert.ok(redOut.json.readout.wentWell.some((line) => /Approved first time at all four stations/.test(line)), redOut.json.readout.wentWell.join(" | "))
  assert.deepEqual(redOut.json.readout.doDifferently, ["Nothing beats this build at any one station: every alternative we tried scored lower."])
  assert.deepEqual(redOut.json.readout.architectNotes, [])
  assert.match(redOut.json.readout.closing, /300\+ data centers in 50\+ metros/)
  assert.match(redOut.json.readout.summary, /61\.6 runs a night/)
  const blueOut = await s.call("GET", `/api/team/${blue.team.id}/readout`, { headers: blue.headers })
  assert.ok(blueOut.json.readout.score < 300, `the inference trap scores low: ${blueOut.json.readout.score}`)
  assert.ok(blueOut.json.readout.wentWell.some((line) => /Approved first time at 3 of 4/.test(line)), blueOut.json.readout.wentWell.join(" | "))
  assert.ok(blueOut.json.readout.doDifferently.some((line) => /CFD SUPERCOMPUTER/.test(line) && /\+\d+/.test(line)), blueOut.json.readout.doDifferently.join(" | "))
  assert.deepEqual(blueOut.json.readout.architectNotes, ["OEMs: sent back once (cost)."])
  assert.equal((await s.call("GET", `/api/session/${code}`)).json.teams[1].sendBacks, 1)
  const greenOut = await s.call("GET", `/api/team/${green.team.id}/readout`, { headers: green.headers })
  assert.ok(greenOut.json.readout.doDifferently[0].includes("never saved a choice at CONNECTIVITY and DATACENTER & POWER"), greenOut.json.readout.doDifferently[0])
  assert.deepEqual([redOut.json.readout.rank, greenOut.json.readout.rank, blueOut.json.readout.rank].sort(), [1, 2, 3])
  const teamState = await s.call("GET", `/api/team/${red.team.id}`, { headers: red.headers })
  assert.equal(teamState.json.readout.score, BEST_SCORE, "the iPad's own state carries the read-out once released")

  board = await s.call("GET", `/api/session/${code}/board`)
  assert.equal(board.json.released, true)
  assert.deepEqual(board.json.teams.map((team) => [team.name, team.rank]), [["Red", 1], ["Green", 2], ["Blue", 3]])
  assert.ok(board.json.teams[0].score >= board.json.teams[1].score && board.json.teams[1].score >= board.json.teams[2].score)
  assert.ok(!JSON.stringify(board.json).includes("@") && !JSON.stringify(board.json).includes(pin) && !JSON.stringify(board.json).includes(hostOf(1)))

  const ended = await s.call("POST", `/api/session/${code}/phase`, { body: { pin, action: "end" } })
  assert.deepEqual([ended.json.session.phase, ended.json.session.nextAction, ended.json.session.timer.label], ["done", null, "DONE"])
  assert.equal((await s.call("POST", `/api/session/${code}/join`, { body: { number: 4, teamName: "Late", hostName: "Zed" } })).json.error, "session_over")
  const hosts = await s.call("POST", `/api/session/${code}/hosts`, { body: { pin } })
  assert.deepEqual(hosts.json.hostCodes.map((row) => row.hostCode), created.hostCodes.map((row) => row.hostCode))
  assert.equal(hosts.json.hostCodes[0].name, "Red")
  assert.equal((await s.call("POST", `/api/session/${code}/hosts`, { body: { pin: "999999" } })).status, 403)

  assert.equal((await s.call("DELETE", `/api/session/${code}`, { headers: { "X-Facilitator-Pin": "111111" } })).status, 403)
  const deleted = await s.call("DELETE", `/api/session/${code}`, { headers: { "X-Facilitator-Pin": pin } })
  assert.equal(deleted.status, 200, deleted.text)
  assert.equal((await s.call("GET", `/api/session/${code}`)).status, 404)
  assert.equal((await s.call("GET", `/api/team/${red.team.id}`, { headers: red.headers })).status, 404)
  assert.ok(!s.logs.some((line) => line.includes(pin)), "the PIN is never logged")
})

test("API: workshop writes and reads have their own rate buckets; the database being away is a 503 the iPads can retry", async () => {
  const s = site({ RATE_LIMIT_WORKSHOP_WRITES_PER_MINUTE: "2", RATE_LIMIT_WORKSHOP_PER_MINUTE: "3" })
  const created = await createWorkshop(s)
  const code = created.session.code
  const second = await s.call("POST", `/api/session/${code}/join`, { body: { number: 1, teamName: "A", hostName: "B" } })
  assert.equal(second.status, 200)
  const third = await s.call("POST", `/api/session/${code}/join`, { body: { number: 2, teamName: "C", hostName: "D" } })
  assert.equal(third.status, 429)
  assert.equal(third.json.error, "rate_limited")
  assert.ok(third.headers.get("Retry-After"))
  assert.equal((await s.call("POST", `/api/session/${code}/join`, { body: { number: 2, teamName: "C", hostName: "D" }, ip: "198.51.100.4" })).status, 200, "another IP has its own bucket")
  for (let i = 0; i < 3; i += 1) assert.equal((await s.call("GET", `/api/session/${code}`)).status, 200)
  assert.equal((await s.call("GET", `/api/session/${code}`)).status, 429, "the read bucket is separate")
  s.tick(60_000)
  assert.equal((await s.call("GET", `/api/session/${code}`)).status, 200)

  s.d1.state.fail = new Error("D1_ERROR: database is locked")
  const down = await s.call("GET", `/api/session/${code}`)
  assert.equal(down.status, 503)
  assert.equal(down.json.error, "store_unavailable")
  s.d1.state.fail = null
  const unbound = site({})
  unbound.env.DB = undefined
  assert.equal((await unbound.call("POST", "/api/session", { body: { name: "x" } })).json.error, "not_configured")
})

test("API: behind the team-password gate the workshop needs the cookie; the login page sends the iPad back to its join URL", async () => {
  const s = site({ ACCESS_PASSWORD: "open-sesame", SESSION_SECRET: "a-long-random-signing-secret" })
  const anonymous = await s.call("POST", "/api/session", { body: { name: "x" } })
  assert.equal(anonymous.status, 401)
  assert.equal(anonymous.json.error, "unauthorised")
  const page = await s.call("GET", "/workshop?code=ABCD")
  assert.equal(page.status, 200)
  assert.ok(page.text.includes('action="/login?next=%2Fworkshop%3Fcode%3DABCD"'), "the login form remembers the join URL")
  const evil = await s.call("GET", "/board/ABCD?x=//evil")
  assert.ok(evil.text.includes("next=%2Fboard%2FABCD%3Fx%3D%2F%2Fevil"), "a same-origin path with a query is kept as a path")
  assert.ok((await s.call("GET", "/?code=ABCD")).text.includes('action="/login"'), "the kiosk game's login page is unchanged")
  assert.ok((await s.call("GET", "/staff")).text.includes('action="/login"'))
  const login = await s.handler.fetch(new Request(`${ORIGIN}/login?next=%2Fworkshop%3Fcode%3DABCD`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "203.0.113.1" }, body: "password=open-sesame" }), s.env, {})
  assert.equal(login.status, 303)
  assert.equal(login.headers.get("Location"), "/workshop?code=ABCD")
  const badNext = await s.handler.fetch(new Request(`${ORIGIN}/login?next=//evil.example`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "203.0.113.1" }, body: "password=open-sesame" }), s.env, {})
  assert.equal(badNext.headers.get("Location"), "/", "an off-site next goes home")
  const cookie = sessionCookie(await createGateSession(gateConfig(s.env).secret, { now: s.now })).split(";")[0]
  const created = await s.call("POST", "/api/session", { body: { name: "Gated" }, headers: { Cookie: cookie } })
  assert.equal(created.status, 201, created.text)
  const joined = await s.call("POST", `/api/session/${created.json.session.code}/join`, { body: { number: 1, teamName: "Red", hostName: "Ada" }, headers: { Cookie: cookie } })
  assert.equal(joined.status, 200)
  const mine = await s.call("GET", `/api/team/${joined.json.team.id}`, { headers: { Cookie: `${cookie}; ${TEAM_COOKIE}=${joined.json.token}` } })
  assert.equal(mine.status, 200, "team cookie plus session cookie")
  assert.equal((await s.call("GET", `/api/team/${joined.json.team.id}`, { headers: { Cookie: `${TEAM_COOKIE}=${joined.json.token}` } })).status, 401, "the team token alone does not pass the gate")
})
