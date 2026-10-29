/**
 * A small QR code encoder (ISO/IEC 18004) with no dependencies, for the facilitator page: the join URL
 * as an inline SVG the iPads scan. Byte mode, error correction level M, versions 1–10 (up to 213 bytes
 * at M), mask chosen by the standard penalty rules. Returns the module matrix; `qrSvg` draws it.
 *
 *   qrSvg("https://tokenquest.example/workshop?code=ABCD")  → '<svg ...>...</svg>'
 *   qrMatrix(text) → { size, modules: boolean[][] , version }
 *
 * Written from the specification tables (not copied from a library). tests/workshop-qr.test.js checks
 * the structure (finder patterns, timing, format bits) and decodes a code back with the same tables.
 */

/* Error correction level M: [total codewords, EC codewords per block, blocks group 1, data cw group 1, blocks group 2, data cw group 2] per version 1..10. */
const EC_M = [
  [26, 10, 1, 16, 0, 0],
  [44, 16, 1, 28, 0, 0],
  [70, 26, 1, 44, 0, 0],
  [100, 18, 2, 32, 0, 0],
  [134, 24, 2, 43, 0, 0],
  [172, 16, 4, 27, 0, 0],
  [196, 18, 4, 31, 0, 0],
  [242, 22, 2, 38, 2, 39],
  [292, 22, 3, 36, 2, 37],
  [346, 26, 4, 43, 1, 44],
]
/* Alignment pattern centre coordinates per version 2..10 (version 1 has none). */
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
const FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0] // level M, masks 0..7, BCH-coded and masked

/* GF(256) with the QR polynomial 0x11d. */
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]
})()

function gfMul(a, b) {
  if (!a || !b) return 0
  return EXP[LOG[a] + LOG[b]]
}

/** The Reed–Solomon generator polynomial for `degree` EC codewords. */
function generator(degree) {
  let poly = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

/** EC codewords for one block of data codewords. */
export function reedSolomon(data, degree) {
  const gen = generator(degree)
  const out = new Array(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ out.shift()
    out.push(0)
    if (factor) for (let i = 0; i < degree; i += 1) out[i] ^= gfMul(gen[i + 1], factor)
  }
  return out
}

/** The smallest version (1..10) whose level-M data capacity fits `bytes` in byte mode. */
export function versionFor(byteLength) {
  for (let v = 1; v <= 10; v += 1) {
    const [total, ecPer, g1, d1, g2, d2] = EC_M[v - 1]
    const dataCodewords = total - ecPer * (g1 + g2)
    const headerBits = 4 + (v < 10 ? 8 : 16)
    if (byteLength * 8 + headerBits <= dataCodewords * 8) return { version: v, dataCodewords, d1, g1, g2, d2, ecPer, total }
  }
  throw new RangeError(`QR: ${byteLength} bytes is more than version 10-M carries (213)`)
}

function bitsOf(bytes, version, dataCodewords) {
  const bits = []
  const push = (value, count) => {
    for (let i = count - 1; i >= 0; i -= 1) bits.push((value >> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) push(byte, 8)
  const capacity = dataCodewords * 8
  push(0, Math.min(4, capacity - bits.length))
  while (bits.length % 8) bits.push(0)
  const pads = [0xec, 0x11]
  for (let i = 0; bits.length < capacity; i += 1) push(pads[i % 2], 8)
  const codewords = []
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(""), 2))
  return codewords
}

/** Data codewords → interleaved data + EC codewords for the version's block structure. */
function interleave(codewords, spec) {
  const blocks = []
  let offset = 0
  for (let b = 0; b < spec.g1; b += 1) blocks.push(codewords.slice(offset, (offset += spec.d1)))
  for (let b = 0; b < spec.g2; b += 1) blocks.push(codewords.slice(offset, (offset += spec.d2)))
  const ecBlocks = blocks.map((block) => reedSolomon(block, spec.ecPer))
  const out = []
  const longest = Math.max(...blocks.map((block) => block.length))
  for (let i = 0; i < longest; i += 1) for (const block of blocks) if (i < block.length) out.push(block[i])
  for (let i = 0; i < spec.ecPer; i += 1) for (const block of ecBlocks) out.push(block[i])
  return out
}

function emptyMatrix(size) {
  return { modules: Array.from({ length: size }, () => new Array(size).fill(false)), reserved: Array.from({ length: size }, () => new Array(size).fill(false)) }
}

function setFunction(m, x, y, dark) {
  m.modules[y][x] = dark
  m.reserved[y][x] = true
}

function placeFinder(m, cx, cy) {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= m.modules.length || y >= m.modules.length) continue
      const d = Math.max(Math.abs(dx), Math.abs(dy))
      setFunction(m, x, y, d !== 2 && d !== 4)
    }
  }
}

function placeAlignment(m, cx, cy) {
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) setFunction(m, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
}

function placeFunctionPatterns(m, version) {
  const size = m.modules.length
  placeFinder(m, 3, 3)
  placeFinder(m, size - 4, 3)
  placeFinder(m, 3, size - 4)
  for (let i = 8; i < size - 8; i += 1) {
    setFunction(m, i, 6, i % 2 === 0)
    setFunction(m, 6, i, i % 2 === 0)
  }
  /* Alignment patterns everywhere on the grid except the three corners the finders occupy. */
  const centres = ALIGN[version - 1]
  const last = size - 7
  for (const cy of centres) {
    for (const cx of centres) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6)) continue
      placeAlignment(m, cx, cy)
    }
  }
  /* Format information areas (filled later) and the dark module. */
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      m.reserved[8][i] = true
      m.reserved[i][8] = true
    }
  }
  for (let i = 0; i < 8; i += 1) {
    m.reserved[8][size - 1 - i] = true
    m.reserved[size - 1 - i][8] = true
  }
  setFunction(m, 8, size - 8, true)
  /* Versions 7 and up carry their version number twice, BCH-coded, in 6×3 blocks beside two finders. */
  if (version >= 7) {
    const bits = versionBits(version)
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFunction(m, a, b, dark)
      setFunction(m, b, a, dark)
    }
  }
}

/** The 18-bit version information (6 bits of version + 12 BCH bits, generator 0x1f25). */
export function versionBits(version) {
  let rem = version
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

function placeData(m, codewords) {
  const size = m.modules.length
  const bits = []
  for (const cw of codewords) for (let i = 7; i >= 0; i -= 1) bits.push((cw >> i) & 1)
  let index = 0
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step
      for (const x of [right, right - 1]) {
        if (m.reserved[y][x]) continue
        m.modules[y][x] = index < bits.length ? bits[index] === 1 : false
        index += 1
      }
    }
    upward = !upward
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function applyMask(m, mask) {
  const size = m.modules.length
  const out = m.modules.map((row) => row.slice())
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!m.reserved[y][x] && MASKS[mask](x, y)) out[y][x] = !out[y][x]
  return out
}

function writeFormat(modules, mask) {
  const size = modules.length
  const bits = FORMAT_M[mask]
  const bit = (i) => ((bits >> i) & 1) === 1
  /* Around the top-left finder. */
  const left = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]
  left.forEach(([y, x], i) => {
    modules[y][x] = bit(14 - i)
  })
  /* Split copy: below the top-right finder and right of the bottom-left finder. */
  for (let i = 0; i < 8; i += 1) modules[8][size - 1 - i] = bit(i)
  for (let i = 0; i < 7; i += 1) modules[size - 1 - i][8] = bit(14 - i)
}

/** The standard penalty score (N1 = 3, N2 = 3, N3 = 40, N4 = 10) used to pick the mask. */
export function penalty(modules) {
  const size = modules.length
  let score = 0
  const runs = (get) => {
    for (let a = 0; a < size; a += 1) {
      let run = 1
      for (let b = 1; b < size; b += 1) {
        if (get(a, b) === get(a, b - 1)) {
          run += 1
          if (run === 5) score += 3
          else if (run > 5) score += 1
        } else run = 1
      }
    }
  }
  runs((y, x) => modules[y][x])
  runs((x, y) => modules[y][x])
  for (let y = 0; y < size - 1; y += 1) for (let x = 0; x < size - 1; x += 1) {
    const v = modules[y][x]
    if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += 3
  }
  const pattern = [true, false, true, true, true, false, true]
  const finderLike = (get, a) => {
    for (let b = 0; b <= size - 7; b += 1) {
      let ok = true
      for (let k = 0; k < 7 && ok; k += 1) if (get(a, b + k) !== pattern[k]) ok = false
      if (!ok) continue
      const before = b >= 4 && [0, 1, 2, 3].every((k) => get(a, b - 1 - k) === false)
      const after = b + 7 + 4 <= size && [0, 1, 2, 3].every((k) => get(a, b + 7 + k) === false)
      if (before || after) score += 40
    }
  }
  for (let a = 0; a < size; a += 1) {
    finderLike((y, x) => modules[y][x], a)
    finderLike((x, y) => modules[y][x], a)
  }
  let dark = 0
  for (const row of modules) for (const v of row) if (v) dark += 1
  const percent = (dark * 100) / (size * size)
  const k = Math.floor(Math.abs(percent - 50) / 5)
  score += k * 10
  return score
}

/** The module matrix for `text` (UTF-8, byte mode, level M). */
export function qrMatrix(text, { mask: forcedMask = null } = {}) {
  const bytes = Array.from(new TextEncoder().encode(String(text)))
  const spec = versionFor(bytes.length)
  const size = spec.version * 4 + 17
  const m = emptyMatrix(size)
  placeFunctionPatterns(m, spec.version)
  placeData(m, interleave(bitsOf(bytes, spec.version, spec.dataCodewords), spec))
  let best = null
  const candidates = forcedMask === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forcedMask]
  for (const mask of candidates) {
    const modules = applyMask(m, mask)
    writeFormat(modules, mask)
    const score = penalty(modules)
    if (!best || score < best.score) best = { mask, modules, score }
  }
  return { size, version: spec.version, mask: best.mask, modules: best.modules }
}

/** An inline SVG (crisp squares, 4-module quiet zone) of the code for `text`. */
export function qrSvg(text, { scale = 4, dark = "#0b0b17", light = "#ffffff", quiet = 4, label = "QR code" } = {}) {
  const { size, modules } = qrMatrix(text)
  const total = size + quiet * 2
  const rects = []
  for (let y = 0; y < size; y += 1) {
    let x = 0
    while (x < size) {
      if (!modules[y][x]) {
        x += 1
        continue
      }
      let run = 1
      while (x + run < size && modules[y][x + run]) run += 1
      rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="${run}" height="1"/>`)
      x += run
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * scale}" height="${total * scale}" shape-rendering="crispEdges" role="img" aria-label="${escapeAttr(label)}"><rect width="${total}" height="${total}" fill="${light}"/><g fill="${dark}">${rects.join("")}</g></svg>`
}

function escapeAttr(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
}

/* ---------- a decoder for the tests (same tables, reverse direction) ---------- */

/** Reads the byte-mode payload back out of a matrix made by qrMatrix (no error correction: the tests check a clean code). */
export function qrDecode(matrix) {
  const { size, modules } = matrix
  const version = (size - 17) / 4
  const m = emptyMatrix(size)
  placeFunctionPatterns(m, version)
  /* Format bits → mask. */
  const left = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]
  let format = 0
  left.forEach(([y, x]) => {
    format = (format << 1) | (modules[y][x] ? 1 : 0)
  })
  const mask = FORMAT_M.indexOf(format)
  if (mask < 0) throw new Error("QR: format information does not decode as level M")
  const unmasked = modules.map((row, y) => row.map((v, x) => (!m.reserved[y][x] && MASKS[mask](x, y) ? !v : v)))
  const bits = []
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step
      for (const x of [right, right - 1]) {
        if (m.reserved[y][x]) continue
        bits.push(unmasked[y][x] ? 1 : 0)
      }
    }
    upward = !upward
  }
  const codewords = []
  for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(""), 2))
  const row = EC_M[version - 1]
  const blockSpec = { g1: row[2], d1: row[3], g2: row[4], d2: row[5], ecPer: row[1] }
  const blocks = []
  for (let b = 0; b < blockSpec.g1; b += 1) blocks.push(new Array(blockSpec.d1))
  for (let b = 0; b < blockSpec.g2; b += 1) blocks.push(new Array(blockSpec.d2))
  let index = 0
  const longest = Math.max(...blocks.map((block) => block.length))
  for (let i = 0; i < longest; i += 1) for (const block of blocks) if (i < block.length) block[i] = codewords[index++]
  const data = blocks.flat()
  const dataBits = []
  for (const cw of data) for (let i = 7; i >= 0; i -= 1) dataBits.push((cw >> i) & 1)
  const read = (count) => {
    let value = 0
    for (let i = 0; i < count; i += 1) value = (value << 1) | dataBits.shift()
    return value
  }
  const mode = read(4)
  if (mode !== 0b0100) throw new Error(`QR: mode ${mode} is not byte mode`)
  const length = read(version < 10 ? 8 : 16)
  const bytes = []
  for (let i = 0; i < length; i += 1) bytes.push(read(8))
  return new TextDecoder().decode(new Uint8Array(bytes))
}
