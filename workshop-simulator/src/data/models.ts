import type { ModelSpec } from './types';

/**
 * Model catalog.
 *
 * Open-weight models use published architecture figures. Proprietary models
 * (Anthropic, OpenAI flagship) have undisclosed sizes; entries marked
 * `estimated` use widely-cited industry estimates so the simulator stays
 * illustrative rather than authoritative for those rows.
 *
 * kvKBPerToken = 2 (K+V) x layers x kv_heads x head_dim x 2 bytes (FP16),
 * or the published MLA/compressed figure where applicable.
 */
export const MODELS: ModelSpec[] = [
  {
    id: 'llama-3.3-70b',
    vendor: 'Meta',
    name: 'Llama 3.3 70B',
    totalParamsB: 70.6,
    activeParamsB: 70.6,
    // GQA: 2 x 80 layers x 8 kv-heads x 128 dim x 2B = 320 KiB (~0.33 MB)
    kvKBPerToken: 320,
    contextWindow: 131072,
    architecture: 'dense',
    openWeights: true,
    estimated: false,
    blurb:
      'Meta\u2019s dense open-weights workhorse \u2014 the AuraCopilot scenario model. At native FP16 its weights occupy ~140 GB, and its KV cache costs ~0.33 MB per token: the two numbers the whole Track A drill hangs on.',
  },
  {
    id: 'deepseek-v3',
    vendor: 'DeepSeek',
    name: 'DeepSeek-V3 / R1',
    totalParamsB: 671,
    activeParamsB: 37,
    // MLA latent KV: ~(512+64) dims x 61 layers x 2 bytes
    kvKBPerToken: 70,
    contextWindow: 131072,
    architecture: 'moe',
    openWeights: true,
    estimated: false,
    blurb:
      '671B-parameter Mixture-of-Experts where only 37B parameters fire per token. Its Multi-head Latent Attention compresses the KV cache ~10x versus standard attention.',
  },
  {
    id: 'kimi-k2',
    vendor: 'Moonshot (Kimi)',
    name: 'Kimi K2',
    totalParamsB: 1043,
    activeParamsB: 32,
    kvKBPerToken: 70,
    contextWindow: 131072,
    architecture: 'moe',
    openWeights: true,
    estimated: false,
    blurb:
      'A 1-trillion-parameter open-weights MoE (32B active per token) built on the DeepSeek-V3 architecture with more experts. Huge to store, cheap per token to run.',
  },
  {
    id: 'qwen3-235b',
    vendor: 'Alibaba (Qwen)',
    name: 'Qwen3-235B-A22B',
    totalParamsB: 235,
    activeParamsB: 22,
    // GQA: 2 x 94 layers x 4 kv-heads x 128 dim x 2B
    kvKBPerToken: 188,
    contextWindow: 131072,
    architecture: 'moe',
    openWeights: true,
    estimated: false,
    blurb:
      'Qwen3 flagship MoE: 235B total, 22B active. A strong open model that fits (quantised) on a single 8-GPU node.',
  },
  {
    id: 'qwen2.5-72b',
    vendor: 'Alibaba (Qwen)',
    name: 'Qwen2.5-72B',
    totalParamsB: 72.7,
    activeParamsB: 72.7,
    // 2 x 80 layers x 8 kv-heads x 128 dim x 2B
    kvKBPerToken: 320,
    contextWindow: 131072,
    architecture: 'dense',
    openWeights: true,
    estimated: false,
    blurb:
      'A classic dense 72B model: every one of its 72.7B parameters is read for every token, so it is memory-bandwidth-hungry per token compared with MoE designs.',
  },
  {
    id: 'mistral-large-2',
    vendor: 'Mistral AI',
    name: 'Mistral Large 2 (123B)',
    totalParamsB: 123,
    activeParamsB: 123,
    // 2 x 88 layers x 8 kv-heads x 128 dim x 2B
    kvKBPerToken: 352,
    contextWindow: 131072,
    architecture: 'dense',
    openWeights: true,
    estimated: false,
    blurb:
      'Mistral\u2019s 123B dense flagship. Dense models trade higher per-token cost for simpler serving and very predictable latency.',
  },
  {
    id: 'mistral-small-24b',
    vendor: 'Mistral AI',
    name: 'Mistral Small 3 (24B)',
    totalParamsB: 24,
    activeParamsB: 24,
    // 2 x 40 layers x 8 kv-heads x 128 dim x 2B
    kvKBPerToken: 160,
    contextWindow: 32768,
    architecture: 'dense',
    openWeights: true,
    estimated: false,
    blurb:
      'A compact 24B dense model. Great for showing how a small model turns the same hardware into far more tokens per second.',
  },
  {
    id: 'gpt-oss-120b',
    vendor: 'OpenAI',
    name: 'gpt-oss-120b',
    totalParamsB: 117,
    activeParamsB: 5.1,
    // GQA: 36 layers x 8 kv-heads x 64 dim x 2 x 2B
    kvKBPerToken: 72,
    contextWindow: 131072,
    architecture: 'moe',
    openWeights: true,
    estimated: false,
    blurb:
      'OpenAI\u2019s open-weights MoE: 117B total but only 5.1B active per token. Ships MXFP4-quantised so it fits on a single 80GB GPU.',
  },
  {
    id: 'gpt-4o-class',
    vendor: 'OpenAI',
    name: 'GPT-4o class (est.)',
    totalParamsB: 200,
    activeParamsB: 55,
    kvKBPerToken: 200,
    contextWindow: 128000,
    architecture: 'moe',
    openWeights: false,
    estimated: true,
    blurb:
      'OpenAI does not disclose GPT-4o\u2019s size. This entry uses a commonly cited estimate (~200B MoE) purely to make the simulation illustrative.',
  },
  {
    id: 'claude-sonnet-class',
    vendor: 'Anthropic',
    name: 'Claude Sonnet class (est.)',
    totalParamsB: 400,
    activeParamsB: 70,
    kvKBPerToken: 220,
    contextWindow: 200000,
    architecture: 'moe',
    openWeights: false,
    estimated: true,
    blurb:
      'Anthropic does not disclose Claude\u2019s architecture. This uses an industry estimate of a large sparse model with a 200k context window, for illustration only.',
  },
  {
    id: 'claude-haiku-class',
    vendor: 'Anthropic',
    name: 'Claude Haiku class (est.)',
    totalParamsB: 60,
    activeParamsB: 20,
    kvKBPerToken: 120,
    contextWindow: 200000,
    architecture: 'moe',
    openWeights: false,
    estimated: true,
    blurb:
      'A stand-in for Anthropic\u2019s fast tier, using an industry estimate. Shows how the "small fast model" end of a vendor line-up behaves.',
  },
];
