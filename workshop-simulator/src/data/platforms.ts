/**
 * Selectable server reference architectures for the workshop.
 *
 * The HPE entry is taken from the "CustomerX AI Factory — HPE Cray XD670"
 * solution document (Sept 2024): node bill of materials, rack building
 * blocks, WEKA storage layer, fabric design and pricing anchors. The Dell
 * entry is a market-equivalent alternative built around the PowerEdge
 * XE9680 HGX platform; its figures are public/estimated, not from the doc.
 */

export interface PlatformSpec {
  id: string;
  vendor: 'HPE' | 'Dell' | 'SambaNova' | 'Cerebras';
  name: string;
  chassis: string;
  /** Matches the judges' registry chassis naming (Track B). */
  registryAligned: boolean;
  /** Alternative architectures bring their own silicon: the platform's
   *  accelerator replaces the registry option's GPU choice. */
  overridesAccelerator?: boolean;
  // Node bill of materials
  gpusPerNode: number;
  accelId: string;
  cpus: string;
  memory: string;
  localStorage: string;
  nics: string;
  psus: string;
  // Rack building block
  nodesPerRack: number;
  rackKw: number;
  buildingBlock: string;
  // Cluster storage layer
  storageArray: string;
  storageNodes: string;
  storageCapacity: string;
  storageWriteGBs: number;
  storageReadGBs: number;
  storageProtocolNote: string;
  // Fabric
  fabricId: string;
  fabricNote: string;
  // Simulator mapping
  coolingNote: string;
  // Pricing anchors (as quoted / estimated)
  priceAnchors: { k: string; v: string; fromDoc: boolean }[];
  blurb: string;
}

export const PLATFORMS: PlatformSpec[] = [
  {
    id: 'hpe-xd670',
    vendor: 'HPE',
    name: 'HPE Cray XD670 AI Factory',
    chassis: 'HPE Cray XD670 (8-way H200 HGX)',
    registryAligned: true,
    gpusPerNode: 8,
    accelId: 'nvidia-h200',
    cpus: '2\u00d7 Intel Xeon Platinum 8570 (56C, 2.1 GHz, 350 W)',
    memory: '2 TB DDR5-5600 (32\u00d7 64 GB)',
    localStorage: '2\u00d7 1.92 TB NVMe M.2 + 8\u00d7 3.84 TB NVMe U.2 (SED)',
    nics: '8\u00d7 NDR 400G IB HCA (rail-optimised, 1 per GPU) + 2\u00d7 100GbE + 1\u00d7 200GbE storage',
    psus: '6\u00d7 3000 W Titanium PSUs',
    nodesPerRack: 2,
    rackKw: 18,
    buildingBlock:
      'Compute Building Block (CBB) = 1 rack with 2\u00d7 XD670. Doc scales 32 CBBs (512 GPUs) to 1,016 GPUs.',
    storageArray: 'WEKA parallel filesystem on HPE DL345 Gen11',
    storageNodes:
      '16\u00d7 DL345 Gen11 (EPYC 9534 64C, 768 GB RAM, 8\u00d7 15.36 TB NVMe Gen5 each)',
    storageCapacity: '1.4 PB usable',
    storageWriteGBs: 242,
    storageReadGBs: 749,
    storageProtocolNote:
      'Dedicated 800G Ethernet storage fabric (2\u00d7 SN5600); ~40 GB/s peak read per GPU node',
    fabricId: 'ib-ndr',
    fabricNote:
      'NDR 400G InfiniBand compute fabric, 16 spines + 18 leafs, non-blocking, rail-optimised \u2014 the doc\u2019s stated reason: RDMA over IB is easier, more performant, and scales further than Ethernet.',
    coolingNote: 'Air or DLC liquid, plus hybrid options (per doc)',
    priceAnchors: [
      { k: 'Compute Building Block (2 nodes)', v: '~$292K', fromDoc: true },
      { k: 'IB fabric for first 32 CBBs', v: '$500K\u2013$720K', fromDoc: true },
      { k: 'WEKA storage software', v: '~$1.5M', fromDoc: true },
      { k: 'Storage node (hardware)', v: '~$30K each', fromDoc: true },
      {
        k: 'Azure 8\u00d7A100 reserved (comparison)',
        v: '$250K\u2013$265K / year',
        fromDoc: true,
      },
    ],
    blurb:
      'The architecture from the CustomerX AI Factory solution document: modular CBB racks tied together with non-blocking NDR InfiniBand, WEKA flash storage, and fractional-GPU scheduling from 1/7th of a GPU to all 512 on one job.',
  },
  {
    id: 'dell-xe9680',
    vendor: 'Dell',
    name: 'Dell PowerEdge AI Factory (alternative)',
    chassis: 'Dell PowerEdge XE9680 (8-way H200 HGX)',
    registryAligned: false,
    gpusPerNode: 8,
    accelId: 'nvidia-h200',
    cpus: '2\u00d7 Intel Xeon Platinum 8568Y+ (48C, 350 W)',
    memory: '2 TB DDR5-5600 (32\u00d7 64 GB)',
    localStorage: '8\u00d7 3.84 TB NVMe U.2',
    nics: '8\u00d7 400G (Quantum-2 IB or Spectrum-X Ethernet) + 2\u00d7 100GbE',
    psus: '6\u00d7 2800 W Titanium PSUs',
    nodesPerRack: 2,
    rackKw: 19,
    buildingBlock:
      'Scalable unit = 1 rack with 2\u00d7 XE9680 (6U each); Dell validated designs scale in 4-node pods.',
    storageArray: 'Dell PowerScale F710 all-flash scale-out NAS',
    storageNodes: '16\u00d7 F710 nodes (1U, 10\u00d7 15.36 TB NVMe each)',
    storageCapacity: '~1.5 PB usable',
    storageWriteGBs: 160,
    storageReadGBs: 640,
    storageProtocolNote:
      'NFSoRDMA / GPUDirect over 400G Ethernet; per-node throughput lower than WEKA on writes',
    fabricId: 'roce-400',
    fabricNote:
      'Dell validated designs default to 400G Ethernet (RoCEv2 / Spectrum-X or Broadcom); Quantum-2 InfiniBand available as an option.',
    coolingNote: 'Air-cooled (XE9680) or direct liquid (XE9685L variant)',
    priceAnchors: [
      { k: 'XE9680 node (8\u00d7 H200, street est.)', v: '~$310K', fromDoc: false },
      { k: 'Ethernet fabric for 32 racks (est.)', v: '$350K\u2013$500K', fromDoc: false },
      { k: 'PowerScale F710 cluster (est.)', v: '~$1.2M', fromDoc: false },
    ],
    blurb:
      'A market-equivalent alternative: the same 8-way H200 HGX baseboard in Dell\u2019s XE9680 chassis, PowerScale instead of WEKA, and Ethernet-first networking. Figures are public estimates \u2014 not from the CustomerX document.',
  },
  {
    id: 'sambanova-datascale',
    vendor: 'SambaNova',
    name: 'SambaNova DataScale SN40L (alternative architecture)',
    chassis: 'DataScale SN40L-16 rack (16 RDUs)',
    registryAligned: false,
    overridesAccelerator: true,
    gpusPerNode: 8,
    accelId: 'sambanova-sn40l',
    cpus: 'Integrated x86 hosts (managed appliance)',
    memory: '8\u00d7 64 GB HBM + 12 TB DDR5 tiered memory per 8-RDU node',
    localStorage: 'Integrated NVMe in the DataScale rack',
    nics: 'Proprietary RDU-to-RDU fabric within the rack; 100/400GbE uplinks',
    psus: 'Rack-integrated power shelves',
    nodesPerRack: 2,
    rackKw: 10,
    buildingBlock:
      'Market unit = one DataScale SN40L-16 rack (2 nodes \u00d7 8 RDUs). Sold as a managed appliance or consumed as a service.',
    storageArray: 'Integrated tiered memory (HBM + DDR) plus customer NAS',
    storageNodes: 'Included in the appliance',
    storageCapacity: '12 TB DDR per node for model banks',
    storageWriteGBs: 20,
    storageReadGBs: 40,
    storageProtocolNote:
      'The 3-tier memory system holds hundreds of model checkpoints hot \u2014 a different answer to cold starts than any storage array.',
    fabricId: 'ib-ndr',
    fabricNote:
      'RDU-to-RDU dataflow fabric is integrated in the rack \u2014 no separate switch buildout inside the appliance boundary.',
    coolingNote: 'Air-cooled rack, ~10 kW \u2014 fits standard colo without liquid.',
    priceAnchors: [
      { k: 'DataScale SN40L-16 rack (est.)', v: '~$1.5M\u2013$2M', fromDoc: false },
      { k: 'Typical consumption model', v: 'subscription / as-a-service', fromDoc: false },
    ],
    blurb:
      'The dataflow alternative: reconfigurable RDUs with three memory tiers, sold as whole racks or a managed service. High utilisation per chip and hot-swappable model banks, at appliance-style pricing. All figures are public estimates.',
  },
  {
    id: 'cerebras-cs3',
    vendor: 'Cerebras',
    name: 'Cerebras CS-3 (alternative architecture)',
    chassis: 'CS-3 wafer-scale system (4-system inference pod)',
    registryAligned: false,
    overridesAccelerator: true,
    gpusPerNode: 4,
    accelId: 'cerebras-cs3',
    cpus: 'External x86 head nodes (orchestration only)',
    memory: '44 GB on-wafer SRAM per system (~21 PB/s); model shards across the pod',
    localStorage: 'MemoryX external memory appliances for weights at rest',
    nics: 'SwarmX interconnect between systems; standard Ethernet to the datacenter',
    psus: '~23 kW per system, integrated internal water loop',
    nodesPerRack: 1,
    rackKw: 23,
    buildingBlock:
      'Market unit = one CS-3 per rack; a 70B FP16 model runs on a 4-system pod (4 racks). Also consumable via Cerebras Inference cloud.',
    storageArray: 'MemoryX weight store + customer NAS',
    storageNodes: 'MemoryX appliances (external)',
    storageCapacity: 'Up to petabyte-class weight storage',
    storageWriteGBs: 20,
    storageReadGBs: 40,
    storageProtocolNote:
      'Weights stream from MemoryX into on-wafer SRAM; there is no HBM tier at all.',
    fabricId: 'ib-ndr',
    fabricNote:
      'SwarmX handles system-to-system scaling \u2014 the fabric is part of the product, not a separate switch purchase.',
    coolingNote:
      'Internal closed-loop water cooling per system \u2014 facility provides heat rejection (PUE), not per-chip cooling.',
    priceAnchors: [
      { k: 'CS-3 system (est.)', v: '~$2.5M', fromDoc: false },
      { k: '70B FP16 inference pod (4 systems, est.)', v: '~$10M', fromDoc: false },
      { k: 'Published Llama 70B inference speed', v: '~2,000+ tok/s per stream', fromDoc: false },
    ],
    blurb:
      'The wafer-scale alternative: one giant chip per system, ~2,000+ tokens/second per stream on 70B-class models \u2014 an order of magnitude faster per user than GPU nodes \u2014 but tiny KV capacity, ~23 kW per system and pod-scale pricing. All figures are public estimates.',
  },
];
