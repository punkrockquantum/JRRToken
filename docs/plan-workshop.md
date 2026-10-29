# Token Quest workshop mode — plan and checklist

Branch `cursor/token-quest-datacenter-game`. The kiosk game at `/` stays untouched; workshop mode is built in
new files only (`workshop.html`, `host.html`, `board.html`, `css/workshop.css`, `js/workshop/**`,
`deploy/intake-worker/src/session*.mjs`, `deploy/intake-worker/migrations/0002_sessions.sql`,
`tests/workshop*.test.js`, `scripts/smoke-workshop.mjs`, this plan, a README section). Another agent owns
`css/game.css`, `js/*.js` (top level), `scripts/smoke*.mjs`, `scripts/build-static.mjs`, `tests/*` and
`HOSTING.md` for now; the only edits made to shared files are tiny additive hooks listed under
"Hooks in shared files" below. `git add` only the paths listed here; `git status` before every commit.

User requirements (verbatim): "Now we need to hugely simplify this. An architect will be at every table.
Leading a team. Allow for up to 10 teams per session. Strip down the table iPads to 4 options only:
Connectivity, OEMs, Datacenter & Power, CFD Supercomputer. Simplify the explanation and the level of
decision making in every table. Aim to run the whole experience in 50 minutes and set up the game with
5 min brief. Delegates attending still have to pitch their ideas to the table hosts and achieve approval.
Provide a read out to each team about what went well and what they could have done differently."

Legend: `[x]` done in the tree · `[~]` partly done (what remains is listed) · `[ ]` not started.

## Decisions taken while the user was away

- **Pages into dist without a build hook.** `scripts/build-static.mjs` only copies `index.html`, `css/`,
  `js/`, `assets/`, and the other agent has ~200 uncommitted lines in it (the import guard), so instead of
  an `EXTRA_PAGES` hook the three pages live in `assets/workshop/` (`workshop.html`, `host.html`,
  `board.html`), which the build already copies as it is. The Worker serves them at the short URLs:
  `/workshop`, `/host` and `/board/<code>` are rewritten to those assets (`rewriteWorkshopAsset` in
  `session.mjs`), so every page uses root-relative `/css/...` and `/js/...` links.
- **Login redirect.** The team-password login page always redirected to `/`, which would lose the iPad's join
  URL (`/workshop?code=ABCD` from the QR). `gate.mjs` gets `safeNextPath()` (same-origin path only, no `//`,
  no scheme, ≤ 200 chars) and the login form carries `?next=`; `worker.mjs` passes it through (two lines).
- **Migration list test.** `tests/intake.test.js` asserted `migrationFiles()` equals `["0001_attempts.sql"]`;
  adding `0002_sessions.sql` needs that one assertion to list both files (one-line change, the file was not
  being edited by the other agent).
- **Team identity.** `POST /api/session/:code/join` returns a signed team token (HMAC over
  `teamId.code.expiry` with the gate's session secret, 8 h) and also sets it as the `tq_team` cookie
  (HttpOnly, Secure, SameSite=Lax, Path=/api/team). Team routes accept the `X-Team-Token` header or the
  cookie; the iPad keeps the token in `localStorage` so a reload keeps the table, and the smoke can run
  three teams in three browser contexts.
- **Codes.** Session code: 4 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I). Host codes: 4
  digits, one per team, distinct within a session. Facilitator PIN: 6 digits. All from
  `crypto.getRandomValues` (injectable for tests). Codes are never logged.
- **Phases.** `brief | build | readout | done`; `phase_started_at` NULL means "created, waiting for the
  facilitator" (the lobby). Timer is server-authoritative: the state carries `serverNow`, `phaseEndsAt`
  and `remainingS`; clients render the countdown from the offset. The facilitator can add or remove minutes
  from the current phase (`adjust`). Default 5 + 36 + 9 = 50 minutes.
- **Scoring on submit and at read-out.** SUBMIT BUILD scores the team server-side at once (rank null);
  START READ-OUT re-scores every team (unsubmitted teams are scored on whatever they decided, with the
  cheapest tile standing in for a station they never saved, and the read-out says so) and assigns ranks.
  Scores are hidden from the board until the read-out phase.
- **Budget and go-live in the score.** The user's formula has no cost term, so the scenario budget bites
  as a factor: over budget → `(budget / capex)²` (finance would not sign it; the architect should send it
  back for cost). Lead time past go-live costs 5% a week to a floor of 0.7. Runs per night versus par is
  capped at 1.4.
- **Money left counts (+2% per $1M).** The first balance run found 44 builds tied at the 1.4 cap: H200
  Large on air nodes, GB200 Medium on Ethernet and the thoughtful build all cleared 56 runs a night inside
  $9M, so the cap hid the difference between "enough" and "twice as much". An F1 team under a cost cap
  puts unspent money on the car, so `value = 1 + 0.02 × ($M of budget left)` is a factor. The thoughtful
  build ($4.6M) scores 1,524 and is the unique top (per metro); H200 Large ($7.1M) 1,454; GB200 Medium on
  NVLink ($8.3M) 1,413. The iPad's scenario card says it in six words ("each $1M left +2%"); the
  read-out quotes the money back.
- **The read-out's "differently" is a path.** Single-station neighbours alone left a floor build with one
  line (only the GPU lifts an RTX build off 100) and a local optimum (H200 Large, air hall) with none. So:
  a greedy path of single-station fixes, each quantified against the step before ("Then DATACENTER &
  POWER: … +145 more (1454)"), and when the path stops short of `REFERENCE_BUILD` (the proven top, in
  `cfd.js`), one line with the gap to it and the stations that differ. Never more than three bullets.
- **Rate limits.** Workshop reads (iPads and boards polling every 3–5 s from one venue IP) have their own
  bucket, `RATE_LIMIT_WORKSHOP_PER_MINUTE` (default 900); joins, approvals and facilitator actions share a
  smaller `RATE_LIMIT_WORKSHOP_WRITES_PER_MINUTE` bucket (default 60).
- **Scenario (fiction, labelled).** "Apex Aero Racing", an F1-style aerodynamics team: 1,500 engineers in
  Milton Keynes (UK, 60%) and Modena (Italy, 40%); simulation data in the UK data room at Milton Keynes;
  budget $9M capex; go-live in 16 weeks; par 40 overnight CFD runs. Metros offered: London, Frankfurt,
  Paris (real Digital Realty metros; distances from `js/data.js` coordinates; power ladders and prices from
  `METRO_POWER`).
- **Login `next` only for workshop pages.** The kiosk game's login page keeps its plain `/login` action
  (the existing gate tests assert it); only `/workshop`, `/host` and `/board/<code>` carry `?next=`.
- **The facilitator may skip the brief timer.** `start_build` is allowed from the lobby (a facilitator who
  briefed without the clock goes straight to BUILD); `end` and `adjust` are not.
- **Tables may decide before BUILD starts.** Decisions, pitches and approvals are refused only in the
  read-out and done phases; a table that reads ahead during the brief is not blocked, the facilitator's
  timer is the social control. The iPad shows the phase on every screen.
- **SEND BACK notes survive the approval.** Approving without a note keeps the last send-back reason on the
  decision (`COALESCE`), so the read-out can quote "OEMs: sent back once (cost)".
- **Scores before the read-out.** `GET /api/session/:code` shows scores only from the read-out on, or to a
  caller sending the facilitator PIN (`X-Facilitator-Pin`) or the kiosk key; the board and the iPads never
  see a score before the read-out phase. SUBMIT BUILD returns `scored: true` and no number.

## Hooks in shared files (tiny, additive)

- `scripts/build-static.mjs`: none (pages live under `assets/workshop/`, see above).
- `deploy/intake-worker/src/worker.mjs`: import of `session.mjs`; `sessions.handle(...)` first in `route()`;
  `rewriteWorkshopAsset` in the asset branch; `next` passed to the login page and honoured after login.
- `deploy/intake-worker/src/gate.mjs`: `safeNextPath()`, `loginPage({ next })`.
- `tests/intake.test.js`: migration list assertion lists `0002_sessions.sql`.
- `index.html`: none (the kiosk game is untouched; the workshop is reached at `/workshop`).
- `README.md`: one new section ("Workshop mode (table teams)") and four lines in the repository layout.

## P1 — Migration + session API + tests

- [x] `migrations/0002_sessions.sql`: `sessions`, `teams`, `decisions`, `readouts` (+ indexes), idempotent
- [x] `session-store.mjs`: D1 SQL for every table, `StoreUnavailableError` on failure
- [x] `session-auth.mjs`: codes, host codes, PIN, team tokens (HMAC-SHA256), constant-time compares
- [x] `session.mjs`: routes `POST /api/session`, `GET /api/session/:code`, `POST /api/session/:code/phase`,
      `POST /api/session/:code/join`, `GET/PUT /api/team/:id/decision/:station`, `POST /api/team/:id/pitch/:station`,
      `POST /api/team/:id/approve/:station`, `POST /api/team/:id/submit`, `GET /api/team/:id/readout`,
      `GET /api/session/:code/board`; validation; rate limits; no emails anywhere (+ `DELETE /api/session/:code`,
      `POST /api/session/:code/hosts`, `GET /api/team/:id`)
- [x] `js/workshop/timer.js`: phase state machine + timer maths (shared by Worker and clients)
- [x] `js/workshop/cfd.js`: scenario, four stations × tiles, `evaluateWorkshop`, `scoreWorkshop`
- [x] `js/workshop/readout.js` (pulled forward from P4: the Worker stores the read-out at submit)
- [x] Hooks in `worker.mjs`, `gate.mjs`, `tests/intake.test.js`
- [x] `tests/workshop-api.test.js`, `tests/workshop-timer.test.js`, `tests/workshop-engine.test.js` (41 tests)
- [~] commit `f318cf3`, pushed; `wrangler d1 migrations apply tokenquest-players --remote` and the deploy
      are pending (see "Deploy status")

## Deploy status

The Worker deploy and the remote D1 migration both need the Cloudflare API, which this session's sandbox
cannot reach (the harness refused every elevated-permission command), and `npm run deploy:worker` would in
any case be stopped by `scripts/deploy-guard.mjs` while the other agent's uncommitted work sits under
`css/`, `js/`, `index.html` and `scripts/`. When the tree is clean, from the repo root:

    cd deploy/intake-worker && npx --yes wrangler@4 d1 migrations apply tokenquest-players --remote && cd ../..
    npm run deploy:worker

Until the migration runs, every `/api/session*` call answers `503 store_unavailable` with the message
"the workshop tables (sessions, teams, decisions, readouts) do not exist yet: run `npx wrangler d1
migrations apply …`"; the kiosk game is unaffected (its routes and table are untouched).

After the deploy, one live check: `WORKSHOP_URL=https://tokenquest.tokenquest.workers.dev
WORKSHOP_PASSWORD=<team password> SHOTS=.shots node scripts/smoke-workshop.mjs` (creates a throwaway
session and deletes it at the end), then read the screenshots.

Commits on `cursor/token-quest-datacenter-game`: P1 `f318cf3`, P2 `70ea753`, P3 `bb386e7`, P4 `c0f7bf3`,
P5 (this one). Workshop tests: `node --test tests/workshop-*.test.js` → 38 tests (api 10, timer 5,
engine 9, qr 7, readout + balance 6, plus intake's migration check); whole suite 344 tests, 0 failing.

## P2 — Team iPad

- [x] `assets/workshop/workshop.html` (served at `/workshop`), `css/workshop.css`, `js/workshop/app.js`,
      `js/workshop/api.js`, `js/workshop/ui.js`
- [x] JOIN → HOME (timer, scenario card, four tiles with status) → STATION (3-tile decisions, why it
      matters, live what-this-does line, PITCH) → HOST APPROVAL panel (host code keypad, APPROVE / SEND BACK
      with a one-tap reason, RE-OPEN) → SUBMIT BUILD → READ-OUT (printable)
- [x] 1180×820 and 1024×768 landscape first; phone-tolerant; 44 px targets; no page scroll (checked in
      headless Chrome against `scripts/workshop-dev-server.mjs`; the formal audit is the P5 smoke)
- [x] `scripts/workshop-dev-server.mjs`: the real Worker on `node:http` with an in-memory D1 and the repo's
      files as assets (`--seed` prints a session's code, PIN and host codes); the smoke starts it in-process
- [~] commit, push (done); deploy waits for a clean guarded tree (see "Deploy status" below)

## P3 — Facilitator + projector board

- [x] `assets/workshop/host.html` (served at `/host`) + `js/workshop/host.js`: CREATE SESSION → code big,
      QR, join URL, COPY links, 10 host codes with the team that holds each, PIN; phase bar (LOBBY / BRIEF /
      BUILD / READ-OUT / DONE) with one big next-action button, −1 / +1 / +5 MIN, master timer (server
      time + offset), run-of-show line, progress line, tables × stations grid (chips, approvals, send-backs,
      early scores for the facilitator only), PROJECTOR BOARD link, LEAVE, DELETE SESSION after END.
      A reload resumes from localStorage; `/host?code=XXXX` on another browser asks for the PIN (keypad)
- [x] `assets/workshop/board.html` (served at `/board/<code>`) + `js/workshop/board.js`: big clock + phase,
      join hint with the code, one row per table with four station lights, approvals during the build,
      scores + ranks from the read-out on; scales so ten rows fill 1080p and 720p; no emails, no codes
- [x] `js/workshop/qr.js`: dependency-free QR encoder (byte mode, level M, versions 1–10, mask penalty,
      version blocks from v7); verified with Apple's CoreImage detector on rendered PNGs (v1, v3, v4, v7)
- [x] `tests/workshop-qr.test.js` (7 tests: capacity table, Reed–Solomon vector, finders/timing/format,
      every mask round-trips through the test decoder, alignment, version bits, SVG shape)
- [x] Headless-Chrome check at 1180×820, 1024×768 (host) and 1920×1080, 1280×720 (board): no page scroll,
      no console errors, create → join ×3/×10 → decisions → brief → +1 min → build → read-out → end
- [~] commit, push (done); deploy waits for a clean guarded tree (see "Deploy status")

## P4 — Scoring + read-out + balance

- [x] `js/workshop/readout.js`: WHAT WENT WELL (3), WHAT YOU COULD HAVE DONE DIFFERENTLY (a quantified
      path of up to 3 fixes, plus the gap to the top build), architect's SEND BACK notes, Digital Realty
      closing line
- [x] `scripts/balance-workshop.mjs`: enumerates all 8,748 builds, prints the tables below, exits 1 when an
      invariant breaks (thoughtful build on top and every build at the cap sensible; trap < 400; biggest
      block never beats a right-sized one; public internet never beats private; every station swings ≥ 150)
- [x] iPad read-out screen (printable) and `/api/team/:id/readout` (P2 / P1)
- [x] `tests/workshop-readout.test.js` (6 tests, including the balance invariants); engine + API tests
      updated for the money-left factor (54 workshop + intake tests green)
- [~] commit, push (done); deploy waits for a clean guarded tree (see "Deploy status")

### Scoring

    score = max(100, round(1000 × runs × value × approval × budget × power × latency × on-time))

    runs     = min(1.4, runs per night / 40)          value    = 1 + 0.02 × ($M of the $9M left)
    approval = max(0.85, 1 − 0.03 × send-backs)       budget   = 1, or (9M / capex)² over budget (floor 0.5)
    power    = green 1 · amber 0.9 · red 0.75         latency  = 3D-frame target 30 ms × data-home target 4 h (soft)
    on-time  = 1 − 0.05 × weeks past 16 (floor 0.7)
    runs per night = PFLOPS(FP64) × fabric efficiency × cooling factor × power throttle × 10 h / 0.5 PF-h per run

### Balance (`node scripts/balance-workshop.mjs`, 8,748 builds)

| min | p25 | median | p75 | max  | at cap | at floor | power green | over budget | late |
|-----|-----|--------|-----|------|--------|----------|-------------|-------------|------|
| 100 | 100 | 336    | 644 | 1524 | 3      | 2712     | 2892        | 1296        | 1944 |

Thoughtful build (COMBO · Rack-scale NVL72 · London/liquid/smallest block · GB200 Small NVLink): **1524**
(the three metros tie: with private connectivity all three meet the latency targets). Inference trap
(RTX PRO 6000) at its best: 123; median FP64 build: 513. Biggest block vs right-sized block, same other
choices: 0 wins in 2,364 cases. Public internet vs private, same other choices: 0 wins. Send-backs on the
thoughtful build: 0 → 1524 · 1 → 1479 · 2 → 1433 · 3 → 1387 · 5+ → 1296 (floor).

| station            | combos | best | worst | worst tiles        | swing |
|--------------------|--------|------|-------|--------------------|-------|
| CONNECTIVITY       | 4      | 1524 | 985   | public             | 539   |
| OEMs               | 3      | 1524 | 1056  | liquid-node        | 468   |
| DATACENTER & POWER | 27     | 1524 | 440   | lon/air/block-2    | 1084  |
| CFD SUPERCOMPUTER  | 27     | 1524 | 100   | rtx/small/ethernet | 1424  |

| station | tile                                       | mean | best | green % |
|---------|--------------------------------------------|------|------|---------|
| NET     | Public internet                            | 315  | 985  | 33      |
| NET     | ServiceFabric                              | 471  | 1518 | 33      |
| NET     | Cross Connect + Dark Fiber                 | 467  | 1507 | 33      |
| NET     | COMBO: ServiceFabric + Dark Fiber          | 473  | 1524 | 33      |
| OEM     | Air-cooled 8-GPU node                      | 455  | 1454 | 33      |
| OEM     | Direct-liquid 8-GPU node                   | 338  | 1445 | 33      |
| OEM     | Rack-scale NVL72                           | 501  | 1524 | 33      |
| DC      | London / Frankfurt / Paris                 | 428 / 428 / 438 | 1524 | 33 |
| DC      | Air (cold aisle containment)               | 360  | 1454 | 33      |
| DC      | Rear door heat exchanger                   | 384  | 1447 | 33      |
| DC      | Direct liquid                              | 549  | 1524 | 33      |
| DC      | Smallest block                             | 437  | 1524 | 77      |
| DC      | Middle block                               | 454  | 1468 | 14      |
| DC      | Biggest block                              | 403  | 1321 | 7       |
| CFD     | HGX H200 nodes                             | 614  | 1454 | 33      |
| CFD     | GB200 NVL72 rack                           | 578  | 1524 | 33      |
| CFD     | RTX PRO 6000 servers                       | 101  | 123  | 33      |
| CFD     | Small / Medium / Large                     | 315 / 462 / 517 | 1524 / 1468 / 1454 | 33 |
| CFD     | Ethernet + file storage                    | 386  | 1468 | 33      |
| CFD     | InfiniBand + parallel file system          | 451  | 1509 | 33      |
| CFD     | NVLink-scale fabric + GPU-adjacent storage | 457  | 1524 | 33      |

## P5 — Smoke + screenshots + README

- [x] `scripts/smoke-workshop.mjs`: headless Chrome via CDP with one browser context per device: the
      facilitator (1180×820) creates the session; three tables join on iPads (1180×820, 1024×768), work all
      four stations (tiles → PITCH → architect keypad → APPROVE, one SEND BACK with a reason), one submits;
      BRIEF → BUILD → +1 MIN → READ-OUT → END; the board (1920×1080) before and after the scores release;
      each iPad's read-out checked for its headings, the architect's note and the closing line; scores in
      order. Every screen passes the audit (no page scroll, nothing outside the viewport, no overlapping
      tiles, 44 px tap targets, 8 px+ text, no console errors). `SHOTS=dir` keeps a PNG per screen and a
      `fail-<device>.png` of every device when a step fails. `WORKSHOP_URL` + `WORKSHOP_PASSWORD` run it
      against a live deployment on a throwaway session that is deleted at the end
- [x] Ran green against the in-process dev server: 30 screens, 1524 / 1016 / 100 (`node --test
      scripts/smoke-workshop.mjs` also works). The live run waits for the deploy
- [x] The smoke found a real bug: a poll re-render wiped the architect's half-typed host code (and the
      send-back reason). The sheet state now holds both, so the keypad survives the 4-second refresh
- [x] README "Workshop mode (table teams)": stations and tiles, run of show, the three URLs, the score,
      the read-out, local run, first-deploy migration; repository layout lines
- [~] final commit, push (done); deploy waits for a clean guarded tree (see "Deploy status")
