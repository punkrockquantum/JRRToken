import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const html = readFileSync(join(root, "index.html"), "utf8")
const css = readFileSync(join(root, "css/mobile.css"), "utf8")
/** The sheet without its comments, so a brace or a property inside a comment does not count. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "")

/** The rule bodies for every selector list that contains `selector` (or equals it, with `exact`), joined. */
function declarationsFor(selector, { exact = false } = {}) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = re.exec(code))) if (exact ? match[1].trim() === selector : match[1].includes(selector)) out.push(match[2])
  return out.join(";")
}

test("index.html loads css/mobile.css after game.css, scoped to phones and portrait tablets by its media attribute", () => {
  const game = html.indexOf('href="css/game.css"')
  const mobile = html.indexOf('href="css/mobile.css"')
  assert.ok(game > -1, "game.css link")
  assert.ok(mobile > game, "mobile.css is linked after game.css so its rules win ties")
  const link = html.slice(html.lastIndexOf("<link", mobile), html.indexOf(">", mobile) + 1)
  assert.match(link, /rel="stylesheet"/)
  const media = link.match(/media="([^"]+)"/)?.[1]
  assert.ok(media, "the link carries a media attribute, so the kiosk never downloads the phone rules")
  assert.match(media, /\(max-width:\s*900px\)/)
  assert.match(media, /\(orientation:\s*portrait\)\s*and\s*\(max-width:\s*1100px\)/)
  assert.equal((html.match(/css\/mobile\.css/g) || []).length, 1, "linked exactly once")
})

test("css/mobile.css is balanced and parses as plain CSS", () => {
  const opens = (code.match(/\{/g) || []).length
  const closes = (code.match(/\}/g) || []).length
  assert.equal(opens, closes, `braces: ${opens} open, ${closes} close`)
  assert.ok(opens > 100, "a real sheet, not a stub")
  /* Every declaration block ends its last declaration with a semicolon or nothing dangling. */
  for (const body of code.match(/\{[^{}]*\}/g) || []) {
    const inner = body.slice(1, -1).trim()
    if (!inner) continue
    for (const decl of inner.split(";").map((d) => d.trim()).filter(Boolean)) assert.match(decl, /^[-a-z]+\s*:\s*\S/, `declaration "${decl}"`)
  }
})

test("the page scrolls on a phone: the kiosk's height and overflow locks are turned over", () => {
  const page = declarationsFor("html, body")
  assert.match(page, /height:\s*auto/)
  assert.match(page, /overflow:\s*visible/)
  const app = declarationsFor("#app")
  assert.match(app, /height:\s*auto/)
  assert.match(app, /overflow:\s*visible/)
  assert.doesNotMatch(code, /100dvh(?!\s*-)/, "no viewport-height lock on the page (dvh only as a popover ceiling)")
  assert.match(code, /-webkit-text-size-adjust:\s*100%/)
})

test("REVIEW, GO and NEXT sit in a bar pinned to the bottom of the viewport, clear of the home indicator", () => {
  const bar = declarationsFor(".step-nav, #stage .review-go")
  assert.match(bar, /position:\s*sticky/)
  assert.match(bar, /bottom:\s*0/)
  assert.match(bar, /env\(safe-area-inset-bottom/)
  assert.match(code, /\.step-panel\s*\{\s*display:\s*contents/, "the step panel's children join the page column so the bar is the page's last item")
  assert.match(code, /\.step-nav,\s*#stage \.review-go\s*\{\s*order:\s*4/, "the bar is ordered after the Scouter")
})

test("type floors: 14px body, 12px labels, 16px inputs; no smaller size anywhere in the sheet", () => {
  const sizes = [...code.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]))
  assert.ok(sizes.length > 40)
  assert.ok(sizes.every((px) => px >= 12), `smallest font-size ${Math.min(...sizes)}px`)
  assert.match(declarationsFor("input"), /font-size:\s*16px/)
  assert.match(code, /--fs:\s*14px/)
  assert.match(code, /--fs-s:\s*12px/)
})

test("touch: 44px targets, no tap delay, popovers inside the viewport", () => {
  assert.match(code, /touch-action:\s*manipulation/)
  assert.match(declarationsFor(".btn", { exact: true }), /min-height:\s*44px/)
  assert.match(declarationsFor(".rail-btn"), /min-height:\s*44px/)
  assert.match(declarationsFor(".learn-pop"), /max-width:\s*92vw/)
  assert.doesNotMatch(code, /:hover/, "nothing on a phone is revealed by hovering")
})

test("the intro canvas fills the width at 16:9 and stays pixel sharp", () => {
  const canvas = declarationsFor(".intro-canvas")
  assert.match(canvas, /width:\s*100%/)
  assert.match(canvas, /aspect-ratio:\s*16\s*\/\s*9/)
  assert.match(canvas, /image-rendering:\s*pixelated/)
})

test("the results dialog is a full-screen sheet that scrolls as one, buttons full width", () => {
  assert.match(declarationsFor(".dialog-back"), /overflow-y:\s*auto/)
  const sheet = declarationsFor("#result .dialog.result")
  assert.match(sheet, /width:\s*100%/)
  assert.match(sheet, /max-height:\s*none/)
  assert.match(sheet, /env\(safe-area-inset-bottom/)
  assert.match(declarationsFor(".row.end .btn"), /width:\s*100%/)
})

test("no !important spam: only the two declarations that beat the inline canvas size", () => {
  const important = code.match(/!important/g) || []
  assert.ok(important.length <= 2, `${important.length} !important declarations`)
  for (const line of code.split("\n").filter((l) => l.includes("!important"))) assert.match(line, /\.intro-canvas/)
})
