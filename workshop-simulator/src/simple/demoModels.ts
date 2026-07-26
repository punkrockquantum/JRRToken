/**
 * Architecture details for the simple-view demonstration models — the
 * numbers the visualisation animates (layer count, heads, experts, hidden
 * size, vocabulary). Open-weight entries use published figures; the
 * Anthropic entry is flagged `estimated` because the architecture is not
 * disclosed.
 *
 * `modelId` links to the main model catalog for parameter counts, KV size
 * and the performance simulation.
 */

export interface DemoSpec {
  id: string;
  vendor: string;
  modelId: string;
  /** Transformer layer count. */
  layers: number;
  /** Attention heads per layer. */
  heads: number;
  /** Residual / embedding dimension (numbers per token). */
  dModel: number;
  /** Routed experts per layer; null for dense models. */
  expertsTotal: number | null;
  /** Routed experts activated per token. */
  expertsActive: number;
  /** Always-on shared experts. */
  sharedExperts: number;
  /** Vocabulary size, tokens. */
  vocab: number;
  estimated: boolean;
}

export const DEMO_MODELS: DemoSpec[] = [
  {
    id: 'deepseek',
    vendor: 'DeepSeek',
    modelId: 'deepseek-v3',
    layers: 61,
    heads: 128,
    dModel: 7168,
    expertsTotal: 256,
    expertsActive: 8,
    sharedExperts: 1,
    vocab: 128000,
    estimated: false,
  },
  {
    id: 'mistral',
    vendor: 'Mistral',
    modelId: 'mistral-large-2',
    layers: 88,
    heads: 96,
    dModel: 12288,
    expertsTotal: null,
    expertsActive: 0,
    sharedExperts: 0,
    vocab: 32768,
    estimated: false,
  },
  {
    id: 'openai',
    vendor: 'OpenAI',
    modelId: 'gpt-oss-120b',
    layers: 36,
    heads: 64,
    dModel: 2880,
    expertsTotal: 128,
    expertsActive: 4,
    sharedExperts: 0,
    vocab: 201088,
    estimated: false,
  },
  {
    id: 'anthropic',
    vendor: 'Anthropic',
    modelId: 'claude-sonnet-class',
    layers: 72,
    heads: 96,
    dModel: 8192,
    expertsTotal: 128,
    expertsActive: 8,
    sharedExperts: 0,
    vocab: 65000,
    estimated: true,
  },
];
