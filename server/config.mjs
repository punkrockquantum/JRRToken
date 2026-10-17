/**
 * CLI flags + environment -> server configuration. Flags win over env, env over defaults.
 * An optional .env file in the repo root (git-ignored; override its path with ENV_FILE, or
 * ENV_FILE=off to skip it) fills in variables that the environment does not set.
 */
import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])
export const ENV_FILE = path.join(ROOT, ".env")

export class ConfigError extends Error {}

export function usage() {
  return `Token Quest local server

Usage: node scripts/serve.mjs [options]

  --port <n>          Port to listen on (env PORT, default 8080)
  --host <addr>       Address to bind (env HOST, default 127.0.0.1)
  --lan               Allow binding to 0.0.0.0 so other devices on the network can play
  --data-dir <path>   Where attempts are stored (env DATA_DIR, default ./data)
  --export-path <p>   Excel output (env EXPORT_PATH, default ~/Desktop/Token Quest Leaderboard.xlsx)
  --export            Write the Excel file once and exit
  -h, --help          Show this help

  STAFF_PIN           Env only. Required as the X-Staff-Pin header for /api/export.xlsx and
                      /api/reset. When unset those endpoints only answer requests from this laptop.
  UPSTREAM_URL        Env only. The team server (https://tokenquest.<account>.workers.dev): every
                      accepted game is also sent there, queued in DATA_DIR/upstream-queue.jsonl
                      while it is unreachable, and the league shown here merges its totals.
  UPSTREAM_KEY        Env only. The Worker's INTAKE_KEY secret, sent as X-Intake-Key.

  Variables can also live in a .env file in the repo root (KEY=value lines; git-ignored, never
  commit it). The environment wins over the file. ENV_FILE=<path> reads another file, ENV_FILE=off none.`
}

/** KEY=value lines (# comments, optional quotes, optional "export "). Returns { key: value }. */
export function parseEnvFile(text) {
  const values = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    const quoted = /^(["'])(.*)\1$/.exec(value)
    if (quoted) value = quoted[2]
    else value = value.replace(/\s+#.*$/, "").trim()
    values[match[1]] = value
  }
  return values
}

/**
 * Reads the .env file (if any) and returns a copy of `env` with its values filled in where the
 * environment has no entry at all. Resolves { env, file, keys }: `keys` are the names applied
 * (never the values, so they can be logged).
 */
export function withEnvFile(env = {}, { file = env.ENV_FILE || ENV_FILE } = {}) {
  const merged = { ...env }
  const keys = []
  if (!file || String(file).trim().toLowerCase() === "off") return { env: merged, file: null, keys }
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return { env: merged, file: null, keys }
    throw new ConfigError(`Could not read ${file}: ${error.message}`)
  }
  for (const [key, value] of Object.entries(parseEnvFile(text))) {
    if (Object.hasOwn(merged, key)) continue
    merged[key] = value
    keys.push(key)
  }
  return { env: merged, file, keys }
}

/**
 * UPSTREAM_URL -> "https://host[/path]" without a trailing slash, or null when unset. Plain http is
 * only accepted for loopback hosts (local tests against `wrangler dev`): the key must not travel in
 * the clear over a venue network.
 */
export function parseUpstreamUrl(value) {
  const text = String(value ?? "").trim()
  if (!text) return null
  let url
  try {
    url = new URL(text)
  } catch {
    throw new ConfigError(`UPSTREAM_URL=${text} is not a URL (expected https://tokenquest.<account>.workers.dev)`)
  }
  if (url.username || url.password || url.search || url.hash) throw new ConfigError("UPSTREAM_URL must be a plain https:// origin, optionally with a path")
  const loopback = LOOPBACK_HOSTS.has(url.hostname) || url.hostname === "[::1]"
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new ConfigError("UPSTREAM_URL must use https:// (http:// is only allowed for 127.0.0.1 / localhost)")
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

function parseArgs(argv) {
  const flags = {}
  const booleans = new Set(["lan", "export", "help"])
  const valued = new Set(["port", "host", "data-dir", "export-path"])
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "-h") {
      flags.help = true
      continue
    }
    if (!arg.startsWith("--")) throw new ConfigError(`Unexpected argument: ${arg}`)
    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s)
    if (booleans.has(rawKey)) {
      if (inlineValue !== undefined) throw new ConfigError(`--${rawKey} does not take a value`)
      flags[rawKey] = true
    } else if (valued.has(rawKey)) {
      const value = inlineValue !== undefined ? inlineValue : argv[(i += 1)]
      if (value === undefined) throw new ConfigError(`--${rawKey} needs a value`)
      flags[rawKey] = value
    } else throw new ConfigError(`Unknown option: --${rawKey}`)
  }
  return flags
}

function toPort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError(`Invalid port: ${value}`)
  return port
}

function expandPath(value) {
  const text = String(value).trim()
  if (!text) throw new ConfigError("Empty path")
  const home = os.homedir()
  const expanded = text === "~" ? home : text.startsWith("~/") ? path.join(home, text.slice(2)) : text
  return path.resolve(expanded)
}

export function loadConfig(argv = [], env = {}) {
  const flags = parseArgs(argv)
  const lan = flags.lan === true
  const host = String(flags.host ?? (env.HOST || undefined) ?? (lan ? "0.0.0.0" : "127.0.0.1")).trim()
  if (!lan && !LOOPBACK_HOSTS.has(host)) {
    throw new ConfigError(`HOST=${host} would expose the game beyond this laptop. Pass --lan (npm run serve:lan) if that is what you want.`)
  }
  return {
    root: ROOT,
    port: toPort(flags.port ?? (env.PORT || undefined) ?? 8080),
    host,
    lan,
    dataDir: expandPath(flags["data-dir"] ?? (env.DATA_DIR || undefined) ?? path.join(ROOT, "data")),
    exportPath: expandPath(flags["export-path"] ?? (env.EXPORT_PATH || undefined) ?? path.join(os.homedir(), "Desktop", "Token Quest Leaderboard.xlsx")),
    staffPin: (env.STAFF_PIN || "").trim() || null,
    upstreamUrl: parseUpstreamUrl(env.UPSTREAM_URL),
    upstreamKey: (env.UPSTREAM_KEY || "").trim() || null,
    exportOnly: flags.export === true,
    help: flags.help === true,
  }
}
