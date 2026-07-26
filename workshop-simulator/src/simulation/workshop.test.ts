import { describe, expect, it } from 'vitest';
import { ACCELERATORS } from '../data/accelerators';
import { DATACENTERS } from '../data/infrastructure';
import { MODELS } from '../data/models';
import { PLATFORMS } from '../data/platforms';
import { USE_CASES } from '../data/useCases';
import {
  financials,
  leaseSubtotal,
  regionMrc,
  WORKSHOP_OPTIONS,
  WORKSHOP_REGIONS,
} from '../data/workshop';

/**
 * Pins the workshop scenario numbers from the Sharp(er) Enterprises
 * Track A guide: Llama 3.3 70B at native FP16 must yield ~0.33 MB/token
 * KV cache, ~140 GB weights, ~1,130 GB node VRAM on H200, ~990 GB
 * headroom, and a 375-session cap at 8,000 tokens per session.
 */
describe('AuraCopilot workshop scenario', () => {
  const llama = MODELS.find((m) => m.id === 'llama-3.3-70b')!;
  const h200 = ACCELERATORS.find((a) => a.id === 'nvidia-h200')!;

  it('KV cache is ~0.33 MB per token at FP16', () => {
    const mbPerToken = llama.kvKBPerToken / 1000; // FP16 baseline
    expect(mbPerToken).toBeGreaterThan(0.31);
    expect(mbPerToken).toBeLessThan(0.34);
  });

  it('a saturated 8,000-token session locks ~2.64 GB', () => {
    const gb = (8000 * llama.kvKBPerToken) / 1e6;
    expect(gb).toBeGreaterThan(2.5);
    expect(gb).toBeLessThan(2.7);
  });

  it('weights are ~140 GB at FP16 and node headroom supports ~375 sessions', () => {
    const weightsGB = llama.totalParamsB * 2;
    expect(weightsGB).toBeGreaterThan(138);
    expect(weightsGB).toBeLessThan(145);
    const nodeGB = h200.perNode * h200.memGB; // 1128 =~ scenario's 1,130
    const headroom = nodeGB - 140;
    const cap = Math.floor(headroom / 2.64);
    expect(cap).toBeGreaterThanOrEqual(370);
    expect(cap).toBeLessThanOrEqual(378);
  });

  it('all three scenario hubs exist with the leasing-matrix rates', () => {
    const rate = (id: string) =>
      DATACENTERS.find((d) => d.id === id)!.coloUsdPerKwMonth;
    expect(rate('iad')).toBe(310);
    expect(rate('fra')).toBe(360);
    expect(rate('nrt')).toBe(314);
  });
});

describe('alternative architectures: SambaNova and Cerebras', () => {
  it('Cerebras CS-3 and SambaNova SN40L exist with full market rack platforms', () => {
    const cs3 = ACCELERATORS.find((a) => a.id === 'cerebras-cs3')!;
    expect(cs3.vendor).toBe('Cerebras');
    expect(cs3.selfCooled).toBe(true);
    expect(cs3.perNode).toBe(4); // 4-system inference pod
    expect(ACCELERATORS.some((a) => a.id === 'sambanova-sn40l')).toBe(true);
  });

  it('wafer-scale trades concurrency for per-stream speed vs a GPU node', async () => {
    const { PLATFORMS } = await import('../data/platforms');
    const cs3Platform = PLATFORMS.find((p) => p.id === 'cerebras-cs3')!;
    const snPlatform = PLATFORMS.find((p) => p.id === 'sambanova-datascale')!;
    expect(cs3Platform.overridesAccelerator).toBe(true);
    expect(snPlatform.overridesAccelerator).toBe(true);
    // Physics comparison on identical Llama 3.3 70B FP16 workloads.
    const { evaluate } = await import('../game/judge');
    const base = {
      team: 'Red' as const,
      platformId: 'hpe-xd670',
      accelId: 'nvidia-h200',
      nodesPerRegion: 2,
      fabricId: 'ib-ndr',
      storageId: 'parallel-fs',
      dcId: 'iad',
      coolingId: 'dlc',
      businessCaseId: 'fraudfsi',
      rackDensityId: 'standard',
      kvMbPerToken: 0.33,
      concurrencyTarget: 1500,
      breakEvenMonth: 19,
    };
    const h200 = evaluate(base);
    const cs3 = evaluate({ ...base, accelId: 'cerebras-cs3', concurrencyTarget: 60 });
    // Much faster per stream...
    expect(cs3.sim.perUserTps).toBeGreaterThan(h200.sim.perUserTps * 5);
    // ...but far fewer concurrent sessions fit in on-wafer memory.
    expect(cs3.derived.sessionCap).toBeLessThan(h200.derived.sessionCap / 10);
    // And the facility cooling choice cannot throttle a self-cooled system.
    const cs3Air = evaluate({ ...base, accelId: 'cerebras-cs3', coolingId: 'air' });
    expect(cs3Air.sim.throttleFactor).toBe(1);
  });

  it('Intel and AMD host CPUs are selectable in submissions', async () => {
    const { evaluate } = await import('../game/judge');
    const base = {
      team: 'Red' as const,
      platformId: 'hpe-xd670',
      accelId: 'nvidia-h200',
      nodesPerRegion: 2,
      fabricId: 'ib-ndr',
      storageId: 'parallel-fs',
      dcId: 'iad',
      coolingId: 'rdhx',
      businessCaseId: 'fraudfsi',
      rackDensityId: 'standard',
      kvMbPerToken: 0.33,
      concurrencyTarget: 1500,
      breakEvenMonth: 19,
    };
    const intel = evaluate({ ...base, cpuId: 'intel-xeon-6980p' });
    const amd = evaluate({ ...base, cpuId: 'amd-epyc-9575f' });
    // Both run; the faster hosts shave TTFT vs the reference Xeon 8592+.
    const reference = evaluate(base);
    expect(intel.sim.ttftMs).toBeLessThan(reference.sim.ttftMs);
    expect(amd.sim.ttftMs).toBeLessThan(reference.sim.ttftMs);
  });
});

describe('platform and use-case catalogs', () => {
  it('offers the HPE XD670 AI Factory and a Dell PowerEdge alternative', () => {
    const hpe = PLATFORMS.find((p) => p.id === 'hpe-xd670')!;
    const dell = PLATFORMS.find((p) => p.id === 'dell-xe9680')!;
    expect(hpe.registryAligned).toBe(true);
    expect(hpe.fabricId).toBe('ib-ndr'); // doc: NDR InfiniBand compute fabric
    expect(hpe.chassis).toContain('XD670');
    expect(hpe.storageArray).toContain('WEKA');
    expect(hpe.gpusPerNode).toBe(8);
    expect(dell.registryAligned).toBe(false);
    expect(dell.chassis).toContain('XE9680');
  });

  it('use cases span prefill-heavy to decode-heavy token flows', () => {
    const rag = USE_CASES.find((u) => u.id === 'rag')!;
    const agent = USE_CASES.find((u) => u.id === 'agent')!;
    const chat = USE_CASES.find((u) => u.id === 'chat')!;
    expect(rag.promptTokens).toBeGreaterThan(rag.outputTokens * 10);
    expect(agent.outputTokens).toBeGreaterThan(chat.outputTokens * 4);
    expect(new Set(USE_CASES.map((u) => u.id)).size).toBe(USE_CASES.length);
  });
});

describe('Track C leasing matrix matches the judges key', () => {
  const opt = (n: number) => WORKSHOP_OPTIONS.find((o) => o.n === n)!;
  const region = (id: string) => WORKSHOP_REGIONS.find((r) => r.id === id)!;

  it('Option 1: 45 kW rows and $44,280 subtotal', () => {
    expect(regionMrc(opt(1), region('amer'))).toBe(13950);
    expect(regionMrc(opt(1), region('emea'))).toBe(16200);
    expect(regionMrc(opt(1), region('apac'))).toBe(14130);
    expect(leaseSubtotal(opt(1))).toBe(44280);
  });

  it('Option 2: 75 kW rows and $73,800 subtotal', () => {
    expect(regionMrc(opt(2), region('amer'))).toBe(23250);
    expect(regionMrc(opt(2), region('emea'))).toBe(27000);
    expect(regionMrc(opt(2), region('apac'))).toBe(23550);
    expect(leaseSubtotal(opt(2))).toBe(73800);
  });

  it('Option 3: 30 kW rows and $29,520 subtotal', () => {
    expect(regionMrc(opt(3), region('amer'))).toBe(9300);
    expect(regionMrc(opt(3), region('emea'))).toBe(10800);
    expect(regionMrc(opt(3), region('apac'))).toBe(9420);
    expect(leaseSubtotal(opt(3))).toBe(29520);
  });
});

describe('Track E financial maths match the judges key', () => {
  const opt = (n: number) => WORKSHOP_OPTIONS.find((o) => o.n === n)!;

  it('Option 1: $69,280 flat rate, $831,360 year 1, break-even 34.56 -> Month 38', () => {
    const f = financials(opt(1));
    expect(f.opexMonthly).toBe(69280);
    expect(f.year1Opex).toBe(831360);
    expect(f.depreciationMonthly).toBeCloseTo(66666.67, 1);
    expect(f.trueMonthlyWeight).toBeCloseTo(135946.67, 1);
    expect(f.nakedBreakEvenMonths).toBeCloseTo(34.57, 2);
    expect(f.paddedBreakEvenMonth).toBe(38);
  });

  // Note: the judges' PDF prints "$98,280" for Option 2's flat rate, but its
  // own components ($73,800 + $25,000) and its own Year 1 total
  // ($1,185,600 = $98,800 x 12) both give $98,800 — the PDF figure is a typo.
  it('Option 2: $98,800 flat rate (doc typo says 98,280), $1,185,600 year 1 -> Month 52', () => {
    const f = financials(opt(2));
    expect(f.opexMonthly).toBe(98800);
    expect(f.year1Opex).toBe(1185600);
    expect(f.nakedBreakEvenMonths).toBeCloseTo(52.2, 1);
    expect(f.paddedBreakEvenMonth).toBe(52);
  });

  it('Option 3: $54,520 flat rate, $654,240 year 1, break-even 26.82 -> Month 29', () => {
    const f = financials(opt(3));
    expect(f.opexMonthly).toBe(54520);
    expect(f.year1Opex).toBe(654240);
    expect(f.nakedBreakEvenMonths).toBeCloseTo(26.82, 2);
    expect(f.paddedBreakEvenMonth).toBe(29);
  });
});
