import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { DATA_HOMES, HALLS, METRO_OFFERS, PLATFORMS, SCENARIOS, SITES, USER_BASES, USE_CASES, byId } from "../js/data.js"
import { DR_FACTS, DR_HELP_TITLE, drHelp } from "../js/drhelp.js"
import { fibreRttS } from "../js/latency.js"
import { evaluateBuild, kmBetween, siteReach } from "../js/model.js"
import { allPresets, choicesToBuild, expertChoices, simpleChoices } from "../js/presets.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

/** A poor picture per story: the wrong metro, liquid racks on air (or air racks in the liquid hall), a shared wire. */
const WEAK = {
  chat: { metros: ["par"], brains: "big", home: "cool", wires: "cheap", memory: false, library: "none" },
  rag: { metros: ["par"], brains: "big", home: "cool", wires: "cheap", memory: false, library: "none" },
  code: { metros: ["dfw"], brains: "big", home: "cool", wires: "cheap", memory: false, library: "none" },
  research: { metros: ["fra"], brains: "medium", home: "super", wires: "peer", memory: false, library: "none" },
  drug: { metros: ["par"], brains: "big", home: "cool", wires: "cheap", memory: false, library: "none", helper: false },
  robot: { metros: ["lon"], brains: "rubin", home: "cool", wires: "cheap", memory: false, library: "none" },
}

const scored = (id, choices, nerd) => evaluateBuild(id, choicesToBuild(id, choices, nerd))
const helped = (id, choices, nerd) => drHelp(scored(id, choices, nerd), choices, { nerd })
const joined = (help) => help.lines.map((line) => line.show).join(" ")

/** Names that carry digits but are not numbers: GPU platforms and the quantum accelerator. */
const NAMED = new RegExp([...PLATFORMS.map((platform) => platform.name), "PT-3", "LHR19"].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g")
const NUMBERS = /\d+(?:,\d{3})*(?:\.\d+)?/g

/**
 * Every number a line may quote, built from the sources: great-circle km and lit-fibre round trips
 * between the story's places and the metros, user shares, hall caps and fit-outs, metro power and
 * liquid weeks, rack power and lead weeks, the scenario, the data home's own figures, the scored
 * build's own outputs, and the two published counts.
 */
function allowedNumbers(id, result) {
  const set = new Set(["1", "300", "50"]) // "under 1 ms"; 300+ data centers; 50+ metros (published)
  const add = (value) => {
    if (!Number.isFinite(value)) return
    set.add(String(Math.round(value)))
    set.add(Math.round(value).toLocaleString("en-GB"))
    set.add(value.toFixed(1))
    set.add(value.toFixed(2))
    set.add(String(+value.toFixed(2)))
  }
  const addKm = (km) => {
    add(km)
    add(fibreRttS(km) * 1000)
  }
  const useCase = byId(USE_CASES, id)
  const places = USER_BASES[id].places
  const home = DATA_HOMES[id]
  const spots = [...places, home, ...SITES]
  for (const a of spots) for (const b of spots) addKm(kmBetween(a, b))
  for (const place of places) add(place.share * 100)
  for (const metros of [result.sites.map((site) => site.id), expertChoices(id).metros]) {
    const reach = siteReach(id, metros)
    for (const km of [reach.avgKm, reach.dataNearKm, ...reach.perSite.map((entry) => entry.km)]) addKm(km)
    for (const entry of reach.perSite) add(entry.share * 100)
  }
  for (const hall of HALLS) {
    for (const value of [hall.maxRackKW, hall.fitOutWeeks, hall.rackSpace, hall.pue]) add(value)
    for (const offer of METRO_OFFERS[id]) add(hall.fitOutWeeks + (offer.liquidWeeks || 0))
  }
  for (const platform of PLATFORMS) for (const value of [platform.rackKW, platform.leadWeeks]) add(value)
  for (const offer of METRO_OFFERS[id]) for (const value of [offer.liquidWeeks, offer.powerMult * 100]) add(value)
  add(100)
  for (const value of [SCENARIOS[id].deadlineWeeks, SCENARIOS[id].powerMW, useCase.ttft, home.corpusTB]) add(value)
  for (const token of home.what.match(NUMBERS) || []) set.add(token)
  for (const value of [result.racks, result.liveWeeks, Math.ceil(result.liveWeeks), Math.ceil(result.lateWeeks), result.coverage * 100, result.ttft, result.itKW, result.facilityKW, result.siteKW, result.powerCapKW, result.powerMW, result.pue, result.spaceUsed]) add(value)
  addKm(result.dataNearKm)
  for (const part of result.leadParts || []) add(part.weeks)
  for (const leg of result.legResults || []) {
    add(leg.rttS * 1000)
    add(leg.trips)
  }
  if (result.transfer) for (const value of [result.transfer.gb, result.transfer.hours, result.transfer.hours / 24]) add(value)
  return set
}

function assertSourced(id, result, help, label) {
  const allowed = allowedNumbers(id, result)
  for (const line of help.lines) {
    const found = line.show.replace(NAMED, "").match(NUMBERS) || []
    for (const token of found) assert.ok(allowed.has(token), `${label} [${line.id}] quotes ${token}, which no source gives: ${line.show}`)
  }
}

function assertShape(id, help, result, label) {
  assert.equal(help.title, DR_HELP_TITLE)
  assert.ok(help.lines.length >= 4 && help.lines.length <= 6, `${label}: ${help.lines.length} lines`)
  assert.equal(help.lines[help.lines.length - 1].text, DR_FACTS, `${label} closes on the published facts`)
  assert.deepEqual(help.lines.slice(0, 4).map((line) => line.id), ["place", "capacity", "wires", "time"], label)
  const text = joined(help)
  for (const site of result.sites) assert.ok(text.includes(site.metro), `${label} names the chosen metro ${site.metro}`)
  for (const place of USER_BASES[id].places) assert.ok(text.includes(place.city), `${label} names the users' home ${place.city}`)
  assert.ok(text.includes(DATA_HOMES[id].city), `${label} names the data home ${DATA_HOMES[id].city}`)
  for (const line of help.lines) {
    assert.match(line.show, /[.!?]$/, `${label} [${line.id}] ends as a sentence`)
    assert.ok(line.show.length <= 620, `${label} [${line.id}] fits a results bullet: ${line.show.length} chars`)
  }
}

test("every story × weak and best build, both modes: four to six lines naming the metro, the users' and the data's homes, with every number sourced", () => {
  for (const { id } of USE_CASES) {
    for (const nerd of [false, true]) {
      for (const [kind, choices] of [["weak", WEAK[id]], ["best", expertChoices(id)]]) {
        const label = `${id} ${kind} ${nerd ? "nerd" : "simple"}`
        const result = scored(id, choices, nerd)
        const help = drHelp(result, choices, { nerd })
        assertShape(id, help, result, label)
        assertSourced(id, result, help, label)
        const advice = help.lines.filter((line) => /Digital Realty would have advised/.test(line.text)).length
        if (kind === "weak") assert.ok(advice >= 2, `${label}: a poor build gets advice on at least two lines (${advice})`)
        else assert.equal(advice, 0, `${label}: the best build needs no advice`)
      }
    }
  }
})

test("the weak builds are weak and the best builds are best, so the lines have something to say", () => {
  for (const { id } of USE_CASES) {
    assert.ok(scored(id, WEAK[id], false).score < 400, `${id} weak simple`)
    assert.ok(scored(id, expertChoices(id), true).score >= 1350, `${id} best nerd`)
  }
})

test("the place line quotes the real distances: 60% London shoppers from a Paris hall, Ashburn weights an ocean away", () => {
  const paris = helped("chat", WEAK.chat, false).lines[0].text
  assert.match(paris, /^Your shoppers are 54% London, 36% Frankfurt, and your support team in Leeds sends the other 10%: a Paris hall puts them about 419 km \/ 5 ms away; your 70 GB of weights and 2 TB of fine-tuning data copy once from a public cloud region in Northern Virginia \(Ashburn\), 6,186 km away\. Digital Realty would have advised London and Frankfurt: about 27 km \/ under 1 ms from the shoppers\.$/)
  const rag = helped("rag", WEAK.rag, false).lines[0].text
  assert.match(rag, /a Paris hall puts them about 343 km \/ 4 ms away; your 70 GB of weights and 30 TB of documents in the company's cloud tenancy in Frankfurt, 478 km away, stay reachable over ServiceFabric at 6 ms a retrieval\./)
  assert.match(rag, /Digital Realty would have advised Frankfurt: in the same metro as the data\.$/)
  const best = helped("rag", expertChoices("rag"), false).lines[0].text
  assert.match(best, /a Frankfurt hall puts them about 638 km \/ 8 ms away; .* sit in the company's cloud tenancy in Frankfurt, the same metro, so the data path never leaves the building\.$/)
  const code = helped("code", expertChoices("code"), false).lines[0].text
  assert.match(code, /^Your developers are 40% New York, 25% Toronto, 25% San Francisco, 10% Seattle: halls in Ashburn and Silicon Valley put them about 405 km \/ 5 ms away/)
})

test("the capacity line says what the hall did to the racks: liquid racks on air overheat, air racks waited on a liquid fit-out, a fit is a fit", () => {
  const hot = helped("chat", WEAK.chat, false).lines[1].text
  assert.match(hot, /^Your 2× GB200 NVL72 racks draw 132 kW each and the air hall in Paris cools 40 kW a rack, so they overheated\. Digital Realty would have advised the direct-to-chip liquid hall: up to 240 kW a rack, 10 weeks to fit out in Paris\.$/)
  const oneRack = helped("robot", WEAK.robot, false).lines[1].text
  assert.match(oneRack, /^Your 1× Vera Rubin NVL72 rack draws 210 kW and the air hall in London cools 40 kW a rack, so it overheated\./)
  const waited = helped("research", WEAK.research, false).lines[1].text
  assert.match(waited, /^Your 6× HGX B300 racks are air-cooled at 30 kW each: the air hall at 40 kW a rack was ready now in Frankfurt, instead of the liquid hall's fit-out of 10 weeks\.$/)
  const fit = helped("rag", expertChoices("rag"), false).lines[1].text
  assert.match(fit, /^Your 6× HGX B300 racks at 30 kW each fit the rear-door hall in Frankfurt at 70 kW a rack, fitted out in 6 weeks\.$/)
  const tight = helped("rag", { ...expertChoices("rag"), metros: ["lon"], brains: "big", home: "super" }, true).lines[1].text
  assert.match(tight, /drew [\d,]+ kW against the [\d,]+ kW power room in London\. Digital Realty would have advised Frankfurt, where 100% of the scenario's power was on offer against 80% in London, or fewer racks\.$/)
  const nerd = helped("rag", expertChoices("rag"), true).lines[1].show
  assert.match(nerd, /IT \d+ kW × PUE 1\.28 = \d+ kW facility against 0\.27 MW; [\d.]+ of 18 rack positions\.$/)
})

test("the wires line names the products: the public internet gets advice, ServiceFabric is private, the COMBO lists one product a leg", () => {
  const cheap = helped("chat", WEAK.chat, false).lines[2].text
  assert.match(cheap, /^The public internet carried your shoppers to Paris with jitter and no SLA\. First word in \d\.\d\d s against a 0\.6 s target\. Digital Realty would have advised ServiceFabric to the Ashburn cloud region for the one-time copy and cross connects to the eyeball networks the shoppers arrive on: no leg on the public internet\.$/)
  const peer = helped("research", WEAK.research, false).lines[2].text
  assert.match(peer, /^Peering at an exchange shortened the analysts' hop to Frankfurt, but the retrievals still rode a shared path\. .*ServiceFabric to the Paris cloud region for the retrieval trips and cross connects to the eyeball networks the analysts arrive on: no leg on the public internet\.$/)
  const robot = helped("robot", WEAK.robot, false).lines[2].text
  assert.match(robot, /a cross connect to each plant's carrier where it lands in the London building, and ServiceFabric between the sites: no leg on the public internet\.$/)
  const combo = helped("rag", expertChoices("rag"), false).lines[2].text
  assert.match(combo, /^Your COMBO used one product a leg: Staff → ServiceFabric; Documents → Cross connect to the cloud on-ramp; Control → MCP agent-configured\. No public internet on the path\. First word in \d\.\d\d s against a 1\.5 s target\.$/)
  const fabric = helped("chat", expertChoices("chat"), false).lines[2].text
  assert.match(fabric, /^ServiceFabric carried the shoppers privately into London and Frankfurt: no public internet on the path\. First word in \d\.\d\d s against a 0\.6 s target\.$/)
  const mixing = helped("rag", { ...expertChoices("rag"), wires: "fast" }, false).lines[2].text
  assert.match(mixing, /Mixing paid here, one product a leg: Staff → ServiceFabric; Documents → Cross connect to the cloud on-ramp; Control → MCP agent-configured\.$/)
  const lab = helped("drug", expertChoices("drug"), true).lines[2].text
  assert.match(lab, /^Dark fiber carried the lab's bulk data into London and a cross connect joined your GPUs to ORCA in the hall: \d+% of the candidates screened, nothing on the public internet\.$/)
  const labPublic = helped("drug", WEAK.drug, false).lines[2].text
  assert.match(labPublic, /^The public internet carried the lab's bulk data to Paris with no SLA to miss, but its bandwidth screened only \d+% of the candidates\. Digital Realty would have advised a private link for the lab's bulk data and a cross connect to ORCA in the hall: no leg on the public internet\.$/)
  const nerd = helped("robot", expertChoices("robot"), true).lines[2].show
  assert.match(nerd, /FACTORY → SITE: Cross connect \d+ ms × 2; INTER-SITE: ServiceFabric \d+ ms × 0\.4\.$/)
})

test("the time line reads the lead parts: the slowest part, pre-built halls, the one-time copy, and the metro with liquid capacity ready", () => {
  const onTime = helped("rag", expertChoices("rag"), false).lines[3].text
  assert.match(onTime, /^Live in week 12 against a week 20 deadline\. The slowest part was HGX B300 at 12 weeks\. The rear-door hall in Frankfurt was powered and cooled before the racks shipped, so nothing waited on the building\.$/)
  const late = helped("robot", WEAK.robot, false).lines[3].text
  assert.match(late, /^Live in week 30, 14 weeks after the week 16 deadline\. The slowest part was Vera Rubin NVL72 at 30 weeks\. .* The one-time copy of 12,008 GB from Frankfurt took about 27 hours once the link was lit\.$/)
  const days = helped("drug", WEAK.drug, false).lines[3].text
  assert.match(days, /The one-time copy of 250,015 GB from Dublin took about 23 days once the link was lit\.$/)
  /* A London liquid hall for RAG waits four extra weeks; Frankfurt had liquid capacity ready. */
  const fitOut = helped("rag", { ...expertChoices("rag"), metros: ["lon"], brains: "small", home: "super" }, true)
  assert.match(fitOut.lines[3].text, /The slowest part was Liquid hall fit-out at 14 weeks\. Digital Realty would have advised Frankfurt, where liquid capacity was ready 4 weeks sooner\./)
  assert.match(fitOut.lines[1].text, /^Your 2× HGX H200 racks are air-cooled at 23 kW each: the air hall at 40 kW a rack was ready now in London, instead of the liquid hall's fit-out of 14 weeks\.$/)
  assert.match(fitOut.lines[3].show, /Lead parts: HGX H200 8 weeks, Liquid hall fit-out 14 weeks, /)
  const liquidFit = helped("rag", { ...expertChoices("rag"), metros: ["lon"], brains: "big", home: "super" }, true).lines[1].text
  assert.match(liquidFit, /^Your 2× GB200 NVL72 racks drew [\d,]+ kW against the [\d,]+ kW power room in London\./)
  const readyElsewhere = helped("robot", { ...expertChoices("robot"), metros: ["ams"], brains: "rubin", home: "super" }, true).lines[1].text
  assert.equal(readyElsewhere, "Your 1× Vera Rubin NVL72 rack at 210 kW fits the liquid hall in Amsterdam at 240 kW a rack, fitted out in 12 weeks. Frankfurt had liquid capacity ready 2 weeks sooner.")
})

test("the story line: ORCA's London home, the second metro a one-metro build missed, data gravity for the heavy libraries", () => {
  assert.equal(helped("drug", expertChoices("drug"), false).lines[4].text, "ORCA PT-3 is installed at Digital Realty's London Innovation Lab, so the quantum helper sat in the same hall as your GPUs, a cross connect away.")
  assert.match(helped("drug", WEAK.drug, false).lines[4].text, /^ORCA PT-3 is installed at Digital Realty's London Innovation Lab: from Paris the quantum helper was a remote link, 343 km \/ 4 ms away\. London would have kept it in the hall\.$/)
  assert.match(helped("robot", WEAK.robot, false).lines[4].text, /^A second hall in Frankfurt would have put the 64% of robots in Stuttgart 152 km \/ 2 ms away instead of 729 km \/ 9 ms\.$/)
  assert.match(helped("chat", { ...expertChoices("chat"), metros: ["lon"] }, false).lines[4].text, /^A second hall in Frankfurt would have put the 36% of shoppers in Frankfurt in their own city instead of 638 km \/ 8 ms\.$/)
  assert.match(helped("rag", expertChoices("rag"), false).lines[4].text, /^Data gravity: the 30 TB of documents stay in Frankfurt, and your Frankfurt hall reaches them over an in-building cross connect to the cloud on-ramp\.$/)
  assert.match(helped("research", WEAK.research, false).lines[4].text, /^Data gravity: 400 TB of papers live in Paris; from Frankfurt every retrieval crossed 478 km \/ 6 ms\. A Paris hall would have reached them over an in-building cross connect\.$/)
  for (const id of ["chat", "code", "robot"]) assert.equal(helped(id, expertChoices(id), false).lines.length, 5, `${id} on both metros has no story line`)
  for (const id of ["rag", "research", "drug"]) assert.equal(helped(id, expertChoices(id), false).lines.length, 6, `${id} carries a story line`)
})

test("nerd mode adds the numbers to the same lines; the simple board reads the snapped choices", () => {
  for (const { id } of USE_CASES) {
    const simple = helped(id, expertChoices(id), false)
    const nerd = helped(id, expertChoices(id), true)
    assert.deepEqual(simple.lines.map((line) => line.id), nerd.lines.map((line) => line.id), id)
    for (const line of nerd.lines.slice(0, 4)) {
      assert.ok(line.detail.length > 0, `${id} [${line.id}] nerd detail`)
      assert.ok(line.show.endsWith(line.detail), `${id} [${line.id}] nerd shows the detail`)
    }
    for (const line of simple.lines) assert.equal(line.show, line.text, `${id} [${line.id}] simple hides the detail`)
  }
  /* The simple board snaps the drug expert's private links onto ServiceFabric: the line follows the build. */
  const snapped = simpleChoices("drug", expertChoices("drug"))
  assert.equal(snapped.wires, "fast")
  assert.match(helped("drug", expertChoices("drug"), false).lines[2].text, /^ServiceFabric carried the lab's bulk data privately into London/)
})

test("the closing line quotes only published facts and a broken build still gets it", () => {
  assert.match(DR_FACTS, /300\+ data centers in 50\+ metros on PlatformDIGITAL/)
  assert.match(DR_FACTS, /ServiceFabric joins them privately/)
  assert.match(DR_FACTS, /ServiceFabric MCP lets an AI agent configure it\.$/)
  const broken = drHelp({ ok: false, useCase: byId(USE_CASES, "chat") }, {}, { nerd: true })
  assert.deepEqual(broken.lines.map((line) => line.show), [DR_FACTS])
  assert.deepEqual(drHelp(null).lines.map((line) => line.id), ["facts"])
})

test("every nerd picture of every story keeps four to six sourced lines", () => {
  let count = 0
  for (const { id } of USE_CASES) {
    for (const choices of allPresets(id)) {
      const result = scored(id, choices, true)
      const help = drHelp(result, choices, { nerd: true })
      assertShape(id, help, result, `${id} ${JSON.stringify(choices)}`)
      assertSourced(id, result, help, `${id} ${JSON.stringify(choices)}`)
      count += 1
    }
  }
  assert.ok(count > 1000, `walked ${count} pictures`)
})

test("the results dialog shows the section in both modes under the explanation", () => {
  const main = readFileSync(join(root, "js/main.js"), "utf8")
  assert.match(main, /const helped = drHelp\(result, state\.plan\.choices, \{ nerd: state\.nerd \}\)/)
  assert.match(main, /el\("section", \{ class: "explain dr-help", "data-key": "dr-help", "aria-label": helped\.title \}/)
  assert.match(main, /helped\.lines\.map\(\(line\) => el\("li", \{ "data-line": line\.id, text: line\.show \}\)\)/)
  const css = readFileSync(join(root, "css/game.css"), "utf8")
  assert.match(css, /\.explain\.dr-help \{ border-color: var\(--cyan\); \}/)
})
