/**
 * Token Quest data.
 *
 * Published Digital Realty facts (player-facing copy must not show site codes
 * or a dollar-per-kW rate):
 * - PlatformDIGITAL is Digital Realty's global data-center platform.
 * - Cross Connect: a physical link between two endpoints in one facility.
 * - ServiceFabric: on-demand private interconnection. Ports 10G/100G, Links (L2) and
 *   Connections (L3, via virtual routers) from 50 Mbps to 100 Gbps, cloud on-ramps,
 *   partners, other metros, Digital Internet. See js/network.js for the full list.
 * - ServiceFabric MCP: an early-access MCP server (June 2026) so agents can call
 *   the ServiceFabric API. Same network, so not a latency or TTFT speed-up.
 * - London liquid cooling: direct-to-chip at 150 kW per rack or more
 *   (innovation lab). Portfolio PUE published as 1.38.
 * - Fiber delay is physics: about 5 µs/km in glass. Round trip is double that.
 *
 * Game assumptions (labelled in the UI): the space and power allocation per hall,
 * the air-hall kW cap, the liquid hall's 240 kW ceiling and 1.20 PUE, every price,
 * the capex budget, lead times that are not published, hop/jitter milliseconds,
 * MCP's one-tier bandwidth right-sizing, and ORCA's 1.3× / 2.2×.
 * ORCA's "about 2× more strong binders" is ORCA's own life-sciences figure.
 * 1.3× and 2.2× are game steps around that, not a hardware measurement.
 */

/**
 * NVIDIA platforms, cheapest first. A game "rack" is the unit the tiles count: two 8-GPU
 * nodes for the HGX and PCIe server platforms (16 GPUs), one NVL72 rack for the rack-scale
 * ones. `hbmGB` / `hbmTBs` are the public per-GPU memory size and bandwidth (GDDR on the PCIe
 * cards), `pflops` the dense tensor PFLOPS at `precision`, `domain` how many GPUs share one
 * NVLink (or PCIe-switched) island. Prices, lead times, supply caps and tokens per GPU are
 * game estimates, labelled as such in the UI.
 */
export const PLATFORMS = [
  {
    // NVIDIA L40S datasheet: 48 GB GDDR6 with ECC, 864 GB/s, FP8 tensor 1,466 TFLOPS with
    // sparsity (733 dense), 350 W, PCIe Gen4 x16, passive, no NVLink.
    // https://www.nvidia.com/en-us/data-center/l40s/
    // Two 8-GPU 4U PCIe servers per game rack (about 4 kW a server, estimate); server price estimate.
    id: "l40s",
    tag: "BUDGET PCIE",
    name: "L40S Server",
    family: "Ada Lovelace",
    year: 2023,
    gpu: "L40S",
    sprite: "rackAir",
    gpusPerRack: 16,
    hbmGB: 48,
    hbmTBs: 0.864,
    pflops: 0.73,
    precision: "FP8",
    domain: 8,
    rackKW: 8,
    cooling: "air",
    hostTB: 4,
    tokPerGpu: 750,
    supply: 60,
    capex: 160000,
    leadWeeks: 3,
    learn:
      "A PCIe inference card with 48 GB of GDDR6 and no NVLink. Cheap and in stock, but its memory is slow, so each GPU writes few tokens a second and big models spill across eight cards over PCIe.",
  },
  {
    // NVIDIA RTX PRO 6000 Blackwell Server Edition datasheet: 96 GB GDDR7 with ECC, 1,597 GB/s,
    // FP4 tensor 4 PFLOPS with sparsity (2 dense), FP8 2 PFLOPS with sparsity, up to 600 W
    // configurable, PCIe Gen5 x16, passive, no NVLink.
    // https://www.nvidia.com/en-us/data-center/rtx-pro-6000-blackwell-server-edition/
    // The RTX PRO Server: an 8-GPU MGX air-cooled node, 768 GB and 12.8 TB/s aggregate.
    // https://docs.nvidia.com/enterprise-reference-architectures/rtx-pro-ai-factory/latest/components.html
    // Two 8-GPU servers per game rack (about 7 kW a server, estimate); server price estimate.
    id: "rtx6000",
    tag: "BUDGET BLACKWELL",
    name: "RTX PRO 6000 Server",
    family: "Blackwell (RTX PRO)",
    year: 2025,
    gpu: "RTX PRO 6000 Blackwell Server Edition",
    sprite: "rackAir",
    gpusPerRack: 16,
    hbmGB: 96,
    hbmTBs: 1.6,
    pflops: 2,
    precision: "FP4",
    domain: 8,
    rackKW: 14,
    cooling: "air",
    hostTB: 4,
    tokPerGpu: 2200,
    supply: 60,
    capex: 240000,
    leadWeeks: 3,
    learn:
      "Blackwell on a PCIe card: 96 GB of GDDR7 at 1.6 TB/s and FP4 maths, in an 8-GPU air-cooled server. A fifth of an HGX rack's price per GPU, but GDDR is five times slower than HBM, so it suits small models and modest crowds.",
  },
  {
    // NVIDIA H100 SXM: 80 GB HBM3, 3.35 TB/s, FP8 ~2 PFLOPS dense, 700 W, NVLink 8-GPU HGX node.
    // https://www.nvidia.com/en-us/data-center/h100/
    id: "h100",
    tag: "THE CLASSIC",
    name: "HGX H100",
    family: "Hopper",
    year: 2022,
    gpu: "H100 SXM",
    sprite: "rackAir",
    gpusPerRack: 16,
    hbmGB: 80,
    hbmTBs: 3.35,
    pflops: 2,
    precision: "FP8",
    domain: 8,
    rackKW: 23,
    cooling: "air",
    hostTB: 4,
    tokPerGpu: 3000,
    supply: 40,
    capex: 600000,
    leadWeeks: 6,
    learn:
      "The GPU that kicked off the AI boom. 80 GB of fast memory is small for today's giant models, so big models must be split across many GPUs.",
  },
  {
    // NVIDIA H200 SXM: 141 GB HBM3e, 4.8 TB/s, same Hopper maths as H100, 700 W.
    // https://www.nvidia.com/en-us/data-center/h200/
    id: "h200",
    tag: "MORE MEMORY",
    name: "HGX H200",
    family: "Hopper",
    year: 2024,
    gpu: "H200",
    sprite: "rackAir",
    gpusPerRack: 16,
    hbmGB: 141,
    hbmTBs: 4.8,
    pflops: 2,
    precision: "FP8",
    domain: 8,
    rackKW: 23,
    cooling: "air",
    hostTB: 4,
    tokPerGpu: 4200,
    supply: 40,
    capex: 700000,
    leadWeeks: 8,
    learn:
      "Same chip brain as H100 but much more memory (141 GB) and bandwidth. Generating tokens is mostly a memory job, so H200 is faster at inference.",
  },
  {
    // NVIDIA HGX B200: 8× B200, 180 GB HBM3e and 8 TB/s a GPU, FP4 dense 9 PFLOPS a GPU, ~14 kW a node, air.
    // https://www.nvidia.com/en-us/data-center/hgx/
    id: "b200",
    tag: "FP4 POWER",
    name: "HGX B200",
    family: "Blackwell",
    year: 2025,
    gpu: "B200",
    sprite: "rackAir",
    gpusPerRack: 16,
    hbmGB: 180,
    hbmTBs: 8,
    pflops: 9,
    precision: "FP4",
    domain: 8,
    rackKW: 31,
    cooling: "air",
    hostTB: 4,
    tokPerGpu: 11000,
    supply: 30,
    capex: 950000,
    leadWeeks: 10,
    learn:
      "Blackwell adds FP4: smaller numbers, so each token needs less maths and memory. Still fits an air-cooled hall.",
  },
  {
    // NVIDIA HGX B300: 8× Blackwell Ultra, 288 GB HBM3e a GPU, FP4 dense ~14 PFLOPS a GPU, 800G NICs, air.
    // https://www.nvidia.com/en-us/data-center/hgx/
    id: "b300",
    tag: "BEST ON AIR",
    name: "HGX B300",
    family: "Blackwell Ultra",
    year: 2025,
    gpu: "B300",
    sprite: "rackAir",
    gpusPerRack: 16,
    hbmGB: 288,
    hbmTBs: 8,
    pflops: 14,
    precision: "FP4",
    domain: 8,
    rackKW: 30,
    cooling: "air",
    hostTB: 4,
    tokPerGpu: 15000,
    supply: 24,
    capex: 1150000,
    leadWeeks: 12,
    learn:
      "Blackwell Ultra: 288 GB per GPU and more FP4 power. The strongest choice that still runs on air.",
  },
  {
    // The same HGX B300 node sold one at a time: 8× B300 (2.3 TB HBM3e), 8× 800G ConnectX-8,
    // about 14 kW, air. https://www.nvidia.com/en-us/data-center/dgx-b300/
    // Half an HGX B300 game rack: the smaller Blackwell Ultra option when six racks is too many.
    id: "b300n",
    tag: "ONE BLACKWELL NODE",
    name: "HGX B300 node",
    family: "Blackwell Ultra",
    year: 2025,
    gpu: "B300",
    sprite: "rackAir",
    gpusPerRack: 8,
    hbmGB: 288,
    hbmTBs: 8,
    pflops: 14,
    precision: "FP4",
    domain: 8,
    rackKW: 15,
    cooling: "air",
    hostTB: 2,
    tokPerGpu: 15000,
    supply: 24,
    capex: 575000,
    leadWeeks: 12,
    learn:
      "One 8-GPU Blackwell Ultra node in a rack of its own: the same 288 GB GPUs as the full HGX B300 rack at half the price, for a crowd that needs eight strong GPUs, not sixteen.",
  },
  {
    // NVIDIA GB200 NVL72: 72 B200 + 36 Grace, 13.5 TB HBM3e, ~120 kW+ rack, liquid.
    // https://www.nvidia.com/en-us/data-center/gb200-nvl72/
    id: "gb200",
    tag: "72 GPUS AS ONE",
    name: "GB200 NVL72",
    family: "Blackwell",
    year: 2025,
    gpu: "B200 + Grace",
    sprite: "rackLiquid",
    gpusPerRack: 72,
    hbmGB: 186,
    hbmTBs: 8,
    pflops: 10,
    precision: "FP4",
    domain: 72,
    rackKW: 132,
    cooling: "liquid",
    hostTB: 17,
    tokPerGpu: 12500,
    supply: 10,
    capex: 3200000,
    leadWeeks: 16,
    learn:
      "72 GPUs joined by NVLink act like one giant GPU. Huge mixture-of-experts models love it. Too hot for air: liquid cooling only.",
  },
  {
    // NVIDIA GB300 NVL72: 72 Blackwell Ultra + 36 Grace, 21 TB HBM3e, FP4 dense 1,100 PFLOPS a rack, liquid.
    // https://www.nvidia.com/en-us/data-center/gb300-nvl72/
    id: "gb300",
    tag: "REASONING RACK",
    name: "GB300 NVL72",
    family: "Blackwell Ultra",
    year: 2025,
    gpu: "B300 + Grace",
    sprite: "rackLiquid",
    gpusPerRack: 72,
    hbmGB: 288,
    hbmTBs: 8,
    pflops: 15,
    precision: "FP4",
    domain: 72,
    rackKW: 142,
    cooling: "liquid",
    hostTB: 17,
    tokPerGpu: 17500,
    supply: 8,
    capex: 4200000,
    leadWeeks: 20,
    learn:
      "Blackwell Ultra in a 72-GPU NVLink rack. Built for reasoning models that think in thousands of tokens. Liquid only.",
  },
  {
    // NVIDIA Vera Rubin NVL72 (first branded with the 144-die count): 72 Rubin GPUs + 36 Vera CPUs, 20.7 TB HBM4 at 1,400 TB/s
    // (288 GB and 19.2 TB/s a GPU), NVFP4 inference 3,600 PFLOPS a rack (50 a GPU; 35 dense training), liquid, 2026.
    // https://www.nvidia.com/en-us/data-center/vera-rubin-nvl72/
    id: "vr",
    tag: "HBM4 NEXT GEN",
    name: "Vera Rubin NVL72",
    family: "Rubin",
    year: 2026,
    gpu: "Rubin + Vera",
    sprite: "rackRubin",
    gpusPerRack: 72,
    hbmGB: 288,
    hbmTBs: 20,
    pflops: 35,
    precision: "FP4",
    domain: 72,
    rackKW: 210,
    cooling: "liquid",
    hostTB: 54,
    tokPerGpu: 42000,
    supply: 4,
    capex: 6500000,
    leadWeeks: 30,
    learn:
      "Next-gen Rubin with HBM4 memory: far more tokens per watt. NVIDIA first counted it as 144 GPU dies (72 packages). Supply is tight, so you only get a few racks.",
  },
]

export const DATA_TIERS = [
  {
    id: "local",
    tag: "NO SHARED DATA",
    name: "Local NVMe only",
    short: "Local only",
    kw: 0,
    capex: 0,
    leadWeeks: 0,
    space: 0,
    retrieval: { required: 2.5, helpful: 0.8, bulk: 2.5, none: 0 },
    feed: { required: 0.55, helpful: 0.75, bulk: 0.55, none: 1 },
    learn:
      "Each server keeps its own small drives. Fine for a chatbot. It does not hold the shared index the app searches, so a RAG lookup is slow. Weights still have to be loaded into GPU memory once, from somewhere.",
  },
  {
    id: "file",
    tag: "SHARED FAST DATA",
    name: "File & Object Storage",
    short: "File & Object",
    kw: 12,
    capex: 400000,
    leadWeeks: 6,
    space: 0.5,
    // Without an index the app scans files for passages: slower before the first word, and
    // weaker grounding for a retrieval story (game values). Repos and candidate libraries
    // are read whole, so agents and the lab lose nothing.
    retrieval: { required: 0.6, helpful: 0.3, bulk: 0.35, none: 0 },
    feed: { required: 0.9, helpful: 1, bulk: 1, none: 1 },
    learn:
      "File and object storage holds documents and model checkpoints. Checkpoints are loaded into GPU memory at start-up, not on every token. The app can read documents before the model runs.",
  },
  {
    id: "vector",
    tag: "INSTANT LOOKUP",
    name: "Vector Index Storage",
    short: "Vector RAG",
    kw: 18,
    capex: 550000,
    leadWeeks: 6,
    space: 1,
    // An index built for passages adds nothing to a molecule library, and costs more (game value).
    retrieval: { required: 0.08, helpful: 0.08, bulk: 0.35, none: 0 },
    feed: { required: 1, helpful: 1, bulk: 0.97, none: 1 },
    learn:
      "The app embeds the question and searches this index, then pastes the best passages into the prompt. The model never searches mid-thought.",
  },
]

export const KV_TIER = {
  name: "KV Cache Tier",
  tag: "REMEMBERS CONTEXT",
  kw: 10,
  capex: 250000,
  leadWeeks: 4,
  space: 0.5,
  learn:
    "When GPU memory fills or a chat goes idle, KV blocks can park in CPU memory and then on a fast memory tier. The next turn reloads that prefix instead of redoing prefill. Storage is not fetching the answer.",
}

export const ORCA = {
  name: "ORCA PT-3",
  tag: "QUANTUM ACCELERATOR",
  kw: 6,
  capex: 5000000,
  // Two cabinets installed beside the GPUs: a shorter lead than a new GPU rack (game value).
  leadWeeks: 14,
  space: 2,
  qumodes: 128,
  small: 1.3,
  large: 2.2,
  learn:
    "ORCA PT-3 is a photonic quantum accelerator: ORCA's photonic boson sampling, single photons in a time-bin interferometer, at room temperature, in two cabinets beside the GPUs. One is being installed at Digital Realty's London Innovation Lab (LHR19). GPUs build the binding graph and run the classical optimizer. ORCA reports about 2× more strong binders than classical AI. Game values: 1.3× hits per candidate on a small graph, 2.2× on a large one. Tokens per second don't change. No GPUs, no boost. A remote link trims it.",
}

export const GRAPH_SIZES = [
  {
    id: "small",
    name: "Small graph",
    learn: "Few contacts in the binding graph. Classical search still keeps up, so the quantum accelerator adds 1.3× hits per candidate (game value).",
  },
  {
    id: "large",
    name: "Large graph",
    learn: "Many contacts. The classical optimizer still has to find the best pose. ORCA's photonic boson sampling helps it land about 2× more strong binders. 2.2× hits per candidate is the game step around that.",
  },
]

/**
 * Each `learn` is one plain sentence: what it is, what you configure, how long until
 * traffic flows, and what it costs. Lead times and prices marked "game" are assumptions.
 */
export const NETWORKS = [
  {
    id: "fabric",
    name: "ServiceFabric",
    short: "FABRIC",
    gbps: 10,
    orcaLocal: true,
    orcaRetain: 0.7,
    does: "Private on-demand connections to clouds, partners, other metros, and Digital Internet. You configure it.",
    learn:
      "Digital Realty's private interconnection fabric: you pick a 10G or 100G port, a destination, a 50 Mbps to 100 Gbps connection, Layer 2 or Layer 3, and redundancy; a new port takes up to 15 days (published SLA) and connections go live in minutes, for about $1,200 a month per 10G port plus $400 to $1,500 a month per connection by bandwidth (estimate).",
  },
  {
    id: "mcp",
    name: "ServiceFabric MCP",
    short: "MCP",
    gbps: 10,
    orcaLocal: true,
    orcaRetain: 0.7,
    does: "The same ServiceFabric, configured by an AI agent. Same wire, same latency, same prices. Faster to configure.",
    learn:
      "An AI agent drives ServiceFabric through Digital Realty's early-access MCP server: you state an intent, approve or edit the exact config it prices, and get the same 15-day port and minutes-to-live connections at the same prices and latency, plus one game benefit: it steps bandwidth one tier up or down during the run.",
  },
  {
    id: "cross",
    name: "Cross Connect",
    short: "X-CONN",
    gbps: 100,
    orcaLocal: true,
    orcaRetain: 1,
    does: "A physical cable between two endpoints in the same building. Nothing to configure, and it cannot leave the building.",
    learn:
      "A physical link between two endpoints in one Digital Realty facility, one per destination with nothing else to configure, live in about five business days (game) for about $500 up front and $400 a month each (estimate).",
  },
  {
    id: "fiber",
    name: "Dark Fiber",
    short: "FIBER",
    gbps: 100,
    orcaLocal: false,
    orcaRetain: 0.55,
    does: "Unlit fibre you light yourself, between your own sites or to a named partner. Pure physics delay, slow and costly to build.",
    learn:
      "Unlit fibre between your own sites or to a named partner that you light with your own optics, live in 8 to 16 weeks (game: 12), for about $60k per metro route up front plus $40k of optics and $2,500 a month per route (estimate).",
  },
  {
    id: "public",
    name: "Public Internet",
    short: "PUBLIC",
    gbps: 10,
    orcaLocal: false,
    orcaRetain: 0.35,
    does: "Transit from an ISP. Cheap per month, but slow, jittery, lossy, and with no SLA.",
    learn:
      "ISP transit over other people's routers, with nothing private to configure, an install of days to weeks (game: 3 weeks), and about $3,000 a month for 10 Gbps (estimate); it is the slowest path, with no SLA: live users see late, jittery tokens; batch jobs just move data more slowly.",
  },
  {
    id: "peer",
    name: "Peering at an IX",
    short: "PEER",
    gbps: 10,
    orcaLocal: false,
    orcaRetain: 0.4,
    does: "Exchange traffic directly with other networks at an internet exchange, so the path is shorter than transit.",
    learn:
      "Peering at an internet exchange hands traffic straight to the other network instead of paying a transit ISP to carry it. The path is shorter than the public internet and still has some jitter. Game assumption: a few milliseconds of exchange delay on top of a slightly longer route.",
  },
  {
    id: "eye",
    name: "Eyeball-adjacent",
    short: "EYEBALL",
    gbps: 10,
    orcaLocal: false,
    orcaRetain: 0.45,
    does: "Sit close to the ISPs your customers are on, so their traffic takes a short hop.",
    learn:
      "Eyeball networks are the ISPs people and devices actually use. A metro next to those networks cuts the distance. It is still a shared path, steadier than transit and not as private as ServiceFabric. Game assumption: the same fibre distance plus a small hop.",
  },
]

/**
 * The three model sizes a player can deploy, picked on the first step. Public-class figures,
 * one byte per parameter at FP8 (FP4 racks halve the bytes in js/model.js `weightScale`):
 * - 70B dense (Llama-3.x-70B class): 70 GB at FP8, 140 GB at FP16; grouped-query KV cache about
 *   0.16 MB per token at FP8 (80 layers × 8 KV heads × 128 dims × 2).
 * - 100B dense (ESM3-98B / Command-A-111B class): about 100 GB at FP8, 200 GB at FP16; KV about 0.2 MB per token.
 * - 650B mixture-of-experts (DeepSeek-V3 / R1 class: 671B total, about 37B active per token): 671 GB at FP8,
 *   1.3 TB at FP16; multi-head latent attention keeps the KV cache near 0.07 MB per token. Every expert is
 *   read somewhere in a batch, so it wants a 72-GPU NVLink domain and spills across 8-GPU islands.
 * `quality` is a labelled game factor on the price per million good tokens: a bigger model gives better
 * answers, so each good token earns more. The maths per token (compute, memory, prefill) comes from
 * `activeB`, `weightsGB`, `moe` and `kvMBPerTok` in js/model.js, unchanged by the label.
 */
export const MODELS = [
  { id: "70b", name: "70B", label: "70B dense", example: "Llama-class", params: 70, activeB: 70, weightsGB: 70, fp16GB: 140, moe: false, kvMBPerTok: 0.16, quality: 1 },
  { id: "100b", name: "100B", label: "100B dense", example: "ESM3 / Command-A class", params: 100, activeB: 100, weightsGB: 100, fp16GB: 200, moe: false, kvMBPerTok: 0.2, quality: 1.12 },
  { id: "650b", name: "650B", label: "650B MoE", example: "DeepSeek-class, 37B active", params: 671, activeB: 37, weightsGB: 671, fp16GB: 1342, moe: true, kvMBPerTok: 0.07, quality: 1.3 },
]

export const MODEL_IDS = MODELS.map((model) => model.id)
export const USER_TIER_IDS = ["small", "medium", "large"]

/**
 * How many people (or robots, or scientists) ask, picked on the first step: three tiers per story
 * ten times apart (enterprise sizes, not consumer-internet scale). Demand in tokens per second is
 * derived with a labelled concurrency model, so the number on the tile and the maths agree:
 *   people:  at once   = count × daily-active share × sessions a day × minutes a session / 1,440 × peak-to-mean
 *            streams   = at once × model streams a session (the answer the person reads plus the
 *                        search, retrieval or sub-agent calls running for them; 1 = a plain chat)
 *   fleet:   streams   = robots × duty (the share of robots mid-request at any moment)
 *   batch:   demand    = scientists × candidates each a night × tokens a candidate / 86,400 (a pipeline, no peak)
 *   demand   = streams × the story's tokens per second per stream
 * `peak` for office work is about 3: a working day is 8 of 24 hours, so the busy hour runs three
 * times the 24-hour mean; retail runs round the clock with an evening peak.
 * The top tier is the business each story was written for (its demand is the story's calibrated
 * demand). A business ten times smaller has about a fifth of the budget and power for this project
 * (`scale` = ratio^0.7, game assumption); the GPU tiles scale their rack counts with the demand.
 */
export const USERS = {
  // A retailer's shopping assistant: 35% of monthly shoppers on a given day, 1.2 sessions of 6 minutes,
  // the evening peak at 3.5× the daily mean; each session runs the assistant plus a search and a
  // stock agent (3 streams). 1M shoppers → 6,125 at once → 18,375 streams × 30 tok/s ≈ 551K tok/s.
  chat: { unit: "shoppers a month", who: "shoppers", top: 1_000_000, kind: "people", daily: 0.35, sessions: 1.2, minutes: 6, peak: 3.5, streams: 3 },
  // A knowledge assistant for staff: 60% ask on a given day, 6 questions of 8 minutes, office peak 3×,
  // the answer plus its retrieval re-rank (2 streams). 50K staff → 3,000 at once → 6,000 streams × 25 = 150K tok/s.
  rag: { unit: "staff", who: "staff", top: 50_000, kind: "people", daily: 0.6, sessions: 6, minutes: 8, peak: 3, streams: 2 },
  // Coding agents: 70% of developers on a given day keep one agent running for about 4 hours, office
  // peak 3×. 20K developers → 7,000 agents at once × 60 tok/s = 420K tok/s.
  code: { unit: "developers", who: "developers", top: 20_000, kind: "people", daily: 0.7, sessions: 1, minutes: 240, peak: 3, streams: 1 },
  // Deep research: 70% of analysts on a given day run 5 one-hour jobs, each with 4 sub-agents
  // (search, read, check, write), office peak 3×. 10K analysts → 4,375 at once → 17,500 streams × 40 = 700K tok/s.
  research: { unit: "analysts", who: "analysts", top: 10_000, kind: "people", daily: 0.7, sessions: 5, minutes: 60, peak: 3, streams: 4 },
  // A screening pipeline: each scientist queues 20,000 candidates a night, 500 tokens of poses and
  // scores each. 2,000 scientists → 40M candidates a day ÷ 86,400 s ≈ 231K tok/s, steady.
  drug: { unit: "scientists", who: "scientists", top: 2_000, kind: "batch", perNight: 20_000, tokens: 500 },
  // A robot fleet: a robot is mid-request 30% of the time. 5,000 robots → 1,500 streams × 80 tok/s = 120K tok/s.
  robot: { unit: "robots", who: "robots", top: 5_000, kind: "fleet", duty: 0.3 },
}

export const USER_TIER_MULT = { small: 0.01, medium: 0.1, large: 1 }
/** Budget and power grow slower than the crowd: scale = (count / top) ^ SCALE_EXP. */
export const SCALE_EXP = 0.7

const USE_CASE_TEMPLATES = [
  {
    id: "chat",
    name: "Customer Chat",
    npc: "Chatty",
    icon: "iconChat",
    blurb: "A help-desk assistant for a retailer's shoppers. Short questions, fast answers.",
    defaults: { model: "70b", users: "large" },
    modelSuffix: "LLM",
    ctx: 4000,
    outTokens: 300,
    tps: 30,
    ttft: 0.6,
    netDest: { user: "internet" },
    netWhy: "Shoppers arrive from the internet. Give each leg its own path.",
    legs: [
      { id: "users", name: "USERS → SITE", hint: "ingress · one per metro · latency", role: "ingress", dest: "internet", trips: 1, bw: 1, jitter: 1, sensitive: true, critical: true, when: "always" },
      { id: "inter", name: "INTER-SITE", hint: "only with 2–3 metros", role: "inter", dest: "metro", trips: 0.4, bw: 0.35, jitter: 0.5, sensitive: true, critical: true, when: "multi" },
      { id: "control", name: "CONTROL", hint: "optional · where MCP sits", role: "control", dest: "internet", trips: 0, bw: 0.02, jitter: 0, sensitive: false, critical: false, when: "optional" },
    ],
    parCost: 0.35312023699225803, // recalibrated for 1M shoppers (551K tok/s) so the simple-board best scores 1,400
    worth: 2,
    bytesPerToken: 40,
    toolCalls: 0,
    activeShare: 0.3,
    reuse: 0.5,
    data: "none",
    learn:
      "Lots of users, short prompts. Speed to the first word (TTFT) matters most: people leave if they wait. The prompt crosses the network once; the model does not go looking in storage.",
  },
  {
    id: "rag",
    name: "Knowledge RAG",
    npc: "Libby",
    icon: "iconBook",
    blurb: "An enterprise assistant that answers from company documents.",
    defaults: { model: "70b", users: "large" },
    modelSuffix: "LLM + retrieval",
    ctx: 16000,
    outTokens: 400,
    tps: 25,
    ttft: 1.5,
    netDest: { user: "cloud", retrieval: "cloud" },
    netWhy: "Staff reach the site from the company cloud. Documents come back on a second path.",
    legs: [
      { id: "users", name: "USERS → SITE", hint: "ingress · latency", role: "ingress", dest: "cloud", trips: 1, bw: 0.35, jitter: 1, sensitive: true, critical: true, when: "always" },
      { id: "store", name: "SITE → DOCUMENTS", hint: "retrieval round trips", role: "data", dest: "cloud", trips: 2, bw: 1, jitter: 0.8, sensitive: true, critical: true, when: "always" },
      { id: "control", name: "CONTROL", hint: "optional · where MCP sits", role: "control", dest: "cloud", trips: 0, bw: 0.02, jitter: 0, sensitive: false, critical: false, when: "optional" },
    ],
    parCost: 1.4345767125848854,
    worth: 8,
    bytesPerToken: 500,
    toolCalls: 0,
    activeShare: 0.6,
    reuse: 0.3,
    data: "required",
    learn:
      "The app searches the index and pastes passages into the prompt before the GPU starts. That round trip is on you, and on the network. The model itself does not search.",
  },
  {
    id: "code",
    name: "Coding Agent",
    npc: "Codey",
    icon: "iconCode",
    blurb: "An agent that reads whole code repos and writes fixes, many tool calls in a row.",
    defaults: { model: "650b", users: "large" },
    modelSuffix: "coding agent",
    ctx: 64000,
    outTokens: 800,
    tps: 60,
    ttft: 3,
    netDest: { user: "internet", retrieval: "cloud", tool: "partner" },
    netWhy: "Developers arrive from the internet. Tool calls and repos are a separate, chatty path.",
    legs: [
      { id: "users", name: "USERS / IDE → SITE", hint: "ingress · latency", role: "ingress", dest: "internet", trips: 1, bw: 0.4, jitter: 1, sensitive: true, critical: true, when: "always" },
      { id: "tools", name: "SITE → TOOLS / REPOS", hint: "many tool-call trips", role: "tools", dest: "partner", trips: 8, bw: 0.8, jitter: 1, sensitive: true, critical: true, when: "always" },
      { id: "inter", name: "INTER-SITE", hint: "only with 2–3 metros", role: "inter", dest: "metro", trips: 1, bw: 0.3, jitter: 0.5, sensitive: true, critical: true, when: "multi" },
      { id: "control", name: "CONTROL", hint: "optional · where MCP sits", role: "control", dest: "partner", trips: 0, bw: 0.02, jitter: 0, sensitive: false, critical: false, when: "optional" },
    ],
    parCost: 0.45387426893998334, // recalibrated for the 650B MoE default so the simple-board best scores 1,400
    worth: 10,
    bytesPerToken: 180,
    toolCalls: 8,
    activeShare: 0.35,
    reuse: 0.8,
    data: "helpful",
    learn:
      "Agents keep a huge context and pause for tool calls. Each call is another network round trip. Their KV cache fills GPUs long before the maths does.",
  },
  {
    id: "research",
    name: "Deep Research",
    npc: "Prof. Owl",
    icon: "iconOwl",
    blurb: "A reasoning model that thinks step by step, calls tools, and writes long reports.",
    defaults: { model: "650b", users: "large" },
    modelSuffix: "reasoning model",
    ctx: 32000,
    outTokens: 4000,
    tps: 40,
    ttft: 5,
    netDest: { user: "internet", retrieval: "cloud", tool: "internet" },
    netWhy: "Analysts arrive from the internet. Papers and web tools come from the cloud.",
    legs: [
      { id: "users", name: "USERS → SITE", hint: "ingress", role: "ingress", dest: "internet", trips: 1, bw: 0.3, jitter: 0.6, sensitive: true, critical: true, when: "always" },
      { id: "data", name: "SITE → DATA / CLOUD", hint: "retrieval · tool trips", role: "data", dest: "cloud", trips: 10, bw: 0.7, jitter: 0.7, sensitive: true, critical: true, when: "always" },
      { id: "control", name: "CONTROL", hint: "optional · where MCP sits", role: "control", dest: "internet", trips: 0, bw: 0.02, jitter: 0, sensitive: false, critical: false, when: "optional" },
    ],
    parCost: 0.1988950027952783,
    worth: 6,
    bytesPerToken: 160,
    toolCalls: 10,
    activeShare: 0.6,
    reuse: 0.4,
    // Deep research answers from the paper corpus: without it the reports are thin.
    data: "required",
    learn:
      "Reasoning models think in thousands of hidden tokens and call tools along the way. The model is so big it needs many GPUs working as one. Tool trips ride the network you picked.",
  },
  {
    id: "drug",
    name: "Drug Discovery",
    npc: "Dr. Helix",
    icon: "iconFlask",
    blurb: "GPUs build binding graphs. ORCA's quantum accelerator finds the best pose more often.",
    defaults: { model: "100b", users: "large" },
    modelSuffix: "protein & chemistry model",
    ctx: 2000,
    outTokens: 500,
    tps: 40,
    ttft: 20,
    netDest: { user: "partner", retrieval: "partner" },
    netWhy: "The lab ships bulk data to the site. ORCA sits in the same hall as the GPUs.",
    legs: [
      // slaExempt (game assumption): the bulk lab leg pays no jitter or SLA haircut on the public
      // internet; only the link's bandwidth limits how many candidates are screened per hour.
      // Each screened candidate moves about 3.7 MB of 3D poses, scores and binding graph between
      // the lab and the site (500 output tokens × 220 B × 34): 40M candidates a day is ~14 Gbps
      // sustained, more than one 10 Gbps internet port carries.
      { id: "lab", name: "LAB / DATA → SITE", hint: "bulk · ~3.7 MB a candidate", role: "lab", dest: "partner", trips: 0.05, bw: 34, jitter: 0, sensitive: false, critical: true, when: "always", slaExempt: true },
      { id: "orca", name: "GPU ↔ ORCA", hint: "same-hall hand-off", role: "orca", dest: "partner", trips: 1, bw: 0.15, jitter: 0.2, sensitive: false, critical: false, when: "orca" },
      { id: "control", name: "CONTROL", hint: "optional · where MCP sits", role: "control", dest: "partner", trips: 0, bw: 0.02, jitter: 0, sensitive: false, critical: false, when: "optional" },
    ],
    parCost: 0.25655975089239536, // recalibrated for the 100B model and 40M candidates a day so the simple-board best scores 1,400
    worth: 1.15,
    bytesPerToken: 220,
    toolCalls: 0,
    activeShare: 1,
    // Screening prompts are unique candidates: almost nothing to reuse between turns.
    reuse: 0.02,
    data: "bulk",
    orca: true,
    learn:
      "Not a chat. GPUs screen candidates and build the binding graph. ORCA can raise the value of each hit. Tokens per second stay the same; a good hit is worth more. Batch work, so total value matters more than a snappy first token. Game assumption: the lab's bulk data rides the public internet without a jitter or SLA penalty; a slower link just screens fewer candidates per hour.",
  },
  {
    id: "robot",
    name: "Robotics",
    npc: "Bolt",
    icon: "hero",
    blurb: "Robot fleets on a factory floor need answers in milliseconds.",
    defaults: { model: "70b", users: "large" },
    modelSuffix: "vision-language-action model",
    ctx: 512,
    outTokens: 64,
    tps: 80,
    ttft: 0.05,
    netDest: { user: "partner" },
    netWhy: "Robots sit on a private factory network. The public internet is too slow and too jittery for a 50 ms answer.",
    legs: [
      { id: "users", name: "FACTORY → SITE", hint: "ingress · milliseconds", role: "ingress", dest: "partner", trips: 2, bw: 1.2, jitter: 2, sensitive: true, critical: true, when: "always" },
      { id: "inter", name: "INTER-SITE", hint: "only with 2 metros", role: "inter", dest: "metro", trips: 0.4, bw: 0.3, jitter: 1, sensitive: true, critical: true, when: "multi" },
      { id: "control", name: "CONTROL", hint: "optional · where MCP sits", role: "control", dest: "partner", trips: 0, bw: 0.02, jitter: 0, sensitive: false, critical: false, when: "optional" },
    ],
    parCost: 0.3058607118038329, // recalibrated for the 70B model and 3,000 robots so the COMBO best (HGX B200 ×2) scores 1,400
    worth: 2,
    bytesPerToken: 48,
    toolCalls: 0,
    activeShare: 0.4,
    reuse: 0.55,
    data: "none",
    learn:
      "A physical-AI workload: small prompts, a very tight time to first token, and a steady stream of requests from robots in one or two industrial metros. The public internet misses the deadline. A nearby metro, a private path, and isolated hosts keep the line moving.",
  },
]

/** "10K", "1M", "5,000", "200": short on a tile, exact below ten thousand. */
export const fmtCount = (n) => (n >= 1e6 ? `${String(Math.round((n / 1e6) * 10) / 10).replace(/\.0$/, "")}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : Math.round(n).toLocaleString("en-GB"))

/**
 * One users tier for a story: the count, how many are asking at once, the model streams that
 * drives, the demand in tokens per second, and the budget / power scale against the top tier.
 * Unknown tiers are the top one (the business the story was written for).
 */
export function usersTier(useCaseId, tierId = "large") {
  const spec = USERS[useCaseId] || USERS.chat
  const template = USE_CASE_TEMPLATES.find((item) => item.id === useCaseId) || USE_CASE_TEMPLATES[0]
  const id = USER_TIER_IDS.includes(tierId) ? tierId : "large"
  const mult = USER_TIER_MULT[id]
  const count = Math.round(spec.top * mult)
  let concurrent
  let streams
  let demand
  if (spec.kind === "batch") {
    demand = (count * spec.perNight * spec.tokens) / 86400
    streams = demand / template.tps
    concurrent = streams
  } else if (spec.kind === "fleet") {
    concurrent = count * spec.duty
    streams = concurrent
    demand = streams * template.tps
  } else {
    concurrent = (count * spec.daily * spec.sessions * spec.minutes * spec.peak) / 1440
    streams = concurrent * (spec.streams || 1)
    demand = streams * template.tps
  }
  return {
    id,
    count,
    label: `${fmtCount(count)} ${spec.unit}`,
    unit: spec.unit,
    who: spec.who,
    kind: spec.kind,
    concurrent: Math.round(concurrent),
    streams: Math.round(streams),
    demand: Math.round(demand),
    candidatesPerDay: spec.kind === "batch" ? count * spec.perNight : 0,
    mult,
    scale: Math.round(Math.pow(mult, SCALE_EXP) * 1000) / 1000,
    spec,
  }
}

/**
 * A story with one model size and one users tier filled in: the model's bytes, active
 * parameters, KV cache and quality, and the tier's demand and budget / power scale. The
 * template's own `defaults` fill anything missing, so `USE_CASES` below are the default picks.
 */
export function resolveUseCase(useCaseId, picks = {}) {
  const template = USE_CASE_TEMPLATES.find((item) => item.id === useCaseId)
  if (!template) return null
  const model = byId(MODELS, picks?.model) || byId(MODELS, template.defaults.model) || MODELS[0]
  const own = byId(MODELS, template.defaults.model) || model
  const tier = usersTier(useCaseId, picks?.users || template.defaults.users)
  return {
    ...template,
    modelId: model.id,
    usersId: tier.id,
    model: `${model.label} ${template.modelSuffix}`,
    modelSize: model,
    activeB: model.activeB,
    weightsGB: model.weightsGB,
    moe: model.moe,
    kvMBPerTok: model.kvMBPerTok,
    quality: model.quality,
    /* The story's token price is set for its own model; a bigger model earns more per token, a smaller one less. */
    priceMult: Math.round((model.quality / own.quality) * 1000) / 1000,
    demand: tier.demand,
    concurrent: tier.concurrent,
    scale: tier.scale,
    users: tier,
  }
}

/** The six stories at their default model and users: what every table and the opening board use. */
export const USE_CASES = USE_CASE_TEMPLATES.map((template) => resolveUseCase(template.id))

/**
 * Digital Realty metros (real PlatformDIGITAL markets). Coordinates are city centres;
 * distances are great-circle km, so real fiber routes run a little longer.
 */
/**
 * The scenario card dealt for each use case. Budget, power, and deadline are game values.
 * `pricePerM` is what the customer pays per million good tokens (game estimate).
 */
export const SCENARIOS = {
  chat: { where: "Shoppers in London and Frankfurt", users: "60% London, 40% Frankfurt", budget: 9_000_000, powerMW: 0.6, deadlineWeeks: 16, pricePerM: 0.55 },
  // A head-office suite with a small power room: the right racks fit it, the biggest do not.
  rag: { where: "Staff at a London head office", users: "One head office in London", budget: 7_720_000, powerMW: 0.27, deadlineWeeks: 20, pricePerM: 1.9 },
  // Agents with 64k contexts on two coasts: the deepest pockets and the most demand on the board.
  code: { where: "Developers on the US east and west coasts", users: "New York, Toronto, San Francisco, Seattle", budget: 12_500_000, powerMW: 0.6, deadlineWeeks: 26, pricePerM: 1.1 },
  // Two NVL72 racks of power where the allocation is full; a metro that is 10% short browns out.
  research: { where: "Analysts in London and Paris", users: "60% London, 40% Paris", budget: 7_500_000, powerMW: 0.35, deadlineWeeks: 36, pricePerM: 0.4 },
  // A lab's share of a hall: a few air-cooled racks of power, so cooling efficiency decides what fits.
  // $0.50 per million tokens of a 100B protein model's screening output is $0.00025 a candidate
  // (500 tokens of poses and scores), far below a wet-lab assay; the screen only pays for itself
  // with the library well utilised, and ORCA's extra strong matches are where the margin comes from.
  drug: { where: "A lab in Cambridge, UK", users: "One lab in Cambridge, UK", budget: 8_000_000, powerMW: 0.18, deadlineWeeks: 30, pricePerM: 0.5 },
  robot: { where: "Factory floors near Frankfurt and Amsterdam", users: "Stuttgart (70%) and Rotterdam (30%)", budget: 9_000_000, powerMW: 0.5, deadlineWeeks: 16, pricePerM: 0.8 },
}

/**
 * Where the model weights and the training or reference data live today. Scenario fiction
 * on real metros: a copy to a far metro takes link time and egress money, and every retrieval
 * or tool trip runs the distance from the chosen site to this place. `corpusTB` is the data
 * that must move with the weights (documents, repos, papers, candidate libraries).
 */
const HOMES = {
  chat: { city: "Ashburn", lat: 39.04, lon: -77.49, kind: "cloud", label: "a public cloud region in Northern Virginia (Ashburn)", corpus: "2 TB of fine-tuning data", corpusTB: 2 },
  rag: { city: "Frankfurt", lat: 50.11, lon: 8.68, kind: "cloud", label: "the company's cloud tenancy in Frankfurt", corpus: "30 TB of documents", corpusTB: 30 },
  code: { city: "Ashburn", lat: 39.04, lon: -77.49, kind: "cloud", label: "a cloud region in Northern Virginia (Ashburn)", corpus: "80 TB of repos", corpusTB: 80 },
  research: { city: "Paris", lat: 48.86, lon: 2.35, kind: "cloud", label: "a sovereign cloud region in Paris", corpus: "400 TB of papers", corpusTB: 400 },
  // The scientists sit in Cambridge; their candidate libraries live in a public cloud region in Dublin,
  // so every metro is a different distance from the users and from the data.
  drug: { city: "Dublin", lat: 53.35, lon: -6.26, kind: "cloud", label: "the lab's cloud tenancy in Dublin", corpus: "250 TB of candidate libraries", corpusTB: 250 },
  robot: { city: "Frankfurt", lat: 50.11, lon: 8.68, kind: "own", label: "the carmaker's training cluster in Frankfurt", corpus: "12 TB of driving logs", corpusTB: 12 },
}

/** The weights that must move with the data: the chosen model's bytes at FP8 and the story's corpus. */
export function dataHomeFor(useCase) {
  const home = HOMES[useCase?.id]
  if (!home) return null
  const gb = useCase?.weightsGB || 0
  const word = useCase?.id === "drug" ? "models" : "weights"
  return { ...home, what: `${gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${gb} GB`} of ${word} and ${home.corpus}` }
}

/** Every story's data home at its default model. */
export const DATA_HOMES = Object.fromEntries(USE_CASES.map((useCase) => [useCase.id, dataHomeFor(useCase)]))

/** Same metro: no copy, and an in-building on-ramp reaches the data (game threshold). */
export const IN_METRO_KM = 60
/** Cloud egress for the one-time copy, dollars per GB. A labelled game value near public list prices. */
export const EGRESS_PER_GB = 0.05

/**
 * What Digital Realty can offer this customer in each metro right now: the metros on the
 * short list, how much of the scenario's power is really available there (`powerMult`),
 * the local power price (`priceMult`), and how many extra weeks a liquid hall takes to fit out.
 * Game values that stand in for real capacity availability; the metros are real markets.
 */
export const METRO_OFFERS = {
  chat: [
    { id: "lon", powerMult: 1, priceMult: 1, liquidWeeks: 0, note: "near 60% of shoppers" },
    { id: "fra", powerMult: 1, priceMult: 1, liquidWeeks: 0, note: "near 40% of shoppers" },
    { id: "ams", powerMult: 0.9, priceMult: 1, liquidWeeks: 3, note: "power is tight this year" },
    { id: "par", powerMult: 1.15, priceMult: 0.85, liquidWeeks: 0, note: "cheap power, far from shoppers" },
  ],
  rag: [
    { id: "lon", powerMult: 0.8, priceMult: 1, liquidWeeks: 4, note: "near staff, a tight power room" },
    { id: "fra", powerMult: 1, priceMult: 1, liquidWeeks: 0, note: "beside the company cloud" },
    { id: "par", powerMult: 0.95, priceMult: 0.85, liquidWeeks: 0, note: "cheap power, far from both" },
    { id: "ams", powerMult: 0.85, priceMult: 1, liquidWeeks: 3, note: "power is tight this year" },
  ],
  code: [
    { id: "iad", powerMult: 1, priceMult: 0.95, liquidWeeks: 0, note: "beside the repos and weights" },
    { id: "sjc", powerMult: 0.8, priceMult: 1.3, liquidWeeks: 0, note: "near west-coast coders, scarce power" },
    { id: "dfw", powerMult: 1.2, priceMult: 0.8, liquidWeeks: 0, note: "cheap power, far from both coasts" },
    { id: "chi", powerMult: 1.05, priceMult: 0.95, liquidWeeks: 2, note: "between the coasts" },
  ],
  research: [
    { id: "lon", powerMult: 0.9, priceMult: 1, liquidWeeks: 4, note: "near 60% of analysts" },
    { id: "par", powerMult: 1.1, priceMult: 0.85, liquidWeeks: 0, note: "beside the papers and weights" },
    { id: "fra", powerMult: 0.95, priceMult: 1, liquidWeeks: 0, note: "far from analysts and papers" },
    { id: "ams", powerMult: 0.9, priceMult: 1, liquidWeeks: 3, note: "power is tight this year" },
  ],
  // ORCA PT-3 is installed at the London Innovation Lab (LHR19): elsewhere it is a remote link.
  drug: [
    { id: "lon", powerMult: 1, priceMult: 1, liquidWeeks: 0, note: "80 km from the lab, ORCA on site" },
    { id: "ams", powerMult: 1, priceMult: 1, liquidWeeks: 2, note: "across the sea from the lab" },
    { id: "fra", powerMult: 1, priceMult: 1, liquidWeeks: 0, note: "far from the lab" },
    { id: "par", powerMult: 1, priceMult: 0.85, liquidWeeks: 0, note: "cheap power, far from the lab" },
  ],
  robot: [
    { id: "fra", powerMult: 1, priceMult: 1, liquidWeeks: 0, note: "near Stuttgart and the training cluster" },
    { id: "ams", powerMult: 1, priceMult: 1, liquidWeeks: 2, note: "near Rotterdam" },
    { id: "par", powerMult: 1.1, priceMult: 0.85, liquidWeeks: 0, note: "cheap power, far from both plants" },
    { id: "lon", powerMult: 1, priceMult: 1, liquidWeeks: 0, note: "across the sea from both plants" },
  ],
}

export const HORIZON_WEEKS = 52

/**
 * Human work the AI actually replaces. Game assumptions, not a staffing study.
 * A productive year is 1,800 hours. `share` is the fraction of answers that
 * would have been a person's job. `fteCap` is how many people that enterprise
 * can absorb; a year of the scenario's full demand is scaled down to this cap
 * so serving half the crowd is half the people. `savingsPar` is the best
 * picture's net saving, from scripts/balance.mjs, and sets the score factor.
 *   chat     — routine ticket, 1.5 minutes, 35%, support agent $55k, cap 25,000
 *   rag      — file lookup, 4 minutes, 40%, knowledge worker $90k, cap 10,000
 *   code     — engineer task, 25 minutes, 50%, engineer $160k, cap 8,000
 *   research — analyst report, 90 minutes, 50%, analyst $130k, cap 3,000
 *   drug     — computational-chemist triage, 3 minutes, 60%, chemist $150k, cap 2,000
 *   robot    — operator intervention avoided, 2 minutes, 30%, operator $75k, cap 1,500
 */
export const FTE_HOURS = 1800
export const HUMAN_WORK = {
  chat: { tokensPerTask: 300, humanMinutes: 1.5, share: 0.35, loadedCost: 55_000, fteCap: 25_000, savingsPar: 738552011.8737237 },
  rag: { tokensPerTask: 400, humanMinutes: 4, share: 0.4, loadedCost: 90_000, fteCap: 10_000, savingsPar: 522477277.3545038 },
  code: { tokensPerTask: 800, humanMinutes: 25, share: 0.5, loadedCost: 160_000, fteCap: 8_000, savingsPar: 893518836.4073982 },
  research: { tokensPerTask: 4000, humanMinutes: 90, share: 0.5, loadedCost: 130_000, fteCap: 3_000, savingsPar: 257086797.08384013 },
  drug: { tokensPerTask: 500, humanMinutes: 3, share: 0.6, loadedCost: 150_000, fteCap: 2_000, savingsPar: 289712758.36 },
  robot: { tokensPerTask: 64, humanMinutes: 2, share: 0.3, loadedCost: 75_000, fteCap: 1_500, savingsPar: 85147167.4732146 },
}

export const SITES = [
  { id: "lon", metro: "London", lat: 51.51, lon: -0.13 },
  { id: "fra", metro: "Frankfurt", lat: 50.11, lon: 8.68 },
  { id: "ams", metro: "Amsterdam", lat: 52.37, lon: 4.9 },
  { id: "par", metro: "Paris", lat: 48.86, lon: 2.35 },
  { id: "iad", metro: "Ashburn", lat: 39.04, lon: -77.49 },
  { id: "dfw", metro: "Dallas", lat: 32.78, lon: -96.8 },
  { id: "chi", metro: "Chicago", lat: 41.88, lon: -87.63 },
  { id: "sjc", metro: "Silicon Valley", lat: 37.34, lon: -121.89 },
]

/**
 * Who sends prompts, and from where (game assumption). Every place has a `kind`: "customers"
 * are the people (or robots) the service exists for; "employees" are the company's own team,
 * who also prompt it (support agents escalate, engineers debug, analysts ask). Shares are the
 * share of requests and sum to 1, so the request leg's latency is this share-weighted trip
 * and a metro close to a big share is a fast metro. Customers-only and employees-only stories
 * are both fine; `AUDIENCES` names the groups on the location tiles.
 */
export const USER_BASES = {
  chat: {
    name: "Shoppers in London and Frankfurt, a support team in Leeds",
    places: [
      { city: "London", lat: 51.51, lon: -0.13, share: 0.54, kind: "customers" },
      { city: "Frankfurt", lat: 50.11, lon: 8.68, share: 0.36, kind: "customers" },
      { city: "Leeds", lat: 53.8, lon: -1.55, share: 0.1, kind: "employees" },
    ],
  },
  rag: {
    name: "Staff at a London head office",
    places: [{ city: "London", lat: 51.51, lon: -0.13, share: 1, kind: "employees" }],
  },
  code: {
    name: "Developers on the US east and west coasts",
    places: [
      { city: "New York", lat: 40.71, lon: -74.01, share: 0.4, kind: "employees" },
      { city: "Toronto", lat: 43.65, lon: -79.38, share: 0.25, kind: "employees" },
      { city: "San Francisco", lat: 37.77, lon: -122.42, share: 0.25, kind: "employees" },
      { city: "Seattle", lat: 47.61, lon: -122.33, share: 0.1, kind: "employees" },
    ],
  },
  research: {
    name: "Analysts in London and Paris",
    places: [
      { city: "London", lat: 51.51, lon: -0.13, share: 0.6, kind: "employees" },
      { city: "Paris", lat: 48.86, lon: 2.35, share: 0.4, kind: "employees" },
    ],
  },
  drug: {
    name: "Scientists at a lab in Cambridge, UK",
    places: [{ city: "Cambridge", lat: 52.2, lon: 0.12, share: 1, kind: "employees" }],
  },
  robot: {
    name: "Robots in Stuttgart and Rotterdam, engineers in Munich",
    places: [
      { city: "Stuttgart", lat: 48.78, lon: 9.18, share: 0.64, kind: "customers" },
      { city: "Rotterdam", lat: 51.92, lon: 4.48, share: 0.28, kind: "customers" },
      { city: "Munich", lat: 48.14, lon: 11.58, share: 0.08, kind: "employees" },
    ],
  },
}

/** What each audience is called on the location tiles and in the scenario brief. */
export const AUDIENCES = {
  chat: { customers: "Shoppers", employees: "Support team" },
  rag: { customers: "", employees: "Staff" },
  code: { customers: "", employees: "Developers" },
  research: { customers: "", employees: "Analysts" },
  drug: { customers: "", employees: "Scientists" },
  robot: { customers: "Robots", employees: "Engineers" },
}

/**
 * What the workload has to do, in plain words. The numbers on screen come from USE_CASES
 * (demand, response target, context, output) and DATA_HOMES, so the brief and the maths agree.
 */
export const JOBS = {
  chat: "Answer shoppers' questions the moment they type them. Every request starts in a shopper's browser, so the first word must come back before they give up, and the model only has to remember the chat, not search for anything.",
  rag: "Answer staff questions from the company's own documents. Each answer looks the documents up first, so the hall needs a fast path to where the documents live, and staff want the first word quickly but will wait a little for a sourced answer.",
  code: "Work through coding tasks for developers: read a repo, call tools, write and test changes. One task means many tool calls back to the repos and APIs, so the data path is used over and over and the GPUs sit idle whenever that path is slow.",
  research: "Write long, sourced reports for analysts. Each report pulls papers from the archive several times and then reasons for thousands of tokens, so this job wants big GPU clusters near the papers more than it wants to be near the analysts.",
  drug: "Screen millions of drug candidates overnight for a lab. Nobody waits on a single answer, so this is batch work: total throughput, the bulk data feed from the candidate libraries, and the ORCA hand-off matter; a slow link just screens fewer candidates.",
  robot: "Guide robot fleets on two factory floors in real time. Every robot asks many times a second and needs its answer in a few milliseconds, so the hall must be close to the factories with a steady private link; the internet is too slow and too jittery.",
}

/**
 * Site rules per mission. `sense` is the share of revenue lost per second of network
 * wait (users bounce, agents stall) — a game assumption. Chat and code default to two metros.
 */
export const MISSION_SITES = {
  chat: { max: 3, defaults: ["lon", "fra"], sense: 3, toolsNearUsers: false, spread: true, closeKm: 300 },
  rag: { max: 1, defaults: ["lon"], sense: 0.3, toolsNearUsers: false, spread: false, closeKm: 99999 },
  code: { max: 3, defaults: ["iad", "sjc"], sense: 0.6, toolsNearUsers: true, spread: true, closeKm: 1400 },
  research: { max: 1, defaults: ["lon"], sense: 0.1, toolsNearUsers: false, spread: false, closeKm: 99999 },
  drug: { max: 1, defaults: ["lon"], sense: 0, toolsNearUsers: false, spread: false, closeKm: 99999 },
  robot: { max: 2, defaults: ["fra"], sense: 8, toolsNearUsers: false, spread: true, closeKm: 220 },
}

/** Training quality bonus caps here. Game assumption, not a published training result. */
export const TRAIN_BONUS_CAP = 0.08
/** Share of an edge cohort that still arrives late, because generation is one hop away. */
export const EDGE_LATE = 0.05

/** One plain sentence per choice: what it does for you. */
export const DOES = {
  l40s: "A budget PCIe card: in stock and cheap, but slow GDDR6 memory and no NVLink, so few tokens a GPU.",
  rtx6000: "Blackwell on a PCIe card: cheap FP4 tokens for small models, GDDR7 five times slower than HBM.",
  h100: "The classic: cheap and air-cooled, but slow memory and small NVLink islands.",
  h200: "Hopper with more, faster memory: fits bigger models per GPU.",
  b200: "Blackwell with FP4: roughly double Hopper's tokens, still air-cooled.",
  b300: "Blackwell Ultra: the strongest air-cooled rack.",
  b300n: "One Blackwell Ultra node: eight strong GPUs at half a rack's price.",
  gb200: "72 GPUs acting as one: giant models fit, but it needs liquid cooling.",
  gb300: "GB200 with more memory: more agent context per rack. Liquid only.",
  vr: "Vera Rubin: the most tokens per watt, but the priciest rack and scarce.",
  local: "No shared storage: free, fine for chat, starves RAG.",
  file: "File & Object Storage: shared documents and checkpoints for the app.",
  vector: "Vector Index Storage: the fastest document lookup before the model runs.",
  kv: "Parks the GPU's notes so repeat context skips prefill.",
  orca: "Adds ORCA's quantum accelerator: more drug matches per candidate, same tokens. Needs GPUs beside it.",
  small: "A small binding graph: classical search keeps up, ORCA adds a little.",
  large: "A large binding graph: classical search struggles, ORCA adds a lot.",
  site: "Another metro puts racks nearer users, but duplicates storage and links.",
  racks: "More racks serve more users, but every rack costs budget and power.",
}

export const HALLS = [
  {
    id: "A",
    name: "Air hall",
    kind: "Air-cooled",
    cooling: "air",
    itMW: 0.25,
    rackSpace: 24,
    fitOutWeeks: 0,
    maxRackKW: 40,
    pue: 1.38,
    learn:
      "Your space in an air-cooled PlatformDIGITAL hall: 24 rack positions and ready now. This game cools a rack at 40 kW. A liquid rack still runs here, but it overheats. PUE 1.38 is Digital Realty's published portfolio figure, used here as this hall's overhead.",
  },
  {
    id: "R",
    name: "Rear-door hall",
    kind: "Rear door heat exchanger",
    cooling: "air",
    itMW: 0.4,
    rackSpace: 18,
    fitOutWeeks: 6,
    maxRackKW: 70,
    pue: 1.28,
    learn:
      "A water-cooled door on the rack captures the hot exhaust. The servers stay air-cooled. This game allows about 40 to 70 kW per rack, with a 6 week fit-out. PUE 1.28 is a game assumption. NVL72 and Vera Rubin still need direct liquid cooling.",
  },
  {
    id: "I",
    name: "In-row hall",
    kind: "In-row cooling",
    cooling: "air",
    itMW: 0.35,
    rackSpace: 20,
    fitOutWeeks: 4,
    maxRackKW: 55,
    pue: 1.32,
    learn:
      "Close-coupled coolers sit between the racks, so the heat does not cross the whole room. This game allows about 55 kW per rack, ready in 4 weeks. PUE 1.32 is a game assumption. Liquid GPUs still throttle here.",
  },
  {
    id: "B",
    name: "Liquid hall",
    kind: "Direct-to-chip liquid",
    cooling: "liquid",
    itMW: 0.6,
    rackSpace: 12,
    fitOutWeeks: 10,
    maxRackKW: 240,
    pue: 1.2,
    learn:
      "Your space in a direct-to-chip liquid PlatformDIGITAL hall: 12 rack positions, with an 8 to 12 week fit-out (game: 10). Digital Realty's London lab supports 150 kW per rack or more. This game allows up to 240 kW so a next-gen rack still fits (estimate). PUE 1.20 is a game assumption, not a published site figure.",
  },
]

export const LESSONS = {
  token: "A token is a small word-part, about 4 characters. AI gives every token a mathematical value.",
  ttft: "Time to first token is the wait before the answer starts. Prefill, lookups, and network round trips all sit inside it.",
  tps: "Tokens per second per user is how fast the answer streams. Decode is limited by GPU memory bandwidth.",
  kv: "The KV cache is the GPU's notes on the prompt. A KV cache tier can park those notes and reload them so the next turn skips prefill.",
  hbm: "HBM is the GPU's own super-fast memory. Weights are loaded into it at start-up. Decode re-reads them from there.",
  nvlink: "NVLink joins GPUs so they act as one. NVL72 joins 72 of them.",
  rag: "RAG is an application step. The app searches an index and adds passages to the prompt before the model runs.",
  pue: "PUE compares total facility power to IT power. Lower is better. 1.38 is a published portfolio figure.",
  goodput: "Goodput counts only tokens delivered on time and well grounded. Late or poorly grounded tokens count less.",
  rightsize: "Idle GPUs still burn power and still cost capex. Building more than the job needs raises the cost of every good token.",
  network: "Every round trip rides the link you picked. Fiber is about 5 microseconds per kilometre. Public jitter can miss an SLA. Slow-to-provision links start earning later.",
  budget: "Every scenario has a budget, a power limit and a go-live deadline. The newest GPUs cost the most and arrive last. Prices are estimates, not quotes.",
  profit: "Score is efficiency: a low cost per million good tokens, demand met, on time, live before the deadline.",
  orca: "GPUs build the binding graph. ORCA's quantum accelerator samples for the max clique, raising hits per candidate. Large graphs gain more, and only if the GPUs are there.",
}

export const PRICE_NOTE = "All prices and lead times are estimates for the game, not quotes. Power, budgets and deadlines are game values."

export function byId(list, id) {
  return list.find((item) => item.id === id) || null
}
