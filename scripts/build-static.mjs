#!/usr/bin/env node
/**
 * Builds the static demo of Token Quest into dist/: no server, no /api, the league stays in each
 * player's browser and nothing is collected centrally. Zero dependencies; Node 18+.
 *
 *   npm run build:static                       -> dist/
 *   BASE_PATH=/JRRToken npm run build:static   -> for hosts that serve the site under a subpath
 *                                                 (GitHub Pages project sites)
 *   INTAKE_URL=https://... npm run build:static -> the hosted game posts finished games to that
 *                                                 intake Worker (deploy/intake-worker) instead of
 *                                                 its own origin; see HOSTING.md "Hosted player sheet"
 *   npm run serve:static                       -> build, then preview dist/ on http://127.0.0.1:8099/
 *   node scripts/build-static.mjs --help       -> all options
 *
 * What it does: copies index.html, css/, js/ and assets/ as they are (no bundling, no minifying),
 * adds a small 404.html (so Cloudflare Pages does not fall back to index.html for the game's /api/*
 * probes) and deploy/static/_headers (cache headers for Cloudflare Pages / Netlify), then checks that
 * every stylesheet, font, module and import the first paint needs is present in dist/.
 *
 * BASE_PATH: the game's own URLs are relative (index.html, css/game.css, the ES module imports), so a
 * subpath works without rewriting. The build still rewrites any root-relative href="/...", src="/..."
 * and url(/...) it finds in HTML/CSS and reports the count (expected: 0). JavaScript is never rewritten:
 * without INTAKE_URL the /api/* calls in js/sync.js and js/main.js get a 404 on a static host and the
 * game falls back to localStorage, which is the intended demo behaviour.
 *
 * INTAKE_URL: when set, dist/index.html gets one inline line before </head>,
 * <script>window.TOKEN_QUEST_INTAKE = "https://..."</script>, which js/sync.js reads at start-up and
 * prefixes to its /api calls. Nothing else changes; the source index.html is never touched.
 */
import http from "node:http"
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCES = ["index.html", "css", "js", "assets"]
const HEADERS_TEMPLATE = path.join(ROOT, "deploy", "static", "_headers")
const DEFAULT_OUT = path.join(ROOT, "dist")
const DEFAULT_PORT = 8099
/** Never published, wherever they live (same list as server/static.mjs). */
const DENIED_EXTENSIONS = new Set([".jsonl", ".xlsx", ".env"])

class BuildError extends Error {}

function usage() {
  return `Token Quest static demo build

Usage: node scripts/build-static.mjs [options]

  --out <dir>      Output directory (env OUT_DIR, default ./dist). It is emptied first.
  --base <path>    Serve-under-subpath prefix such as /JRRToken (env BASE_PATH, default none)
  --intake <url>   Intake Worker the hosted game posts finished games to (env INTAKE_URL, default
                   none: /api stays same-origin and a static host collects nothing)
  --serve          After building, preview the output on http://127.0.0.1:<port><base>/
  --port <n>       Preview port (env PREVIEW_PORT, default ${DEFAULT_PORT})
  -h, --help       Show this help`
}

function parseArgs(argv) {
  const flags = {}
  const booleans = new Set(["serve", "help"])
  const valued = new Set(["out", "base", "port", "intake"])
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "-h") {
      flags.help = true
      continue
    }
    if (!arg.startsWith("--")) throw new BuildError(`Unexpected argument: ${arg}`)
    const [key, inlineValue] = arg.slice(2).split(/=(.*)/s)
    if (booleans.has(key)) {
      if (inlineValue !== undefined) throw new BuildError(`--${key} does not take a value`)
      flags[key] = true
    } else if (valued.has(key)) {
      const value = inlineValue !== undefined ? inlineValue : argv[(i += 1)]
      if (value === undefined) throw new BuildError(`--${key} needs a value`)
      flags[key] = value
    } else throw new BuildError(`Unknown option: --${key}`)
  }
  return flags
}

/** "" for the site root; otherwise "/prefix" with no trailing slash. Rejects anything that is not a plain path. */
export function normaliseBasePath(value) {
  const text = String(value ?? "").trim()
  if (!text || text === "/") return ""
  const segments = text.replace(/^\/+|\/+$/g, "").split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._~-]+$/.test(segment))) {
    throw new BuildError(`BASE_PATH must be a plain path such as /JRRToken (got ${JSON.stringify(text)})`)
  }
  return `/${segments.join("/")}`
}

/** "" when unset; otherwise an absolute http(s) URL without credentials, query, hash or trailing slash. */
export function normaliseIntakeUrl(value) {
  const text = String(value ?? "").trim()
  if (!text) return ""
  let url
  try {
    url = new URL(text)
  } catch {
    throw new BuildError(`INTAKE_URL must be an absolute URL such as https://tokenquest.example.workers.dev (got ${JSON.stringify(text)})`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BuildError(`INTAKE_URL must use http(s) (got ${JSON.stringify(text)})`)
  if (url.username || url.password || url.search || url.hash) throw new BuildError("INTAKE_URL must not carry credentials, a query string or a fragment")
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

/** The one line the hosted game reads at start-up (js/sync.js). */
export function intakeScript(intake) {
  const literal = JSON.stringify(intake).replace(/</g, "\\u003c")
  return `<script>window.TOKEN_QUEST_INTAKE = ${literal}</script>`
}

/** Inserts the intake script before </head> (so it runs before the module script). Unchanged when intake is "". */
export function injectIntake(html, intake) {
  if (!intake) return html
  const marker = /<\/head>/i.exec(html)
  if (!marker) throw new BuildError("index.html has no </head> to inject the intake URL before")
  return `${html.slice(0, marker.index)}  ${intakeScript(intake)}\n  ${html.slice(marker.index)}`
}

function within(candidate, root) {
  return candidate === root || candidate.startsWith(root + path.sep)
}

/** Refuses output directories that would delete the project or one of its source folders. */
function assertSafeOutDir(out) {
  if (out === ROOT || within(ROOT, out)) throw new BuildError(`--out must be a folder inside the project, not ${out}`)
  for (const source of SOURCES) {
    if (within(out, path.join(ROOT, source))) throw new BuildError(`--out must not be inside ${source}/`)
  }
  if (path.basename(out).startsWith(".")) throw new BuildError(`--out must not be a dot-folder (${out})`)
}

/** Rewrites root-relative href="/x", src="/x" and url(/x) to the base path. Protocol-relative "//" is left alone. */
export function rewriteRootRelative(text, base, kind) {
  let count = 0
  let out = text
  const prefix = (_match, lead, quote) => {
    count += 1
    return `${lead}${quote}${base}/`
  }
  if (kind === "html") out = out.replace(/((?:href|src)\s*=\s*)(["'])\/(?!\/)/g, prefix)
  out = out.replace(/(url\(\s*)(["']?)\/(?!\/)/g, prefix)
  return { text: out, count }
}

async function copyTree(source, target, ctx) {
  const info = await stat(source)
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true })
    const entries = (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      await copyTree(path.join(source, entry.name), path.join(target, entry.name), ctx)
    }
    return
  }
  if (!info.isFile()) return
  const relative = path.relative(ROOT, source)
  const extension = path.extname(source).toLowerCase()
  if (DENIED_EXTENSIONS.has(extension) || path.basename(source).toLowerCase().startsWith(".env")) {
    ctx.skipped.push(relative)
    return
  }
  if (ctx.base && (extension === ".html" || extension === ".css")) {
    const { text, count } = rewriteRootRelative(await readFile(source, "utf8"), ctx.base, extension.slice(1))
    ctx.rewritten += count
    await writeFile(target, text)
  } else {
    await copyFile(source, target)
  }
  ctx.files += 1
  ctx.bytes += info.size
}

function notFoundPage(base) {
  return `<!DOCTYPE html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Token Quest — not found</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b17; color: #f8d038; font-family: ui-monospace, Menlo, monospace; text-align: center; }
      a { color: #fff; }
    </style>
  </head>
  <body>
    <main>
      <h1>404</h1>
      <p>That page is not part of the game.</p>
      <p><a href="${base}/">Back to Token Quest</a></p>
    </main>
  </body>
</html>
`
}

async function exists(file) {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

async function listFiles(dir, extension) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await listFiles(full, extension)))
    else if (full.toLowerCase().endsWith(extension)) found.push(full)
  }
  return found.sort()
}

function isExternal(url) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)
}

/** Resolves a URL found in `file` to a path under dist. Root-relative URLs must carry the base path. */
function resolveUrl(url, file, dist, base, problems) {
  const clean = url.split(/[?#]/)[0]
  if (!clean) return null
  if (clean.startsWith("/")) {
    if (base && !(clean === base || clean.startsWith(`${base}/`))) {
      problems.push(`${path.relative(dist, file)} -> ${url} is root-relative but missing the base path ${base}`)
      return null
    }
    return path.join(dist, decodeURIComponent(clean.slice(base.length)))
  }
  return path.resolve(path.dirname(file), decodeURIComponent(clean))
}

/**
 * Checks that what the first paint needs exists in dist/: the links in index.html, the url()s in CSS
 * and every relative ES module import. Also counts the /api calls that remain in JavaScript so the
 * log says plainly what happens to them on a static host.
 */
export async function verifyDist(dist, base, intake = "") {
  const problems = []
  const counts = { links: 0, urls: 0, imports: 0, api: 0 }
  const check = async (target, label) => {
    if (target && !(await exists(target))) problems.push(`${label} -> missing ${path.relative(dist, target)}`)
  }

  const indexFile = path.join(dist, "index.html")
  if (!(await exists(indexFile))) throw new BuildError("dist/index.html is missing")
  const html = await readFile(indexFile, "utf8")
  if (!/<script[^>]+type=["']module["']/.test(html)) problems.push("index.html has no <script type=\"module\">")
  const intakeTags = html.split("window.TOKEN_QUEST_INTAKE").length - 1
  if (intake && (intakeTags !== 1 || !html.includes(intakeScript(intake)))) problems.push("index.html does not carry exactly one intake URL")
  if (!intake && intakeTags !== 0) problems.push("index.html carries an intake URL although none was requested")
  for (const match of html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g)) {
    const url = match[1]
    if (isExternal(url)) continue
    counts.links += 1
    await check(resolveUrl(url, indexFile, dist, base, problems), `index.html ${url}`)
  }

  for (const file of await listFiles(path.join(dist, "css"), ".css")) {
    const css = await readFile(file, "utf8")
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const url = match[1].trim()
      if (isExternal(url)) continue
      counts.urls += 1
      await check(resolveUrl(url, file, dist, base, problems), `${path.relative(dist, file)} url(${url})`)
    }
  }

  for (const file of await listFiles(path.join(dist, "js"), ".js")) {
    const source = await readFile(file, "utf8")
    const specifiers = [
      ...source.matchAll(/(?:^|[\n;])\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/g),
      ...source.matchAll(/(?:^|[\n;])\s*import\s*["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1])
    for (const specifier of specifiers) {
      counts.imports += 1
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        await check(path.resolve(path.dirname(file), specifier), `${path.relative(dist, file)} imports ${specifier}`)
      } else if (!isExternal(specifier)) {
        problems.push(`${path.relative(dist, file)} imports bare specifier ${specifier} (browsers cannot resolve it)`)
      }
    }
    counts.api += (source.match(/["'`]\/api\//g) || []).length
    for (const match of source.matchAll(/["'`]\/(?:js|css|assets)\//g)) {
      problems.push(`${path.relative(dist, file)} uses the root-relative URL ${match[0].slice(1)}... which breaks under a base path`)
    }
  }

  return { problems, counts }
}

export async function build({ out = DEFAULT_OUT, base = "", intake = "", log = () => {} } = {}) {
  const dist = path.resolve(out)
  assertSafeOutDir(dist)
  for (const source of SOURCES) {
    try {
      await stat(path.join(ROOT, source))
    } catch {
      throw new BuildError(`${source} is missing; run the build from the project checkout`)
    }
  }

  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  const ctx = { base, files: 0, bytes: 0, rewritten: 0, skipped: [] }
  for (const source of SOURCES) await copyTree(path.join(ROOT, source), path.join(dist, source), ctx)
  if (intake) {
    const indexFile = path.join(dist, "index.html")
    await writeFile(indexFile, injectIntake(await readFile(indexFile, "utf8"), intake))
  }
  await writeFile(path.join(dist, "404.html"), notFoundPage(base))
  if (await exists(HEADERS_TEMPLATE)) await copyFile(HEADERS_TEMPLATE, path.join(dist, "_headers"))

  const { problems, counts } = await verifyDist(dist, base, intake)
  log(`build:static -> ${path.relative(ROOT, dist) || dist}/ (${ctx.files} game files, ${Math.round(ctx.bytes / 1024)} KB) base path: ${base || "(none)"}`)
  log(`  root-relative URLs rewritten in html/css: ${ctx.rewritten}`)
  if (ctx.skipped.length) log(`  skipped (never published): ${ctx.skipped.join(", ")}`)
  log(`  checked ${counts.links} index.html links, ${counts.urls} css url()s, ${counts.imports} module imports: ${problems.length ? `${problems.length} problem(s)` : "all present"}`)
  if (intake) log(`  intake URL: ${intake} (finished games are posted to ${intake}/api/attempt; ${counts.api} /api calls in js)`)
  else log(`  /api calls left in js: ${counts.api} (no INTAKE_URL: a static host answers 404; the game keeps scores in localStorage)`)
  if (problems.length) throw new BuildError(`The static build would not load:\n  - ${problems.join("\n  - ")}`)
  return { dist, base, intake, ...ctx, counts }
}

/** Previews dist/ with the kiosk's own static handler (same MIME types and no-store rules as the server). */
export async function serve({ dist, base, port, log = () => {} }) {
  const { createStaticHandler } = await import("../server/static.mjs")
  const serveStatic = createStaticHandler({ root: dist })
  const server = http.createServer(async (req, res) => {
    const url = typeof req.url === "string" && req.url.startsWith("/") ? req.url : "/"
    let pathname = url.split(/[?#]/)[0]
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405
      res.setHeader("Allow", "GET, HEAD")
      res.setHeader("Content-Type", "text/plain; charset=utf-8")
      return res.end("Method not allowed")
    }
    if (base) {
      if (pathname === "/" || pathname === base) {
        res.statusCode = 302
        res.setHeader("Location", `${base}/`)
        return res.end()
      }
      if (!pathname.startsWith(`${base}/`)) {
        res.statusCode = 404
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        return res.end("Not found (outside the base path)")
      }
      pathname = pathname.slice(base.length)
    }
    try {
      await serveStatic(req, res, pathname)
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500
        res.end("Preview server error")
      } else res.destroy()
    }
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const actualPort = server.address().port
  log(`Preview:  http://127.0.0.1:${actualPort}${base}/   (Ctrl+C to stop)`)
  log(`listening on http://127.0.0.1:${actualPort}${base}/`)
  return server
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const log = (line) => process.stdout.write(`${line}\n`)
  try {
    const flags = parseArgs(process.argv.slice(2))
    if (flags.help) {
      log(usage())
      process.exit(0)
    }
    const base = normaliseBasePath(flags.base ?? process.env.BASE_PATH ?? "")
    const intake = normaliseIntakeUrl(flags.intake ?? process.env.INTAKE_URL ?? "")
    const out = flags.out ?? process.env.OUT_DIR ?? DEFAULT_OUT
    const port = Number(flags.port ?? process.env.PREVIEW_PORT ?? DEFAULT_PORT)
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new BuildError(`Invalid port: ${flags.port ?? process.env.PREVIEW_PORT}`)
    const result = await build({ out: path.resolve(ROOT, out), base, intake, log })
    if (flags.serve) {
      const server = await serve({ dist: result.dist, base, port, log })
      const stop = () => server.close(() => process.exit(0))
      process.on("SIGINT", stop)
      process.on("SIGTERM", stop)
    }
  } catch (error) {
    if (error instanceof BuildError) {
      console.error(error.message)
      process.exit(2)
    }
    throw error
  }
}
