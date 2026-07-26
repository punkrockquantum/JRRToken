/**
 * Shared catalog types for the AI infrastructure simulator.
 *
 * All figures are drawn from public vendor datasheets where available.
 * Anything not publicly disclosed (e.g. proprietary model sizes, street
 * prices) is flagged with `estimated: true` and should be read as a
 * representative industry estimate, not vendor-confirmed data.
 */

export type Quantization = 'fp16' | 'fp8' | 'int4';

export interface ModelSpec {
  id: string;
  vendor: string;
  name: string;
  /** Total parameter count, billions. */
  totalParamsB: number;
  /** Parameters active per token (== total for dense models), billions. */
  activeParamsB: number;
  /** KV-cache footprint per token at FP16, kilobytes. */
  kvKBPerToken: number;
  /** Maximum context window, tokens. */
  contextWindow: number;
  architecture: 'dense' | 'moe';
  openWeights: boolean;
  /** True when parameter counts are undisclosed industry estimates. */
  estimated: boolean;
  blurb: string;
}

export interface AcceleratorSpec {
  id: string;
  vendor: 'NVIDIA' | 'AMD' | 'SambaNova' | 'Cerebras';
  name: string;
  memGB: number;
  /** HBM / on-package memory bandwidth, TB/s. */
  memBwTBs: number;
  /** Dense FP16/BF16 tensor throughput, TFLOPS. */
  fp16Tflops: number;
  /** Dense FP8 tensor throughput, TFLOPS (null when unsupported). */
  fp8Tflops: number | null;
  tdpW: number;
  /** Typical accelerators per server node. */
  perNode: number;
  /** Achievable model FLOPs utilisation for LLM inference (0-1). */
  baseMfu: number;
  /** Representative street price per unit, USD. */
  priceUSD: number;
  priceEstimated: boolean;
  /** Requires direct liquid cooling to hit full TDP. */
  liquidPreferred: boolean;
  /** System ships with integrated cooling (e.g. wafer-scale internal water
   *  loop); the facility cooling choice sets PUE but cannot throttle it. */
  selfCooled?: boolean;
  blurb: string;
}

export interface CpuSpec {
  id: string;
  vendor: string;
  name: string;
  cores: number;
  tdpW: number;
  /** Host-side overhead added per request (tokenise, schedule, batch), ms. */
  hostOverheadMs: number;
  blurb: string;
}

export interface StorageSpec {
  id: string;
  name: string;
  /** Effective sustained read throughput to GPU memory, GB/s. */
  gbPerSec: number;
  /** First-byte latency, ms. */
  firstByteMs: number;
  /** Power overhead as a share of IT load. */
  powerShare: number;
  /** Effective monthly cost per GB stored (amortised for owned tiers). */
  usdPerGBMonth: number;
  blurb: string;
}

export type KvPlacement = 'hbm' | 'dram' | 'nvme';

export interface FabricSpec {
  id: string;
  vendor: string;
  name: string;
  /** Per-GPU interconnect bandwidth, GB/s. */
  gbPerSec: number;
  /** Throughput lost per additional GPU in a tensor-parallel group. */
  overheadPerGpu: number;
  /** Collective-op latency contribution per decode step, microseconds. */
  stepLatencyUs: number;
  /** Capex per GPU for NICs, switches and cabling, USD. */
  costPerGpuUSD: number;
  blurb: string;
}

export interface WanSpec {
  id: string;
  name: string;
  /** Round-trip added between user and datacenter, ms (regional user). */
  addedRttMs: number;
  jitterMs: number;
  /** Monthly connectivity cost for the deployment, USD. */
  monthlyUSD: number;
  blurb: string;
}

export interface CoolingSpec {
  id: string;
  name: string;
  /** Sustained heat rejection per accelerator, watts. */
  maxWattsPerGpu: number;
  /** Partial PUE contribution of this cooling approach. */
  pue: number;
  maxKwPerRack: number;
  /** Cooling plant capex per kW of IT load, USD (amortised over 10y). */
  capexPerKwUSD: number;
  blurb: string;
}

export interface DatacenterSpec {
  id: string;
  /** Digital Realty campus / facility label. */
  name: string;
  metro: string;
  region: string;
  /** Grid carbon intensity, gCO2e per kWh (representative annual avg). */
  gridCarbon: number;
  /** Industrial electricity price, USD per kWh (representative). */
  usdPerKwh: number;
  renewablePct: number;
  /** Climate multiplier on PUE (hot/humid > 1, cool < 1). */
  climateFactor: number;
  /** Baseline RTT from a user in the same region, ms. */
  baseRttMs: number;
  /** Colocation price per kW of IT load per month, USD (representative). */
  coloUsdPerKwMonth: number;
  blurb: string;
}
