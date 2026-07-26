# JRRToken — AI Infrastructure Planning & Teaching Suite

The complete codebase: three related applications for planning, pricing
and teaching AI infrastructure — how prompts become tokens, how
architecture choices drive tokenomics, and how to configure and quantify
the advantage of a carefully designed data-centre deployment.

| App | Where | Run | Port |
| --- | --- | --- | --- |
| FLUX — AI Workload Planner | `index.html` (repo root) | `python3 -m http.server 8902` or open the file | 8902 |
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

## 2. Sharp(er) Enterprises workshop simulator (`workshop-simulator/`)

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

## 3. Original AI infrastructure simulator (`original-simulator/`)

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
