/** HTTP server: static kiosk files plus the small JSON API. See HOSTING.md for the contract. */
import { createHash, timingSafeEqual } from "node:crypto"
import { realpath } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { Exporter, buildWorkbook } from "./export.mjs"
import { mergeLeague } from "./merge.mjs"
import { aggregatePlayers, findPlayer, publicLeague } from "./players.mjs"
import { createStaticHandler } from "./static.mjs"
import { AttemptStore, archiveStamp, attemptKey } from "./store.mjs"
import { createUpstream, disabledUpstream } from "./upstream.mjs"
import { validateAttempt } from "./validate.mjs"
import { XLSX_MIME } from "./xlsx.mjs"

const BODY_LIMIT = 64 * 1024
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])
/** How long POST /api/attempt waits for the team server before answering with what it knows (the browser gives up at 6 s). */
export const FORWARD_WAIT_MS = 3000

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Content-Length", Buffer.byteLength(body))
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.end(body)
}

/**
 * The path exactly as sent, without query string and deliberately without URL normalisation,
 * so "/../x" is refused rather than quietly rewritten to "/x". Returns null when malformed.
 */
function rawPathname(url) {
  if (typeof url !== "string" || !url.startsWith("/")) return null
  const end = url.search(/[?#]/)
  return end === -1 ? url : url.slice(0, end)
}

function isLoopback(address) {
  return LOOPBACK_ADDRESSES.has(String(address || ""))
}

function digest(text) {
  return createHash("sha256").update(String(text), "utf8").digest()
}

function pinMatches(given, expected) {
  return typeof given === "string" && timingSafeEqual(digest(given), digest(expected))
}

/** Browsers send Origin / Sec-Fetch-Site; reject anything that is clearly another site. */
function sameOrigin(req) {
  const site = req.headers["sec-fetch-site"]
  if (site && site !== "same-origin" && site !== "none") return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  if (origin === "null") return false
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function readJson(req) {
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase()
  if (type !== "application/json") throw new HttpError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.")
  const declared = Number(req.headers["content-length"])
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new HttpError(413, "too_large", `Body must be at most ${BODY_LIMIT} bytes.`)
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new HttpError(413, "too_large", `Body must be at most ${BODY_LIMIT} bytes.`)
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  if (!text.trim()) throw new HttpError(400, "empty_body", "Request body is empty.")
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, "bad_json", "Request body is not valid JSON.")
  }
}

export function createApp(config, { store, exporter, upstream = null, forwardWaitMs = FORWARD_WAIT_MS, log = () => {} }) {
  const serveStatic = createStaticHandler({ root: config.root, deny: [config.dataDir] })
  const team = upstream ?? disabledUpstream()

  /** This laptop's attempts plus the team server's league, as one ranked list (emails included). */
  async function leagueNow() {
    const attempts = await store.all()
    const theirs = team.configured ? await team.league() : null
    return mergeLeague(attempts, theirs, team.pendingKeys())
  }

  function requireStaff(req) {
    const given = req.headers["x-staff-pin"]
    if (config.staffPin) {
      if (!pinMatches(given, config.staffPin)) throw new HttpError(403, "forbidden", "A valid X-Staff-Pin header is required.")
      return
    }
    if (!isLoopback(req.socket.remoteAddress)) {
      throw new HttpError(403, "forbidden", "Staff actions are only allowed from the kiosk laptop unless STAFF_PIN is set.")
    }
  }

  async function handleApi(req, res, pathname) {
    if (!sameOrigin(req)) throw new HttpError(403, "cross_origin", "Cross-origin requests are not allowed.")
    const route = `${req.method} ${pathname}`

    if (route === "POST /api/attempt") {
      const body = await readJson(req)
      const checked = validateAttempt(body)
      if (!checked.ok) return sendJson(res, 400, { ok: false, error: "invalid_attempt", message: "The attempt was rejected.", details: checked.errors })
      // Local first (the Excel file and this laptop's board never depend on the network), then the team server.
      const { record, replayed } = await store.addOnce(checked.attempt)
      if (!replayed) exporter.schedule()
      if (team.configured) {
        await team.enqueue(record)
        await team.waitFor(attemptKey(record), forwardWaitMs)
      }
      const league = await leagueNow()
      const player = findPlayer(league.players, record.email)
      return sendJson(res, 200, {
        ok: true,
        attempts: player.attempts,
        best: player.best,
        latest: player.latest,
        rank: player.rank,
        players: league.players.length,
        newBest: player.best === record.score && player.bestAt === record.playedAt,
        source: league.source,
      })
    }

    if (route === "GET /api/league") {
      const league = await leagueNow()
      return sendJson(res, 200, { ok: true, players: publicLeague(league.players), attempts: league.attempts, source: league.source })
    }

    if (route === "GET /api/health") {
      const attempts = await store.all()
      return sendJson(res, 200, {
        ok: true,
        service: "token-quest",
        attempts: attempts.length,
        players: aggregatePlayers(attempts).length,
        uptime: Math.round(process.uptime()),
        upstream: team.status(),
      })
    }

    if (route === "GET /api/export.xlsx") {
      requireStaff(req)
      const attempts = await store.all()
      const workbook = buildWorkbook(attempts)
      exporter.schedule()
      res.statusCode = 200
      res.setHeader("Content-Type", XLSX_MIME)
      res.setHeader("Content-Length", workbook.length)
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(config.exportPath).replace(/["\\]/g, "")}"`)
      res.setHeader("Cache-Control", "no-store")
      res.setHeader("X-Content-Type-Options", "nosniff")
      return res.end(workbook)
    }

    if (route === "POST /api/reset") {
      requireStaff(req)
      const stamp = archiveStamp()
      const workbookArchive = await exporter.archiveTo(path.join(config.dataDir, `attempts-${stamp}.xlsx`))
      const { archived, attempts } = await store.reset()
      exporter.schedule()
      log(`reset: archived ${attempts} attempt(s)${archived ? ` to ${path.basename(archived)}` : ""}`)
      return sendJson(res, 200, { ok: true, attempts, archived: archived ? path.basename(archived) : null, workbook: workbookArchive ? path.basename(workbookArchive) : null })
    }

    if (["/api/attempt", "/api/league", "/api/health", "/api/export.xlsx", "/api/reset"].includes(pathname)) {
      res.setHeader("Allow", pathname === "/api/attempt" || pathname === "/api/reset" ? "POST" : "GET")
      throw new HttpError(405, "method_not_allowed", "That method is not allowed here.")
    }
    throw new HttpError(404, "not_found", "No such API route.")
  }

  const server = http.createServer(async (req, res) => {
    const started = process.hrtime.bigint()
    const pathname = rawPathname(req.url)
    res.once("close", () => {
      const ms = Number((process.hrtime.bigint() - started) / 1000000n)
      log(`${new Date().toISOString()} ${req.socket.remoteAddress || "-"} ${req.method} ${pathname ?? "(bad url)"} ${res.writableFinished ? res.statusCode : "aborted"} ${ms}ms`)
    })
    try {
      if (pathname === null) throw new HttpError(400, "bad_request", "Malformed URL.")
      if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname)
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD")
        throw new HttpError(405, "method_not_allowed", "Only GET and HEAD are allowed for files.")
      }
      await serveStatic(req, res, pathname)
    } catch (error) {
      if (res.headersSent) return res.destroy()
      if (error instanceof HttpError) {
        if (error.status === 413) {
          res.setHeader("Connection", "close")
          req.resume()
        }
        return sendJson(res, error.status, { ok: false, error: error.code, message: error.message })
      }
      log(`error: ${req.method} ${pathname} -> ${error?.code || error?.name || "Error"}: ${error?.message || "unknown"}`)
      return sendJson(res, 500, { ok: false, error: "internal", message: "Something went wrong on the server." })
    }
  })
  server.keepAliveTimeout = 5000
  return server
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
}

/** Starts everything and resolves with { server, store, exporter, upstream, url, close }. */
export async function startServer(options, { log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const store = await new AttemptStore(options.dataDir, { log }).init()
  // The data directory exists now; pin its real absolute path so the static guard sees the same form
  // whatever relative or symlinked value DATA_DIR was given as.
  const config = { ...options, dataDir: await realpath(options.dataDir) }
  const exporter = new Exporter(store, config.exportPath, { log })
  const upstream = config.upstreamUrl ? await createUpstream({ url: config.upstreamUrl, key: config.upstreamKey, dataDir: config.dataDir, log }).init() : null
  const server = createApp(config, { store, exporter, upstream, log })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(config.port, config.host, () => {
      server.off("error", reject)
      resolve()
    })
  })
  const { port } = server.address()
  const displayHost = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host
  const url = `http://${displayHost.includes(":") && !displayHost.startsWith("[") ? `[${displayHost}]` : displayHost}:${port}/`

  log("Token Quest server")
  log(`  Game:     ${url}`)
  log(`  Data:     ${config.dataDir} (${store.attempts.length} attempt(s) on file)`)
  log(`  Excel:    ${config.exportPath}`)
  log(`  Staff:    ${config.staffPin ? "STAFF_PIN set; export/reset need the X-Staff-Pin header" : "STAFF_PIN not set; export/reset only from this laptop"}`)
  if (config.envFile) log(`  Settings: ${config.envFile.file} (${config.envFile.keys.join(", ") || "nothing new"})`)
  if (upstream) {
    log(`  Upstream: ${config.upstreamUrl} (${config.upstreamKey ? "key set" : "NO KEY"}): every game is also sent to the team server; the board merges its totals`)
    if (!config.upstreamKey) log("  WARNING:  UPSTREAM_KEY is not set; the team server will refuse the forwards (401) unless its gate is off.")
  } else {
    log('  Upstream: not set; scores stay on this laptop (see HOSTING.md, "Many laptops, one league")')
  }
  if (config.lan) {
    log("  WARNING:  --lan exposes the game to every device on this network. Only use it on a trusted network.")
    for (const address of lanAddresses()) log(`  LAN:      http://${address}:${port}/`)
    if (!config.staffPin) log("  WARNING:  set STAFF_PIN so staff actions cannot be triggered from other devices.")
  }
  log(`listening on ${url}`)

  if (store.attempts.length) exporter.schedule()
  // Games recorded before UPSTREAM_URL was set (or while the journal was missing) go to the team server too.
  if (upstream) upstream.backfill(store.attempts).catch((error) => log(`upstream: backfill failed: ${error.message}`))

  let closing = null
  const close = () =>
    (closing ||= (async () => {
      await exporter.flush()
      await upstream?.close()
      await new Promise((resolve) => {
        server.close(() => resolve())
        server.closeIdleConnections?.()
      })
    })())
  return { server, store, exporter, upstream, url, port, close }
}

/** One-shot export for `npm run export`. Resolves with the path written. */
export async function exportOnce(config, { log = () => {} } = {}) {
  const store = await new AttemptStore(config.dataDir, { log }).init()
  const exporter = new Exporter(store, config.exportPath, { delay: 0, log })
  exporter.dirty = true
  if (!(await exporter.flush())) throw exporter.lastError
  return config.exportPath
}
