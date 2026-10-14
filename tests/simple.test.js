import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { USE_CASES } from "../js/data.js"
import { DR_FOOTER, bestChange, explainResult, headline } from "../js/explain.js"
import { evaluateBuild } from "../js/model.js"
import {
  PRESET_IDS,
  SIMPLE_IDS,
  allPresets,
  allSimple,
  brainPick,
  choicesToBuild,
  expertChoices,
  nerdChoices,
  simpleChoices,
  simpleDefaults,
  simplePicks,
  simpleTiles,
  simpleToChoices,
} from "../js/presets.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const main = readFileSync(join(root, "js/main.js"), "utf8")
const css = readFileSync(join(root, "css/game.css"), "utf8")

/* The nerd board is the full tile set; these tests compare nerd tiles, so they build in nerd mode. */
const score = (id, choices) => evaluateBuild(id, choicesToBuild(id, choices, true))
const presetBest = (id) => Math.max(...allPresets(id).map((choices) => score(id, choices).score))
const simpleScore = (id, combo) => evaluateBuild(id, choicesToBuild(id, simpleToChoices(id, combo), false))

test("the simple view offers at most four tiles per row and Vera Rubin ×1 in every story", () => {
  assert.deepEqual(PRESET_IDS.brains, ["small", "medium", "big", "rubin"])
  assert.deepEqual(PRESET_IDS.wires, ["cheap", "peer", "fast", "private"])
  assert.deepEqual(PRESET_IDS.homes, ["cool", "super"])
  assert.ok(PRESET_IDS.nerdBrains.includes("huge"), "the HUGE trap stays a nerd-mode option")
  for (const { id } of USE_CASES) assert.deepEqual(brainPick(id, "rubin"), { platform: "vr", racks: 1 }, id)
})

test("Vera Rubin ×1 fits the budget and the liquid hall but only research comes close to the best", () => {
  for (const { id } of USE_CASES) {
    const rubin = score(id, { ...expertChoices(id), brains: "rubin", home: "super", cities: 1 })
    const best = presetBest(id)
    assert.equal(rubin.overBudget, false, id)
    assert.ok(!rubin.warnings.some((line) => /liquid cooling|overheat/i.test(line)), id)
    assert.ok(rubin.score > 0, `${id} rubin ${rubin.score}`)
    assert.ok(rubin.score < best, `${id} rubin ${rubin.score} vs ${best}`)
    if (id !== "research") assert.ok(rubin.score < best * 0.9, `${id} rubin ${rubin.score} should not optimise`)
  }
})

test("connection tiles follow real-world order: public < peering < ServiceFabric", () => {
  for (const { id } of USE_CASES) {
    const base = expertChoices(id)
    const built = ["cheap", "peer", "fast"].map((wires) => score(id, { ...base, wires }))
    const [cheap, peer, fast] = built.map((result) => result.score)
    if (id === "drug") {
      assert.ok(cheap >= 900 && cheap <= 1100, `drug internet ${cheap} should be viable`)
      assert.ok(peer >= 1000 && peer <= 1150, `drug peering ${peer}`)
      assert.equal(built[0].bandwidthCapped, true)
      assert.equal(built[0].slaMet, true)
      assert.ok(built[0].pMiss < 0.05, `batch work is not SLA-killed (${built[0].pMiss})`)
    } else assert.ok(cheap < peer, `${id} public ${cheap} vs peering ${peer}`)
    if (id === "chat" || id === "code" || id === "robot") assert.ok(cheap < 50, `${id} public ${cheap} should be near zero for live users`)
    if (id === "rag" || id === "research") assert.ok(cheap < 50, `${id} public ${cheap} should stay low`)
    assert.ok(cheap < peer, `${id} public ${cheap} vs peering ${peer}`)
    assert.ok(peer < fast, `${id} peering ${peer} vs ServiceFabric ${fast}`)
    if (id === "drug") {
      assert.ok(fast >= 1300 && fast <= 1400, `drug ServiceFabric ${fast}`)
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
      const fastOne = score(id, { ...base, cities: 1, wires: "fast" }).score
      const ownOne = score(id, { ...base, cities: 1, wires: "private" }).score
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
  assert.match(main, /const rows = state\.nerd \? \[/)
  for (const row of ["brainRow", "hostRow", "memoryRow", "libraryRow", "homeRow", "wireRow", "orcaRow"]) assert.match(main, new RegExp(`${row}\\(choices`), row)
  assert.match(main, /\.filter\(Boolean\) : simpleRows\(choices\)/)
})

/* ---------- The simple board: three decisions, three real tiles each ---------- */

test("the simple board is three rows of three real tiles with a short hint on every tile", () => {
  assert.deepEqual(SIMPLE_IDS, { brains: ["medium", "big", "rubin"], halls: ["cool", "super", "plus"], wires: ["cheap", "peer", "fast"] })
  for (const { id } of USE_CASES) {
    const tiles = simpleTiles(id)
    assert.deepEqual(Object.keys(tiles), ["brains", "halls", "wires"], id)
    for (const row of Object.values(tiles)) {
      assert.equal(row.length, 3, id)
      for (const tile of row) {
        assert.ok(tile.label.length > 0 && tile.label.length <= 28, `${id} label "${tile.label}"`)
        const words = tile.hint.split(/[\s,+]+/).filter(Boolean).length
        assert.ok(words >= 3 && words <= 6, `${id} hint "${tile.hint}" has ${words} words`)
        assert.doesNotMatch(`${tile.label} ${tile.hint}`, /TB\/s|PFLOPS|\bPUE\b|\bms\b|\$/, `${id} ${tile.label}`)
      }
    }
    assert.deepEqual(tiles.wires.map((tile) => tile.label), ["Public internet", "Peering + eyeballs", "ServiceFabric"], id)
    assert.deepEqual(tiles.halls.slice(0, 2).map((tile) => tile.label), ["Air-cooled hall", "Liquid-cooled hall"], id)
    assert.equal(tiles.brains[2].label, "Vera Rubin NVL72 ×1", id)
    assert.equal(allSimple(id).length, 27, id)
  }
  assert.deepEqual(simpleTiles("chat").brains.map((tile) => tile.label), ["HGX B300 ×6", "GB200 NVL72 ×2", "Vera Rubin NVL72 ×1"])
  assert.equal(simpleTiles("chat").halls[2].label, "Liquid-cooled in 2 metros")
  assert.match(simpleTiles("chat").halls[2].hint, /London \+ Frankfurt/)
  assert.equal(simpleTiles("code").halls[2].label, "Liquid-cooled in 2 metros")
  /* Robotics runs air-cooled Hopper racks, so its two metros are air halls, like the nerd expert picture. */
  assert.equal(simpleTiles("robot").halls[2].label, "Air-cooled in 2 metros")
  assert.match(simpleTiles("robot").halls[2].inWords, /^in air-cooled halls in Frankfurt and Amsterdam$/)
  assert.deepEqual([simpleToChoices("robot", { hall: "plus" }).home, simpleToChoices("robot", { hall: "plus" }).cities], ["cool", 2])
  assert.deepEqual([simpleToChoices("chat", { hall: "plus" }).home, simpleToChoices("chat", { hall: "plus" }).cities], ["super", 2])
  for (const id of ["rag", "research", "drug"]) assert.equal(simpleTiles(id).halls[2].label, "Liquid-cooled + KV memory", id)
})

test("the simple board applies its hidden defaults: memory where reuse is high, storage auto, ORCA on for drug", () => {
  for (const { id, orca } of USE_CASES) {
    const defaults = simpleDefaults(id)
    assert.equal(defaults.brains, "medium", id)
    assert.equal(defaults.home, "cool", id)
    assert.equal(defaults.wires, "peer", id)
    assert.equal(defaults.cities, 1, id)
    assert.equal(defaults.helper, Boolean(orca), id)
    const build = choicesToBuild(id, defaults, false)
    assert.equal(build.orca, Boolean(orca), `${id} ORCA follows the story`)
    assert.equal(build.hosts, "standard", id)
    assert.equal(build.routes.control?.kind ?? "off", "off", `${id} MCP stays off on the simple board`)
    const meddled = choicesToBuild(id, { ...defaults, library: "none", hosts: "dpu", mcp: true, helper: !orca }, false)
    assert.equal(meddled.data, build.data, `${id} storage is automatic`)
    assert.equal(meddled.orca, build.orca, `${id} ORCA is automatic`)
    assert.equal(meddled.hosts, "standard", `${id} hosts are automatic`)
  }
  assert.equal(choicesToBuild("drug", simpleDefaults("drug"), false).orca, true)
  assert.equal(choicesToBuild("rag", simpleDefaults("rag"), false).data, "vector")
  assert.equal(choicesToBuild("chat", simpleDefaults("chat"), false).data, "local")
  assert.deepEqual(["chat", "code", "robot"].map((id) => simpleDefaults(id).memory), [true, true, true])
  assert.deepEqual(["rag", "research", "drug"].map((id) => simpleDefaults(id).memory), [false, false, false])
  assert.equal(simpleToChoices("rag", { hall: "plus" }).memory, true, "the third hall tile adds KV memory for single-site stories")
  assert.equal(simpleToChoices("chat", { hall: "plus" }).cities, 2, "the third hall tile adds a second metro for multi-site stories")
  assert.equal(simpleToChoices("chat", { hall: "plus" }).memory, true, "chat keeps its memory default")
})

test("simple picks round-trip through nerd mode and back without changing the build", () => {
  for (const { id } of USE_CASES) {
    for (const combo of allSimple(id)) {
      const choices = simpleToChoices(id, combo)
      assert.deepEqual(simplePicks(id, choices), combo, `${id} ${JSON.stringify(combo)}`)
      const nerd = nerdChoices(id, choices)
      const simpleBuild = choicesToBuild(id, choices, false)
      const nerdBuild = choicesToBuild(id, nerd, true)
      assert.deepEqual(nerdBuild.routes, simpleBuild.routes, `${id} ${JSON.stringify(combo)} routes`)
      assert.equal(evaluateBuild(id, nerdBuild).score, evaluateBuild(id, simpleBuild).score, `${id} ${JSON.stringify(combo)} score`)
      assert.deepEqual(simpleChoices(id, nerd), choices, `${id} ${JSON.stringify(combo)} back to simple`)
    }
    const huge = simpleChoices(id, { ...expertChoices(id), brains: "huge", hosts: "dpu", mcp: true })
    assert.equal(huge.brains, "big", `${id} HUGE snaps to the big tile`)
    assert.equal(huge.hosts, "standard", id)
    assert.equal(huge.mcp, false, id)
  }
})

test("simple-space balance: naive scores nothing, the thoughtful build lands near 1,400 and is the only winner", () => {
  const expected = {
    chat: { best: ["big", "plus", "fast"], typical: [700, 950] },
    rag: { best: ["big", "plus", "fast"], typical: [400, 650] },
    code: { best: ["big", "plus", "fast"], typical: [350, 600] },
    research: { best: ["big", "plus", "fast"], typical: [300, 500] },
    drug: { best: ["big", "super", "fast"], typical: [450, 700] },
    robot: { best: ["big", "plus", "fast"], typical: [500, 800] },
  }
  for (const { id } of USE_CASES) {
    const scored = allSimple(id).map((combo) => ({ combo, score: simpleScore(id, combo).score }))
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a))
    const naiveAir = simpleScore(id, { brains: "rubin", hall: "cool", wires: "cheap" }).score
    const naiveLiquid = simpleScore(id, { brains: "rubin", hall: "super", wires: "cheap" }).score
    const typical = simpleScore(id, { brains: "medium", hall: "cool", wires: "peer" }).score
    assert.deepEqual([best.combo.brains, best.combo.hall, best.combo.wires], expected[id].best, `${id} best is ${JSON.stringify(best)}`)
    assert.ok(best.score >= 1355 && best.score <= 1410, `${id} best ${best.score}`)
    assert.ok(naiveAir <= 5, `${id} naive air ${naiveAir}`)
    if (id === "drug") assert.ok(naiveLiquid >= 500 && naiveLiquid <= 700, `drug internet is viable for batch lab data: ${naiveLiquid}`)
    else assert.ok(naiveLiquid <= 40, `${id} naive liquid ${naiveLiquid}`)
    const [lo, hi] = expected[id].typical
    assert.ok(typical >= lo && typical <= hi, `${id} typical ${typical} outside ${lo}-${hi}`)
    const near = scored.filter((item) => item.score >= best.score * 0.98)
    assert.ok(near.length >= 1 && near.length <= 2, `${id} has ${near.length} combos within 2% of the best`)
  }
})

test("the results headline ties the outcome to a data-center decision in plain words", () => {
  const banned = /\bms\b|tok\/s|TB\/s|\bkW\b|PUE|Gbps/
  for (const { id } of USE_CASES) {
    for (const combo of allSimple(id)) {
      const choices = simpleToChoices(id, combo)
      const result = evaluateBuild(id, choicesToBuild(id, choices, false))
      const change = bestChange(id, choices)
      const line = headline(result, choices, change)
      assert.match(line, /^[A-Z0-9].*\.$/, `${id} ${JSON.stringify(combo)}: ${line}`)
      assert.equal(line.split(/(?<=[.!?])\s+(?=[A-Z])/).length, 1, `${id} one sentence: ${line}`)
      assert.doesNotMatch(line, banned, `${id} ${line}`)
      assert.match(line, /cool|hall|metro|internet|peering|ServiceFabric|connection|link|power|budget|deadline|arrived/i, `${id} names a data-center decision: ${line}`)
      assert.match(change.text, /would (have )?score|best build/, `${id} ${change.text}`)
      assert.equal(explainResult(result, choices).headline, line)
    }
  }
  const chatBest = simpleToChoices("chat", { brains: "big", hall: "plus", wires: "fast" })
  const chat = evaluateBuild("chat", choicesToBuild("chat", chatBest, false))
  assert.match(headline(chat, chatBest, bestChange("chat", chatBest)), /^Your liquid-cooled hall in London and Frankfurt answered \d+% of shoppers in a blink over ServiceFabric: close, cool and connected\.$/)
  const hot = simpleToChoices("chat", { brains: "big", hall: "cool", wires: "fast" })
  assert.match(headline(evaluateBuild("chat", choicesToBuild("chat", hot, false)), hot), /overheated in the air-cooled hall in London: these racks need liquid cooling/)
  const slow = simpleToChoices("chat", { brains: "medium", hall: "cool", wires: "cheap" })
  assert.match(headline(evaluateBuild("chat", choicesToBuild("chat", slow, false)), slow), /^The public internet left \d+% of shoppers waiting/)
  const far = simpleToChoices("chat", { brains: "medium", hall: "cool", wires: "peer" })
  assert.match(headline(evaluateBuild("chat", choicesToBuild("chat", far, false)), far), /One metro in London kept \d+% of shoppers too far away/)
  const late = simpleToChoices("robot", { brains: "rubin", hall: "super", wires: "fast" })
  assert.match(headline(evaluateBuild("robot", choicesToBuild("robot", late, false)), late), /Vera Rubin NVL72 arrived in week \d+, \d+ weeks after the deadline/)
  const lab = simpleToChoices("drug", { brains: "big", hall: "super", wires: "fast" })
  assert.match(headline(evaluateBuild("drug", choicesToBuild("drug", lab, false)), lab), /screened 100% of the lab's candidates over ServiceFabric, with ORCA PT-3/)
  const stuck = simpleToChoices("robot", { brains: "rubin", hall: "plus", wires: "cheap" })
  assert.match(bestChange("robot", stuck).text, /^No single change rescues this\. HGX H200 ×2 in air-cooled halls in Frankfurt and Amsterdam on ServiceFabric would score about 1,[34]\d\d\.$/)
  assert.equal(DR_FOOTER, "Built in a Digital Realty data center: power, cooling and connections ready.")
})

test("the simple screens are wired: three featured stories plus MORE, simple rows, two gauges, headline and footer", () => {
  assert.match(main, /const FEATURED_STORIES = \["chat", "drug", "robot"\]/)
  assert.match(main, /key: "more-stories"/)
  assert.match(main, /if \(state\.nerd \|\| state\.moreStories\)/)
  assert.match(main, /function simpleRows\(choices\)/)
  assert.match(main, /choiceRow\("brains", "GPU"/)
  assert.match(main, /choiceRow\("home", "DATA HALL"/)
  assert.match(main, /choiceRow\("wires", "CONNECTION"/)
  assert.match(main, /function simpleFeel\(result\)/)
  const simpleFeel = main.slice(main.indexOf("function simpleFeel("), main.indexOf("function gauge("))
  assert.match(simpleFeel, /gauge\("MONEY"/)
  assert.match(simpleFeel, /gauge\("TIME"/)
  assert.doesNotMatch(simpleFeel, /gauge\("POWER"|gauge\("SPEED"|gauge\("CROWD"|gauge\("PRICE"|peopleBadge/)
  assert.match(main, /state\.nerd \? feel\(result\) : simpleFeel\(result\)/)
  assert.match(main, /"ORCA PT-3 included"/)
  assert.match(main, /"data-key": "headline", text: explained\.headline/)
  assert.match(main, /"data-key": "dr-footer"/)
  assert.match(main, /text: DR_FOOTER/)
  assert.match(main, /const choices = nerd \? defaultChoices\(useCaseId\) : simpleDefaults\(useCaseId\)/)
  assert.match(main, /state\.nerd \? nerdChoices\(state\.plan\.useCase, state\.plan\.choices\) : simpleChoices\(state\.plan\.useCase, state\.plan\.choices\)/)
  assert.match(main, /scenesFor\(state\.nerd\)/)
  assert.match(main, /matchingScene\(state\.intro\?\.position\(\) \?\? 0, state\.nerd\)/)
  assert.match(css, /\.screen\.game\.simple \.choice-row \{ grid-template-columns: 200px/)
  assert.match(css, /\.story-cards\.featured \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(css, /\.title-card \{/)
  assert.match(css, /\.dr-footer \{/)
})
