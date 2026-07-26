/**
 * Token Alchemy Challenge — architecture evaluation engine.
 *
 * Teams submit their proposed architecture (platform, compute, nodes,
 * fabric, location, cooling) plus two worksheet numbers (safe concurrency
 * and break-even month). The engine runs the physics and scores five
 * categories that mirror a solution architect's day job:
 *
 *   1. Memory & concurrency        (20) — did they find the real session cap?
 *   2. Watts into tokens           (20) — energy efficiency of the design
 *   3. Throughput & latency        (20) — hub capacity and TTFT
 *   4. Facility design             (20) — rack density and thermal headroom
 *   5. Economics                   (20) — break-even and cost per token
 *
 * There is no out-of-memory crash: real serving platforms apply admission
 * control and queue excess sessions. Overshooting the cap costs accuracy
 * points and earns an explanation, not a disqualification.
 */

import { ACCELERATORS } from '../data/accelerators';
import {
  BUSINESS_CASES,
  RACK_DENSITIES,
  RACK_SPACE_USD_MONTH,
  type BusinessCase,
  type RackDensity,
} from '../data/businessCases';
import {
  COOLING,
  CPUS,
  DATACENTERS,
  FABRICS,
  STORAGE,
  WAN,
} from '../data/infrastructure';
import { MODELS } from '../data/models';
import { PLATFORMS } from '../data/platforms';
import { SCENARIO } from '../data/workshop';
import { simulate, type SimConfig, type SimResult } from '../simulation/engine';

export const TEAMS = ['Red', 'Blue', 'Yellow', 'Green', 'Orange'] as const;
export type TeamColor = (typeof TEAMS)[number];

export interface Submission {
  team: TeamColor;
  platformId: string;
  accelId: string;
  nodesPerRegion: number;
  fabricId: string;
  /** Storage layer: per the judges' note, WEKA and Alletra-class are both valid. */
  storageId: string;
  /** Host CPU (Intel or AMD); defaults to the Xeon 8592+ reference host. */
  cpuId?: string;
  /** The business the deployment serves; reshapes targets, value and weighting. */
  businessCaseId: string;
  /** Rack packing strategy; trades space cost against cooling headroom. */
  rackDensityId: string;
  dcId: string;
  coolingId: string;
  /** Worksheet: the KV cache density the team used, MB per token. */
  kvMbPerToken: number;
  /** Worksheet: safe concurrent sessions per node at the case's context. */
  concurrencyTarget: number;
  /** Worksheet: break-even month vs the cloud alternative. */
  breakEvenMonth: number;
}

/** Track A rubric level per the Token Section Leader guide. */
export type RubricLevel = 5 | 3 | 1;

export interface CategoryScore {
  id: 'memory' | 'energy' | 'performance' | 'facility' | 'economics';
  label: string;
  points: number;
  max: number;
  /** Business-case emphasis multiplier applied when computing the total. */
  weight: number;
  detail: string;
}

export interface OutcomePoint {
  month: number;
  /** Cumulative cash position: business-case net cash x months - CapEx. */
  cumulativeUSD: number;
}

export interface DeploymentOutcome {
  timeline: OutcomePoint[];
  /** Padded payback month, null when the design never breaks even. */
  roiMonth: number | null;
  /** Calendar label for the ROI month, e.g. "Sep 2029". */
  roiCalendar: string | null;
  /** Cash position at the end of the 60-month hardware life. */
  profit60: number;
  roiPct: number;
  statement: string;
}

export interface Evaluation {
  total: number;
  band: string;
  /** Track A rubric verdict (5/3/1) from the Token Section Leader guide. */
  rubricLevel: RubricLevel;
  rubricLabel: string;
  categories: CategoryScore[];
  /** Every formula behind the score, with the submission's numbers plugged in. */
  formulas: string[];
  /** Final bucket: time to ROI and profit/loss over the hardware life. */
  outcome: DeploymentOutcome;
  critique: string;
  sim: SimResult;
  derived: {
    sessionCap: number;
    joulesPerToken: number;
    hubTokensPerDay: number;
    nodeKw: number;
    racksPerRegion: number;
    coldStartS: number;
    capexGlobal: number;
    opexMonthly: number;
    savingsMonthly: number;
    nakedBreakEven: number | null;
    paddedBreakEven: number | null;
    net60: number;
    roiPct: number;
    tokensSoldPerMonth: number;
    revenueMonthly: number;
    netCashMonthly: number;
  };
}

const byId = <T extends { id: string }>(arr: T[], id: string): T =>
  arr.find((x) => x.id === id) ?? arr[0];

/** Reference energy intensity for full marks, J per token. */
const REF_JOULES_PER_TOKEN = 3;
const REF_COST_PER_1M = 2.5;
const HOURS_PER_MONTH = 720;
const REGIONS = 3;

export function bandFor(total: number): string {
  if (total >= 85) return 'BOARD-READY ARCHITECTURE';
  if (total >= 70) return 'STRONG DESIGN \u2014 TUNE THE EDGES';
  if (total >= 50) return 'VIABLE \u2014 GAPS TO CLOSE';
  return 'BACK TO THE WHITEBOARD';
}

export function evaluate(sub: Submission): Evaluation {
  const platform = byId(PLATFORMS, sub.platformId);
  const bc: BusinessCase = byId(BUSINESS_CASES, sub.businessCaseId || 'lifesci');
  const density: RackDensity = byId(RACK_DENSITIES, sub.rackDensityId || 'standard');
  const base: SimConfig = {
    model: byId(MODELS, 'llama-3.3-70b'),
    quant: 'fp16',
    accelerator: byId(ACCELERATORS, sub.accelId),
    extraGpus: 0,
    cpu: byId(CPUS, sub.cpuId || 'intel-xeon-8592'),
    storage: byId(STORAGE, sub.storageId || 'parallel-fs'),
    kvPlacement: 'hbm',
    fabric: byId(FABRICS, sub.fabricId),
    wan: byId(WAN, 'servicefabric'),
    cooling: byId(COOLING, sub.coolingId),
    datacenter: byId(DATACENTERS, sub.dcId),
    powerLimitPct: 1,
    coolantSetpointC: 25,
    promptTokens: bc.promptTokens,
    outputTokens: bc.outputTokens,
    batchSize: bc.batchSize,
    // Persistent KV cache on the chosen storage tier: repeat contexts skip
    // prefill compute at the business case's reuse rate.
    kvReusePct: bc.contextReusePct,
  };
  const probe = simulate(base);
  const cfg = { ...base, extraGpus: Math.max(0, base.accelerator.perNode - probe.minGpus) };
  const sim = simulate(cfg);
  const acc = cfg.accelerator;
  const dc = cfg.datacenter;

  // ---- 1. Memory & concurrency ------------------------------------------
  // Registry-style rounding (1,128 -> 1,130 GB), but the KV footprint per
  // session follows the business case's context: the "right" concurrency
  // answer is different for drug discovery (12k-token RAG contexts) than
  // for fraud screening (2k-token transaction contexts).
  const nodeVramGB = Math.round((acc.perNode * acc.memGB) / 10) * 10;
  const headroomGB = Math.max(0, nodeVramGB - SCENARIO.baseWeightsGB);
  const gbPerSession =
    Math.round(bc.sessionContextTokens * SCENARIO.mbPerToken) / 1000;
  const sessionCap = Math.floor(headroomGB / gbPerSession);
  const over = sub.concurrencyTarget > sessionCap;

  // ---- Track A rubric per the Token Section Leader guide ------------------
  // 5: identifies 0.330 MB/token AND proves the exact cap.
  // 3: respects the 140 GB base constraint but uses generic flat industry
  //    estimates for KV density (e.g. the outdated 0.044 rule-of-thumb).
  // 1: quantized/compressed math (Rule 1 violation, e.g. FP8/FP4 KV density)
  //    OR no active memory buffer (concurrency above the cap = OOM exposure).
  const kv = sub.kvMbPerToken;
  const kvAccurate = Math.abs(kv - SCENARIO.mbPerToken) <= 0.005;
  const capExact =
    Math.abs(sub.concurrencyTarget - sessionCap) <=
    Math.max(1, Math.round(sessionCap * 0.01));
  const quantizedKv =
    Math.abs(kv - SCENARIO.mbPerToken / 2) <= 0.01 || // FP8 KV math
    Math.abs(kv - SCENARIO.mbPerToken / 4) <= 0.01; // FP4 KV math
  let rubricLevel: RubricLevel;
  let rubricLabel: string;
  if (over || quantizedKv) {
    rubricLevel = 1;
    rubricLabel = 'Deficient';
  } else if (kvAccurate && capExact) {
    rubricLevel = 5;
    rubricLabel = 'Excellent';
  } else {
    rubricLevel = 3;
    rubricLabel = 'Proficient';
  }
  const memoryPts = rubricLevel === 5 ? 20 : rubricLevel === 3 ? 12 : 4;

  const rubricReason =
    rubricLevel === 5
      ? `Rubric 5 (Excellent): you identified the ${SCENARIO.mbPerToken.toFixed(3)} MB/token unquantized FP16 KV density and proved the single-node limit of ${sessionCap.toLocaleString()} concurrent users \u2014 translate that cap into gross margin protection and this section is airtight.`
      : rubricLevel === 3
        ? `Rubric 3 (Proficient): the ${SCENARIO.baseWeightsGB} GB base weight constraint is respected, but your ${kv.toFixed(3)} MB/token KV density is a generic industry estimate, not the true FP16 figure of ${SCENARIO.mbPerToken.toFixed(3)} \u2014 your capacity boundary is imprecise under peak contextual spikes.`
        : quantizedKv
          ? `Rubric 1 (Deficient): ${kv.toFixed(3)} MB/token is quantized/compressed KV math \u2014 product engineering banned quantization (Rule 1). At native FP16 the density is ${SCENARIO.mbPerToken.toFixed(3)} MB/token, no exceptions.`
          : `Rubric 1 (Deficient): no active memory buffer \u2014 your concurrency plan exceeds the physical cap, exposing the Sharp(er) Enterprises platform to immediate production crashes under standard corporate transaction loads.`;

  const memoryDetail =
    `${bc.name} sessions hold ${bc.sessionContextTokens.toLocaleString()} tokens of context \u00d7 ${SCENARIO.mbPerToken.toFixed(3)} MB = ${gbPerSession.toFixed(2)} GB each. ` +
    `${nodeVramGB.toLocaleString()} GB node VRAM \u2212 ${SCENARIO.baseWeightsGB} GB weights = ${headroomGB} GB \u00f7 ${gbPerSession.toFixed(2)} GB \u2192 cap ${sessionCap.toLocaleString()} sessions/node. ` +
    (sub.concurrencyTarget === sessionCap
      ? 'Your number redlines the hardware exactly. '
      : over
        ? `You proposed ${sub.concurrencyTarget.toLocaleString()}: the extra ${(sub.concurrencyTarget - sessionCap).toLocaleString()} sessions would be queued by admission control \u2014 the platform protects itself, but those users wait, and your capacity plan oversold the node. `
        : `You proposed ${sub.concurrencyTarget.toLocaleString()}: stable, but ${(sessionCap - sub.concurrencyTarget).toLocaleString()} sessions and ${(headroomGB - sub.concurrencyTarget * gbPerSession).toFixed(0)} GB of paid-for silicon sit idle. `) +
    rubricReason;

  // ---- 2. Watts into tokens ----------------------------------------------
  const joulesPerToken = sim.energyWhPer1kTokens * 3.6;
  const energyPts = Math.round(20 * Math.min(1, REF_JOULES_PER_TOKEN / joulesPerToken));
  const energyDetail =
    `${joulesPerToken.toFixed(1)} J per token at the wall (${sim.energyWhPer1kTokens.toFixed(1)} Wh/1k). ` +
    `PUE ${sim.pue.toFixed(2)} from ${cfg.cooling.name.toLowerCase()} in ${dc.metro}` +
    (sim.throttleFactor < 1
      ? `; cooling throttles the silicon to ${Math.round(sim.throttleFactor * 100)}%, so every token costs extra joules.`
      : '; silicon runs at full sustained power.') +
    ` Reference: ${REF_JOULES_PER_TOKEN} J/token earns full marks.`;

  // ---- 3. Throughput & latency -------------------------------------------
  const capacityTarget = bc.tokensPerDayTargetM * 1e6;
  const hubTokensPerDay = sim.systemTps * 86400 * sub.nodesPerRegion;
  const capacityPts = Math.round(10 * Math.min(1, hubTokensPerDay / capacityTarget));
  const ttftPts = Math.round(10 * Math.min(1, bc.ttftTargetMs / sim.ttftMs));
  const performancePts = capacityPts + ttftPts;
  const performanceDetail =
    `${(hubTokensPerDay / 1e6).toFixed(0)}M tokens/day per hub from ${sub.nodesPerRegion} node(s) vs the ${bc.tokensPerDayTargetM}M ${bc.name} target (${capacityPts}/10). ` +
    `TTFT ${sim.ttftMs.toFixed(0)} ms vs the ${bc.ttftTargetMs} ms ${bc.name} SLA (${ttftPts}/10)` +
    (bc.contextReusePct > 0
      ? ` \u2014 blended across ${bc.contextReusePct}% persistent KV-cache hits on ${cfg.storage.name.split('(')[0].trim().toLowerCase()} (warm ${sim.ttftWarmMs.toFixed(0)} ms / cold ${sim.ttftColdMs.toFixed(0)} ms).`
      : '.');

  // ---- 4. Facility design -------------------------------------------------
  const nodeKw = (sim.gpuCount * sim.sustainedWPerGpu * 1.35) / 1000;
  const rackKwPlanned = nodeKw * Math.min(density.nodesPerRack, sub.nodesPerRegion);
  const fits = rackKwPlanned <= cfg.cooling.maxKwPerRack;
  const snug = rackKwPlanned > cfg.cooling.maxKwPerRack * 0.8;
  const densityPts = !fits ? 2 : snug ? 7 : 10;
  const thermalPts = Math.round(10 * sim.throttleFactor);
  const facilityPts = densityPts + thermalPts;
  const racksPerRegion = Math.ceil(sub.nodesPerRegion / density.nodesPerRack);
  const facilityDetail =
    `${density.name}: ${rackKwPlanned.toFixed(1)} kW/rack planned vs ${cfg.cooling.maxKwPerRack} kW/rack limit for ${cfg.cooling.name.toLowerCase()} \u2192 ${racksPerRegion} rack(s) per region (${densityPts}/10 density${fits ? '' : ' \u2014 packing exceeds the cooling limit; respace or upgrade cooling'}). ` +
    (sim.throttleFactor >= 1
      ? `No thermal throttling (${thermalPts}/10).`
      : `Thermal throttling to ${Math.round(sim.throttleFactor * 100)}% (${thermalPts}/10) \u2014 in this design, a cooling upgrade is a performance upgrade.`);

  // ---- 5. Economics ---------------------------------------------------------
  const capexGlobal =
    REGIONS *
    sub.nodesPerRegion *
    (sim.hardwareCostUSD * 1.35 + cfg.fabric.costPerGpuUSD * sim.gpuCount);
  const energyMonthly =
    REGIONS * sim.facilityPowerKw * sub.nodesPerRegion * HOURS_PER_MONTH * dc.usdPerKwh;
  const coloMonthly =
    REGIONS * sim.itPowerKw * sub.nodesPerRegion * dc.coloUsdPerKwMonth;
  // Weights kept on the chosen tier (model + warm copy) in every region.
  const storageMonthly = REGIONS * sim.weightsGB * 2 * cfg.storage.usdPerGBMonth;
  const rackSpaceMonthly = REGIONS * racksPerRegion * RACK_SPACE_USD_MONTH;
  const opexMonthly =
    energyMonthly +
    coloMonthly +
    storageMonthly +
    rackSpaceMonthly +
    SCENARIO.networkCircuitMonthly;
  const savings = SCENARIO.cloudAlternativeMonthly - opexMonthly;
  const nakedBreakEven = savings > 0 ? capexGlobal / savings : null;
  const paddedBreakEven = nakedBreakEven === null ? null : Math.ceil(nakedBreakEven * 1.1);
  const net60 = savings * 60 - capexGlobal;
  const roiPct = capexGlobal > 0 ? (net60 / capexGlobal) * 100 : 0;
  // Business-case value: tokens actually sold at realistic utilisation.
  const tokensSoldPerMonth =
    sim.systemTps * sub.nodesPerRegion * REGIONS * HOURS_PER_MONTH * 3600 * bc.utilization;
  const revenueMonthly = (tokensSoldPerMonth / 1e6) * bc.revenuePer1M;
  const netCashMonthly = revenueMonthly - opexMonthly;
  let bePts = 0;
  let beNote: string;
  if (paddedBreakEven === null) {
    beNote = `OpEx ${fmtUsd(opexMonthly)}/mo exceeds the ${fmtUsd(SCENARIO.cloudAlternativeMonthly)}/mo cloud alternative \u2014 this design never breaks even, so no month can be correct.`;
  } else {
    const dev = Math.abs(sub.breakEvenMonth - paddedBreakEven);
    bePts = Math.max(0, 10 - 2 * dev);
    beNote =
      `For this architecture: ${fmtUsd(capexGlobal)} \u00f7 ${fmtUsd(savings)}/mo = ${nakedBreakEven!.toFixed(1)} months naked; with burn-in and delivery padding \u2248 Month ${paddedBreakEven}. ` +
      (dev === 0
        ? 'Your month lands exactly there.'
        : `Your Month ${sub.breakEvenMonth} is ${dev} month(s) off (${bePts}/10).`);
  }
  const costPts = Math.round(10 * Math.min(1, REF_COST_PER_1M / sim.costPer1MTokensUSD));
  const economicsPts = bePts + costPts;
  const economicsDetail = `${beNote} Cost per 1M tokens: $${sim.costPer1MTokensUSD.toFixed(2)} (${costPts}/10 vs the $${REF_COST_PER_1M.toFixed(2)} benchmark).`;

  const w = bc.weights;
  const categories: CategoryScore[] = [
    { id: 'memory', label: 'Memory & concurrency', points: memoryPts, max: 20, weight: w.memory, detail: memoryDetail },
    { id: 'energy', label: 'Watts into tokens', points: energyPts, max: 20, weight: w.energy, detail: energyDetail },
    { id: 'performance', label: 'Throughput & latency', points: performancePts, max: 20, weight: w.performance, detail: performanceDetail },
    { id: 'facility', label: 'Facility design & rack density', points: facilityPts, max: 20, weight: w.facility, detail: facilityDetail },
    { id: 'economics', label: 'Economics', points: economicsPts, max: 20, weight: w.economics, detail: economicsDetail },
  ];
  // Business-case weighted total, normalised back to 100.
  const weightedEarned = categories.reduce((a, c) => a + c.points * c.weight, 0);
  const weightedMax = categories.reduce((a, c) => a + c.max * c.weight, 0);
  const total = Math.round((weightedEarned / weightedMax) * 100);

  // ---- the coefficients, with the submission's numbers plugged in ---------
  const formulas: string[] = [
    `Session cap = (node VRAM \u2212 weights) \u00f7 KV per session = (${nodeVramGB.toLocaleString()} GB \u2212 ${SCENARIO.baseWeightsGB} GB) \u00f7 ${gbPerSession.toFixed(2)} GB = ${sessionCap.toLocaleString()} sessions/node  [coefficients: ${SCENARIO.mbPerToken.toFixed(3)} MB/token \u00d7 ${bc.sessionContextTokens.toLocaleString()}-token ${bc.name} context]`,
    `Energy per token = facility power \u00f7 token rate = ${(sim.facilityPowerKw * 1000).toFixed(0)} W \u00f7 ${sim.systemTps.toFixed(0)} tok/s = ${joulesPerToken.toFixed(1)} J/token  [coefficients: PUE ${sim.pue.toFixed(2)}, throttle ${Math.round(sim.throttleFactor * 100)}%]`,
    `Hub capacity = token rate \u00d7 86,400 s \u00d7 nodes = ${sim.systemTps.toFixed(0)} \u00d7 86,400 \u00d7 ${sub.nodesPerRegion} = ${(hubTokensPerDay / 1e6).toFixed(0)}M tokens/day`,
    `Node power = GPUs \u00d7 sustained W \u00d7 1.35 (hosts/fans) = ${sim.gpuCount} \u00d7 ${Math.round(sim.sustainedWPerGpu)} W \u00d7 1.35 = ${nodeKw.toFixed(1)} kW \u2192 ${racksPerRegion} rack(s)/region at ${cfg.cooling.maxKwPerRack} kW/rack`,
    `Persistent KV cache = ${bc.contextReusePct}% of ${bc.name} contexts repeat \u2192 warm TTFT ${sim.ttftWarmMs.toFixed(0)} ms (stream cached tensors from storage) vs cold ${sim.ttftColdMs.toFixed(0)} ms (full prefill compute)`,
    `CapEx = 3 regions \u00d7 ${sub.nodesPerRegion} node(s) \u00d7 (${fmtUsd(sim.hardwareCostUSD)} \u00d7 1.35 chassis + ${fmtUsd(cfg.fabric.costPerGpuUSD)}/GPU \u00d7 ${sim.gpuCount}) = ${fmtUsd(capexGlobal)}`,
    `OpEx = colo ${fmtUsd(coloMonthly)} (${(sim.itPowerKw * sub.nodesPerRegion * REGIONS).toFixed(0)} kW \u00d7 $${dc.coloUsdPerKwMonth}/kW) + power ${fmtUsd(energyMonthly)} ($${dc.usdPerKwh}/kWh) + rack space ${fmtUsd(rackSpaceMonthly)} (${racksPerRegion * REGIONS} racks \u00d7 $${RACK_SPACE_USD_MONTH}) + storage ${fmtUsd(storageMonthly)} (${cfg.storage.name.split('(')[0].trim()}) + circuits ${fmtUsd(SCENARIO.networkCircuitMonthly)} = ${fmtUsd(opexMonthly)}/mo`,
    `Business value = tokens sold \u00d7 $/1M = ${(tokensSoldPerMonth / 1e9).toFixed(1)}B tokens/mo (at ${Math.round(bc.utilization * 100)}% ${bc.name} utilisation) \u00d7 $${bc.revenuePer1M.toFixed(2)}/1M = ${fmtUsd(revenueMonthly)}/mo`,
    nakedBreakEven === null
      ? `Cloud lens: never breaks even \u2014 OpEx ${fmtUsd(opexMonthly)}/mo \u2265 cloud ${fmtUsd(SCENARIO.cloudAlternativeMonthly)}/mo`
      : `Cloud lens ROI = (savings \u00d7 60 \u2212 CapEx) \u00f7 CapEx = (${fmtUsd(savings)} \u00d7 60 \u2212 ${fmtUsd(capexGlobal)}) \u00f7 ${fmtUsd(capexGlobal)} = ${roiPct.toFixed(0)}%  [payback: ${nakedBreakEven.toFixed(1)} mo naked, \u2248 Month ${paddedBreakEven} padded]`,
    netCashMonthly > 0
      ? `Business lens ROI = CapEx \u00f7 net cash = ${fmtUsd(capexGlobal)} \u00f7 (${fmtUsd(revenueMonthly)} \u2212 ${fmtUsd(opexMonthly)}) = ${(capexGlobal / netCashMonthly).toFixed(1)} months`
      : `Business lens: net cash is negative (${fmtUsd(revenueMonthly)} revenue \u2212 ${fmtUsd(opexMonthly)} OpEx) \u2014 the ${bc.name} case cannot fund this build`,
  ];

  // ---- final bucket: time to ROI and profit/loss over the hardware life ---
  // Business-case lens: the tokens this fleet sells, at this case's value.
  const timeline: OutcomePoint[] = [12, 24, 36, 48, 60].map((month) => ({
    month,
    cumulativeUSD: netCashMonthly * month - capexGlobal,
  }));
  const bizRoiNaked = netCashMonthly > 0 ? capexGlobal / netCashMonthly : null;
  const bizRoiPadded = bizRoiNaked === null ? null : Math.ceil(bizRoiNaked * 1.1);
  const roiMonth = bizRoiPadded !== null && bizRoiPadded <= 60 ? bizRoiPadded : null;
  const roiCalendar =
    roiMonth === null
      ? null
      : new Date(
          new Date().getFullYear(),
          new Date().getMonth() + roiMonth,
          1
        ).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const profit60 = netCashMonthly * 60 - capexGlobal;
  const bizRoiPct = capexGlobal > 0 ? (profit60 / capexGlobal) * 100 : 0;
  const statement =
    roiMonth !== null
      ? `In the ${bc.name} business case, this deployment pays for itself in Month ${roiMonth} (\u2248 ${roiCalendar}) and ends the 60-month hardware life ${fmtUsd(profit60)} in profit \u2014 a ${bizRoiPct.toFixed(0)}% return on the ${fmtUsd(capexGlobal)} invested.`
      : netCashMonthly > 0
        ? `In the ${bc.name} business case this deployment earns ${fmtUsd(netCashMonthly)}/month net, but the ${fmtUsd(capexGlobal)} CapEx is not recovered within the 60-month hardware life \u2014 it ends ${fmtUsd(Math.abs(profit60))} short. Cheaper silicon, fewer nodes or a cheaper site would pull ROI inside the horizon.`
        : `The ${bc.name} case cannot fund this build: token value covers ${fmtUsd(revenueMonthly)}/month against ${fmtUsd(opexMonthly)}/month of OpEx, ending the 60-month life ${fmtUsd(Math.abs(profit60))} down. Right-size the architecture to the business, or pick a richer business case.`;
  const outcome: DeploymentOutcome = {
    timeline,
    roiMonth,
    roiCalendar,
    profit60,
    roiPct: bizRoiPct,
    statement,
  };

  const weakest = [...categories].sort((a, b) => a.points - b.points)[0];
  const strongest = [...categories].sort((a, b) => b.points - a.points)[0];
  const critique =
    `Track A rubric: ${rubricLevel}/5 (${rubricLabel}). ` +
    `Judged as a ${bc.name} play (weights: performance \u00d7${w.performance}, energy \u00d7${w.energy}, economics \u00d7${w.economics}). ` +
    `Strongest suit: ${strongest.label.toLowerCase()} (${strongest.points}/${strongest.max}). ` +
    `The pitch will be attacked on ${weakest.label.toLowerCase()} (${weakest.points}/${weakest.max}) \u2014 fix that slide first. ` +
    `${platform.name} on ${cfg.fabric.name.split('(')[0].trim()} in ${dc.metro}: make sure the story of why this fits ${bc.name.toLowerCase()} is as tight as the numbers.`;

  return {
    total,
    band: bandFor(total),
    rubricLevel,
    rubricLabel,
    categories,
    formulas,
    outcome,
    critique,
    sim,
    derived: {
      sessionCap,
      joulesPerToken,
      hubTokensPerDay,
      nodeKw,
      racksPerRegion,
      coldStartS: sim.coldStartS,
      capexGlobal,
      opexMonthly,
      savingsMonthly: savings,
      nakedBreakEven,
      paddedBreakEven,
      net60,
      roiPct,
      tokensSoldPerMonth,
      revenueMonthly,
      netCashMonthly,
    },
  };
}

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}
