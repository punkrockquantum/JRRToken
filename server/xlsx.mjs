/**
 * Minimal .xlsx writer (and a small zip reader used by tests) built on Node built-ins only.
 *
 * The workbook is a zip of OOXML parts with STORED (uncompressed) entries and a CRC32
 * implemented here. Strings are written as inline strings, numbers as numeric cells,
 * booleans as boolean cells and dates as ISO text so the file is unambiguous in Excel,
 * Numbers, LibreOffice and openpyxl.
 */
import { inflateRawSync } from "node:zlib"

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}

/** Standard CRC-32 (IEEE 802.3), the one zip uses. */
export function crc32(buffer, seed = 0) {
  let crc = (seed ^ 0xffffffff) >>> 0
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

/** Builds a zip archive with STORED entries. `entries` is [{ name, data: Buffer | string }]. */
export function zipStored(entries, date = new Date()) {
  const { time, day } = dosDateTime(date)
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8")
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8")
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed to extract (2.0)
    local.writeUInt16LE(0x0800, 6) // general purpose flags: UTF-8 names
    local.writeUInt16LE(0, 8) // compression: STORED
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra length
    central.writeUInt16LE(0, 32) // comment length
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE(0, 38) // external attributes
    central.writeUInt32LE(offset, 42)

    locals.push(local, name, data)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, ...centrals, end])
}

/** Reads a (non zip64) archive back: [{ name, data, size, crc, crcOk }]. STORED and DEFLATE entries supported. */
export function readZip(buffer) {
  const minPos = Math.max(0, buffer.length - 22 - 0xffff)
  let eocd = -1
  for (let pos = buffer.length - 22; pos >= minPos; pos -= 1) {
    if (buffer.readUInt32LE(pos) === 0x06054b50) {
      eocd = pos
      break
    }
  }
  if (eocd < 0) throw new Error("Not a zip file: end of central directory not found")
  const count = buffer.readUInt16LE(eocd + 10)
  let pos = buffer.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("Bad central directory entry")
    const method = buffer.readUInt16LE(pos + 10)
    const crc = buffer.readUInt32LE(pos + 16)
    const compressedSize = buffer.readUInt32LE(pos + 20)
    const size = buffer.readUInt32LE(pos + 24)
    const nameLength = buffer.readUInt16LE(pos + 28)
    const extraLength = buffer.readUInt16LE(pos + 30)
    const commentLength = buffer.readUInt16LE(pos + 32)
    const localOffset = buffer.readUInt32LE(pos + 42)
    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLength)
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Bad local header for ${name}`)
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    let data = buffer.subarray(start, start + compressedSize)
    if (method === 8) data = inflateRawSync(data)
    else if (method !== 0) throw new Error(`Unsupported compression method ${method} for ${name}`)
    entries.push({ name, data, size, crc, crcOk: data.length === size && crc32(data) === crc })
    pos += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const MAX_CELL_TEXT = 32767

/** Escapes text for XML content and attributes and drops characters XML 1.0 forbids. */
export function xmlEscape(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLetter(index) {
  let n = index + 1
  let letters = ""
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

function sheetName(name, index) {
  const clean = String(name ?? "")
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31)
    .trim()
  return clean || `Sheet${index + 1}`
}

function cellXml(ref, value, style) {
  const s = style ? ` s="${style}"` : ""
  if (value === null || value === undefined || value === "") return ""
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return textCell(ref, String(value), s)
    return `<c r="${ref}"${s}><v>${value}</v></c>`
  }
  if (typeof value === "boolean") return `<c r="${ref}" t="b"${s}><v>${value ? 1 : 0}</v></c>`
  if (value instanceof Date) return textCell(ref, Number.isNaN(value.getTime()) ? "" : value.toISOString(), s)
  return textCell(ref, String(value), s)
}

function textCell(ref, text, s) {
  const clipped = text.length > MAX_CELL_TEXT ? text.slice(0, MAX_CELL_TEXT) : text
  const preserve = /^\s|\s$/.test(clipped) ? ' xml:space="preserve"' : ""
  return `<c r="${ref}" t="inlineStr"${s}><is><t${preserve}>${xmlEscape(clipped)}</t></is></c>`
}

function sheetXml(sheet) {
  const columns = sheet.columns || []
  const header = columns.map((column) => (typeof column === "string" ? column : column.header))
  const rows = header.length ? [header, ...(sheet.rows || [])] : [...(sheet.rows || [])]
  const width = Math.max(1, header.length, ...rows.map((row) => row.length))
  const cols = columns.length
    ? `<cols>${columns
        .map((column, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(column.width) > 0 ? Number(column.width) : 12}" customWidth="1"/>`)
        .join("")}</cols>`
    : ""
  const views = header.length
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    : ""
  const data = rows
    .map((row, r) => {
      const cells = row.map((value, c) => cellXml(`${columnLetter(c)}${r + 1}`, value, r === 0 && header.length ? 1 : 0)).join("")
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join("")
  const dimension = `<dimension ref="A1:${columnLetter(width - 1)}${Math.max(1, rows.length)}"/>`
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dimension}${views}${cols}<sheetData>${data}</sheetData></worksheet>`
}

const STYLES = `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

/**
 * Builds a workbook. `sheets` is [{ name, columns: [{ header, width }] | string[], rows: any[][] }].
 * Returns the .xlsx file as a Buffer.
 */
export function buildXlsx(sheets, { title = "Workbook", creator = "Token Quest", created = new Date() } = {}) {
  if (!Array.isArray(sheets) || sheets.length === 0) throw new Error("buildXlsx needs at least one sheet")
  const names = new Set()
  const sheetParts = sheets.map((sheet, index) => {
    let name = sheetName(sheet.name, index)
    while (names.has(name.toLowerCase())) name = sheetName(`${name.slice(0, 28)}-${index + 1}`, index)
    names.add(name.toLowerCase())
    return { name, xml: sheetXml(sheet), file: `xl/worksheets/sheet${index + 1}.xml` }
  })
  const stamp = Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString()
  const contentTypes =
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheetParts.map((part) => `<Override PartName="/${part.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>"
  const rootRels =
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    "</Relationships>"
  const workbook =
    `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    sheetParts.map((part, i) => `<sheet name="${xmlEscape(part.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    "</sheets></workbook>"
  const workbookRels =
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheetParts.map((part, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheetParts.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>"
  const core =
    `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${xmlEscape(title)}</dc:title><dc:creator>${xmlEscape(creator)}</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
    "</cp:coreProperties>"
  const app = `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${xmlEscape(creator)}</Application></Properties>`

  return zipStored(
    [
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "_rels/.rels", data: rootRels },
      { name: "docProps/core.xml", data: core },
      { name: "docProps/app.xml", data: app },
      { name: "xl/workbook.xml", data: workbook },
      { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
      { name: "xl/styles.xml", data: STYLES },
      ...sheetParts.map((part) => ({ name: part.file, data: part.xml })),
    ],
    created,
  )
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
