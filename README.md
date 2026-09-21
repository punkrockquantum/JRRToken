# JRRToken — AI Infrastructure Planning & Teaching Suite

The complete codebase: three related applications for planning, pricing
and teaching AI infrastructure — how prompts become tokens, how
architecture choices drive tokenomics, and how to configure and quantify
the advantage of a carefully designed data-centre deployment.

| App | Where | Run | Port |
| --- | --- | --- | --- |
| FLUX — AI Workload Planner | `index.html` (repo root) | `python3 -m http.server 8902` or open the file | 8902 |
| FLUX EDGE — Edge PoP & Regional Hub Site Planner | `edge-planner.html` (repo root) | same server, or open the file | 8902 |
| Sharp(er) Enterprises workshop simulator | `workshop-simulator/` | `npm install && npm run dev` | 5200 |
| Original AI infrastructure simulator | `original-simulator/` | `npm install && npm run dev` | 5173 |

---

## 1. FLUX — AI Workload Planner (`index.html`)

A Digital Realty Solution Architecture tool in one self-contained HTML
file: no build step, no dependencies, no backend.

### Tab 1 — Comprehensive Planner

Configure a deployment layer by layer; FLUX computes feasibility,
performance, power and economics live:

- **Use cases** — presets for Life Science drug discovery, FSI fraud
  detection, network-backbone inference, robotics, computer vision,
  manufacturing, self-driving fleet support, a 10 MW+ training hub, and
  NeoCloud GPUaaS. Everything stays editable.
- **Architectures** — NVIDIA (H100 → GB300 NVL72, DGX Spark, RTX PRO
  6000, Vera Rubin NVL144), AMD (MI300X → Helios rack), and alternative
  architectures as sold at market: **Cerebras CS-3** 4-system wafer-scale
  pods (~2,000 tok/s per stream, 44 GB on-wafer SRAM each) and
  **SambaNova SN40L** DataScale racks (HBM + DDR tiered memory). VRAM
  variants per platform; inference or training workloads; a model catalog
  spanning cloud-frontier estimates (labelled), emerging, open-weight and
  edge models — MoE models prefill on active parameters.
- **Connectivity** — DLR interconnection products with real port menus:
  Cross Connect (~0.5 ms), Metro Connect (~2.5 ms), ServiceFabric (~8 ms,
  800G flagged pre-GA); switching (Quantum-X800, Spectrum-X, Cisco
  Silicon One, Cornelis, standard Ethernet) and routing policies as
  east-west efficiency.
- **Storage & CPU** — local NVMe / Everpure / NetApp in object or file
  mode; KV-cache offload (+25–30% session budget); **KVA persistent KV
  cache** (40% / 80% prefix-reuse profiles — cache hits stream
  precomputed KV tensors from flash instead of recomputing prefill);
  GPUDirect; standard EPYC/Xeon or Blackcore overclocked hosts.
- **Outputs** — TTFT (warm/cold when KVA is on), token cost per 1M vs the
  $3.50 market reference, customer value and value-to-DLR, a deployment
  plan narrative, a NeoCloud GPUaaS rental benchmark, an
  every-architecture comparison table, and a recommendations engine that
  suggests the next efficiency (FP8 KV, offload, KVA with
  inflection-point warnings, GPUDirect, cheaper silicon, consolidation).

### Tab 2 — Prompt → Token → Value (ACC4 / LHR19)

An animated demo of 1,000 users hitting enter at the same moment, run
from the **Go — run the journey** control at the top of the page. The
fixed design is optimised for lowest TTFT and maximum customer value:
two sites instead of three (a third of the fixed cost removed while two
B300 nodes still hold 3× the load), Blackcore hosts (3 ms dispatch),
GPUDirect prefill (−10%), FP8 KV. On completion it prints the complete
processing values: per-site prefill waves, TTFT, KV written, answer
tokens, serving cost, peak streams, power envelope, cost and market
value per answer, steady-state volume, customer margin and value to DLR.

### The model behind the numbers

- Sessions per node = (node VRAM − weights) ÷ (context × MB/token);
  FP16 KV = 0.330 MB/token, FP8 = 0.165.
- Prefill = linear term (2 FLOPs × active params/token) **plus a
  quadratic attention term** (≈4 × layers × d_model × ctx²,
  Llama-70B-calibrated) — why a 110k-token prompt takes ~55 s on one
  H100.
- KVA warm path = prompt-KV bytes streamed at ~6 GB/s per GPU shard in
  parallel (+90 ms management; ×2 with GPUDirect), never slower than
  recompute; calibrated to published FSI benchmarks (110k-token TTFT
  54.5 s → 4.0 s, 13.6×, local NVMe ≈ NFS).
- Economics: compute own-cost + colo ($220/kW-mo, PUE 1.3) +
  interconnect + storage services at 35% utilisation, benchmarked
  against NeoCloud list rates (+10% ancillary) and CSP on-demand /
  committed rates.

---

## 2. FLUX EDGE — Edge PoP & Regional Hub Site Planner (`edge-planner.html`)

Where FLUX sizes *a* deployment, FLUX EDGE decides *where the deployments
go*. Another self-contained HTML file — no build step, no backend.

Describe the workload and the tool returns the sites to add, how to route
them, and what each one buys in TTFT, throughput and dollars.

### Inputs

- **Category and use case** — industry applications (FSI fraud scoring and
  research copilots, life science, manufacturing, robotics/AV fleet,
  retail CV, telco backbone, public sector), LLM providers (frontier lab,
  model API, small-model serving) and NeoCloud (GPUaaS, training
  capacity). Each preset sets model, context, SLO, access network,
  residency and a metro demand tilt — everything stays editable.
- **Model scale** — a catalog from Ministral 8B to Kimi K2 1T MoE, or a
  custom parameter/active-parameter count; KV precision; separate hub and
  edge accelerators (or *auto*, which picks the smallest platform that
  still clears the SLO and the decode floor).
- **Demand** — sized from peak concurrent streams *or* from token volume
  per day, with a duty cycle tying the two together so they can never
  contradict each other. Regions in scope, access network, and data
  residency (none / in-region / in-country).
- **Known customers** — anchor tenants pinned to a metro with a demand
  share and an on-net flag; on-net tenants land on a cross connect inside
  the campus instead of crossing the access network.
- **Current edge locations** — what you run today. Their capex is sunk,
  they set the baseline improvements are measured against, and any the new
  topology makes redundant are flagged.
- **Policy** — Digital Realty and/or Equinix, max new sites, MW per site,
  permitted transports, and an objective slider from pure economics to
  pure latency.

### Site catalog

65 candidate sites: Digital Realty (including Interxion, Ascenty and
Teraco campuses) and Equinix IBX metros across the Americas, EMEA and
APAC, each with coordinates, power headroom, air and liquid rack
density, SDN fabric, dark fibre, on-net internet exchange and
participant count, subsea cable landing, colo multiplier, energy price
and lead time. Browsable and filterable in the **Site atlas** tab.

**Rack density is a hard siting gate, not a footnote.** Densities run
from 7 kW — classic carrier-hotel cabinets in the older interconnect
buildings — to 100 kW liquid-ready positions in purpose-built AI halls.
A GPU node is a chassis and cannot straddle two cabinets, so a node
drawing more than the site's rack density does not land there at all: a
B300 node is 8.8 kW, an MI355X node 11.2 kW, and an NVL72-class system
is its own cabinet needing a 100 kW+ liquid-ready position. That is
what pushes hub serving out of the densest peering metros and into the
AI halls, and it is why a lower-power edge node is what buys you back
into them. Cabinet counts are reported per site, because at low density
a single node can occupy a whole rack — which costs nothing extra under
per-kW colo but is exactly what a cabinet-priced quote keys off.

### Outputs

- **Recommended topology** — regional hubs, metro hubs and edge PoPs, each
  with the platform it should run, replicas and nodes, load, TTFT split
  into prefill and queue, decode per stream, cost, `$`/1M and net
  contribution, plus a plain-language *why this site*.
- **Routing recipe per site** — cross connects for on-net tenants,
  ServiceFabric / Equinix Fabric virtual circuits for tenant onboarding
  and cloud on-ramps, an IX peering port sized against eyeball traffic
  with the transit remainder priced, and dark fibre or a managed wave back
  to the nearest hub for weight distribution and KV warm-up.
- **Marginal gain** — what each added site does to TTFT, coverage, SLO
  attainment and net value, so the point of diminishing returns is visible
  rather than asserted.
- **TTFT by market** — planned against baseline, with the transport,
  distance, access and network legs broken out.
- **Demand with nowhere to land** — markets blocked by residency or power
  envelopes, with the nearest permitted site and what the smallest viable
  footprint there would cost.
- **Financial position** — compute, colo, storage, cross connects, fabric,
  IX ports and transit, baseline against plan, plus operator revenue
  (colo + interconnect) to Digital Realty / Equinix.
- **Training siting** — for training workloads the serving optimiser is
  skipped entirely and sites are ranked on delivered cost per million
  training tokens for a fixed MW block, with the honest caveat that
  compute is ~90% of the bill and the whole site spread is a few percent.
- Copy-as-text and CSV export.

### The model behind the numbers

Same physics and economics as FLUX — the linear + quadratic-attention
prefill model, KV sizing at 0.330/0.165/0.083 MB per token, `$220`/kW-month
colo, 35% utilisation, the `$3.50`/1M market reference — plus geography:

- Propagation at 204 km/ms one-way in fibre with 1.38 route circuity,
  doubled for the round trip; per-transport overheads (cross connect
  +0.1 ms, dark fibre +0.4, IX +1.2, fabric +2.5) and an IP-transit
  fallback at 1.55 circuity plus a 12 ms middle-mile penalty.
- Access latency the user already spends: on-net 1.5 ms through to mobile
  22 ms — on mobile access the tool will decline to add a second PoP
  400 km from the first, and say why.
- Demand is routed on *total* latency, not distance: sites are placed
  once on proximity, their real service time measured, then placed again —
  so a nearby small node never wins traffic it would answer more slowly.
- Tokens are discounted when they land outside the TTFT SLO or below the
  decode floor. That discount is how a latency improvement becomes a
  financial one — and when the SLO is already met, the tool says plainly
  that the latency gain is not being monetised.

## 3. Sharp(er) Enterprises workshop simulator (`workshop-simulator/`)

The full workshop application (React + Vite + TypeScript, 72 tests) for
the AuraCopilot scenario — Llama 3.3 70B at native FP16, quantization
banned, sub-100ms TTFT, 100M tokens/day across Ashburn, Frankfurt and
Tokyo hubs. Six tabs:

1. **Workshop tracks A–E** — the judges' registry (token consultation,
   HPE compute & storage with the WEKA/Alletra judges' note, datacenter
   leasing matrix, WAN, financials with break-even maths) beside live
   simulation; HPE Cray XD670, Dell PowerEdge, SambaNova and Cerebras
   reference architectures; a watts-to-tokens journey with a
   TTFT/token-value optimiser across all 12 option×platform builds.
2. **Explainer** — seven choices, three options each (weights, KV
   density, context, hardware, users, TTFT, tokens/day), with
   projector-sized verdicts (OOM / TOO SLOW / SHORTFALL) — built for
   live sessions of 10–50 people.
3. **Sharp(er) Enterprises — Token Consultant** — architects build
   constraints from blank boxes, pick the facilitator prompt they must
   survive, and generate a balanced pitch brief (strengths, risks,
   copyable slide block). No answer keys anywhere.
4. **Token Alchemy Challenge** — the scored evaluation terminal:
   architecture + worksheet submissions judged across five weighted
   categories per business case (Life Sciences drug discovery at
   12k-token RAG contexts, FSI fraud detection at 50 ms SLOs, wearables,
   connected vehicles, B2C, IaaS, frontier lab), rack density economics,
   the Track A 5/3/1 rubric, per-formula coefficient breakdowns, dollar
   ROI with a 60-month profit/loss timeline, and a five-team
   leaderboard. No OOM disqualifications — overshoot queues, per real
   admission control.
5. **Simple view** — a beginner's animated walk from prompt to tokens
   through a switchable frontier model (tokenizer IDs, embeddings,
   attention, MoE, softmax-and-sample, KV-cache growth).
6. **Full stack explorer** — the complete tunable physics sandbox:
   models, quantization, silicon, fabrics, DLR sites + on-prem, cooling,
   power caps, storage tiers and persistent KV-cache context reuse, with
   itemised cost-per-token breakdowns.

Also ships `sharepoint/` — self-contained single-file builds
(`.html`/`.aspx`) and a workshop launcher for SharePoint hosting.

## 4. Original AI infrastructure simulator (`original-simulator/`)

The general-purpose ancestor: model/silicon/network/cooling/datacenter
catalogs, the roofline simulation engine, the animated prompt journey,
cost breakdowns and deep-dive explainers.

---

## Provenance & accuracy

Vendor-datasheet and open-model figures are used where published.
Proprietary model sizes, alternative-architecture pricing (Cerebras,
SambaNova), rental rates and street prices are labelled planning
estimates. Workshop registry values follow the judges' workbook, with
known discrepancies documented in tests. All performance and dollar
figures are illustrative models for planning and teaching — not quotes.
