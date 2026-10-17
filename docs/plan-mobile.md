# Token Quest on a phone — plan and checklist

Branch `cursor/token-quest-datacenter-game`. User requirement (verbatim): "Make it mobile friendly too so I
can play it on a phone screen or iPad."

The kiosk layout (`css/game.css`) has one rule, nothing scrolls, and lays every screen out for a landscape
booth screen. A phone turns that over: the page scrolls, every screen stacks in one column, and the step's
main action (NEXT, REVIEW, GO) sits in a bar pinned to the bottom of the viewport. All of it lives in one new
sheet, `css/mobile.css`, linked after `game.css` with a media attribute, so the kiosk never downloads a byte
of it and `scripts/smoke.mjs` at 1920×1080 / 1600×1000 / 1180×820 / 1024×768 is untouched.

Files: `css/mobile.css` (new), `index.html` (one `<link>` line), `scripts/smoke-mobile.mjs` (new),
`tests/mobile.test.js` (new), `docs/plan-mobile.md` (this file), `README.md` (one paragraph under Develop).
Nothing else in the tree changes.

Legend: `[x]` done in the tree · `[~]` partly done (what remains is listed) · `[ ]` not started.

## M1 — The sheet and how it is loaded

- [x] `<link rel="stylesheet" href="css/mobile.css" media="(max-width: 900px), (orientation: portrait) and (max-width: 1100px)">`
      after `game.css`: phones in either orientation, tablets in portrait; the kiosk and a landscape iPad keep
      `game.css` alone
- [x] Kiosk selectors are out-ranked with an id prefix (`#stage …`, `#result …`, `:is(#stage, #result) …`),
      not with `!important`; the only two `!important` declarations beat the inline canvas size `fitCanvas()`
      writes on the intro canvas, which nothing else can
- [x] `html`, `body`, `#app`, `#stage`, every `.screen`: `height: auto`, `overflow: visible`, no `100dvh`
      lock; `-webkit-text-size-adjust: 100%`

## M2 — One column, screen by screen

- [x] Top bar wraps to two rows: logo and HUD, then the buttons that work on a phone (FULLSCREEN hidden
      under 480px: iPhone Safari has no page fullscreen and three labels do not fit a 390px row)
- [x] Title: the card in one column, league rows as rank / name over job / score, 16px inputs (no zoom on
      focus), a 28px consent box, 14px consent copy
- [x] Intro: the CRT frame at 100% width and 16:9, the canvas stretched to it (`image-rendering: pixelated`),
      captions below at 14px, CONTINUE full width on its own row, dots wrapping
- [x] Stories: one card a row, sprite on the left spanning title and brief, the brief wraps at 14px
- [x] Game screen as a flex column; `.step-panel { display: contents }` so its children (head, tiles, action
      bar) join the column and the bar is the page's last item (`order: 4`), after the Scouter (`order: 1`)
- [x] Scenario card: who and the story, the two places, then the five facts and NEW STORY in two columns
- [x] Ecosystem bar: five lights in one row, the names under the lights on two alternating rows (three under
      375px) so CONNECTIONS has two columns of width and nothing is cut short
- [x] Rail: one strip across the width (`overflow-x: auto` as the fallback); under 760px the steps passed and
      to come show their number only (30px box, invisible 44px halo) and the current step keeps its name, so all
      nine fit a 375px phone
- [x] Tiles one a row under 480px, two a row from 480px to 900px, each lying down (art left, words right,
      "?" top right), every hint shown (the kiosk hides some to fit), 14px titles, 12px hints and tags;
      location tiles as a column with one trip a line; the connectivity TOKEN IMPACT strip at full tile width;
      reference architectures one a row (two from 480px)
- [x] Scouter below the tiles as a compact card: target, gauges two a row, the crowd, the coach's question,
      REVIEW; the NERD MODE button hidden there (the top bar has it)
- [x] Action bar: `.step-nav` / `.review-go` `position: sticky; bottom: 0`, `env(safe-area-inset-bottom)`
      padding, BACK a third and NEXT/GO two thirds of the row, 52px tall; the review's target line hidden in
      the bar (the Scouter carries it); the intro's CONTINUE pulses in brightness, not in size (a full-width
      button scaled to 104.5% poked past the screen and the page scrolled sideways)
- [x] Review: one row a step (two from 600px), labels wrap, the five lights with their reasons one a line
- [x] Toast fixed above the bar, within 92vw; the factory run as a fixed full-viewport overlay
- [x] Learn popover `width: min(460px, 92vw)`, `max-height: min(70vh, 100dvh − 16px)`, CLOSE full width, 44px
- [x] Results dialog as a full-screen sheet: `.dialog-back` scrolls as one, the sheet `width: 100%`,
      `min-height: 100%`, sections stacked, head as two columns with the rank box across, stats two a row,
      WHAT TO TRY one a row (two from 480px); the buttons in a bar pinned to the bottom of the sheet (IMPROVE
      IT across the top of it, PLAY AGAIN and NEXT PLAYER side by side), above the home indicator. Pinned
      matters: `showResult()` focuses IMPROVE IT, and a focused button below the fold would have scrolled the
      score away; pinned, it is already in view and the sheet opens on the score
- [x] The run overlay below the dialogs (z-index 9 under 10): the first browser run found the factory floor
      painted over the results sheet's buttons
- [x] Title inputs `width: 100%; min-width: 0`: an input's own width is 20 characters, 356px in the pixel
      font at 16px, wider than a 390px phone's form

## M3 — Type and touch

- [x] 14px body (`--fs`), 12px labels (`--fs-s`), 16px inputs; no `font-size` under 12px in the sheet
      (`tests/mobile.test.js` checks every declaration)
- [x] 44px tap targets: `.btn`, `.seg-btn`, `.rail-btn`, the site-designer steps, the learn "?" (30px box,
      44px halo), the scene dots (22px box, 44px halo), 52px primary actions; `touch-action: manipulation`;
      nothing revealed on hover

## M4 — Proof

- [x] `tests/mobile.test.js` (9 tests): the media-scoped link after `game.css`, brace balance and plain-CSS
      declarations, the scroll override, the sticky bar with safe-area padding and `display: contents`, the
      type floors, touch rules, the 16:9 canvas, the results sheet, at most two `!important`s
- [x] `scripts/smoke-mobile.mjs`: headless Chrome with mobile emulation (touch, dpr 3 / 2, iPhone and iPad
      user agents) at 390×844, 430×932 and 820×1180; title → intro → stories → every step → review → GO →
      results → IMPROVE IT → final results → league, simple and nerd mode; every screen passes the audit (no
      horizontal overflow, 44px targets, the main action inside the viewport at the top, middle and bottom of
      the page, 12px / 14px floors, no overlapping or spilling tiles, cards, lights, rail steps or names, the
      "?" popover inside the viewport and within 92vw, the toast inside the viewport); screenshots
      `.shots/mobile-<vp>-<screen>.png`
- [x] Run against a temporary kiosk server and read the screenshots:

      ```bash
      DATA_DIR=/tmp/tq-m-data EXPORT_PATH=/tmp/tq-m.xlsx PORT=8092 node scripts/serve.mjs &
      SHOTS=.shots GAME_URL=http://127.0.0.1:8092/ node scripts/smoke-mobile.mjs
      SHOTS=.shots VIEWPORTS=1600x1000 GAME_URL=http://127.0.0.1:8092/ DATA_DIR=/tmp/tq-m-data EXPORT_PATH=/tmp/tq-m.xlsx node scripts/smoke.mjs
      ```

      `mobile smoke ok` at 390×844, 430×932 and 820×1180, 38 screens each; the desktop smoke still green at
      1600×1000 (37 screens). The first browser runs found four things the desk check had not (the title
      inputs, the run overlay's z-index, the pulsing CONTINUE, the focus scroll on the results sheet), all
      fixed above
- [x] `node --test`: 225 tests, 224 pass, 1 skipped (openpyxl not installed)
