# Token Quest

An 8-bit trade-show game from Digital Realty. Players design an AI factory inside a data center
and are scored on how efficiently it serves tokens. Every AI answer is born in a data center:
power, cooling, chips, data and connections working as one ecosystem, and the game teaches why
each of those decisions matters.

Play the hosted demo at the team URL (password-protected; ask the team), or run it on a laptop
for a booth (see [HOSTING.md](HOSTING.md)).

## What a player does

1. **Sign in.** Full name, email, and consent to Digital Realty's privacy practices.
2. **Intro.** Click-through scenes: prompt → tokens → retrieval → generation, the data-center
   ecosystem, and "take any one away and the AI stops". **Nerd mode** (a toggle on every screen)
   swaps in longer, technical captions.
3. **Pick a job.** Customer Chat, Knowledge RAG, Coding Agent, Deep Research, Drug Discovery or
   Robotics. Each scenario states where the users are, where the model weights and data live,
   the demand, the response-time target, the budget, the power available and the go-live deadline.
4. **Build, one step at a time.** Model size and number of users → Location (real Digital Realty
   metros with distances to customers, employees and data) → GPU (NVIDIA only: DGX Spark, L40S,
   RTX PRO 6000 Blackwell Server, HGX H100/H200/B200/B300, GB200 NVL72, GB300 NVL72, Vera Rubin
   NVL72) → Cooling (air, rear-door heat exchanger, in-row, direct liquid) → Memory (KV cache,
   CPU host memory) → Connectivity (Cross Connect, Metro Connect, ServiceFabric Link/Connection,
   ServiceFabric MCP, Digital Internet, cloud on-ramps, dark fiber, IX peering, public internet)
   → Storage → QPU (ORCA PT-3 for drug discovery) → Review → GO.
5. **Watch it run,** then read the results: score and stars, the one-line lesson, how many
   people's work the factory does, what the same capacity would cost as cloud IaaS, "what you
   built and why it scored this way", and "how Digital Realty would have helped". A second round
   lets the player improve the build after a single hint.

A live **ecosystem bar** (power, cooling, compute, data, connections) shows green, amber or red
as choices change; the score itself stays hidden until GO. Nothing a player picks can take the
build over budget, and no build that runs scores zero.

## The model (what the maths does)

- **Inference physics.** Prefill is compute-bound; decode is a memory-bandwidth roofline over the
  weights plus every active stream's KV cache. HBM capacity caps streams; CPU host memory and the
  KV cache tier park idle sessions; FP4/FP8 halve bytes per weight on Blackwell and Rubin; a
  model that spills off its NVLink domain is penalised.
- **Latency.** Real great-circle distances between real metros; fibre at ~4.9 µs/km with a route
  inflation factor; time to first token = users' round trip + retrieval/tool round trips to the
  data + prefill + queueing. Jitter sets the probability of missing the response target; packet
  loss stalls streams; GPUs sit idle while the serving loop waits on slow links.
- **Connectivity.** Each product has latency overhead, bandwidth tiers, monthly and one-time cost
  and a lead time. Private paths (cross connect, metro connect, dark fiber, ServiceFabric) are
  ordered ahead of IX peering, with public internet always slowest and the only option with
  loss. ServiceFabric MCP is the same fabric configured by an agent, never a faster pipe.
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

## Hosting

| Where | What | How |
|---|---|---|
| **Cloudflare Worker** (team URL) | The game plus the `/api` that keeps a shared league and writes the player sheet; password-gated | `npm run deploy:worker` (see HOSTING.md) |
| **Booth laptop** | Full kiosk: the game, a local server, idle reset, staff tools, and an Excel leaderboard on the Desktop | double-click `start-token-quest.command` |
| **GitHub Pages** | Static copy of the game only (per-browser league, nothing collected) | deploys from the game branch |

Completed hosted games are written to `PLAYERS.md` in a separate **private** repository
(`token-quest-players`): name, email, attempts, best and latest score, and an attempts log, updated
on every game. Emails never appear in this public repo or on screen.

## Repository layout

```
index.html, css/, js/, assets/   the game (vanilla ES modules, no build step to play locally)
js/data.js                       scenarios, platforms, networks, metros, prices, lessons
js/model.js, js/latency.js       the evaluation and the physics
js/steps.js, js/presets.js       the stepped build and the simple/nerd tile sets
js/explain.js, js/drhelp.js      results copy: what you built, how Digital Realty would have helped
js/refarch.js                    anonymised OEM reference architectures (nerd mode)
server/, scripts/serve.mjs       the kiosk server: attempts log, league API, Excel export
deploy/intake-worker/            the Cloudflare Worker: static assets, API, player sheet, gate
scripts/balance.mjs              enumerates builds per story and checks the balance
scripts/smoke.mjs                plays the whole game in headless Chrome at four viewports
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

## Privacy

The booth laptop's `data/` folder and Desktop workbook, and the private players repository, hold
names and emails collected under the on-screen consent text. Export what you need after the event
and delete the rest. The staff tools are PIN-protected; the hosted game is password-protected.
