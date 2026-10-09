/** CLI flags + environment -> server configuration. Flags win over env, env over defaults. */
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

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
                      /api/reset. When unset those endpoints only answer requests from this laptop.`
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
    exportOnly: flags.export === true,
    help: flags.help === true,
  }
}
