/**
 * The stepped build: LOCATION, GPU, COOLING, MEMORY, CONNECTIVITY, STORAGE, QPU, then REVIEW.
 * Pure: tile sets per step for the simple board (three tiles) and nerd mode (the full set),
 * what each tile sets in a choice set, the one-line reason shown when a tile is picked, and
 * the enumeration of every simple picture for the balance checks. No DOM here.
 */
import { AUDIENCES, DATA_HOMES, DOES, HALLS, JOBS, KV_TIER, MODELS, ORCA, PLATFORMS, SITES, USER_BASES, USER_TIER_IDS, USE_CASES, byId, dataHomeFor, resolveUseCase, usersTier } from "./data.js"
import { dataTrips } from "./latency.js"
import { formatMoney, formatTokens, metroOffers, scenarioFor } from "./model.js"
import { COMBO, NERD_IDS, SIMPLE_IDS, brainPick, brainsId, cleanMetros, defaultChoices, maxMetros, memoryChoices, memoryTile, metroSets, modelPicks, nerdBrainIds, simpleBrainIds, wireIds } from "./presets.js"
import { designFor } from "./refarch.js"

export const STEPS = [
  { id: "model", title: "MODEL & USERS", hint: "Which model answers, and how many people ask", short: "MODEL" },
  { id: "location", title: "LOCATION", hint: "Which Digital Realty metros", short: "WHERE" },
  { id: "gpu", title: "GPU", hint: "The computers that run the AI", short: "GPU" },
  { id: "cooling", title: "COOLING", hint: "How the racks are cooled", short: "COOL" },
  { id: "memory", title: "MEMORY", hint: "What the GPUs remember between turns", short: "MEM" },
  { id: "wires", title: "CONNECTIVITY", hint: "How answers and data travel", short: "NET" },
  { id: "storage", title: "STORAGE", hint: "Where documents and checkpoints live", short: "DATA" },
  { id: "qpu", title: "QPU", hint: "A quantum helper beside the GPUs", short: "QPU" },
  { id: "review", title: "REVIEW", hint: "Check the build, then GO", short: "GO" },
]

export const STEP_IDS = STEPS.map((step) => step.id)
export const BUILD_STEP_IDS = STEP_IDS.filter((id) => id !== "review")

export function stepIndex(stepId) {
  return Math.max(0, STEP_IDS.indexOf(stepId))
}

export function nextStep(stepId) {
  return STEP_IDS[Math.min(STEP_IDS.length - 1, stepIndex(stepId) + 1)]
}

export function prevStep(stepId) {
  return STEP_IDS[Math.max(0, stepIndex(stepId) - 1)]
}

const RACK_ART = { l40s: "rackAir", rtx6000: "rackAir", h100: "rackAir", h200: "rackAir", b200: "rackAir", b300: "rackAir", b300n: "rackAir", gb200: "rackLiquid", gb300: "rackLiquid", vr: "rackRubin" }

/** Five words that tell a newcomer what each rack is good at. */
const GPU_HINTS = {
  l40s: "cheapest card, slow memory, air",
  rtx6000: "budget pick for small models",
  h100: "the classic, runs on air",
  h200: "more memory, runs on air",
  b200: "FP4 maths, runs on air",
  b300: "strongest rack on air",
  b300n: "one strong node, half the price",
  gb200: "72 GPUs as one, liquid",
  gb300: "reasoning rack, liquid only",
  vr: "next gen, liquid, due 2026",
}

/** The tag over the tile: what the player must know about the hall before picking it. */
const GPU_TAG = {
  l40s: "INCLUDED · AIR",
  rtx6000: "INCLUDED · AIR",
  h100: "INCLUDED · AIR",
  h200: "INCLUDED · AIR",
  b200: "INCLUDED · AIR",
  b300: "INCLUDED · AIR",
  b300n: "INCLUDED · AIR",
  gb200: "NEEDS LIQUID",
  gb300: "NEEDS LIQUID",
  vr: "NEEDS LIQUID · 2026",
}

const GPU_LEARN = {
  l40s: [
    "A PCIe inference card from 2023 with 48 GB of GDDR6 memory and no NVLink.",
    "Its memory is four times slower than an H100's, so each GPU writes few tokens a second, and a 70B model needs all eight cards in the server.",
    "Pick it when the crowd is small and the money is tight: it is in stock and the cheapest rack on the board.",
  ],
  rtx6000: [
    "Blackwell on a PCIe card: 96 GB of GDDR7 memory, FP4 maths, in an 8-GPU air-cooled server.",
    "A fifth of an HGX rack's price per GPU, but GDDR is five times slower than HBM, so it suits small models and modest crowds.",
    "Pick it for a 70B or 100B model and a small or medium crowd; a million shoppers need HBM racks.",
  ],
  h100: [
    "The GPU that kicked off the AI boom in 2022.",
    "80 GB of memory per GPU is small for today's giant models, so a big model is split across many GPUs.",
    "Pick it when you want an older, cheaper rack that arrives sooner.",
  ],
  h200: [
    "The same Hopper brain as the H100, with 141 GB of memory per GPU.",
    "Writing the answer is mostly a memory job, so this one is faster.",
    "It still fits an air-cooled hall.",
  ],
  b200: [
    "A Blackwell GPU with 180 GB of memory that still fits an air-cooled hall.",
    "Smaller numbers mean each token needs less memory.",
    "Pick it when you want a newer GPU without liquid cooling.",
  ],
  b300: [
    "Blackwell Ultra, with 288 GB of memory per GPU.",
    "It is the strongest rack that still runs on air cooling.",
    "Pick it when you want a lot of answers without waiting for a liquid hall.",
  ],
  b300n: [
    "One 8-GPU Blackwell Ultra node in a rack of its own: the same 288 GB GPUs as the HGX B300 rack.",
    "Half a rack's price for eight strong GPUs on air.",
    "Pick it when the crowd needs eight of the best air-cooled GPUs, not sixteen.",
  ],
  gb200: [
    "72 GPUs joined by NVLink act as one giant GPU.",
    "Huge models love that shared memory.",
    "It runs too hot for fans, so pick it only with the liquid-cooled hall.",
  ],
  gb300: [
    "72 Blackwell Ultra GPUs joined by NVLink act as one.",
    "Built for models that think for a long time.",
    "It needs the liquid-cooled hall.",
  ],
  vr: [
    "The 2026 Vera Rubin rack has the fastest memory and a long wait for delivery.",
    "NVIDIA first counted it as 144 GPU dies in 72 packages.",
    "Pick it only when the deadline is long and the budget can take the highest price.",
  ],
}

const HUGE_TAG = "HUGE · NEEDS LIQUID"

/** The three model sizes: what each one is, what it needs, and when to pick it. */
const MODEL_TILES = {
  "70b": {
    art: "token",
    hint: "fits on a few GPUs, quick answers",
    lines: [
      "A 70-billion-parameter dense model: every parameter works on every token.",
      "70 GB of weights at FP8 (140 GB at FP16) fit on two or three of today's GPUs, so answers start fast and cost little.",
      "Pick it for short, everyday questions where speed and price matter more than depth.",
    ],
    nerd: "Llama-class. 70 GB FP8 / 140 GB FP16. KV cache 0.16 MB per token at FP8. Quality ×1.0 on the token price (game).",
    why: "The lightest model: cheapest per token, fastest to start, good enough for everyday questions.",
  },
  "100b": {
    art: "gem",
    hint: "a bigger brain for the same hall",
    lines: [
      "About 100 billion parameters, dense: a step up in answer quality for a step up in memory and maths.",
      "100 GB of weights at FP8 (200 GB at FP16): three or four GPUs just to load it, a little slower per token.",
      "Pick it when the answers have to be right more often and the budget can carry 40% more weights.",
    ],
    nerd: "ESM3-98B / Command-A-111B class. 100 GB FP8 / 200 GB FP16. KV cache 0.2 MB per token. Quality ×1.12 (game).",
    why: "A bigger dense model: better answers for about 40% more memory and maths per token.",
  },
  "650b": {
    art: "rackLiquid",
    hint: "mixture of experts, wants 72 GPUs as one",
    lines: [
      "A 650-billion-parameter mixture-of-experts model (DeepSeek-class: 671B in total, about 37B active per token).",
      "671 GB of weights at FP8: too big for an 8-GPU server at FP8 on Hopper, so it spills across islands unless a 72-GPU NVLink rack holds it whole.",
      "Pick it for reasoning, long reports and hard code, and plan an NVL72 rack for it.",
    ],
    nerd: "671B total / 37B active. 671 GB FP8 / 1.3 TB FP16. MLA KV cache 0.07 MB per token. Quality ×1.3 (game). NVL72 domain ×1.5, 8-GPU islands ×0.75.",
    why: "The biggest brain: the best answers, but it only runs well when 72 GPUs act as one.",
  },
}

const USERS_TAG = { small: "SMALL", medium: "MEDIUM", large: "LARGE" }
const USERS_ART = { small: "user", medium: "user", large: "hero" }

/** One line per story and GPU tile: the reason that pops up for two seconds when it is picked. */
const GPU_WHY = {
  chat: { rtx6000: "Cheap FP4 tokens for a small crowd; a million shoppers need far more than eight PCIe racks.", h100: "Cheap and quick to get, but each rack answers few shoppers.", h200: "More memory than the H100, but the same slow maths for a million shoppers' prompts.", b300: "Six strong air racks: plenty of shoppers, no liquid hall needed.", gb200: "Two NVL72 racks answer the whole crowd, if the hall can cool them.", vr: "The fastest rack, but it lands after the 16-week deadline." },
  rag: { rtx6000: "A budget rack for a small office; 16k-token prompts crawl on GDDR memory at scale.", h100: "Fits a 70B model, but slow on 16k-token prompts.", h200: "Fits a 70B model, but slow on 16k-token prompts.", b300: "Air-cooled Blackwell fits a small power room.", gb200: "One NVL72 rack would do; two blow the power room.", vr: "Scarce and late for a 20-week deadline." },
  code: { rtx6000: "FP4 fits the 650B model across eight cards, but PCIe islands and GDDR make it crawl on 64k contexts.", h200: "Too little memory for 64k-token agent contexts.", b300: "Six air racks keep up until the contexts fill the memory.", gb200: "Three NVL72 racks hold a big model and its long contexts.", gb300: "Two reasoning racks hold the contexts, but the third rack's worth of developers waits.", vr: "Arrives too late for a 26-week launch." },
  research: { rtx6000: "A 650B model on PCIe islands: it loads, but every long answer crawls.", h200: "A 650B model does not fit well on Hopper islands.", b300: "Works, but a big model spills across small NVLink islands.", gb200: "72 GPUs as one is how a 650B reasoning model wants to run.", gb300: "One reasoning rack: 72 GPUs as one, but one rack for ten thousand analysts.", vr: "Inside the 36-week deadline, but the priciest rack on the board." },
  drug: { l40s: "The cheapest cards: an overnight batch forgives slow memory, but fifteen racks still miss the candidates.", rtx6000: "Cheap FP4 screening for a small lab; the big library needs HBM racks.", h200: "Cheap racks, but a 100B model screens slowly on them.", b300: "Four Blackwell Ultra racks screen the library fast on air.", gb200: "More rack than the lab's power room can feed.", vr: "The lab would pay for speed it cannot power." },
  robot: { rtx6000: "Nine PCIe racks serve the fleet in time and cheaply; the plants' power rooms can feed them.", h100: "Cheap, but eight Hopper racks for what two Blackwell racks do.", h200: "Four Hopper racks still miss the fleet's 50 ms first word.", b200: "Two Blackwell racks on air serve the whole fleet from the plants.", b300: "Three racks is more than the fleet needs; the money shows in the token price.", vr: "A 210 kW rack far above what the fleet needs: power and money wasted." },
}

const HALL_META = {
  cool: { hallId: "A", label: "Air-cooled hall", nerdLabel: "Air cooling", art: "fan" },
  row: { hallId: "I", label: "In-row cooling", nerdLabel: "In-row cooling", art: "rackAir" },
  rear: { hallId: "R", label: "Rear-door hall", nerdLabel: "Rear door heat exchanger", art: "chest" },
  super: { hallId: "B", label: "Liquid-cooled hall", nerdLabel: "Direct liquid cooling", art: "pipe" },
}

const HALL_LEARN = {
  cool: (hall) => [
    "Air cooling is the fans family. The servers breathe air.",
    `This hall handles up to ${hall.maxRackKW} kW per rack and is ready now.`,
    "Air-cooled GPUs fit. A liquid-cooled GPU overheats and slows down.",
  ],
  row: (hall) => [
    "Coolers sit between the racks, so heat does not cross the whole room.",
    `Up to ${hall.maxRackKW} kW per rack. PUE ${hall.pue}. Lead time ${hall.fitOutWeeks} weeks.`,
    "Air-cooled GPUs fit. NVL72 and Vera Rubin still need direct liquid cooling.",
  ],
  rear: (hall) => [
    "A water-cooled door on each rack takes the hot exhaust away. The servers stay air-cooled.",
    `Up to ${hall.maxRackKW} kW per rack, and a better PUE than plain fans, so more of a small power room reaches the GPUs.`,
    "Air-cooled Blackwell racks fit. NVL72 and Vera Rubin still need the liquid hall.",
  ],
  super: (hall) => [
    "Coolant goes straight to cold plates on the chips. This is the LIQUID-COOLED HALL.",
    `Up to ${hall.maxRackKW} kW per rack, and less power is spent on cooling.`,
    "Required for NVIDIA GB200 NVL72 and Vera Rubin.",
  ],
}

const HALL_WHY = {
  cool: "Ready now and cheapest, but a fan-cooled room wastes the most power on cooling.",
  row: "Coolers between the racks: a little more per rack, a little less waste.",
  rear: "Water doors on air racks: a better PUE, so more of a small power room reaches the GPUs.",
  super: "Cold plates on the chips: the only hall for NVL72 and Vera Rubin, and the least waste.",
}

const MEMORY_TILES = {
  off: { label: "KV cache OFF", hint: "GPUs re-read every chat", art: "gremlin", phrase: "Turning the KV cache off", inWords: "with the KV cache off", lines: ["With the KV cache off, the GPU throws away its notes at the end of each chat.", "The next question makes it re-read the whole conversation.", "Leave it off only for one-off questions."], nerd: "No saved chats. Prefill runs again on every turn." },
  on: { label: "KV cache ON", hint: "remembers chats, skips re-reading", art: "chest", phrase: "Turning the KV cache on", inWords: "with the KV cache on", lines: ["The KV cache is the GPU's notes on what it already read.", "A KV cache tier parks those notes and reloads them, so a follow-up skips the re-read.", "Turn it on when people keep the conversation going."], nerd: `Lead ${KV_TIER.leadWeeks} weeks, ${formatMoney(KV_TIER.capex)} and ${KV_TIER.kw} kW per site. Parks the KV cache instead of prefill.` },
  plus: { label: "KV cache ON + CPU host memory", hint: "parks long contexts on CPUs", art: "rackAir", phrase: "Adding CPU host memory to the KV cache", inWords: "with the KV cache parked on CPU hosts", lines: ["Grace or Vera class hosts keep a big CPU memory pool beside the GPUs.", "It parks very long contexts, past about 32k tokens, so agents skip even more prefill.", "For short chats it is just extra cost and power."], nerd: "Game value: $450k and 12 kW per site. With the KV tier on, contexts past 32k tokens skip more prefill (the full effect at 64k)." },
  dpu: { label: "KV cache ON + BlueField DPUs", hint: "secure multi-tenant hosts", art: "token", phrase: "Adding BlueField DPUs beside the KV cache", inWords: "with the KV cache and BlueField DPUs", lines: ["BlueField-class DPUs move data and keep tenants apart.", "The GPUs are interrupted less, which matters when many customers share a hall.", "They add cost and a little power, and they take the security work off the GPUs."], nerd: "Game value: $700k and 8 kW per site. A small tenancy haircut comes off." },
}

const MEMORY_WHY = {
  chat: { off: "Shoppers come back with follow-ups, so the GPUs re-read every chat.", on: "Half of every chat is a repeat: parked notes skip that prefill.", plus: "4k-token chats never need CPU memory; it is cost and power for nothing.", dpu: "Tenant isolation does not make a shopper's answer faster." },
  rag: { off: "Every lookup pastes 16k tokens the GPU reads again.", on: "The last lookup's prompt is parked, so a follow-up skips the re-read.", plus: "16k contexts do not reach the CPU pool; the KV tier alone is enough.", dpu: "Isolation for one head office does not pay." },
  code: { off: "Agents hold 64k tokens of context; re-reading it eats the GPUs.", on: "Parked notes help, but 64k contexts overflow the KV tier.", plus: "CPU memory parks whole 64k contexts: the agents' biggest win.", dpu: "Security hosts, not memory hosts: the long contexts still spill." },
  research: { off: "A 32k-token report is re-read on every tool call.", on: "Parked notes carry the report between tool calls.", plus: "At 32k tokens the CPU pool only starts to help; it costs more than it saves.", dpu: "Analysts share one tenancy; isolation does not pay here." },
  drug: { off: "Screening is batch work: the GPUs rarely re-read a prompt.", on: "Candidates are not conversations; a KV tier has little to park.", plus: "CPU memory for 2k-token prompts: power and money for nothing.", dpu: "One lab, one tenant: isolation buys nothing." },
  robot: { off: "Robots repeat similar prompts; a tiny re-read, done millions of times.", on: "Parked prompts shave the first-token time robots live by.", plus: "512-token prompts never reach CPU memory.", dpu: "Isolation does not shorten a 50 ms deadline." },
}

const WIRE_TILES = {
  cheap: { label: "Public internet", hint: "cheap, busy, slow at peaks", art: "gremlin", lines: ["The public internet is transit: the shared road everyone uses, crossing several networks.", "It is the slowest of the three: at least twice ServiceFabric's round trip, with jitter and a little packet loss.", "Fine for batch jobs that can wait; slow and jittery for live users."] },
  peer: { label: "Peering + eyeballs", hint: "straight into home networks", art: "user", lines: ["Peering swaps traffic directly with other networks at an internet exchange, so the path is shorter than transit.", "Eyeball networks are the ISPs your users are already on, so the last hop to them is short.", "The middle option: faster than the open internet, but still a shared path with some jitter; ServiceFabric is quicker and steadier."] },
  fast: { label: "ServiceFabric", hint: "private lane, fast and steady", art: "token", lines: ["ServiceFabric is Digital Realty's private, software-defined interconnection to clouds, partners, your other metros and Digital Internet.", "It is the fastest and steadiest of the three: lower delay than peering, less than half the public internet's, almost no jitter and no loss.", "A connection goes live in minutes once the port exists; documents and tools in the same building ride a cross connect, so that hop is tiny."] },
  private: { label: "Cross connect + Dark fiber", hint: "your own glass in the building and between sites", art: "chest", lines: ["A cross connect is your own fibre to a partner in the same building, so the delay is tiny.", "Dark fiber is your own glass between nearby metros, so it pays off with two or three sites.", "Users still reach you over ServiceFabric. Too far for fibre, and the link between sites uses ServiceFabric too."] },
  combo: { label: "COMBO", hint: "the right product on each leg", art: "gem", lines: ["Traffic has legs: people arriving, data being fetched, your sites talking to each other.", "A combo puts the right product on each leg instead of one product everywhere.", "You pay every product's set-up and monthly fee, and dark fiber waits out its lead time."] },
}

/** The COMBO tile's hint and learn lines name the legs for this story. */
const COMBO_HINT = {
  rag: "on-ramp cross connect + ServiceFabric",
  code: "on-ramp cross connect + ServiceFabric + MCP",
  research: "on-ramp cross connect + ServiceFabric",
  robot: "plant cross connects + ServiceFabric",
}

const WIRE_WHY = {
  chat: { cheap: "Shoppers on a jittery road leave before the first word.", peer: "Eyeball networks reach shoppers' ISPs directly: a short, shared path.", fast: "A private lane keeps every answer steady, and reaches the weights' cloud region.", private: "Your own glass between metros, ServiceFabric for shoppers." },
  rag: { cheap: "Staff reach you from the company cloud; the open internet adds jitter to every lookup.", peer: "An exchange gets staff closer, but the documents still cross a shared path.", fast: "ServiceFabric reaches the company cloud privately, but every lookup still travels to its region.", private: "A cross connect to the cloud on-ramp in this building: the shortest retrieval hop.", combo: "Staff arrive over ServiceFabric; the documents are one cross connect away on the on-ramp in this building." },
  code: { cheap: "Eight tool-call trips per task on a jittery road stall the agents.", peer: "Peering helps coders arrive; the repos still cross a shared path eight times.", fast: "Private links to coders, repos and the other coast keep eight trips steady, each still a trip to the repos' region.", private: "Cross connect to the repos' on-ramp, dark fiber where the metros are close.", combo: "Eight tool trips land on an on-ramp cross connect in the building; coders ride ServiceFabric, MCP sizes the rest." },
  research: { cheap: "Ten tool trips per report on the open internet add seconds.", peer: "Analysts arrive faster; the paper corpus still rides a shared path.", fast: "Private paths to analysts and the sovereign cloud keep ten trips predictable, each still a trip to the cloud region.", private: "A cross connect to the cloud on-ramp makes the paper lookups tiny.", combo: "Ten paper lookups ride a cross connect to the on-ramp in the building; analysts arrive over ServiceFabric." },
  drug: { cheap: "Batch data does not mind jitter, but a thin shared pipe screens fewer candidates an hour.", peer: "An exchange carries more bulk data than transit; a fat private pipe carries the most.", fast: "A fat ServiceFabric pipe from the lab keeps the GPUs fed with candidates.", private: "Dark fiber from the lab: the fattest feed, if the lab is close enough." },
  robot: { cheap: "Robots need 50 ms; the open internet cannot promise it.", peer: "Factories are not on eyeball networks; an exchange still shares the path.", fast: "A private path from each plant keeps the 50 ms promise.", private: "Dark fiber to a plant is possible; ServiceFabric does it without the dig.", combo: "Each plant's carrier lands in the building on a cross connect: the steadiest 50 ms loop; the rest rides ServiceFabric." },
}

const LIBRARY_TILES = {
  none: { label: "Local only", hint: "each server's own drives", art: "scroll", lines: ["Each server keeps its own small drives.", "Fine for a chatbot that only needs what it already knows.", "It does not hold a shared search, so looking up company documents is slow."] },
  basic: { label: "File & object", hint: "shared documents and checkpoints", art: "vault", lines: ["File and object storage holds the documents and the model files.", "The app can read a document before the model writes the answer.", "The model itself does not search."] },
  smart: { label: "Vector index", hint: "finds the right passages fast", art: "gem", lines: ["A vector index finds the right passages for retrieval.", "The app turns the question into numbers, searches the index, and pastes the best passages into the prompt.", "The model never searches mid-thought."] },
}

const LIBRARY_WHY = {
  chat: { none: "Shoppers' questions need no documents: local drives are free and enough.", basic: "Shared storage the chat never reads: cost and power for nothing.", smart: "An index with nothing to search for a help desk." },
  rag: { none: "With no shared index the model guesses from memory: wrong answers, slow lookups.", basic: "Documents are there, but the app scans files instead of searching an index.", smart: "The question becomes numbers, the index finds the passages, the GPU starts fast." },
  code: { none: "Repos and checkpoints have no shared home, so every agent fetches alone.", basic: "Shared repos and checkpoints: the agents start fast and share one copy.", smart: "An index helps a little; agents mostly read whole files." },
  research: { none: "Four hundred terabytes of papers with nowhere to look them up.", basic: "Papers are stored, but found by scanning: slow before the first word.", smart: "The index finds the right papers in milliseconds, before the model thinks." },
  drug: { none: "Candidate libraries with no shared home: the GPUs wait on them.", basic: "File and object storage keeps the next batch of candidates ready.", smart: "An index built for passages, not for molecule libraries." },
  robot: { none: "Robots need no documents: local drives are enough.", basic: "Shared storage no robot ever reads.", smart: "An index with nothing to search on a factory floor." },
}

const QPU_TILES = {
  none: { label: "No QPU", hint: "GPUs screen on their own", art: "rackAir", lines: ["The GPUs build the binding graph and search it classically.", "Fine for a first pass; ORCA finds more strong binders on the same candidates.", "No extra cabinets, no extra lead time."] },
  orca: { label: "ORCA PT-3", hint: "photonic quantum accelerator", art: "orca", lines: ["ORCA PT-3 is a photonic quantum accelerator in two cabinets beside the GPUs.", "GPUs build the binding graph; ORCA samples it and finds strong binders about twice as often.", "It costs money and a few months; it only pays when the GPUs are there."], nerd: `Lead ${ORCA.leadWeeks} weeks. Photonic boson sampling. London Innovation Lab, LHR19.` },
}

const QPU_WHY = {
  none: "Classical search on the GPUs: a fair screen, no extra cabinets.",
  orca: "ORCA samples the binding graph and finds strong binders about twice as often.",
}

/** Why a story does not need a QPU: the one line shown instead of a choice. */
const QPU_NOT_NEEDED = {
  chat: "A help desk writes words; there is no binding graph to sample.",
  rag: "Document lookup is a search problem the index already solves.",
  code: "Agents read and write code; nothing here is a sampling problem.",
  research: "Reasoning models think in tokens, not in photons.",
  robot: "Robots need answers in milliseconds; a QPU adds a hop, not speed.",
}

export function qpuRelevant(useCaseId) {
  return Boolean(byId(USE_CASES, useCaseId)?.orca)
}

export function qpuNotNeeded(useCaseId) {
  return QPU_NOT_NEEDED[useCaseId] || "This job has no sampling problem for a QPU to solve."
}

const km = (value) => `${Math.round(value).toLocaleString("en-GB")} km`
const pct = (share) => `${Math.round(share * 100)}%`
const count = (n) => Math.round(n).toLocaleString("en-GB")

/** The concurrency derivation for one users tier, in words: the tile's learn lines and its nerd line. */
export function usersDerivation(useCaseId, tierId) {
  const tier = usersTier(useCaseId, tierId)
  const uc = byId(USE_CASES, useCaseId)
  const spec = tier.spec
  const demand = `${formatTokens(tier.demand)} tokens a second`
  const scenario = scenarioFor(resolveUseCase(useCaseId, { users: tier.id }))
  const money = tier.scale === 1
    ? `This is the business the story was written for: a ${formatMoney(scenario.budget)} budget and ${scenario.powerMW} MW of power.`
    : `A business this size brings a ${formatMoney(scenario.budget)} budget and ${scenario.powerMW} MW of power (×${tier.scale} of the top tier, game assumption).`
  if (spec.kind === "batch") {
    const perDay = count(tier.candidatesPerDay)
    return {
      lines: [
        `${tier.label}, each queueing ${count(spec.perNight)} candidates a night: ${perDay} candidates a day. A pipeline, not a crowd; nobody waits on one answer.`,
        `${perDay} candidates × ${spec.tokens} tokens of poses and scores each ÷ 86,400 seconds in a day = ${demand}, steady, with no busy hour.`,
        money,
      ],
      nerd: `${count(tier.count)} × ${count(spec.perNight)} × ${spec.tokens} tok ÷ 86,400 s = ${count(tier.demand)} tok/s (≈ ${count(tier.streams)} streams at ${uc.tps} tok/s).`,
    }
  }
  if (spec.kind === "fleet") {
    return {
      lines: [
        `${tier.label} on the floor, each asking many times a second.`,
        `About ${pct(spec.duty)} of them are mid-request at any moment: ${count(tier.streams)} streams × ${uc.tps} tokens a second each = ${demand}.`,
        money,
      ],
      nerd: `${count(tier.count)} robots × duty ${spec.duty} = ${count(tier.streams)} streams × ${uc.tps} tok/s = ${count(tier.demand)} tok/s.`,
    }
  }
  const streams = spec.streams || 1
  const session = spec.minutes >= 60 ? `${spec.minutes / 60} hour${spec.minutes === 60 ? "" : "s"}` : `${spec.minutes} minutes`
  const perSession = streams === 1 ? `one model stream each` : `${streams} model streams each (the answer plus the agents working for them)`
  return {
    lines: [
      `${tier.label}: ${pct(spec.daily)} ask on a given day, ${spec.sessions} session${spec.sessions === 1 ? "" : "s"} of about ${session}, and the busy hour runs ${spec.peak}× the 24-hour average.`,
      `That is about ${count(tier.concurrent)} ${spec.who} at once, ${perSession}, at ${uc.tps} tokens a second: ${demand} at the peak.`,
      money,
    ],
    nerd: `${count(tier.count)} × ${spec.daily} × ${spec.sessions} × ${spec.minutes} min ÷ 1,440 × ${spec.peak} = ${count(tier.concurrent)} at once × ${streams} stream${streams === 1 ? "" : "s"} × ${uc.tps} tok/s = ${count(tier.demand)} tok/s.`,
  }
}

/** The six tiles of the first step: three model sizes, then three users tiers, each knowing its row. */
function modelTiles(useCaseId, choices = {}) {
  const picks = modelPicks(useCaseId, choices)
  const models = MODELS.map((model) => {
    const copy = MODEL_TILES[model.id]
    const uc = resolveUseCase(useCaseId, { model: model.id, users: picks.users })
    return {
      id: model.id,
      row: "model",
      label: `${model.label} (${model.example})`,
      hint: copy.hint,
      tag: `${model.weightsGB >= 1000 ? `${(model.weightsGB / 1000).toFixed(1)} TB` : `${model.weightsGB} GB`} FP8 · ${model.moe ? `${model.activeB}B ACTIVE` : "DENSE"}`,
      art: copy.art,
      lines: copy.lines,
      nerd: copy.nerd,
      why: copy.why,
      patch: { model: model.id },
      model,
      useCase: uc,
    }
  })
  const users = USER_TIER_IDS.map((tierId) => {
    const tier = usersTier(useCaseId, tierId)
    const derived = usersDerivation(useCaseId, tierId)
    return {
      id: tierId,
      row: "users",
      label: tier.label,
      hint: tier.kind === "batch" ? `${count(tier.candidatesPerDay)} a day · ${formatTokens(tier.demand)} tok/s` : `≈ ${count(tier.concurrent)} at once · ${formatTokens(tier.demand)} tok/s`,
      tag: USERS_TAG[tierId],
      art: USERS_ART[tierId],
      lines: derived.lines,
      nerd: derived.nerd,
      why: `${tier.label}: ${formatTokens(tier.demand)} tokens a second to serve${tierId === "large" ? ", the business this story was written for" : tierId === "medium" ? ", a tenth of the top crowd" : ", a hundredth of the top crowd"}.`,
      patch: { users: tierId },
      tier,
    }
  })
  return [...models, ...users]
}

/**
 * Who prompts this story and from where, as the location step shows it: one entry per
 * audience with its cities and request share, plus the model and data home.
 */
export function audienceSummary(useCaseId, choices = null) {
  const names = AUDIENCES[useCaseId] || {}
  const places = USER_BASES[useCaseId]?.places || []
  const groups = ["customers", "employees"].map((kind) => {
    const mine = places.filter((place) => place.kind === kind)
    if (!mine.length) return null
    const share = mine.reduce((sum, place) => sum + place.share, 0)
    const cities = mine.length === 1 ? mine[0].city : mine.map((place) => `${place.city} ${pct(place.share / share)}`).join(", ")
    return { kind, name: names[kind] || kind, cities, share }
  }).filter(Boolean)
  const home = choices ? dataHomeFor(resolveUseCase(useCaseId, modelPicks(useCaseId, choices))) : DATA_HOMES[useCaseId]
  return { groups, data: home ? { city: home.city, label: home.label, what: home.what } : null }
}

/**
 * The job in plain words plus the three numbers the maths runs on: who asks and how much,
 * how fast the first word must come, and how often an answer goes back to the data.
 * With a choice set, the demand and the model follow the first step's picks.
 */
export function jobBrief(useCaseId, choices = null) {
  const uc = choices ? resolveUseCase(useCaseId, modelPicks(useCaseId, choices)) : byId(USE_CASES, useCaseId)
  if (!uc) return { job: "", needs: [] }
  const { groups, data } = audienceSummary(useCaseId, choices)
  const who = groups.map((group) => `${group.name.toLowerCase()} (${pct(group.share)} of requests)`).join(" and ")
  const demand = `${formatTokens(uc.demand)} tokens a second`
  const first = uc.ttft < 1 ? `${Math.round(uc.ttft * 1000)} ms` : `${uc.ttft} s`
  const trips = dataTrips(uc)
  const dataLine = trips > 0
    ? `${trips} trip${trips === 1 ? "" : "s"} back to the data for every answer, and the data lives in ${data?.city || "the cloud"}`
    : `no retrieval: the model answers from memory, and its weights start in ${data?.city || "the cloud"}`
  return {
    job: JOBS[useCaseId] || uc.blurb,
    needs: [
      `${demand} of answers for ${who}`,
      `First word within ${first}${uc.ttft >= 5 ? " (batch: nobody is waiting on one answer)" : ""}`,
      dataLine,
    ],
  }
}

/** The audience distances on a metro tile: customers, employees, then the model and data. */
export function metroRows(useCaseId, offer) {
  const names = AUDIENCES[useCaseId] || {}
  const rows = []
  // Row labels get one short word ("Support team" → "Support") so three columns fit a tile.
  const short = (label) => (label.length > 8 ? label.split(" ")[0] : label)
  if (Number.isFinite(offer.customersKm)) rows.push({ id: "customers", label: short(names.customers || "Customers"), km: offer.customersKm })
  if (Number.isFinite(offer.employeesKm)) rows.push({ id: "employees", label: short(names.employees || "Employees"), km: offer.employeesKm })
  rows.push({ id: "data", label: "Data", km: offer.dataKm })
  return rows.map((row) => ({ ...row, text: row.km <= 60 ? "same city" : km(row.km) }))
}

/**
 * Why this metro is tempting against the others on the short list: the audience or data it
 * is nearest to, else what Digital Realty notes about it (power, price). Every tile differs.
 */
export function metroPitch(useCaseId, offer, offers = metroOffers(useCaseId)) {
  const rows = metroRows(useCaseId, offer)
  const wins = rows.filter((row) => {
    const field = `${row.id}Km`
    return offers.every((other) => other.id === offer.id || !(Number.isFinite(other[field]) && other[field] < offer[field]))
  })
  if (wins.length) {
    const names = wins.map((row) => (row.id === "data" ? "the model & data" : `the ${row.label.toLowerCase()}`))
    const first = wins[0]
    return `Nearest ${names.join(" and ")}${first.km <= 60 ? " (same city)" : ` (${km(first.km)})`}`
  }
  return offer.note.charAt(0).toUpperCase() + offer.note.slice(1)
}

/** One line on every metro tile: the trip to the users and the trip to the model and data. */
function metroHint(offer) {
  return `Users: ${km(offer.usersKm)} · Data: ${km(offer.dataKm)}`
}

/** Nerd line: the farthest user region, then the metro's power, price and fit-out terms. */
function metroNerd(offer) {
  const farthest = offer.worstCity ? `Farthest users: ${offer.worstCity} ${km(offer.worstKm)}. ` : ""
  return `${farthest}Power ×${offer.powerMult}, price ×${offer.priceMult}, liquid fit-out +${offer.liquidWeeks} wk (game values).`
}

function metroLines(useCaseId, offer) {
  const home = DATA_HOMES[useCaseId]
  const liquid = offer.liquidWeeks > 0 ? `A liquid hall here takes ${offer.liquidWeeks} extra weeks to fit out.` : "A liquid hall here is ready to fit out now."
  const power = offer.powerMult === 1 ? "The full power allocation is available." : offer.powerMult > 1 ? `About ${Math.round((offer.powerMult - 1) * 100)}% more power than the scenario asks for is available.` : `Only about ${Math.round(offer.powerMult * 100)}% of the scenario's power is available this year.`
  const price = offer.priceMult === 1 ? "" : offer.priceMult < 1 ? ` Power is about ${Math.round((1 - offer.priceMult) * 100)}% cheaper.` : ` Power is about ${Math.round((offer.priceMult - 1) * 100)}% dearer.`
  const trips = metroRows(useCaseId, offer).map((row) => `${row.text} from the ${row.label.toLowerCase()}`).join(", ")
  return [
    `${offer.site?.metro || offer.id}: ${offer.note}.`,
    `${trips.charAt(0).toUpperCase()}${trips.slice(1)}; the model and data live in ${home?.label || "the cloud"}. Requests pay the trip to whoever asks; every retrieval pays the trip to the data.`,
    `${power}${price} ${liquid}`,
  ]
}

function metroWhy(useCaseId, offer) {
  const home = DATA_HOMES[useCaseId]
  const nearData = offer.dataKm <= 60
  if (nearData) return `${offer.site?.metro}: beside ${home?.what || "the data"}, so nothing has to be copied.`
  return `${offer.site?.metro}: ${offer.note}; ${Math.round(offer.dataKm).toLocaleString("en-GB")} km from ${home?.city || "the data"}, so the weights and data copy over your link.`
}

/**
 * The tiles one step offers for a story, simple or nerd. Each tile knows what it sets. The
 * choice set only matters where a tile depends on another step: the GPU tiles scale their
 * rack counts with the users tier, the model tiles show the demand at that tier.
 */
export function stepTiles(useCaseId, stepId, nerd = false, choices = {}) {
  const ids = nerd ? NERD_IDS : SIMPLE_IDS
  if (stepId === "model") return modelTiles(useCaseId, choices)
  if (stepId === "location") {
    const offers = metroOffers(useCaseId)
    return offers.map((offer) => ({
      id: offer.id,
      label: offer.site?.metro || offer.id,
      hint: metroPitch(useCaseId, offer, offers),
      rows: metroRows(useCaseId, offer),
      tag: metroHint(offer).toUpperCase(),
      art: "user",
      lines: metroLines(useCaseId, offer),
      nerd: metroNerd(offer),
      why: metroWhy(useCaseId, offer),
      offer,
    }))
  }
  if (stepId === "gpu") {
    const { users } = modelPicks(useCaseId, choices)
    return (nerd ? nerdBrainIds(useCaseId) : simpleBrainIds(useCaseId)).map((id) => {
      const pick = brainPick(useCaseId, id, users)
      const platform = byId(PLATFORMS, pick.platform)
      const memory = platform ? `${platform.hbmGB} GB ${platform.hbmTBs < 2 ? "GDDR" : "HBM"}` : ""
      const spec = platform ? `${memory}, ${platform.hbmTBs} TB/s, ${platform.pflops} PFLOPS ${platform.precision}, ${platform.rackKW} kW, ${formatMoney(platform.capex)}, lead ${platform.leadWeeks} weeks` : ""
      return {
        id,
        label: `NVIDIA ${platform?.name || pick.platform} ×${pick.racks}`,
        hint: id === "huge" ? "more racks than the job needs" : GPU_HINTS[pick.platform] || "",
        tag: id === "huge" ? HUGE_TAG : GPU_TAG[pick.platform] || "",
        art: RACK_ART[pick.platform] || "rackAir",
        lines: GPU_LEARN[pick.platform] || ["A rack of GPUs."],
        nerd: platform?.id === "vr" ? `${spec}. Announced as NVL144.` : spec,
        why: id === "huge" ? "Several Vera Rubin racks: the money runs out before the hall pays off." : GPU_WHY[useCaseId]?.[pick.platform] || DOES[pick.platform] || "",
        patch: { brains: id },
        platform,
        racks: pick.racks,
      }
    })
  }
  if (stepId === "cooling") {
    return ids.home.map((id) => {
      const meta = HALL_META[id]
      const hall = byId(HALLS, meta.hallId)
      return {
        id,
        label: nerd ? meta.nerdLabel : meta.label,
        hint: nerd ? `${hall.maxRackKW} kW · PUE ${hall.pue} · ${hall.fitOutWeeks} wk` : id === "cool" ? "fans, ready now, cheaper" : id === "super" ? "water to the chip, faster" : id === "rear" ? "water door, more kW on air" : "coolers between the racks",
        art: meta.art,
        lines: HALL_LEARN[id](hall),
        nerd: `PUE ${hall.pue}. Fit-out ${hall.fitOutWeeks} weeks. Up to ${hall.maxRackKW} kW per rack.`,
        why: HALL_WHY[id],
        patch: { home: id },
        hall,
      }
    })
  }
  if (stepId === "memory") {
    return ids.memory.map((id) => ({ id, ...MEMORY_TILES[id], why: MEMORY_WHY[useCaseId]?.[id] || DOES.kv, patch: memoryChoices(id) }))
  }
  if (stepId === "wires") {
    return wireIds(useCaseId, nerd).map((id) => {
      const tile = { id, ...WIRE_TILES[id], why: WIRE_WHY[useCaseId]?.[id] || "", patch: { wires: id } }
      if (id === "combo") {
        const combo = COMBO[useCaseId]
        tile.hint = COMBO_HINT[useCaseId] || tile.hint
        tile.lines = [...combo.parts.map((part) => `${part}.`), WIRE_TILES.combo.lines[2]]
        tile.parts = combo.parts
      }
      return tile
    })
  }
  if (stepId === "storage") {
    return ids.library.map((id) => ({ id, ...LIBRARY_TILES[id], why: LIBRARY_WHY[useCaseId]?.[id] || DOES[{ none: "local", basic: "file", smart: "vector" }[id]], patch: { library: id } }))
  }
  if (stepId === "qpu") {
    if (!qpuRelevant(useCaseId)) {
      return [{ id: "none", label: "Not needed for this job", hint: qpuNotNeeded(useCaseId), art: "prof", lines: [qpuNotNeeded(useCaseId), "ORCA PT-3 is a photonic quantum accelerator for sampling problems such as drug binding graphs.", "Digital Realty hosts one at its London Innovation Lab (LHR19)."], why: qpuNotNeeded(useCaseId), patch: { helper: false }, locked: true }]
    }
    return ["none", "orca"].map((id) => ({ id, ...QPU_TILES[id], why: QPU_WHY[id], patch: { helper: id === "orca" } }))
  }
  return []
}

/** The tile id (or metro list, or the model and users pair) a choice set is on for one step. */
export function stepValue(useCaseId, stepId, choices = {}) {
  if (stepId === "model") return modelPicks(useCaseId, choices)
  if (stepId === "location") return cleanMetros(useCaseId, choices.metros)
  if (stepId === "gpu") return brainsId(useCaseId, choices.brains)
  if (stepId === "cooling") return choices.home || "cool"
  if (stepId === "memory") return memoryTile(choices)
  if (stepId === "wires") return choices.wires || "peer"
  if (stepId === "storage") return choices.library || "none"
  if (stepId === "qpu") return choices.helper && qpuRelevant(useCaseId) ? "orca" : "none"
  return null
}

/** The choice set after picking one tile on one step. A metro toggles; the last metro stays. */
export function applyTile(useCaseId, stepId, tileId, choices = {}) {
  const base = { ...defaultChoices(useCaseId), ...choices }
  if (stepId === "location") {
    const current = cleanMetros(useCaseId, base.metros)
    let metros
    if (current.includes(tileId)) metros = current.length > 1 ? current.filter((id) => id !== tileId) : current
    else if (current.length >= maxMetros(useCaseId)) metros = maxMetros(useCaseId) === 1 ? [tileId] : [...current.slice(1), tileId]
    else metros = [...current, tileId]
    const { sitePlans, ...rest } = base
    return { ...rest, metros }
  }
  const tile = stepTiles(useCaseId, stepId, true, base).find((item) => item.id === tileId) || stepTiles(useCaseId, stepId, false, base).find((item) => item.id === tileId)
  const next = tile ? { ...base, ...tile.patch } : base
  /* A reference architecture belongs to one platform: a new GPU tile drops a design built for another. */
  if (stepId === "gpu" && next.refarch && !designFor(brainPick(useCaseId, next.brains).platform, next.refarch)) delete next.refarch
  return next
}

/** True when a tile is the one a choice set is on: metros toggle, the first step has two rows. */
export function tileOn(useCaseId, stepId, tile, choices = {}) {
  const value = stepValue(useCaseId, stepId, choices)
  if (stepId === "location") return value.includes(tile.id)
  if (stepId === "model") return value[tile.row] === tile.id
  return value === tile.id
}

/** One line naming the first step's picks: the model size and the crowd. */
export function modelLabel(useCaseId, choices = {}) {
  const picks = modelPicks(useCaseId, choices)
  const model = byId(MODELS, picks.model)
  return `${model?.label || picks.model} · ${usersTier(useCaseId, picks.users).label}`
}

/** The short ids of a story's metro short list. */
export function metroShortList(useCaseId) {
  return metroOffers(useCaseId).map((offer) => offer.id)
}

/**
 * Every simple picture for one story at one model and crowd (the story's own by default): each
 * metro set × three tiles on five steps × the QPU choice.
 */
export function allSimple(useCaseId, picks = {}) {
  const list = []
  const first = modelPicks(useCaseId, picks)
  const qpu = qpuRelevant(useCaseId) ? [false, true] : [false]
  for (const metros of metroSets(useCaseId, metroShortList(useCaseId))) {
    for (const brains of simpleBrainIds(useCaseId)) {
      for (const home of SIMPLE_IDS.home) {
        for (const memory of SIMPLE_IDS.memory) {
          for (const wires of wireIds(useCaseId)) {
            for (const library of SIMPLE_IDS.library) {
              for (const helper of qpu) list.push({ ...first, metros, brains, home, wires, library, helper, ...memoryChoices(memory), mcp: false })
            }
          }
        }
      }
    }
  }
  return list
}

/** The simple-board opening picture: the home metro, the middle GPU, air, no memory, peering, local drives. */
export function simpleDefaults(useCaseId) {
  return { ...defaultChoices(useCaseId) }
}

/** One line that names a choice set tile by tile, for the coach and the results card. */
export function describeChoices(useCaseId, choices = {}) {
  const tile = (stepId) => {
    const value = stepValue(useCaseId, stepId, choices)
    return stepTiles(useCaseId, stepId, true, choices).find((item) => item.id === value) || stepTiles(useCaseId, stepId, false, choices).find((item) => item.id === value)
  }
  const metros = cleanMetros(useCaseId, choices.metros).map((id) => byId(SITES, id)?.metro || id)
  const parts = [
    tile("gpu")?.label,
    `${tile("cooling")?.label?.toLowerCase()} in ${metros.join(" + ")}`,
    tile("memory")?.inWords,
    `on ${tile("wires")?.label}`,
    `${tile("storage")?.label?.toLowerCase()} storage`,
  ]
  if (qpuRelevant(useCaseId)) parts.push(choices.helper ? "with ORCA PT-3" : "without a QPU")
  return parts.filter(Boolean).join(", ")
}

/** Which steps a choice set still leaves at the opening default: the review card lists them. */
export function untouchedSteps(useCaseId, choices = {}) {
  const base = defaultChoices(useCaseId)
  return BUILD_STEP_IDS.filter((stepId) => {
    if (stepId === "qpu" && !qpuRelevant(useCaseId)) return false
    const a = stepValue(useCaseId, stepId, choices)
    const b = stepValue(useCaseId, stepId, base)
    return JSON.stringify(a) === JSON.stringify(b)
  })
}
