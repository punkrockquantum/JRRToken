import type {
  CoolingSpec,
  CpuSpec,
  DatacenterSpec,
  FabricSpec,
  StorageSpec,
  WanSpec,
} from './types';

export const CPUS: CpuSpec[] = [
  {
    id: 'intel-xeon-8592',
    vendor: 'Intel',
    name: 'Xeon Platinum 8592+ (Emerald Rapids)',
    cores: 64,
    tdpW: 350,
    hostOverheadMs: 7,
    blurb:
      'Intel\u2019s mainstream AI-host CPU. The CPU never does the model maths \u2014 it tokenises text, batches requests and feeds the accelerators.',
  },
  {
    id: 'amd-epyc-9654',
    vendor: 'AMD',
    name: 'EPYC 9654 (Genoa, 96c)',
    cores: 96,
    tdpW: 360,
    hostOverheadMs: 6,
    blurb:
      '96 Zen 4 cores and 12 DDR5 channels. High core counts help when one host juggles many concurrent inference requests.',
  },
  {
    id: 'nvidia-grace',
    vendor: 'NVIDIA',
    name: 'Grace (72c Arm)',
    cores: 72,
    tdpW: 250,
    hostOverheadMs: 5,
    blurb:
      'NVIDIA\u2019s Arm CPU, coherently linked to GPUs over 900GB/s NVLink-C2C \u2014 the CPU-GPU handoff practically disappears.',
  },
  {
    id: 'amd-epyc-9965',
    vendor: 'AMD',
    name: 'EPYC 9965 (Turin, 192c)',
    cores: 192,
    tdpW: 500,
    hostOverheadMs: 5,
    blurb:
      '192 Zen 5c cores. Overkill for one model \u2014 built for hosts serving dozens of simultaneous request streams.',
  },
];

export const STORAGE: StorageSpec[] = [
  {
    id: 'object',
    name: 'Object storage (S3-class)',
    gbPerSec: 5,
    firstByteMs: 80,
    powerShare: 0.02,
    usdPerGBMonth: 0.021,
    blurb:
      'Cheap, bottomless, but slow to stream from. Fine as the system of record for weights; painful when a cold GPU has to pull hundreds of GB through it.',
  },
  {
    id: 'parallel-fs',
    name: 'Parallel filesystem (Lustre / WEKA-class)',
    gbPerSec: 40,
    firstByteMs: 5,
    powerShare: 0.04,
    usdPerGBMonth: 0.12,
    blurb:
      'A clustered flash filesystem striped across many nodes \u2014 the standard middle tier for feeding GPU clusters.',
  },
  {
    id: 'local-nvme',
    name: 'GPU-adjacent local NVMe',
    gbPerSec: 100,
    firstByteMs: 0.5,
    powerShare: 0.03,
    usdPerGBMonth: 0.06,
    blurb:
      'NVMe drives inside the GPU server, readable via GPUDirect Storage so weights bypass the CPU on their way into GPU memory.',
  },
];

export const FABRICS: FabricSpec[] = [
  {
    id: 'roce-400',
    vendor: 'Broadcom/Arista',
    name: '400G Ethernet (RoCEv2)',
    gbPerSec: 50,
    overheadPerGpu: 0.05,
    stepLatencyUs: 12,
    costPerGpuUSD: 2200,
    blurb:
      'Standard datacenter Ethernet carrying RDMA. Cheaper and more open than InfiniBand; slightly higher and less predictable latency.',
  },
  {
    id: 'ib-ndr',
    vendor: 'NVIDIA (Mellanox)',
    name: 'InfiniBand NDR 400G',
    gbPerSec: 50,
    overheadPerGpu: 0.035,
    stepLatencyUs: 8,
    costPerGpuUSD: 5500,
    blurb:
      'The classic AI-cluster fabric: RDMA-native with in-network reduction (SHARP), so multi-GPU sync steps cost less.',
  },
  {
    id: 'nvlink5',
    vendor: 'NVIDIA',
    name: 'NVLink 5 domain (NVL72)',
    gbPerSec: 900,
    overheadPerGpu: 0.012,
    stepLatencyUs: 2,
    costPerGpuUSD: 9000,
    blurb:
      '1.8 TB/s per GPU of coherent bandwidth (900 GB/s each way) across a whole rack. Splitting a model over many GPUs becomes almost free.',
  },
];

export const WAN: WanSpec[] = [
  {
    id: 'public-internet',
    name: 'Public internet',
    addedRttMs: 30,
    jitterMs: 12,
    monthlyUSD: 800,
    blurb:
      'Best-effort transit across whichever ISPs sit between the user and the datacenter. Fine for chat; jitter shows up as uneven token streaming.',
  },
  {
    id: 'servicefabric',
    name: 'Digital Realty ServiceFabric\u2122',
    addedRttMs: 6,
    jitterMs: 1,
    monthlyUSD: 2400,
    blurb:
      'Private software-defined interconnection across Digital Realty\u2019s global platform \u2014 traffic rides a dedicated fabric between facilities and clouds instead of the public internet.',
  },
  {
    id: 'direct-connect',
    name: 'Dedicated cross-connect (same campus)',
    addedRttMs: 1,
    jitterMs: 0.2,
    monthlyUSD: 350,
    blurb:
      'A literal fibre patch inside the same campus \u2014 the app servers sit next to the GPUs. As low as network latency gets.',
  },
];

export const COOLING: CoolingSpec[] = [
  {
    id: 'air',
    name: 'Air (hot/cold aisle)',
    maxWattsPerGpu: 500,
    pue: 1.5,
    maxKwPerRack: 20,
    capexPerKwUSD: 2000,
    blurb:
      'Traditional raised-floor air cooling. Struggles beyond ~20kW per rack \u2014 modern accelerators must throttle to live here.',
  },
  {
    id: 'rdhx',
    name: 'Rear-door heat exchanger (RDHx)',
    maxWattsPerGpu: 800,
    pue: 1.3,
    maxKwPerRack: 50,
    capexPerKwUSD: 3200,
    blurb:
      'A water-cooled radiator replaces the rack\u2019s rear door, capturing heat at the source. Digital Realty\u2019s standard step-up for dense AI racks.',
  },
  {
    id: 'dlc',
    name: 'Direct liquid cooling (cold plates)',
    maxWattsPerGpu: 1500,
    pue: 1.15,
    maxKwPerRack: 150,
    capexPerKwUSD: 4800,
    blurb:
      'Coolant flows through cold plates bolted to each chip. Required for Blackwell-class parts; Digital Realty supports DLC at up to ~150kW per rack.',
  },
  {
    id: 'immersion',
    name: 'Immersion cooling',
    maxWattsPerGpu: 2000,
    pue: 1.05,
    maxKwPerRack: 200,
    capexPerKwUSD: 6500,
    blurb:
      'Servers submerged in dielectric fluid. Near-perfect heat capture and the lowest PUE, at the cost of exotic serviceability.',
  },
];

/**
 * Digital Realty campuses and named sites, plus a self-hosted option.
 * Grid carbon, power price, colo rates and climate factors are
 * public-domain regional figures, rounded. Site codes follow Digital
 * Realty's metro naming (e.g. AMS11, LHR19).
 */
export const DATACENTERS: DatacenterSpec[] = [
  {
    id: 'iad',
    name: 'Northern Virginia (Ashburn campus)',
    metro: 'Ashburn, VA',
    region: 'US East',
    gridCarbon: 310,
    usdPerKwh: 0.075,
    renewablePct: 40,
    climateFactor: 1.05,
    baseRttMs: 8,
    coloUsdPerKwMonth: 130,
    blurb:
      'Data Center Alley \u2014 the densest interconnection hub on Earth. Digital Realty\u2019s Ashburn campus anchors the world\u2019s largest cloud on-ramps.',
  },
  {
    id: 'pdx',
    name: 'Portland / Hillsboro campus',
    metro: 'Hillsboro, OR',
    region: 'US West',
    gridCarbon: 120,
    usdPerKwh: 0.06,
    renewablePct: 75,
    climateFactor: 0.92,
    baseRttMs: 10,
    coloUsdPerKwMonth: 110,
    blurb:
      'Cheap hydro power, a cool climate that helps free cooling, and subsea cable landings to Asia.',
  },
  {
    id: 'dfw',
    name: 'Dallas (Digital Dallas campus)',
    metro: 'Dallas, TX',
    region: 'US Central',
    gridCarbon: 400,
    usdPerKwh: 0.055,
    renewablePct: 30,
    climateFactor: 1.12,
    baseRttMs: 9,
    coloUsdPerKwMonth: 105,
    blurb:
      'ERCOT\u2019s cheap power and land make Dallas a major AI-buildout metro; hot summers push cooling systems harder.',
  },
  {
    id: 'fra',
    name: 'Frankfurt campus',
    metro: 'Frankfurt, DE',
    region: 'EU Central',
    gridCarbon: 350,
    usdPerKwh: 0.18,
    renewablePct: 50,
    climateFactor: 1.0,
    baseRttMs: 7,
    coloUsdPerKwMonth: 165,
    blurb:
      'Home of DE-CIX, one of the world\u2019s largest internet exchanges. European power prices make efficiency (PUE) matter far more here.',
  },
  {
    id: 'lhr19',
    name: 'LHR19 \u2014 London',
    metro: 'London, UK',
    region: 'EU West',
    gridCarbon: 210,
    usdPerKwh: 0.2,
    renewablePct: 45,
    climateFactor: 0.95,
    baseRttMs: 6,
    coloUsdPerKwMonth: 175,
    blurb:
      'Part of Digital Realty\u2019s London platform, the UK\u2019s interconnection heart. A mild climate is kind to cooling; grid power is among the most expensive in this list.',
  },
  {
    id: 'cph3',
    name: 'CPH3 \u2014 Copenhagen',
    metro: 'Copenhagen, DK',
    region: 'EU North',
    gridCarbon: 130,
    usdPerKwh: 0.14,
    renewablePct: 80,
    climateFactor: 0.88,
    baseRttMs: 8,
    coloUsdPerKwMonth: 150,
    blurb:
      'Digital Realty\u2019s Copenhagen site on one of Europe\u2019s greenest grids \u2014 Danish wind power plus a cool Nordic climate that lets free cooling do much of the work.',
  },
  {
    id: 'ams11',
    name: 'AMS11 \u2014 Amsterdam',
    metro: 'Amsterdam, NL',
    region: 'EU West',
    gridCarbon: 270,
    usdPerKwh: 0.17,
    renewablePct: 50,
    climateFactor: 0.93,
    baseRttMs: 6,
    coloUsdPerKwMonth: 160,
    blurb:
      'On the Amsterdam interconnection ring near AMS-IX, one of the world\u2019s busiest internet exchanges. Dutch grid-capacity limits make efficient designs essential here.',
  },
  {
    id: 'iah10',
    name: 'IAH10 \u2014 Houston',
    metro: 'Houston, TX',
    region: 'US Central',
    gridCarbon: 400,
    usdPerKwh: 0.055,
    renewablePct: 30,
    climateFactor: 1.18,
    baseRttMs: 9,
    coloUsdPerKwMonth: 100,
    blurb:
      'Cheap ERCOT power in an energy-industry metro. Gulf-coast heat and humidity work the cooling plant hard \u2014 liquid cooling pays back quickly.',
  },
  {
    id: 'jfk10',
    name: 'JFK10 \u2014 New York',
    metro: 'New York, NY',
    region: 'US East',
    gridCarbon: 280,
    usdPerKwh: 0.16,
    renewablePct: 30,
    climateFactor: 1.0,
    baseRttMs: 6,
    coloUsdPerKwMonth: 190,
    blurb:
      'Serving the New York metro, where proximity to finance and media buys the lowest user latency on the US East Coast \u2014 at premium space and power prices.',
  },
  {
    id: 'sin11',
    name: 'SIN11 \u2014 Singapore',
    metro: 'Singapore',
    region: 'APAC',
    gridCarbon: 470,
    usdPerKwh: 0.16,
    renewablePct: 5,
    climateFactor: 1.25,
    baseRttMs: 12,
    coloUsdPerKwMonth: 185,
    blurb:
      'Digital Realty\u2019s Singapore platform, the gateway to Southeast Asia. Year-round 30\u00b0C humidity makes this one of the hardest places on Earth to cool a GPU.',
  },
  {
    id: 'onprem',
    name: 'On-premises / self-hosted',
    metro: 'Your own building',
    region: 'Self-hosted',
    gridCarbon: 350,
    usdPerKwh: 0.12,
    renewablePct: 20,
    climateFactor: 1.15,
    baseRttMs: 1,
    coloUsdPerKwMonth: 250,
    blurb:
      'GPUs in your own server room: users sit one LAN hop away, so latency is unbeatable. But you pay commercial power rates, run less-optimised cooling, and the \u201cfacility\u201d line becomes the true cost of building and operating the room yourself \u2014 usually above wholesale colo rates.',
  },
];
