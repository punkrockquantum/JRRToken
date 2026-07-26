/**
 * Sharp(er) Enterprises workshop registry — the official values from the
 * Tracks A-E Master Judges Workbook and the Track A facilitator guide.
 *
 * Scenario: 90-day multi-regional GA launch of "AuraCopilot" on Llama 3.3
 * 70B at native FP16 (quantization banned), 100M tokens/day per hub,
 * sub-100ms TTFT, private regions in Ashburn, Frankfurt and Tokyo.
 */

export const SCENARIO = {
  company: 'Sharp(er) Enterprises',
  arr: '$500M ARR Enterprise SaaS vendor',
  product: 'AuraCopilot',
  windowDays: 90,
  model: 'Llama 3.3 70B @ native FP16 (quantization banned)',
  tokensPerDayPerHub: 100e6,
  ttftTargetMs: 100,
  contextTokens: 8000,
  mbPerToken: 0.33,
  gbPerSession: 2.64,
  sessionCapPerNode: 375,
  baseWeightsGB: 140,
  cloudAlternativeMonthly: 185000,
  networkCircuitMonthly: 25000, // Track D unified global subtotal
  amortizationMonths: 60,
};

export interface WorkshopRegion {
  id: string;
  name: string;
  /** Simulator datacenter id. */
  dcId: string;
  usdPerKwMonth: number;
}

export const WORKSHOP_REGIONS: WorkshopRegion[] = [
  { id: 'amer', name: 'Ashburn Hub (AMER)', dcId: 'iad', usdPerKwMonth: 310 },
  { id: 'emea', name: 'Frankfurt Hub (EMEA)', dcId: 'fra', usdPerKwMonth: 360 },
  { id: 'apac', name: 'Tokyo Hub (APAC)', dcId: 'nrt', usdPerKwMonth: 314 },
];

export interface WorkshopOption {
  id: string;
  n: 1 | 2 | 3;
  name: string;
  tagline: string;
  // Track B — HPE Consultant
  chassis: string;
  nodesPerRegion: number;
  gpusPerRegion: number;
  vramPerChassisGB: number;
  headroomGB: number;
  storageArray: string;
  writeIops: number;
  storageProtocol: string;
  lakeIngestGB: number;
  lakeIngestSeconds: number;
  // Track C — Data Center Configurator
  geometry: string;
  powerInterface: string;
  cageStrategy: string;
  racksPerRegion: number;
  kwPerRegion: number;
  // Track E — Financial Analysis
  capexUSD: number;
  breakEvenMonth: number;
  // Simulator mapping
  accelId: string;
  coolingId: string;
  wanId: string;
}

export const WORKSHOP_OPTIONS: WorkshopOption[] = [
  {
    id: 'option1',
    n: 1,
    name: 'High-Density AI Factory',
    tagline: 'H200 footprint, cold-aisle containment, fastest path to density',
    chassis: 'HPE Cray XD670',
    nodesPerRegion: 2,
    gpusPerRegion: 16,
    vramPerChassisGB: 1130,
    headroomGB: 990,
    storageArray: 'HPE Alletra Storage MP',
    writeIops: 150000,
    storageProtocol: 'NVMe-oF over RoCEv2',
    lakeIngestGB: 20,
    lakeIngestSeconds: 1.6,
    geometry: 'Cold-Aisle Containment (CACS)',
    powerInterface: '3-Phase 415V 60A redundant drops',
    cageStrategy: 'Perimeter mesh cage with dual-factor biometric interlocks',
    racksPerRegion: 3,
    kwPerRegion: 45,
    capexUSD: 4000000,
    breakEvenMonth: 38,
    accelId: 'nvidia-h200',
    coolingId: 'rdhx',
    wanId: 'servicefabric',
  },
  {
    id: 'option2',
    n: 2,
    name: 'Next-Gen AI Factory',
    tagline: 'Air-cooled Blackwell footprint, more racks for airflow buffering',
    chassis: 'HPE Enterprise Blackwell Architecture Frame',
    nodesPerRegion: 2,
    gpusPerRegion: 16,
    vramPerChassisGB: 1130,
    headroomGB: 990,
    storageArray: 'HPE Alletra Storage MP',
    writeIops: 150000,
    storageProtocol: 'NVMe-oF over RoCEv2',
    lakeIngestGB: 20,
    lakeIngestSeconds: 1.6,
    geometry: 'Expanded air-cooled airflow buffering',
    powerInterface: 'High-amperage redundant power drops',
    cageStrategy: 'Perimeter mesh cage with dual-factor biometric interlocks',
    racksPerRegion: 5,
    kwPerRegion: 75,
    capexUSD: 4500000,
    breakEvenMonth: 52,
    accelId: 'nvidia-b200',
    coolingId: 'air',
    wanId: 'servicefabric',
  },
  {
    id: 'option3',
    n: 3,
    name: 'Private Cloud AI Enclave',
    tagline: 'Airgapped architecture, lowest cost, tightest isolation',
    chassis: 'HPE Secure Enclave Architecture Platform',
    nodesPerRegion: 2,
    gpusPerRegion: 16,
    vramPerChassisGB: 1130,
    headroomGB: 990,
    storageArray: 'HPE Alletra Storage MP',
    writeIops: 150000,
    storageProtocol: 'NVMe-oF over RoCEv2',
    lakeIngestGB: 20,
    lakeIngestSeconds: 1.6,
    geometry: 'Low-density compact isolation enclave',
    powerInterface: 'Redundant standard power drops',
    cageStrategy: 'Perimeter mesh cage with dual-factor biometric interlocks',
    racksPerRegion: 2,
    kwPerRegion: 30,
    capexUSD: 3500000,
    breakEvenMonth: 29,
    accelId: 'nvidia-h200',
    coolingId: 'air',
    wanId: 'direct-connect',
  },
];

/** Track C leasing matrix row: All-In Base MRC = reserved kW x rate. */
export function regionMrc(option: WorkshopOption, region: WorkshopRegion): number {
  return option.kwPerRegion * region.usdPerKwMonth;
}

/** Unified Space & Power Base MRC subtotal across the three hubs. */
export function leaseSubtotal(option: WorkshopOption): number {
  return WORKSHOP_REGIONS.reduce((a, r) => a + regionMrc(option, r), 0);
}

export interface Financials {
  depreciationMonthly: number;
  opexMonthly: number; // DC lease + Track D circuit ("flat rate", months 13-60)
  trueMonthlyWeight: number;
  year1Opex: number;
  cloudMonthly: number;
  netMonthlySavings: number;
  nakedBreakEvenMonths: number;
  paddedBreakEvenMonth: number;
}

/** Track E maths, exactly as the judges' key derives them. */
export function financials(option: WorkshopOption): Financials {
  const depreciationMonthly = option.capexUSD / SCENARIO.amortizationMonths;
  const opexMonthly = leaseSubtotal(option) + SCENARIO.networkCircuitMonthly;
  const netMonthlySavings = SCENARIO.cloudAlternativeMonthly - opexMonthly;
  return {
    depreciationMonthly,
    opexMonthly,
    trueMonthlyWeight: depreciationMonthly + opexMonthly,
    year1Opex: opexMonthly * 12,
    cloudMonthly: SCENARIO.cloudAlternativeMonthly,
    netMonthlySavings,
    nakedBreakEvenMonths: option.capexUSD / netMonthlySavings,
    paddedBreakEvenMonth: option.breakEvenMonth,
  };
}
