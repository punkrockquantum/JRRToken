#!/usr/bin/env node
/**
 * Token Quest kiosk server. Zero dependencies; Node 18+.
 *
 *   npm start                      -> http://127.0.0.1:8080/
 *   npm run serve:lan              -> also reachable from other devices (prints a warning)
 *   npm run export                 -> writes the Excel workbook once and prints its path
 *   node scripts/serve.mjs --help  -> all options
 */
import { ConfigError, loadConfig, usage } from "../server/config.mjs"
import { exportOnce, startServer } from "../server/app.mjs"

const [major] = process.versions.node.split(".").map(Number)
if (major < 18) {
  console.error(`Token Quest needs Node 18 or newer (you have ${process.versions.node}). Download it from https://nodejs.org`)
  process.exit(1)
}

let config
try {
  config = loadConfig(process.argv.slice(2), process.env)
} catch (error) {
  if (!(error instanceof ConfigError)) throw error
  console.error(`${error.message}\n\n${usage()}`)
  process.exit(2)
}

if (config.help) {
  console.log(usage())
  process.exit(0)
}

if (config.exportOnly) {
  try {
    const written = await exportOnce(config)
    console.log(written)
    process.exit(0)
  } catch (error) {
    console.error(`Could not write ${config.exportPath}: ${error.message}`)
    process.exit(1)
  }
}

let app
try {
  app = await startServer(config)
} catch (error) {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. Is Token Quest already running? Try: PORT=8090 npm start`)
  } else if (error.code === "EACCES") {
    console.error(`Not allowed to listen on ${config.host}:${config.port}. Try a port above 1024.`)
  } else {
    console.error(`Could not start the server: ${error.message}`)
  }
  process.exit(1)
}

let stopping = false
async function shutdown(signal) {
  if (stopping) return
  stopping = true
  process.stdout.write(`${signal} received, saving the Excel file and stopping...\n`)
  const timer = setTimeout(() => process.exit(0), 5000)
  timer.unref()
  await app.close()
  process.exit(0)
}
process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
