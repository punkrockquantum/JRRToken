# FLUX — AI Workload Planner

A Digital Realty Solution Architecture tool for configuring the advantages
of carefully designed data-centre deployments: architecture, model and
connectivity planning across NVIDIA / AMD / Cerebras / SambaNova platforms
with DLR interconnection (Cross Connect / Metro Connect / ServiceFabric),
switching, routing, storage and CPU options — including KVA persistent
KV-cache modelling on the storage layer. Economics are an illustrative
model, not quotes.

## Run it

Single self-contained file, no build step and no dependencies:

```bash
python3 -m http.server 8902
# open http://127.0.0.1:8902/
```

or simply open `index.html` in a browser.

## What's modelled

- NVIDIA (H100 → Vera Rubin) and AMD (MI300X → Helios) platforms, plus
  alternative architectures as sold at market: Cerebras CS-3 4-system pods
  and SambaNova SN40L DataScale racks (estimates).
- Prefill with the quadratic attention term (Llama-70B-calibrated) — the
  reason 100k-token prompts take ~a minute on a single GPU.
- KVA persistent KV cache on external flash: cache hits stream prompt KV
  tensors (~6 GB/s per GPU shard, ×2 with GPUDirect) instead of
  recomputing prefill; calibrated to published FSI benchmarks (110k-token
  TTFT 54.5 s → 4.0 s).
- DLR interconnection products, switching/routing efficiency, storage
  platforms, KV offload/tiering, GPUDirect, overclocked CPU hosts, and a
  NeoCloud GPUaaS benchmark for every plan.
