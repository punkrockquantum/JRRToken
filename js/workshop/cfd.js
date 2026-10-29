/**
 * Workshop mode: the scenario and the four stations' tiles, and the engine that turns a team's
 * decisions into runs per night, cost, latency and a score. One module for the Worker (which scores
 * on SUBMIT BUILD and at the read-out) and the iPads (which show the live "what this does" line), so
 * every screen agrees with the leaderboard.
 *
 * THE SCENARIO (fiction, labelled as such on every screen): Apex Aero Racing, an F1-style
 * aerodynamics team, wants a CFD supercomputer. 1,500 engineers in Milton Keynes (UK) and Modena
 * (Italy) steer and watch the runs from their desks; the simulation data lives in the team's UK data
 * room at Milton Keynes; $9M of capex; live in 16 weeks; par is 40 overnight CFD runs a night.
 *
 * GAME ASSUMPTION (labelled): CFD throughput ∝ FP64 PFLOPS × interconnect efficiency × storage feed.
 * One "run" is 0.5 PFLOP-hours of sustained FP64 work (a transient run on a tens-of-millions-of-cells
 * mesh); the overnight window is 10 hours. Published FP64 figures the GPU tiles rest on (NVIDIA
 * datasheets and product pages, checked Oct 2026):
 *   - H100 SXM and H200 SXM: 34 TFLOPS FP64, 67 TFLOPS FP64 Tensor Core (same compute die; H200 adds
 *     141 GB of HBM3e at 4.8 TB/s). The game uses the 34 TF vector figure CFD solvers mostly see.
 *   - B200: 40 TFLOPS FP64 and 40 TFLOPS FP64 Tensor Core. GB200 NVL72: 3,240 TFLOPS FP64 Tensor
 *     Core per rack, i.e. 45 TF per GPU across 72 GPUs on one NVLink domain.
 *   - RTX PRO 6000 Blackwell Server Edition and L40S: no FP64 Tensor Cores; FP64 runs at 1/64 of
 *     FP32 (about 2 TF and 1.4 TF respectively, estimates), DGX Spark lower still. Inference parts.
 *   - Vera Rubin NVL72: FP64 to be confirmed (announced for the second half of 2026); not a tile,
 *     mentioned as TBC in the learn text.
 * Everything in money, weeks and efficiency is a game estimate; the comments beside each number say
 * where it comes from. Metros, distances, products and the power rules are the kiosk game's
 * (js/data.js, js/model.js, js/physics.js, js/refarch.js, js/netplan.js), imported, not copied.
 */
import { HALLS, METRO_POWER, SITES, byId } from "../data.js"
import { HEADROOM_GREEN, fitPowerMW, kmBetween, powerState } from "../model.js"
import { productById } from "../netplan.js"
import { ROUTE, roundTripS } from "../physics.js"
import { REFARCH } from "../refarch.js"

export const STATION_IDS = ["connectivity", "oems", "dcpower", "cfd"]

export const SCENARIO = {
  id: "cfd-f1",
  title: "Design a CFD supercomputer for an F1-style aero team",
  team: "Apex Aero Racing",
  fiction: "Apex Aero Racing is fictional. The metros, products, distances and GPU figures are real.",
  engineers: 1500,
  cities: [
    { id: "mk", name: "Milton Keynes, UK", short: "Milton Keynes", lat: 52.04, lon: -0.76, share: 0.6, dataRoom: true },
    { id: "mo", name: "Modena, Italy", short: "Modena", lat: 44.65, lon: 10.93, share: 0.4, dataRoom: false },
  ],
  budget: 9_000_000,
  goLiveWeeks: 16,
  parRuns: 40,
  nightHours: 10,
  pfHoursPerRun: 0.5,
  nightlyTB: 20,
  vizTargetMs: 30,
  ingestTargetH: 4,
  /** The 5-minute brief, four plain sentences. */
  brief: [
    "Apex Aero Racing (fictional) runs a wind-tunnel-in-software: every night its engineers queue CFD runs on the next car.",
    "1,500 engineers sit in Milton Keynes and Modena. The simulation data lives in the UK data room at Milton Keynes.",
    "You have $9M, 16 weeks until the season, and a target of 40 overnight runs a night.",
    "Four stations, a few tiles each, one pitch per station. Convince the architect at your table: approved first time scores best.",
  ],
}

/* ---------- tiles ---------- */

const METRO_LINES = {
  lon: "Next door to the UK data room; the dearest power on the list.",
  fra: "Between the two offices; mid-priced power.",
  par: "The cheapest power on the list; the farthest from the data.",
}

const hall = (id) => byId(HALLS, id)

/**
 * The four stations. Each decision has three tiles (connectivity has four); every tile is one plain
 * sentence plus a '?' learn text. `why` is the one-line "why this matters" under the station title.
 */
export const STATIONS = [
  {
    id: "connectivity",
    name: "CONNECTIVITY",
    short: "NET",
    why: "Engineers in two countries steer the runs from their desks, and every night's results must get home before morning.",
    decisions: [
      {
        id: "product",
        name: "How the offices and the data room reach the site",
        tiles: [
          {
            id: "public", title: "Public internet", line: "The shared road everyone uses: cheap, but slow and jittery for live 3D views, and a night's results take days to copy.",
            legs: { vizMk: "public", vizMo: "public", data: "public", inter: "public" }, gbps: 1, annual: 60_000, leadWeeks: 0,
            learn: "Transit across several networks: about 2.4× the straight-line distance plus 25 ms of hops, with jitter and a little loss (game assumption shaped by public measurements). A 20 TB night over a shared 1 Gbps path takes about 44 hours. About $60k a year (estimate).",
          },
          {
            id: "fabric", title: "ServiceFabric", line: "Digital Realty's private fabric to both offices: steady 3D views and a 10 Gbps port for the data.",
            legs: { vizMk: "fabric", vizMo: "fabric", data: "fabric", inter: "fabric" }, gbps: 10, annual: 180_000, leadWeeks: 3,
            learn: "ServiceFabric is Digital Realty's software-defined private interconnection to clouds, partners and other metros: lit fibre with a small forwarding overhead, almost no jitter, no loss (published; physics in js/physics.js). A connection goes live in minutes once the port exists (15-day port SLA, published). About $180k a year for a 10G port and the connections (estimate).",
          },
          {
            id: "fiber", title: "Cross Connect + Dark Fiber", line: "Your own glass to the UK data room and the Milton Keynes office: the fastest data link, but Modena stays on the internet.",
            legs: { vizMk: "fiber", vizMo: "public", data: "fiber", inter: "public" }, gbps: 100, annual: 300_000, leadWeeks: 12,
            learn: "Dark fibre is unlit glass you light yourself: pure physics delay and 100 Gbps or more, 8 to 16 weeks to light (game: 12), about $300k a year all in (estimate). A cross connect joins your racks to the carrier hand-off in the building. It reaches one far end; the Modena engineers still arrive over the public internet.",
          },
          {
            id: "combo", title: "COMBO: ServiceFabric + Dark Fiber", line: "Dark fiber for the data room, ServiceFabric for both offices: every leg private.",
            legs: { vizMk: "fiber", vizMo: "fabric", data: "fiber", inter: "fabric" }, gbps: 100, annual: 420_000, leadWeeks: 12,
            learn: "The data leg rides your own 100 Gbps fibre, the engineers' 3D views ride ServiceFabric to both offices, and the offices talk to each other over the same fabric. Dearest of the four (about $420k a year, estimate) and 12 weeks for the fibre; everything private.",
          },
        ],
      },
    ],
  },
  {
    id: "oems",
    name: "OEMs",
    short: "OEM",
    why: "The same GPUs come in different boxes: how dense, how cooled and how soon they arrive is the OEM's design.",
    decisions: [
      {
        id: "design",
        name: "Reference design",
        tiles: [
          {
            // js/refarch.js hgx-b: a large OEM's 6U 8-GPU HGX H100/H200 server, air, about 10.5 kW (Dell XE9680 spec sheet).
            id: "air-node", letter: "A", title: "A · Air-cooled 8-GPU node", line: "An ordinary air-cooled server, two to a rack, that fits any hall and ships a week early.",
            fits: ["h200", "rtx"], perRack: { h200: 2, rtx: 4 }, nodeKW: { h200: 10.5, rtx: 6.7 }, torKW: 1, cooling: "air", leadDelta: -1, priceMult: 0.97, refarch: "hgx-b",
            learn: "A 6U air-cooled 8-GPU node from a large OEM (figures rounded from the public spec sheet, js/refarch.js design B): two nodes a rack is about 22 kW with the switch. Fits the air hall with containment. Picking it for a rack-scale GPU means the OEM has to re-engineer: six weeks and 10% more.",
          },
          {
            // js/refarch.js hgx-d: a 5U 8-GPU node with direct liquid cooling on GPUs and CPUs (HPE Cray XD670 / Lenovo SR780a V3), about 10.6 kW.
            id: "liquid-node", letter: "B", title: "B · Direct-liquid 8-GPU node", line: "Cold plates on the GPUs: four nodes a rack, half the floor space, needs the liquid hall.",
            fits: ["h200"], perRack: { h200: 4 }, nodeKW: { h200: 10.6 }, torKW: 1, cooling: "liquid", leadDelta: 1, priceMult: 1.03, refarch: "hgx-d",
            learn: "A 5U HPC-OEM node with direct liquid cooling (js/refarch.js design D): four a rack is about 43 kW, so it needs the direct-liquid hall. A week longer and about 3% dearer than the air box (game values). Made for the HGX H200; it does not carry PCIe inference cards or NVL72 trays.",
          },
          {
            // js/refarch.js gb200-c: a volume OEM's GB200 NVL72 with an in-rack CDU, about 136 kW a rack.
            id: "nvl72-rack", letter: "C", title: "C · Rack-scale NVL72", line: "The whole rack arrives built: 18 trays, 72 GPUs, water to every tray, two weeks early.",
            fits: ["gb200"], perRack: { gb200: 1 }, rackKW: { gb200: 136 }, cooling: "liquid", leadDelta: -2, priceMult: 0.95, refarch: "gb200-c",
            learn: "A GB200 NVL72 rack from a volume OEM with the coolant distribution unit inside the rack (js/refarch.js design C): 18 compute trays, 9 NVLink switch trays, about 136 kW, direct liquid only. Two weeks quicker and about 5% cheaper than the reference rack (game values). It is only ever a GB200 rack.",
          },
        ],
      },
    ],
  },
  {
    id: "dcpower",
    name: "DATACENTER & POWER",
    short: "DC",
    why: "Where the racks sit sets the distance to the data and the price of power; the cooling must match the racks; the power block must fit the need.",
    decisions: [
      {
        id: "metro",
        name: "Digital Realty metro",
        tiles: ["lon", "fra", "par"].map((id) => ({ id, title: byId(SITES, id).metro, line: METRO_LINES[id] })),
      },
      {
        id: "cooling",
        name: "Cooling",
        tiles: [
          { id: "air", hall: "C", title: "Air (cold aisle containment)", line: "Ordinary air cooling with contained aisles: up to about 30 kW a rack, ready in 2 weeks." },
          { id: "rear-door", hall: "R", title: "Rear door heat exchanger", line: "A water-cooled door on every rack: air-cooled servers up to about 70 kW a rack, 6 weeks." },
          { id: "liquid", hall: "B", title: "Direct liquid", line: "Water to the chips: the only way to run 130 kW racks, 10 weeks to fit out." },
        ].map((tile) => ({ ...tile, capKW: hall(tile.hall).maxRackKW, pue: hall(tile.hall).pue, fitOutWeeks: hall(tile.hall).fitOutWeeks, rackNrc: hall(tile.hall).rackNrc, liquid: hall(tile.hall).cooling === "liquid", learn: hall(tile.hall).learn })),
      },
      {
        id: "power",
        name: "Contracted power block",
        /* The MW come from the chosen metro's ladder (METRO_POWER); these are the first three steps of it. */
        tiles: [
          { id: "block-0", title: "Smallest block", line: "The smallest block this metro sells." },
          { id: "block-1", title: "Middle block", line: "The next step up the metro's ladder." },
          { id: "block-2", title: "Biggest block", line: "Two steps up: plenty of headroom, and plenty of kilowatts nobody uses." },
        ],
      },
    ],
  },
  {
    id: "cfd",
    name: "CFD SUPERCOMPUTER",
    short: "CFD",
    why: "CFD is double-precision maths: pick GPUs with real FP64, enough of them, and a fabric and storage that keep them fed.",
    decisions: [
      {
        id: "gpu",
        name: "GPU class",
        tiles: [
          {
            // HGX H200 8-GPU node: 34 TF FP64 a GPU (NVIDIA H200 datasheet), about $350k a node (half the kiosk game's $700k two-node rack, js/data.js), 8 weeks (game).
            id: "h200", title: "HGX H200 nodes", line: "Eight proven FP64 GPUs a node: the workhorse of CFD clusters today.",
            fp64TF: 34, gpusPerUnit: 8, unit: "node", unitCapex: 350_000, leadWeeks: 8,
            learn: "NVIDIA H200 SXM: 34 TFLOPS FP64 (67 with FP64 Tensor Cores), 141 GB HBM3e at 4.8 TB/s, 700 W (datasheet). Eight on an NVLink board in one node, nodes joined by InfiniBand or Ethernet. About $350k a node and 8 weeks (game estimates).",
          },
          {
            // GB200 NVL72: 3,240 TF FP64 Tensor Core a rack = 45 TF a GPU (NVIDIA GB200 NVL72 page), $3.2M a rack and 16 weeks (js/data.js game values).
            id: "gb200", title: "GB200 NVL72 rack", line: "72 Blackwell GPUs on one NVLink, liquid-cooled: the most FP64 per rack you can buy.",
            fp64TF: 45, gpusPerUnit: 72, unit: "rack", unitCapex: 3_200_000, leadWeeks: 16,
            learn: "NVIDIA GB200 NVL72: 72 Blackwell GPUs and 36 Grace CPUs in one liquid-cooled rack, 3,240 TFLOPS FP64 Tensor Core a rack (45 TF a GPU), 130 TB/s of NVLink between every GPU (product page). About $3.2M a rack and 16 weeks (game estimates). Vera Rubin NVL72 follows in late 2026; its FP64 is TBC, so it is not on the board.",
          },
          {
            // RTX PRO 6000 Blackwell Server Edition: FP64 at 1/64 of ~125 TF FP32 ≈ 2 TF (estimate; not a published headline). 8-GPU MGX air server about $140k (game), 4 weeks.
            id: "rtx", title: "RTX PRO 6000 servers", line: "Cheap, in stock, great for AI chat: almost no FP64, so CFD crawls.", trap: true,
            fp64TF: 2, gpusPerUnit: 8, unit: "server", unitCapex: 140_000, leadWeeks: 4,
            learn: "RTX PRO 6000 Blackwell Server Edition: 96 GB GDDR7, FP4 and FP8 tensor maths for inference (datasheet), but no FP64 Tensor Cores: double precision runs at about 1/64 of FP32, roughly 2 TFLOPS a card (estimate). L40S and DGX Spark are the same story. Fine for the team's chatbot, wrong for CFD.",
          },
        ],
      },
      {
        id: "size",
        name: "Cluster size",
        tiles: [
          {
            id: "small", title: "Small", line: "Half a medium cluster: cheapest to buy and to power.", units: { h200: 4, gb200: 1, rtx: 4 },
            learn: "Small means 4 HGX H200 nodes (32 GPUs), 1 GB200 NVL72 rack (72 GPUs) or 4 RTX PRO servers (32 GPUs). Runs a night scale with FP64 PFLOPS × fabric efficiency: a single NVL72 rack already clears the 40-run par.",
          },
          {
            id: "medium", title: "Medium", line: "The middle of the road: twice the small cluster.", units: { h200: 8, gb200: 2, rtx: 8 },
            learn: "Medium means 8 HGX H200 nodes (64 GPUs), 2 NVL72 racks (144 GPUs) or 8 RTX PRO servers (64 GPUs). Twice the capex and power of small; check the budget ($9M) and the power block before you pitch it.",
          },
          {
            id: "large", title: "Large", line: "Twice the medium: the most runs, if the budget and the power block can take it.", units: { h200: 16, gb200: 3, rtx: 16 },
            learn: "Large means 16 HGX H200 nodes (128 GPUs), 3 NVL72 racks (216 GPUs) or 16 RTX PRO servers (128 GPUs). Three NVL72 racks break the $9M budget and need about 0.5 MW; sixteen RTX servers still cannot do CFD.",
          },
        ],
      },
      {
        id: "fabric",
        name: "Interconnect + storage",
        tiles: [
          {
            id: "ethernet", title: "Ethernet + file storage", line: "Standard networking and a file server: cheap, but the solvers wait on the network.",
            efficiency: { h200: 0.55, gb200: 0.7, rtx: 0.55 }, perGpu: 2_000, fixed: 200_000,
            learn: "Ordinary 100G Ethernet between nodes and an NFS or object store feeding them: fine for AI inference, poor for CFD, whose solvers exchange boundary data every time step and read the mesh from every node at once. Game efficiency 55% (70% inside an NVL72 rack, where the rack's own NVLink does most of the work).",
          },
          {
            id: "infiniband", title: "InfiniBand + parallel file system", line: "The HPC standard: fast GPU-to-GPU messages and storage that feeds every node at once.",
            efficiency: { h200: 0.85, gb200: 0.85, rtx: 0.85 }, perGpu: 8_000, fixed: 600_000,
            learn: "NDR 400G InfiniBand with RDMA between nodes and a parallel file system (Lustre or GPFS class) striped across many servers: the way the TOP500's CFD machines are built. Game efficiency 85%. About $8k a GPU plus $600k of storage (estimates).",
          },
          {
            id: "nvlink", title: "NVLink-scale fabric + GPU-adjacent storage", line: "The whole rack acts as one GPU, with NVMe right next to it.",
            efficiency: { h200: 0.88, gb200: 0.95, rtx: 0.88 }, perGpu: 10_000, fixed: 800_000,
            learn: "NVLink joins all 72 GPUs of an NVL72 rack at 130 TB/s, and GPU-adjacent NVMe (GPUDirect Storage) feeds them without the CPU in the way: game efficiency 95%. With 8-GPU nodes NVLink stays inside the node and InfiniBand carries the rest, so it buys little over plain InfiniBand (88%). About $10k a GPU plus $800k (estimates).",
          },
        ],
      },
    ],
  },
]

export function stationById(id) {
  return STATIONS.find((station) => station.id === id) || null
}

export function decisionOf(stationId, decisionId) {
  return stationById(stationId)?.decisions.find((decision) => decision.id === decisionId) || null
}

export function tileOf(stationId, decisionId, tileId) {
  return decisionOf(stationId, decisionId)?.tiles.find((tile) => tile.id === tileId) || null
}

/** A station's default choices: the first tile of every decision (the cheap, naive answer). */
export function defaultChoices(stationId) {
  const station = stationById(stationId)
  return Object.fromEntries((station?.decisions || []).map((decision) => [decision.id, decision.tiles[0].id]))
}

/** Every station's defaults. */
export function blankChoices() {
  return Object.fromEntries(STATION_IDS.map((id) => [id, defaultChoices(id)]))
}

/**
 * Checks a station's choices object: every decision present, every tile id known, nothing else.
 * Returns { ok, choices, errors }.
 */
export function validateChoices(stationId, raw) {
  const station = stationById(stationId)
  const errors = []
  if (!station) return { ok: false, choices: null, errors: [`Unknown station "${stationId}".`] }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, choices: null, errors: ["choices must be an object of decision → tile."] }
  const choices = {}
  for (const decision of station.decisions) {
    const value = raw[decision.id]
    if (typeof value !== "string" || !decision.tiles.some((tile) => tile.id === value)) errors.push(`${decision.id}: pick one of ${decision.tiles.map((tile) => tile.id).join(", ")}.`)
    else choices[decision.id] = value
  }
  for (const key of Object.keys(raw)) if (!station.decisions.some((decision) => decision.id === key)) errors.push(`${key} is not a decision at this station.`)
  return { ok: errors.length === 0, choices: errors.length ? null : choices, errors }
}

/** Fills missing stations or decisions with the defaults (unsubmitted teams are scored on what they had). */
export function completeChoices(partial = {}) {
  const out = blankChoices()
  for (const stationId of STATION_IDS) {
    const given = partial?.[stationId]
    if (!given || typeof given !== "object") continue
    for (const decision of stationById(stationId).decisions) {
      if (decision.tiles.some((tile) => tile.id === given[decision.id])) out[stationId][decision.id] = given[decision.id]
    }
  }
  return out
}

/* ---------- geometry and metro facts ---------- */

/** Distances from one metro to each city and to the data room, in km (great circle, js/model.js). */
export function metroGeometry(metroId) {
  const site = byId(SITES, metroId)
  if (!site) return null
  const cities = SCENARIO.cities.map((city) => ({ ...city, km: Math.round(kmBetween(site, city)) }))
  const dataRoom = cities.find((city) => city.dataRoom)
  return { id: metroId, metro: site.metro, cities, dataKm: dataRoom.km, power: METRO_POWER[metroId]?.power || { mwh: 100, kwMonth: 25 } }
}

/** The three power blocks a metro offers in this game: the first three steps of its ladder (js/data.js METRO_POWER). */
export function powerLadder(metroId) {
  return (METRO_POWER[metroId]?.blocksMW || [0.25, 0.5, 1]).slice(0, 3)
}

/** The MW behind a block tile in a metro. */
export function blockMW(metroId, blockId) {
  const index = Number(String(blockId).replace("block-", ""))
  const ladder = powerLadder(metroId)
  return ladder[Math.min(ladder.length - 1, Math.max(0, Number.isInteger(index) ? index : 0))]
}

/* ---------- the engine ---------- */

export const RUNS_CAP = 1.4
/** +2% for every $1M of the budget left unspent: an F1 team under a cost cap puts that money on the car. Breaks the tie between builds that all hit the runs cap. */
export const VALUE_PER_M = 0.02
/** The thoughtful build: the top of the whole tile space (scripts/balance-workshop.mjs proves it). The read-out measures a table's gap to it. */
export const REFERENCE_BUILD = Object.freeze({
  connectivity: { product: "combo" },
  oems: { design: "nvl72-rack" },
  dcpower: { metro: "lon", cooling: "liquid", power: "block-0" },
  cfd: { gpu: "gb200", size: "small", fabric: "nvlink" },
})
export const SEND_BACK_PENALTY = 0.03
export const APPROVAL_FLOOR = 0.85
export const POWER_FACTORS = { green: 1, amber: 0.9, red: 0.75 }
export const LATE_PER_WEEK = 0.05
export const LATE_FLOOR = 0.7
export const BUDGET_FLOOR = 0.5
export const SCORE_FLOOR = 100
/** Encoding, rendering and display add about 8 ms to a remote 3D frame (game assumption). */
export const RENDER_MS = 8
/** The OEM re-engineers a design for a GPU it was not made for: weeks and money (game values). */
export const MISMATCH_WEEKS = 6
export const MISMATCH_PRICE = 1.1
/** A liquid-cooled design in an air hall barely runs; a rack past the hall's kW cap throttles to it. */
export const LIQUID_IN_AIR = 0.35
const HOURS_PER_YEAR = 8760

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value))

/** Frame latency (ms) for a remote 3D view over `km` on one physics row: round trip, jitter on the shared roads, plus rendering. */
export function frameLatencyMs(km, routeId) {
  const rtt = roundTripS(km, routeId)
  const jitter = rtt * (ROUTE[routeId]?.jitterFrac || 0)
  return (rtt + jitter) * 1000 + RENDER_MS
}

/** Hours to move `tb` terabytes at `gbps` (the whole pipe, game). */
export function transferHours(tb, gbps) {
  if (!(gbps > 0)) return Infinity
  return (tb * 8000) / gbps / 3600
}

/** 1.0 up to the target, then down 0.2 across the next span, then 0.8 → 0.7 across another span. */
function softFactor(value, target, span) {
  if (value <= target) return 1
  if (value <= target + span) return 1 - 0.2 * ((value - target) / span)
  return clamp(0.8 - 0.1 * ((value - target - span) / span), 0.7, 0.8)
}

/** The connectivity legs for a metro and a product: each with its route, km, latency and label. */
export function connectivityLegs(metroId, productId) {
  const geometry = metroGeometry(metroId)
  const product = tileOf("connectivity", "product", productId) || tileOf("connectivity", "product", "public")
  const [mk, mo] = geometry.cities
  const interKm = Math.round(kmBetween(mk, mo))
  const leg = (id, name, km, routeId, kind) => ({ id, name, km, routeId, product: productById(routeId === "fiber" ? "fiber" : routeId === "fabric" ? "fabric" : "public")?.label || routeId, kind, rttMs: Math.round(roundTripS(km, routeId) * 1000 * 10) / 10 })
  const legs = [
    { ...leg("viz-mk", `${mk.short} engineers → site (remote 3D)`, mk.km, product.legs.vizMk, "viz"), frameMs: Math.round(frameLatencyMs(mk.km, product.legs.vizMk)), share: mk.share },
    { ...leg("viz-mo", `${mo.short} engineers → site (remote 3D)`, mo.km, product.legs.vizMo, "viz"), frameMs: Math.round(frameLatencyMs(mo.km, product.legs.vizMo)), share: mo.share },
    { ...leg("data", `UK data room ↔ site (${SCENARIO.nightlyTB} TB a night)`, geometry.dataKm, product.legs.data, "data"), gbps: product.gbps, hours: Math.round(transferHours(SCENARIO.nightlyTB, product.gbps) * 10) / 10 },
    { ...leg("inter", `${mk.short} office ↔ ${mo.short} office`, interKm, product.legs.inter, "inter") },
  ]
  const frameMs = Math.round(legs[0].frameMs * mk.share + legs[1].frameMs * mo.share)
  return { product, legs, frameMs, ingestHours: legs[2].hours, gbps: product.gbps, annual: product.annual, leadWeeks: product.leadWeeks }
}

/**
 * Evaluates a complete set of choices (completeChoices first when a team may have gaps). Returns every
 * number the screens, the score and the read-out need. `sendBacks` is the session's count of
 * SEND BACKs across the four stations.
 */
export function evaluateWorkshop(choices, { sendBacks = 0 } = {}) {
  const c = completeChoices(choices)
  const gpu = tileOf("cfd", "gpu", c.cfd.gpu)
  const size = tileOf("cfd", "size", c.cfd.size)
  const fabric = tileOf("cfd", "fabric", c.cfd.fabric)
  const design = tileOf("oems", "design", c.oems.design)
  const cooling = tileOf("dcpower", "cooling", c.dcpower.cooling)
  const geometry = metroGeometry(c.dcpower.metro)
  const net = connectivityLegs(c.dcpower.metro, c.connectivity.product)

  /* Compute */
  const units = size.units[gpu.id]
  const gpus = units * gpu.gpusPerUnit
  const pflops = (gpus * gpu.fp64TF) / 1000
  const efficiency = fabric.efficiency[gpu.id]

  /* Racks and power */
  const mismatch = !design.fits.includes(gpu.id)
  const perRack = mismatch ? fallbackPerRack(gpu.id) : design.perRack[gpu.id]
  const racks = gpu.unit === "rack" ? units : Math.ceil(units / perRack)
  const rackKW = gpu.unit === "rack" ? (mismatch ? 132 : design.rackKW[gpu.id]) : Math.min(units, perRack) * (mismatch ? fallbackNodeKW(gpu.id) : design.nodeKW[gpu.id]) + (design.torKW || 1)
  const designCooling = mismatch ? (gpu.unit === "rack" ? "liquid" : "air") : design.cooling
  const itKW = Math.round(racks * rackKW)
  const facilityKW = Math.round(itKW * cooling.pue)
  const liquidInAir = designCooling === "liquid" && !cooling.liquid
  const tooHot = !liquidInAir && rackKW > cooling.capKW * 1.05
  const coolFactor = liquidInAir ? LIQUID_IN_AIR : tooHot ? clamp(cooling.capKW / rackKW, 0.3, 1) : 1
  const ladder = powerLadder(c.dcpower.metro)
  const mw = blockMW(c.dcpower.metro, c.dcpower.power)
  const capKW = mw * 1000
  const shortKW = Math.max(0, facilityKW - capKW)
  const headroom = capKW > 0 ? (capKW - facilityKW) / capKW : -1
  const powerRow = { chosen: true, needKW: facilityKW, capKW, mw, ladder, shortKW }
  const power = powerState(powerRow)
  const fitMW = fitPowerMW(facilityKW, ladder)
  const throttle = shortKW > 0 ? capKW / facilityKW : 1
  const powerAnnual = Math.round(capKW * geometry.power.kwMonth * 12 + (facilityKW * HOURS_PER_YEAR * geometry.power.mwh) / 1000)

  /* Runs per night */
  const runs = (pflops * efficiency * coolFactor * throttle * SCENARIO.nightHours) / SCENARIO.pfHoursPerRun
  const runsFactor = Math.min(RUNS_CAP, runs / SCENARIO.parRuns)

  /* Money and time */
  const computeCapex = units * gpu.unitCapex * design.priceMult * (mismatch ? MISMATCH_PRICE : 1)
  const fabricCapex = gpus * fabric.perGpu + fabric.fixed
  const coolingCapex = racks * cooling.rackNrc
  const capex = Math.round(computeCapex + fabricCapex + coolingCapex)
  const budgetFactor = capex <= SCENARIO.budget ? 1 : Math.max(BUDGET_FLOOR, (SCENARIO.budget / capex) ** 2)
  const moneyLeft = Math.max(0, SCENARIO.budget - capex)
  const valueFactor = 1 + VALUE_PER_M * (moneyLeft / 1e6)
  const leadWeeks = Math.max(gpu.leadWeeks + design.leadDelta + (mismatch ? MISMATCH_WEEKS : 0), cooling.fitOutWeeks, net.leadWeeks)
  const lateWeeks = Math.max(0, leadWeeks - SCENARIO.goLiveWeeks)
  const lateFactor = Math.max(LATE_FLOOR, 1 - LATE_PER_WEEK * lateWeeks)

  /* Latency */
  const vizFactor = softFactor(net.frameMs, SCENARIO.vizTargetMs, 70)
  const ingestFactor = softFactor(net.ingestHours, SCENARIO.ingestTargetH, 20)
  const latencyFactor = vizFactor * ingestFactor

  const approvalFactor = Math.max(APPROVAL_FLOOR, 1 - SEND_BACK_PENALTY * Math.max(0, sendBacks))
  const powerFactor = POWER_FACTORS[power]
  const raw = 1000 * runsFactor * approvalFactor * budgetFactor * powerFactor * latencyFactor * lateFactor * valueFactor
  const score = Math.max(SCORE_FLOOR, Math.round(raw))

  return {
    choices: c,
    gpu: { id: gpu.id, title: gpu.title, trap: Boolean(gpu.trap), fp64TF: gpu.fp64TF, gpus, units, unit: gpu.unit },
    pflops: Math.round(pflops * 100) / 100,
    efficiency,
    design: { id: design.id, letter: design.letter, title: design.title, mismatch, cooling: designCooling },
    racks,
    rackKW: Math.round(rackKW * 10) / 10,
    cooling: { id: cooling.id, title: cooling.title, capKW: cooling.capKW, pue: cooling.pue, liquid: cooling.liquid, liquidInAir, tooHot },
    coolFactor: Math.round(coolFactor * 100) / 100,
    metro: { id: geometry.id, name: geometry.metro, dataKm: geometry.dataKm, cities: geometry.cities.map((city) => ({ id: city.id, name: city.short, km: city.km })), mwh: geometry.power.mwh },
    power: { state: power, mw, capKW, itKW, facilityKW, shortKW, headroomPct: Math.round(headroom * 100), fitMW, ladder, greenBand: HEADROOM_GREEN, throttle: Math.round(throttle * 100) / 100, annual: powerAnnual },
    net: { product: net.product.id, title: net.product.title, legs: net.legs, frameMs: net.frameMs, ingestHours: net.ingestHours, gbps: net.gbps, annual: net.annual, private: net.product.id !== "public", allPrivate: net.legs.every((leg) => leg.routeId !== "public") },
    runs: Math.round(runs * 10) / 10,
    parRuns: SCENARIO.parRuns,
    capex,
    budget: SCENARIO.budget,
    overBudget: capex > SCENARIO.budget,
    moneyLeft,
    annualOpex: powerAnnual + net.annual,
    leadWeeks,
    goLiveWeeks: SCENARIO.goLiveWeeks,
    lateWeeks,
    sendBacks,
    factors: {
      runs: round3(runsFactor),
      approval: round3(approvalFactor),
      budget: round3(budgetFactor),
      power: round3(powerFactor),
      latency: round3(latencyFactor),
      viz: round3(vizFactor),
      ingest: round3(ingestFactor),
      late: round3(lateFactor),
      value: round3(valueFactor),
    },
    score,
  }
}

function round3(value) {
  return Math.round(value * 1000) / 1000
}

/** When the OEM design does not fit the GPU: the GPU maker's own box carries it, re-engineered (js/refarch.js reference designs). */
function fallbackPerRack(gpuId) {
  if (gpuId === "gb200") return 1
  const reference = (REFARCH[gpuId === "rtx" ? "rtx6000" : gpuId] || []).find((design) => design.reference)
  return reference ? Math.max(1, Math.floor(42 / reference.u)) : 2
}

function fallbackNodeKW(gpuId) {
  const reference = (REFARCH[gpuId === "rtx" ? "rtx6000" : gpuId] || []).find((design) => design.reference)
  return reference?.nodeKW || 10
}

/** The score alone, for the enumerations (balance script, read-out alternatives). */
export function scoreWorkshop(choices, options) {
  return evaluateWorkshop(choices, options).score
}

/* ---------- the live "what this does" line and the tile facts ---------- */

export function formatMoney(value) {
  const n = Number(value) || 0
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1).replace(/\.0$/, "")}M`
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}k`
  return `$${Math.round(n)}`
}

/** "runs 62 a night · cost $4.6M of $9M · 3D view 14 ms · live in 14 wk" for one evaluation. */
export function summaryLine(result) {
  const r = result
  return `${r.runs} runs a night (par ${r.parRuns}) · ${formatMoney(r.capex)} of ${formatMoney(r.budget)}${r.overBudget ? " OVER" : ""} · 3D view ${r.net.frameMs} ms · data ${r.net.ingestHours} h · power ${r.power.mw} MW for ${r.power.facilityKW} kW (${r.power.state}) · live in ${r.leadWeeks} wk`
}

/** The station's own line: what its decisions do, in that station's terms. */
export function stationLine(stationId, result) {
  const r = result
  if (stationId === "connectivity") return `3D view ${r.net.frameMs} ms (target ${SCENARIO.vizTargetMs}) · night's data home in ${r.net.ingestHours} h (target ${SCENARIO.ingestTargetH}) · ${formatMoney(r.net.annual)} a year`
  if (stationId === "oems") return `${r.racks} rack${r.racks === 1 ? "" : "s"} at ${r.rackKW} kW · ${r.design.cooling} cooled${r.design.mismatch ? " · DOES NOT FIT THIS GPU: +6 wk, +10%" : ""} · live in ${r.leadWeeks} wk`
  if (stationId === "dcpower") return `${r.power.facilityKW} kW needed · ${r.power.mw} MW block (${r.power.headroomPct >= 0 ? `${r.power.headroomPct}% headroom` : `${-r.power.headroomPct}% short`}, ${r.power.state}) · ${r.cooling.liquidInAir ? "liquid racks in an air hall" : r.cooling.tooHot ? "racks too hot for this cooling" : "cooling fits"} · data ${r.metro.dataKm} km away`
  return `${r.gpu.gpus} GPUs · ${r.pflops} PFLOPS FP64 · ${r.runs} runs a night (par ${r.parRuns}) · ${formatMoney(r.capex)} of ${formatMoney(r.budget)}${r.overBudget ? " OVER BUDGET" : ""}`
}

/** The metro tile's facts for the iPad: distances and power price, from the real coordinates and the metro table. */
export function metroFacts(metroId) {
  const g = metroGeometry(metroId)
  if (!g) return ""
  return `${g.cities.map((city) => `${city.short} ${city.km.toLocaleString("en-GB")} km`).join(" · ")} · data ${g.dataKm} km · $${g.power.mwh}/MWh (est.)`
}

/** The '?' text for a tile, with the metro and power tiles filled from the tables. */
export function tileLearn(stationId, decisionId, tileId, metroId = "lon") {
  const tile = tileOf(stationId, decisionId, tileId)
  if (!tile) return ""
  if (decisionId === "metro") {
    const g = metroGeometry(tileId)
    return `${g.metro} is a real Digital Realty metro. From here: ${g.cities.map((city) => `${city.name} is ${city.km.toLocaleString("en-GB")} km`).join(", ")}, and the UK data room is ${g.dataKm} km. Power about $${g.power.mwh}/MWh and $${g.power.kwMonth} a kW-month reserved; blocks of ${powerLadder(tileId).join(" / ")} MW (game estimates shaped by public price statistics, js/data.js).`
  }
  if (decisionId === "power") {
    const mw = blockMW(metroId, tileId)
    const [lo, hi] = HEADROOM_GREEN
    return `${mw} MW contracted in ${byId(SITES, metroId)?.metro || metroId}. The need is the racks' IT power times the hall's overhead (PUE). Green is ${Math.round(lo * 100)}–${Math.round(hi * 100)}% of headroom, or the smallest block that leaves ${Math.round(lo * 100)}%; too small throttles the racks and risks a trip; a block two steps too big pays for kilowatts nobody uses.`
  }
  return tile.learn || tile.line
}

/** Tile titles with the live MW for the power row in a metro. */
export function powerTileTitle(metroId, tileId) {
  return `${blockMW(metroId, tileId)} MW`
}
