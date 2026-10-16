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

## Hosted player sheet

The public GitHub Pages demo can record finished games too, without a server of ours and without a
single email address touching this (public) repo or the kiosk laptop:

```
browser on punkrockquantum.github.io/JRRToken  --POST /api/attempt-->  Cloudflare Worker (deploy/intake-worker)
                                                                            |  GitHub Contents API, fine-grained PAT
                                                                            v
                                                   private repo punkrockquantum/token-quest-players
                                                     players.json  (source of truth: every attempt)
                                                     PLAYERS.md    (the sheet: rewritten after EVERY game)
```

- **Every game is a commit.** `POST /api/attempt` validates (same rules as the kiosk server), appends
  the attempt to `players.json` and regenerates `PLAYERS.md`, and only then answers
  `{ ok: true, attempts, best, latest, rank, players, newBest }`, so the results screen's
  `ATTEMPT n · BEST · RANK` line works exactly as at the booth. A first-time player adds a Players
  row; a returning player (same email, any letter case) has Attempts, Latest score, Best score and
  Last played updated in place; the Attempts table always gains one row. There is no batching or
  "write later": if GitHub cannot be written (three compare-and-swap tries with backoff) the Worker
  answers `503 { ok: false, error: "store_unavailable" }`, `js/sync.js` keeps the attempt in the
  browser's queue and re-sends it on the next game, page load or reconnect.
- **The private repo is the sheet.** Staff open `PLAYERS.md` in `punkrockquantum/token-quest-players`
  on GitHub (it renders as two tables; the first line reads `Updated <time> · <n> players · <m> games`
  so you can see it moving). The Worker has no export endpoint. `players.json` is the raw list if you
  want to load it into Excel. Sample:

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

- **Nothing changes until you opt in.** Without the `INTAKE_URL` repository variable the Pages build is
  the local-league demo described above (`/api/*` is 404, nothing is collected). The kiosk laptop is
  untouched either way: `js/sync.js` only leaves its own origin when `window.TOKEN_QUEST_INTAKE` is
  defined, and only `scripts/build-static.mjs` ever defines it (in `dist/index.html`, never in the
  source).

### Set it up (two logins: GitHub and Cloudflare)

Everything below is prepared in the repo; nothing has been deployed yet.

```sh
# (a) the private repo that will hold the sheet (GitHub login #1)
gh auth login
gh repo create punkrockquantum/token-quest-players --private --add-readme

# (b) a fine-grained token for that ONE repo: https://github.com/settings/personal-access-tokens/new
#     Resource owner: punkrockquantum · Repository access: Only select repositories -> token-quest-players
#     Repository permissions -> Contents: Read and write (Metadata: Read-only is added automatically)
#     Expiration: a few days after the event. Copy it once; it is only ever pasted into the Worker secret.

# (c) deploy the Worker (Cloudflare login #2; free plan is enough). Check PLAYERS_REPO and
#     ALLOWED_ORIGINS in deploy/intake-worker/wrangler.toml first (defaults match this project).
cd deploy/intake-worker
npx wrangler login
npx wrangler secret put GITHUB_TOKEN          # paste the PAT from (b)
npx wrangler deploy                           # prints https://token-quest-intake.<account>.workers.dev
curl -s https://token-quest-intake.<account>.workers.dev/api/health
#     -> {"ok":true,"service":"token-quest-intake","repo":"punkrockquantum/token-quest-players",...}
#        a 503 here means the token or repo name is wrong; nothing else needs fixing
cd ../..

# (d) tell the Pages build where the Worker is (repository variable, not a secret: the URL is public)
gh variable set INTAKE_URL --repo punkrockquantum/JRRToken --body https://token-quest-intake.<account>.workers.dev

# (e) rebuild and redeploy the site, then play one game and watch PLAYERS.md in the private repo
gh workflow run pages.yml --repo punkrockquantum/JRRToken --ref cursor/token-quest-datacenter-game
gh run watch --repo punkrockquantum/JRRToken
```

Optional smoke test straight at the Worker (then delete the row from `players.json` in the private
repo; the next real game rewrites `PLAYERS.md`):

```sh
curl -s -X POST https://token-quest-intake.<account>.workers.dev/api/attempt \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Player","email":"test@example.com","score":1,"consent":true,"consentAt":"2026-10-16T12:00:00Z"}'
```

To switch collection off again: `gh variable delete INTAKE_URL --repo punkrockquantum/JRRToken` and
re-run the workflow (the site goes back to the local-league demo), then `npx wrangler delete` in
`deploy/intake-worker` and delete or archive the private repo.

### Privacy and limits

- Emails live only in the private repo (and transiently in the Worker while it writes). The public
  game repo, the Pages site, the Worker's logs and its commit messages never contain them; `GET
  /api/league` returns names and scores only. Delete the private repo after the event, and revoke
  the PAT (GitHub → Settings → Developer settings → Fine-grained tokens).
- The kiosk laptop's `data/` and Desktop workbook stay completely separate from this sheet: the booth
  posts to its own server, the hosted game posts to the Worker, and nothing merges them.
- The Worker URL is public, so the limits matter: JSON only, 16 KB body cap, `consent` must be
  literally `true`, the browser `Origin` must be on `ALLOWED_ORIGINS` (default
  `https://punkrockquantum.github.io`), and each IP gets a token bucket (20 attempts and 60 reads per
  minute by default). That bucket lives in the Worker's memory, so it is per IP *per isolate*: good
  enough against a careless script, not a hard cap. For a hard cap add a WAF rate-limiting rule for
  the Worker route in the Cloudflare dashboard. Remember a venue's Wi-Fi shares one public IP.
- Anyone who finds the URL can still post a valid-looking row; junk is deleted by editing
  `players.json` in the private repo. The same attempt re-posted by the browser's retry queue
  (same email, `playedAt` and score) is recognised and not duplicated.
- GitHub's Contents API gives 5,000 requests an hour to the token; a game costs two to four. The free
  Workers plan allows 100,000 requests a day and 10 ms of CPU per request, comfortable for thousands
  of games; `players.json` grows about 400 bytes per game.

### Verify locally

```sh
npm run test:intake                                   # tests/intake.test.js + tests/sync.test.js
for f in deploy/intake-worker/src/*.mjs; do node --check "$f"; done
INTAKE_URL=https://token-quest-intake.example.workers.dev npm run build:static && grep TOKEN_QUEST_INTAKE dist/index.html
npm run build:static && ! grep -q TOKEN_QUEST_INTAKE dist/index.html   # without INTAKE_URL nothing is injected
```
