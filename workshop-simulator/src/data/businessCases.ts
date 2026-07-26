/**
 * Business cases for the Token Alchemy Challenge. Each case reshapes the
 * judging: workload profile, latency SLA, capacity target, what a token is
 * worth, realistic utilisation, and how heavily each scoring category
 * counts. There is deliberately no single architecture that wins them all.
 */

export interface CategoryWeights {
  memory: number;
  energy: number;
  performance: number;
  facility: number;
  economics: number;
}

export interface BusinessCase {
  id: string;
  name: string;
  blurb: string;
  // Workload shape
  promptTokens: number;
  outputTokens: number;
  batchSize: number;
  /** Saturated session context (prompt + generation + history) used for the
   *  KV-cache concurrency math — this is what makes the "right" worksheet
   *  answer different per business case. */
  sessionContextTokens: number;
  // Targets
  ttftTargetMs: number;
  tokensPerDayTargetM: number; // per hub, millions
  // Value & load
  revenuePer1M: number; // USD the business earns/saves per 1M tokens served
  utilization: number; // 0-1 realistic average load
  /** Share of requests (0-100) whose context repeats and can hit a
   *  persistent KV cache on the storage layer (prefix reuse). */
  contextReusePct: number;
  weights: CategoryWeights;
}

export const BUSINESS_CASES: BusinessCase[] = [
  {
    id: 'wearables',
    name: 'Wearables',
    blurb:
      'Voice assistants on watches and glasses: millions of tiny exchanges, brutal latency expectations, and battery-brand sensitivity to energy. Efficiency is marketing here.',
    promptTokens: 128,
    outputTokens: 80,
    batchSize: 64,
    sessionContextTokens: 512,
    ttftTargetMs: 80,
    tokensPerDayTargetM: 20,
    revenuePer1M: 2.5,
    utilization: 0.3,
    contextReusePct: 60,
    weights: { memory: 1, energy: 1.5, performance: 1.3, facility: 0.8, economics: 1 },
  },
  {
    id: 'vehicles',
    name: 'Connected vehicles',
    blurb:
      'In-car copilots and fleet telemetry: safety-adjacent latency budgets, regional presence non-negotiable. TTFT is the whole product experience.',
    promptTokens: 512,
    outputTokens: 128,
    batchSize: 48,
    sessionContextTokens: 1024,
    ttftTargetMs: 60,
    tokensPerDayTargetM: 40,
    revenuePer1M: 4,
    utilization: 0.4,
    contextReusePct: 50,
    weights: { memory: 0.8, energy: 1, performance: 1.5, facility: 1, economics: 0.8 },
  },
  {
    id: 'lifesci',
    name: 'EnterpriseAI \u2014 Life Sciences (drug discovery)',
    blurb:
      'Literature mining and hypothesis generation across papers, patents and trial data. Multi-document RAG makes contexts enormous and answers long and analytical; latency is tolerant (scientists wait seconds), but the KV cache per session is huge and crushes per-node concurrency. A single validated target justifies the fleet, so token value is the highest on the board.',
    promptTokens: 10000,
    outputTokens: 1500,
    batchSize: 16,
    sessionContextTokens: 12000,
    ttftTargetMs: 800,
    tokensPerDayTargetM: 60,
    revenuePer1M: 14,
    utilization: 0.55,
    contextReusePct: 80,
    weights: { memory: 1.4, energy: 0.9, performance: 1.2, facility: 0.9, economics: 0.8 },
  },
  {
    id: 'fraudfsi',
    name: 'EnterpriseAI \u2014 Financial Services (retail bank fraud detection)',
    blurb:
      'Real-time transaction screening: a compact structured context (transaction, account history, device signals) and a tiny decision-with-rationale output \u2014 but it sits inside the card-authorization window, so TTFT is a hard, regulatory-grade SLO measured in tens of milliseconds. Small batches protect the tail latency; the KV footprint per session is tiny, so nodes carry thousands of concurrent screens.',
    promptTokens: 1500,
    outputTokens: 150,
    batchSize: 12,
    sessionContextTokens: 2000,
    ttftTargetMs: 50,
    tokensPerDayTargetM: 120,
    revenuePer1M: 10,
    utilization: 0.65,
    contextReusePct: 40,
    weights: { memory: 1.0, energy: 0.8, performance: 1.6, facility: 1.0, economics: 1.1 },
  },
  {
    id: 'b2c',
    name: 'B2C consumer app',
    blurb:
      'Ad-supported consumer chat: enormous volume, thin margins, users tolerate a beat of latency but never an outage. Cost per token is survival.',
    promptTokens: 400,
    outputTokens: 300,
    batchSize: 64,
    sessionContextTokens: 1024,
    ttftTargetMs: 150,
    tokensPerDayTargetM: 150,
    revenuePer1M: 1.2,
    utilization: 0.6,
    contextReusePct: 50,
    weights: { memory: 1.2, energy: 1, performance: 1, facility: 0.8, economics: 1.5 },
  },
  {
    id: 'iaas',
    name: 'IaaS token wholesale',
    blurb:
      'Selling inference by the million tokens: your customers benchmark you against every API on the market. $/1M and fleet efficiency are the product.',
    promptTokens: 1500,
    outputTokens: 700,
    batchSize: 48,
    sessionContextTokens: 4096,
    ttftTargetMs: 200,
    tokensPerDayTargetM: 250,
    revenuePer1M: 1.5,
    utilization: 0.7,
    contextReusePct: 25,
    weights: { memory: 1, energy: 1.2, performance: 1.2, facility: 1, economics: 1.5 },
  },
  {
    id: 'frontier',
    name: 'Frontier lab',
    blurb:
      'Research batch generation: nobody watches TTFT, everybody watches tokens per day and joules per token. Facilities engineering is the moat.',
    promptTokens: 6000,
    outputTokens: 1500,
    batchSize: 64,
    sessionContextTokens: 8000,
    ttftTargetMs: 1500,
    tokensPerDayTargetM: 400,
    revenuePer1M: 1.0,
    utilization: 0.85,
    contextReusePct: 5,
    weights: { memory: 0.7, energy: 1.3, performance: 1.5, facility: 1.2, economics: 0.7 },
  },
];

export interface RackDensity {
  id: string;
  name: string;
  nodesPerRack: number;
  note: string;
}

/** Monthly space fee per rack (representative wholesale colo). */
export const RACK_SPACE_USD_MONTH = 950;

export const RACK_DENSITIES: RackDensity[] = [
  {
    id: 'low',
    name: 'Low density — 1 node/rack',
    nodesPerRack: 1,
    note: 'Easy airflow, works with basic cooling — but every rack is a monthly space bill.',
  },
  {
    id: 'standard',
    name: 'Standard — 2 nodes/rack',
    nodesPerRack: 2,
    note: 'The XD670 reference design point (~18 kW/rack).',
  },
  {
    id: 'high',
    name: 'High density — 4 nodes/rack',
    nodesPerRack: 4,
    note: 'Half the racks, half the space cost — if and only if the cooling can reject ~40 kW per rack.',
  },
];
