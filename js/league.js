const MAX_ENTRIES = 200

export function sortLeague(entries) {
  return entries
    .slice()
    .sort((a, b) => b.score - a.score || a.at - b.at || a.name.localeCompare(b.name))
}

export function upsertEntry(entries, entry) {
  const key = entry.name.toLocaleLowerCase()
  const next = entries.slice()
  const index = next.findIndex((item) => item.name.toLocaleLowerCase() === key)
  if (index === -1) next.push(entry)
  else if (entry.score > next[index].score) {
    next[index] = {
      ...entry,
      email: entry.email || next[index].email || "",
      consent: entry.consent === true || next[index].consent === true,
      consentAt: entry.consentAt ?? next[index].consentAt ?? null,
    }
  } else if (entry.email && entry.email !== next[index].email) {
    next[index] = {
      ...next[index],
      email: entry.email,
      consent: entry.consent === true,
      consentAt: entry.consentAt ?? next[index].consentAt ?? null,
    }
  }
  return sortLeague(next).slice(0, MAX_ENTRIES)
}

const STAFF_FIELDS = ["name", "email", "score", "useCase", "costPerM", "at", "consent", "consentAt"]

/** Rows for the staff download. The public board never uses this. */
export function staffRows(entries) {
  return sortLeague(entries).map((entry) => ({
    name: entry.name,
    email: entry.email || "",
    score: entry.score,
    useCase: entry.useCase || "",
    costPerM: Number.isFinite(entry.costPerM) ? entry.costPerM : null,
    at: entry.at,
    consent: entry.consent === true,
    consentAt: entry.consentAt ?? null,
  }))
}

export function leagueJson(entries) {
  return JSON.stringify(staffRows(entries), null, 2)
}

function csvCell(value) {
  const text = value == null ? "" : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function leagueCsv(entries) {
  const lines = [STAFF_FIELDS.join(",")]
  for (const row of staffRows(entries)) {
    lines.push(STAFF_FIELDS.map((key) => csvCell(key === "consent" ? String(row.consent) : row[key])).join(","))
  }
  return lines.join("\n")
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]))
}

/** Public board markup: name and score only. */
export function boardHtml(entries) {
  const rows = sortLeague(entries).map((entry) => `<li><span class="lname">${escapeHtml(entry.name)}</span><span class="lscore">${entry.score}</span></li>`)
  return `<ol class="league">${rows.join("")}</ol>`
}

export function rankOf(entries, name) {
  const index = sortLeague(entries).findIndex(
    (item) => item.name.toLocaleLowerCase() === String(name).toLocaleLowerCase(),
  )
  return index === -1 ? null : index + 1
}

export function rivalFor(entries, score) {
  const sorted = sortLeague(entries)
  const above = sorted.filter((entry) => entry.score > score)
  return above.length ? above[above.length - 1] : null
}

export function ordinal(rank) {
  const mod100 = rank % 100
  if (mod100 >= 11 && mod100 <= 13) return `${rank}TH`
  const suffix = { 1: "ST", 2: "ND", 3: "RD" }[rank % 10] || "TH"
  return `${rank}${suffix}`
}
