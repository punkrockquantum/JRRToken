/**
 * Workshop mode: small DOM helpers shared by the three pages. No framework: `el("button.btn", { onclick }, "GO")`
 * builds elements, `mount(root, nodes)` replaces a screen, `toast(text)` shows a one-line 8-bit message.
 */

/** el("div.panel#x", { attr: value, onclick: fn, dataset: {...} }, ...children) */
export function el(spec, attrs = {}, ...children) {
  const [tagAndId, ...classes] = spec.split(".")
  const [tag, id] = tagAndId.split("#")
  const node = document.createElement(tag || "div")
  if (id) node.id = id
  if (classes.length) node.className = classes.join(" ")
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue
    if (name.startsWith("on") && typeof value === "function") node.addEventListener(name.slice(2), value)
    else if (name === "dataset") Object.assign(node.dataset, value)
    else if (name === "style" && typeof value === "object") Object.assign(node.style, value)
    else if (name === "className") node.className = value
    else if (name === "html") node.innerHTML = value
    else if (name in node && typeof node[name] !== "object" && name !== "list") node[name] = value
    else node.setAttribute(name, value === true ? "" : String(value))
  }
  append(node, children)
  return node
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

/** Replaces the root's children with `nodes` (keeps scroll position at the top). */
export function mount(root, ...nodes) {
  root.replaceChildren()
  append(root, nodes)
  return root
}

/** A short message at the bottom of the screen; `kind` is "" | "ok" | "warn" | "bad". */
export function toast(text, kind = "", { ms = 2600 } = {}) {
  let holder = document.getElementById("toast")
  if (!holder) {
    holder = el("div#toast.toast", { role: "status", "aria-live": "polite" })
    document.body.append(holder)
  }
  holder.textContent = text
  holder.className = `toast show ${kind}`.trim()
  clearTimeout(holder._timer)
  holder._timer = setTimeout(() => {
    holder.className = "toast"
  }, ms)
  return holder
}

/** The status chip for a station: text and class. */
export function statusChip(status) {
  const kind = { "not started": "idle", "in progress": "work", pitched: "pitched", approved: "ok", "sent back": "back" }[status] || "idle"
  return el("span.chip", { className: `chip ${kind}` }, status.toUpperCase())
}

/** A big digit keypad for the 4-digit host code / 6-digit PIN with one onchange(value). */
export function keypad({ length = 4, onchange, onsubmit, initial = "" } = {}) {
  let value = initial
  const dots = el("div.key-value", { "aria-live": "polite" })
  const render = () => {
    dots.replaceChildren(...Array.from({ length }, (_, i) => el("span.key-dot", { className: `key-dot ${i < value.length ? "on" : ""}` }, i < value.length ? "•" : "")))
    onchange?.(value)
  }
  const press = (digit) => {
    if (value.length >= length) return
    value += digit
    render()
    if (value.length === length) onsubmit?.(value)
  }
  const keys = el(
    "div.keys",
    {},
    ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => el("button.key", { type: "button", onclick: () => press(d) }, d)),
    el("button.key.ghost", { type: "button", "aria-label": "Clear", onclick: () => ((value = ""), render()) }, "CLR"),
    el("button.key", { type: "button", onclick: () => press("0") }, "0"),
    el("button.key.ghost", { type: "button", "aria-label": "Delete", onclick: () => ((value = value.slice(0, -1)), render()) }, "DEL"),
  )
  render()
  const node = el("div.keypad", {}, dots, keys)
  node.reset = () => {
    value = ""
    render()
  }
  node.value = () => value
  return node
}

/** mm:ss from seconds, for the places that do not import timer.js. */
export function mmss(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}
