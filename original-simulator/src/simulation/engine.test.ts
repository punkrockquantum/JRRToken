import { describe, expect, it } from 'vitest';
import { ACCELERATORS } from '../data/accelerators';
import {
  COOLING,
  CPUS,
  DATACENTERS,
  FABRICS,
  STORAGE,
  WAN,
} from '../data/infrastructure';
import { MODELS } from '../data/models';
import { simulate, type SimConfig } from './engine';

const byId = <T extends { id: string }>(arr: T[], id: string): T => {
  const found = arr.find((x) => x.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

const baseConfig = (): SimConfig => ({
  model: byId(MODELS, 'qwen2.5-72b'),
  quant: 'fp16',
  accelerator: byId(ACCELERATORS, 'nvidia-h100'),
  extraGpus: 0,
  cpu: byId(CPUS, 'intel-xeon-8592'),
  storage: byId(STORAGE, 'local-nvme'),
  kvPlacement: 'hbm',
  fabric: byId(FABRICS, 'ib-ndr'),
  wan: byId(WAN, 'servicefabric'),
  cooling: byId(COOLING, 'dlc'),
  datacenter: byId(DATACENTERS, 'iad'),
  powerLimitPct: 1,
  coolantSetpointC: 25,
  batchSize: 1,
  promptTokens: 512,
  outputTokens: 512,
});

describe('sizing', () => {
  it('computes weights size from quantization', () => {
    const r = simulate(baseConfig());
    expect(r.weightsGB).toBeCloseTo(72.7 * 2, 1);
    const r8 = simulate({ ...baseConfig(), quant: 'fp8' });
    expect(r8.weightsGB).toBeCloseTo(72.7, 1);
  });

  it('requires enough GPUs to hold the model', () => {
    const r = simulate(baseConfig()); // ~160GB on 80GB GPUs => >= 2
    expect(r.minGpus).toBeGreaterThanOrEqual(2);
    expect(r.memTotalGB).toBeGreaterThanOrEqual(r.memUsedGB);
  });
});

describe('performance realism', () => {
  it('72B dense FP16 on H100s decodes in a plausible band', () => {
    const r = simulate(baseConfig());
    // Real-world single-stream numbers for 72B/TP2-4 land ~15-60 tok/s.
    expect(r.perUserTps).toBeGreaterThan(10);
    expect(r.perUserTps).toBeLessThan(90);
    expect(r.ttftMs).toBeGreaterThan(20);
    expect(r.ttftMs).toBeLessThan(2000);
  });

  it('quantization to fp8 speeds up decode', () => {
    const fp16 = simulate(baseConfig());
    const fp8 = simulate({ ...baseConfig(), quant: 'fp8' });
    expect(fp8.perUserTps).toBeGreaterThan(fp16.perUserTps);
  });

  it('MoE models decode faster than dense models of similar total size', () => {
    const dense = simulate({
      ...baseConfig(),
      model: byId(MODELS, 'mistral-large-2'),
      quant: 'fp8',
    });
    const moe = simulate({
      ...baseConfig(),
      model: byId(MODELS, 'gpt-oss-120b'),
      quant: 'fp8',
    });
    expect(moe.perUserTps).toBeGreaterThan(dense.perUserTps * 2);
  });

  it('batching raises system throughput but slows each stream', () => {
    const b1 = simulate(baseConfig());
    const b16 = simulate({ ...baseConfig(), batchSize: 16 });
    expect(b16.systemTps).toBeGreaterThan(b1.systemTps * 4);
    expect(b16.perUserTps).toBeLessThan(b1.perUserTps);
  });

  it('offloading KV cache to NVMe collapses decode speed', () => {
    const hbm = simulate(baseConfig());
    const nvme = simulate({ ...baseConfig(), kvPlacement: 'nvme' });
    expect(nvme.perUserTps).toBeLessThan(hbm.perUserTps / 2);
    expect(nvme.warnings.length).toBeGreaterThan(0);
  });
});

describe('thermals and power', () => {
  it('air cooling throttles a 700W GPU', () => {
    const air = simulate({ ...baseConfig(), cooling: byId(COOLING, 'air') });
    expect(air.throttleFactor).toBeLessThan(1);
    expect(air.warnings.join(' ')).toMatch(/throttle/i);
    const dlc = simulate(baseConfig());
    expect(dlc.throttleFactor).toBe(1);
    expect(air.perUserTps).toBeLessThan(dlc.perUserTps);
  });

  it('power limiting cuts performance sub-linearly', () => {
    const full = simulate(baseConfig());
    const capped = simulate({ ...baseConfig(), powerLimitPct: 0.7 });
    expect(capped.perUserTps).toBeLessThan(full.perUserTps);
    // 70% power should keep well over 70% of perf (the efficiency argument).
    expect(capped.perUserTps).toBeGreaterThan(full.perUserTps * 0.7);
    expect(capped.facilityPowerKw).toBeLessThan(full.facilityPowerKw);
  });

  it('immersion beats air on PUE; hot climates make both worse', () => {
    const airSin = simulate({
      ...baseConfig(),
      cooling: byId(COOLING, 'air'),
      datacenter: byId(DATACENTERS, 'sin11'),
    });
    const airPdx = simulate({
      ...baseConfig(),
      cooling: byId(COOLING, 'air'),
      datacenter: byId(DATACENTERS, 'pdx'),
    });
    const immersionSin = simulate({
      ...baseConfig(),
      cooling: byId(COOLING, 'immersion'),
      datacenter: byId(DATACENTERS, 'sin11'),
    });
    expect(airSin.pue).toBeGreaterThan(airPdx.pue);
    expect(immersionSin.pue).toBeLessThan(airSin.pue);
  });
});

describe('economics and cold start', () => {
  it('produces sane cost per million tokens', () => {
    const r = simulate({ ...baseConfig(), batchSize: 32, quant: 'fp8' });
    // Well-batched open-model serving lands roughly $0.05-$5 per 1M tokens.
    expect(r.costPer1MTokensUSD).toBeGreaterThan(0.01);
    expect(r.costPer1MTokensUSD).toBeLessThan(20);
    // Breakdown components must sum to the headline number.
    const sum = r.costBreakdown.reduce((a, c) => a + c.usdPer1M, 0);
    expect(sum).toBeCloseTo(r.costPer1MTokensUSD, 6);
  });

  it('newer silicon is cheaper per token when properly cooled', () => {
    const h100 = simulate({
      ...baseConfig(),
      model: byId(MODELS, 'deepseek-v3'),
      quant: 'fp8',
      accelerator: byId(ACCELERATORS, 'nvidia-h100'),
      batchSize: 8,
    });
    const b200 = simulate({
      ...baseConfig(),
      model: byId(MODELS, 'deepseek-v3'),
      quant: 'fp8',
      accelerator: byId(ACCELERATORS, 'nvidia-b200'),
      batchSize: 8,
    });
    expect(b200.costPer1MTokensUSD).toBeLessThan(h100.costPer1MTokensUSD);
  });

  it('fabric choice moves cost per token', () => {
    const roce = simulate({ ...baseConfig(), fabric: byId(FABRICS, 'roce-400') });
    const nvlink = simulate({ ...baseConfig(), fabric: byId(FABRICS, 'nvlink5') });
    expect(roce.costPer1MTokensUSD).not.toBeCloseTo(nvlink.costPer1MTokensUSD, 3);
    expect(nvlink.costPer1MTokensUSD).toBeLessThan(roce.costPer1MTokensUSD);
  });

  it('cooling choice moves cost per token', () => {
    const air = simulate({ ...baseConfig(), cooling: byId(COOLING, 'air') });
    const dlc = simulate(baseConfig());
    expect(air.costPer1MTokensUSD).not.toBeCloseTo(dlc.costPer1MTokensUSD, 3);
  });

  it('connectivity and storage choices appear in the breakdown', () => {
    const r = simulate(baseConfig());
    const ids = r.costBreakdown.map((c) => c.id);
    expect(ids).toContain('connectivity');
    expect(ids).toContain('storage');
    expect(ids).toContain('fabric');
    expect(ids).toContain('cooling');
    expect(ids).toContain('facility');
  });

  it('object storage makes cold starts dramatically slower than NVMe', () => {
    const nvme = simulate(baseConfig());
    const object = simulate({ ...baseConfig(), storage: byId(STORAGE, 'object') });
    expect(object.coldStartS).toBeGreaterThan(nvme.coldStartS * 10);
  });

  it('on-prem gives the lowest latency but a pricier facility line', () => {
    const colo = simulate(baseConfig()); // Ashburn + ServiceFabric
    const onprem = simulate({
      ...baseConfig(),
      datacenter: byId(DATACENTERS, 'onprem'),
      wan: byId(WAN, 'direct-connect'),
    });
    expect(onprem.ttftMs).toBeLessThan(colo.ttftMs);
    const facility = (r: typeof colo) =>
      r.costBreakdown.find((c) => c.id === 'facility')!.usdPer1M;
    expect(facility(onprem)).toBeGreaterThan(facility(colo));
  });

  it('network path changes TTFT but not tokens/sec', () => {
    const priv = simulate(baseConfig());
    const pub = simulate({ ...baseConfig(), wan: byId(WAN, 'public-internet') });
    expect(pub.ttftMs).toBeGreaterThan(priv.ttftMs);
    expect(pub.perUserTps).toBeCloseTo(priv.perUserTps, 5);
  });
});
