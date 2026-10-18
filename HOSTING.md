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
- More than one laptop on the stand? See "Many laptops, one league" at the end: either every laptop opens
  the team URL (nothing local), or each local kiosk also sends every game to the team server.

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
on the same origin, behind one team password (see "Team access"), with every score, name and email
kept in a Cloudflare D1 database (SQLite) bound to the Worker. No GitHub, no laptop and no browser
holds the only copy:

```
https://tokenquest.tokenquest.workers.dev
  every request first passes the team-access gate (session cookie, else the login page)
  /, /js/*, /css/*, /assets/*, /404.html   Workers Static Assets, uploaded from dist/ (npm run build:worker)
  /login  /logout                          the gate (Worker secrets ACCESS_PASSWORD, SESSION_SECRET)
  /api/attempt  /api/league  /api/health    the Worker script (run_worker_first = true)
  /staff  /api/export.csv  /api/export.md  /api/players.json   staff: who played, downloads (cookie or key)
        |  D1 binding DB (wrangler.toml [[d1_databases]])
        v
  D1 database tokenquest-players (Cloudflare's SQLite; untouched by deploys, laptops and browsers)
    attempts       one row per game: played_at, name, email, score, use_case, ..., consent_at, source
```

**Live now:** https://tokenquest.tokenquest.workers.dev is deployed with the team password, the session
secret and the database (open it, type the team password, play; then open
https://tokenquest.tokenquest.workers.dev/staff to see the game on file). See "Scores database (D1)"
below for where the data lives, how to download it and how to clear it after the event.

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

### Finish it (one login: Cloudflare)

```sh
# 1. Cloudflare login + the Worker secrets (typed or piped in; none of them lives in a file or commit)
cd deploy/intake-worker && npx wrangler login
npx wrangler secret put ACCESS_PASSWORD                      # the team password colleagues type to play
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET  # random key that signs the 14-day session cookie
npx wrangler secret put INTAKE_KEY                           # `openssl rand -hex 24`; the kiosk laptops' UPSTREAM_KEY

# 2. The scores database (already done for tokenquest-players; only for a fresh account or a new migration)
npx wrangler d1 create tokenquest-players                    # once; paste the printed database_id into wrangler.toml
npx wrangler d1 migrations apply tokenquest-players --remote # creates the attempts table (migrations/*.sql, each once)
cd ../..

# 3. Build dist/ (same-origin, no base path) and deploy the game + API as one Worker
npm run deploy:worker                     # prints https://tokenquest.tokenquest.workers.dev

# 4. Check it
npx wrangler whoami                       # account name, id and the account subdomain
curl -s https://tokenquest.tokenquest.workers.dev/api/health
#    -> {"ok":true,"service":"tokenquest","gate":true,"configured":true}
#       "gate":false means ACCESS_PASSWORD is missing (the game is open);
#       "configured":false means the D1 binding is missing from wrangler.toml (games play, the clients queue)
curl -s -H "X-Intake-Key: $(cat)" https://tokenquest.tokenquest.workers.dev/api/health   # paste the key, Ctrl-D
#    -> adds "store":{"kind":"d1","ok":true,"attempts":n,"players":n,...}; "lastError":"D1: the attempts
#       table does not exist yet ..." means step 2's migration has not run (games queue until it has)
curl -sI https://tokenquest.tokenquest.workers.dev/ | head -1     # HTTP/2 200, the login page
```

Play one game at the URL, then open https://tokenquest.tokenquest.workers.dev/staff (same team
password): the player is listed and the count line reads `1 player · 1 game · updated <time>`. The
Worker has no reset endpoint and no Excel export (the CSV from `/staff` opens in Excel), so the
in-game staff panel's **DOWNLOAD EXCEL** / **RESET SERVER LEAGUE** buttons light up (health is 200) but
answer "EXPORT FAILED" / "RESET FAILED" on this host. JSON/CSV downloads of the browser's own league
still work.

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

The Worker's secrets (`ACCESS_PASSWORD`, `SESSION_SECRET`, `INTAKE_KEY`) are set once with
`wrangler secret put` and survive every deploy, and so does the D1 database (a deploy never touches the
rows); `wrangler.toml` carries only plain variables (the D1 binding, `ALLOWED_ORIGINS`, rate limits, the
optional mirror's `MIRROR_MARKDOWN` / `PLAYERS_REPO` / `PLAYERS_BRANCH`). The workflow pins
`wranglerVersion: "4.151.1"`; bump it together with the local `npx wrangler@4`.

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
  it, so the public Internet cannot post rows to the database or read the league; the staff downloads
  (`/api/export.csv`, `/api/export.md`, `/api/players.json`) are `401` too and `/staff` is the login page.
  The one exception is `GET /api/health`, which stays public but only says `{ ok, service, gate, configured }`
  (no counts) until the caller is logged in. The game's own `fetch` calls carry the cookie automatically.
  Kiosk laptops, which have no cookie, present the `INTAKE_KEY` secret as `X-Intake-Key` instead (the API
  and `/staff` only, never the game files; see "Many laptops, one league").
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

### Scores database (D1)

- **Where the data lives.** Every finished game, from any browser on the team URL and from every kiosk
  laptop's write-through, is one row in the `attempts` table of the Cloudflare D1 database
  `tokenquest-players` (SQLite, managed by Cloudflare, `database_id` in `deploy/intake-worker/wrangler.toml`,
  bound to the Worker as `DB`). Columns: `played_at`, `name`, `email` (lowercased), `score`, `use_case`,
  `scenario`, `cost_per_mtok`, `profit_per_hour`, `fte_equivalent`, `annual_savings`,
  `human_hours_per_year`, `consent_at`, `source` (`web` = a browser on the team URL, `kiosk` = a laptop's
  write-through) and `replay_key`. The schema is `deploy/intake-worker/migrations/0001_attempts.sql`,
  applied once with `npx wrangler d1 migrations apply tokenquest-players --remote` (wrangler remembers
  which files have run). The database is independent of the Worker code, the laptops and the browsers:
  a redeploy, a closed browser or a lost laptop does not touch it, and nothing depends on GitHub.
- **Every game is a row before the answer.** `POST /api/attempt` validates (same rules as the kiosk
  server), inserts the row, and only then answers `{ ok: true, attempts, best, latest, rank, players, newBest }`
  computed from all rows. If D1 cannot be written the Worker answers `503 { ok: false, error: "store_unavailable" }`,
  `js/sync.js` keeps the attempt in the browser's queue and re-sends it on the next game, page load or
  reconnect; kiosk laptops keep it in their journal. The same applies while the binding is missing
  (`503 not_configured`): the game plays, nothing is lost. A re-posted game (same email, `playedAt` and
  score: `replay_key` is `UNIQUE`) is stored once and answers the same numbers.
- **Staff page: https://tokenquest.tokenquest.workers.dev/staff.** Log in with the team password (the
  same cookie as the game; a kiosk's `X-Intake-Key` works too) and the page lists every player: name,
  email, attempts, best, latest and last played, with the line `N players · M games · updated <time>` and
  two buttons:
  - **Download CSV** → `GET /api/export.csv`: one line per game (`played_at, name, email, score, use_case,
    scenario, cost_per_mtok, profit_per_hour, fte_equivalent, annual_savings, human_hours_per_year,
    consent_at, source`), UTF-8 with a byte-order mark and CRLF line ends so Excel opens it with the
    right encoding on a double-click; RFC 4180 quoting, and a cell that starts with `=`, `+`, `-` or
    `@` is prefixed with `'` so nothing typed by a player can run as a formula.
  - **Download PLAYERS.md** → `GET /api/export.md`: the Markdown sheet (Players table ranked by best
    score, Attempts table newest first) rendered on request from the rows; `GET /api/players.json` is
    the raw list as JSON. All three carry names and emails, so all three need the cookie or the key
    (`401` otherwise).
  From a shell (the key is the Worker's `INTAKE_KEY`; paste it, Ctrl-D):

```sh
curl -s -H "X-Intake-Key: $(cat)" -o players.csv https://tokenquest.tokenquest.workers.dev/api/export.csv
```

- **Straight from the database.** Anyone logged in to the Cloudflare account can read or edit the rows
  with wrangler (nothing is cached: the Worker reads the table on every request):

```sh
cd deploy/intake-worker
npx wrangler d1 execute tokenquest-players --remote --command "SELECT COUNT(*) AS games, COUNT(DISTINCT email) AS players FROM attempts"
npx wrangler d1 execute tokenquest-players --remote --command "SELECT played_at, name, email, score FROM attempts ORDER BY id DESC LIMIT 20"
npx wrangler d1 export tokenquest-players --remote --output /tmp/tokenquest-players.sql   # a full SQL dump
```

- **Clearing it (after the event, or to remove a test row).** There is deliberately no delete or reset
  route on the Worker (the team password is a shared door, not a per-person login), so clearing is a
  wrangler command, run by someone with the Cloudflare login, after downloading what you need:

```sh
cd deploy/intake-worker
npx wrangler d1 execute tokenquest-players --remote --command "DELETE FROM attempts WHERE email = 'test-player@example.com'"   # one player
npx wrangler d1 execute tokenquest-players --remote --command "DELETE FROM attempts"                                         # everything
npx wrangler d1 delete tokenquest-players    # the whole database (also remove [[d1_databases]] from wrangler.toml and redeploy)
```

  `/api/health` (with the cookie or the key) then shows `store.attempts` back at `0`; the browsers' own
  leagues are unaffected, they are per browser.
- **Privacy.** Names and emails live in this one database and nowhere else on the hosted path: this
  public game repo, the workers.dev and Pages sites, the Worker's logs and `GET /api/league` never carry
  an email (the league is names and scores only). The rows are read only by the Worker (for the league
  and the staff page) and by whoever has the team password or the Cloudflare login. Each row has the
  consent time and the device it came from, so what was collected under the on-screen consent text can
  be shown and deleted per player with the commands above. Delete the rows after the event. D1 is
  served from Cloudflare's network; the live database reports `WEUR`/`LHR`, and the database can be
  recreated with `--location weur` (or a `jurisdiction`) if residency must be pinned.
- **Optional GitHub mirror.** `store.mjs` can still rewrite `players.json` and `PLAYERS.md` in a private
  GitHub repo after each game, as a convenience copy only: set `MIRROR_MARKDOWN = "true"` in
  `wrangler.toml` and `npx wrangler secret put GITHUB_TOKEN` (fine-grained PAT, Contents: Read and write
  on `PLAYERS_REPO`). It is off by default, runs after the answer (`ctx.waitUntil`), never fails a game,
  and reports under `mirror` in `/api/health`. D1 stays the source of truth either way.

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

Optional smoke test straight at the API (log in first so curl has the cookie; afterwards delete the
test row with the `wrangler d1 execute ... DELETE` command from "Scores database (D1)"):

```sh
URL=https://tokenquest.tokenquest.workers.dev
curl -s -o /dev/null -c /tmp/tq.jar -X POST "$URL/login" -H "Origin: $URL" --data-urlencode "password=$(cat)"   # type it, then Ctrl-D
curl -s -b /tmp/tq.jar -X POST "$URL/api/attempt" -H 'Content-Type: application/json' \
  -d '{"name":"Test Player","email":"test-player@example.com","score":1,"consent":true,"consentAt":"2026-10-16T12:00:00Z"}'
curl -s -b /tmp/tq.jar "$URL/api/export.csv"        # the row, after the header
rm /tmp/tq.jar
```

To take it all down: download the CSV, `npx wrangler delete -c deploy/intake-worker/wrangler.toml`,
`npx wrangler d1 delete tokenquest-players` (from `deploy/intake-worker/`) and revoke the Cloudflare
API token used by the deploy workflow.

### Privacy and limits

- Emails live only in the D1 database (and transiently in the Worker while it answers a request). This
  public game repo, the workers.dev and Pages sites and the Worker's logs never contain them;
  `GET /api/league` returns names and scores only, and everything that does carry emails (`/staff`, the
  downloads) needs the team password or the key. Delete the rows after the event ("Scores database
  (D1)", clearing it).
- The kiosk laptop's `data/` and Desktop workbook stay separate from this database unless the laptop
  is set up with write-through ("Many laptops, one league"): then every game the laptop records is also
  a row here.
- The URL is public, so the limits matter: the team password in front of everything but `/api/health`,
  JSON only, 16 KB body cap, `consent` must be literally `true`, a browser `Origin` other than the site's
  own must be on `ALLOWED_ORIGINS`, and each IP gets a token bucket (20 attempts, 60 reads and 10 login
  tries per minute by default). That bucket lives in the Worker's memory, so it is per IP *per isolate*:
  good enough against a careless script, not a hard cap. For a hard cap add a WAF rate-limiting rule for
  the Worker in the Cloudflare dashboard. Remember a venue's Wi-Fi shares one public IP.
- Anyone who has the team password can still post a valid-looking row; junk is deleted with
  `wrangler d1 execute ... DELETE FROM attempts WHERE ...`. The same attempt re-posted by the browser's
  retry queue or a kiosk's journal (same email, `playedAt` and score) is recognised and not duplicated.
- The free Workers plan allows 100,000 requests a day and 10 ms of CPU per request, and free D1 allows
  5 million rows read and 100,000 rows written a day with 5 GB of storage; a game is one insert plus one
  read of the table (a few hundred bytes per row), comfortable for thousands of games.

### Verify locally

```sh
npm run test:intake                                   # tests/intake.test.js + tests/gate.test.js + tests/sync.test.js
for f in deploy/intake-worker/src/*.mjs; do node --check "$f"; done
npm run build:worker && ! grep -q TOKEN_QUEST_INTAKE dist/index.html   # same-origin build, nothing injected
npx wrangler@4 deploy --dry-run --outdir /tmp/tq-wrangler-dry -c deploy/intake-worker/wrangler.toml
```

## Many laptops, one league

The Worker is the single source of truth for scores: whichever laptop a game is played on, it ends up on
the team server, and the running totals (best score, attempts, rank) are the same on every screen.
Two ways to set the stand up; both can be mixed.

### Simplest: every laptop opens the team URL

Nothing runs locally. On each laptop put one line in a file called `.env` next to
`start-token-quest.command` (the file is git-ignored; never commit it):

```sh
KIOSK_URL=https://tokenquest.tokenquest.workers.dev
```

Double-clicking the launcher then opens Chrome in kiosk mode straight on the team server (no local
server, no `data/`, no Excel on that laptop). Type the team password once per laptop (the cookie lasts 14
days and survives Chrome restarts because the launcher uses its own profile). Every game is written to
the D1 database as it happens (`/staff` shows it at once); nothing is kept on the laptop. The laptop
needs the venue Wi-Fi for the whole game, and the staff panel's Excel/reset buttons do nothing on this
host.

### Offline-tolerant: local kiosk + write-through

Each laptop runs its own server as before (local `data/attempts.jsonl`, Desktop Excel, works with no
network at all) **and** forwards every accepted game to the team server. Put this in `.env` on each
laptop:

```sh
UPSTREAM_URL=https://tokenquest.tokenquest.workers.dev
UPSTREAM_KEY=<the Worker's INTAKE_KEY>
```

The key is a Worker secret that kiosk servers present as `X-Intake-Key` instead of the team password
cookie (it opens `/api/attempt`, `/api/league` and `/api/health` only, never the game files). Make it
once, set it on the Worker, and copy the same value into each laptop's `.env`:

```sh
openssl rand -hex 24                                          # the key; keep it out of chat logs and git
cd deploy/intake-worker && npx wrangler secret put INTAKE_KEY  # paste it
```

What the server does with it (`server/upstream.mjs`, `server/merge.mjs`):

- **Write-through, local first.** `POST /api/attempt` appends to `data/attempts.jsonl` and schedules the
  Excel export exactly as before, then journals the game in `data/upstream-queue.jsonl` and sends it to
  `${UPSTREAM_URL}/api/attempt`. It waits up to 3 s for the answer so the results screen can show the
  merged `ATTEMPT n · BEST · RANK`; if the team server is slower, the player gets the laptop's own
  numbers and the send finishes in the background.
- **Nothing is dropped.** Venue Wi-Fi down, a 5xx, a 429, `503 store_unavailable` (the Worker cannot
  reach D1) or a wrong key: the game stays in the journal and is retried in order every 30 s
  (doubling to 2 min while it keeps failing), on the next game, and on start-up. Games recorded before
  `UPSTREAM_URL` was set are queued on start-up too. The Worker treats the same email + `playedAt` + score
  as the same game, so a retry after a lost answer never duplicates a row, and the kiosk itself stores a
  re-posted game only once. The only thing it gives up on is a game the Worker refuses outright with
  `400` (a version mismatch); it stays on the laptop and in Excel and health counts it under `rejected`.
- **One league on every screen.** `GET /api/league` fetches the team server's league with the key
  (rows carry the email so players can be matched; the kiosk strips it again before the browser sees
  anything), caches it for 10 s and merges it with the local attempts: per player, the higher best score
  (ties go to the earlier one), the later game's name and latest score, and attempts = the team
  server's count + this laptop's not-yet-confirmed games (never less than the laptop has on file). A
  copy up to 2 min old stands in while the server cannot be reached; after that the board is this
  laptop's league only. Responses carry `source: "merged"` or `"local"`.
- **Health.** `GET /api/health` on the kiosk includes `upstream: { configured, url, key, queued, sent,
  rejected, lastSyncAt, lastError, lastErrorAt, nextRetryAt }`. `queued` should be 0 shortly after
  every game; `lastError` says why not in plain words (`team server unreachable`, `HTTP 503
  store_unavailable`, `HTTP 401 bad_key: the team server refused the key (check UPSTREAM_KEY ...)`).
- **The Worker's side.** With the key, `GET https://tokenquest.tokenquest.workers.dev/api/health` shows
  `store: { kind: "d1", ok, attempts, players, lastPlayedAt, lastOkAt, lastError, lastErrorAt }`. `ok` is
  whether the `attempts` table can be read right now; `lastError` is the newest failure, kept until a
  game is written, for example `D1: the attempts table does not exist yet: run npx wrangler d1
  migrations apply tokenquest-players --remote ...`. Games are refused with `503 store_unavailable`
  while that is the case, every kiosk queues them, and they all land once it is fixed; nothing has to be
  replayed by hand. The same key opens `/staff` and the downloads, so a laptop's `.env` is enough to
  pull the CSV: `curl -H "X-Intake-Key: ..." -o players.csv https://tokenquest.tokenquest.workers.dev/api/export.csv`.

Check a laptop:

```sh
curl -s http://127.0.0.1:8080/api/health | python3 -m json.tool      # upstream.queued, lastSyncAt, lastError
cat data/upstream-queue.jsonl                                       # the journal: queued / sent / rejected lines
```

Things to know: one `UPSTREAM_KEY` is shared by all laptops (rotate it with `wrangler secret put
INTAKE_KEY` and update every `.env`); kiosk requests have their own, larger rate bucket on the Worker
(120 a minute per IP, `RATE_LIMIT_KIOSK_PER_MINUTE`), enough to drain a long queue; each laptop keeps
its own `data/` and Excel (its own games only; the D1 database behind `/staff` is the one with
everything); `.env` is also honoured by the launchd agent (`scripts/install-autostart.sh`) because the
server reads it itself; `ENV_FILE=/path/to/file` reads another file and `ENV_FILE=off` none at all.
