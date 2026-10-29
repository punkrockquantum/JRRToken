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
  capped at 1.4 so the best score is ~1,400 with every other factor at 1.0.
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

- [ ] `host.html` + `js/workshop/host.js`: create session, code, QR (inline SVG, `js/workshop/qr.js`, no
      deps), 10 host codes, phase buttons, master timer, +/- minutes, teams × stations grid, board link
- [ ] `board.html` + `js/workshop/board.js`: leaderboard / progress, timer, phase, auto-refresh, no emails
- [ ] `tests/workshop-qr.test.js`
- [ ] commit, push, deploy

## P4 — Scoring + read-out + balance

- [ ] `js/workshop/readout.js`: WHAT WENT WELL (3), WHAT YOU COULD HAVE DONE DIFFERENTLY (2–3 from the
      best alternative per station, quantified), architect's SEND BACK notes, Digital Realty closing line
- [ ] `scripts/balance-workshop.mjs`: enumerate the whole tile space; thoughtful build wins, inference trap
      and oversized power block lose; table in this plan
- [ ] iPad read-out screen (printable) and `/api/team/:id/readout`
- [ ] `tests/workshop-readout.test.js`, balance invariants in `tests/workshop-engine.test.js`
- [ ] commit, push, deploy

## P5 — Smoke + screenshots + README

- [ ] `scripts/smoke-workshop.mjs`: headless Chrome, create session, three teams on iPad viewports,
      decisions, pitches, approvals, submit, phases, board and read-outs; layout audit; screenshots
- [ ] Run against `wrangler dev --local` (local D1) or a throwaway live session
- [ ] README "Workshop mode (table teams)" with the run-of-show and URLs
- [ ] final commit, push, deploy
