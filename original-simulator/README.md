# Prompt → Compute → Tokens

An interactive simulator of the AI inference stack. It animates the full
journey of a prompt — tokenisation, the network hop into a Digital Realty
datacenter, prefill and decode on real accelerator silicon, and the token
stream back to the user — and lets you tune every layer to see how the
physics changes tokenomics, time-to-first-token (TTFT) and efficiency.

Built for people who know nothing about AI infrastructure: the top level
just shows words becoming tokens; expandable "Dive deeper" layers explain
the memory-bandwidth roofline, the power/cooling chain, network paths,
cold starts and cost-per-token economics.

## Two views

- **Simple view** (default) — build your own prompt and follow it through
  one frontier model (DeepSeek-V3, whose architecture is fully published).
  A progress stepper tracks five stages: words become tokens, tokens become
  meaning (embeddings, with the man/woman-king/queen geometry picture), the
  neural network (an animated weights-and-biases neuron plus a
  training-vs-inference explainer), the next-token prediction loop (top-5
  probability race, with a note on how reasoning models spend extra loops
  on hidden thinking tokens), and the streamed answer with a growing
  context/KV-cache bar and real speed/energy stats. The response text is
  composed in the browser and clearly labelled as a simulation — no real
  model runs.
- **Full stack explorer** — the complete infrastructure sandbox described
  below. All variables live in collapsible drawers on the left; results
  update live on the right.

## What you can tune

| Layer | Options |
| --- | --- |
| Model & weights | DeepSeek-V3/R1, Kimi K2, Qwen3-235B, Qwen2.5-72B, Mistral Large 2 & Small 3, OpenAI gpt-oss-120b, plus labelled estimates for GPT-4o- and Claude-class proprietary models |
| Precision | FP16 / FP8 / INT4 quantization |
| Silicon | NVIDIA A100, H100, H200, B200, GB200 NVL72; AMD MI300X, MI325X; SambaNova SN40L |
| Host CPU | Intel Xeon (Emerald Rapids), AMD EPYC (Genoa, Turin), NVIDIA Grace |
| Storage | Object (S3-class), parallel filesystem, GPU-adjacent NVMe; KV-cache placement in HBM / host DRAM / NVMe |
| Network | InfiniBand NDR, 400G RoCEv2, NVLink 5 domain; user path via public internet, Digital Realty ServiceFabric, or same-campus cross-connect |
| Datacenter | Digital Realty campuses and sites — Ashburn, Hillsboro, Dallas, Frankfurt, LHR19 (London), CPH3 (Copenhagen), AMS11 (Amsterdam), IAH10 (Houston), JFK10 (New York), SIN11 (Singapore) — plus an on-premises/self-hosted option (grid carbon, tariff, colo rate, climate) |
| Cooling & power | Air, rear-door heat exchanger (RDHx), direct liquid, immersion; GPU power limits; coolant setpoint |
| Workload | Prompt length, answer length, batch size (concurrent users) |

## How the simulation works

A roofline-style analytical model (`src/simulation/engine.ts`):

- **Prefill is compute-bound** — prompt tokens × 2 FLOPs per active
  parameter, divided by effective TFLOPS (dense datasheet numbers ×
  utilisation × interconnect efficiency × thermal throttle).
- **Decode is bandwidth-bound** — each token streams all active weights
  plus the KV cache from memory; step time = bytes / bandwidth + fabric
  sync latency. Batching shares the weight-read across users.
- **Thermals** — cooling capacity (adjusted for climate and coolant
  setpoint) caps sustained wattage; performance follows a sub-linear
  DVFS curve, so power caps cost less speed than they save energy.
- **Economics** — facility power = IT power × PUE; cost per million
  tokens = grid energy at the campus tariff + hardware amortised over
  4 years; carbon uses regional grid intensity.

Accelerator and open-model figures come from public datasheets and papers.
Proprietary model sizes and street prices are **labelled estimates** — the
tool is educational, not a benchmark.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # simulation-engine tests (vitest)
npm run build    # production build
```

No backend, no API keys — the whole simulation runs in the browser.

## Publishing to SharePoint (or any single-file host)

```bash
npm run build:sharepoint
```

This produces `sharepoint/ai-infra-simulator.html` and an identical
`.aspx` copy — one self-contained file with all JavaScript, CSS and the
favicon inlined, no external requests. Upload either file to a SharePoint
document library (e.g. Site Assets) and share its link. If your tenant
force-downloads `.html` files instead of rendering them, use the `.aspx`
copy, which classic document libraries render in the browser.
`sharepoint/ai-infra-simulator-sharepoint.zip` contains both.
