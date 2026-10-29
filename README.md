# Token Quest

An 8-bit trade-show game from Digital Realty. Players design an AI factory inside a data center
and are scored on how efficiently it serves tokens. Every AI answer is born in a data center:
power, cooling, chips, data and connections working as one ecosystem, and the game teaches why
each of those decisions matters.

Play the hosted demo at the team URL (password-protected; ask the team), or run it on a laptop
for a booth (see [HOSTING.md](HOSTING.md)).

## What a player does

1. **Sign in.** Full name, email, and consent to Digital Realty's privacy practices. HIGH SCORES
   beside the form is the top three from the shared player sheet (first and last name as entered,
   best score), re-read from `/api/league` every time the title shows; the browser's own league
   stands in only when the server is unreachable, and a small "shared scores offline" note appears
   while the hosted sheet is not configured yet. A **TEST
   MODE** pill beside START (title screen only) lets staff play without saving anything: the
   form may stay blank, the HUD shows a TEST MODE badge, the results say "Test mode: not saved",
   and no league entry, booth upload or local record is made. It switches itself off for the
   next player.
2. **Intro.** Click-through scenes: prompt → tokens → retrieval → generation, the data-center
   ecosystem, and "take any one away and the AI stops". **Nerd mode** (a toggle on every screen)
   swaps in longer, technical captions.
3. **Pick a job.** Customer Chat, Knowledge RAG, Coding Agent, Deep Research, Drug Discovery or
   Robotics. Each scenario states where the users are, where the model weights and data live,
   the demand, the response-time target, the budget, the power available and the go-live deadline.
4. **Build, one step at a time.** WHERE first: Location (real Digital Realty metros with distances
   to customers, employees and data, under a WHO & WHERE brief: who asks and from where, where the
   model and data live, and the three numbers the maths runs on, marked as the story's defaults until
   the next step is set) → Model size and number of users → GPU (NVIDIA only: DGX Spark, L40S,
   RTX PRO 6000 Blackwell Server, HGX H100/H200/B200/B300, GB200 NVL72, GB300 NVL72, Vera Rubin
   NVL72) → Cooling (open air, cold aisle containment, rear door heat exchanger and direct liquid in
   both modes, in-row coolers in nerd mode; each tile shows the kW band a rack it cools, its cooling
   overhead and its lead time, and says "needs direct liquid" when the chosen rack is an NVL72) → Memory (KV cache,
   CPU host memory) → Connectivity (Cross Connect, Metro Connect, ServiceFabric Link/Connection,
   ServiceFabric MCP, Digital Internet, cloud on-ramps, dark fiber, IX peering, public internet)
   → Storage → QPU (ORCA PT-3 for drug discovery) → Review → GO.
5. **Watch it run,** then read the results: score and stars, the one-line lesson, how many
   people's work the factory does, what the same capacity would cost as cloud IaaS, "what you
   built and why it scored this way", and "how Digital Realty would have helped". A second round
   lets the player improve the build after a single hint.

A live **ecosystem bar** (power, cooling, compute, data, connections) shows green, amber or red
as choices change; the score itself stays hidden until GO. Nothing a player picks can take the
build over budget, and no build that runs scores zero. Every pick pops a one-line reason (the black
box with the yellow border) that stays about seven seconds, holds while the pointer rests on it and
goes on a tap.

## The model (what the maths does)

- **Inference physics.** Prefill is compute-bound; decode is a memory-bandwidth roofline over the
  weights plus every active stream's KV cache. HBM capacity caps streams; CPU host memory and the
  KV cache tier park idle sessions; FP4/FP8 halve bytes per weight on Blackwell and Rubin; a
  model that spills off its NVLink domain is penalised. The DGX Spark shelf (16 desktop GB10
  boxes, 128 GB of unified LPDDR5x at 273 GB/s each, $3,999 a box published) loads a 70B or
  100B model at FP4 but streams it at a few tokens a second, below every story's target, so it
  is never the right answer for a crowd: a dev box on the board to show what memory bandwidth
  does.
- **Latency.** Real great-circle distances between real metros; fibre at ~4.9 µs/km with a route
  inflation factor; time to first token = users' round trip + retrieval/tool round trips to the
  data + prefill + queueing. Jitter sets the probability of missing the response target; packet
  loss stalls streams; GPUs sit idle while the serving loop waits on slow links.
- **Connectivity.** Each product has latency overhead, bandwidth tiers, monthly and one-time cost
  and a lead time. Private paths (cross connect, metro connect, dark fiber, ServiceFabric) are
  ordered ahead of IX peering, with public internet always slowest and the only option with
  loss. ServiceFabric MCP is the same fabric configured by an agent, never a faster pipe.
- **Power.** Rack kW is IT power built from the node datasheets: nodes per rack × node kW plus a
  top-of-rack switch (DGX H100/H200 10.2 kW, DGX B200 14.3 kW, DGX B300 ~14 kW, GB200 NVL72
  132 kW, GB300 NVL72 142 kW, Vera Rubin NVL72 ~210 kW estimate; the 8-GPU RTX PRO 6000 and
  L40S nodes ~6.5 and ~4 kW estimates; a DGX Spark shelf 16 × ~170 W plus a small switch ≈ 3 kW).
  Cooling changes facility power only through the PUE
  (open air 1.38, Digital Realty's published portfolio figure; cold aisle containment 1.29, rear
  door 1.28, in-row 1.32 and liquid 1.20 are game values). Rack caps follow the industry bands:
  open air about 15 kW a rack, containment 15–30 kW (doors and panels keep the cold aisle apart
  from the hot exhaust, a fit-out of about two weeks), in-row 55 kW, rear door heat exchanger
  40–70 kW (a water-cooled coil on the rack's back door cools the exhaust of ordinary air-cooled
  servers, so HGX racks pack two to four nodes deep; it needs the building's chilled water, so a
  six-week fit-out and about $35k a rack added to the capex; vendor figures from Motivair, Vertiv
  and nVent cited in data.js), direct liquid 240 kW. Caps carry a 5% nominal slack, so a 30.4 kW
  pair of air nodes still cools in a 30 kW containment rack. An HGX rack runs too hot for open
  air and throttles there; NVL72 and Vera Rubin still need the liquid hall, and every air tile
  says so when one is on the board. Every story opens on containment, which is right-sized for a
  30 kW HGX rack; the rear door is the honest near-miss (a few percent lower) for those stories.
  Every scenario, crowd and metro offers at least the **power floor**: one rack of the
  least powerful platform through the air PUE, rounded up to a 100 kW suite on a
  0.1 / 0.25 / 0.5 / 1 / 2 MW ladder. A smaller crowd scales the offer down to that floor and
  never below it, and a board the player has not touched always fits its offer. Going over is a
  soft consequence: the racks throttle, the overflow is billed and the POWER light says why.
- **Money and time.** Budget, power cap, lead times (nothing earns until the slowest part is
  live), a late-launch penalty, power at a flat $/MWh, and an amortised capex horizon.
- **Score.** Cost per million good tokens against a per-story par × demand coverage × SLA factor
  × a bounded savings factor; three stars at 1,350. Each story has its own best build; "biggest
  everything" never wins.
- **Savings.** Compared with renting the same GPU capacity as cloud IaaS (both sides measured on
  the public internet for the users' leg), plus how many people's work the factory does.

All prices, lead times, cloud rates and multipliers are labelled game estimates. Published facts
(GPU memory and bandwidth, NVLink domains, ServiceFabric ports and connection tiers, the 15-day
port SLA, Digital Realty's footprint) are cited in code comments next to the numbers.

## How to run it

There are two ways to play. Both feed the same shared scoreboard.

### 1. On any laptop, tablet or phone: the team URL

Open **https://tokenquest.tokenquest.workers.dev** in Chrome, Safari or Edge, enter the team password
once (ask the team; it is not written anywhere in this repository), and play. Nothing to install.

- The page remembers the login for 14 days per browser.
- Phones and portrait tablets get a scrolling single-column layout; laptops and landscape tablets get
  the kiosk layout. Add it to the home screen on an iPad for a full-screen feel.
- Every finished game is stored centrally the moment the results appear, from whichever device played it.
- For a booth with a steady connection this is the simplest setup: on each laptop, open the URL and press
  **FULLSCREEN** (or run Chrome in kiosk mode: `open -na "Google Chrome" --args --kiosk --app=https://tokenquest.tokenquest.workers.dev`).

### 2. Installed on a booth laptop (works offline)

Use this when the venue network is unreliable. The laptop runs its own copy of the game and a small local
server; games are saved on the laptop first and synced to the shared scoreboard whenever a connection exists.

**Install once per laptop (macOS; needs Node 18 or newer from https://nodejs.org):**

1. `git clone https://github.com/punkrockquantum/JRRToken.git` and `cd JRRToken`
   (`git checkout cursor/token-quest-datacenter-game` until the branch is merged).
2. Create a file named `.env` in that folder with three lines:
   ```
   UPSTREAM_URL=https://tokenquest.tokenquest.workers.dev
   UPSTREAM_KEY=<the team server's intake key; copy it from a laptop that already has it, or ask the team>
   STAFF_PIN=<a PIN that protects the laptop server's Excel export and reset>
   ```
   `.env` is git-ignored and never leaves the laptop. Without `UPSTREAM_URL` the laptop keeps its own
   scores only.
3. Double-click **`start-token-quest.command`**. The first run asks macOS for permission to open it
   (right-click → Open). It starts the local server and opens the game in Chrome kiosk mode. Keep the
   Terminal window open while the booth runs; closing it stops the game.

**Every day at the booth:** double-click `start-token-quest.command`. That is all.

**How the sync works:** each game is written to the laptop's `data/attempts.jsonl` and to the Desktop
workbook `Token Quest Leaderboard.xlsx` immediately, then sent to the shared scoreboard. If the network is
down the game is queued on disk and re-sent automatically every 30 seconds, on the next game, and on the next
start-up, so a laptop that was offline all day and shut down catches up by itself the moment it starts
connected. Nothing is ever dropped, and re-sends never duplicate. The laptop's HIGH SCORES board merges its
own games with the shared totals, so every laptop shows the same leaders once synced.
`http://127.0.0.1:8080/api/health` shows `upstream.queued` (games waiting) and `lastSyncAt`.

**Staff tools on the laptop:** click the TOKEN QUEST logo five times and enter the on-screen staff PIN
(default `8462`; change it per laptop from the browser console with
`localStorage.setItem("token-quest-staff-pin", "your-pin")`) to download or clear the local league and
fetch the Excel file. The shared scoreboard for all devices is https://tokenquest.tokenquest.workers.dev/staff.

**Test mode:** the switch on the title screen plays a full game without saving anything, for demos and
rehearsals.

## Workshop mode (table teams)

A 50-minute room format on the same Worker: up to **10 tables**, an **architect at every table** as the
host, one iPad per table, a facilitator laptop and a projector. The scenario is fiction, labelled as such:
*design a CFD supercomputer for Apex Aero Racing*, an F1-style aerodynamics team with 1,500 engineers in
Milton Keynes and Modena, the simulation data in the UK data room, $9M, 16 weeks, and a par of 40 overnight
runs. Every iPad has exactly four stations, a few three-tile decisions each, one plain sentence per tile
and a `?` for the detail:

| Station | Decisions (tiles) |
|---|---|
| **CONNECTIVITY** | Public internet · ServiceFabric · Cross Connect + Dark Fiber · COMBO (ServiceFabric + Dark Fiber) |
| **OEMs** | A · Air-cooled 8-GPU node · B · Direct-liquid 8-GPU node · C · Rack-scale NVL72 |
| **DATACENTER & POWER** | Metro: London · Frankfurt · Paris — Cooling: air · rear-door · direct liquid — Power block: smallest · middle · biggest |
| **CFD SUPERCOMPUTER** | GPU: HGX H200 · GB200 NVL72 · RTX PRO 6000 (the inference trap) — Size: small · medium · large — Fabric: Ethernet + file storage · InfiniBand + parallel file system · NVLink-scale + GPU-adjacent storage |

Delegates **pitch each station to their architect** on the iPad; the architect types a 4-digit host code
and presses APPROVE or SEND BACK (one-tap reason: cost, power, latency, risk, wrong tool). Each send-back
costs 3% of the score. When all four are approved the table presses SUBMIT BUILD.

**Run of show (50 minutes):** 0–5 brief · 5–41 build · 41–50 read-out. The facilitator page runs the clock
(server time; every iPad and the projector agree to the second) and can add or remove minutes.

| Who | URL | What |
|---|---|---|
| Facilitator | `/host` | CREATE SESSION → join code + QR, ten host codes (one per architect), the PIN; START 5-MIN BRIEF → START BUILD → START READ-OUT → END SESSION; −1 / +1 / +5 MIN; tables × stations grid |
| Table iPads | `/workshop` (or scan the QR: `/workshop?code=XXXX`) | JOIN (table number, team name, architect) → HOME (timer, scenario, four stations) → STATION → PITCH → ARCHITECT APPROVAL → SUBMIT BUILD → READ-OUT (printable) |
| Projector | `/board/XXXX` | big clock and phase, one row per table with four station lights, scores and ranks from the read-out on; no names beyond the team names, no emails |

All three pages sit behind the same team password as the game. Nothing in the workshop asks for an email.

**Score** = 1,000 × runs a night vs par (cap 1.4) × money left (+2% per $1M of the $9M unspent) ×
first-time approval (−3% per send-back, floor 0.85) × right-sized power (green 1 · amber 0.9 · red 0.75) ×
latency (3D frames ≤ 30 ms, the night's data home ≤ 4 h) × on time (−5% a week past 16, floor 0.7); floor
100. The thoughtful build (COMBO · rack-scale NVL72 · a liquid hall with the smallest block that fits ·
GB200 small on NVLink) scores **1,524**; the RTX trap never passes 123; the biggest power block never beats
a right-sized one. `node scripts/balance-workshop.mjs` enumerates all 8,748 builds and prints the tables
(`docs/plan-workshop.md` has them).

**Read-out** (each iPad at the read-out, printable, and `GET /api/team/:id/readout`): score and rank,
WHAT WENT WELL (three things the decisions earned), WHAT YOU COULD HAVE DONE DIFFERENTLY (a quantified path of
up to three single-station fixes and the gap to the top build), YOUR ARCHITECT'S NOTES (every send-back and
its reason), and one closing line on Digital Realty's role, from published facts only.

**Run it locally:** `node scripts/workshop-dev-server.mjs --seed` starts the real Worker on
http://127.0.0.1:8789 with an in-memory database and prints a session code, PIN and host codes.
`node scripts/smoke-workshop.mjs` plays a whole session in headless Chrome (three tables on iPad viewports,
the facilitator, the board) with a layout audit on every screen; `SHOTS=.shots` keeps the screenshots.
First deploy of the workshop: `cd deploy/intake-worker && npx --yes wrangler@4 d1 migrations apply
tokenquest-players --remote` (the `sessions`, `teams`, `decisions`, `readouts` tables), then
`npm run deploy:worker`.

## Hosting

| Where | What | How |
|---|---|---|
| **Cloudflare Worker** (team URL) | The game plus the `/api` that keeps a shared league; every score, name and email goes to a Cloudflare D1 database (staff page `/staff`: CSV / PLAYERS.md downloads); password-gated | `npm run deploy:worker` (see HOSTING.md, "Scores database (D1)") |
| **Booth laptop** | Full kiosk: the game, a local server, idle reset, staff tools, and an Excel leaderboard on the Desktop | double-click `start-token-quest.command` |
| **GitHub Pages** | Static copy of the game only (per-browser league, nothing collected) | deploys from the game branch |

Completed hosted games (from any browser on the team URL and from every kiosk laptop with write-through)
are rows in the Worker's D1 database `tokenquest-players`: name, email, score, job and consent time, one
row per game. Staff see players, attempts, best and latest scores at `/staff` and download the CSV or
`PLAYERS.md` there. Emails never appear in this public repo or on screen.

## Repository layout

```
index.html, css/, js/, assets/   the game (vanilla ES modules, no build step to play locally)
js/data.js                       scenarios, platforms, networks, metros, prices, lessons
js/model.js, js/latency.js       the evaluation and the physics
js/steps.js, js/presets.js       the stepped build and the simple/nerd tile sets
js/explain.js, js/drhelp.js      results copy: what you built, how Digital Realty would have helped
js/refarch.js                    anonymised OEM reference architectures (nerd mode)
server/, scripts/serve.mjs       the kiosk server: attempts log, league API, Excel export
deploy/intake-worker/            the Cloudflare Worker: static assets, API, the scores in its D1 database (readable at /staff with the team password), gate
scripts/balance.mjs              enumerates builds per story and checks the balance
scripts/smoke.mjs                plays the whole game in headless Chrome at four viewports
js/workshop/, css/workshop.css,  workshop mode: the table iPad (app.js), facilitator (host.js), board (board.js),
  assets/workshop/               the scenario + score (cfd.js), read-out, timer, QR; served at /workshop, /host, /board/<code>
deploy/intake-worker/src/session*.mjs, migrations/0002_sessions.sql   the workshop's sessions API and tables
scripts/workshop-dev-server.mjs, scripts/smoke-workshop.mjs, scripts/balance-workshop.mjs   local run, browser smoke, balance
tests/                           node --test suites for the model, copy, server, worker
docs/                            phase plans and checklists
```

## Develop

```bash
npm start                 # kiosk server on http://127.0.0.1:8080/ (writes the Desktop workbook)
npm test                  # unit tests
npm run balance           # per-story balance table
SHOTS=.shots node scripts/smoke.mjs   # browser play-through at 1920×1080, 1600×1000, 1180×820, 1024×768
npm run build:worker && npm run deploy:worker   # publish to the team URL
```

Node 18+ and Google Chrome (for the smoke test). No npm dependencies.

The smokes play fixture games and press the staff reset, so never point them at a kiosk whose `.env` forwards
games to the team server: start a throwaway server first (`ENV_FILE=off DATA_DIR=/tmp/tq-smoke-data
EXPORT_PATH=/tmp/tq-smoke-board.xlsx PORT=8091 node scripts/serve.mjs`, then `GAME_URL=http://127.0.0.1:8091/
node scripts/smoke.mjs`). Both smokes refuse a server whose `/api/health` reports `upstream.configured: true`.

Works on phones and tablets in portrait: the page scrolls and the main action stays pinned at the bottom.
The phone rules live in `css/mobile.css`, loaded only below 900px wide or in portrait under 1100px, so the
kiosk layout is untouched; `SHOTS=.shots node scripts/smoke-mobile.mjs` plays the game as an iPhone (390×844,
430×932) and a portrait iPad (820×1180) and audits every screen for overflow, 44px tap targets and type size.

## Privacy

The booth laptop's `data/` folder and Desktop workbook, and the Worker's D1 database (the shared
scores, readable at `/staff` with the team password), hold names and emails collected under the
on-screen consent text. Export what you need after the event and delete the rest. The staff tools
are PIN-protected; the hosted game is password-protected.
