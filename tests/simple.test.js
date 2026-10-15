import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { SITES, USE_CASES, byId } from "../js/data.js"
import { DR_FOOTER, bestChange, explainResult, headline } from "../js/explain.js"
import { FIBER_MAX_KM, evaluateBuild, kmBetween } from "../js/model.js"
import {
  COMBO,
  PRESET_IDS,
  SIMPLE_IDS,
  allPresets,
  brainPick,
  choicesToBuild,
  expertChoices,
  hasCombo,
  memoryChoices,
  memoryTile,
  nerdChoices,
  simpleChoices,
  wireIds,
} from "../js/presets.js"
import { allSimple, describeChoices, simpleDefaults, stepValue } from "../js/steps.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const main = readFileSync(join(root, "js/main.js"), "utf8")
const css = readFileSync(join(root, "css/game.css"), "utf8")

/* The nerd board is the full tile set; these tests compare nerd tiles, so they build in nerd mode. */
const score = (id, choices) => evaluateBuild(id, choicesToBuild(id, choices, true))
const presetBest = (id) => Math.max(...allPresets(id).map((choices) => score(id, choices).score))
const simpleScore = (id, combo) => evaluateBuild(id, choicesToBuild(id, combo, false))
const combo = (id, patch) => ({ ...simpleDefaults(id), ...patch })

test("the simple view offers three tiles a step and Vera Rubin ×1 in every story", () => {
  assert.deepEqual(PRESET_IDS.brains, ["small", "medium", "big", "rubin"])
  assert.deepEqual(PRESET_IDS.wires, ["cheap", "peer", "fast", "private", "combo"])
  assert.deepEqual(PRESET_IDS.homes, ["cool", "rear", "super"])
  assert.ok(PRESET_IDS.nerdBrains.includes("huge"), "the HUGE trap stays a nerd-mode option")
  assert.deepEqual(SIMPLE_IDS, { brains: ["medium", "big", "rubin"], home: ["cool", "rear", "super"], memory: ["off", "on", "plus"], wires: ["cheap", "peer", "fast"], library: ["none", "basic", "smart"] })
  for (const { id } of USE_CASES) assert.deepEqual(brainPick(id, "rubin"), { platform: "vr", racks: 1 }, id)
})

test("Vera Rubin ×1 fits the budget and the liquid hall but only research comes close to the best", () => {
  for (const { id } of USE_CASES) {
    const expert = expertChoices(id)
    const rubin = score(id, { ...expert, brains: "rubin", home: "super", metros: expert.metros.slice(0, 1) })
    const best = presetBest(id)
    assert.equal(rubin.overBudget, false, id)
    assert.ok(!rubin.warnings.some((line) => /liquid cooling|overheat/i.test(line)), id)
    assert.ok(rubin.score < best, `${id} rubin ${rubin.score} vs ${best}`)
    if (id === "rag" || id === "drug") assert.ok(rubin.overPower, `${id}: a 210 kW rack does not fit the small power room`)
    else assert.ok(rubin.score > 0, `${id} rubin ${rubin.score}`)
    if (id !== "research") assert.ok(rubin.score < best * 0.9, `${id} rubin ${rubin.score} should not optimise`)
  }
})

test("connection tiles follow real-world order: public < peering < ServiceFabric", () => {
  for (const { id } of USE_CASES) {
    const base = expertChoices(id)
    const built = ["cheap", "peer", "fast"].map((wires) => score(id, { ...base, wires }))
    const [cheap, peer, fast] = built.map((result) => result.score)
    if (id === "drug") {
      assert.ok(cheap >= 800 && cheap <= 1100, `drug internet ${cheap} should be viable`)
      assert.ok(peer >= 1000 && peer <= 1300, `drug peering ${peer}`)
      assert.equal(built[0].bandwidthCapped, true)
      assert.equal(built[0].slaMet, true)
      assert.ok(built[0].pMiss < 0.05, `batch work is not SLA-killed (${built[0].pMiss})`)
    } else assert.ok(cheap < peer, `${id} public ${cheap} vs peering ${peer}`)
    if (id === "chat" || id === "code" || id === "robot") assert.ok(cheap < 50, `${id} public ${cheap} should be near zero for live users`)
    if (id === "rag" || id === "research") assert.ok(cheap < 50, `${id} public ${cheap} should stay low`)
    assert.ok(cheap < peer, `${id} public ${cheap} vs peering ${peer}`)
    assert.ok(peer < fast, `${id} peering ${peer} vs ServiceFabric ${fast}`)
    if (id === "drug") {
      assert.ok(fast >= 1300 && fast <= 1430, `drug ServiceFabric ${fast}`)
      const networkLine = (index, wires) => explainResult(built[index], { ...base, wires }, { nerd: true }).lines.find((item) => item.id === "network").text
      const onInternet = networkLine(0, "cheap")
      assert.match(onInternet, /Public internet was fine for your batch lab data, but a private link would have screened \d+% more candidates/)
      assert.match(networkLine(1, "peer"), /Peering was fine for your batch lab data, but a private link would have screened \d+% more candidates/)
      const onFabric = networkLine(2, "fast")
      assert.match(onFabric, /Public internet would also have carried your batch lab data, but your private link screened \d+% more candidates/)
      for (const line of [onInternet, onFabric]) assert.doesNotMatch(line, /added jitter/)
    }
  }
})

test("cross connect + dark fiber only beats ServiceFabric with a partner in the building or several sites", () => {
  for (const { id } of USE_CASES) {
    const base = expertChoices(id)
    const fast = score(id, { ...base, wires: "fast" }).score
    const own = score(id, { ...base, wires: "private" }).score
    if (["rag", "research", "code", "drug"].includes(id)) {
      assert.ok(own > fast, `${id}: the documents, tools or lab sit beside the GPUs (${own} vs ${fast})`)
    } else {
      const one = base.metros.slice(0, 1)
      const fastOne = score(id, { ...base, metros: one, wires: "fast" }).score
      const ownOne = score(id, { ...base, metros: one, wires: "private" }).score
      assert.ok(ownOne <= fastOne, `${id} one site: own fibre ${ownOne} cannot beat ServiceFabric ${fastOne}`)
    }
  }
})

test("ServiceFabric MCP is a nerd toggle that never changes latency", () => {
  const plain = choicesToBuild("chat", { ...expertChoices("chat"), wires: "fast", mcp: true }, false)
  const nerd = choicesToBuild("chat", { ...expertChoices("chat"), wires: "fast", mcp: true }, true)
  assert.equal(plain.routes.control?.kind ?? "off", "off")
  assert.equal(nerd.routes.control.kind, "mcp")
  assert.equal(evaluateBuild("chat", nerd).ttft, evaluateBuild("chat", plain).ttft)
  assert.match(main, /"data-key": "wires-mcp"/)
})

test("nerd mode docks its panel as a column instead of covering the tiles", () => {
  const think = css.slice(css.indexOf(".think {"), css.indexOf("}", css.indexOf(".think {")))
  assert.doesNotMatch(think, /position:\s*absolute/)
  assert.match(css, /\.screen\.game\.nerd \{ grid-template-columns:/)
  assert.match(css, /\.row-nerd \{[^}]*text-overflow: ellipsis/)
  assert.match(main, /state\.nerd \? el\("aside", \{ class: "think"/)
  assert.match(main, /const tiles = stepTiles\(id, stepId, state\.nerd\)/)
  assert.match(main, /scale: state\.nerd \? 2 : 3/)
})

/* ---------- The simple board: seven steps, three real tiles each ---------- */

test("the memory step maps onto the KV tier and the hosts beside it, and the simple board snaps anything else onto its tiles", () => {
  for (const { id, orca } of USE_CASES) {
    const defaults = simpleDefaults(id)
    assert.deepEqual([defaults.brains, defaults.home, defaults.wires, defaults.library, defaults.metros.length], ["medium", "cool", "peer", "none", 1], id)
    assert.equal(defaults.memory, false, `${id} the opening picture has no memory tier`)
    assert.equal(defaults.helper, false, `${id} ORCA is a choice, not a default`)
    const build = choicesToBuild(id, defaults, false)
    assert.equal(build.orca, false, id)
    assert.equal(build.hosts, "standard", id)
    assert.equal(build.routes.control?.kind ?? "off", "off", `${id} MCP stays off on the simple board`)
    const meddled = choicesToBuild(id, { ...defaults, hosts: "dpu", mcp: true, helper: !orca, brains: "huge", home: "row", wires: "private" }, false)
    assert.equal(meddled.hosts, "standard", `${id} hosts snap onto the tile`)
    assert.equal(meddled.orca, false, `${id} ORCA snaps onto the tile`)
    assert.equal(meddled.platform, brainPick(id, "big").platform, `${id} HUGE snaps onto the big tile`)
    assert.equal(meddled.hall, "R", `${id} in-row cooling snaps onto the rear-door hall`)
    if (hasCombo(id)) {
      /* Own fibre snaps onto the COMBO tile, whose legs (and its MCP control leg where it has one) are the tile's own. */
      assert.equal(meddled.choices.wires, "combo", `${id} own fibre snaps onto COMBO`)
      assert.equal(meddled.routes.control?.kind ?? "off", COMBO[id].legs.control, id)
      assert.equal(meddled.routes.users?.kind, COMBO[id].legs.users, id)
    } else {
      assert.equal(meddled.routes.control?.kind ?? "off", "off", id)
      assert.equal(meddled.routes.users?.kind ?? meddled.routes.lab?.kind, "fabric", `${id} own fibre snaps onto ServiceFabric`)
    }
  }
  assert.deepEqual(memoryChoices("off"), { memory: false, hosts: "standard" })
  assert.deepEqual(memoryChoices("on"), { memory: true, hosts: "standard" })
  assert.deepEqual(memoryChoices("plus"), { memory: true, hosts: "grace" })
  assert.deepEqual(memoryChoices("dpu"), { memory: true, hosts: "dpu" })
  for (const tile of ["off", "on", "plus", "dpu"]) assert.equal(memoryTile(memoryChoices(tile)), tile)
  const chat = (memory) => choicesToBuild("chat", combo("chat", memoryChoices(memory)), false)
  assert.deepEqual([chat("off").kv, chat("on").kv, chat("plus").kv], [false, true, true])
  assert.deepEqual([chat("off").hosts, chat("on").hosts, chat("plus").hosts], ["standard", "standard", "grace"])
  assert.equal(choicesToBuild("chat", combo("chat", { hosts: "dpu", memory: true }), false).hosts, "grace", "DPUs are a nerd tile; the simple board snaps them onto CPU host memory")
  const rag = (library) => choicesToBuild("rag", combo("rag", { library }), false)
  assert.deepEqual([rag("none").data, rag("basic").data, rag("smart").data], ["local", "file", "vector"])
  const drug = (helper) => choicesToBuild("drug", combo("drug", { helper }), false)
  assert.deepEqual([drug(false).orca, drug(true).orca], [false, true])
  assert.equal(choicesToBuild("chat", combo("chat", { helper: true }), false).orca, false, "only drug discovery can buy ORCA")
})

test("simple picks round-trip through nerd mode and back without changing the build", () => {
  for (const { id } of USE_CASES) {
    for (const picks of allSimple(id)) {
      const nerd = nerdChoices(id, picks)
      const simpleBuild = choicesToBuild(id, picks, false)
      const nerdBuild = choicesToBuild(id, nerd, true)
      assert.deepEqual(simpleChoices(id, nerd), picks, `${id} ${describeChoices(id, picks)} back to simple`)
      const places = picks.metros.map((metro) => byId(SITES, metro))
      const regional = places.length > 1 && places.every((a) => places.every((b) => kmBetween(a, b) <= FIBER_MAX_KM))
      if (nerd.wires === "private" && regional) {
        /* The nerd "Cross connect + Dark fiber" tile also lights dark fiber between nearby metros; the simple ServiceFabric tile does not. */
        const { inter: nerdInter, ...nerdRest } = nerdBuild.routes
        const { inter: simpleInter, ...simpleRest } = simpleBuild.routes
        assert.deepEqual(nerdRest, simpleRest, `${id} ${describeChoices(id, picks)} routes`)
        assert.deepEqual([nerdInter?.kind, simpleInter?.kind], ["fiber", "fabric"], `${id} ${describeChoices(id, picks)} inter-site`)
        continue
      }
      assert.deepEqual(nerdBuild.routes, simpleBuild.routes, `${id} ${describeChoices(id, picks)} routes`)
      assert.equal(evaluateBuild(id, nerdBuild).score, evaluateBuild(id, simpleBuild).score, `${id} ${describeChoices(id, picks)} score`)
    }
    const huge = simpleChoices(id, { ...expertChoices(id), brains: "huge", hosts: "dpu", mcp: true })
    assert.equal(huge.brains, "big", `${id} HUGE snaps to the big tile`)
    assert.notEqual(huge.hosts, "dpu", id)
    assert.equal(huge.mcp, false, id)
  }
})

/** The resulting hardware behind a simple combo, for comparing optima across stories. */
function hardware(id, picks) {
  const build = choicesToBuild(id, picks, false)
  return {
    metros: build.sites.join("+"),
    gpu: `${build.platform}x${build.racks}`,
    hall: build.hall,
    memory: `${build.kv ? "kv" : "nokv"}/${build.hosts}`,
    wire: picks.wires,
    data: `${build.data}/${build.orca ? "orca" : "noorca"}`,
  }
}

const STEP_KEYS = ["location", "gpu", "cooling", "memory", "wires", "storage", "qpu"]

test("simple-space balance: story-specific optima, one winner, max-everything and naive fail, near-misses feel close", () => {
  const expected = {
    chat: { best: { metros: ["lon", "fra"], brains: "big", home: "super", memory: "on", wires: "fast", library: "none" }, typical: [250, 450] },
    rag: { best: { metros: ["fra"], brains: "medium", home: "rear", memory: "on", wires: "combo", library: "smart" }, typical: [5, 300] }, // no index on the home metro: DATA and POWER are red
    code: { best: { metros: ["iad", "sjc"], brains: "big", home: "super", memory: "plus", wires: "combo", library: "basic" }, typical: [30, 400] },
    research: { best: { metros: ["par"], brains: "big", home: "super", memory: "on", wires: "combo", library: "smart" }, typical: [100, 500] },
    drug: { best: { metros: ["lon"], brains: "medium", home: "rear", memory: "off", wires: "fast", library: "basic", helper: true }, typical: [300, 700] },
    robot: { best: { metros: ["fra", "ams"], brains: "big", home: "rear", memory: "on", wires: "combo", library: "none" }, typical: [300, 700] },
  }
  /* Robots: ServiceFabric everywhere is within 3% of the COMBO, so that one near-miss also keeps three stars. */
  const threeStarAllowance = { robot: 2 }
  const bests = {}
  for (const { id } of USE_CASES) {
    const scored = allSimple(id).map((picks) => ({ picks, score: simpleScore(id, picks).score }))
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a))
    bests[id] = best.picks
    const want = expected[id].best
    const got = { metros: best.picks.metros, brains: best.picks.brains, home: best.picks.home, memory: memoryTile(best.picks), wires: best.picks.wires, library: best.picks.library, ...(want.helper != null ? { helper: best.picks.helper } : {}) }
    assert.deepEqual(got, want, `${id} best is ${describeChoices(id, best.picks)} (${best.score})`)
    assert.ok(best.score >= 1390 && best.score <= 1410, `${id} best ${best.score}`)
    const widest = allSimple(id).reduce((a, b) => (b.metros.length > a.metros.length ? b : a)).metros
    const naive = simpleScore(id, combo(id, { brains: "rubin", home: "cool", wires: "cheap", library: "none", ...memoryChoices("off") })).score
    const maxed = simpleScore(id, combo(id, { metros: widest, brains: "rubin", home: "super", wires: "fast", library: "smart", helper: true, ...memoryChoices("plus") })).score
    const typical = simpleScore(id, simpleDefaults(id)).score
    assert.equal(naive, 0, `${id} naive ${naive}`)
    assert.ok(maxed <= 300, `${id} max everything ${maxed}`)
    const [lo, hi] = expected[id].typical
    assert.ok(typical >= lo && typical <= hi, `${id} typical ${typical} outside ${lo}-${hi}`)
    const near = scored.filter((item) => item.score >= best.score * 0.98)
    assert.ok(near.length >= 1 && near.length <= 2, `${id} has ${near.length} combos within 2% of the best`)
    // One step wrong: close enough to feel it, and (nearly always) short of three stars.
    const same = (picks, key) => JSON.stringify(stepValue(id, key, picks)) === JSON.stringify(stepValue(id, key, best.picks))
    const misses = scored.filter((item) => STEP_KEYS.filter((key) => !same(item.picks, key)).length === 1)
    assert.ok(misses.length >= 10, `${id} has ${misses.length} one-step misses`)
    assert.ok(misses.some((miss) => miss.score >= 700 && miss.score <= 1100), `${id} no one-step miss lands in 700-1,100: ${misses.map((miss) => miss.score).join(", ")}`)
    const threeStar = misses.filter((miss) => miss.score >= 1350)
    assert.ok(threeStar.length <= (threeStarAllowance[id] || 1), `${id}: ${threeStar.length} one-step misses still earn three stars`)
  }
  // The best pictures differ by story: at least two of the six decisions change between any two stories.
  const ids = USE_CASES.map((item) => item.id)
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = hardware(ids[i], bests[ids[i]])
      const b = hardware(ids[j], bests[ids[j]])
      const differ = Object.keys(a).filter((key) => a[key] !== b[key])
      assert.ok(differ.length >= 2, `${ids[i]} and ${ids[j]} share too much: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
    }
  }
})

test("the results headline ties the outcome to a data-center decision in plain words", () => {
  const banned = /\bms\b|tok\/s|TB\/s|\bkW\b|PUE|Gbps/
  for (const { id } of USE_CASES) {
    for (const picks of allSimple(id)) {
      const result = evaluateBuild(id, choicesToBuild(id, picks, false))
      const change = bestChange(id, picks)
      const line = headline(result, picks, change)
      assert.match(line, /^[A-Z0-9].*\.$/, `${id} ${describeChoices(id, picks)}: ${line}`)
      assert.equal(line.split(/(?<=[.!?])\s+(?=[A-Z])/).length, 1, `${id} one sentence: ${line}`)
      assert.doesNotMatch(line, banned, `${id} ${line}`)
      assert.match(line, /cool|hall|metro|internet|peering|ServiceFabric|connection|link|power|budget|deadline|arrived|index|storage|memory|ORCA|copy/i, `${id} names a data-center decision: ${line}`)
      assert.match(change.text, /would (have )?score|best build/, `${id} ${change.text}`)
      assert.equal(explainResult(result, picks).headline, line)
    }
  }
  const chatBest = combo("chat", { metros: ["lon", "fra"], brains: "big", home: "super", wires: "fast", ...memoryChoices("on") })
  const chat = evaluateBuild("chat", choicesToBuild("chat", chatBest, false))
  assert.match(headline(chat, chatBest, bestChange("chat", chatBest)), /^Your liquid-cooled hall in London and Frankfurt answered \d+% of shoppers in a blink over ServiceFabric: close, cool and connected\.$/)
  const hot = combo("chat", { brains: "big", home: "cool", wires: "fast" })
  assert.match(headline(evaluateBuild("chat", choicesToBuild("chat", hot, false)), hot), /overheated in the air-cooled hall in London: these racks need liquid cooling/)
  const slow = combo("chat", { brains: "medium", home: "cool", wires: "cheap" })
  assert.match(headline(evaluateBuild("chat", choicesToBuild("chat", slow, false)), slow), /^The public internet left \d+% of shoppers waiting/)
  const far = combo("chat", { brains: "medium", home: "cool", wires: "peer" })
  assert.match(headline(evaluateBuild("chat", choicesToBuild("chat", far, false)), far), /One metro in London kept \d+% of shoppers too far away/)
  const late = combo("robot", { brains: "rubin", home: "super", wires: "fast" })
  assert.match(headline(evaluateBuild("robot", choicesToBuild("robot", late, false)), late), /Vera Rubin NVL72 arrived in week \d+, \d+ weeks after the deadline/)
  const lab = combo("drug", { brains: "medium", home: "rear", wires: "fast", library: "basic", helper: true })
  assert.match(headline(evaluateBuild("drug", choicesToBuild("drug", lab, false)), lab), /screened 9\d% of the lab's candidates over ServiceFabric, with ORCA PT-3/)
  const stuck = combo("robot", { metros: ["fra", "ams"], brains: "rubin", home: "rear", wires: "cheap" })
  assert.match(bestChange("robot", stuck).text, /^No single change rescues this\. NVIDIA HGX H200 ×2, rear door heat exchanger in Frankfurt \+ Amsterdam, with the KV cache on, on COMBO, local only storage would score about 1,[34]\d\d\.$/)
  assert.equal(DR_FOOTER, "Built in a Digital Realty data center: power, cooling and connections ready.")
})

test("the simple screens are wired: three featured stories plus MORE, the stepped build, two gauges, headline and footer", () => {
  assert.match(main, /const FEATURED_STORIES = \["chat", "drug", "robot"\]/)
  assert.match(main, /key: "more-stories"/)
  assert.match(main, /if \(state\.nerd \|\| state\.moreStories\)/)
  assert.match(main, /function stepPanel\(stepId, result\)/)
  assert.match(main, /function reviewPanel\(result\)/)
  assert.match(main, /function feel\(result\)/)
  const feel = main.slice(main.indexOf("function feel("), main.indexOf("const SITE_ROLES"))
  assert.match(feel, /gauge\("MONEY"/)
  assert.match(feel, /gauge\("TIME"/)
  for (const nerdOnly of ['gauge("POWER"', 'gauge("SPEED"', 'gauge("CROWD"', 'gauge("PRICE"', "peopleBadge(result)", "roundBadge()"]) {
    const at = feel.indexOf(nerdOnly)
    assert.ok(at > 0 && feel.lastIndexOf("state.nerd ? [", at) > 0, `${nerdOnly} is nerd-only`)
  }
  assert.doesNotMatch(main, /"ORCA PT-3 included"/, "ORCA is a tile now, not a hidden default")
  assert.match(main, /"data-key": "headline", text: explained\.headline/)
  assert.match(main, /"data-key": "dr-footer"/)
  assert.match(main, /text: DR_FOOTER/)
  assert.match(main, /const choices = simpleDefaults\(useCaseId\)/)
  assert.match(main, /state\.nerd \? nerdChoices\(state\.plan\.useCase, state\.plan\.choices\) : simpleChoices\(state\.plan\.useCase, state\.plan\.choices\)/)
  assert.match(main, /scenesFor\(state\.nerd\)/)
  assert.match(main, /matchingScene\(state\.intro\?\.position\(\) \?\? 0, state\.nerd\)/)
  assert.match(css, /\.screen\.game \.step-panel \.tiles \{ display: grid;[^}]*repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(css, /\.story-cards\.featured \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(css, /\.title-card \{/)
  assert.match(css, /\.dr-footer \{/)
})
