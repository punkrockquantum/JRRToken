/** Static file serving for the kiosk: traversal-safe, no directory listings, fresh HTML/JS. */
import { createReadStream } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import path from "node:path"

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".wasm": "application/wasm",
}

/** The kiosk must always pick up the latest build of these. */
const NO_STORE = new Set([".html", ".js", ".mjs", ".css", ".json", ".map", ".webmanifest"])

/**
 * Top-level folders that are never static content. "data" is the default DATA_DIR and holds
 * names and emails; the others are server code and tests. The game only needs index.html,
 * css/, js/ and assets/.
 */
export const DENIED_TOP_LEVEL = new Set(["data", "server", "scripts", "tests", "node_modules"])
/** File types that are never static content wherever they live (attempt logs, workbooks, env files). */
export const DENIED_EXTENSIONS = new Set([".jsonl", ".xlsx", ".env"])

export function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream"
}

function within(candidate, root) {
  return candidate === root || candidate.startsWith(root + path.sep)
}

/** True when the final path segment is a denied file type or an env file (.env, .env.local, prod.env). */
export function isDeniedFile(name) {
  const base = path.basename(name).toLowerCase()
  return DENIED_EXTENSIONS.has(path.extname(base)) || base.startsWith(".env")
}

/**
 * Maps a URL path to a file under `root`. Returns null for anything suspicious:
 * encoded junk, NUL bytes, backslashes, "." / ".." segments, dot-files such as .git,
 * denied top-level folders (data/, server/, scripts/, tests/) and denied file types.
 */
export function resolveStaticPath(root, urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null
  const segments = decoded.split("/").filter((segment) => segment.length > 0)
  if (segments.some((segment) => segment.startsWith("."))) return null
  if (segments.length && DENIED_TOP_LEVEL.has(segments[0].toLowerCase())) return null
  if (segments.length && isDeniedFile(segments[segments.length - 1])) return null
  const resolved = path.resolve(root, ...segments)
  return within(resolved, root) ? resolved : null
}

async function realpathOrSelf(target) {
  try {
    return await realpath(target)
  } catch {
    return target
  }
}

/**
 * Creates a handler `(req, res, pathname) => Promise<void>`.
 * `deny` lists directories (for example DATA_DIR) that must never be served. They are compared
 * both as given and as real paths, so symlinked or relative configurations are covered too.
 */
export function createStaticHandler({ root, deny = [] }) {
  const absoluteRoot = path.resolve(root)
  const configured = deny.map((dir) => path.resolve(dir))
  let resolvedDeny = null
  const denyDirs = async () => {
    if (!resolvedDeny) {
      resolvedDeny = Promise.all(configured.map(realpathOrSelf)).then((real) => [...new Set([...configured, ...real])])
    }
    return resolvedDeny
  }
  const isDenied = (target, dirs) => dirs.some((dir) => within(target, dir)) || isDeniedFile(target)

  return async function serveStatic(req, res, pathname) {
    const method = req.method === "HEAD" ? "HEAD" : "GET"
    let file = resolveStaticPath(absoluteRoot, pathname)
    if (!file) return notFound(res)
    const dirs = await denyDirs()
    if (isDenied(file, dirs)) return notFound(res)

    let info
    try {
      info = await stat(file)
      if (info.isDirectory()) {
        file = path.join(file, "index.html")
        info = await stat(file)
      }
      if (!info.isFile()) return notFound(res)
      const real = await realpath(file)
      const realRoot = await realpath(absoluteRoot)
      if (!within(real, realRoot) || isDenied(real, dirs)) return notFound(res)
      const relative = path.relative(realRoot, real).split(path.sep)
      if (DENIED_TOP_LEVEL.has(relative[0].toLowerCase()) || relative.some((segment) => segment.startsWith("."))) return notFound(res)
    } catch {
      return notFound(res)
    }

    const extension = path.extname(file).toLowerCase()
    res.statusCode = 200
    res.setHeader("Content-Type", mimeFor(file))
    res.setHeader("Content-Length", info.size)
    res.setHeader("Cache-Control", NO_STORE.has(extension) ? "no-store" : "public, max-age=3600")
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Referrer-Policy", "no-referrer")
    if (method === "HEAD") return res.end()
    await new Promise((resolve) => {
      const stream = createReadStream(file)
      stream.on("error", () => {
        if (!res.headersSent) notFound(res)
        else res.destroy()
        resolve()
      })
      res.on("close", resolve)
      stream.pipe(res)
    })
  }
}

function notFound(res) {
  res.statusCode = 404
  res.setHeader("Content-Type", "text/plain; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  res.end("Not found")
}
