/**
 * Explainer option catalogs — three choices per aspect, with the middle
 * option pinned to the Token Section Leader guide's scenario numbers
 * (140 GB weights, 0.330 MB/token, 8,000-token spike, 1,130 GB chassis,
 * 375 users, sub-100ms TTFT, 100M tokens/day/hub).
 */

export interface Opt {
  label: string;
  sub: string;
  value: number;
}

export interface PerfOpt extends Opt {
  tflops: number; // effective compute for the hardware choice
  bwGBs: number; // effective memory bandwidth, GB/s
}

export const WEIGHTS: Opt[] = [
  { label: 'Small model', sub: '8B params — 16 GB', value: 16 },
  { label: 'Llama 3.3 70B', sub: 'the scenario — 140 GB', value: 140 },
  { label: 'Frontier dense', sub: '405B params — 810 GB', value: 810 },
];

export const KV: Opt[] = [
  { label: 'Old rule-of-thumb', sub: '0.044 MB/token — the trap', value: 0.044 },
  { label: 'Quantized KV', sub: '0.165 MB/token — banned (Rule 1)', value: 0.165 },
  { label: 'Native FP16', sub: '0.330 MB/token — the truth', value: 0.33 },
];

export const CONTEXT: Opt[] = [
  { label: 'Quick chat', sub: '2,000 tokens', value: 2000 },
  { label: 'Working session', sub: 'the scenario — 8,000 tokens', value: 8000 },
  { label: 'Deep research', sub: '32,000 tokens', value: 32000 },
];

export const HARDWARE: PerfOpt[] = [
  { label: 'Single GPU', sub: 'H200 — 141 GB', value: 141, tflops: 310, bwGBs: 3800 },
  { label: '8-GPU node', sub: 'the scenario — 1,130 GB', value: 1130, tflops: 2500, bwGBs: 30000 },
  { label: 'Two nodes', sub: '16 GPUs — 2,260 GB', value: 2260, tflops: 5000, bwGBs: 60000 },
];

export const USERS: Opt[] = [
  { label: 'Pilot team', sub: '50 users', value: 50 },
  { label: 'Department', sub: '375 users — the drill', value: 375 },
  { label: 'Whole company', sub: '2,000 users', value: 2000 },
];

export const TTFT: Opt[] = [
  { label: 'Real-time', sub: '50 ms — fraud screening', value: 50 },
  { label: 'Interactive', sub: 'the scenario — 100 ms', value: 100 },
  { label: 'Patient', sub: '1,000 ms — research', value: 1000 },
];

export const TOKENS_DAY: Opt[] = [
  { label: 'Modest', sub: '20M tokens/day', value: 20 },
  { label: 'Scenario hub', sub: '100M tokens/day', value: 100 },
  { label: 'Hyperscale', sub: '400M tokens/day', value: 400 },
];

