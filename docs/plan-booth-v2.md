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

## P3 — Location distances and latency physics `DONE`

- [x] Haversine `kmBetween` (`js/model.js`)
- [x] Digital Realty metro lat/lon (`js/data.js` SITES), user regions (USER_BASES) and data-home lat/lon (DATA_HOMES)
- [x] Users and data distances per metro tile: "Users: N km · Data: M km" (`metroOffers`, `metroHint`; `tests/sites.test.js`)
      — users km is the share-weighted average over the story's regions, data km is to the model / data home,
      and the two differ for every story × metro (asserted). Nerd line adds "Farthest users: city N km".
      The drug story's data home is the lab's cloud tenancy in Dublin so Cambridge users ≠ data.
- [x] Model transfer hours + egress $/GB folded into go-live (`modelTransfer`, EGRESS_PER_GB, lead parts)
- [x] Tiny map on the location step (`js/map.js`, `tinyMap` in `js/main.js`): users, data home, candidate metros,
      links with km from the chosen metros; frame fits users + metros, a far data home is pinned to the edge
      (◀ Ashburn); labels placed below / above / right / left without collisions (`tests/map.test.js`)
- [x] `storyLegs` / `dataTrips` in `js/latency.js`: request leg uses the USERS distance, retrieval / tool
      trips use the DATA distance, `slaExempt` bulk legs reported as `bulkBps`
- [x] `js/latency.js` physics module: 4.9 µs/km, inflation 1.2 fibre / 2.0 internet, per-option
      overheads (OPTIONS), `ttftS` = users RTT + trips × data RTT + store + queue + prefill,
      `firstToken` over legs with `slaExempt` skips, jitter pacing (`pacedStepS`, `streamFeel`),
      loss / Mathis (`mathisBps`, `usableBps`), `gpuIdle` = 1 − min(1, streams × step / (step + wait)),
      `pMiss` normal approximation and `lateFactor` × LATE_GOODPUT, `transferHours` + `egressUsd` →
      `goLiveDays`, and `tokenImpact` bundling it all for one option.
      The scoring in `js/model.js` / `js/routes.js` keeps its tuned constants (5 µs/km, no fibre
      inflation, triangular P(miss)); the strip reads `js/latency.js`, the score does not move.
- [x] Sanity tests (`tests/latency.test.js`): LON↔FRA ≈ 640 km ≈ 7.5 ms fibre RTT; LON↔Ashburn ≈ 5,900 km
      ≈ 69 ms fibre, ≥ 140 ms internet

## P4 — Connectivity step `DONE`

- [x] Public internet / Peering + eyeballs / ServiceFabric tiles with per-story "why" lines (`js/steps.js` WIRE_TILES, WIRE_WHY)
- [x] Nerd tile Cross connect + Dark fiber (metro or regional only, FIBER_MAX_KM 1,500)
- [x] Per-leg mixes exist as a preset (`js/presets.js` MIX, `wires: "mix"`) with every product costed and the dark fiber lead
- [x] COMBO tile where mixing pays (`js/presets.js` COMBO, `wireIds`, `hasCombo`; `js/steps.js` COMBO_HINT, WIRE_WHY.combo):
      RAG / research "on-ramp cross connect + ServiceFabric (+MCP)", coding agent "ServiceFabric for developers,
      on-ramp cross connect for repos, dark fiber between sites only within 1,500 km, MCP control", robotics
      "cross connect to each plant's carrier + ServiceFabric between sites" (`legEligibility` lets a partner's
      carrier land on a cross connect; the miles beyond are fibre physics). Chat and drug discovery have no COMBO.
      COMBO bills every product's NRC / MRC and waits for the longest lead; best wire where offered (`tests/combo.test.js`)
- [x] Live TOKEN IMPACT strip on every connectivity tile (`js/impact.js` `wireImpact`, `impactStrip` in `js/main.js`):
      FIRST TOKEN vs target (green / amber / red), STREAM smooth / stutters / stalls, GPU IDLE % (`result.wireIdle`:
      the share of the racks' token rate the wire alone throws away), one plain "why" sentence; nerd adds per-leg RTT,
      jitter sd, loss, bandwidth, P(miss), monthly cost, one-off cost and lead time (`detailLine`, also in every
      tile's "?" popover). Strip values equal `evaluateBuild` outputs for the same build (`tests/impact.test.js`);
      no page scroll at the four viewports in either mode (compact layout under 1200 px: strip under art + words,
      nerd three columns)

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

## P8 — Smoke and ship `PARTLY DONE`

- [x] iPad-ready: `scripts/smoke.mjs` walks 1920×1080, 1600×1000, 1180×820 and 1024×768 in both modes with the
      layout audit (overlap, spill, viewport, covered centre, text overflow, panel scroll, 44 px tap targets,
      12 px tile text). Compact board under 1200 px wide (`css/game.css` `@media (max-width: 1200px)`): same
      two / three columns, tiles lie art-beside-words, nerd tile sets in two columns, review rows in two
      columns without the detail bar, side NERD button and nerd gremlin row dropped, `100vh` → `100dvh`,
      `touch-action: manipulation`, no tap highlight, no selection or callout on tiles, `?` and scene dots
      carry a 44 px halo. A touch-emulated pass (iPad UA, DPR 2) confirmed tap picks, `?` opens on tap,
      a 700 ms hold opens the popover without changing the pick.
- [ ] Smoke both kiosk viewports through the whole flow, both rounds (passes today; re-run before shipping)
- [ ] 1600×1000 screenshots of title, intro, each step, results, league (kept out of the repo in `.shots/`)
- [ ] Stamp the build and final commit
