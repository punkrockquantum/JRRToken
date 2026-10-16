# Token Quest Worker (`tokenquest`)

One Cloudflare Worker (free tier, no servers) that serves the whole game **and** its `/api` on one
origin, `https://tokenquest.tokenquest.workers.dev`, behind one team password:

- the gate: `src/gate.mjs` + the top of `src/worker.mjs`. Every request runs through the script
  (`run_worker_first = true`); without a valid `tq_session` cookie a visitor gets the 8-bit login page
  (inline CSS, one field), `POST /login` checks the password against the `ACCESS_PASSWORD` secret in
  constant time and sets an HMAC-signed cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, 14 days, key
  `SESSION_SECRET`), `/api/*` answers `401` without the cookie (except the public, minimal
  `/api/health`), `GET /logout` clears it. No `ACCESS_PASSWORD` secret = no gate (local dev);
- the game: Workers Static Assets uploaded from `dist/` (`npm run build:worker`), with
  `dist/404.html` for unknown paths; the script re-applies the cache rules from `deploy/static/_headers`
  (HTML/JS/CSS `no-store`, fonts one year) because Workers skip `_headers` when the script runs first;
- the API: `src/worker.mjs`, which keeps the player sheet in a **separate private GitHub repo** so that
  names and email addresses never touch the public game repo or the kiosk laptop:
  - `players.json` — source of truth, an array of validated attempts in the order they arrived
  - `PLAYERS.md` — the staff sheet, regenerated from `players.json` after **every** game

Both files are committed before the Worker answers `{ ok: true }`. There is no batching, debounce
or "write later": if GitHub cannot be written after three compare-and-swap tries the Worker answers
`503 { ok: false, error: "store_unavailable" }` and the game client keeps the attempt in its
localStorage queue and retries. Staff read the sheet by opening `PLAYERS.md` in the private repo on
GitHub (it renders as two tables); there is deliberately no export endpoint here.

The step-by-step setup (deploy, secrets, private repo, PAT, GitHub Actions auto-deploy) is in
[`HOSTING.md`](../../HOSTING.md), sections **One URL on workers.dev** and **Team access**. workers.dev
names are always `<worker>.<account-subdomain>.workers.dev`; `wrangler.toml` shows how to add a custom
domain later.

## Endpoints

Same contract as the kiosk server (`server/app.mjs`), documented at the top of `js/sync.js`:

| Route | Answer |
| --- | --- |
| `GET /login` | the login page (`200`, `text/html`), or `303 /` when already logged in or the gate is off |
| `POST /login` | form field `password` (same-origin `Origin`, `application/x-www-form-urlencoded`) · right: `303 /` + `Set-Cookie: tq_session=…; Max-Age=1209600; Path=/; HttpOnly; Secure; SameSite=Lax` · wrong: `401` login page with "Wrong password" after 1 s · `429` login page "Too many tries" (10 per IP per minute) · `403 cross_origin` · `415` |
| `GET /logout` | `303 /` + `Set-Cookie: tq_session=; Max-Age=0; …` |
| `POST /api/attempt` | `{ ok: true, attempts, best, latest, rank, players, newBest }` · `400 invalid_attempt` (with `details`) · `401 unauthorised` (no session) · `413 too_large` (16 KB cap) · `415 unsupported_media_type` · `429 rate_limited` (`Retry-After`) · `503 store_unavailable` · `503 not_configured` (no `GITHUB_TOKEN` yet) |
| `GET /api/league` | `{ ok: true, players: [{ rank, name, attempts, best, latest, bestUseCase, fteEquivalent, firstPlayedAt, lastPlayedAt }], attempts }` — never includes emails · `401 unauthorised` without a session |
| `GET /api/health` | public: `{ ok: true, service, gate, configured }` · with a session: also `session` (`"secret"` or `"derived"`), `repo, branch, sheet, attempts, players` · `configured:false` while `GITHUB_TOKEN` is missing · `503 store_unavailable` when the repo or token is wrong |
| `GET /api/export.xlsx`, `POST /api/reset` | `404` with a message: the private repo is the sheet |
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
| `GITHUB_TOKEN` | `npx wrangler secret put GITHUB_TOKEN` | Fine-grained PAT scoped to the one private repo, permission **Contents: Read and write** |
| `PLAYERS_REPO` | `wrangler.toml` `[vars]` | `owner/repo` of the private players repo |
| `PLAYERS_BRANCH` | `[vars]` | default `main` |
| `ALLOWED_ORIGINS` | `[vars]` | Comma-separated extra browser origins (the GitHub Pages copy, a local preview); the Worker's own origin is always allowed. Only useful while the gate is off: the cookie is `SameSite=Lax`, so cross-site posts are `401` |
| `RATE_LIMIT_ATTEMPTS_PER_MINUTE` / `RATE_LIMIT_READS_PER_MINUTE` / `RATE_LIMIT_LOGINS_PER_MINUTE` | `[vars]` | Per-IP token buckets (defaults 20, 60 and 10) |

## Build, deploy, test

```sh
# From the game repo root
npm run build:worker                 # dist/ with no base path and no intake injection (same origin)
npm run deploy:worker                # build + `npx wrangler@4 deploy -c deploy/intake-worker/wrangler.toml`
npx wrangler@4 deploy --dry-run --outdir /tmp/tq-wrangler-dry -c deploy/intake-worker/wrangler.toml   # config check, no login

# Unit tests against an in-memory fake of the GitHub Contents API, a fake ASSETS binding and Node's WebCrypto
node --test tests/intake.test.js tests/gate.test.js tests/sync.test.js        # or: npm run test:intake
for f in deploy/intake-worker/src/*.mjs; do node --check "$f"; done

# Real Worker on http://127.0.0.1:8787 serving dist/ and talking to the real private repo.
# Leave ACCESS_PASSWORD out of .dev.vars to play without the gate, or add a local one to try the login page
# (the cookie is `Secure`; browsers accept Secure cookies from http://127.0.0.1 and http://localhost).
cd deploy/intake-worker
printf 'GITHUB_TOKEN=%s\n' '<paste PAT>' > .dev.vars                # git-ignored
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
  and consent must be `true`, but the sheet can still collect junk rows; delete them from
  `players.json` in the private repo (the next game rewrites `PLAYERS.md`). Rotate the password with
  `wrangler secret put ACCESS_PASSWORD`; rotate `SESSION_SECRET` to invalidate every cookie at once.
  For named logins or a hard rate cap put the Worker behind Cloudflare Access.
- **Idempotent replays.** An attempt with the same email, `playedAt` and score as one already on
  file is treated as the same game (the client re-posts unchanged payloads after a failure); it is
  not appended twice, but `PLAYERS.md` is still regenerated.
- **Size.** Each game adds about 400 bytes to `players.json`. The Contents API serves files up to
  1 MB inline and the Worker falls back to the raw media type above that, so thousands of games fit;
  the free tier's CPU budget (10 ms per request) is the practical ceiling. Archive the repo after
  the event rather than growing it forever.
- **Concurrency.** Two games finishing in the same second race on the same file; the loser gets a
  409 from GitHub, re-reads and retries (up to 3 times, jittered backoff). `PLAYERS.md` is re-rendered
  from the newest `players.json` on every write, so it cannot stay stale for longer than one game.
- **Staff panel on this host.** `/api/health` is 200, so the game's staff panel enables its Excel and
  reset buttons; both answer 404 here ("EXPORT FAILED" / "RESET FAILED"). The sheet is `PLAYERS.md`.
- **Nothing is logged about people.** Log lines are `METHOD /path status ms` plus GitHub HTTP
  status codes; the token, the password, cookies and file contents never appear in errors.
