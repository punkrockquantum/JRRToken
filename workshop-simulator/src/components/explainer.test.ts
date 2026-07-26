import { describe, expect, it } from 'vitest';
import { SCENARIO } from '../data/workshop';
import {
  CONTEXT,
  HARDWARE,
  KV,
  TOKENS_DAY,
  TTFT,
  USERS,
  WEIGHTS,
} from '../data/explainerOptions';

/**
 * Pins the Explainer's option catalogs to the Token Section Leader guide.
 * The middle ("scenario") option of every aspect must be the brief's
 * stated number, and the drill derivation must reproduce the official
 * answers exactly: 0.330 MB/token x 8,000 tokens = 2.64 GB/session;
 * (1,130 - 140) GB = 990 GB workspace; 990 / 2.64 = 375 users.
 * (The guide's prose prints "988 GB", but its own 375 answer and the
 * judges' workbook registry both require 990 - the registry value wins.)
 */
describe('Explainer alignment with the leader guide', () => {
  it('scenario options match the brief numbers exactly', () => {
    expect(WEIGHTS[1].value).toBe(140); // Llama 3.3 70B @ FP16
    expect(KV[2].value).toBe(0.33); // native FP16 truth
    expect(KV[0].value).toBe(0.044); // the outdated rule-of-thumb trap
    expect(CONTEXT[1].value).toBe(8000); // the drill spike
    expect(HARDWARE[1].value).toBe(1130); // registry chassis VRAM
    expect(USERS[1].value).toBe(375); // the drill cap
    expect(TTFT[1].value).toBe(100); // sub-100ms scenario SLA
    expect(TOKENS_DAY[1].value).toBe(100); // 100M tokens/day/hub
  });

  it('reproduces the Track A derivation: 2.64 GB/session and 375 users', () => {
    const gbSession = (CONTEXT[1].value * KV[2].value) / 1000;
    expect(gbSession).toBeCloseTo(SCENARIO.gbPerSession, 10); // 2.64 exactly
    const workspace = HARDWARE[1].value - WEIGHTS[1].value;
    expect(workspace).toBe(990);
    expect(Math.floor(workspace / gbSession)).toBe(375);
  });

  it('375 scenario users exactly redline the node without OOM', () => {
    const gbSession = (CONTEXT[1].value * KV[2].value) / 1000;
    const workspace = HARDWARE[1].value - WEIGHTS[1].value;
    const demand = USERS[1].value * gbSession;
    expect(demand).toBeCloseTo(workspace, 8); // 990.0 GB, 100% utilisation
    expect(demand).toBeLessThanOrEqual(workspace + 1e-9); // no false OOM
  });

  it('the 0.044 trap admits phantom users, exactly as the drill teaches', () => {
    const trapSession = (CONTEXT[1].value * KV[0].value) / 1000; // 0.352 GB
    const workspace = HARDWARE[1].value - WEIGHTS[1].value;
    const trapCap = Math.floor(workspace / trapSession);
    expect(trapCap).toBeGreaterThan(2500); // ~2,812 phantom sessions
    // Real demand of those phantom users at true FP16 density:
    const realDemand = trapCap * ((CONTEXT[1].value * KV[2].value) / 1000);
    expect(realDemand).toBeGreaterThan(workspace * 7); // catastrophic OOM
  });

  it('scenario constants agree with the workshop data module', () => {
    expect(SCENARIO.baseWeightsGB).toBe(140);
    expect(SCENARIO.mbPerToken).toBe(0.33);
    expect(SCENARIO.contextTokens).toBe(8000);
    expect(SCENARIO.gbPerSession).toBe(2.64);
    expect(SCENARIO.sessionCapPerNode).toBe(375);
    expect(SCENARIO.ttftTargetMs).toBe(100);
    expect(SCENARIO.tokensPerDayPerHub).toBe(100e6);
  });
});
