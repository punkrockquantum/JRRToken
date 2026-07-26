# FLUX — AI Workload Planner

A Digital Realty Solution Architecture tool for configuring — and
quantifying — the advantage of a carefully designed data-centre AI
deployment. One self-contained HTML file: no build step, no dependencies,
no backend. Everything runs in the browser.

> Looking for the full teaching suite (the Sharp(er) Enterprises workshop
> simulator and the original prompt-to-tokens simulator)? It lives in
> [fellowship-of-the-token](https://github.com/punkrockquantum/fellowship-of-the-token).

## Run it

```bash
python3 -m http.server 8902     # then open http://127.0.0.1:8902/
```

…or simply double-click `index.html`.

## What FLUX does

You configure a deployment layer by layer; FLUX computes feasibility,
performance, power and economics live, benchmarks the same deployment
against renting it from a NeoCloud, compares every architecture on the
same workload, and recommends the next efficiency to take. Two tabs:

1. **Comprehensive Planner** — the full configuration surface.
2. **Prompt → Token → Value** — an animated journey of a single prompt
   through three DLR sites (LHR19 / ACC4 / SIN10) for demos.

## The configuration surface

### Workload & model

- **Use cases** — presets that configure everything for a realistic
  scenario, all editable afterwards: Life Science drug discovery, FSI
  fraud detection, network-backbone inference, robotics, computer
  vision, manufacturing, self-driving fleet support, a 10 MW+ regional
  training hub, and NeoCloud GPUaaS.
- **Architecture** — NVIDIA (H100, H200, GH200, B100, B200, B300, GB300
  NVL72, DGX Spark, RTX PRO 6000, Vera Rubin NVL144), AMD (MI300X,
  MI325X, MI355X, Helios rack), and alternative architectures as sold at
  market: **Cerebras CS-3** (4-system wafer-scale pods, ~2,000 tok/s per
  stream, 44 GB on-wafer SRAM each) and **SambaNova SN40L** (DataScale
  racks, HBM + DDR tiered memory). VRAM variants per platform.
- **Workload** — inference (context window × concurrent users) or
  training (node count), against a model catalog spanning cloud frontier
  estimates (labelled), emerging models, open weights (Kimi K2,
  DeepSeek-V3, Llama, Qwen, Mistral…) and small/edge models. MoE models
  prefill on active parameters; VRAM holds total weights.
- **KV cache precision** — FP16 (0.330 MB/token) or FP8 (0.165 MB/token).

### Connectivity, switching & routing

- **DLR interconnection** — Cross Connect (~0.5 ms), Metro Connect
  (~2.5 ms waves), ServiceFabric (~8 ms SDN, global), each with its real
  port-speed menu (10G → 800G; 800G ServiceFabric flagged pre-GA).
- **Switching** — Quantum-X800 InfiniBand, Spectrum-X, Cisco Silicon
  One, Cornelis Omni-Path, standard Ethernet — as east-west efficiency.
- **Routing** — adaptive congestion-aware, standard L3, static ECMP.

### Storage & CPU

- **Platforms** — local NVMe, Everpure (all-flash), NetApp (AFF /
  StorageGRID), in object or file mode.
- **KV-cache offload / tiering** — tier cold KV to flash for +25–30%
  effective session budget.
- **KVA — persistent KV cache (prefix reuse)** — the storage layer as a
  performance tier: repeated contexts stream their precomputed KV
  tensors from flash instead of recomputing prefill. Off / 40% / 80%
  cache-hit profiles.
- **GPU-adjacent storage (GPUDirect)** — direct NVMe→GPU path: −10%
  prefill, doubles the KVA streaming path, +3% training throughput.
- **CPU platform** — standard EPYC/Xeon hosts (8 ms dispatch) or
  Blackcore overclocked (3 ms, +12% compute cost).

## The model behind the numbers

- **Sessions per node** = (node VRAM − model weights) ÷ (context ×
  MB/token), optionally boosted by KV offload. Weights = params × 2
  bytes (FP16).
- **Prefill** = linear term (2 FLOPs × active params per token) **plus a
  quadratic attention term** (≈4 × layers × d_model × ctx², calibrated
  to Llama-70B) — the reason a 110k-token prompt takes ~55 s on a single
  H100.
- **KVA warm path** = prompt-KV bytes streamed at ~6 GB/s per GPU shard
  in parallel (deserialize-bound; local NVMe ≈ NFS within ~5%; ×2 with
  GPUDirect) + 90 ms management — never slower than recompute. TTFT is
  blended by the cache-hit rate and reported warm/cold. Calibrated to
  published FSI benchmarks: 110k-token TTFT 54.5 s → 4.0 s (13.6×), with
  the ~10k-token inflection point preserved.
- **TTFT** = interconnect RTT + CPU dispatch + prefill.
- **Economics** = compute ($/GPU-hr own-cost × hosts) + colo power
  ($220/kW-mo at PUE 1.3) + interconnect (per product & port speed) +
  storage services, at 35% utilisation → cost per 1M tokens vs a $3.50
  market reference; the spread is shown as customer value, and the DLR
  share (power + interconnect + storage colo) as value to DLR.
- **Benchmarks** — every plan is compared against renting the same nodes
  from a NeoCloud (illustrative list rates + 10% ancillary) and, for
  training, hyperscaler on-demand/committed rates.
- **Recommendations** — the engine suggests the next efficiency: FP8 KV,
  KV offload, KVA (with the inflection-point warning when it will not
  pay), GPUDirect, Blackcore CPUs, cheaper architectures on the same
  workload, node consolidation, and use-case-specific guidance.

## Accuracy & disclaimers

Vendor-datasheet figures are used where published. Cloud frontier model
sizes, alternative-architecture pricing (Cerebras, SambaNova) and rental
rates are labelled planning estimates. All performance and dollar figures
are an illustrative model for planning and demos — not quotes.
