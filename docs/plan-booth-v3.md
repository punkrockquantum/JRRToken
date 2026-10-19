# Token Quest booth v3 — plan and checklist

Branch `cursor/token-quest-datacenter-game`, from `c7d848a` (160 tests, 159 pass, 1 skipped; smoke green at
1920×1080, 1600×1000, 1180×820, 1024×768). Short phases, `node --test` after each, commit every green phase
(game files only: no `data/`, `*.xlsx`, `.shots/`, `dist/`, `*.log`). Hosting files are out of scope
(`server/**`, `scripts/serve.mjs`, `js/sync.js`, `tests/server.test.js`, `tests/xlsx.test.js`, `HOSTING.md`,
`deploy/**`, `Dockerfile`, workflows).

User requirements (verbatim): "Add some more GPU choices into the game (nerd mode and the Simple version).
Only using NVIDIA technology. Add model weight Just 3 options 70b, 100b and 650b and number of users as the
first step. Include other Digital Realty connectivity options and add realistic calculations. Ensure the
amount saved is calculated based on the alternative of doing this in the Cloud, using infrastructure as a
service & both options are calculated based on using public internet. Ensure all the maths still works and
all reflects a real world scenario."

Adjustments folded in after P1 started: "Number of users should have a smaller number" (tiles start at
realistic enterprise counts: 10K / 100K / 1M shoppers, 500 / 5,000 / 50,000 staff, 200 / 2,000 / 20,000
developers, 100 / 1,000 / 10,000 analysts, 20 / 200 / 2,000 scientists, 50 / 500 / 5,000 robots; the
derived demand shows on every tile and on the scenario card) and "Include other GPUs available in the simple
mode" (the simple GPU step offers every NVIDIA platform the story can use, six tiles in a 3×2 grid).

Legend: `[x]` done in the tree · `[~]` partly done (what remains is listed) · `[ ]` not started.

## P1 — New first step: MODEL & USERS (commit `336939f`)

- [x] `MODELS` in `js/data.js`: exactly three tiles, 70B (dense, 70 GB FP8 / 140 GB FP16), 100B (~100 GB FP8),
      650B (MoE, DeepSeek-class 671B total / ~37B active, 671 GB FP8, needs a 72-GPU NVLink domain or spills);
      each sets `weightsGB`, `activeB`, `moe`, `kvMBPerTok`, a labelled quality factor (a relative `priceMult`
      on the token price) and compute per token
- [x] `USERS` tiers in `js/data.js`: three tiles per story with a labelled concurrency model
      (concurrent = count × daily-active share × sessions × minutes / 1,440 × peak; streams = concurrent ×
      streams per session; demand = streams × tok/s; batch stories count candidates a night, fleets count robots
      on duty), the derived demand on the tile; budget and power scale with the tier (mult^0.7)
- [x] `USE_CASES` become templates: `resolveUseCase(useCaseId, { model, users })` in `js/data.js`; defaults per
      story (chat/rag/robot 70B, code/research 650B, drug 100B; the LARGE tier is the crowd each story was
      calibrated for, because the realistic middle counts cannot honestly produce today's demand);
      `evaluateBuild` reads `build.model` / `build.users`
- [x] Step "1. MODEL & USERS" before LOCATION in `js/steps.js` STEPS (two rows: MODEL SIZE, USERS), tiles
      `model-70b` / `model-100b` / `model-650b` and `users-small` / `users-medium` / `users-large`; the GPU tiles
      scale their rack counts with the users tier
- [x] Scenario card updates live (demand, model, budget, power); WHO & WHERE brief reads the picks
- [x] Tests: three model sizes with the right bytes; demand derivation; the scenario card reflects the picks; the
      smoke walks the new step (650B-on-8-GPU fit tests land with the new GPUs in P5)
- [x] Rebalance where the default model changed (code, drug, robot): `parCost`, `savingsPar`, BRAINS rack counts

## P2 — More NVIDIA GPUs (both modes) (commit `12552f1`)

- [x] Add to `PLATFORMS` with public specs (source URLs in comments): RTX PRO 6000 Blackwell Server Edition
      (96 GB GDDR7, ~1.6 TB/s, 600 W; MGX 8-GPU air server, cost-effective inference tier), L40S (48 GB GDDR6,
      864 GB/s, 350 W; budget tier), HGX B300 ×8 single node (smaller rack option); GB200 / GB300 / Vera Rubin
      NVL72 already exist; every entry carries HBM/GDDR capacity, bandwidth, dense FP8/FP4 PFLOPS, power, cooling,
      estimated rack price and lead time (labelled)
- [x] Simple GPU step: six tiles, every NVIDIA platform the story can use (RTX PRO 6000 Blackwell Server ×8,
      HGX H100 ×2, HGX H200 ×2, HGX B300 ×6, GB200 NVL72 ×2, Vera Rubin NVL72 ×1; L40S / GB300 where sensible),
      each with the real name, a plain hint and the "included" / "needs liquid" tags; a 3×2 grid with the smaller
      tile style at desktop and iPad widths, no scroll at the four viewports, taps reachable, nothing clipped;
      nerd mode keeps the full list with specs and reference designs
- [x] Memory-bound decode makes the GDDR parts slower per GPU; RTX PRO 6000 wins only for small models with
      modest users; the SMALL users tier makes the budget GPUs (RTX PRO 6000 / L40S / H100 ×2) the right answer
- [x] `scripts/balance.mjs` re-run: naive 0 / best ~1,400 / optima differ
- [x] P2b — NVIDIA DGX Spark (user request "Add in an option for an NVIDIA SPARK as the GPU"): a "DGX Spark
      shelf" platform (16 desktop GB10 boxes on a shelf, 128 GB unified LPDDR5x at 273 GB/s each, ~1 PFLOP FP4
      sparse / ~0.5 dense, ~170 W, $3,999 published a unit, ConnectX-7 pairs two so the NVLink domain is one) in
      both the simple six-tile step and the nerd list; fits 70B/100B at FP4, never 650B; decode ~30× below an
      H100 a unit, so it only wins the smallest crowd; coach says "a dev box, not for a crowd"; balance + tests
      (0a33cf9: it streams a 70B model at ~8 tok/s a box, below every story's speed, so it is never the optimum
      at any crowd and never the hidden default; the COMPUTE light says "a dev box, not a crowd server")

## Corrections (user: "Some of the game logic is incorrect ... Service fabric is not worse latency than peering
## and it is much better than public internet. It should be impossible to go completely over budget or get a
## score of Zero. Ensure all the maths, numbers and info are very accurate.") — each its own commit, pushed

- [x] C1 Connectivity ordering end-to-end: for every story × metro set × leg, RTT(cross) ≤ RTT(fiber) ≤
      RTT(fabric) ≤ RTT(peer) < RTT(internet), internet ≥ 2× fabric and ≥ +20 ms at ≥ 100 km; the ServiceFabric
      tile's first-token time, stream label, GPU-idle and score are never worse than Peering for the same
      story/location; tile and learn copy say it plainly; a test iterates stories × metros × simple wire tiles
      (commit c51c949: shared `js/physics.js` table, per-request ingest, demand-relative idle, right-sized fabric,
      public-only shared-pipe penalty, IX/eyeball lead times; 0 of 300 story × metro × tile combinations mis-ordered)
- [x] C2 Budget guard: a tile whose pick would exceed the scenario budget is disabled with an "OVER BUDGET by $X"
      tag and a learn line saying what to drop; defaults always affordable; nerd rack stepper / site designer clamp
      at the budget; power and deadline stay soft consequences; the "can't afford" results path is unreachable.
      Score floor 100: score = max(100, ...) so weak-but-legal builds land ~200–450, near-misses 700–1,100, best
      ~1,400; balance checks, results copy, star thresholds, plan and tests updated
      (commit 55cd45c: `tileGuard`/`budgetOf`/`affordableChoices` in js/steps.js, floor via `shapeScore` with a
      square-root knee at 450 so no ranking changes; naive/maxed now 100–126, typical 149–418, best 1,400)
- [x] C3 Accuracy sweep: ServiceFabric facts (10G/100G ports, 50 Mbps–100 Gbps, 15-day port SLA, minutes to
      live), cross connect, dark fibre physics, internet/peering assumptions, GPU specs, model bytes at FP8/FP4,
      users → demand, cloud IaaS rates, 4.9 µs/km, haversine, PUE; every unpublished number says "estimate" or
      "game" (learn text or a sourced code comment); a test scans player-facing price strings for the label
      (commit 04a3f5a: tests/labels.test.js; cloud IaaS rates land with P4)
- [x] POWER (user: "always enough power providing the user gets the configuration right ... rack level power
      draw is accurate"; "as soon as the user selects more users, the power goes red"): POWER_FLOOR_MW (one rack
      of the least powerful platform through the air PUE, rounded up to a 100 kW suite) under every crowd and
      metro share; the hidden GPU default follows the crowd both ways (brainsAuto); rack kW = nodes × node kW +
      ToR from the DGX datasheets with a source beside each; facility = IT × PUE; nerd breakdown
      "6 racks × 30 kW IT × PUE 1.38 = 248 kW facility"; tests/power.test.js; balance unchanged (commit 2e90911)
- [ ] Standing rule: after every commit `git push origin cursor/token-quest-datacenter-game` (Pages deploys
      from the branch, the kiosk serves the tree); only that branch, never force

## P3 — More Digital Realty connectivity, realistic calculations

- [ ] Product table (`js/network.js` / `js/data.js`) from digitalrealty.com and the ServiceFabric user guide:
      Cross Connect, ServiceFabric Link (L2), ServiceFabric Connection (L3 virtual router), ServiceFabric Internet
      (Digital Internet, blended transit up to 10 Gbps, same region), cloud on-ramps (AWS Direct Connect / Azure
      ExpressRoute / Google Cloud Interconnect via ServiceFabric or a cross connect in an on-ramp building), Metro
      Connect (inter-building dark fibre within a metro), Internet Exchange peering, private wavelengths between
      metros, ServiceFabric MCP; each with latency, bandwidth tiers, cost and lead time
- [ ] Calculations: per leg RTT = 2 × km × inflation × 4.9 µs + per-product overhead; bandwidth tiers
      (50 Mbps…100 Gbps) cap ingest and inter-site traffic; monthly cost = port MRC + per-connection MRC by tier
      + NRC; lead times: ports 15-day SLA (published), VXC minutes, cross connect ~1 week, metro dark fibre weeks,
      IX peering days
- [ ] Simple mode keeps 4 tiles (Public internet / Peering / ServiceFabric / COMBO); COMBO and
      ServiceFabric resolve to the specific products per leg and the TOKEN IMPACT strip names them; nerd mode's
      per-leg board lists the full product set with the numbers
- [ ] Tests: product table completeness, ordering (internet slowest), bandwidth caps, cost monotonicity, lead times

## P4 — Savings versus a cloud IaaS baseline

- [ ] Cloud baseline (`js/cloud.js`): the same GPU capacity rented as IaaS (labelled game list prices near public
      ranges: 8×H100 ~$32–45/hr on-demand, ~$20–30/hr 1-yr reserved; H200 / B200 higher; hourly per-GPU rates per
      platform) plus cloud egress for tokens and data and the users' public-internet path
- [ ] Both options use the public internet for the users' leg in the comparison; the colo build's other legs may
      use Digital Realty connectivity
- [ ] Saving per year = cloud annual cost (GPU-hours for the same good tokens, scaled by utilisation and the cloud's
      own idle, + egress + managed storage) − colo annual cost (amortised capex + power + space/connectivity + ops)
- [ ] Results: "Doing this in the cloud would cost about $X a year; your factory costs about $Y: you save about $Z
      (N%)" (red when negative); nerd adds the breakdown and a reserved / on-demand toggle; people-power stays as a
      separate "work of N people" fact; the score's savings factor uses the cloud saving (bounded, par retuned)
- [ ] Tests: baseline grows with demand; reserved vs on-demand; negative for a naive / oversized build and positive
      for a right-sized one; both legs on the public internet in the comparison

## P5 — Maths sanity and balance

- [ ] `scripts/balance.mjs` across stories × model sizes × users (sampled): naive 0, typical 300–700, best
      ~1,390–1,410 for each story's default model and users; document how the optimum shifts with 650B (NVL72) and
      with 10× users (more racks / sites)
- [ ] Tests: 650B on H100 ×2 cannot fit; 70B on RTX PRO 6000 fits and is cheapest per token at small scale; the cloud
      baseline for an 8×H100 equivalent at 100% utilisation ≈ $280–400k/yr on-demand; TTFT physics unchanged

## P6 — Verify

- [ ] Smoke at the four viewports in both modes (new first step, six GPU tiles, cloud-saving line)
- [ ] Read the 1180×820 and 1600×1000 screenshots of the new step, the GPU step and the results; fix clipping
- [ ] `scripts/stamp.mjs`, final commit, tick the plan

## V4 — Three booth requests (Oct 17)

- [x] A. TEST MODE (user: "Create a test mode, where the player info or score isn't saved. Put a toggle for this on
      the first page only."): a TEST MODE pill beside START on the title screen only (`data-key="test-mode"`, off by
      default); on, START works with a blank form, the HUD carries a TEST MODE badge on every screen, the results say
      "Test mode: not saved" in place of the ATTEMPT/RANK line, and nothing is kept (no league entry, no booth
      upload, nothing in localStorage); NEXT PLAYER and the idle reset switch it off. `js/testmode.js` is the pure
      state machine (`canStart`, `settleAttempt`); tests/testmode.test.js spies both save hooks; the smoke plays a
      test run at its first viewport
- [x] B. WHERE FIRST (user: "Move the 'where' section to be the first stage of the playable game, so users understand
      the scenario, workload they need to manage and geographic dependencies."): LOCATION (with WHO & WHERE) is
      step 1, MODEL & USERS step 2; the brief reads "default" numbers until step 2 is set; rail, review, smoke,
      tests and this plan follow
- [x] COLD AISLE CONTAINMENT (user: "Under cooling, there should be an option for cold aisle containment."): a
      fourth air hall (id C) between open air and the rear door: 15–30 kW a rack, PUE 1.29, 2-week fit-out (game
      estimates; US DOE FEMP and Schneider WP 135 cited in data.js); open air drops to its real ~15 kW so an HGX rack
      throttles there; simple board = air / containment / liquid, nerd adds in-row and rear door; every story opens on
      containment; tests/cooling.test.js
- [x] REAR DOOR HEAT EXCHANGER IN BOTH MODES (user: "In cooling add Rear Door Heat Exchanger as an option to allow
      realistic power densities."): simple cooling tiles = air / cold aisle containment / rear door heat exchanger /
      direct liquid (nerd keeps in-row); hall R 40–70 kW a rack, PUE 1.28, 6-week fit-out for chilled water, $35k a
      rack `rackNrc` added to capex (`coolingCapex`; Motivair/Vertiv/nVent cited in data.js); tiles show kW band,
      overhead (PUE in nerd) and lead, "needs direct liquid for <rack>" when an NVL72 is on the board; caps carry a
      5% nominal slack (`hallRackCap`) so a 30.4 kW air pair cools in a 30 kW containment rack; nerd designs pack
      four B300 nodes behind a door against two under containment; the rag/drug/robot experts sit on containment
      (right-sized), the door is a 3-star near-miss; tests/cooling.test.js, refarch and simple pins; smoke checks
      four tiles with band · overhead · lead
- [x] TITLE BOARD = TOP 3 FROM THE SHARED SHEET (user: "I don't see the league table on the first page updating
      properly. This should just display the first name & last name top 3"): `titleBoard()` in js/league.js picks the
      top three by best score from /api/league (re-fetched on every title show), names as entered, score; local league
      only when the API is unreachable; "shared scores offline" hint from /api/health configured:false (js/health.js)
- [x] "Peering + eyeballs" renamed "Peering" everywhere a player reads it (eyeball networks stay in the learn text)
- [ ] C. MULTI-SELECT CONNECTIVITY with best-path routing (user: "Ensure that there is always an option to turn the
      connections green ... the user can select many different types of connection ... public internet, cross
      connect, ServiceFabric, ServiceFabricMCP (which allows agentic routing), Dark Fiber."): the NET step is a
      multi-select of products; a router puts the lowest-latency legal product on every leg; two private products on
      a critical leg = REDUNDANT (no outage haircut); MCP with ServiceFabric = agent-routed; the CONNECTIONS light is
      relative to `bestConnectivity(storyId, metros)` (green within 10%, amber within 35%); nerd mode keeps the
      per-leg board with manual override; rebalance — see P-C below

## V5 — Game-model phases (Oct 18): one phase each, `node --test`, commit, push, `npm run deploy:worker`

Owned here: `css/game.css`, `css/mobile.css`, `js/**` except `js/sync.js`, `scripts/balance.mjs`, `scripts/smoke*.mjs`,
`scripts/stamp.mjs`, the game tests, this plan and the README's game sections. Never `deploy/**`, `server/**`,
`scripts/serve.mjs`, `js/sync.js`.

- [x] P-A GPU STEP = platform tile + RACK STEPPER (user: "Allow users to choose how many racks, so the solution could
      be lower power / older chips but more racks - ensure that is factored in to the maths"): HOW MANY RACKS under the
      GPU tiles on both boards (`data-key="racks-minus"` / `"racks-plus"`, nerd adds ±5), 1 rack up to the hall's rack
      positions × sites; every tile shows SERVES · POWER · COST · LEAD from `evaluateBuild` for the count it would land
      on (the chosen tile carries the player's count, the others their own default); the budget guard refuses a count the
      budget cannot pay for (`rackGuard`, tagged OVER BUDGET by $X); past the power offer is allowed and browns out; the
      Scouter and HOW WE THINK re-render from `evaluateBuild` on every press; `scripts/balance.mjs` enumerates racks 1..N;
      tests/racks.test.js (twenty H100 racks ≈ one NVL72 rack on coverage; the stepper never steps over the budget; the
      tiles' and the Scouter's numbers equal `evaluateBuild`); smoke presses plus and minus at every viewport
- [ ] P-B COACH = one-step neighbour search (`js/coach.js`): every tile alternative on every step, racks ±1 / ±5, one
      connectivity product added or removed, one metro added or removed; the biggest score gain inside the budget guard;
      plain in simple mode, with the gain in nerd mode; "This is the best build for this job" when nothing improves;
      reused for the round-1 hint and the results' "what would have scored higher"; test: 50 random builds a story,
      following the advice raises the score or no neighbour does
- [ ] P-C NET = MULTI-SELECT with a best-path ROUTER: Public internet, Cross Connect, ServiceFabric, ServiceFabric MCP
      (agentic routing, only with ServiceFabric), Dark Fiber (nerd adds Pathway, Metro Connect, Peering, Digital Internet,
      cloud on-ramps); the router assigns each leg the lowest-latency legal product among those selected; per-leg route on
      the step, the review and the results; ≥ 2 private products on a critical leg = REDUNDANT (no outage haircut); every
      product adds NRC / MRC / lead; tiles show FIRST TOKEN and COST PER 1M TOKENS for "only this product" and the delta
      against the selection; CONNECTIONS light relative to `bestConnectivity(storyId, metros)` (green within 10%, amber
      within 35%); public internet shows GPU idle and a stutters stream for live-user stories; tests + smoke at two viewports
- [~] P-D POWER STEP (after QPU, before REVIEW): need = Σ racks × rack kW (+ gear) × PUE live; contracted-power tiles in
      metro-realistic steps (0.1 / 0.25 / 0.5 / 1 / 2 / 3 MW; nerd 50 kW stepper) priced as reservation + energy
      (estimate); too little → power-capped throttling + trip-risk haircut; too much → stranded-capacity opex; green at
      10–20% headroom, amber 0–10% or ≤ 10% short, red otherwise; green only on a deliberate pick; floor ≥ 100; review
      row, results and DR-help lines; tests + smoke (desktop + mobile)
  - [x] P-D1 PER-METRO POWER OFFERS (user: "different power amounts and costs available at every location"):
        `METRO_POWER` in `js/data.js` (block ladder `blocksMW` + `power: { mwh, kwMonth }` per metro, labelled estimates
        shaped by Eurostat nrg_pc_205 / DESNZ / EIA Table 5.6.A, no two metros alike: London 0.25/0.5/1 MW at $165,
        Amsterdam 0.5/1/2 at $115, Frankfurt 0.25/0.5/1/2 at $140, Paris 0.5/1/2/3 at $95, Ashburn 1/2/3 at $78,
        Dallas 1/2/3/5 at $62, Chicago 0.5/1/2 at $82, Silicon Valley 0.25/0.5 at $195) folded into every story's
        `METRO_OFFERS`; LOCATION tiles show "Power: up to X MW · $Y/MWh (est.)" with the ladder in the learn lines;
        tests/offers.test.js (pairwise distinct, power floor rule per story, tile text)
  - [ ] P-D2 POWER STEP (engine per-site power, light, review row, results + DR-help, balance, smoke)
- [ ] P-E MEMORY + STORAGE EXPANSION per P3/P5 above
- [ ] P-F CLOUD IaaS BASELINE per P4 above (both sides on the public internet for the users' leg; "cloud would cost $X,
      your factory $Y, you save $Z")
- [ ] P-G balance + four-viewport smoke + mobile smoke + README
