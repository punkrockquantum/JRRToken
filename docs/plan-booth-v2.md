# Token Quest booth v2 — plan and checklist

Branch `cursor/token-quest-datacenter-game`. Short phases, `node --test` after each,
commit every green phase (game files only: no `data/`, `*.xlsx`, `.shots/`, `dist/`, `*.log`).
Hosting files are out of scope here (`server/**`, `scripts/serve.mjs`, `js/sync.js`,
`tests/server.test.js`, `tests/xlsx.test.js`, `HOSTING.md`, `deploy/**`, `Dockerfile`, workflows).

Legend: `[x]` done in the tree · `[~]` partly done (what remains is listed) · `[ ]` not started.

## P1 — Ecosystem opening `DONE`

- [x] Title tagline: "Every AI answer is born in a data center." (`js/main.js` TAGLINE)
- [x] Simple intro, four scenes incl. the ecosystem cutaway (`js/intro.js` SIMPLE_SCENES: ask, ecosystem, takeaway, build; `ECO_SCENE_PARTS`, `ecosystemLit`)
- [x] Nerd intro, six scenes on one shared timeline (prompt, generation, ecosystem, factory, wires, quest)
- [x] Tests: `tests/intro.test.js`

## P2 — Scenario and stepped build `DONE`

- [x] Scenario card per story: USERS place and MODEL & DATA place (`js/data.js` SCENARIOS / DATA_HOMES, `scenarioCard` in `js/main.js`)
- [x] Stepped build LOCATION → GPU → COOLING → MEMORY → CONNECTIVITY → STORAGE → QPU → REVIEW → GO (`js/steps.js` STEPS, step rail in `js/main.js`)
- [x] Persistent ecosystem bar on every step: POWER / COOLING / COMPUTE / DATA / CONNECTIONS (`js/eco.js`, `.eco-bar` in `css/game.css`)
- [x] Star targets line under the score (`targetLine`, STAR_POINTS 1000 / 1200 / 1350)
- [x] Question coach: one question from the first red (else amber) ecosystem part (`ecoQuestion`, `coachLine`)
- [x] Learn toasts and tile "why" pops (`flashWhy`, hold-to-learn)
- [x] Tests: `tests/eco.test.js`, `tests/simple.test.js`, `tests/game.test.js`

## P3 — Location distances and latency physics `PARTLY DONE`

- [x] Haversine `kmBetween` (`js/model.js`)
- [x] Digital Realty metro lat/lon (`js/data.js` SITES) and data-home lat/lon (DATA_HOMES)
- [x] Users and data distances per metro tile: "N km to users · M km to data" (`metroOffers`, `stepTiles`; `tests/sites.test.js`)
- [x] Model transfer hours + egress $/GB folded into go-live (`modelTransfer`, EGRESS_PER_GB, lead parts)
- [ ] Tiny map on the location step (users, data home, candidate metros)
- [ ] `js/latency.js` physics module: 4.9 µs/km, inflation 1.2 fibre / 2.0 internet, per-option
      overheads, TTFT = users RTT + trips × data RTT + store + queue + prefill, jitter pacing,
      loss / Mathis, GPU idle = 1 − min(1, streams × step / (step + wait)), P(miss) normal
      approximation × LATE_GOODPUT, `slaExempt` skips, model transfer hours + egress → go-live.
      Today the physics lives in `js/model.js` / `js/routes.js` (5 µs/km, internet inflation 2.0,
      no fibre inflation, triangular P(miss)).
- [ ] Sanity tests: LON↔FRA ≈ 640 km ≈ 7.5 ms fibre RTT; LON↔Ashburn ≈ 5,900 km ≈ 69 ms fibre, ≥ 140 ms internet

## P4 — Connectivity step `PARTLY DONE`

- [x] Public internet / Peering + eyeballs / ServiceFabric tiles with per-story "why" lines (`js/steps.js` WIRE_TILES, WIRE_WHY)
- [x] Nerd tile Cross connect + Dark fiber (metro or regional only, FIBER_MAX_KM 1,500)
- [x] Per-leg mixes exist as a preset (`js/presets.js` MIX, `wires: "mix"`) with every product costed and the dark fiber lead
- [ ] COMBO tile on the connectivity step (robotics, coding agent, RAG / research mixes), simple and nerd copy
- [ ] Live TOKEN IMPACT strip per tile: first token vs target, stream smooth / stutters / stalls,
      GPU idle %, one "why" sentence; nerd adds per-leg RTT, jitter, loss, bandwidth, P(miss), cost, lead
      (today the nerd line shows per-leg products via `nerdLegs(result)`)

## P5 — Balance and two rounds `DONE`

- [x] Location enumerated in the search (`js/balance.js` searchBuilds; `scripts/balance.mjs` report)
- [x] 1–2 combos within 2% of the best for every story (1/1/1/1/1/2)
- [x] Optima pairwise differ in ≥ 2 decisions
- [x] Max-everything ≤ 300; naive opening picture = 0; one-step near-misses in 700–1,100
      (two one-step misses still score three stars: code with a vector index 1,366; robot on air 1,390)
- [x] Two rounds: IMPROVE IT, single hint = first red / amber ecosystem part, final = best of two,
      "Round 1: 812 → Round 2: 1,400 (+588)", league entry keeps round1 and round2 (`js/rounds.js`)
- [x] Tests: `tests/simple.test.js` balance block, `tests/eco.test.js` rounds block

## P6 — Nerd reference architectures `TODO`

- [ ] `js/refarch.js`: 3–4 anonymised OEM designs per GPU platform from public datasheets
      (GPUs/node, U, CPU, memory, NICs, NVMe, node power, cooling, nodes/rack, racks, lead)
- [ ] Source URL in code comments only
- [ ] Nerd GPU step shows the designs; player text never names a vendor
- [ ] Test bans `Dell|Supermicro|HPE|Hewlett|Lenovo|Cray|PowerEdge|ThinkSystem` in player text

## P7 — Results: HOW DIGITAL REALTY WOULD HAVE HELPED `TODO`

- [ ] 4–6 tailored lines per result quoting real distances, capacity, architecture and time
- [ ] Only published Digital Realty facts (metros, ServiceFabric, cross connects, lead times already in `js/data.js`)
- [ ] Test: every story × a weak build and the best build yields 4–6 lines with no made-up numbers

## P8 — Smoke and ship `TODO`

- [ ] Smoke both viewports (booth 1600×1000 and the small kiosk) through the whole flow, both rounds
- [ ] 1600×1000 screenshots of title, intro, each step, results, league (kept out of the repo in `.shots/`)
- [ ] Stamp the build and final commit
