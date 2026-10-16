# Hosting Token Quest on the kiosk laptop

Everything runs locally with Node.js 18+ (no npm packages). Scores are kept in `data/attempts.jsonl` and
mirrored to an Excel workbook on the Desktop after every run.

## Start the kiosk

- Double-click `start-token-quest.command`. It starts the server on http://127.0.0.1:8080/ and opens
  the game in Chrome kiosk mode (or the default browser). Keep the Terminal window open; Ctrl+C stops the
  server and Cmd+Q quits the browser.
- The first time, macOS may ask you to allow the script (right-click → Open) and to let Terminal
  access the Desktop so the Excel file can be written.
- From a shell: `npm start` (same thing without the browser). `node scripts/serve.mjs --help` lists all options.

## Where the Excel file lands

`~/Desktop/Token Quest Leaderboard.xlsx`, rewritten about a second after each attempt (override with
`EXPORT_PATH`). Two sheets:

- **Players** (one row per email, ranked): Name · Email · Attempts · Best Score · Latest Score · Best Cost per 1M
  tokens ($) · Best Use Case · First Played · Last Played · Consent · Consent At · Best people-power · Best annual saving
- **Attempts** (every run, newest first): Played At · Name · Email · Use Case · Scenario · Score · Cost per 1M tokens ($) ·
  Profit per hour ($) · People-power (FTE) · Human hours / year · Annual saving ($)

Close and reopen the file in Excel to see new rows: Excel keeps the copy it opened. `npm run export` regenerates
it on demand and prints the path.

The server only serves `index.html`, `css/`, `js/` and `assets/`-style files: `data/`, `server/`, `scripts/`,
`tests/`, dot-files and any `.jsonl`, `.xlsx` or `.env` file are always 404.

## Staff actions (export / reset)

The kiosk's on-screen staff tools use a local PIN (default `8462`; the code is public, so change it on the booth machine from the browser console with `localStorage.setItem("token-quest-staff-pin", "your-pin")`). The server's `STAFF_PIN` is separate and must not match the client PIN.

Set `STAFF_PIN` before starting (`STAFF_PIN=<choose-a-pin> npm start`) and send it as the `X-Staff-Pin` header:

```sh
curl -H "X-Staff-Pin: <your-pin>" -o leaderboard.xlsx http://127.0.0.1:8080/api/export.xlsx
curl -X POST -H "X-Staff-Pin: <your-pin>" http://127.0.0.1:8080/api/reset
```

Reset never deletes anything: `data/attempts.jsonl` is renamed to `attempts-<timestamp>.jsonl` (with a copy
of the workbook next to it) and the board starts empty. Without `STAFF_PIN`, these two endpoints only answer
requests made from the laptop itself.

## LAN mode (other devices on the stand)

`npm run serve:lan` binds to all interfaces and prints the LAN URLs. **Warning:** anyone on that network can
open the game and post scores, so only use it on a trusted stand network and always set `STAFF_PIN`.

## Start automatically at login

```sh
./scripts/install-autostart.sh              # install or update (PORT, DATA_DIR, EXPORT_PATH, STAFF_PIN, LAN=1 honoured)
./scripts/install-autostart.sh --uninstall  # remove
```

This installs `~/Library/LaunchAgents/com.tokenquest.server.plist` (KeepAlive, restarts if it crashes) and logs
to `data/server.log`. If the Desktop export fails under launchd (`Operation not permitted`), grant Node access
in System Settings → Privacy & Security → Files and Folders, or point `EXPORT_PATH` somewhere else.
Double-clicking the launcher while the agent is running simply opens the browser.

## Tests

```sh
node --test tests/server.test.js tests/xlsx.test.js   # or: npm run test:server
```

## Personal data

`data/` and the Excel file contain names and email addresses (both are git-ignored). Keep the laptop's disk
encrypted (FileVault), keep `STAFF_PIN` private, and delete `data/`, the workbook and any archived copies once
the event is over and the leads have been handed on.

## Hosting a public demo

Three ways to let people play somewhere other than the kiosk laptop. Pick by what you need from the scores.

| Path | Shared league | Excel / staff export | What is collected | Use it for |
| --- | --- | --- | --- | --- |
| **Static** (Netlify, Vercel, Cloudflare Pages, GitHub Pages) | No: each browser keeps its own league | No (JSON/CSV of that browser only) | Nothing server-side | Open playtesting, sharing a link |
| **Server** (Render, Fly.io, any Docker host) | Yes | Yes, with `STAFF_PIN` | Names + emails on the host's disk | The booth, lead capture |
| **Tunnel** (cloudflared / ngrok in front of the laptop) | Yes (the laptop's) | Yes, with `STAFF_PIN` | Names + emails stay on the laptop | A quick remote test of the real booth setup |

Recommendation: use the **static** path for open playtesting (nothing to protect, free, one command) and
the **server** path for the booth. Use a **tunnel** only to test the booth setup remotely for an hour.

### Static demo (no server, no `/api`)

```sh
npm run build:static                    # -> dist/ (git-ignored)
npm run serve:static                    # build, then preview on http://127.0.0.1:8099/ (Ctrl+C to stop)
BASE_PATH=/JRRToken npm run serve:static   # preview as a subpath site: http://127.0.0.1:8099/JRRToken/
```

`scripts/build-static.mjs` copies `index.html`, `css/`, `js/` and `assets/` as they are (no bundling), adds a
small `404.html` and `deploy/static/_headers`, then checks that every link in `index.html`, every CSS `url()`
and every ES module import resolves inside `dist/`. The game's own URLs are relative, so it works at the
root and under a subpath; `BASE_PATH` only rewrites root-relative `href`/`src`/`url(/…)` in HTML/CSS (there
are none today, the build prints the count) and is set automatically by the GitHub Pages workflow.

What happens to the booth calls on a static host: `/api/*` answers 404, so `fetchLeague()` resolves `null`
and the title screen shows the browser's own league, `recordAttempt()` gets a non-retried rejection and the
results show the local `RANK x OF y`, and the staff panel's **DOWNLOAD EXCEL** / **RESET SERVER LEAGUE**
stay disabled ("The booth server is offline"). JSON/CSV downloads of that browser's league still work.
The `404.html` matters on Cloudflare Pages: without it Pages answers unknown paths with `index.html` and a
200, and the staff panel would believe a booth server is present.

Deploy (each CLI opens a browser login the first time; `./scripts/deploy-static.sh <netlify|vercel|cloudflare>`
wraps build + deploy):

```sh
# Netlify: netlify.toml holds the build command, publish dir and cache headers
npx netlify-cli login && npx netlify-cli deploy --prod --build

# Vercel: vercel.json holds the build command, output dir and cache headers
npx vercel login && npx vercel deploy --prod

# Cloudflare Pages (direct upload; or connect the repo with build "npm run build:static", output "dist")
npx wrangler login && npx wrangler pages project create token-quest --production-branch main
npm run build:static && npx wrangler pages deploy dist --project-name token-quest

# GitHub Pages: .github/workflows/pages.yml builds and deploys on push to main (or Run workflow)
npm run deploy:gh-pages        # prints the steps; runs no git command
```

GitHub Pages notes: the repo setting **Settings → Pages → Source: GitHub Actions** is a one-time step; the
site is `https://punkrockquantum.github.io/JRRToken/`; a private repo needs a paid GitHub plan for Pages
(the site is public either way); GitHub caches files for ~10 minutes, so hard-refresh after a deploy. Netlify,
Vercel and Cloudflare serve HTML/CSS/JS with `no-store` (a redeploy shows on the next load) and cache the
fonts for a year.

### Booth server (shared league + Excel + staff export)

The `Dockerfile` (node:22-alpine, no npm install) runs `node scripts/serve.mjs --lan` with `HOST=0.0.0.0`,
`PORT` from the environment (Render injects its own), `DATA_DIR=/data` and
`EXPORT_PATH=/data/Token Quest Leaderboard.xlsx`. Attempts and the workbook live in `/data`: mount a disk or
volume there or they vanish with the container. `deploy/docker-entrypoint.sh` makes the mounted `/data`
writable and then runs the server as the unprivileged `node` user. The image's `HEALTHCHECK` and both
platform configs probe `GET /api/health`.

```sh
# Local Docker (needs Docker Desktop)
npm run docker:build
STAFF_PIN=<choose-a-pin> npm run docker:run          # http://127.0.0.1:8080/, data in the token-quest-data volume

# Render (render.yaml: web service + 1 GB disk at /data; a paid Starter instance is needed for the disk)
#   Dashboard -> New -> Blueprint -> this repo. Render asks for STAFF_PIN; it is never stored in the repo.
#   autoDeploy is off so a push mid-event cannot restart the booth; use "Manual Deploy" when you want it.

# Fly.io (fly.toml: one shared-cpu-1x machine in London + 1 GB volume at /data)
fly launch --no-deploy --copy-config --name <unique-app-name>   # then set app = "<unique-app-name>" in fly.toml
fly secrets set STAFF_PIN=<choose-a-pin>
fly deploy --ha=false                                            # one machine, because a volume belongs to one machine
```

Export from a public host (the PIN header is **required**; without `STAFF_PIN` the server only serves staff
routes to loopback callers, and behind Render's or Fly's proxy nothing is loopback, so export and reset are
simply refused until the secret is set):

```sh
curl -H "X-Staff-Pin: $STAFF_PIN" -o leaderboard.xlsx https://<your-host>/api/export.xlsx
curl -X POST -H "X-Staff-Pin: $STAFF_PIN" https://<your-host>/api/reset      # archives inside /data, then clears
```

The staff panel in the game (five clicks on the logo) also downloads the workbook and resets the server league
once unlocked; it sends the PIN typed into the panel as `X-Staff-Pin`. Keep the disk/volume region in mind
(`frankfurt` / `lhr` in the configs) and delete the disk or volume once the leads have been handed on.

### Quick tunnel (the laptop stays the host)

```sh
STAFF_PIN=<choose-a-pin> npm start                 # loopback binding is fine: the tunnel connects to 127.0.0.1
cloudflared tunnel --url http://127.0.0.1:8080     # brew install cloudflared; prints https://<random>.trycloudflare.com
ngrok http 8080                                    # brew install ngrok; needs a free account (ngrok config add-authtoken ...)
```

Caveats: `STAFF_PIN` is **mandatory** here. Every tunnelled request reaches the server from `127.0.0.1`, so
without a PIN the "loopback callers may export" rule would let anyone on the internet download
`/api/export.xlsx` (names and emails) or reset the league. The laptop must stay awake and online
(`caffeinate -dis` in another terminal); the public URL changes every time a quick tunnel restarts; ngrok's
free tier shows an interstitial page on the first visit.

### Privacy and security on a public host

- Names and emails are collected under the consent text on the title screen. Only the server and tunnel
  paths store them centrally; the static path stores nothing server-side (the league stays in each player's
  browser, and only that browser's staff panel can export it).
- Set `STAFF_PIN` on any host that is not the kiosk laptop. The server PIN must differ from the staff-panel
  PIN in `js/main.js` (default `8462`, overridable via localStorage): that one is in a public JavaScript file and only unlocks the panel in the
  browser, so never reuse it as `STAFF_PIN`.
- HTTPS only. Render, Fly, Netlify, Vercel, Cloudflare, GitHub Pages and both tunnels terminate TLS for you;
  do not publish the plain-HTTP Docker port directly to the internet.
- Anyone with the server URL can post scores. Payloads are validated (name characters, email shape, 64 KB
  limit) but there is no rate limit, so keep the booth URL for the booth and use the static path for anything
  shared widely.
- Treat `/data` on a host like the Desktop workbook: pick an EU/UK region, keep the PIN private, export, then
  delete the disk or volume after the event.

## One URL on workers.dev

One Cloudflare Worker, `tokenquest` (`deploy/intake-worker/`), serves the whole game **and** its `/api`
on the same origin, behind one team password (see "Team access"), with the player sheet kept in a
separate **private** GitHub repo:

```
https://tokenquest.tokenquest.workers.dev
  every request first passes the team-access gate (session cookie, else the login page)
  /, /js/*, /css/*, /assets/*, /404.html   Workers Static Assets, uploaded from dist/ (npm run build:worker)
  /login  /logout                          the gate (Worker secrets ACCESS_PASSWORD, SESSION_SECRET)
  /api/attempt  /api/league  /api/health    the Worker script (run_worker_first = true)
        |  GitHub Contents API, fine-grained PAT (Worker secret GITHUB_TOKEN)
        v
  private repo punkrockquantum/token-quest-players
    players.json   source of truth: every attempt
    PLAYERS.md     the sheet, rewritten after EVERY game
```

**Live now:** https://tokenquest.tokenquest.workers.dev is deployed with the team password and session
secret set (open it, type the team password, play). Only the player sheet is still waiting for the
`GITHUB_TOKEN` secret (step 1 below): until then `/api/health` says `"configured":false`, games play
and the browser queues each result for the sheet.

**About the name.** workers.dev hostnames are always `<worker>.<account-subdomain>.workers.dev`, so the
URL is `https://tokenquest.tokenquest.workers.dev` (the account subdomain happens to be `tokenquest`
too); a bare `https://tokenquest.workers.dev` is not something Cloudflare hands out. `npx wrangler deploy` prints the exact URL and `npx wrangler whoami` the
account. To serve the game on a domain you own later, put the zone on Cloudflare and add to
`deploy/intake-worker/wrangler.toml`:

```toml
routes = [{ pattern = "tokenquest.example.com", custom_domain = true }]
```

Because the game and the API share an origin, `js/sync.js` uses its same-origin default (no
`INTAKE_URL`, no CORS) and the results screen's `ATTEMPT n · BEST · RANK` line comes from the Worker,
exactly as at the booth. The GitHub Pages copy at https://punkrockquantum.github.io/JRRToken/ is a
static host, so it cannot be put behind the password; once the Worker is live, switch Pages off or
make it a redirect (see "Team access").

### Finish it (two logins: Cloudflare and GitHub)

```sh
# 1. Cloudflare login + the three Worker secrets (typed or piped in; none of them lives in a file or commit)
cd deploy/intake-worker && npx wrangler login
npx wrangler secret put ACCESS_PASSWORD                      # the team password colleagues type to play
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET  # random key that signs the 14-day session cookie
npx wrangler secret put GITHUB_TOKEN                         # fine-grained PAT for the private players repo
#    (https://github.com/settings/personal-access-tokens/new -> Only select repositories ->
#     token-quest-players -> Repository permissions -> Contents: Read and write; expire it after the event)
cd ../..

# 2. Build dist/ (same-origin, no base path) and deploy the game + API as one Worker
npm run deploy:worker                     # prints https://tokenquest.tokenquest.workers.dev

# 3. Check it
npx wrangler whoami                       # account name, id and the account subdomain
curl -s https://tokenquest.tokenquest.workers.dev/api/health
#    -> {"ok":true,"service":"tokenquest","gate":true,"configured":true}
#       "gate":false means ACCESS_PASSWORD is missing (the game is open);
#       "configured":false means GITHUB_TOKEN is missing (games play, the sheet waits)
curl -sI https://tokenquest.tokenquest.workers.dev/ | head -1     # HTTP/2 200, the login page
```

Play one game at the URL and watch `PLAYERS.md` in the private repo update (the first line reads
`Updated <time> · <n> players · <m> games`). Staff read the sheet there; the Worker has no export or
reset endpoint, so the staff panel's **DOWNLOAD EXCEL** / **RESET SERVER LEAGUE** buttons light up
(health is 200) but answer "EXPORT FAILED" / "RESET FAILED" on this host. JSON/CSV downloads of the
browser's own league still work.

### Auto-deploy on every push (GitHub Actions)

`.github/workflows/deploy-worker.yml` rebuilds `dist/` and runs `wrangler deploy` on every push to the game
branch (and from the Actions tab), so the workers.dev site tracks the branch like GitHub Pages does. It
needs two repository secrets; until they exist it skips with a notice instead of failing:

```sh
# API token: https://dash.cloudflare.com/profile/api-tokens -> Create Token -> template "Edit Cloudflare Workers"
#            (Account Resources: the one account; Zone Resources are not needed for workers.dev)
gh secret set CLOUDFLARE_API_TOKEN --repo punkrockquantum/JRRToken        # paste the token
gh secret set CLOUDFLARE_ACCOUNT_ID --repo punkrockquantum/JRRToken --body <32-hex id from `npx wrangler whoami`>
gh workflow run deploy-worker.yml --repo punkrockquantum/JRRToken --ref cursor/token-quest-datacenter-game
```

The Worker's secrets (`ACCESS_PASSWORD`, `SESSION_SECRET`, `GITHUB_TOKEN`) are set once with `wrangler
secret put` and survive every deploy; `wrangler.toml` carries only plain variables (`PLAYERS_REPO`,
`PLAYERS_BRANCH`, `ALLOWED_ORIGINS`, rate limits). The workflow pins `wranglerVersion: "4.151.1"`; bump it
together with the local `npx wrangler@4`.

### Team access

Colleagues go to the URL, type the team password once, and play. The password is checked on the server
(the Worker), never in the browser's JavaScript, so nothing in `dist/` or this repo reveals it.

- **Login.** Any request without a valid session cookie gets a small 8-bit login page instead of the game
  (`200`, inline CSS only, one password field, **ENTER**). The form posts to `/login` on the same origin;
  the Worker compares the password in constant time and, if it matches, sets `tq_session` (`HttpOnly`,
  `Secure`, `SameSite=Lax`, `Path=/`, 14 days) and redirects to `/`. The cookie is
  `base64url(expiry) + "." + HMAC-SHA256(expiry, SESSION_SECRET)`: nothing to look up, nothing stored, and
  it cannot be forged or extended without the secret. A wrong password gets the page back with
  "Wrong password" after a one-second delay, and each IP gets 10 tries a minute (`RATE_LIMIT_LOGINS_PER_MINUTE`;
  the page then says "Too many tries"). `GET /logout` clears the cookie.
- **The API is behind the same cookie.** `/api/attempt` and `/api/league` answer `401 unauthorised` without
  it, so the public Internet cannot post rows to the sheet or read the league. The one exception is
  `GET /api/health`, which stays public but only says `{ ok, service, gate, configured }` (no repo name, no
  counts) until the caller is logged in. The game's own `fetch` calls carry the cookie automatically.
- **Two secrets, no files.** `ACCESS_PASSWORD` is the team password; `SESSION_SECRET` is a random key
  (`openssl rand -hex 32`) that signs the cookies. Set both with `npx wrangler secret put <NAME>` from
  `deploy/intake-worker/` (the value is typed or piped on the terminal). Neither is written into
  `wrangler.toml`, the workflow, a test or any document in this repo; in docs it is just "the team
  password". If `SESSION_SECRET` is ever missing the Worker derives a signing key from the password so the
  gate never silently opens; `/api/health` then shows `"session":"derived"` as a reminder to set it.
- **Rotation.** A new password: `npx wrangler secret put ACCESS_PASSWORD` (takes effect at once; existing
  sessions stay valid until they expire). Log everyone out: `openssl rand -hex 32 | npx wrangler secret put
  SESSION_SECRET` (every cookie becomes invalid immediately). Open the game to the world (local dev,
  or after the event): `npx wrangler secret delete ACCESS_PASSWORD`; health then reports `"gate":false`.
- **What it is not.** One shared password is a team door, not per-person authentication: anyone the
  password is passed on to can play, and the limiter is per IP per isolate (a venue's Wi-Fi shares one
  IP, so a colleague who mistypes ten times waits a minute). For a hard cap or named logins put the Worker
  behind Cloudflare Access instead.
- **GitHub Pages cannot be gated.** https://punkrockquantum.github.io/JRRToken/ is a static copy of the
  same game: no server, so no password, and the gate's `SameSite=Lax` cookie never travels there, so its
  posts to the Worker's API are refused (`401`) even with `INTAKE_URL` set. Once the Worker is live either
  disable Pages (repo → Settings → Pages → Source: None) or make `pages.yml` publish a one-line
  `index.html` with `<meta http-equiv="refresh" content="0; url=https://tokenquest.tokenquest.workers.dev/">`
  and nothing else, so old links land on the gated game.
- **The kiosk laptop is unchanged.** `server/**` has no gate: the booth server serves the game to the
  venue's local network exactly as before.

### How dist/ is served

- `npm run build:worker` = `node scripts/build-static.mjs --base= --intake=`: the normal static build with
  no base path and no intake injection, into `dist/` (git-ignored). `wrangler.toml` points `[assets]
  directory` at `../../dist`, `binding = "ASSETS"`, `not_found_handling = "404-page"` (unknown paths get
  `dist/404.html` with a real 404, so the staff panel's probes stay honest) and `run_worker_first = true`
  (every request passes through the script so the gate can check the cookie first; the script then hands
  the request to `env.ASSETS.fetch(request)`).
- Cache rules: because the script runs first, Workers Static Assets skips `dist/_headers`, so the Worker
  applies the same rules itself: HTML, JS and CSS are `no-store` (a redeploy shows on the next load), the
  fonts are cached for a year, every asset gets `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer`, and the `ETag` from the asset server is kept. The API and the login page
  set their own `no-store`.
- Validate the config without deploying: `npm run build:worker && npx wrangler@4 deploy --dry-run
  --outdir /tmp/tq-wrangler-dry -c deploy/intake-worker/wrangler.toml` (no login needed).

### The player sheet

- **Every game is a commit.** `POST /api/attempt` validates (same rules as the kiosk server), appends the
  attempt to `players.json` and regenerates `PLAYERS.md`, and only then answers
  `{ ok: true, attempts, best, latest, rank, players, newBest }`. A first-time player adds a Players row; a
  returning player (same email, any letter case) has Attempts, Latest score, Best score and Last played
  updated in place; the Attempts table always gains one row. There is no batching or "write later": if
  GitHub cannot be written (three compare-and-swap tries with backoff) the Worker answers
  `503 { ok: false, error: "store_unavailable" }`, `js/sync.js` keeps the attempt in the browser's queue and
  re-sends it on the next game, page load or reconnect. The same applies while the `GITHUB_TOKEN` secret
  is missing (`503 not_configured`): the game plays, nothing is lost, the sheet fills once the secret is set.
- **The private repo is the sheet.** Open `PLAYERS.md` in `punkrockquantum/token-quest-players` on GitHub;
  `players.json` is the raw list if you want to load it into Excel. Sample:

```md
# Token Quest players

Updated 2026-10-16T14:12:03.000Z · 2 players · 3 games

## Players

| # | Name | Email | Attempts | Best score | Latest score | Best job | First played (UTC) | Last played (UTC) |
| ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 1 | Grace Hopper | grace@example.com | 1 | 1,500 | 1,500 | Drug discovery | 2026-10-16 14:08 | 2026-10-16 14:08 |
| 2 | Ada Lovelace | ada@example.com | 2 | 1,200 | 1,200 | Chat | 2026-10-16 14:05 | 2026-10-16 14:12 |

## Attempts

| Played at (UTC) | Name | Email | Job | Score |
| --- | --- | --- | --- | ---: |
| 2026-10-16 14:12 | Ada Lovelace | ada@example.com | Chat | 1,200 |
| 2026-10-16 14:08 | Grace Hopper | grace@example.com | Drug discovery | 1,500 |
| 2026-10-16 14:05 | Ada Lovelace | ada@example.com | Chat + RAG | 900 |
```

- **Pages too (only while the gate is off).** The GitHub Pages copy collects nothing unless its build gets
  the Worker's URL: `gh variable set INTAKE_URL --repo punkrockquantum/JRRToken --body https://tokenquest.tokenquest.workers.dev`
  then re-run `pages.yml`. `scripts/build-static.mjs` then injects
  `<script>window.TOKEN_QUEST_INTAKE = "..."</script>` into `dist/index.html` and `js/sync.js` posts
  cross-origin to the Worker, whose `ALLOWED_ORIGINS` already lists `https://punkrockquantum.github.io`.
  With `ACCESS_PASSWORD` set those posts are refused (`401`: the session cookie does not cross sites), so
  with the gate on, redirect or disable Pages instead (see "Team access"). `gh variable delete INTAKE_URL`
  + re-run switches the injection off again. The kiosk laptop is untouched either way: `js/sync.js` only
  leaves its own origin when `window.TOKEN_QUEST_INTAKE` is defined, and only the static build ever
  defines it.

Optional smoke test straight at the API (log in first so curl has the cookie; then delete the row from
`players.json` in the private repo; the next real game rewrites `PLAYERS.md`):

```sh
URL=https://tokenquest.tokenquest.workers.dev
curl -s -o /dev/null -c /tmp/tq.jar -X POST "$URL/login" -H "Origin: $URL" --data-urlencode "password=$(cat)"   # type it, then Ctrl-D
curl -s -b /tmp/tq.jar -X POST "$URL/api/attempt" -H 'Content-Type: application/json' \
  -d '{"name":"Test Player","email":"test@example.com","score":1,"consent":true,"consentAt":"2026-10-16T12:00:00Z"}'
rm /tmp/tq.jar
```

To take it all down: `npx wrangler delete -c deploy/intake-worker/wrangler.toml`, delete or archive the
private repo, revoke the PAT (GitHub → Settings → Developer settings → Fine-grained tokens) and the
Cloudflare API token.

### Privacy and limits

- Emails live only in the private repo (and transiently in the Worker while it writes). This public game
  repo, the workers.dev and Pages sites, the Worker's logs and its commit messages never contain them;
  `GET /api/league` returns names and scores only. Delete the private repo after the event and revoke
  the PAT.
- The kiosk laptop's `data/` and Desktop workbook stay completely separate from this sheet: the booth
  posts to its own server, the hosted game posts to the Worker, and nothing merges them.
- The URL is public, so the limits matter: the team password in front of everything but `/api/health`,
  JSON only, 16 KB body cap, `consent` must be literally `true`, a browser `Origin` other than the site's
  own must be on `ALLOWED_ORIGINS`, and each IP gets a token bucket (20 attempts, 60 reads and 10 login
  tries per minute by default). That bucket lives in the Worker's memory, so it is per IP *per isolate*:
  good enough against a careless script, not a hard cap. For a hard cap add a WAF rate-limiting rule for
  the Worker in the Cloudflare dashboard. Remember a venue's Wi-Fi shares one public IP.
- Anyone who has the team password can still post a valid-looking row; junk is deleted by editing
  `players.json` in the private repo. The same attempt re-posted by the browser's retry queue (same email,
  `playedAt` and score) is recognised and not duplicated.
- GitHub's Contents API gives 5,000 requests an hour to the token; a game costs two to four. The free
  Workers plan allows 100,000 requests a day and 10 ms of CPU per request, comfortable for thousands of
  games; `players.json` grows about 400 bytes per game.

### Verify locally

```sh
npm run test:intake                                   # tests/intake.test.js + tests/gate.test.js + tests/sync.test.js
for f in deploy/intake-worker/src/*.mjs; do node --check "$f"; done
npm run build:worker && ! grep -q TOKEN_QUEST_INTAKE dist/index.html   # same-origin build, nothing injected
npx wrangler@4 deploy --dry-run --outdir /tmp/tq-wrangler-dry -c deploy/intake-worker/wrangler.toml
```
