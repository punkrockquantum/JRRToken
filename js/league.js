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
  else if (entry.score > next[index].score) next[index] = entry
  return sortLeague(next).slice(0, MAX_ENTRIES)
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
