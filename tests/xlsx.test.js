import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import zlib from "node:zlib"
import { buildWorkbook } from "../server/export.mjs"
import { buildXlsx, columnLetter, crc32, readZip, xmlEscape, zipStored } from "../server/xlsx.mjs"

const REQUIRED_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/core.xml",
  "docProps/app.xml",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/styles.xml",
  "xl/worksheets/sheet1.xml",
  "xl/worksheets/sheet2.xml",
]

const ATTEMPTS = [
  { playedAt: "2026-10-08T09:00:00.000Z", name: "Ada Lovelace", email: "ada@example.com", score: 1200, useCase: "Chat + RAG", scenario: "London launch", costPerMTok: 1.2345678, profitPerHour: 5000.5, fteEquivalent: 12.25, humanHoursPerYear: 22050, annualSavings: 450000.123456, consent: true, consentAt: "2026-10-08T08:59:00.000Z" },
  { playedAt: "2026-10-08T09:30:00.000Z", name: "Ada Lovelace", email: "ada@example.com", score: 900, useCase: "Drug discovery", scenario: "Ashburn", costPerMTok: 2, profitPerHour: -120, fteEquivalent: 1, humanHoursPerYear: 1800, annualSavings: -9000, consent: true, consentAt: "2026-10-08T08:59:00.000Z" },
  { playedAt: "2026-10-08T10:00:00.000Z", name: "Zoë O'Brien-Smith <&> \"quoted\"", email: "zoe@example.org", score: 1500, useCase: "  leading & trailing  ", costPerMTok: null, profitPerHour: null, consent: true, consentAt: "2026-10-08T09:58:00.000Z" },
]

const PLAYER_HEADERS = ["Name", "Email", "Attempts", "Best Score", "Latest Score", "Best Cost per 1M tokens ($)", "Best Use Case", "First Played", "Last Played", "Consent", "Consent At", "Best people-power", "Best annual saving"]
const ATTEMPT_HEADERS = ["Played At", "Name", "Email", "Use Case", "Scenario", "Score", "Cost per 1M tokens ($)", "Profit per hour ($)", "People-power (FTE)", "Human hours / year", "Annual saving ($)"]

const python = spawnSync("python3", ["-c", "import zipfile, xml.dom.minidom"], { encoding: "utf8" })
const hasPython = python.status === 0
const hasOpenpyxl = hasPython && spawnSync("python3", ["-c", "import openpyxl"], { encoding: "utf8" }).status === 0
const hasUnzip = spawnSync("unzip", ["-v"], { encoding: "utf8" }).status === 0

function runPython(script, input) {
  const result = spawnSync("python3", ["-c", script], { input, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`python3 failed: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

test("crc32 matches the reference vector and Node's zlib", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926)
  assert.equal(crc32(Buffer.alloc(0)), 0)
  if (typeof zlib.crc32 === "function") {
    const sample = Buffer.from("Token Quest \u00e9\u00e8 \ud83d\ude80 bytes", "utf8")
    assert.equal(crc32(sample), zlib.crc32(sample))
  }
})

test("column letters and XML escaping", () => {
  assert.equal(columnLetter(0), "A")
  assert.equal(columnLetter(25), "Z")
  assert.equal(columnLetter(26), "AA")
  assert.equal(columnLetter(701), "ZZ")
  assert.equal(columnLetter(702), "AAA")
  assert.equal(xmlEscape(`<a href="x">Tom & Jerry's</a>\u0000\u0007`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;")
})

test("zipStored round-trips through the reader with valid CRCs", () => {
  const entries = [
    { name: "hello.txt", data: "hello world" },
    { name: "dir/empty.bin", data: Buffer.alloc(0) },
    { name: "dir/bytes.bin", data: Buffer.from([0, 1, 2, 253, 254, 255]) },
  ]
  const zip = zipStored(entries, new Date(2026, 9, 8, 12, 30, 30))
  assert.equal(zip.readUInt32LE(0), 0x04034b50)
  const back = readZip(zip)
  assert.deepEqual(back.map((entry) => entry.name), entries.map((entry) => entry.name))
  assert.ok(back.every((entry) => entry.crcOk), "every CRC verifies")
  assert.equal(back[0].data.toString(), "hello world")
  assert.deepEqual([...back[2].data], [0, 1, 2, 253, 254, 255])
})

test("the leaderboard workbook has every OOXML part and the CRCs verify", () => {
  const workbook = buildWorkbook(ATTEMPTS, { now: new Date("2026-10-08T12:00:00Z") })
  assert.equal(workbook.subarray(0, 2).toString(), "PK")
  const entries = readZip(workbook)
  const names = entries.map((entry) => entry.name)
  assert.equal(names[0], "[Content_Types].xml", "content types is the first entry")
  for (const part of REQUIRED_PARTS) assert.ok(names.includes(part), `missing ${part}`)
  assert.ok(entries.every((entry) => entry.crcOk), "every CRC verifies")
  if (typeof zlib.crc32 === "function") for (const entry of entries) assert.equal(zlib.crc32(entry.data), entry.crc, `${entry.name} crc`)

  const text = Object.fromEntries(entries.map((entry) => [entry.name, entry.data.toString("utf8")]))
  assert.match(text["xl/workbook.xml"], /<sheet name="Players" sheetId="1" r:id="rId1"\/>/)
  assert.match(text["xl/workbook.xml"], /<sheet name="Attempts" sheetId="2" r:id="rId2"\/>/)
  assert.match(text["[Content_Types].xml"], /PartName="\/xl\/worksheets\/sheet2\.xml"/)

  const players = text["xl/worksheets/sheet1.xml"]
  assert.match(players, /<row r="1"><c r="A1" t="inlineStr" s="1"><is><t>Name<\/t><\/is><\/c>/, "bold header row")
  assert.match(players, /<c r="K1" t="inlineStr" s="1"><is><t>Consent At<\/t><\/is><\/c>/)
  assert.match(players, /<c r="L1" t="inlineStr" s="1"><is><t>Best people-power<\/t><\/is><\/c><c r="M1" t="inlineStr" s="1"><is><t>Best annual saving<\/t><\/is><\/c><\/row>/, "thirteen player columns")
  assert.deepEqual([...players.matchAll(/<row r="1">(.*?)<\/row>/g)][0][1].match(/<t>[^<]*<\/t>/g).map((cell) => cell.slice(3, -4)), PLAYER_HEADERS)
  assert.match(players, /<cols><col min="1" max="1" width="26" customWidth="1"\/>/, "column widths")
  assert.match(players, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/, "frozen header")
  assert.match(players, /<row r="2"><c r="A2" t="inlineStr"><is><t>Zoë O&apos;Brien-Smith &lt;&amp;&gt; &quot;quoted&quot;<\/t><\/is><\/c>/, "best player first, escaped")
  assert.match(players, /<c r="C3"><v>2<\/v><\/c><c r="D3"><v>1200<\/v><\/c><c r="E3"><v>900<\/v><\/c><c r="F3"><v>1.2346<\/v><\/c>/, "numeric cells for attempts/best/latest/cost")
  assert.match(players, /<c r="J3" t="b"><v>1<\/v><\/c>/, "consent is a boolean cell")
  assert.match(players, /<c r="H3" t="inlineStr"><is><t>2026-10-08T09:00:00.000Z<\/t><\/is><\/c>/, "ISO date text")
  assert.match(players, /<c r="L3"><v>12.25<\/v><\/c><c r="M3"><v>450000.1235<\/v><\/c>/, "best people-power and saving follow the best attempt")
  assert.ok(!players.includes('<c r="F2"'), "null cost leaves the cell empty")
  assert.ok(!players.includes('<c r="L2"') && !players.includes('<c r="M2"'), "missing people-power leaves the cells empty")

  const attempts = text["xl/worksheets/sheet2.xml"]
  assert.deepEqual([...attempts.matchAll(/<row r="1">(.*?)<\/row>/g)][0][1].match(/<t>[^<]*<\/t>/g).map((cell) => cell.slice(3, -4)), ATTEMPT_HEADERS)
  assert.match(attempts, /<c r="H1" t="inlineStr" s="1"><is><t>Profit per hour \(\$\)<\/t><\/is><\/c>/)
  assert.match(attempts, /<row r="2"><c r="A2" t="inlineStr"><is><t>2026-10-08T10:00:00.000Z<\/t><\/is><\/c>/, "newest attempt first")
  assert.match(attempts, /<t xml:space="preserve">  leading &amp; trailing  <\/t>/, "whitespace preserved")
  assert.match(attempts, /<c r="E4" t="inlineStr"><is><t>London launch<\/t><\/is><\/c><c r="F4"><v>1200<\/v><\/c>/, "scenario then score")
  assert.match(attempts, /<c r="H4"><v>5000.5<\/v><\/c><c r="I4"><v>12.25<\/v><\/c><c r="J4"><v>22050<\/v><\/c><c r="K4"><v>450000.1235<\/v><\/c>/)
  assert.match(attempts, /<c r="H3"><v>-120<\/v><\/c><c r="I3"><v>1<\/v><\/c><c r="J3"><v>1800<\/v><\/c><c r="K3"><v>-9000<\/v><\/c>/)
  assert.ok(!/<c r="[IJK]2"/.test(attempts), "attempts without people-power leave those cells empty")
  assert.ok(!/[\u0000-\u0008]/.test(players + attempts), "no control characters")
})

test("buildXlsx handles an empty sheet, odd sheet names and non-finite numbers", () => {
  const workbook = buildXlsx([
    { name: "Bad[]:*?/\\Name that is far too long for Excel", columns: ["A", "B"], rows: [] },
    { name: "Raw", rows: [[Infinity, NaN, true, false, new Date("2026-01-02T03:04:05Z"), null, "x".repeat(40000)]] },
  ])
  const text = Object.fromEntries(readZip(workbook).map((entry) => [entry.name, entry.data.toString("utf8")]))
  assert.match(text["xl/workbook.xml"], /<sheet name="Bad Name that is far too long f" sheetId="1"/)
  assert.match(text["xl/worksheets/sheet1.xml"], /<dimension ref="A1:B1"\/>/)
  const raw = text["xl/worksheets/sheet2.xml"]
  assert.match(raw, /<c r="A1" t="inlineStr"><is><t>Infinity<\/t><\/is><\/c><c r="B1" t="inlineStr"><is><t>NaN<\/t><\/is><\/c><c r="C1" t="b"><v>1<\/v><\/c><c r="D1" t="b"><v>0<\/v><\/c>/)
  assert.match(raw, /<c r="E1" t="inlineStr"><is><t>2026-01-02T03:04:05.000Z<\/t><\/is><\/c>/)
  assert.equal(/<c r="G1" t="inlineStr"><is><t>(x+)<\/t>/.exec(raw)[1].length, 32767, "cell text is clipped to Excel's limit")
  assert.throws(() => buildXlsx([]), /at least one sheet/)
})

test("python zipfile verifies the archive and every XML part is well-formed", { skip: !hasPython && "python3 is not installed" }, () => {
  const workbook = buildWorkbook(ATTEMPTS)
  const out = runPython(
    `
import io, sys, zipfile, xml.dom.minidom
data = sys.stdin.buffer.read()
zf = zipfile.ZipFile(io.BytesIO(data))
bad = zf.testzip()
assert bad is None, "CRC failed for %s" % bad
for info in zf.infolist():
    assert info.compress_type == zipfile.ZIP_STORED, info.filename
    if info.filename.endswith(".xml") or info.filename.endswith(".rels"):
        xml.dom.minidom.parseString(zf.read(info.filename))
print("ok", len(zf.namelist()))
`,
    workbook,
  )
  assert.equal(out.trim(), `ok ${REQUIRED_PARTS.length}`)
})

test("unzip -t accepts the archive", { skip: !hasUnzip && "unzip is not installed" }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "token-quest-xlsx-"))
  try {
    const file = path.join(dir, "book.xlsx")
    writeFileSync(file, buildWorkbook(ATTEMPTS))
    const result = spawnSync("unzip", ["-t", file], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /No errors detected/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("openpyxl round-trips the workbook", { skip: !hasOpenpyxl && "openpyxl is not installed" }, () => {
  const workbook = buildWorkbook(ATTEMPTS)
  const out = runPython(
    `
import io, json, sys, openpyxl
wb = openpyxl.load_workbook(io.BytesIO(sys.stdin.buffer.read()))
players = wb["Players"]
attempts = wb["Attempts"]
print(json.dumps({
  "sheets": wb.sheetnames,
  "header": [c.value for c in players[1]],
  "bold": players["A1"].font.bold,
  "first": [c.value for c in players[2]],
  "second": [c.value for c in players[3]],
  "attempts": attempts.max_row - 1,
}))
`,
    workbook,
  )
  const parsed = JSON.parse(out)
  assert.deepEqual(parsed.sheets, ["Players", "Attempts"])
  assert.deepEqual(parsed.header, PLAYER_HEADERS)
  assert.equal(parsed.bold, true)
  assert.equal(parsed.first[0], "Zoë O'Brien-Smith <&> \"quoted\"")
  assert.equal(parsed.second[1], "ada@example.com")
  assert.equal(parsed.second[2], 2)
  assert.equal(parsed.second[3], 1200)
  assert.equal(parsed.second[9], true)
  assert.equal(parsed.attempts, 3)
})
