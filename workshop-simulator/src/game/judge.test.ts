import { describe, expect, it } from 'vitest';
import { bandFor, evaluate, type Submission } from './judge';

const base = (over: Partial<Submission> = {}): Submission => ({
  team: 'Red',
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
  ...over,
});

describe('Token Alchemy Challenge architecture evaluation', () => {
  it('reproduces the registry 375 cap for 8,000-token sessions (frontier case)', () => {
    const ev = evaluate(
      base({ businessCaseId: 'frontier', concurrencyTarget: 375 })
    );
    expect(ev.derived.sessionCap).toBe(375);
    const memory = ev.categories.find((c) => c.id === 'memory')!;
    expect(memory.points).toBe(20);
  });

  it('session caps are case-accurate: 12k RAG contexts vs 2k fraud contexts', () => {
    // Life sciences: 12,000 x 0.330 MB = 3.96 GB/session -> 990/3.96 = 250.
    const lifesci = evaluate(base({ businessCaseId: 'lifesci', concurrencyTarget: 250 }));
    expect(lifesci.derived.sessionCap).toBe(250);
    expect(lifesci.categories.find((c) => c.id === 'memory')!.points).toBe(20);
    // Fraud: 2,000 x 0.330 MB = 0.66 GB/session -> 990/0.66 = 1,500.
    const fraud = evaluate(base());
    expect(fraud.derived.sessionCap).toBe(1500);
    expect(fraud.categories.find((c) => c.id === 'memory')!.points).toBe(20);
  });

  it('the two enterprise verticals judge to their real dependencies', () => {
    const lifesci = evaluate(base({ businessCaseId: 'lifesci', concurrencyTarget: 250 }));
    const fraud = evaluate(base());
    // Fraud sits in the card-authorization window: 50 ms SLO; drug discovery
    // tolerates 800 ms for multi-document analysis.
    expect(fraud.categories.find((c) => c.id === 'performance')!.detail).toContain('50 ms');
    expect(lifesci.categories.find((c) => c.id === 'performance')!.detail).toContain('800 ms');
    // The same hardware misses the fraud SLO harder than the lifesci one.
    const ttftMs = (ev: typeof fraud) => ev.sim.ttftMs;
    expect(ttftMs(fraud)).toBeGreaterThan(50);
    expect(ttftMs(lifesci)).toBeGreaterThan(ttftMs(fraud)); // 10k prefill >> 1.5k prefill
    // Long-context prefill makes lifesci TTFT larger, yet it can still pass
    // its own looser target while fraud fails its tighter one.
    const perfPts = (ev: typeof fraud) =>
      ev.categories.find((c) => c.id === 'performance')!.points;
    expect(perfPts(lifesci)).toBeGreaterThanOrEqual(perfPts(fraud));
  });

  it('never crashes or disqualifies: overshoot queues, scores rubric 1, keeps playing', () => {
    const ev = evaluate(base({ concurrencyTarget: 2000 }));
    const memory = ev.categories.find((c) => c.id === 'memory')!;
    expect(ev.rubricLevel).toBe(1); // guide: no active memory buffer
    expect(memory.points).toBeLessThan(20);
    expect(memory.detail).toContain('admission control');
    expect(memory.detail).toContain('Rubric 1');
    expect(memory.detail).not.toMatch(/disqualif/i);
    expect(ev.total).toBeGreaterThan(0);
  });

  it('under-provisioning with correct KV density is Proficient, framed as waste', () => {
    const ev = evaluate(base({ concurrencyTarget: 600 }));
    const memory = ev.categories.find((c) => c.id === 'memory')!;
    expect(ev.rubricLevel).toBe(3);
    expect(memory.points).toBeLessThan(20);
    expect(memory.detail).toContain('idle');
  });

  it('rubric 5: exact 0.330 MB/token and the exact cap earn Excellent', () => {
    const ev = evaluate(base()); // kv 0.33, cap 1500 = exact for fraud case
    expect(ev.rubricLevel).toBe(5);
    expect(ev.rubricLabel).toBe('Excellent');
    expect(ev.categories.find((c) => c.id === 'memory')!.points).toBe(20);
    expect(ev.critique).toContain('5/5');
  });

  it('rubric 3: the outdated 0.044 rule-of-thumb scores Proficient at best', () => {
    // Guide: generic flat industry estimates for KV density -> Score 3,
    // even if their concurrency number happens to be sane.
    const ev = evaluate(base({ kvMbPerToken: 0.044, concurrencyTarget: 1400 }));
    expect(ev.rubricLevel).toBe(3);
    expect(ev.categories.find((c) => c.id === 'memory')!.detail).toContain(
      'generic industry estimate'
    );
  });

  it('rubric 1: quantized KV math violates Rule 1', () => {
    // 0.165 MB/token is FP8 KV density - exactly half of native FP16.
    const ev = evaluate(base({ kvMbPerToken: 0.165, concurrencyTarget: 1500 }));
    expect(ev.rubricLevel).toBe(1);
    expect(ev.rubricLabel).toBe('Deficient');
    expect(ev.categories.find((c) => c.id === 'memory')!.detail).toContain('Rule 1');
  });

  it('scores all five day-job categories with business-case weighting to 100', () => {
    const ev = evaluate(base());
    expect(ev.categories.map((c) => c.id)).toEqual([
      'memory',
      'energy',
      'performance',
      'facility',
      'economics',
    ]);
    for (const c of ev.categories) {
      expect(c.max).toBe(20);
      expect(c.points).toBeGreaterThanOrEqual(0);
      expect(c.points).toBeLessThanOrEqual(20);
      expect(c.weight).toBeGreaterThan(0);
    }
    const earned = ev.categories.reduce((a, c) => a + c.points * c.weight, 0);
    const max = ev.categories.reduce((a, c) => a + c.max * c.weight, 0);
    expect(ev.total).toBe(Math.round((earned / max) * 100));
    expect(ev.total).toBeLessThanOrEqual(100);
  });

  it('business case changes the judging: targets, value and outcome all move', () => {
    const vehicles = evaluate(base({ businessCaseId: 'vehicles' }));
    const frontier = evaluate(base({ businessCaseId: 'frontier' }));
    // Case-specific SLAs appear in the performance judging.
    expect(
      vehicles.categories.find((c) => c.id === 'performance')!.detail
    ).toContain('60 ms');
    expect(
      frontier.categories.find((c) => c.id === 'performance')!.detail
    ).toContain('1500 ms');
    // Business value differs: frontier sells more tokens at higher utilisation.
    expect(frontier.derived.tokensSoldPerMonth).toBeGreaterThan(
      vehicles.derived.tokensSoldPerMonth
    );
    expect(frontier.derived.revenueMonthly).not.toBeCloseTo(
      vehicles.derived.revenueMonthly,
      0
    );
    // The outcome statement names the business case.
    expect(frontier.outcome.statement).toContain('Frontier lab');
    expect(vehicles.outcome.statement).toContain('Connected vehicles');
    // Category weights differ between cases.
    const wOf = (ev: typeof vehicles, id: string) =>
      ev.categories.find((c) => c.id === id)!.weight;
    expect(wOf(vehicles, 'performance')).not.toBe(wOf(frontier, 'economics'));
  });

  it('rack density trades space cost against cooling feasibility', () => {
    // High density on RDHx (~50 kW limit) with ~9 kW H200 nodes still fits,
    // but high density with 4 nodes needs fewer racks -> cheaper space.
    const low = evaluate(base({ rackDensityId: 'low', nodesPerRegion: 4 }));
    const high = evaluate(base({ rackDensityId: 'high', nodesPerRegion: 4 }));
    expect(low.derived.racksPerRegion).toBeGreaterThan(high.derived.racksPerRegion);
    expect(low.derived.opexMonthly).toBeGreaterThan(high.derived.opexMonthly);
    // But high density under weak air cooling breaks the rack limit.
    const highAir = evaluate(
      base({ rackDensityId: 'high', nodesPerRegion: 4, coolingId: 'air' })
    );
    const fac = (ev: typeof low) => ev.categories.find((c) => c.id === 'facility')!;
    expect(fac(highAir).points).toBeLessThan(fac(high).points);
    expect(fac(highAir).detail).toContain('exceeds the cooling limit');
  });

  it('a lean build can beat a heavy build in a thin-margin business case', () => {
    // B2C at $1.20/1M: premium H200 fleet vs cheaper MI300X fleet.
    const premium = evaluate(base({ businessCaseId: 'b2c' }));
    const lean = evaluate(base({ businessCaseId: 'b2c', accelId: 'amd-mi300x' }));
    expect(lean.derived.capexGlobal).toBeLessThan(premium.derived.capexGlobal);
    // The lean build reaches business ROI sooner (or at all).
    const roiOf = (ev: typeof lean) => ev.outcome.roiMonth ?? 999;
    expect(roiOf(lean)).toBeLessThanOrEqual(roiOf(premium));
  });

  it('watts-into-tokens rewards efficient cooling and penalises throttled designs', () => {
    const dlc = evaluate(base({ coolingId: 'dlc' }));
    const air = evaluate(base({ coolingId: 'air' }));
    const e = (ev: typeof dlc) => ev.categories.find((c) => c.id === 'energy')!.points;
    const f = (ev: typeof dlc) => ev.categories.find((c) => c.id === 'facility')!.points;
    expect(e(dlc) + f(dlc)).toBeGreaterThan(e(air) + f(air));
    expect(air.sim.throttleFactor).toBeLessThan(1);
  });

  it('facility category reflects rack density limits', () => {
    const ev = evaluate(base({ accelId: 'nvidia-b200', coolingId: 'air' }));
    const fac = ev.categories.find((c) => c.id === 'facility')!;
    expect(fac.points).toBeLessThan(20);
    expect(fac.detail).toMatch(/rack/i);
  });

  it('economics scores the break-even for the submitted design, not a fixed answer', () => {
    const good = evaluate(base());
    const padded = good.derived.paddedBreakEven!;
    const exact = evaluate(base({ breakEvenMonth: padded }));
    const off = evaluate(base({ breakEvenMonth: padded + 4 }));
    const econ = (ev: typeof good) => ev.categories.find((c) => c.id === 'economics')!.points;
    expect(econ(exact)).toBeGreaterThan(econ(off));
  });

  it('location moves the economics and energy scores', () => {
    const cheap = evaluate(base({ dcId: 'iad' }));
    const pricey = evaluate(base({ dcId: 'fra' }));
    expect(cheap.derived.opexMonthly).toBeLessThan(pricey.derived.opexMonthly);
  });

  it('exposes every formula with plugged-in coefficients and dollar ROI', () => {
    const ev = evaluate(base());
    expect(ev.formulas.length).toBeGreaterThanOrEqual(7);
    const all = ev.formulas.join('\n');
    expect(all).toContain('Session cap');
    expect(all).toContain('0.330 MB/token');
    expect(all).toContain('J/token');
    expect(all).toContain('CapEx');
    expect(all).toContain('OpEx');
    expect(all).toContain('ROI');
    expect(ev.derived.roiPct).toBeGreaterThan(0);
    expect(ev.derived.net60).toBeCloseTo(
      ev.derived.savingsMonthly * 60 - ev.derived.capexGlobal,
      2
    );
  });

  it('accepts WEKA and Alletra-class storage as equals, per the judges note', () => {
    const weka = evaluate(base({ storageId: 'parallel-fs' }));
    const alletra = evaluate(base({ storageId: 'nvme-array' }));
    // Same memory/performance/facility scores — the judged categories don't
    // punish either valid storage answer.
    for (const id of ['memory', 'performance', 'facility'] as const) {
      expect(alletra.categories.find((c) => c.id === id)!.points).toBe(
        weka.categories.find((c) => c.id === id)!.points
      );
    }
    // But the physics still differs where it should: cold-start speed.
    expect(alletra.derived.coldStartS).toBeGreaterThan(weka.derived.coldStartS);
  });

  it('object storage shows its cold-start cost', () => {
    const obj = evaluate(base({ storageId: 'object' }));
    const weka = evaluate(base({ storageId: 'parallel-fs' }));
    expect(obj.derived.coldStartS).toBeGreaterThan(weka.derived.coldStartS * 5);
  });

  it('final bucket reports time to ROI and cumulative profit/loss', () => {
    const ev = evaluate(base());
    const { outcome } = ev;
    // Timeline covers the 60-month hardware life and is monotonic.
    expect(outcome.timeline.map((p) => p.month)).toEqual([12, 24, 36, 48, 60]);
    for (let i = 1; i < outcome.timeline.length; i++) {
      expect(outcome.timeline[i].cumulativeUSD).toBeGreaterThan(
        outcome.timeline[i - 1].cumulativeUSD
      );
    }
    // Final point equals the 60-month business-lens net position.
    const expected60 = ev.derived.netCashMonthly * 60 - ev.derived.capexGlobal;
    expect(outcome.timeline[4].cumulativeUSD).toBeCloseTo(expected60, 2);
    expect(outcome.profit60).toBeCloseTo(expected60, 2);
    // Base H200 design is profitable: ROI month within life, calendar label set.
    expect(outcome.roiMonth).not.toBeNull();
    expect(outcome.roiMonth!).toBeLessThanOrEqual(60);
    expect(outcome.roiCalendar).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
    expect(outcome.statement).toContain(`Month ${outcome.roiMonth}`);
    expect(outcome.statement).toContain('profit');
  });

  it('verdict bands cover the score range', () => {
    expect(bandFor(90)).toContain('BOARD-READY');
    expect(bandFor(75)).toContain('STRONG');
    expect(bandFor(55)).toContain('VIABLE');
    expect(bandFor(30)).toContain('WHITEBOARD');
  });
});
