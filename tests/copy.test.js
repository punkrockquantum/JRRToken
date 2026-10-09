import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const needle = ["ever", "pure"].join("")

function filesIn(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) filesIn(path, out)
    else if (/\.(js|mjs|css|html|json)$/.test(name)) out.push(path)
  }
  return out
}

test("the player-facing tree does not name the removed storage brand", () => {
  const files = ["js", "css", "tests", "scripts"].flatMap((dir) => filesIn(join(root, dir)))
  files.push(join(root, "index.html"), join(root, "package.json"))
  const hits = files.filter((path) => readFileSync(path, "utf8").toLowerCase().includes(needle))
  assert.deepEqual(hits, [])
})
