# Fellowship of the Token — AI Infrastructure Teaching & Planning Suite

The complete collection: three related tools for teaching and planning AI
infrastructure — how prompts become tokens, how architecture choices
drive tokenomics, and how to configure and price real deployments.

> The FLUX planner also lives standalone in the
> [JRRToken](https://github.com/punkrockquantum/JRRToken) repo; this
> repository preserves the entire suite.

| App | Where | Run | Port |
| --- | --- | --- | --- |
| FLUX — AI Workload Planner | `index.html` (repo root) | `python3 -m http.server 8902` or open the file | 8902 |
| Sharp(er) Enterprises workshop simulator | `workshop-simulator/` | `npm install && npm run dev` | 5200 |
| Original AI infrastructure simulator | `original-simulator/` | `npm install && npm run dev` | 5173 |

## 1. FLUX — AI Workload Planner (`index.html`)

A Digital Realty Solution Architecture tool: single self-contained HTML
file, no build step. Configure architecture (NVIDIA / AMD / Cerebras
CS-3 pods / SambaNova SN40L racks), model, DLR interconnection (Cross
Connect / Metro Connect / ServiceFabric), switching, routing, storage and
CPU — with KVA persistent KV-cache modelling on the storage layer
(calibrated to published FSI benchmarks: 110k-token TTFT 54.5 s → 4.0 s)
and quadratic-attention prefill. Includes a NeoCloud GPUaaS benchmark for
every plan. Economics are an illustrative model, not quotes.

## 2. Sharp(er) Enterprises workshop simulator (`workshop-simulator/`)

The full workshop app (React + Vite + TypeScript, 72 tests) for the
AuraCopilot scenario — Llama 3.3 70B at native FP16 across Ashburn,
Frankfurt and Tokyo hubs:

- **Workshop tracks A–E** — the judges' registry with live simulation,
  HPE XD670 / Dell / SambaNova / Cerebras reference architectures, and a
  watts-to-tokens journey with a TTFT/token-value optimiser.
- **Explainer** — seven choices, three options each, built for live
  sessions of 10–50 people.
- **Sharp(er) Enterprises — Token Consultant** — architects build their
  constraints from blank boxes and generate a balanced pitch brief.
- **Token Alchemy Challenge** — the scored evaluation terminal: business
  cases (Life Sciences drug discovery, FSI fraud detection, and more),
  rack density, storage layer with the WEKA/Alletra judges' note, the
  Track A 5/3/1 rubric, coefficient breakdowns, dollar ROI and a
  five-team leaderboard.
- **Simple view / Full stack explorer** — prompt-to-token teaching and
  the complete tunable physics sandbox (including persistent KV-cache
  context reuse).

Also includes `sharepoint/` — self-contained single-file builds
(`.html`/`.aspx`) for hosting on SharePoint, plus a workshop launcher.

## 3. Original AI infrastructure simulator (`original-simulator/`)

The general-purpose ancestor of the workshop app: model/silicon/network/
cooling/datacenter catalogs, roofline simulation engine, animated
prompt-journey, cost-per-token breakdowns and deep-dive explainers.

## Provenance & accuracy notes

Open-model and vendor-datasheet figures are used where published;
proprietary model sizes, alternative-architecture pricing (Cerebras,
SambaNova) and street prices are labelled estimates. Workshop registry
values follow the judges' workbook; known discrepancies (e.g. the leader
guide's 988 vs 990 GB workspace) are documented in tests. All economics
are illustrative for planning and teaching, not quotes.
