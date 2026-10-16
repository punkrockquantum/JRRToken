# Token Quest intake Worker

A Cloudflare Worker (free tier, no servers) that the public static demo posts finished games to.
It keeps the player sheet in a **separate private GitHub repo** so that names and email addresses
never touch the public game repo or the kiosk laptop:

- `players.json` — source of truth, an array of validated attempts in the order they arrived
- `PLAYERS.md` — the staff sheet, regenerated from `players.json` after **every** game

Both files are committed before the Worker answers `{ ok: true }`. There is no batching, debounce
or "write later": if GitHub cannot be written after three compare-and-swap tries the Worker answers
`503 { ok: false, error: "store_unavailable" }` and the game client keeps the attempt in its
localStorage queue and retries. Staff read the sheet by opening `PLAYERS.md` in the private repo on
GitHub (it renders as two tables); there is deliberately no export endpoint here.

The step-by-step setup (private repo, PAT, deploy, wiring the Pages build) is in
[`HOSTING.md`](../../HOSTING.md), section **Hosted player sheet**.

## Endpoints

Same contract as the kiosk server (`server/app.mjs`), documented at the top of `js/sync.js`:

| Route | Answer |
| --- | --- |
| `POST /api/attempt` | `{ ok: true, attempts, best, latest, rank, players, newBest }` · `400 invalid_attempt` (with `details`) · `413 too_large` (16 KB cap) · `415 unsupported_media_type` · `429 rate_limited` (`Retry-After`) · `503 store_unavailable` |
| `GET /api/league` | `{ ok: true, players: [{ rank, name, attempts, best, latest, bestUseCase, fteEquivalent, firstPlayedAt, lastPlayedAt }], attempts }` — never includes emails |
| `GET /api/health` | `{ ok: true, service, repo, branch, sheet, attempts, players }` · `503 store_unavailable` when the repo or token is wrong (so a fresh deploy can be checked with one `curl`) |
| `OPTIONS /api/*` | CORS preflight for the allowed origins |

Validation is identical to the kiosk server: name 2-40 letters/spaces/apostrophes/hyphens, email
lowercased and shape-checked, finite `score >= 0`, `consent === true`, ISO/epoch `consentAt` and
`playedAt`. `tests/intake.test.js` asserts that `src/validate.mjs` and `src/players.mjs` are
identical to `server/validate.mjs` and `server/players.mjs` apart from the header comment, and that
both pairs give the same answers.

## Configuration

| Name | Where | Meaning |
| --- | --- | --- |
| `GITHUB_TOKEN` | `npx wrangler secret put GITHUB_TOKEN` | Fine-grained PAT scoped to the one private repo, permission **Contents: Read and write** |
| `PLAYERS_REPO` | `wrangler.toml` `[vars]` | `owner/repo` of the private players repo |
| `PLAYERS_BRANCH` | `[vars]` | default `main` |
| `ALLOWED_ORIGINS` | `[vars]` | Comma-separated browser origins; default `https://punkrockquantum.github.io` |
| `RATE_LIMIT_ATTEMPTS_PER_MINUTE` / `RATE_LIMIT_READS_PER_MINUTE` | `[vars]` | Per-IP token buckets (defaults 20 and 60) |

## Run and test locally

```sh
# From the game repo root: unit tests against an in-memory fake of the GitHub Contents API
node --test tests/intake.test.js tests/sync.test.js        # or: npm run test:intake
for f in deploy/intake-worker/src/*.mjs; do node --check "$f"; done

# Real Worker on http://127.0.0.1:8787 talking to the real private repo (needs a token)
cd deploy/intake-worker
printf 'GITHUB_TOKEN=%s\n' '<paste PAT>' > .dev.vars                # git-ignored
npx wrangler dev
curl -s http://127.0.0.1:8787/api/health
```

## Limits and caveats

- **Rate limit is per isolate.** The token bucket lives in the Worker's memory, so it is "per IP,
  per data centre, per isolate lifetime". It blunts careless scripts; for a hard cap add a WAF
  rate-limiting rule for the Worker route in the Cloudflare dashboard (Security → WAF → Rate
  limiting rules; the free plan includes one rule).
- **The URL is public.** Anyone who finds it can post a valid-looking attempt. Payloads are
  validated and capped, emails must look like emails and consent must be `true`, but the sheet can
  still collect junk rows; delete them from `players.json` in the private repo (the next game
  rewrites `PLAYERS.md`).
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
- **Nothing is logged about people.** Log lines are `METHOD /path status ms` plus GitHub HTTP
  status codes; the token and file contents never appear in errors.
