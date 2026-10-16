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

## P2 — More NVIDIA GPUs (both modes)

- [ ] Add to `PLATFORMS` with public specs (source URLs in comments): RTX PRO 6000 Blackwell Server Edition
      (96 GB GDDR7, ~1.6 TB/s, 600 W; MGX 8-GPU air server, cost-effective inference tier), L40S (48 GB GDDR6,
      864 GB/s, 350 W; budget tier), HGX B300 ×8 single node (smaller rack option); GB200 / GB300 / Vera Rubin
      NVL72 already exist; every entry carries HBM/GDDR capacity, bandwidth, dense FP8/FP4 PFLOPS, power, cooling,
      estimated rack price and lead time (labelled)
- [ ] Simple GPU step: six tiles, every NVIDIA platform the story can use (RTX PRO 6000 Blackwell Server ×8,
      HGX H100 ×2, HGX H200 ×2, HGX B300 ×6, GB200 NVL72 ×2, Vera Rubin NVL72 ×1; L40S / GB300 where sensible),
      each with the real name, a plain hint and the "included" / "needs liquid" tags; a 3×2 grid with the smaller
      tile style at desktop and iPad widths, no scroll at the four viewports, taps reachable, nothing clipped;
      nerd mode keeps the full list with specs and reference designs
- [ ] Memory-bound decode makes the GDDR parts slower per GPU; RTX PRO 6000 wins only for small models with
      modest users; the SMALL users tier makes the budget GPUs (RTX PRO 6000 / L40S / H100 ×2) the right answer
- [ ] `scripts/balance.mjs` re-run: naive 0 / best ~1,400 / optima differ

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
- [ ] Simple mode keeps 4 tiles (Public internet / Peering + eyeballs / ServiceFabric / COMBO); COMBO and
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
