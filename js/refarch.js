/**
 * Reference architectures for the nerd GPU step: three or four anonymised server or rack
 * designs per GPU platform, drawn from the public datasheets that the comments beside each
 * design point to. Players see a letter and a form factor ("B · 6U air node"), never a vendor
 * name; the figures are rounded from the datasheets and marked "about" in the copy.
 *
 * Pure helpers: the designs behind a platform, how many nodes one rack takes at the hall's
 * power cap, how many racks the build needs, the lead band, and the modest game effect
 * (rack power, lead time, price) of picking a design. The GPU count never changes: the
 * platform's tokens per GPU, HBM and NVLink domain are the platform's, whoever sells the box.
 * Lead deltas and price multipliers are game values: OEM delivery and pricing are not published.
 */
import { HALLS, PLATFORMS, byId } from "./data.js"

/** Usable rack height for node designs (game value; rack-scale designs bring their own rack). */
export const RACK_U = 42

/* The Hopper 8-GPU HGX node family: HGX H100 and HGX H200 ship in the same chassis designs. */
const HOPPER_NODES = [
  {
    // NVIDIA DGX H100 / DGX H200 datasheets: 8U, 2× Xeon Platinum 8480C, 2 TB, 8× ConnectX-7
    // 400G + 2× dual-port ConnectX-7, 8× 3.84 TB U.2 (30 TB) + 2× 1.9 TB OS, 10.2 kW max, air.
    // https://www.nvidia.com/en-us/data-center/dgx-h100/
    // https://resources.nvidia.com/en-us-dgx-systems/dgx-h200-datasheet
    id: "hgx-a", letter: "A", form: "8U air node", who: "the GPU maker's own system", reference: true,
    kind: "node", gpusPerNode: 8, u: 8, cpu: "2× 56-core x86", memory: "2 TB DDR5", nics: "8× 400G + 2× 2-port 400G", nvme: "30 TB + 2 OS drives",
    nodeKW: 10.2, cooling: "air", leadDelta: 0, priceMult: 1,
  },
  {
    // A 6U 8-GPU HGX H100/H200 server from a large OEM: 2× 4th/5th Gen Xeon Scalable, 32 DIMMs up
    // to 4 TB DDR5, up to 10 PCIe Gen5 slots (8× 400G), 8× 2.5-inch NVMe, 6× 2800 W supplies, air.
    // Max node power is a PSU-derived estimate. Dell PowerEdge XE9680 spec sheet:
    // https://www.dell.com/en-us/shop/ipovw/poweredge-xe9680
    id: "hgx-b", letter: "B", form: "6U air node", who: "a large OEM",
    kind: "node", gpusPerNode: 8, u: 6, cpu: "2× 64-core x86", memory: "up to 4 TB DDR5", nics: "8× 400G (10 PCIe 5.0 slots)", nvme: "8× 2.5-in NVMe",
    nodeKW: 10.5, cooling: "air", leadDelta: -1, priceMult: 0.97,
  },
  {
    // An 8U 8-GPU HGX H100/H200 server from a volume OEM, with an Intel or AMD host board: 32 DIMMs
    // up to 8 TB DDR5 (Intel) or 24 DIMMs up to 6 TB (AMD), 8× PCIe 5.0 x16 for NICs + 2 more,
    // 16× 2.5-inch hot-swap bays, 6× 3000 W Titanium supplies, air. Max node power estimated.
    // Supermicro SYS-821GE-TNHR / AS-8125GS-TNHR:
    // https://www.supermicro.com/en/products/system/gpu/8u/sys-821ge-tnhr
    // https://www.supermicro.com/en/products/system/gpu/8u/as-8125gs-tnhr
    id: "hgx-c", letter: "C", form: "8U air node, x86 of your choice", who: "a volume OEM",
    kind: "node", gpusPerNode: 8, u: 8, cpu: "2× x86, Intel or AMD", memory: "up to 8 TB DDR5", nics: "8× 400G + 2 spare slots", nvme: "up to 16× 2.5-in NVMe",
    nodeKW: 11, cooling: "air", leadDelta: -2, priceMult: 0.94,
  },
  {
    // A 5U 8-GPU HGX H100/H200 server from the HPC OEMs, air-cooled or with direct liquid cooling
    // on the GPUs and CPUs: 2× 5th Gen Xeon Scalable, 32 DIMMs up to 4 TB, 8× PCIe Gen5 x16 for
    // 400G NICs, up to 16× E3.S NVMe. Max node power estimated. HPE Cray XD670 and Lenovo
    // ThinkSystem SR780a V3 (hybrid liquid) product pages:
    // https://www.hpe.com/us/en/hpe-cray-xd670.html
    // https://lenovopress.lenovo.com/lp1909-thinksystem-sr780a-v3-server
    id: "hgx-d", letter: "D", form: "5U node, air or direct liquid", who: "an HPC OEM",
    kind: "node", gpusPerNode: 8, u: 5, cpu: "2× 64-core x86", memory: "up to 4 TB DDR5", nics: "8× 400G + 2 management", nvme: "up to 16× E3.S NVMe",
    nodeKW: 10.6, cooling: "air or direct liquid", leadDelta: 1, priceMult: 1.03,
  },
]

/* HGX B200 8-GPU nodes: Blackwell on air, with a 4U direct-liquid option. */
const B200_NODES = [
  {
    // NVIDIA DGX B200 datasheet: 10U, 2× Xeon Platinum 8570 (56 cores), up to 4 TB, 8× ConnectX-7
    // 400G + 2× dual-port 400G BlueField-3 DPUs, 8× 3.84 TB U.2 (30 TB) + 2× 1.9 TB OS, ~14.3 kW max, air.
    // https://www.nvidia.com/en-us/data-center/dgx-b200/
    id: "b200-a", letter: "A", form: "10U air node", who: "the GPU maker's own system", reference: true,
    kind: "node", gpusPerNode: 8, u: 10, cpu: "2× 56-core x86", memory: "up to 4 TB DDR5", nics: "8× 400G + 2× 2-port 400G DPU", nvme: "30 TB + 2 OS drives",
    nodeKW: 14.3, cooling: "air", leadDelta: 0, priceMult: 1,
  },
  {
    // The same large-OEM 6U chassis fitted with HGX B200: 2× 5th Gen Xeon Scalable, up to 4 TB,
    // 8× 400G, 8× 2.5-inch NVMe, air. Max node power estimated from the 1 kW GPUs plus hosts.
    // https://www.dell.com/en-us/shop/ipovw/poweredge-xe9680
    id: "b200-b", letter: "B", form: "6U air node", who: "a large OEM",
    kind: "node", gpusPerNode: 8, u: 6, cpu: "2× 64-core x86", memory: "up to 4 TB DDR5", nics: "8× 400G (10 PCIe 5.0 slots)", nvme: "8× 2.5-in NVMe",
    nodeKW: 14.5, cooling: "air", leadDelta: -1, priceMult: 0.98,
  },
  {
    // A volume OEM's 10U HGX B200 server with a 12-channel host (Intel Xeon 6 or AMD EPYC 9005):
    // 24 DIMMs up to 6 TB DDR5, 8× PCIe 5.0 x16 for NICs + 2, up to 10× 2.5-inch NVMe,
    // 6× 5250 W Titanium supplies, air. Max node power estimated.
    // https://www.supermicro.com/en/products/system/gpu/10u/sys-a21ge-nbrt
    // https://www.supermicro.com/en/products/system/gpu/10u/as-a126gs-tnbr
    id: "b200-c", letter: "C", form: "10U air node, 12-channel x86", who: "a volume OEM",
    kind: "node", gpusPerNode: 8, u: 10, cpu: "2× x86, Intel or AMD", memory: "up to 6 TB DDR5", nics: "8× 400G + 2 spare slots", nvme: "up to 10× 2.5-in NVMe",
    nodeKW: 15, cooling: "air", leadDelta: -2, priceMult: 0.95,
  },
  {
    // 4U direct-liquid HGX B200 servers: cold plates on the GPUs and CPUs, 2× Xeon 6 or 5th Gen
    // Xeon, up to 4 TB, 8× 400G + 2, 8× E1.S / 2.5-inch NVMe. Less fan power than the air boxes.
    // Supermicro SYS-422GA-NBRT-LCC and Dell PowerEdge XE9680L:
    // https://www.supermicro.com/en/products/system/gpu/4u/sys-422ga-nbrt-lcc
    // https://www.dell.com/en-us/shop/ipovw/poweredge-xe9680l
    id: "b200-d", letter: "D", form: "4U direct-liquid node", who: "two OEMs",
    kind: "node", gpusPerNode: 8, u: 4, cpu: "2× 64-core x86", memory: "up to 4 TB DDR5", nics: "8× 400G + 2 spare slots", nvme: "8× E1.S NVMe",
    nodeKW: 13.8, cooling: "direct liquid", leadDelta: 2, priceMult: 1.05,
  },
]

/* HGX B300 8-GPU nodes: Blackwell Ultra on air, 800G NICs. */
const B300_NODES = [
  {
    // NVIDIA DGX B300 datasheet: 10U, 2× Xeon 6776P (64 cores), up to 4 TB, 8× ConnectX-8 800G
    // SuperNICs + 2× BlueField-3 DPUs, 8× 3.84 TB E1.S (30 TB) + 2× 1.92 TB OS, ~14 kW max, air.
    // https://www.nvidia.com/en-us/data-center/dgx-b300/
    id: "b300-a", letter: "A", form: "10U air node", who: "the GPU maker's own system", reference: true,
    kind: "node", gpusPerNode: 8, u: 10, cpu: "2× 64-core x86", memory: "up to 4 TB DDR5", nics: "8× 800G + 2× 400G DPU", nvme: "30 TB E1.S + 2 OS drives",
    nodeKW: 14, cooling: "air", leadDelta: 0, priceMult: 1,
  },
  {
    // A large OEM's 10U HGX B300 servers with Intel Xeon 6 or AMD EPYC 9005 hosts: up to 4 TB
    // (Intel) or 6 TB (AMD) DDR5, 8× 800G, 8× NVMe, air (a 4U direct-liquid pair exists).
    // Max node power estimated. Dell PowerEdge XE9780 / XE9785:
    // https://www.dell.com/en-us/shop/ipovw/poweredge-xe9780
    // https://www.dell.com/en-us/shop/ipovw/poweredge-xe9785
    id: "b300-b", letter: "B", form: "10U air node, Intel or AMD", who: "a large OEM",
    kind: "node", gpusPerNode: 8, u: 10, cpu: "2× x86, Intel or AMD", memory: "up to 6 TB DDR5", nics: "8× 800G + 2 spare slots", nvme: "8× 2.5-in NVMe",
    nodeKW: 15, cooling: "air", leadDelta: -1, priceMult: 0.98,
  },
  {
    // A 5U HGX B300 server from the HPC OEMs, air or direct liquid: 2× AMD EPYC 9005, 24 DIMMs
    // up to 6 TB DDR5, 8× 800G or 400G + 2, up to 16× E3.S NVMe. Max node power estimated, with
    // the cold plates taking the fan power out of the node.
    // HPE ProLiant Compute XD685 and Lenovo ThinkSystem SR780a V3:
    // https://www.hpe.com/us/en/hpe-proliant-compute-xd685.html
    // https://lenovopress.lenovo.com/lp1909-thinksystem-sr780a-v3-server
    id: "b300-c", letter: "C", form: "5U node, air or direct liquid", who: "an HPC OEM",
    kind: "node", gpusPerNode: 8, u: 5, cpu: "2× 64-core x86", memory: "up to 6 TB DDR5", nics: "8× 800G + 2 management", nvme: "up to 16× E3.S NVMe",
    nodeKW: 13.6, cooling: "air or direct liquid", leadDelta: 1, priceMult: 1.03,
  },
  {
    // A volume OEM's 10U HGX B300 server, Intel Xeon 6 or AMD EPYC 9005: 24 DIMMs up to 6 TB,
    // 8× 800G + 2, up to 10× 2.5-inch NVMe, air. Max node power estimated.
    // https://www.supermicro.com/en/products/system/gpu/10u/sys-a22ga-nbrt
    // https://www.supermicro.com/en/products/system/gpu/10u/as-a126gs-tnbr
    id: "b300-d", letter: "D", form: "10U air node, 12-channel x86", who: "a volume OEM",
    kind: "node", gpusPerNode: 8, u: 10, cpu: "2× x86, Intel or AMD", memory: "up to 6 TB DDR5", nics: "8× 800G + 2 spare slots", nvme: "up to 10× 2.5-in NVMe",
    nodeKW: 15.2, cooling: "air", leadDelta: -2, priceMult: 0.95,
  },
]

/*
 * GB200 NVL72 racks: 18 compute trays (2 Grace CPUs + 4 Blackwell GPUs each) and 9 NVLink switch
 * trays in one liquid-cooled rack. Every OEM builds the same MGX tray, so the designs differ in
 * the rack, the coolant distribution and the delivery, not the node.
 */
const GB200_RACKS = [
  {
    // NVIDIA GB200 NVL72 / DGX GB200: 72 GPUs, 36 Grace CPUs (72 Arm cores each), up to 17 TB
    // LPDDR5X, 4× ConnectX-7 400G per tray, E1.S NVMe per tray, ~120–132 kW per rack, liquid.
    // https://www.nvidia.com/en-us/data-center/gb200-nvl72/
    // https://www.nvidia.com/en-us/data-center/dgx-gb200/
    id: "gb200-a", letter: "A", form: "NVL72 rack, 18 trays", who: "the GPU maker's own rack", reference: true,
    kind: "rack", gpusPerNode: 4, u: 1, traysPerRack: 18, cpu: "2× 72-core Arm per tray", memory: "up to 960 GB LPDDR5X per tray", nics: "4× 400G per tray", nvme: "up to 8× E1.S per tray",
    nodeKW: 6.4, rackKW: 132, cooling: "direct liquid", leadDelta: 0, priceMult: 1,
  },
  {
    // A large OEM's GB200 NVL72 in its own 21-inch rack with rack-scale direct liquid cooling and
    // room to grow. Dell PowerEdge XE9712: https://www.dell.com/en-us/shop/ipovw/poweredge-xe9712
    id: "gb200-b", letter: "B", form: "NVL72 rack, 21-inch OEM rack", who: "a large OEM",
    kind: "rack", gpusPerNode: 4, u: 1, traysPerRack: 18, cpu: "2× 72-core Arm per tray", memory: "up to 960 GB LPDDR5X per tray", nics: "4× 400G per tray", nvme: "up to 8× E1.S per tray",
    nodeKW: 6.3, rackKW: 130, cooling: "direct liquid", leadDelta: -1, priceMult: 0.98,
  },
  {
    // A volume OEM's GB200 NVL72 with an in-rack coolant distribution unit rated at 250 kW, so the
    // hall only brings facility water. Supermicro SRS-GB200-NVL72 / ARS-121GL-NBO trays:
    // https://www.supermicro.com/en/products/system/gpu/1u/ars-121gl-nbo
    // https://www.supermicro.com/en/accelerators/nvidia
    id: "gb200-c", letter: "C", form: "NVL72 rack, in-rack CDU", who: "a volume OEM",
    kind: "rack", gpusPerNode: 4, u: 1, traysPerRack: 18, cpu: "2× 72-core Arm per tray", memory: "up to 960 GB LPDDR5X per tray", nics: "4× 400G per tray", nvme: "up to 8× E1.S per tray",
    nodeKW: 6.5, rackKW: 136, cooling: "direct liquid, in-rack CDU", leadDelta: -2, priceMult: 0.95,
  },
  {
    // The HPC OEMs' GB200 NVL72 with water on every tray, switches included, so almost no fans.
    // Lenovo ThinkSystem SC777 V4 product guide (lenovopress.lenovo.com) and HPE's GB200 NVL72
    // announcement (hpe.com newsroom, November 2024).
    id: "gb200-d", letter: "D", form: "NVL72 rack, every tray on water", who: "an HPC OEM",
    kind: "rack", gpusPerNode: 4, u: 1, traysPerRack: 18, cpu: "2× 72-core Arm per tray", memory: "up to 960 GB LPDDR5X per tray", nics: "4× 400G per tray", nvme: "up to 8× E1.S per tray",
    nodeKW: 6.2, rackKW: 128, cooling: "direct liquid, no fans", leadDelta: 1, priceMult: 1.02,
  },
]

/* GB300 NVL72 racks: Blackwell Ultra trays with 800G SuperNICs, the same three rack styles. */
const GB300_RACKS = [
  {
    // NVIDIA GB300 NVL72 / DGX GB300: 72 Blackwell Ultra GPUs, 36 Grace CPUs, up to 17 TB LPDDR5X,
    // ConnectX-8 800G SuperNICs and BlueField-3 DPUs, E1.S NVMe per tray, liquid.
    // https://www.nvidia.com/en-us/data-center/gb300-nvl72/
    id: "gb300-a", letter: "A", form: "NVL72 rack, 18 trays", who: "the GPU maker's own rack", reference: true,
    kind: "rack", gpusPerNode: 4, u: 1, traysPerRack: 18, cpu: "2× 72-core Arm per tray", memory: "up to 960 GB LPDDR5X per tray", nics: "4× 800G + DPU per tray", nvme: "up to 8× E1.S per tray",
    nodeKW: 6.9, rackKW: 142, cooling: "direct liquid", leadDelta: 0, priceMult: 1,
  },
  {
    // A large OEM's GB300 NVL72 in its 21-inch rack. Dell PowerEdge XE9712 with GB300 NVL72:
    // https://www.dell.com/en-us/shop/ipovw/poweredge-xe9712
    id: "gb300-b", letter: "B", form: "NVL72 rack, 21-inch OEM rack", who: "a large OEM",
    kind: "rack", gpusPerNode: 4, u: 1, traysPerRack: 18, cpu: "2× 72-core Arm per tray", memory: "up to 960 GB LPDDR5X per tray", nics: "4× 800G + DPU per tray", nvme: "up to 8× E1.S per tray",
    nodeKW: 6.8, rackKW: 140, cooling: "direct liquid", leadDelta: -1, priceMult: 0.98,
  },
  {
    // A volume OEM's GB300 NVL72 with an in-rack CDU. https://www.supermicro.com/en/accelerators/nvidia
    id: "gb300-c", letter: "C", form: "NVL72 rack, in-rack CDU", who: "a volume OEM",
    kind: "rack", gpusPerNode: 4, u: 1, traysPerRack: 18, cpu: "2× 72-core Arm per tray", memory: "up to 960 GB LPDDR5X per tray", nics: "4× 800G + DPU per tray", nvme: "up to 8× E1.S per tray",
    nodeKW: 7, rackKW: 146, cooling: "direct liquid, in-rack CDU", leadDelta: -2, priceMult: 0.95,
  },
]

/*
 * Vera Rubin NVL72 (announced as NVL144, counting 144 GPU dies in 72 packages) racks: 18 trays of
 * 2 Vera CPUs + 4 Rubin GPUs, HBM4, 1.6T NICs. Announced at GTC 2025 for the second half of 2026;
 * per-tray storage and the OEM racks are announcements, not datasheets, so the game marks them.
 * https://nvidianews.nvidia.com/news/nvidia-blackwell-ultra-ai-factory-platform-paves-way-for-age-of-ai-reasoning
 */
const VR_RACKS = [
  {
    id: "vr-a", letter: "A", form: "NVL144 rack, 18 trays", who: "the GPU maker's own rack", reference: true,
    kind: "rack", gpusPerNode: 4, u: 1, traysPerRack: 18, cpu: "2× 88-core Arm per tray", memory: "up to 1.5 TB LPDDR5X per CPU", nics: "4× 1.6T per tray", nvme: "E1.S per tray (announced)",
    nodeKW: 10.5, rackKW: 210, cooling: "direct liquid", leadDelta: 0, priceMult: 1, announced: true,
  },
  {
    // Large-OEM NVL144 racks announced alongside the platform; delivery after the first racks.
    id: "vr-b", letter: "B", form: "NVL144 rack, 21-inch OEM rack", who: "a large OEM",
    kind: "rack", gpusPerNode: 4, u: 1, traysPerRack: 18, cpu: "2× 88-core Arm per tray", memory: "up to 1.5 TB LPDDR5X per CPU", nics: "4× 1.6T per tray", nvme: "E1.S per tray (announced)",
    nodeKW: 10.8, rackKW: 215, cooling: "direct liquid", leadDelta: 2, priceMult: 1.02, announced: true,
  },
  {
    // Volume-OEM NVL144 rack with an in-rack CDU, announced; the longest wait on the board.
    id: "vr-c", letter: "C", form: "NVL144 rack, in-rack CDU", who: "a volume OEM",
    kind: "rack", gpusPerNode: 4, u: 1, traysPerRack: 18, cpu: "2× 88-core Arm per tray", memory: "up to 1.5 TB LPDDR5X per CPU", nics: "4× 1.6T per tray", nvme: "E1.S per tray (announced)",
    nodeKW: 11, rackKW: 220, cooling: "direct liquid, in-rack CDU", leadDelta: 4, priceMult: 1.04, announced: true,
  },
]

export const REFARCH = {
  h100: HOPPER_NODES,
  h200: HOPPER_NODES,
  b200: B200_NODES,
  b300: B300_NODES,
  gb200: GB200_RACKS,
  gb300: GB300_RACKS,
  vr: VR_RACKS,
}

/** The designs behind one platform, reference design first. */
export function designsFor(platformId) {
  return REFARCH[platformId] || []
}

/** One design of a platform by id, or null when the id belongs to another platform. */
export function designFor(platformId, designId) {
  if (!designId) return null
  return designsFor(platformId).find((design) => design.id === designId) || null
}

/** The design the platform's own game numbers come from. */
export function referenceDesign(platformId) {
  return designsFor(platformId).find((design) => design.reference) || designsFor(platformId)[0] || null
}

/** Nodes one rack takes in this hall: the rack's height or the hall's power cap, whichever bites first. */
export function nodesPerRack(design, hall) {
  if (!design) return 0
  if (design.kind === "rack") return design.traysPerRack
  const bySpace = Math.floor(RACK_U / design.u)
  const byPower = Math.floor((hall?.maxRackKW || 0) / design.nodeKW)
  return Math.max(1, Math.min(bySpace, byPower))
}

/** GPUs one rack holds in this hall. */
export function gpusPerRack(design, hall) {
  return nodesPerRack(design, hall) * (design?.gpusPerNode || 0)
}

/** Racks the build needs for this many GPUs in this hall. */
export function racksNeeded(design, hall, gpus) {
  const perRack = gpusPerRack(design, hall)
  if (!(perRack > 0) || !(gpus > 0)) return 0
  return Math.ceil(gpus / perRack)
}

/** The delivery band for a design on a platform: the platform's lead, shifted by the design, ± one week. */
export function leadBand(design, platform) {
  const mid = Math.max(1, (platform?.leadWeeks || 0) + (design?.leadDelta || 0))
  return { lo: Math.max(1, mid - 1), hi: mid + 1, mid, text: `${Math.max(1, mid - 1)}–${mid + 1} wk${design?.announced ? " (announced)" : ""}` }
}

/** True when the design's rack fits the hall: a rack-scale design wants the liquid hall. */
export function fitsHall(design, hall) {
  if (!design || !hall) return true
  if (design.kind === "rack") return hall.cooling === "liquid"
  return nodesPerRack(design, hall) >= 1 && design.nodeKW <= (hall.maxRackKW || 0)
}

/**
 * The platform as this design ships it: rack power scaled by the node (or rack) power against
 * the reference design, the design's lead shift, and its price. Tokens, HBM and NVLink stay.
 */
export function withDesign(platform, design) {
  if (!platform || !design) return platform
  const ref = referenceDesign(platform.id)
  const powerMult = design.kind === "rack"
    ? design.rackKW / (ref?.rackKW || design.rackKW)
    : design.nodeKW / (ref?.nodeKW || design.nodeKW)
  return {
    ...platform,
    rackKW: Math.round(platform.rackKW * powerMult * 10) / 10,
    leadWeeks: Math.max(1, (platform.leadWeeks || 0) + (design.leadDelta || 0)),
    capex: Math.round(platform.capex * (design.priceMult || 1)),
    design: design.id,
  }
}

const pct = (mult) => `${mult >= 1 ? "+" : "−"}${Math.round(Math.abs(mult - 1) * 100)}%`

/** The fields the GPU step prints for one design: label and value, in the order the plan lists them. */
export function designFacts(design, platformId, hallId, gpus) {
  const platform = byId(PLATFORMS, platformId)
  const hall = byId(HALLS, hallId)
  const per = nodesPerRack(design, hall)
  const racks = racksNeeded(design, hall, gpus)
  const band = leadBand(design, platform)
  const rackPower = design.kind === "rack" ? `${design.nodeKW} kW per tray, about ${design.rackKW} kW a rack` : `about ${design.nodeKW} kW`
  return [
    ["GPUs/node", `${design.gpusPerNode}${design.kind === "rack" ? " per tray" : ""}`],
    ["Height", `${design.u}U${design.kind === "rack" ? ` trays × ${design.traysPerRack}` : ""}`],
    ["CPUs", design.cpu],
    ["Memory", design.memory],
    ["NICs", design.nics],
    ["NVMe", design.nvme],
    ["Node power", rackPower],
    ["Cooling", design.cooling],
    ["Nodes/rack", design.kind === "rack" ? `${per} trays, one rack` : `${per} at the hall's ${hall?.maxRackKW || 0} kW cap`],
    ["Racks", `${racks}`],
    ["Lead", band.text],
  ]
}

/** The short lines a design card shows: what it is, how dense it is here, what it costs in time. */
export function designCard(design, platformId, hallId, gpus) {
  const platform = byId(PLATFORMS, platformId)
  const hall = byId(HALLS, hallId)
  const per = nodesPerRack(design, hall)
  const racks = racksNeeded(design, hall, gpus)
  const band = leadBand(design, platform)
  const density = design.kind === "rack" ? `${per} trays · ${racks} rack${racks === 1 ? "" : "s"}` : `${per}/rack at ${hall?.maxRackKW || 0} kW · ${racks} rack${racks === 1 ? "" : "s"}`
  return {
    title: `${design.letter} · ${design.form}`,
    spec: `${design.gpusPerNode} GPUs/${design.kind === "rack" ? "tray" : "node"} · ${design.cpu} · ${design.memory}`,
    density: `${design.kind === "rack" ? design.rackKW : design.nodeKW} kW${design.kind === "rack" ? "/rack" : "/node"} · ${density}`,
    lead: `lead ${band.text} · ${design.nics}`,
    warn: fitsHall(design, hall) ? "" : design.kind === "rack" ? "needs the liquid hall" : "too hot for this hall",
  }
}

/** The learn-pop for a design: who makes it, the whole spec, and what picking it changes in the game. */
export function designLines(design, platformId, hallId, gpus) {
  const platform = byId(PLATFORMS, platformId)
  const facts = designFacts(design, platformId, hallId, gpus)
  const shipped = withDesign(platform, design)
  const power = shipped && platform ? pct(shipped.rackKW / platform.rackKW) : "±0%"
  const lead = design.leadDelta ? `${design.leadDelta > 0 ? "+" : "−"}${Math.abs(design.leadDelta)} week${Math.abs(design.leadDelta) === 1 ? "" : "s"}` : "the platform's lead"
  const price = design.priceMult === 1 ? "list price" : `${pct(design.priceMult)} on the rack price`
  return [
    `${design.form} from ${design.who}: ${design.kind === "rack" ? `${design.traysPerRack} compute trays of ${design.gpusPerNode} GPUs in one ${design.cooling} rack` : `${design.gpusPerNode} GPUs in ${design.u}U, ${design.cooling}`}. Figures are rounded from the public datasheet${design.announced ? " and the launch announcement" : ""}.`,
    facts.slice(2, 8).map(([label, value]) => `${label}: ${value}`).join(" · ") + ".",
    `${facts[8][1].charAt(0).toUpperCase()}${facts[8][1].slice(1)}, ${facts[9][1]} rack${facts[9][1] === "1" ? "" : "s"} for ${gpus} GPUs. In the game: rack power ${power}, ${lead}, ${price} (game values).`,
  ]
}
