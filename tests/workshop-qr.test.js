/**
 * The facilitator page's QR code (js/workshop/qr.js): a dependency-free byte-mode encoder at level M.
 * Structure (finders, timing, dark module, format bits), Reed–Solomon against a known vector, every
 * mask decodes back to the text, and the SVG is a crisp inline drawing.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { penalty, qrDecode, qrMatrix, qrSvg, reedSolomon, versionBits, versionFor } from "../js/workshop/qr.js"

const JOIN_URL = "https://tokenquest.tokenquest.workers.dev/workshop?code=ABCD"

test("qr: versions grow with the payload; too much text is a RangeError", () => {
  assert.equal(versionFor(1).version, 1)
  assert.equal(versionFor(14).version, 1, "version 1-M carries 14 bytes")
  assert.equal(versionFor(15).version, 2)
  assert.equal(versionFor(26).version, 2)
  assert.equal(versionFor(27).version, 3)
  assert.equal(versionFor(42).version, 3)
  assert.equal(versionFor(62).version, 4)
  assert.equal(versionFor(213).version, 10)
  assert.throws(() => versionFor(214), RangeError)
  assert.equal(qrMatrix(JOIN_URL).version, 4, `${JOIN_URL.length} bytes is a version 4 code`)
})

test("qr: Reed–Solomon matches the worked example from the specification (HELLO WORLD, version 1-M)", () => {
  /* "HELLO WORLD" in alphanumeric mode, 1-M: the 16 data codewords and the 10 EC codewords every tutorial derives. */
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
  assert.deepEqual(reedSolomon(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
})

test("qr: the matrix has three finders with separators, timing rows, the dark module and level-M format bits", () => {
  const { size, modules, mask } = qrMatrix("hello")
  assert.equal(size, 21)
  const finder = (ox, oy) => {
    for (let y = 0; y < 7; y += 1) for (let x = 0; x < 7; x += 1) {
      const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3))
      assert.equal(modules[oy + y][ox + x], ring !== 2, `finder at ${ox},${oy} module ${x},${y}`)
    }
  }
  finder(0, 0)
  finder(size - 7, 0)
  finder(0, size - 7)
  for (let i = 0; i < 8; i += 1) {
    assert.equal(modules[7][i], false, "separator under the top-left finder")
    assert.equal(modules[i][7], false, "separator right of the top-left finder")
  }
  for (let i = 8; i < size - 8; i += 1) {
    assert.equal(modules[6][i], i % 2 === 0, `timing row at ${i}`)
    assert.equal(modules[i][6], i % 2 === 0, `timing column at ${i}`)
  }
  assert.equal(modules[size - 8][8], true, "the dark module")
  assert.ok(mask >= 0 && mask <= 7)
  /* The two format copies agree. */
  const first = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]].map(([y, x]) => modules[y][x])
  const second = []
  for (let i = 0; i < 7; i += 1) second.push(modules[size - 1 - i][8])
  for (let i = 7; i >= 0; i -= 1) second.push(modules[8][size - 1 - i])
  assert.deepEqual(second, first)
  assert.equal(first.slice(0, 2).join(), "true,false", "level M starts the format string with 10")
})

test("qr: every mask decodes back to the text; the chosen mask has the lowest penalty", () => {
  for (const text of ["A", "hello", JOIN_URL, "http://127.0.0.1:8789/workshop?code=XY23", "ünïcödé → ✓ bytes", "x".repeat(213)]) {
    const best = qrMatrix(text)
    assert.equal(qrDecode(best), text)
    let lowest = Infinity
    for (let mask = 0; mask < 8; mask += 1) {
      const forced = qrMatrix(text, { mask })
      assert.equal(forced.mask, mask)
      assert.equal(qrDecode(forced), text, `mask ${mask} for ${text.slice(0, 20)}`)
      lowest = Math.min(lowest, penalty(forced.modules))
    }
    assert.equal(penalty(best.modules), lowest)
  }
  assert.throws(() => qrMatrix("x".repeat(214)), RangeError)
})

test("qr: alignment patterns sit on the grid for version 2 and up and never on a finder", () => {
  const v2 = qrMatrix("x".repeat(20))
  assert.equal(v2.version, 2)
  assert.equal(v2.size, 25)
  /* Centre (18,18): a 5×5 ring with a dark centre and a light inner ring. */
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) assert.equal(v2.modules[18 + dy][18 + dx], Math.max(Math.abs(dx), Math.abs(dy)) !== 1, `alignment ${dx},${dy}`)
  assert.equal(qrDecode(v2), "x".repeat(20))
  const v7 = qrMatrix("x".repeat(120))
  assert.equal(v7.version, 7)
  assert.equal(qrDecode(v7), "x".repeat(120))
})

test("qr: versions 7+ carry the BCH-coded version number in both 6×3 blocks (specification table values)", () => {
  assert.equal(versionBits(7), 0x07c94)
  assert.equal(versionBits(8), 0x085bc)
  assert.equal(versionBits(9), 0x09a99)
  assert.equal(versionBits(10), 0x0a4d3)
  const { size, modules } = qrMatrix("x".repeat(120))
  const bits = versionBits(7)
  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >> i) & 1) === 1
    assert.equal(modules[Math.floor(i / 3)][size - 11 + (i % 3)], dark, `top-right version bit ${i}`)
    assert.equal(modules[size - 11 + (i % 3)][Math.floor(i / 3)], dark, `bottom-left version bit ${i}`)
  }
  assert.equal(qrMatrix("x".repeat(60)).version, 4, "small codes carry no version blocks")
})

test("qr: the SVG is inline, crisp, with a 4-module quiet zone and no external references", () => {
  const svg = qrSvg(JOIN_URL, { label: "Join: scan me" })
  assert.ok(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""))
  assert.ok(svg.includes('viewBox="0 0 41 41"'), "version 4 is 33 modules plus 8 of quiet zone")
  assert.ok(svg.includes('shape-rendering="crispEdges"'))
  assert.ok(svg.includes('aria-label="Join: scan me"'))
  assert.ok(!/href|<image|<script|url\(/.test(svg))
  assert.ok(svg.includes('<rect x="4" y="4" width="7" height="1"/>'), "the top-left finder's first row starts after the quiet zone")
  assert.ok(qrSvg("<&>").includes('aria-label="QR code"'))
})
