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

export function normalizeEmail(input) {
  return String(input ?? "").trim().toLowerCase()
}

/** One @, a dotted domain, no spaces, at most 254 characters. */
export function validateEmail(input) {
  const email = normalizeEmail(input)
  if (!email) return { ok: false, email: "", error: "Enter your email." }
  if (email.length > 254 || /\s/.test(email)) {
    return { ok: false, email: "", error: "Enter a valid email." }
  }
  const at = email.indexOf("@")
  if (at <= 0 || at !== email.lastIndexOf("@")) {
    return { ok: false, email: "", error: "Enter a valid email." }
  }
  const domain = email.slice(at + 1)
  const labels = domain.split(".")
  const domainOk = labels.length >= 2 && labels.every((label) => /^[a-z0-9-]+$/i.test(label) && !label.startsWith("-") && !label.endsWith("-"))
  if (!domainOk) return { ok: false, email: "", error: "Enter a valid email." }
  return { ok: true, email, error: "" }
}
