# Token Quest Worker (`tokenquest`)

One Cloudflare Worker (free tier, no servers) that serves the whole game **and** its `/api` on one
origin, `https://tokenquest.tokenquest.workers.dev`, behind one team password:

- the gate: `src/gate.mjs` + the top of `src/worker.mjs`. Every request runs through the script
  (`run_worker_first = true`); without a valid `tq_session` cookie a visitor gets the 8-bit login page
  (inline CSS, one field), `POST /login` checks the password against the `ACCESS_PASSWORD` secret in
  constant time and sets an HMAC-signed cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, 14 days, key
  `SESSION_SECRET`), `/api/*` answers `401` without the cookie (except the public, minimal
  `/api/health`), `GET /logout` clears it. No `ACCESS_PASSWORD` secret = no gate (local dev).
  Kiosk laptops have no cookie and send the `INTAKE_KEY` secret as `X-Intake-Key` instead (constant
  time; opens `/api/*` and `/staff` only, never the game; a wrong or stale key is `401 bad_key`);
- the game: Workers Static Assets uploaded from `dist/` (`npm run build:worker`), with
  `dist/404.html` for unknown paths; the script re-applies the cache rules from `deploy/static/_headers`
  (HTML/JS/CSS `no-store`, fonts one year) because Workers skip `_headers` when the script runs first;
- the API: `src/worker.mjs`, which keeps every score, name and email address in a **Cloudflare D1
  database** (`tokenquest-players`, SQLite, bound as `DB`; `src/d1store.mjs`) so that they never touch
  the public game repo, a kiosk laptop or a browser as the only copy:
  - table `attempts` (`migrations/0001_attempts.sql`) — one row per game: `played_at`, `name`, `email`,
    `score`, `use_case`, `scenario`, the money/FTE figures, `consent_at`, `source` (`web` / `kiosk`) and a
    `UNIQUE replay_key` (email|playedAt|score) so a re-posted game is stored once
  - `/staff` (`src/staff.mjs`) — the staff page: players with name, email, attempts, best, latest and
    last played, `N players · M games · updated <time>`, buttons **Download CSV** (`/api/export.csv`,
    `src/csv.mjs`: UTF-8 BOM, CRLF, RFC 4180, formula-safe) and **Download PLAYERS.md** (`/api/export.md`,
    `src/markdown.mjs`); `/api/players.json` is the raw list

The row is in D1 before the Worker answers `{ ok: true }`. There is no batching, debounce or "write
later": if D1 cannot be written the Worker answers `503 { ok: false, error: "store_unavailable" }` and
the game client keeps the attempt in its localStorage queue and retries (a kiosk laptop keeps it in
`data/upstream-queue.jsonl`). There is deliberately no delete or reset endpoint: clearing rows is a
`wrangler d1 execute` command (HOSTING.md, "Scores database (D1)"). `src/store.mjs` + `src/github.mjs`
remain as an **optional mirror** of `players.json` and `PLAYERS.md` into a private GitHub repo
(`MIRROR_MARKDOWN = "true"` + `PLAYERS_REPO` + the `GITHUB_TOKEN` secret), run after the answer in
`ctx.waitUntil`; off by default and never able to fail a game.

This Worker is the single source of truth when several laptops play at once: browsers on the team URL
write straight to it, and local kiosk servers (`server/upstream.mjs` in the game repo) forward every
game to it with the key and merge its league into their own board, so the running totals are the same
on every device and nothing is lost while a laptop is offline.

The step-by-step setup (deploy, secrets, the database and its migration, GitHub Actions auto-deploy)
is in [`HOSTING.md`](../../HOSTING.md), sections **One URL on workers.dev**, **Team access**, **Scores
database (D1)** and **Many laptops, one league**. workers.dev names are always
`<worker>.<account-subdomain>.workers.dev`; `wrangler.toml` shows how to add a custom domain later.

## Endpoints

Same contract as the kiosk server (`server/app.mjs`), documented at the top of `js/sync.js`:

| Route | Answer |
| --- | --- |
| `GET /login` | the login page (`200`, `text/html`), or `303 /` when already logged in or the gate is off |
| `POST /login` | form field `password` (same-origin `Origin`, `application/x-www-form-urlencoded`) · right: `303 /` + `Set-Cookie: tq_session=…; Max-Age=1209600; Path=/; HttpOnly; Secure; SameSite=Lax` · wrong: `401` login page with "Wrong password" after 1 s · `429` login page "Too many tries" (10 per IP per minute) · `403 cross_origin` · `415` |
| `GET /logout` | `303 /` + `Set-Cookie: tq_session=; Max-Age=0; …` |
| `POST /api/attempt` | `{ ok: true, attempts, best, latest, rank, players, newBest }` · `400 invalid_attempt` (with `details`) · `401 unauthorised` (no session) / `401 bad_key` (wrong `X-Intake-Key`) · `413 too_large` (16 KB cap) · `415 unsupported_media_type` · `429 rate_limited` (`Retry-After`) · `503 store_unavailable` (D1 could not be written) · `503 not_configured` (no `DB` binding) |
| `GET /api/league` | `{ ok: true, players: [{ rank, name, attempts, best, latest, bestUseCase, fteEquivalent, firstPlayedAt, lastPlayedAt }], attempts }` — never includes emails for browsers; with `X-Intake-Key` each row also carries `email, bestAt, latestAt` so a kiosk can merge by player · `401 unauthorised` without a session |
| `GET /api/health` | public: `{ ok: true, service, gate, configured }` · with a session or the key: also `session` (`"secret"` or `"derived"`), `store: { kind: "d1", ok, attempts, players, lastPlayedAt, lastOkAt, lastError, lastErrorAt }` and `mirror: { enabled, … }` · `configured:false` while the `DB` binding is missing · always `200`: `store.ok:false` when the table cannot be read right now, and `store.lastError` keeps the newest failure (`D1: the attempts table does not exist yet: run npx wrangler d1 migrations apply …`) until a game is written |
| `GET /staff` | session or key: the staff page (`text/html`, `no-store`, `noindex`) · without: the login page (`200`) · a wrong key: `401 bad_key` |
| `GET /api/export.csv` | session or key: every game as CSV (`text/csv; charset=utf-8`, `Content-Disposition: attachment`, UTF-8 BOM, CRLF, header `played_at,name,email,score,use_case,scenario,cost_per_mtok,profit_per_hour,fte_equivalent,annual_savings,human_hours_per_year,consent_at,source`) · `401 unauthorised` without |
| `GET /api/export.md` | session or key: `PLAYERS.md` rendered from the rows (`text/markdown`, attachment) · `401` without |
| `GET /api/players.json` | session or key: every game as a JSON array (`id, playedAt, name, email, score, useCase, …, consentAt, source`) · `401` without |
| `GET /api/export.xlsx`, `POST /api/reset` | `404` with a message: the CSV is the export, clearing is a wrangler command |
| `OPTIONS /api/*` | CORS preflight for the extra allowed origins (the game itself is same-origin) |
| anything else | with a session (or no gate): the game from the assets (`env.ASSETS`) · without: the login page (`200`) for GET/HEAD, `401` JSON otherwise |

Validation is identical to the kiosk server: name 2-40 letters/spaces/apostrophes/hyphens, email
lowercased and shape-checked, finite `score >= 0`, `consent === true`, ISO/epoch `consentAt` and
`playedAt`. `tests/intake.test.js` asserts that `src/validate.mjs` and `src/players.mjs` are
identical to `server/validate.mjs` and `server/players.mjs` apart from the header comment, and that
both pairs give the same answers.

## Configuration

| Name | Where | Meaning |
| --- | --- | --- |
| `ACCESS_PASSWORD` | `npx wrangler secret put ACCESS_PASSWORD` | The team password. Set = gate on; `npx wrangler secret delete ACCESS_PASSWORD` = game open. Never written to a file in this repo |
| `SESSION_SECRET` | `openssl rand -hex 32 \| npx wrangler secret put SESSION_SECRET` | Signs the session cookie; rotate it to log everyone out. If missing, a key derived from the password is used and health says `"session":"derived"` |
| `INTAKE_KEY` | `openssl rand -hex 24 \| npx wrangler secret put INTAKE_KEY` | The kiosk laptops' `UPSTREAM_KEY` (their git-ignored `.env`), sent as `X-Intake-Key`. Unset = no key is accepted (a header is still `401 bad_key`). Rotate it and update every laptop's `.env` |
| `DB` | `wrangler.toml` `[[d1_databases]]` | The scores database `tokenquest-players` (`binding = "DB"`, its `database_id`, `migrations_dir = "migrations"`). Created once with `npx wrangler d1 create tokenquest-players`; the table with `npx wrangler d1 migrations apply tokenquest-players --remote`. Not a secret |
| `MIRROR_MARKDOWN` | `[vars]` | `"true"` turns the optional GitHub mirror on (default `"false"`); it also needs `PLAYERS_REPO` and `GITHUB_TOKEN` |
| `GITHUB_TOKEN` | `npx wrangler secret put GITHUB_TOKEN` | Mirror only: fine-grained PAT scoped to the one private repo, permission **Contents: Read and write**. A `write 404` in health's `mirror.lastError` means the PAT was not given that repository |
| `PLAYERS_REPO` | `[vars]` | Mirror only: `owner/repo` of the private players repo |
| `PLAYERS_BRANCH` | `[vars]` | Mirror only: default `main` |
| `ALLOWED_ORIGINS` | `[vars]` | Comma-separated extra browser origins (the GitHub Pages copy, a local preview); the Worker's own origin is always allowed. Only useful while the gate is off: the cookie is `SameSite=Lax`, so cross-site posts are `401` |
| `RATE_LIMIT_ATTEMPTS_PER_MINUTE` / `RATE_LIMIT_READS_PER_MINUTE` / `RATE_LIMIT_LOGINS_PER_MINUTE` | `[vars]` | Per-IP token buckets (defaults 20, 60 and 10) |
| `RATE_LIMIT_KIOSK_PER_MINUTE` | `[vars]` | One per-IP bucket for everything a key caller does (default 120), sized to drain a queue after an outage |

## Build, deploy, test

```sh
# From the game repo root
npm run build:worker                 # dist/ with no base path and no intake injection (same origin)
npm run deploy:worker                # build + `npx wrangler@4 deploy -c deploy/intake-worker/wrangler.toml`
npx wrangler@4 deploy --dry-run --outdir /tmp/tq-wrangler-dry -c deploy/intake-worker/wrangler.toml   # config check, no login

# Unit tests against an in-memory D1 (tests/helpers/fake-d1.mjs on node:sqlite, Node 22.13+: it runs the
# real migration and the real SQL), a fake ASSETS binding and Node's WebCrypto
node --test tests/intake.test.js tests/gate.test.js tests/sync.test.js        # or: npm run test:intake
for f in deploy/intake-worker/src/*.mjs; do node --check "$f"; done

# Real Worker on http://127.0.0.1:8787 serving dist/ with a LOCAL D1 (wrangler's own SQLite file under
# .wrangler/, nothing remote). Leave ACCESS_PASSWORD out of .dev.vars to play without the gate, or add a
# local one to try the login page (the cookie is `Secure`; browsers accept Secure cookies from
# http://127.0.0.1 and http://localhost).
cd deploy/intake-worker
npx wrangler d1 migrations apply tokenquest-players --local      # the attempts table in the local copy
npx wrangler dev
curl -s http://127.0.0.1:8787/api/health
```

`.github/workflows/deploy-worker.yml` runs the same build and deploy on every push to the game branch
once the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets exist.

## Limits and caveats

- **Rate limit is per isolate.** The token bucket lives in the Worker's memory, so it is "per IP,
  per data centre, per isolate lifetime". It blunts careless scripts; for a hard cap add a WAF
  rate-limiting rule for the Worker in the Cloudflare dashboard (the free plan includes one rule).
- **One shared password is a team door, not per-person auth.** Anyone it is passed on to can play
  and post a valid-looking attempt. Payloads are validated and capped, emails must look like emails
  and consent must be `true`, but the database can still collect junk rows; delete them with
  `npx wrangler d1 execute tokenquest-players --remote --command "DELETE FROM attempts WHERE …"`.
  Rotate the password with `wrangler secret put ACCESS_PASSWORD`; rotate `SESSION_SECRET` to
  invalidate every cookie at once. For named logins or a hard rate cap put the Worker behind
  Cloudflare Access.
- **Idempotent replays.** An attempt with the same email, `playedAt` and score as one already on
  file is treated as the same game (the browser client and the kiosk journal re-post unchanged
  payloads after a failure): the `UNIQUE replay_key` makes the insert a no-op and the answer carries
  the same numbers.
- **One key for all laptops.** `INTAKE_KEY` is a shared machine credential, not a person: anyone
  holding it can post valid-looking games, read the league with emails and download the CSV. Keep it
  in the laptops' git-ignored `.env` only, and rotate it after the event.
- **Size.** A game is one insert plus one read of the table (a few hundred bytes per row); the league,
  the staff page and the downloads read every row on each request and aggregate in JS, which is fine
  for trade-show volumes (thousands of games) within the free tier's 10 ms CPU budget and D1's free
  daily quotas (5 M rows read, 100 k written). Clear the table after the event rather than growing it
  forever.
- **Concurrency.** Two games finishing in the same second are two inserts in one SQLite database;
  each answer is computed from the rows at that moment, so every device agrees on the numbers.
- **Staff panel on this host.** `/api/health` is 200, so the game's staff panel enables its Excel and
  reset buttons; both answer 404 here ("EXPORT FAILED" / "RESET FAILED"). Use `/staff` instead.
- **Nothing is logged about people.** Log lines are `METHOD /path status ms` plus a D1 error message
  without row contents; the password, the intake key, cookies and row contents never appear in errors.
