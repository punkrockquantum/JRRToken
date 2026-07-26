/**
 * Analytical inference-performance model.
 *
 * The model follows the standard roofline reasoning used to size LLM
 * serving systems:
 *
 *  - PREFILL (reading the prompt) is compute-bound: every prompt token
 *    costs ~2 FLOPs per active parameter, and the batch runs them in
 *    parallel, so time = FLOPs / effective TFLOPS.
 *
 *  - DECODE (generating tokens) is memory-bandwidth-bound: every step must
 *    stream all active weights plus the KV cache out of memory, so
 *    time-per-token = bytes moved / bandwidth, plus interconnect latency.
 *
 * Power, cooling and economics are layered on top: cooling capacity caps
 * sustained wattage (thermal throttling), PUE converts IT power into
 * facility power, and the datacenter's tariff and grid mix convert that
 * into cost and carbon.
 */

import type {
  AcceleratorSpec,
  CoolingSpec,
  CpuSpec,
  DatacenterSpec,
  FabricSpec,
  KvPlacement,
  ModelSpec,
  Quantization,
  StorageSpec,
  WanSpec,
} from '../data/types';

export interface SimConfig {
  model: ModelSpec;
  quant: Quantization;
  accelerator: AcceleratorSpec;
  /** Extra GPUs beyond the memory-fit minimum (tensor parallel width). */
  extraGpus: number;
  cpu: CpuSpec;
  storage: StorageSpec;
  kvPlacement: KvPlacement;
  fabric: FabricSpec;
  wan: WanSpec;
  cooling: CoolingSpec;
  datacenter: DatacenterSpec;
  /** GPU power limit as a fraction of TDP (0.5 - 1.0). */
  powerLimitPct: number;
  /** Coolant/air supply setpoint in Celsius (18-45). */
  coolantSetpointC: number;
  /** Concurrent request streams batched together. */
  batchSize: number;
  promptTokens: number;
  outputTokens: number;
  /**
   * Share of requests (0-100) whose context hits a persistent KV cache on
   * the storage layer (vLLM-style prefix caching persisted to NVMe/NFS).
   * A hit replaces the O(n^2) prefill compute with a linear stream of the
   * precomputed tensors from storage.
   */
  kvReusePct?: number;
}

export interface StageTiming {
  id: 'input' | 'tokenize' | 'network' | 'prefill' | 'decode' | 'stream';
  label: string;
  ms: number;
}

export interface CostComponent {
  id: 'energy' | 'compute' | 'fabric' | 'cooling' | 'storage' | 'connectivity' | 'facility';
  label: string;
  usdPer1M: number;
}

export interface SimResult {
  // Sizing
  bytesPerParam: number;
  weightsGB: number;
  kvCacheGB: number;
  minGpus: number;
  gpuCount: number;
  memUsedGB: number;
  memTotalGB: number;
  // Thermal / power
  sustainedWPerGpu: number;
  throttleFactor: number;
  effectiveTflops: number;
  effectiveMemBwTBs: number;
  itPowerKw: number;
  facilityPowerKw: number;
  pue: number;
  // Latency & throughput
  ttftMs: number;
  /** TTFT with no KV-cache hit (full prefill compute). */
  ttftColdMs: number;
  /** TTFT when the prompt's KV tensors stream from persistent storage. */
  ttftWarmMs: number;
  perUserTps: number;
  systemTps: number;
  totalRequestMs: number;
  stages: StageTiming[];
  // Economics
  energyWhPer1kTokens: number;
  costPer1MTokensUSD: number;
  costBreakdown: CostComponent[];
  hardwareCostUSD: number;
  carbonGPer1kTokens: number;
  coldStartS: number;
  warnings: string[];
}

const BYTES_PER_PARAM: Record<Quantization, number> = {
  fp16: 2,
  fp8: 1,
  int4: 0.5,
};

/** Effective read bandwidth for KV cache by placement tier, TB/s per GPU. */
const KV_TIER_BW: Record<KvPlacement, number | null> = {
  hbm: null, // uses the accelerator's own HBM bandwidth
  dram: 0.064, // CPU DRAM over PCIe Gen5 x16
  nvme: 0.014, // GPU-adjacent NVMe via GPUDirect
};

const GB = 1024 ** 3;
const HW_AMORTIZATION_YEARS = 4;

export function simulate(cfg: SimConfig): SimResult {
  const warnings: string[] = [];
  const {
    model,
    accelerator: acc,
    quant,
    cooling,
    datacenter: dc,
    fabric,
    batchSize,
    promptTokens,
    outputTokens,
  } = cfg;

  // ---- Sizing -------------------------------------------------------------
  const bytesPerParam = BYTES_PER_PARAM[quant];
  if (quant === 'fp8' && acc.fp8Tflops === null) {
    warnings.push(
      `${acc.name} has no FP8 tensor units; weights are stored in FP8 but math runs at FP16 rate.`
    );
  }
  const weightsGB = model.totalParamsB * bytesPerParam;

  // KV cache scales with quantization too (typically same precision).
  const kvBytesPerToken = model.kvKBPerToken * 1024 * (bytesPerParam / 2);
  const avgContext = promptTokens + outputTokens / 2;
  const kvCacheGB = (batchSize * (promptTokens + outputTokens) * kvBytesPerToken) / GB;

  const kvInHbm = cfg.kvPlacement === 'hbm';
  const hbmDemandGB = weightsGB * 1.1 + (kvInHbm ? kvCacheGB : 0); // +10% activations
  const minGpus = Math.max(1, Math.ceil(hbmDemandGB / acc.memGB));
  const gpuCount = minGpus + cfg.extraGpus;
  const memTotalGB = gpuCount * acc.memGB;
  const memUsedGB = hbmDemandGB;

  if (minGpus > acc.perNode && fabric.id === 'nvlink5' && acc.perNode < 9) {
    warnings.push(
      `This configuration spans ${minGpus} GPUs but ${acc.name} nodes hold ${acc.perNode}; traffic crosses the scale-out fabric.`
    );
  }

  // ---- Thermals & power ---------------------------------------------------
  // Climate raises effective coolant temperature; a warmer setpoint saves
  // cooling energy but sheds heat-rejection headroom (~1.5%/degC above 25C).
  const setpointPenalty = 1 - Math.max(0, cfg.coolantSetpointC - 25) * 0.015;
  // Self-cooled systems (e.g. wafer-scale with an internal water loop)
  // bring their own heat rejection: facility cooling sets PUE only.
  const coolingCapW = acc.selfCooled
    ? Infinity
    : (cooling.maxWattsPerGpu * setpointPenalty) / dc.climateFactor;
  const powerCapW = acc.tdpW * cfg.powerLimitPct;
  const sustainedWPerGpu = Math.min(powerCapW, coolingCapW);

  // Perf scales sub-linearly with power (DVFS curve): perf ~ (P/TDP)^0.6
  const throttleFactor = Math.min(1, Math.pow(sustainedWPerGpu / acc.tdpW, 0.6));
  if (coolingCapW < powerCapW) {
    warnings.push(
      `${cooling.name} can only reject ${Math.round(coolingCapW)}W per accelerator in this climate — the silicon thermally throttles to ${Math.round(throttleFactor * 100)}% of peak.`
    );
  }
  if (acc.liquidPreferred && (cooling.id === 'air' || cooling.id === 'rdhx')) {
    warnings.push(`${acc.name} is designed for direct liquid cooling.`);
  }

  const rackKw = (Math.min(gpuCount, acc.perNode) * sustainedWPerGpu * 1.35) / 1000;
  if (rackKw > cooling.maxKwPerRack) {
    warnings.push(
      `Rack density ${rackKw.toFixed(0)}kW exceeds the ${cooling.maxKwPerRack}kW limit of ${cooling.name}; deployment must spread across more racks.`
    );
  }

  // Cooler setpoints cost more cooling energy; hot climates amplify PUE.
  const setpointPueBonus = (cfg.coolantSetpointC - 25) * -0.004;
  const pue = Math.max(
    1.03,
    1 + (cooling.pue - 1) * dc.climateFactor + setpointPueBonus
  );

  // ---- Effective silicon capability ---------------------------------------
  const rawTflops =
    quant === 'fp8' && acc.fp8Tflops !== null
      ? acc.fp8Tflops
      : quant === 'int4' && acc.fp8Tflops !== null
        ? acc.fp8Tflops // int4 weights typically dequantised to fp8/fp16 math
        : acc.fp16Tflops;

  const fabricEff = Math.max(0.45, 1 - fabric.overheadPerGpu * (gpuCount - 1));
  const effectiveTflops =
    rawTflops * gpuCount * acc.baseMfu * fabricEff * throttleFactor;
  // Bandwidth degrades less with throttling than compute does.
  const effectiveMemBwTBs =
    acc.memBwTBs * gpuCount * fabricEff * Math.min(1, throttleFactor + 0.25);

  // ---- Prefill (compute-bound) --------------------------------------------
  // Linear term: 2 FLOPs per active parameter per token. Quadratic term:
  // attention scores/values cost ~4 x (layers x d_model) x n^2; layers x
  // d_model is approximated as 9,360 x activeParamsB (exact for Llama-70B:
  // 80 x 8192). The quadratic term is why 100k-token prompts take ~a minute
  // on a single GPU (calibrates to published FSI long-context baselines).
  const LD_PER_ACTIVE_B = 9360;
  const prefillFlops =
    2 * model.activeParamsB * 1e9 * promptTokens +
    4 * LD_PER_ACTIVE_B * model.activeParamsB * promptTokens * promptTokens;
  const prefillColdMs = prefillFlops / (effectiveTflops * 1e12) / 1e-3;

  // ---- Persistent KV cache on the storage layer (prefix reuse) ------------
  // A cache hit streams the prompt's precomputed KV tensors from storage
  // instead of recomputing them. Streaming is deserialize-bound: local NVMe
  // and fast network storage perform within ~5% of each other, so the
  // effective rate is capped rather than using raw array bandwidth.
  const KV_STREAM_CAP_GBS = 6;
  // Fixed cache-management cost (hash lookup, scheduler dispatch, tensor
  // placement) — this is why published benchmarks show only ~1.2x gains
  // below the ~10k-token inflection point.
  const KV_CACHE_OVERHEAD_MS = 90;
  const kvReuse = Math.min(100, Math.max(0, cfg.kvReusePct ?? 0)) / 100;
  const kvPromptBytes = promptTokens * kvBytesPerToken;
  const kvStreamGBs = Math.min(cfg.storage.gbPerSec, KV_STREAM_CAP_GBS);
  const prefillWarmMs = Math.min(
    prefillColdMs,
    (kvPromptBytes / (kvStreamGBs * 1e9)) * 1000 +
      cfg.storage.firstByteMs +
      KV_CACHE_OVERHEAD_MS
  );
  const prefillMs = (1 - kvReuse) * prefillColdMs + kvReuse * prefillWarmMs;
  if (kvReuse > 0 && prefillWarmMs < prefillColdMs * 0.8) {
    warnings.push(
      `Persistent KV cache: ${Math.round(kvReuse * 100)}% of requests skip prefill compute and stream ${(kvPromptBytes / 1e9).toFixed(1)} GB of cached tensors from ${cfg.storage.name.toLowerCase()} instead \u2014 warm TTFT ${prefillWarmMs < 1000 ? `${prefillWarmMs.toFixed(0)} ms` : `${(prefillWarmMs / 1000).toFixed(1)} s`} vs ${prefillColdMs < 1000 ? `${prefillColdMs.toFixed(0)} ms` : `${(prefillColdMs / 1000).toFixed(1)} s`} cold.`
    );
  }

  // ---- Decode (bandwidth-bound) --------------------------------------------
  const weightBytes = model.activeParamsB * 1e9 * bytesPerParam;
  const weightReadMs = weightBytes / (effectiveMemBwTBs * 1e12) * 1e3;

  const kvBw = kvInHbm
    ? effectiveMemBwTBs
    : (KV_TIER_BW[cfg.kvPlacement] as number) * gpuCount;
  const kvBytesPerStream = avgContext * kvBytesPerToken;
  const kvReadMs = (batchSize * kvBytesPerStream) / (kvBw * 1e12) * 1e3;
  if (!kvInHbm) {
    warnings.push(
      `KV cache lives in ${cfg.kvPlacement === 'dram' ? 'host DRAM' : 'NVMe'} — every generated token re-reads the conversation state over a much slower path.`
    );
  } else if (kvCacheGB > memTotalGB - weightsGB * 1.1) {
    warnings.push(
      `KV cache (${kvCacheGB.toFixed(0)}GB) does not fit in the HBM left over after weights — reduce batch, context, or add GPUs.`
    );
  }

  const computePerStepMs =
    (batchSize * 2 * model.activeParamsB * 1e9) / (effectiveTflops * 1e12) * 1e3;
  const fabricStepMs = (fabric.stepLatencyUs / 1000) * Math.log2(Math.max(2, gpuCount));

  const stepMs = weightReadMs + kvReadMs + computePerStepMs + fabricStepMs;
  const perUserTps = 1000 / stepMs;
  const systemTps = batchSize * perUserTps;

  // ---- End-to-end latency ---------------------------------------------------
  const tokenizeMs = cfg.cpu.hostOverheadMs;
  const networkMs = dc.baseRttMs + cfg.wan.addedRttMs;
  const ttftMs = networkMs + tokenizeMs + prefillMs + stepMs;
  const ttftColdMs = networkMs + tokenizeMs + prefillColdMs + stepMs;
  const ttftWarmMs = networkMs + tokenizeMs + prefillWarmMs + stepMs;
  const decodeMs = outputTokens * stepMs;
  const totalRequestMs = ttftMs + decodeMs;

  const stages: StageTiming[] = [
    { id: 'input', label: 'Prompt entered', ms: 0 },
    { id: 'tokenize', label: 'Tokenise & schedule (CPU)', ms: tokenizeMs },
    { id: 'network', label: 'Network to datacenter', ms: networkMs },
    {
      id: 'prefill',
      label:
        kvReuse > 0
          ? `Prefill (${Math.round(kvReuse * 100)}% KV-cache hits)`
          : 'Prefill (read prompt)',
      ms: prefillMs,
    },
    { id: 'decode', label: 'Decode (generate tokens)', ms: decodeMs },
    { id: 'stream', label: 'Stream back to user', ms: cfg.wan.addedRttMs / 2 },
  ];

  // ---- Power & economics -----------------------------------------------------
  const hostW = cfg.cpu.tdpW * Math.ceil(gpuCount / acc.perNode);
  const itPowerKw =
    (gpuCount * sustainedWPerGpu * 1.15 + hostW) * (1 + cfg.storage.powerShare) / 1000;
  const facilityPowerKw = itPowerKw * pue;

  const energyWhPer1kTokens = (facilityPowerKw * 1000) / systemTps / 3.6;
  const carbonGPer1kTokens = (energyWhPer1kTokens / 1000) * dc.gridCarbon;

  // Cost per 1M tokens, itemised so every configuration choice has a
  // visible coefficient. Capex is amortised to a per-second rate, then
  // divided by system throughput.
  const per1M = (usdPerSecond: number) => (usdPerSecond / systemTps) * 1e6;
  const SECONDS_4Y = HW_AMORTIZATION_YEARS * 365 * 24 * 3600;
  const SECONDS_10Y = 10 * 365 * 24 * 3600;
  const SECONDS_MONTH = 30 * 24 * 3600;

  // IT energy at the campus tariff (cooling's share of PUE is listed under cooling).
  const energyPer1M = per1M((itPowerKw * dc.usdPerKwh) / 3600);
  // Accelerators plus chassis/host share, 4-year life.
  const hardwareCostUSD = gpuCount * acc.priceUSD;
  const computePer1M = per1M((hardwareCostUSD * 1.35) / SECONDS_4Y);
  // Cluster fabric: NICs, switches, cabling (already integrated in NVL72 racks).
  const fabricCapex =
    acc.id === 'nvidia-gb200' && fabric.id === 'nvlink5'
      ? 0
      : fabric.costPerGpuUSD * gpuCount;
  const fabricPer1M = per1M(fabricCapex / SECONDS_4Y);
  // Cooling = plant capex (10y) + the PUE overhead energy it burns.
  const coolingPer1M = per1M(
    (cooling.capexPerKwUSD * itPowerKw) / SECONDS_10Y +
      ((facilityPowerKw - itPowerKw) * dc.usdPerKwh) / 3600
  );
  // Weights kept on the selected tier (model + one warm copy).
  const storagePer1M = per1M(
    (weightsGB * 2 * cfg.storage.usdPerGBMonth) / SECONDS_MONTH
  );
  const connectivityPer1M = per1M(cfg.wan.monthlyUSD / SECONDS_MONTH);
  // Colocation space/infrastructure fee at the campus rate.
  const facilityPer1M = per1M((dc.coloUsdPerKwMonth * itPowerKw) / SECONDS_MONTH);

  const costBreakdown: CostComponent[] = [
    { id: 'energy', label: 'IT energy', usdPer1M: energyPer1M },
    { id: 'compute', label: 'Compute hardware', usdPer1M: computePer1M },
    { id: 'fabric', label: 'Network fabric', usdPer1M: fabricPer1M },
    { id: 'cooling', label: 'Cooling (plant + overhead energy)', usdPer1M: coolingPer1M },
    { id: 'facility', label: 'Facility / colocation', usdPer1M: facilityPer1M },
    { id: 'storage', label: 'Weight storage', usdPer1M: storagePer1M },
    { id: 'connectivity', label: 'Connectivity', usdPer1M: connectivityPer1M },
  ];
  const costPer1MTokensUSD = costBreakdown.reduce((a, c) => a + c.usdPer1M, 0);

  const coldStartS = weightsGB / cfg.storage.gbPerSec + cfg.storage.firstByteMs / 1000;

  return {
    bytesPerParam,
    weightsGB,
    kvCacheGB,
    minGpus,
    gpuCount,
    memUsedGB,
    memTotalGB,
    sustainedWPerGpu,
    throttleFactor,
    effectiveTflops,
    effectiveMemBwTBs,
    itPowerKw,
    facilityPowerKw,
    pue,
    ttftMs,
    ttftColdMs,
    ttftWarmMs,
    perUserTps,
    systemTps,
    totalRequestMs,
    stages,
    energyWhPer1kTokens,
    costPer1MTokensUSD,
    costBreakdown,
    hardwareCostUSD,
    carbonGPer1kTokens,
    coldStartS,
    warnings,
  };
}
