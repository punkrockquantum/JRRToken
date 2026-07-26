/**
 * Workload profiles for the workshop: each use case shapes the token flow
 * differently (prompt-heavy vs output-heavy vs batch-heavy), which moves
 * TTFT, throughput and energy-per-answer in ways the tracks can discuss.
 */

export interface UseCase {
  id: string;
  name: string;
  samplePrompt: string;
  promptTokens: number;
  outputTokens: number;
  batchSize: number;
  description: string;
  flowNote: string;
}

export const USE_CASES: UseCase[] = [
  {
    id: 'copilot',
    name: 'AuraCopilot code assist',
    samplePrompt:
      'Refactor this payment API client to add retry logic with exponential backoff, and explain the changes.',
    promptTokens: 2048,
    outputTokens: 600,
    batchSize: 16,
    description:
      'The scenario workload: developers push code context in, get code and explanation back. Balanced prefill and decode; TTFT is what users feel.',
    flowNote:
      'Balanced flow \u2014 a medium prompt, a medium answer. Energy splits between reading code context (prefill) and writing the fix (decode).',
  },
  {
    id: 'chat',
    name: 'Support chatbot',
    samplePrompt: 'My invoice shows two charges for March \u2014 can you explain why?',
    promptTokens: 300,
    outputTokens: 250,
    batchSize: 48,
    description:
      'Short questions, short answers, huge concurrency. Decode-dominated; batching is the whole economic game.',
    flowNote:
      'Tiny prompts make prefill almost free \u2014 nearly every joule goes to decode. High batch shares each weight-read across 48 users.',
  },
  {
    id: 'rag',
    name: 'RAG document Q&A',
    samplePrompt:
      '[7,000 tokens of retrieved policy documents] Based on these documents, what is our data-retention obligation in Germany?',
    promptTokens: 7000,
    outputTokens: 400,
    batchSize: 16,
    description:
      'Retrieval stuffs the context window with documents \u2014 this is the 8,000-token saturated session from the Track A drill.',
    flowNote:
      'Prefill-dominated \u2014 the model spends most of its energy reading, not writing. This is the workload that fills the KV cache and caps concurrency at 375 sessions.',
  },
  {
    id: 'agent',
    name: 'Agentic workflow',
    samplePrompt:
      'Plan and execute: audit our Kubernetes manifests for security issues, then draft remediation PRs.',
    promptTokens: 4096,
    outputTokens: 2048,
    batchSize: 8,
    description:
      'Agents chain many long generations \u2014 tool calls, plans, reasoning tokens. Output-heavy and the most expensive per request.',
    flowNote:
      'Decode-dominated with long outputs \u2014 thousands of autoregressive loops per request. Watch energy per answer jump versus chat.',
  },
  {
    id: 'batch',
    name: 'Overnight batch summarisation',
    samplePrompt:
      '[6,000-token support transcript] Summarise this conversation for the CRM record.',
    promptTokens: 6000,
    outputTokens: 800,
    batchSize: 64,
    description:
      'Offline throughput work: nobody is watching latency, so batch as deep as memory allows and chase tokens-per-joule.',
    flowNote:
      'Latency does not matter \u2014 batch 64 pushes system throughput and the best energy-per-token of any profile, at the cost of slow individual streams.',
  },
];
