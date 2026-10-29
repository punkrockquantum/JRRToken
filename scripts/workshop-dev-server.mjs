#!/usr/bin/env node
/**
 * Workshop mode on a laptop, without Cloudflare: the real Worker (deploy/intake-worker/src/worker.mjs)
 * on a Node HTTP server, with an in-memory D1 (node:sqlite, both migrations applied) and the repo's own
 * index.html, css/, js/ and assets/ as the static assets. Nothing is written to disk; every restart is a
 * fresh database.
 *
 *   node scripts/workshop-dev-server.mjs                 http://127.0.0.1:8789/workshop, /host, /board/<code>
 *   node scripts/workshop-dev-server.mjs --seed          also creates a session and prints its code, PIN and host codes
 *   node scripts/workshop-dev-server.mjs --port 9000 --password letmein   (the team-password gate on)
 *
 * scripts/smoke-workshop.mjs starts this in-process (startWorkshopServer) and drives it with headless Chrome.
 */
import { readFile, stat } from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createHandler } from "../deploy/intake-worker/src/worker.mjs"
import { fakeD1 } from "../tests/helpers/fake-d1.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" }
const SERVED = ["index.html", "css", "js", "assets"]

/** A stand-in for the Workers Static Assets binding: GET/HEAD of the repo's own files, 404 otherwise. */
export function createAssetsShim(root = ROOT) {
  return {
    async fetch(request) {
      const url = new URL(request.url)
      let pathname = decodeURIComponent(url.pathname)
      if (pathname === "/") pathname = "/index.html"
      const first = pathname.split("/")[1]
      if (!SERVED.includes(first) || pathname.includes("..")) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } })
      const file = path.join(root, pathname)
      try {
        const info = await stat(file)
        if (!info.isFile()) throw new Error("not a file")
        const body = request.method === "HEAD" ? null : await readFile(file)
        return new Response(body, { status: 200, headers: { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Content-Length": String(info.size) } })
      } catch {
        return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } })
      }
    },
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

/**
 * Starts the server; resolves { url, port, env, handler, d1, close(), log }. `password` turns the gate
 * on (SESSION_SECRET derives from it). `now` can be a function for deterministic clocks.
 */
export async function startWorkshopServer({ port = 0, host = "127.0.0.1", password = "", root = ROOT, now, log = () => {}, quiet = true } = {}) {
  const d1 = fakeD1()
  const lines = []
  const handler = createHandler({ now: now || (() => new Date()), log: (line) => (lines.push(line), log(line)), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 50))) })
  const env = {
    DB: d1,
    ASSETS: createAssetsShim(root),
    ALLOWED_ORIGINS: "",
    RATE_LIMIT_ATTEMPTS_PER_MINUTE: "600",
    RATE_LIMIT_READS_PER_MINUTE: "6000",
    RATE_LIMIT_LOGINS_PER_MINUTE: "600",
    RATE_LIMIT_WORKSHOP_PER_MINUTE: "20000",
    RATE_LIMIT_WORKSHOP_WRITES_PER_MINUTE: "2000",
  }
  if (password) env.ACCESS_PASSWORD = password

  const server = http.createServer(async (req, res) => {
    try {
      const origin = `http://${req.headers.host || `${host}:${port}`}`
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req)
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value)
      else if (Array.isArray(value)) headers.set(name, value.join(", "))
      headers.set("CF-Connecting-IP", req.socket.remoteAddress || "127.0.0.1")
      const request = new Request(`${origin}${req.url}`, { method: req.method, headers, body: body && body.length ? body : undefined })
      const response = await handler.fetch(request, env, { waitUntil() {} })
      const out = {}
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() !== "set-cookie") out[name] = value
      })
      const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : []
      if (cookies.length) out["set-cookie"] = cookies
      /* Secure cookies do not come back over plain http; the local server drops the flag so the gate works on a laptop. */
      if (out["set-cookie"]) out["set-cookie"] = out["set-cookie"].map((cookie) => cookie.replace(/;\s*Secure/gi, ""))
      const bytes = Buffer.from(await response.arrayBuffer())
      delete out["content-length"]
      res.writeHead(response.status, { ...out, "content-length": String(bytes.length) })
      res.end(req.method === "HEAD" ? undefined : bytes)
    } catch (error) {
      if (!quiet) console.error(error)
      res.writeHead(500, { "Content-Type": "text/plain" })
      res.end(`dev server error: ${error?.message || error}`)
    }
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, resolve)
  })
  const actualPort = server.address().port
  const url = `http://${host}:${actualPort}`
  return {
    url,
    port: actualPort,
    env,
    handler,
    d1,
    log: lines,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      d1.close()
    },
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = process.argv.slice(2)
  const flag = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const port = Number(flag("--port") || 8789)
  const password = flag("--password") || ""
  const server = await startWorkshopServer({ port, password, quiet: false, log: (line) => process.stdout.write(`  ${line}\n`) })
  process.stdout.write(`Token Quest workshop (local, in-memory D1)\n  team iPads:   ${server.url}/workshop\n  facilitator:  ${server.url}/host\n  kiosk game:   ${server.url}/\n${password ? `  team password: ${password}\n` : ""}`)
  if (args.includes("--seed")) {
    const response = await server.handler.fetch(new Request(`${server.url}/api/session`, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1", ...(password ? {} : {}) }, body: JSON.stringify({ name: "Local workshop" }) }), server.env, { waitUntil() {} })
    const created = await response.json()
    if (!created.ok) process.stdout.write(`  seed failed: ${created.error} ${created.message}\n`)
    else process.stdout.write(`  session code: ${created.session.code}\n  facilitator PIN: ${created.pin}\n  host codes: ${created.hostCodes.map((row) => `${row.number}=${row.hostCode}`).join(" ")}\n  board: ${created.boardUrl}\n  host page: ${created.hostUrl}\n`)
  }
  process.on("SIGINT", async () => {
    await server.close()
    process.exit(0)
  })
}
