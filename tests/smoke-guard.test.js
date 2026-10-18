import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { THROWAWAY, refuseLiveUpstream } from "../scripts/smoke-guard.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const respond = (status, body) => async () => ({ ok: status === 200, status, json: async () => body })

test("a kiosk server that forwards games upstream is refused, with the throwaway command in the error", async () => {
  await assert.rejects(
    refuseLiveUpstream("http://127.0.0.1:8080/", respond(200, { ok: true, upstream: { configured: true, url: "https://example.invalid" } })),
    (error) => /upstream\.configured = true/.test(error.message) && error.message.includes(THROWAWAY) && /fixture games/.test(error.message),
  )
  assert.match(THROWAWAY, /^ENV_FILE=off .*node scripts\/serve\.mjs$/)
})

test("a throwaway server (no upstream) and static hosting (no /api/health) both pass", async () => {
  assert.equal(await refuseLiveUpstream("http://127.0.0.1:8091/", respond(200, { ok: true, upstream: { configured: false } })), true)
  assert.equal(await refuseLiveUpstream("http://127.0.0.1:8091/", respond(200, { ok: true })), true)
  assert.equal(await refuseLiveUpstream("http://127.0.0.1:8091/", respond(404, null)), false)
  assert.equal(await refuseLiveUpstream("http://127.0.0.1:1/", async () => { throw new Error("ECONNREFUSED") }), false)
})

test("both smokes call the guard before they start Chrome", () => {
  for (const file of ["scripts/smoke.mjs", "scripts/smoke-mobile.mjs"]) {
    const code = readFileSync(join(root, file), "utf8")
    assert.match(code, /import \{ refuseLiveUpstream \} from "\.\/smoke-guard\.mjs"/, file)
    const guard = code.indexOf("await refuseLiveUpstream(base)")
    const chrome = code.indexOf("const browser = spawn(chrome")
    assert.ok(guard > -1 && chrome > guard, `${file}: the guard runs before Chrome is spawned`)
  }
})
