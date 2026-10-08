export function normalizeName(input) {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, " ")
}

export function validateName(input) {
  const name = normalizeName(input)
  if (!name) return { ok: false, name: "", error: "Enter your full name." }
  if (name.length > 40) return { ok: false, name: "", error: "That name is too long." }
  const parts = name.split(" ")
  if (parts.length < 2 || parts.length > 6) {
    return { ok: false, name: "", error: "Use your first and last name." }
  }
  const partOk = /^[\p{L}][\p{L}'-]+$/u
  if (!parts.every((part) => partOk.test(part))) {
    return { ok: false, name: "", error: "Use letters, spaces, hyphens, and apostrophes." }
  }
  return { ok: true, name, error: "" }
}
