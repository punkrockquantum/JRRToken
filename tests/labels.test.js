/**
 * Accuracy sweep (user: "Ensure all the maths, numbers and info are very accurate").
 *
 * Two kinds of check:
 * - Published facts the game quotes stay the published values: ServiceFabric speeds and port
 *   SLA, fibre physics, the GPU datasheet figures, model bytes, the users → demand derivation,
 *   haversine distances, the published PUE.
 * - Every player-facing string that names a dollar figure says it is an estimate or a game
 *   value, because none of the prices are quotes.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  DATA_TIERS, DOES, GRAPH_SIZES, HALLS, JOBS, KV_TIER, LESSONS, MODELS, NETWORKS, ORCA, PLATFORMS, PRICE_NOTE, SCENARIOS, SITES, USERS, USER_TIER_IDS, USE_CASES, byId, usersTier,
} from "../js/data.js"
import { ecosystem } from "../js/eco.js"
import { detailLine, wireImpact } from "../js/impact.js"
import { evaluateBuild, groupSize, kmBetween, weightScale } from "../js/model.js"
import { DESTINATIONS, FABRIC_SPEEDS, INTERNET_MAX_GBPS, LEAD_DAYS, PORT_SPEEDS } from "../js/network.js"
import { FIBRE_S_PER_KM, ROUTE } from "../js/physics.js"
import { choicesToBuild, defaultChoices, expertChoices, wireIds } from "../js/presets.js"
import { designLines, designsFor } from "../js/refarch.js"
import { BUILD_STEP_IDS, stepTiles, usersDerivation } from "../js/steps.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const PRICE = /\$\s?\d/
const LABEL = /estimate|est\.|game/i

/** Every string inside a value, with a path for the failure message. */
function strings(value, path = "") {
  if (typeof value === "string") return [[path, value]]
  if (typeof value === "function") return []
  if (Array.isArray(value)) return value.flatMap((item, i) => strings(item, `${path}[${i}]`))
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => strings(item, path ? `${path}.${key}` : key))
  return []
}

function assertLabelled(list, where) {
  const unlabelled = list.filter(([, text]) => PRICE.test(text) && !LABEL.test(text))
  assert.deepEqual(unlabelled, [], `${where}: price strings without an estimate/game label`)
}

test("every player-facing price string in the data tables is labelled an estimate or a game value", () => {
  for (const [name, table] of Object.entries({ PLATFORMS, NETWORKS, DATA_TIERS, KV_TIER, ORCA, GRAPH_SIZES, HALLS, LESSONS, DOES, JOBS, MODELS, DESTINATIONS })) {
    assertLabelled(strings(table), name)
  }
  assertLabelled(USE_CASES.flatMap((uc) => strings({ blurb: uc.blurb, learn: uc.learn, netWhy: uc.netWhy }, uc.id)), "USE_CASES")
  assert.match(PRICE_NOTE, /estimates/)
})

test("every tile on every step, in both modes, labels its prices; so do the users derivations and the TOKEN IMPACT strip", () => {
  for (const useCase of USE_CASES) {
    for (const nerd of [false, true]) {
      const base = nerd ? expertChoices(useCase.id) : defaultChoices(useCase.id)
      for (const stepId of BUILD_STEP_IDS) {
        for (const tile of stepTiles(useCase.id, stepId, nerd, base)) {
          assertLabelled(strings({ label: tile.label, hint: tile.hint, tag: tile.tag, lines: tile.lines, nerd: tile.nerd, why: tile.why }), `${useCase.id} ${stepId} ${tile.id}`)
        }
      }
      for (const wires of wireIds(useCase.id, nerd)) {
        const impact = wireImpact(useCase.id, base, wires, nerd)
        assertLabelled([["why", impact.why], ["detail", detailLine(impact.detail)]], `${useCase.id} impact ${wires}`)
      }
    }
    for (const tier of USER_TIER_IDS) {
      const derived = usersDerivation(useCase.id, tier)
      assertLabelled(strings(derived), `${useCase.id} users ${tier}`)
    }
  }
})

test("reference designs and the ecosystem lights label their prices", () => {
  for (const platform of PLATFORMS) {
    for (const design of designsFor(platform.id)) {
      for (const hall of HALLS) assertLabelled(strings(designLines(design, platform.id, hall.id, 72)), `${platform.id} ${design.id} ${hall.id}`)
    }
  }
  for (const useCase of USE_CASES) {
    for (const nerd of [false, true]) {
      for (const choices of [defaultChoices(useCase.id), expertChoices(useCase.id), { ...expertChoices(useCase.id), library: "smart", hosts: "dpu", memory: true, brains: "huge" }]) {
        const result = evaluateBuild(useCase.id, choicesToBuild(useCase.id, choices, nerd))
        for (const part of ecosystem(result)) assertLabelled(strings({ why: part.why, detail: part.detail, ask: part.ask }), `${useCase.id} eco ${part.id}`)
      }
    }
  }
  const main = readFileSync(join(root, "js/main.js"), "utf8")
  assert.match(main, /text: "Game numbers are estimates\." \}\)/, "the build board carries the estimate note")
  assert.match(main, /"data-key": "result-price-note", text: " Game numbers are estimates\."/, "the results card carries it too")
})

test("published ServiceFabric facts: 10G/100G ports, 50 Mbps to 100 Gbps, 15-day port SLA, minutes to live, Digital Internet up to 10 Gbps", () => {
  // https://api.servicefabric.digitalrealty.com/user-guide/about/frequently-asked-questions.html (Oct 2026)
  assert.deepEqual(PORT_SPEEDS, [10, 100])
  assert.deepEqual(FABRIC_SPEEDS, [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 1, 2, 2.5, 5, 10, 100])
  assert.equal(LEAD_DAYS.fabricPort, 15)
  assert.equal(LEAD_DAYS.fabricVc, 0, "links and connections are live in minutes: no lead days")
  assert.equal(INTERNET_MAX_GBPS, 10)
  const fabric = byId(NETWORKS, "fabric")
  for (const fact of ["10G or 100G port", "50 Mbps to 100 Gbps", "15 days (published SLA)", "minutes"]) assert.ok(fabric.learn.includes(fact), fact)
  assert.match(fabric.learn, /\(estimate\)/, "the ServiceFabric prices are labelled")
  const cross = byId(NETWORKS, "cross")
  assert.match(cross.does, /same building/)
  assert.match(cross.learn, /\(game\)/, "the cross connect lead time is labelled")
  assert.match(byId(NETWORKS, "fiber").learn, /\(game: 12\)/)
  for (const id of ["public", "peer", "eye"]) assert.match(byId(NETWORKS, id).learn, /game/, `${id} assumptions are labelled`)
})

test("fibre physics: 4.9 µs per km of glass, 1.2× route inflation, and the public internet at least twice ServiceFabric at any distance", () => {
  assert.equal(FIBRE_S_PER_KM, 4.9e-6)
  assert.equal(ROUTE.fiber.inflation, 1.2)
  assert.equal(ROUTE.fabric.inflation, 1.2)
  assert.ok(ROUTE.public.inflation >= 2 * ROUTE.fabric.inflation)
  assert.ok(ROUTE.public.overheadS >= ROUTE.fabric.overheadS + 0.02)
  assert.ok(ROUTE.cross.overheadS <= 0.0001, "a cross connect is a few hundred metres of patch: microseconds")
  // Digital Realty's metro briefs quote fibre runs at about 10 µs of round trip per km (e.g. 45.9 km ↔ 0.461 ms).
  const rttPerKm = 2 * FIBRE_S_PER_KM
  assert.ok(Math.abs(rttPerKm * 45.9 * 1000 - 0.45) < 0.05, `45.9 km ≈ 0.45 ms round trip (${rttPerKm * 45.9 * 1000})`)
  assert.match(LESSONS.network, /5 microseconds per kilometre/)
})

test("haversine distances match the great circle: London–Frankfurt about 637 km, Ashburn–Silicon Valley about 3,900 km", () => {
  const site = (id) => byId(SITES, id)
  assert.ok(Math.abs(kmBetween(site("lon"), site("fra")) - 637) < 10, `${kmBetween(site("lon"), site("fra"))}`)
  assert.ok(Math.abs(kmBetween(site("iad"), site("sjc")) - 3900) < 60, `${kmBetween(site("iad"), site("sjc"))}`)
  assert.ok(Math.abs(kmBetween(site("lon"), site("par")) - 344) < 10, `${kmBetween(site("lon"), site("par"))}`)
  assert.equal(kmBetween(site("lon"), site("lon")), 0)
})

test("GPU platforms carry the public datasheet figures and the game's own numbers are labelled", () => {
  // Public per-GPU memory and bandwidth (nvidia.com datasheets, see the comments in js/data.js).
  const spec = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]))
  assert.deepEqual([spec.l40s.hbmGB, spec.l40s.hbmTBs], [48, 0.864])
  assert.deepEqual([spec.rtx6000.hbmGB, spec.rtx6000.hbmTBs], [96, 1.6])
  assert.deepEqual([spec.h100.hbmGB, spec.h100.hbmTBs], [80, 3.35])
  assert.deepEqual([spec.h200.hbmGB, spec.h200.hbmTBs], [141, 4.8])
  assert.deepEqual([spec.b200.hbmGB, spec.b200.hbmTBs], [180, 8])
  assert.deepEqual([spec.b300.hbmGB, spec.b300.hbmTBs], [288, 8])
  assert.deepEqual([spec.gb200.hbmGB, spec.gb200.hbmTBs, spec.gb200.gpusPerRack], [186, 8, 72])
  assert.deepEqual([spec.gb300.hbmGB, spec.gb300.gpusPerRack], [288, 72])
  assert.deepEqual([spec.vr.hbmGB, spec.vr.hbmTBs, spec.vr.gpusPerRack], [288, 20, 72])
  // Dense tensor PFLOPS at the stated precision (sparse figures halved).
  assert.equal(spec.h100.pflops, 2)
  assert.equal(spec.b200.pflops, 9)
  assert.equal(spec.gb200.pflops, 10)
  assert.ok(spec.gb300.pflops >= 14 && spec.gb300.pflops <= 15)
  for (const p of PLATFORMS) {
    assert.ok(["FP8", "FP4"].includes(p.precision), p.id)
    assert.ok(p.hbmGB > 0 && p.hbmTBs > 0 && p.pflops > 0 && p.rackKW > 0 && p.capex > 0 && p.leadWeeks > 0, p.id)
    if (p.domain >= 72) assert.equal(p.cooling, "liquid", `${p.id}: NVL72 racks are direct-liquid only`)
    if (p.gpusPerRack === 72) assert.ok(p.rackKW >= 120, `${p.id}: an NVL72 rack is 120 kW or more`)
  }
  // Cheapest first: the budget guard and the GPU tiles rely on the order.
  const simpleOrder = ["l40s", "rtx6000", "h100", "h200", "b200", "b300"].map((id) => spec[id].capex)
  assert.deepEqual([...simpleOrder].sort((a, b) => a - b), simpleOrder)
  const data = readFileSync(join(root, "js/data.js"), "utf8")
  assert.match(data, /Prices, lead times, supply caps and tokens per GPU are\s*\* game estimates/, "the platform table says which numbers are the game's")
})

test("model sizes: public-class bytes at FP8, halved at FP4, and the 650B mixture of experts wants a 72-GPU NVLink domain", () => {
  const m = Object.fromEntries(MODELS.map((model) => [model.id, model]))
  assert.deepEqual([m["70b"].weightsGB, m["70b"].fp16GB, m["70b"].moe], [70, 140, false])
  assert.deepEqual([m["100b"].weightsGB, m["100b"].fp16GB, m["100b"].moe], [100, 200, false])
  assert.deepEqual([m["650b"].weightsGB, m["650b"].fp16GB, m["650b"].moe, m["650b"].activeB, m["650b"].params], [671, 1342, true, 37, 671])
  const fp4 = byId(PLATFORMS, "b300")
  const fp8 = byId(PLATFORMS, "h200")
  assert.equal(weightScale(fp4), 0.5)
  assert.equal(weightScale(fp8), 1)
  assert.equal(m["70b"].weightsGB * weightScale(fp4), 35, "70B at FP4 is about 35 GB")
  assert.equal(m["100b"].weightsGB * weightScale(fp4), 50)
  const big = { ...byId(USE_CASES, "research"), weightsGB: 671, moe: true }
  assert.ok(groupSize(big, byId(PLATFORMS, "h100")) > 8, "671 GB at FP8 spills past eight H100s (640 GB)")
  assert.equal(groupSize(big, fp8), 8, "eight H200s (1,128 GB) hold it, tightly")
  assert.equal(groupSize(big, byId(PLATFORMS, "gb200")), 72, "an NVL72 rack holds the mixture of experts whole")
  for (const model of MODELS) assert.ok(model.kvMBPerTok > 0 && model.quality >= 1)
})

test("users → demand follows the labelled derivation exactly, and the top tier is each story's calibrated demand", () => {
  for (const useCase of USE_CASES) {
    const spec = USERS[useCase.id]
    for (const tierId of USER_TIER_IDS) {
      const tier = usersTier(useCase.id, tierId)
      const count = Math.round(spec.top * { small: 0.01, medium: 0.1, large: 1 }[tierId])
      assert.equal(tier.count, count)
      let demand
      if (spec.kind === "batch") demand = (count * spec.perNight * spec.tokens) / 86400
      else if (spec.kind === "fleet") demand = count * spec.duty * useCase.tps
      else demand = ((count * spec.daily * spec.sessions * spec.minutes * spec.peak) / 1440) * (spec.streams || 1) * useCase.tps
      assert.equal(tier.demand, Math.round(demand), `${useCase.id} ${tierId}`)
      assert.ok(Math.abs(tier.scale - Math.pow(tier.mult, 0.7)) < 0.001)
    }
    assert.equal(usersTier(useCase.id, "large").demand, useCase.demand, `${useCase.id}: the top tile carries today's calibrated demand`)
  }
  assert.equal(usersTier("chat", "large").demand, 551250)
  assert.equal(usersTier("chat", "small").demand, 5513)
  assert.equal(usersTier("drug", "large").demand, 231481)
  assert.equal(usersTier("robot", "large").demand, 120000)
})

test("PUE: the air hall carries the published 1.38 portfolio figure; the other halls say theirs are game values", () => {
  const air = byId(HALLS, "A")
  assert.equal(air.pue, 1.38)
  assert.match(air.learn, /published portfolio figure/)
  for (const hall of HALLS.filter((h) => h.id !== "A")) assert.match(hall.learn, /game assumption/, hall.id)
  assert.match(LESSONS.pue, /1\.38 is a published portfolio figure/)
  for (const [id, scenario] of Object.entries(SCENARIOS)) assert.ok(scenario.budget > 0 && scenario.powerMW > 0 && scenario.deadlineWeeks > 0 && scenario.pricePerM > 0, id)
})
