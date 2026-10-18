/**
 * The stepped build: LOCATION, GPU, COOLING, MEMORY, CONNECTIVITY, STORAGE, QPU, then REVIEW.
 * Pure: tile sets per step for the simple board (three tiles) and nerd mode (the full set),
 * what each tile sets in a choice set, the one-line reason shown when a tile is picked, and
 * the enumeration of every simple picture for the balance checks. No DOM here.
 */
import { AUDIENCES, DATA_HOMES, DOES, HALLS, JOBS, KV_TIER, MODELS, ORCA, PLATFORMS, SITES, USER_BASES, USER_TIER_IDS, USE_CASES, byId, dataHomeFor, resolveUseCase, usersTier } from "./data.js"
import { dataTrips } from "./latency.js"
import { effectivePue, evaluateBuild, formatMoney, formatTokens, metroOffers, scenarioFor } from "./model.js"
import { COMBO, NERD_IDS, SIMPLE_IDS, brainPick, brainsId, choicesToBuild, cleanMetros, defaultChoices, maxMetros, memoryChoices, memoryTile, metroSets, modelPicks, nerdBrainIds, rackCount, simpleBrainIds, wireIds } from "./presets.js"
import { designFor } from "./refarch.js"

/**
 * The build in order. WHERE comes first so a player meets the scenario (who asks, from where, where
 * the data lives, the three numbers) before choosing the model and crowd; the numbers show the
 * story's defaults until MODEL & USERS is set.
 */
export const STEPS = [
  { id: "location", title: "LOCATION", hint: "Which Digital Realty metros", short: "WHERE" },
  { id: "model", title: "MODEL & USERS", hint: "Which model answers, and how many people ask", short: "MODEL" },
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

const RACK_ART = { spark: "rackAir", l40s: "rackAir", rtx6000: "rackAir", h100: "rackAir", h200: "rackAir", b200: "rackAir", b300: "rackAir", b300n: "rackAir", gb200: "rackLiquid", gb300: "rackLiquid", vr: "rackRubin" }

/** Five words that tell a newcomer what each rack is good at. */
const GPU_HINTS = {
  spark: "Desktop AI boxes on a shelf: cheap, tiny, slow memory",
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
  spark: "INCLUDED · AIR",
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
  spark: [
    "NVIDIA's desktop AI box: one GB10 Grace Blackwell chip with 128 GB of unified memory, $3,999 (nvidia.com/dgx-spark). Sixteen on a shelf is the game's unit.",
    "It loads a 70B or 100B model at FP4, but LPDDR5x at 273 GB/s is thirty times slower than an HGX node's HBM, so each box streams a few tokens a second and a 650B model does not fit even across a pair.",
    "Spark is a dev box: great for one engineer, not for a crowd. Pick it to see what memory bandwidth does to tokens per second.",
  ],
  l40s: [
    "A PCIe inference card from 2023 with 48 GB of GDDR6 memory and no NVLink.",
    "Its memory is four times slower than an H100's, so each GPU writes few tokens a second, and a 70B model needs all eight cards in the server.",
    "Pick it when the crowd is small and the money is tight: it is in stock and the cheapest rack on the board.",
  ],
  rtx6000: [
    "Blackwell on a PCIe card: 96 GB of GDDR7 memory, FP4 maths, in an 8-GPU air-cooled server.",
    "About a fifth of an HGX rack's price per GPU (estimate), but GDDR is five times slower than HBM, so it suits small models and modest crowds.",
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
      "671 GB of weights at FP8: too big for eight H100s (640 GB), a tight fit on eight H200s or FP4 Blackwell cards with little room left for context, so it runs best when a 72-GPU NVLink rack holds it whole.",
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
  chat: { spark: "A shelf of dev boxes: each streams a few tokens a second, so a million shoppers wait on almost nothing.", rtx6000: "Cheap FP4 tokens for a small crowd; a million shoppers need far more than eight PCIe racks.", h100: "Cheap and quick to get, but each rack answers few shoppers.", h200: "More memory than the H100, but the same slow maths for a million shoppers' prompts.", b300: "Six strong air racks: plenty of shoppers, no liquid hall needed.", gb200: "Two NVL72 racks answer the whole crowd, if the hall can cool them.", vr: "The fastest rack, but it lands after the 16-week deadline." },
  rag: { spark: "Dev boxes load the 70B model, but stream it too slowly for an office's questions.", rtx6000: "A budget rack for a small office; 16k-token prompts crawl on GDDR memory at scale.", h100: "Fits a 70B model, but slow on 16k-token prompts.", h200: "Fits a 70B model, but slow on 16k-token prompts.", b300: "Air-cooled Blackwell fits a small power room.", gb200: "One NVL72 rack would do; two blow the power room.", vr: "Scarce and late for a 20-week deadline." },
  code: { spark: "Dev boxes cannot hold the 650B model, and stream a 70B one far too slowly for agents.", rtx6000: "FP4 fits the 650B model across eight cards, but PCIe islands and GDDR make it crawl on 64k contexts.", h200: "Too little memory for 64k-token agent contexts.", b300: "Six air racks keep up until the contexts fill the memory.", gb200: "Three NVL72 racks hold a big model and its long contexts.", gb300: "Two reasoning racks hold the contexts, but the third rack's worth of developers waits.", vr: "Arrives too late for a 26-week launch." },
  research: { spark: "Dev boxes cannot hold the 650B model; long reports need HBM racks.", rtx6000: "A 650B model on PCIe islands: it loads, but every long answer crawls.", h200: "A 650B model does not fit well on Hopper islands.", b300: "Works, but a big model spills across small NVLink islands.", gb200: "72 GPUs as one is how a 650B reasoning model wants to run.", gb300: "One reasoning rack: 72 GPUs as one, but one rack for ten thousand analysts.", vr: "Inside the 36-week deadline, but the priciest rack on the board." },
  drug: { spark: "Dev boxes load the 100B protein model, but screen a few candidates an hour: the library never finishes.", l40s: "The cheapest cards: an overnight batch forgives slow memory, but fifteen racks still miss the candidates.", rtx6000: "Cheap FP4 screening for a small lab; the big library needs HBM racks.", h200: "Cheap racks, but a 100B model screens slowly on them.", b300: "Four Blackwell Ultra racks screen the library fast on air.", gb200: "More rack than the lab's power room can feed.", vr: "The lab would pay for speed it cannot power." },
  robot: { spark: "Dev boxes stream a few tokens a second: a robot waiting 50 ms for its first word gets nothing.", rtx6000: "Nine PCIe racks serve the fleet in time and cheaply; the plants' power rooms can feed them.", h100: "Cheap, but eight Hopper racks for what two Blackwell racks do.", h200: "Four Hopper racks still miss the fleet's 50 ms first word.", b200: "Two Blackwell racks on air serve the whole fleet from the plants.", b300: "Three racks is more than the fleet needs; the money shows in the token price.", vr: "A 210 kW rack far above what the fleet needs: power and money wasted." },
}

const HALL_META = {
  cool: { hallId: "A", label: "Air-cooled hall", nerdLabel: "Air cooling", art: "fan" },
  aisle: { hallId: "C", label: "Cold aisle containment", nerdLabel: "Cold aisle containment", art: "vault" },
  row: { hallId: "I", label: "In-row cooling", nerdLabel: "In-row cooling", art: "rackAir" },
  rear: { hallId: "R", label: "Rear door heat exchanger", nerdLabel: "Rear door heat exchanger", art: "chest" },
  super: { hallId: "B", label: "Liquid-cooled hall", nerdLabel: "Direct liquid cooling", art: "pipe" },
}

const HALL_LEARN = {
  cool: (hall) => [
    "Air cooling is the fans family. The servers breathe air, and nothing keeps the hot and cold air apart.",
    `This hall handles up to ${hall.maxRackKW} kW per rack (estimate) and is ready now.`,
    "Small air racks fit. An HGX rack runs too hot for open air, and a liquid-cooled GPU overheats and slows down.",
  ],
  aisle: (hall) => [
    "Doors and panels keep cold air in front of the racks and hot air behind them, so the fans work less.",
    `About 15 to ${hall.maxRackKW} kW per rack and PUE ${hall.pue.toFixed(2)} (estimates), fitted out in ${hall.fitOutWeeks} weeks.`,
    "Every air-cooled NVIDIA rack fits. NVL72 and Vera Rubin still need direct liquid cooling.",
  ],
  row: (hall) => [
    "Coolers sit between the racks, so heat does not cross the whole room.",
    `Up to ${hall.maxRackKW} kW per rack. PUE ${hall.pue}. Lead time ${hall.fitOutWeeks} weeks.`,
    "Air-cooled GPUs fit. NVL72 and Vera Rubin still need direct liquid cooling.",
  ],
  rear: (hall) => [
    "A radiator on the back door of the rack cools the hot air as it leaves, so ordinary air-cooled servers can be packed far denser.",
    `About 40 to ${hall.maxRackKW} kW per rack and PUE ${hall.pue.toFixed(2)} (estimates); it needs the building's chilled water, so ${hall.fitOutWeeks} weeks and about ${formatMoney(hall.rackNrc)} a rack. Racks of 30 kW or less are right-sized for containment.`,
    "Dense HGX racks of two to four 8-GPU nodes fit. NVL72 and Vera Rubin are direct-liquid designs: they still need the liquid hall.",
  ],
  super: (hall) => [
    "Coolant goes straight to cold plates on the chips. This is the LIQUID-COOLED HALL.",
    `Up to ${hall.maxRackKW} kW per rack, and less power is spent on cooling.`,
    "Required for NVIDIA GB200 NVL72 and Vera Rubin.",
  ],
}

const HALL_WHY = {
  cool: "Ready now and cheapest, but open air cools only small racks and wastes the most power on cooling.",
  aisle: "Doors and panels keep cold air in front of the racks and hot air behind them, so the fans work less.",
  row: "Coolers between the racks: a little more per rack, a little less waste.",
  rear: "A radiator on the rack's back door cools the hot air as it leaves, so ordinary air-cooled servers pack far denser.",
  super: "Cold plates on the chips: the only hall for NVL72 and Vera Rubin, and the least waste.",
}

const MEMORY_TILES = {
  off: { label: "KV cache OFF", hint: "GPUs re-read every chat", art: "gremlin", phrase: "Turning the KV cache off", inWords: "with the KV cache off", lines: ["With the KV cache off, the GPU throws away its notes at the end of each chat.", "The next question makes it re-read the whole conversation.", "Leave it off only for one-off questions."], nerd: "No saved chats. Prefill runs again on every turn." },
  on: { label: "KV cache ON", hint: "remembers chats, skips re-reading", art: "chest", phrase: "Turning the KV cache on", inWords: "with the KV cache on", lines: ["The KV cache is the GPU's notes on what it already read.", "A KV cache tier parks those notes and reloads them, so a follow-up skips the re-read.", "Turn it on when people keep the conversation going."], nerd: `Lead ${KV_TIER.leadWeeks} weeks, ${formatMoney(KV_TIER.capex)} and ${KV_TIER.kw} kW per site (game values). Parks the KV cache instead of prefill.` },
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
  /* User: "Change Peering + Eyeballs just to peering." The eyeball-network explanation stays inside the learn text. */
  peer: { label: "Peering", hint: "straight into home networks", art: "user", lines: ["Peering swaps traffic directly with other networks at an internet exchange, so the path is shorter than transit.", "Eyeball networks are the ISPs your users are already on, so peering with them makes the last hop short.", "The middle option: faster than the open internet, but still a shared path with some jitter; ServiceFabric is quicker and steadier."] },
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
    ? `This is the business the story was written for: a ${formatMoney(scenario.budget)} budget and ${scenario.powerMW} MW of power (game values).`
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

/** The six tiles of the MODEL & USERS step: three model sizes, then three users tiers, each knowing its row. */
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

/** True while MODEL & USERS still sits on the story's defaults: the brief's numbers say so. */
export function modelDefaulted(useCaseId, choices = null) {
  if (!choices) return true
  const picks = modelPicks(useCaseId, choices)
  const base = modelPicks(useCaseId)
  return picks.model === base.model && picks.users === base.users
}

/**
 * The job in plain words plus the three numbers the maths runs on: who asks and how much,
 * how fast the first word must come, and how often an answer goes back to the data.
 * With a choice set, the demand and the model follow the MODEL & USERS picks; the brief opens
 * the game (WHERE is step 1), so until that step is set the demand is marked as the default.
 */
export function jobBrief(useCaseId, choices = null) {
  const uc = choices ? resolveUseCase(useCaseId, modelPicks(useCaseId, choices)) : byId(USE_CASES, useCaseId)
  if (!uc) return { job: "", needs: [] }
  const { groups, data } = audienceSummary(useCaseId, choices)
  const who = groups.map((group) => `${group.name.toLowerCase()} (${pct(group.share)} of requests)`).join(" and ")
  const defaulted = modelDefaulted(useCaseId, choices)
  const demand = `${formatTokens(uc.demand)} tokens a second`
  const first = uc.ttft < 1 ? `${Math.round(uc.ttft * 1000)} ms` : `${uc.ttft} s`
  const trips = dataTrips(uc)
  const dataLine = trips > 0
    ? `${trips} trip${trips === 1 ? "" : "s"} back to the data for every answer, and the data lives in ${data?.city || "the cloud"}`
    : `no retrieval: the model answers from memory, and its weights start in ${data?.city || "the cloud"}`
  return {
    job: JOBS[useCaseId] || uc.blurb,
    needs: [
      `${demand} of answers for ${who}${defaulted ? " · the story's default until MODEL & USERS is set" : ""}`,
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
    const hall = byId(HALLS, HALL_META[choices.home]?.hallId || "A") || HALLS[0]
    return (nerd ? nerdBrainIds(useCaseId) : simpleBrainIds(useCaseId)).map((id) => {
      /* The tile shows the rack count it would land on: the chosen tile carries the count the player set, every other
         tile its own right-sized default (a count that suits one rack misreads every other). Its numbers come from the
         scoring engine for exactly that build (user: "ensure that is factored in to the maths that calculates the
         resulting performance and displayed on the right"). */
      const landing = landingRacks(useCaseId, id, choices, nerd)
      const pick = brainPick(useCaseId, id, users, landing.racks)
      const platform = byId(PLATFORMS, pick.platform)
      const result = evaluateBuild(useCaseId, choicesToBuild(useCaseId, { ...choices, brains: id, racks: landing.explicit ? landing.racks : undefined }, nerd))
      const memory = platform ? `${platform.hbmGB} GB ${platform.memKind || (platform.hbmTBs < 2 ? "GDDR" : "HBM")}` : ""
      /* Memory, bandwidth, dense PFLOPS and power are the public datasheet figures; the rack price and lead are game estimates. */
      const spec = platform ? `${memory}, ${platform.hbmTBs} TB/s, ${platform.pflops} PFLOPS ${platform.precision} dense, ${platform.rackKW} kW a rack; ${formatMoney(platform.capex)} a rack and a ${platform.leadWeeks}-week lead (estimates)` : ""
      /* The tile's racks as power: IT kW, and facility kW through the hall the board is on (cooling only changes the PUE). */
      const pue = platform ? effectivePue(platform, hall) : hall.pue
      const itKW = platform ? pick.racks * platform.rackKW : 0
      const power = platform ? `. ${pick.racks} rack${pick.racks === 1 ? "" : "s"} = ${itKW} kW IT, ${Math.round(itKW * pue)} kW at PUE ${pue} in the ${hall.name.toLowerCase()}` : ""
      return {
        id,
        /* A Spark "rack" is a shelf of boxes: the tile counts the boxes. */
        label: platform?.id === "spark" ? `NVIDIA DGX Spark ×${pick.racks * platform.gpusPerRack}` : `NVIDIA ${platform?.name || pick.platform} ×${pick.racks}`,
        hint: id === "huge" ? "more racks than the job needs" : GPU_HINTS[pick.platform] || "",
        tag: id === "huge" ? HUGE_TAG : GPU_TAG[pick.platform] || "",
        art: RACK_ART[pick.platform] || "rackAir",
        /* The hold-to-learn card ends with the engine's four numbers for this count, for the boards too narrow to show them on the tile. */
        lines: [...(GPU_LEARN[pick.platform] || ["A rack of GPUs."]), `At ${pick.racks} ${platform?.id === "spark" ? (pick.racks === 1 ? "shelf" : "shelves") : pick.racks === 1 ? "rack" : "racks"} on this board: serves ${Math.round((result.coverage || 0) * 100)}% of the crowd, ${(result.powerUsedMW || 0).toFixed(2)} of ${result.powerMW} MW, ${formatMoney(result.budgetSpend || 0)}, ${platform?.leadWeeks ?? 0}-week lead (game numbers).`],
        nerd: platform?.id === "vr" ? `${spec}${power}. Announced as NVL144.` : `${spec}${power}`,
        why: id === "huge" ? "Several Vera Rubin racks: the money runs out before the hall pays off." : GPU_WHY[useCaseId]?.[pick.platform] || DOES[pick.platform] || "",
        patch: { brains: id, racks: landing.explicit ? landing.racks : undefined },
        platform,
        racks: pick.racks,
        rows: gpuRows(result, platform),
        result,
      }
    })
  }
  if (stepId === "cooling") {
    return ids.home.map((id) => {
      const meta = HALL_META[id]
      const hall = byId(HALLS, meta.hallId)
      /* The band a hall cools, its overhead and its lead sit on every tile: containment reads 15–30 kW, the rear door
         40–70 kW, the rest "up to"; the simple board says "29% on cooling" where nerd mode says PUE 1.29 (the simple
         board never shows PUE). A liquid-only rack on the board marks every air hall "needs direct liquid". */
      const band = id === "aisle" ? `15–${hall.maxRackKW} kW` : id === "rear" ? `40–${hall.maxRackKW} kW` : `up to ${hall.maxRackKW} kW`
      const overhead = nerd ? `PUE ${hall.pue.toFixed(2)}` : `${Math.round((hall.pue - 1) * 100)}% on cooling`
      const lead = hall.fitOutWeeks ? `${hall.fitOutWeeks} wk` : "ready now"
      const picked = byId(PLATFORMS, brainPick(useCaseId, choices.brains, modelPicks(useCaseId, choices).users, choices.racks).platform)
      const liquidNeeded = picked?.cooling === "liquid" && hall.cooling !== "liquid"
      const plainHint = id === "cool" ? "fans, ready now, small racks only" : id === "aisle" ? "doors keep hot and cold air apart" : id === "super" ? "water to the chip, faster" : id === "rear" ? "radiator door: dense air racks" : "coolers between the racks"
      return {
        id,
        label: nerd ? meta.nerdLabel : meta.label,
        hint: liquidNeeded ? `needs direct liquid for ${picked.name}` : nerd ? `${hall.maxRackKW} kW · PUE ${hall.pue} · ${lead}` : plainHint,
        tag: `${band} · ${overhead} · ${lead}`,
        liquidNeeded,
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

/**
 * The four numbers on a GPU tile for the build it would make: the share of the crowd served, the busiest
 * site's facility MW against the metro's offer, the spend against the budget (ORCA's price stays out of
 * it, as everywhere on the game screen), and the platform's lead. All from evaluateBuild.
 */
export function gpuRows(result, platform) {
  if (!result || !platform) return []
  return [
    { label: "SERVES", text: `${Math.round((result.coverage || 0) * 100)}%` },
    { label: "POWER", text: `${(result.powerUsedMW || 0).toFixed(2)}/${result.powerMW} MW` },
    { label: "COST", text: formatMoney(result.budgetSpend || 0) },
    { label: "LEAD", text: `${platform.leadWeeks} wk` },
  ]
}

/**
 * The rack count a GPU tile lands on: the chosen tile keeps the count the player set; any other tile lands
 * on its own default for the crowd, so the count belongs to the rack it was set for (HUGE always brings its
 * own count). `nerd` is accepted for symmetry with the other guards.
 */
export function landingRacks(useCaseId, brains, choices = {}, nerd = false) {
  const { users } = modelPicks(useCaseId, choices)
  const explicit = rackCount(choices)
  const id = brainsId(useCaseId, brains)
  const current = brainsId(useCaseId, choices.brains)
  void nerd
  if (explicit && id !== "huge" && id === current) return { racks: explicit, explicit: true }
  return { racks: brainPick(useCaseId, brains, users).racks, explicit: false }
}

/**
 * The rack stepper's range: one rack up to the hall's rack positions at every site (a count past the power
 * offer is allowed and browns out; a count past the budget is refused by `rackGuard`). Nerd mode steps by
 * five as well as by one.
 */
export function rackBounds(useCaseId, choices = {}, nerd = false) {
  const hall = byId(HALLS, HALL_META[choices.home]?.hallId || "C") || HALLS[0]
  const sites = cleanMetros(useCaseId, choices.metros).length || 1
  return { min: 1, max: Math.max(1, (hall.rackSpace || 12) * sites), steps: nerd ? [-5, -1, 1, 5] : [-1, 1] }
}

/** The choice set with the rack count moved by `delta`, clamped to the stepper's range; the count becomes the player's. */
export function applyRacks(useCaseId, choices = {}, delta = 0, nerd = false) {
  const { users } = modelPicks(useCaseId, choices)
  const current = rackCount(choices) || brainPick(useCaseId, choices.brains, users).racks
  const bounds = rackBounds(useCaseId, choices, nerd)
  const racks = Math.min(bounds.max, Math.max(bounds.min, current + delta))
  return { ...choices, racks, brainsAuto: false }
}

/**
 * The budget guard on one stepper button: more racks the scenario budget cannot pay for are refused, tagged
 * OVER BUDGET by the shortfall; fewer racks are always allowed; a step that cannot move (at the range's end)
 * is disabled.
 */
export function rackGuard(useCaseId, choices = {}, delta = 0, nerd = false) {
  const { users } = modelPicks(useCaseId, choices)
  const current = rackCount(choices) || brainPick(useCaseId, choices.brains, users).racks
  const bounds = rackBounds(useCaseId, choices, nerd)
  const next = Math.min(bounds.max, Math.max(bounds.min, current + delta))
  if (next === current) return { blocked: true, atEnd: true, racks: current }
  if (delta < 0) return { blocked: false, racks: next }
  const money = budgetOf(useCaseId, applyRacks(useCaseId, choices, delta, nerd), nerd)
  if (money.over) return { blocked: true, racks: next, tag: `OVER BUDGET by ${formatMoney(money.overBy)}`, line: `${next} racks would be over the ${formatMoney(money.budget)} budget by ${formatMoney(money.overBy)} (game prices). Fewer racks, or a cheaper rack, first.`, ...money }
  return { blocked: false, racks: next, ...money }
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

/**
 * The choice set after picking one tile on one step. A metro toggles; the last metro stays.
 * MODEL & USERS sets the budget: a smaller crowd that leaves the build over budget snaps the
 * GPU (then the rest of the board) back to something the new budget affords, so the hidden
 * defaults are always affordable. `nerd` says which board's tiles count.
 */
export function applyTile(useCaseId, stepId, tileId, choices = {}, nerd = false) {
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
  /* A reference architecture belongs to one platform: a new GPU tile drops a design built for another.
   * A GPU the player picked is theirs: MODEL & USERS stops re-deriving it (brainsAuto). */
  if (stepId === "gpu") {
    dropForeignDesign(useCaseId, next)
    next.brainsAuto = false
    /* A new rack starts at its own default count: the tile said so. */
    if (next.racks == null) delete next.racks
  }
  return stepId === "model" ? affordableChoices(useCaseId, next, nerd) : next
}

/**
 * True when a choice set fits its scenario: inside the budget and the power offer, the model
 * loads, and the GPUs can stream an answer at the story's speed (a desktop box that cannot is
 * never the hidden default).
 */
export function fitsChoices(useCaseId, choices = {}, nerd = false) {
  const result = evaluateBuild(useCaseId, choicesToBuild(useCaseId, choices, nerd))
  return Boolean(result.ok) && !result.overBudget && !result.overPower && result.bottleneck !== "fit" && !result.slowStream
}

function dropForeignDesign(useCaseId, choices) {
  if (choices.refarch && !designFor(brainPick(useCaseId, choices.brains).platform, choices.refarch)) delete choices.refarch
  return choices
}

/** A choice set without the player's rack count: the platform default. */
function defaultRackChoices(choices) {
  const { racks, ...rest } = choices
  return rest
}

/** The spend one choice set makes against its scenario budget, on the simple or the nerd board. */
export function budgetOf(useCaseId, choices = {}, nerd = false) {
  const result = evaluateBuild(useCaseId, choicesToBuild(useCaseId, choices, nerd))
  return { spend: result.budgetSpend || 0, budget: result.budget || 0, over: Boolean(result.overBudget), overBy: result.finance || 0 }
}

/**
 * A choice set the budget affords: the set itself when it already does, else the cheapest GPU
 * tile (the lists run cheapest first) that fits with the rest of the board as it is, else the
 * opening picture at this model and crowd with the cheapest GPU that fits.
 *
 * A GPU the player has not picked themselves (no GPU-step tap yet: `brainsAuto` unset or true)
 * is a hidden default, and a hidden default follows the crowd both ways: the story's opening
 * rack when it fits the new budget and power offer, else the cheapest tile that does. So a
 * crowd that shrinks and grows back lands on the same opening build, and the POWER light is
 * never red on a board the player has not touched.
 */
export function affordableChoices(useCaseId, choices = {}, nerd = false) {
  const brains = nerd ? nerdBrainIds(useCaseId) : simpleBrainIds(useCaseId)
  if (choices.brainsAuto !== false) {
    const opening = defaultChoices(useCaseId).brains
    for (const id of [opening, ...brains.filter((item) => item !== opening)]) {
      const next = dropForeignDesign(useCaseId, { ...choices, brains: id, brainsAuto: true })
      if (fitsChoices(useCaseId, next, nerd)) return next
    }
  }
  if (!budgetOf(useCaseId, choices, nerd).over) return choices
  /* A rack count the player set that the new budget cannot pay for goes first, then the GPU tile. */
  if (rackCount(choices) && !budgetOf(useCaseId, defaultRackChoices(choices), nerd).over) return defaultRackChoices(choices)
  for (const id of brains) {
    const next = dropForeignDesign(useCaseId, { ...defaultRackChoices(choices), brains: id })
    if (!budgetOf(useCaseId, next, nerd).over) return next
  }
  const opening = { ...defaultChoices(useCaseId), ...modelPicks(useCaseId, choices) }
  for (const id of brains) {
    const next = { ...opening, brains: id }
    if (!budgetOf(useCaseId, next, nerd).over) return next
  }
  return choices
}

/* The steps a blocked tile's advice looks at for something to drop, biggest ticket first. */
const DROP_ORDER = ["gpu", "memory", "storage", "qpu", "cooling", "wires", "location"]

/**
 * The budget guard on one tile: what picking it now would spend. A tile whose pick would go
 * over the scenario budget is blocked: the board still shows it, tagged OVER BUDGET by the
 * shortfall, with a line saying what to drop, and refuses the tap. The first step sets the
 * budget and is never blocked; a tile that is already on is the build itself and is never blocked.
 */
export function tileGuard(useCaseId, stepId, tile, choices = {}, nerd = false) {
  if (stepId === "model" || !tile || tile.locked || tileOn(useCaseId, stepId, tile, choices)) return { blocked: false }
  const next = applyTile(useCaseId, stepId, tile.id, choices, nerd)
  const money = budgetOf(useCaseId, next, nerd)
  if (!money.over) return { blocked: false, ...money }
  return { blocked: true, ...money, tag: `OVER BUDGET by ${formatMoney(money.overBy)}`, line: dropLine(useCaseId, stepId, next, money, nerd) }
}

/** One plain line for a blocked tile: the shortfall, and the first other-step change that would pay for it. */
function dropLine(useCaseId, stepId, next, money, nerd) {
  const lead = `Over the ${formatMoney(money.budget)} budget by ${formatMoney(money.overBy)} (game prices).`
  for (const other of DROP_ORDER) {
    if (other === stepId || (other === "qpu" && !qpuRelevant(useCaseId))) continue
    const current = stepValue(useCaseId, other, next)
    for (const alt of stepTiles(useCaseId, other, nerd, next)) {
      if (alt.locked || alt.id === current || (other === "location" && !current.includes(alt.id))) continue
      if (other === "location" && current.length <= 1) break
      if (!budgetOf(useCaseId, applyTile(useCaseId, other, alt.id, next, nerd), nerd).over) {
        const step = STEPS[stepIndex(other)]
        const verb = other === "location" ? `drop ${alt.label}` : `pick ${alt.label}`
        return `${lead} To afford it, ${verb} on the ${step.short} step.`
      }
    }
  }
  return `${lead} Nothing else on the board frees enough: this crowd's budget needs a cheaper GPU.`
}

/** True when a tile is the one a choice set is on: metros toggle, MODEL & USERS has two rows. */
export function tileOn(useCaseId, stepId, tile, choices = {}) {
  const value = stepValue(useCaseId, stepId, choices)
  if (stepId === "location") return value.includes(tile.id)
  if (stepId === "model") return value[tile.row] === tile.id
  return value === tile.id
}

/** One line naming the MODEL & USERS picks: the model size and the crowd. */
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
