import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { ART, MISSING_ART, PALETTE, SPRITE_NAMES, spriteCanvas, spriteSize } from "../js/sprites.js"

const JS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "js")
const SOURCES = readdirSync(JS_DIR)
  .filter((file) => file.endsWith(".js") && file !== "sprites.js")
  .map((file) => [file, readFileSync(join(JS_DIR, file), "utf8")])

const NAME = `["']([a-zA-Z0-9_-]+)["']`
/** Every way the game names a sprite in source: direct calls, data fields and tile tuples. */
const WHOLE_FILE = [
  new RegExp(`\\b(?:spriteImg|spriteCanvas|spriteSize)\\(\\s*${NAME}`, "g"),
  new RegExp(`\\bdrawSprite\\(\\s*\\w+\\s*,\\s*${NAME}`, "g"),
  new RegExp(`\\b(?:sprite|icon|art)\\s*:\\s*${NAME}`, "g"),
  new RegExp(`^\\s*\\[\\s*"[a-zA-Z0-9_-]+"\\s*,\\s*"[^"]*"\\s*,\\s*${NAME}`, "gm"),
]
/** Lookup tables and lesson strips hold their names as plain string lists. */
const BLOCKS = [
  /\b(?:RACK_ART|SIMPLE_WIRE_ART|artFor)\s*=\s*\{[^}]*\}/g,
  /\bdrawLesson\([^\n]*?(\[(?:\s*"[a-zA-Z0-9_-]+"\s*,?)+\])\s*\)/g,
]
/** The expression that picks a sprite (an `art:` value or a sprite call's name argument) may hold ternary branches and `||` fallbacks. */
const EXPRESSIONS = [/\bart:\s*([^,\n]*)/g, /\bspriteImg\(\s*([^,\n]*)/g, /\bdrawSprite\(\s*\w+\s*,\s*([^,\n]*)/g]
const BRANCH = new RegExp(`(?:^|\\?|:|\\|\\|)\\s*${NAME}`, "g")

function referencedSprites() {
  const found = new Map()
  const note = (name, file) => found.set(name, [...(found.get(name) || []), file])
  for (const [file, source] of SOURCES) {
    for (const pattern of WHOLE_FILE) for (const match of source.matchAll(pattern)) note(match[1], file)
    for (const pattern of BLOCKS) {
      for (const match of source.matchAll(pattern)) {
        const block = match[1] || match[0]
        for (const inner of block.matchAll(/(?::|\[|,)\s*"([a-zA-Z0-9_-]+)"/g)) note(inner[1], file)
      }
    }
    for (const pattern of EXPRESSIONS) {
      for (const match of source.matchAll(pattern)) for (const branch of match[1].matchAll(BRANCH)) note(branch[1], file)
    }
  }
  return found
}

test("every sprite name the game references has art", () => {
  const referenced = referencedSprites()
  assert.ok(referenced.size >= 20, `the source scan should find the game's sprites, found ${referenced.size}`)
  for (const expected of ["rackAir", "rackLiquid", "rackRubin", "iconChat", "iconFlask", "gremlin", "starEmpty", "hero2", "orca", "pipe"]) {
    assert.ok(referenced.has(expected), `scan should pick up ${expected}`)
  }
  const missing = [...referenced].filter(([name]) => !ART[name]).map(([name, files]) => `${name} (${[...new Set(files)].join(", ")})`)
  assert.deepEqual(missing, [], `sprites referenced without art: ${missing.join("; ")}`)
})

test("every ART entry is a rectangle drawn only with palette letters", () => {
  const entries = [...Object.entries(ART), ["MISSING_ART", MISSING_ART]]
  assert.equal(SPRITE_NAMES.length, Object.keys(ART).length)
  for (const [name, rows] of entries) {
    assert.ok(Array.isArray(rows) && rows.length > 0, `${name} should have rows`)
    const width = rows[0].length
    assert.ok(width > 0, `${name} should have a width`)
    rows.forEach((row, y) => {
      assert.equal(row.length, width, `${name} row ${y} is ${row.length} wide, expected ${width}`)
      for (const letter of row) {
        assert.ok(letter === "." || letter === " " || letter in PALETTE, `${name} row ${y} uses "${letter}", which is not in the palette`)
      }
    })
    assert.ok(rows.some((row) => /[^. ]/.test(row)), `${name} should not be fully transparent`)
  }
})

test("unknown sprite names draw the magenta placeholder and warn once", () => {
  const fills = []
  const warnings = []
  const originalWarn = console.warn
  const originalDocument = globalThis.document
  globalThis.document = {
    createElement: () => {
      const canvas = { width: 0, height: 0, toDataURL: () => "data:," }
      canvas.getContext = () => ({
        set fillStyle(value) { canvas.color = value },
        fillRect: () => fills.push(canvas.color),
      })
      return canvas
    },
  }
  console.warn = (message) => warnings.push(message)
  try {
    const canvas = spriteCanvas("no-such-sprite", 2)
    assert.equal(canvas.width, MISSING_ART[0].length * 2)
    assert.equal(canvas.height, MISSING_ART.length * 2)
    assert.ok(fills.filter((color) => color === PALETTE.m).length > 20, "placeholder should be mostly magenta")
    assert.ok(fills.includes(PALETTE.k), "placeholder should draw the dark question mark")
    spriteCanvas("no-such-sprite", 3)
    spriteCanvas("no-such-sprite", 2)
    assert.equal(warnings.length, 1, "warn once per unknown name")
    assert.match(warnings[0], /no-such-sprite/)
    spriteCanvas("token", 1)
    assert.equal(warnings.length, 1, "known names never warn")
    assert.deepEqual(spriteSize("no-such-sprite"), { w: MISSING_ART[0].length, h: MISSING_ART.length })
    assert.deepEqual(spriteSize("token"), { w: ART.token[0].length, h: ART.token.length })
  } finally {
    console.warn = originalWarn
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})
