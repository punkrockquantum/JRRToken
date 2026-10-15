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

export const PLATFORMS = [
  {
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

export const USE_CASES = [
  {
    id: "chat",
    name: "Customer Chat",
    npc: "Chatty",
    icon: "iconChat",
    blurb: "A help-desk assistant for millions of shoppers. Short questions, fast answers.",
    model: "70B dense LLM",
    activeB: 70,
    weightsGB: 70,
    moe: false,
    ctx: 4000,
    outTokens: 300,
    kvMBPerTok: 0.16,
    tps: 30,
    ttft: 0.6,
    demand: 600000,
    netDest: { user: "internet" },
    netWhy: "Shoppers arrive from the internet. Give each leg its own path.",
    legs: [
      { id: "users", name: "USERS → SITE", hint: "ingress · one per metro · latency", role: "ingress", dest: "internet", trips: 1, bw: 1, jitter: 1, sensitive: true, critical: true, when: "always" },
      { id: "inter", name: "INTER-SITE", hint: "only with 2–3 metros", role: "inter", dest: "metro", trips: 0.4, bw: 0.35, jitter: 0.5, sensitive: true, critical: true, when: "multi" },
      { id: "control", name: "CONTROL", hint: "optional · where MCP sits", role: "control", dest: "internet", trips: 0, bw: 0.02, jitter: 0, sensitive: false, critical: false, when: "optional" },
    ],
    parCost: 0.38414437209943497,
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
    model: "70B dense LLM + retrieval",
    activeB: 70,
    weightsGB: 70,
    moe: false,
    ctx: 16000,
    outTokens: 400,
    kvMBPerTok: 0.16,
    tps: 25,
    ttft: 1.5,
    demand: 150000,
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
    model: "400B mixture-of-experts",
    activeB: 17,
    weightsGB: 400,
    moe: true,
    ctx: 64000,
    outTokens: 800,
    kvMBPerTok: 0.12,
    tps: 60,
    ttft: 3,
    demand: 420000,
    netDest: { user: "internet", retrieval: "cloud", tool: "partner" },
    netWhy: "Developers arrive from the internet. Tool calls and repos are a separate, chatty path.",
    legs: [
      { id: "users", name: "USERS / IDE → SITE", hint: "ingress · latency", role: "ingress", dest: "internet", trips: 1, bw: 0.4, jitter: 1, sensitive: true, critical: true, when: "always" },
      { id: "tools", name: "SITE → TOOLS / REPOS", hint: "many tool-call trips", role: "tools", dest: "partner", trips: 8, bw: 0.8, jitter: 1, sensitive: true, critical: true, when: "always" },
      { id: "inter", name: "INTER-SITE", hint: "only with 2–3 metros", role: "inter", dest: "metro", trips: 1, bw: 0.3, jitter: 0.5, sensitive: true, critical: true, when: "multi" },
      { id: "control", name: "CONTROL", hint: "optional · where MCP sits", role: "control", dest: "partner", trips: 0, bw: 0.02, jitter: 0, sensitive: false, critical: false, when: "optional" },
    ],
    parCost: 0.5073665934936242,
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
    model: "671B reasoning MoE",
    activeB: 37,
    weightsGB: 700,
    moe: true,
    ctx: 32000,
    outTokens: 4000,
    kvMBPerTok: 0.07,
    tps: 40,
    ttft: 5,
    demand: 700000,
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
    model: "15B protein & chemistry models",
    activeB: 15,
    weightsGB: 15,
    moe: false,
    ctx: 2000,
    outTokens: 500,
    kvMBPerTok: 0.05,
    tps: 40,
    ttft: 20,
    demand: 1300000,
    netDest: { user: "partner", retrieval: "partner" },
    netWhy: "The lab ships bulk data to the site. ORCA sits in the same hall as the GPUs.",
    legs: [
      // slaExempt (game assumption): the bulk lab leg pays no jitter or SLA haircut on the public
      // internet; only the link's bandwidth limits how many candidates are screened per hour.
      { id: "lab", name: "LAB / DATA → SITE", hint: "bulk · latency-insensitive", role: "lab", dest: "partner", trips: 0.05, bw: 6, jitter: 0, sensitive: false, critical: true, when: "always", slaExempt: true },
      { id: "orca", name: "GPU ↔ ORCA", hint: "same-hall hand-off", role: "orca", dest: "partner", trips: 1, bw: 0.15, jitter: 0.2, sensitive: false, critical: false, when: "orca" },
      { id: "control", name: "CONTROL", hint: "optional · where MCP sits", role: "control", dest: "partner", trips: 0, bw: 0.02, jitter: 0, sensitive: false, critical: false, when: "optional" },
    ],
    parCost: 0.04864189619954892,
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
    model: "8B vision-language-action",
    activeB: 8,
    weightsGB: 8,
    moe: false,
    ctx: 512,
    outTokens: 64,
    kvMBPerTok: 0.02,
    tps: 80,
    ttft: 0.05,
    demand: 220000,
    netDest: { user: "partner" },
    netWhy: "Robots sit on a private factory network. The public internet is too slow and too jittery for a 50 ms answer.",
    legs: [
      { id: "users", name: "FACTORY → SITE", hint: "ingress · milliseconds", role: "ingress", dest: "partner", trips: 2, bw: 1.2, jitter: 2, sensitive: true, critical: true, when: "always" },
      { id: "inter", name: "INTER-SITE", hint: "only with 2 metros", role: "inter", dest: "metro", trips: 0.4, bw: 0.3, jitter: 1, sensitive: true, critical: true, when: "multi" },
      { id: "control", name: "CONTROL", hint: "optional · where MCP sits", role: "control", dest: "partner", trips: 0, bw: 0.02, jitter: 0, sensitive: false, critical: false, when: "optional" },
    ],
    parCost: 0.1315125223528696, // recalibrated so the COMBO (plant carriers on cross connects) best scores 1,400
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
  drug: { where: "A lab in Cambridge, UK", users: "One lab in Cambridge, UK", budget: 8_000_000, powerMW: 0.18, deadlineWeeks: 30, pricePerM: 0.1 },
  robot: { where: "Factory floors near Frankfurt and Amsterdam", users: "Stuttgart (70%) and Rotterdam (30%)", budget: 9_000_000, powerMW: 0.5, deadlineWeeks: 16, pricePerM: 0.8 },
}

/**
 * Where the model weights and the training or reference data live today. Scenario fiction
 * on real metros: a copy to a far metro takes link time and egress money, and every retrieval
 * or tool trip runs the distance from the chosen site to this place. `corpusTB` is the data
 * that must move with the weights (documents, repos, papers, candidate libraries).
 */
export const DATA_HOMES = {
  chat: { city: "Ashburn", lat: 39.04, lon: -77.49, kind: "cloud", label: "a public cloud region in Northern Virginia (Ashburn)", what: "70 GB of weights and 2 TB of fine-tuning data", corpusTB: 2 },
  rag: { city: "Frankfurt", lat: 50.11, lon: 8.68, kind: "cloud", label: "the company's cloud tenancy in Frankfurt", what: "70 GB of weights and 30 TB of documents", corpusTB: 30 },
  code: { city: "Ashburn", lat: 39.04, lon: -77.49, kind: "cloud", label: "a cloud region in Northern Virginia (Ashburn)", what: "400 GB of weights and 80 TB of repos", corpusTB: 80 },
  research: { city: "Paris", lat: 48.86, lon: 2.35, kind: "cloud", label: "a sovereign cloud region in Paris", what: "700 GB of weights and 400 TB of papers", corpusTB: 400 },
  // The scientists sit in Cambridge; their candidate libraries live in a public cloud region in Dublin,
  // so every metro is a different distance from the users and from the data.
  drug: { city: "Dublin", lat: 53.35, lon: -6.26, kind: "cloud", label: "the lab's cloud tenancy in Dublin", what: "15 GB of models and 250 TB of candidate libraries", corpusTB: 250 },
  robot: { city: "Frankfurt", lat: 50.11, lon: 8.68, kind: "own", label: "the carmaker's training cluster in Frankfurt", what: "8 GB of weights and 12 TB of driving logs", corpusTB: 12 },
}

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
  chat: { tokensPerTask: 300, humanMinutes: 1.5, share: 0.35, loadedCost: 55_000, fteCap: 25_000, savingsPar: 678517145.6702592 },
  rag: { tokensPerTask: 400, humanMinutes: 4, share: 0.4, loadedCost: 90_000, fteCap: 10_000, savingsPar: 522477277.3545038 },
  code: { tokensPerTask: 800, humanMinutes: 25, share: 0.5, loadedCost: 160_000, fteCap: 8_000, savingsPar: 844232144.1586552 },
  research: { tokensPerTask: 4000, humanMinutes: 90, share: 0.5, loadedCost: 130_000, fteCap: 3_000, savingsPar: 257086797.08384013 },
  drug: { tokensPerTask: 500, humanMinutes: 3, share: 0.6, loadedCost: 150_000, fteCap: 2_000, savingsPar: 289710962.61 },
  robot: { tokensPerTask: 64, humanMinutes: 2, share: 0.3, loadedCost: 75_000, fteCap: 1_500, savingsPar: 88571871.14648634 },
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

/** Where each mission's users sit (game assumption). Shares sum to 1. */
export const USER_BASES = {
  chat: {
    name: "Shoppers in London and Frankfurt",
    places: [
      { city: "London", lat: 51.51, lon: -0.13, share: 0.6 },
      { city: "Frankfurt", lat: 50.11, lon: 8.68, share: 0.4 },
    ],
  },
  rag: {
    name: "Corporate HQ in London",
    places: [{ city: "London", lat: 51.51, lon: -0.13, share: 1 }],
  },
  code: {
    name: "Developers on the US east and west coasts",
    places: [
      { city: "New York", lat: 40.71, lon: -74.01, share: 0.4 },
      { city: "Toronto", lat: 43.65, lon: -79.38, share: 0.25 },
      { city: "San Francisco", lat: 37.77, lon: -122.42, share: 0.25 },
      { city: "Seattle", lat: 47.61, lon: -122.33, share: 0.1 },
    ],
  },
  research: {
    name: "Analysts in London and Paris",
    places: [
      { city: "London", lat: 51.51, lon: -0.13, share: 0.6 },
      { city: "Paris", lat: 48.86, lon: 2.35, share: 0.4 },
    ],
  },
  drug: {
    name: "Lab in Cambridge, UK",
    places: [{ city: "Cambridge", lat: 52.2, lon: 0.12, share: 1 }],
  },
  robot: {
    name: "Factory floors in Germany and the Netherlands",
    places: [
      { city: "Stuttgart", lat: 48.78, lon: 9.18, share: 0.7 },
      { city: "Rotterdam", lat: 51.92, lon: 4.48, share: 0.3 },
    ],
  },
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
  h100: "The classic: cheap and air-cooled, but slow memory and small NVLink islands.",
  h200: "Hopper with more, faster memory: fits bigger models per GPU.",
  b200: "Blackwell with FP4: roughly double Hopper's tokens, still air-cooled.",
  b300: "Blackwell Ultra: the strongest air-cooled rack.",
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
