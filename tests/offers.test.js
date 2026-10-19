/**
 * Per-metro power offers (user: "There should be different power amounts and costs available
 * at every location."): every metro sells its own ladder of power blocks at its own prices, the
 * LOCATION tiles say so, and every story has a metro whose smallest block covers the smallest
 * legal build (the power floor rule).
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { HALLS, METRO_OFFERS, METRO_POWER, PLATFORMS, POWER_BASE_MWH, POWER_FLOOR_MW, SITES, USE_CASES, metroPower } from "../js/data.js"
import { evaluateBuild } from "../js/model.js"
import { blocksWords, metroPowerFact, stepTiles } from "../js/steps.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const metroIds = SITES.map((site) => site.id)

test("every metro on the map sells power: an ascending ladder of blocks, an energy price and a reservation price", () => {
  assert.deepEqual(Object.keys(METRO_POWER).sort(), [...metroIds].sort())
  for (const [id, offer] of Object.entries(METRO_POWER)) {
    assert.ok(offer.blocksMW.length >= 2 && offer.blocksMW.length <= 4, `${id}: two to four blocks`)
    assert.deepEqual(offer.blocksMW, [...offer.blocksMW].sort((a, b) => a - b), `${id}: ascending`)
    assert.ok(offer.blocksMW.every((mw) => mw > 0 && mw <= 5), `${id}: colocation-scale blocks`)
    assert.ok(offer.power.mwh >= 50 && offer.power.mwh <= 250, `${id}: $${offer.power.mwh}/MWh is a plausible bulk tariff`)
    assert.ok(offer.power.kwMonth >= 30 && offer.power.kwMonth <= 80, `${id}: $${offer.power.kwMonth}/kW-month reservation`)
    assert.deepEqual(metroPower(id), offer)
  }
  assert.equal(POWER_BASE_MWH, 100)
})

test("no two metros are alike: the ladders or the prices differ pairwise, and every energy price is its own", () => {
  const prices = new Set()
  for (let i = 0; i < metroIds.length; i += 1) {
    const a = METRO_POWER[metroIds[i]]
    prices.add(a.power.mwh)
    for (let j = i + 1; j < metroIds.length; j += 1) {
      const b = METRO_POWER[metroIds[j]]
      const same = JSON.stringify(a.blocksMW) === JSON.stringify(b.blocksMW) && a.power.mwh === b.power.mwh && a.power.kwMonth === b.power.kwMonth
      assert.ok(!same, `${metroIds[i]} and ${metroIds[j]} offer identical power`)
    }
  }
  assert.equal(prices.size, metroIds.length, "every metro has its own $/MWh")
})

test("the ladders follow the regional tariffs: London dear and small, Amsterdam cheaper, Paris cheap nuclear power, Dallas cheapest, Silicon Valley dearest", () => {
  const mwh = (id) => METRO_POWER[id].power.mwh
  assert.deepEqual(METRO_POWER.lon.blocksMW, [0.25, 0.5, 1])
  assert.deepEqual(METRO_POWER.ams.blocksMW, [0.5, 1, 2])
  assert.deepEqual(METRO_POWER.fra.blocksMW, [0.25, 0.5, 1, 2])
  assert.deepEqual(METRO_POWER.par.blocksMW, [0.5, 1, 2, 3])
  assert.deepEqual(METRO_POWER.iad.blocksMW, [1, 2, 3])
  assert.deepEqual(METRO_POWER.dfw.blocksMW, [1, 2, 3, 5])
  assert.deepEqual(METRO_POWER.chi.blocksMW, [0.5, 1, 2])
  assert.deepEqual(METRO_POWER.sjc.blocksMW, [0.25, 0.5])
  assert.ok(mwh("ams") < mwh("lon"), "Amsterdam power is cheaper than London's")
  assert.ok(mwh("par") < mwh("ams") && mwh("par") < mwh("fra"), "Paris is the cheap European power")
  assert.ok(mwh("fra") < mwh("lon") && mwh("fra") > mwh("ams"), "Frankfurt sits between Amsterdam and London")
  assert.ok(mwh("dfw") < mwh("iad") && mwh("dfw") < mwh("chi"), "Dallas is the cheapest US metro")
  assert.ok(mwh("iad") < mwh("chi"), "Ashburn is a little under Chicago")
  assert.equal(Math.max(...metroIds.map(mwh)), mwh("sjc"), "Silicon Valley is the dearest")
  /* The source comment names the tariff tables the estimates are shaped by. */
  const data = readFileSync(join(root, "js/data.js"), "utf8")
  assert.match(data, /nrg_pc_205/)
  assert.match(data, /eia\.gov\/electricity\/monthly/)
  assert.match(data, /export const METRO_POWER = \{/)
})

test("every story's metro offers carry that metro's ladder and prices beside the old share and price multipliers", () => {
  for (const { id } of USE_CASES) {
    for (const offer of METRO_OFFERS[id]) {
      assert.deepEqual(offer.blocksMW, METRO_POWER[offer.id].blocksMW, `${id} ${offer.id}`)
      assert.deepEqual(offer.power, METRO_POWER[offer.id].power, `${id} ${offer.id}`)
      assert.equal(typeof offer.powerMult, "number")
      assert.equal(typeof offer.priceMult, "number")
    }
  }
  /* Each story's offers are their own copies: changing one never leaks into another story's. */
  METRO_OFFERS.chat[0].blocksMW.push(99)
  assert.ok(!METRO_OFFERS.rag.find((offer) => offer.id === METRO_OFFERS.chat[0].id)?.blocksMW.includes(99))
  METRO_OFFERS.chat[0].blocksMW.pop()
})

test("power floor rule: in every story at least one metro's smallest block covers the smallest legal build", () => {
  const smallestRackKW = Math.min(...PLATFORMS.map((platform) => platform.rackKW))
  const airPue = Math.max(...HALLS.filter((hall) => hall.cooling === "air").map((hall) => hall.pue))
  for (const useCase of USE_CASES) {
    const offers = METRO_OFFERS[useCase.id]
    const covering = offers.filter((offer) => Math.min(...offer.blocksMW) >= POWER_FLOOR_MW - 1e-9)
    assert.ok(covering.length >= 1, `${useCase.id}: a metro whose smallest block (${offers.map((offer) => `${offer.id} ${Math.min(...offer.blocksMW)} MW`).join(", ")}) covers the ${POWER_FLOOR_MW} MW floor`)
    /* And the smallest legal build itself: one rack of the least powerful platform through the air hall's PUE. */
    const smallest = evaluateBuild(useCase.id, { hall: "A", platform: PLATFORMS.reduce((a, b) => (b.rackKW < a.rackKW ? b : a)).id, racks: 1, data: "local", kv: false, orca: false, graphs: "large", network: "fabric", fabric: { port: 10, vc: 1, dest: "internet", layer: "l2", redundant: true } })
    assert.ok(smallest.ok, `${useCase.id}: the smallest build evaluates`)
    assert.ok(smallest.powerUsedMW <= Math.min(...covering.map((offer) => Math.min(...offer.blocksMW))) + 1e-9, `${useCase.id}: ${smallest.powerUsedMW} MW fits the smallest covering block`)
    assert.ok(smallestRackKW * airPue <= POWER_FLOOR_MW * 1000, "the floor is the smallest rack through the air PUE")
  }
})

test("LOCATION tiles say 'Power: up to X MW · $Y/MWh' and the learn lines read the ladder in words", () => {
  assert.equal(metroPowerFact(METRO_OFFERS.chat.find((offer) => offer.id === "lon")), "Power: up to 1 MW · $165/MWh (est.)")
  assert.equal(metroPowerFact(METRO_OFFERS.robot.find((offer) => offer.id === "ams")), "Power: up to 2 MW · $115/MWh (est.)")
  assert.equal(blocksWords([0.25, 0.5, 1]), "0.25 MW, 0.5 MW or 1 MW")
  assert.equal(blocksWords([0.5]), "0.5 MW")
  assert.equal(blocksWords([]), "")
  for (const { id } of USE_CASES) {
    for (const nerd of [false, true]) {
      for (const tile of stepTiles(id, "location", nerd)) {
        const offer = METRO_OFFERS[id].find((item) => item.id === tile.id)
        assert.match(tile.fact, new RegExp(`^Power: up to ${Math.max(...offer.blocksMW)} MW · \\$${offer.power.mwh}/MWh \\(est\\.\\)$`), `${id} ${tile.id} ${nerd ? "nerd" : "simple"}`)
        const learn = tile.lines.join(" ")
        assert.ok(learn.includes(`blocks of ${blocksWords(offer.blocksMW)} at about $${offer.power.mwh}/MWh`), `${id} ${tile.id}: the learn lines read the ladder`)
        assert.ok(learn.includes(`$${offer.power.kwMonth} per kW a month`), `${id} ${tile.id}: and the reservation`)
        assert.match(learn, /estimates/)
        if (nerd) assert.ok(tile.nerd.includes(`Blocks ${offer.blocksMW.join("/")} MW · $${offer.power.mwh}/MWh · $${offer.power.kwMonth}/kW-month`), `${id} ${tile.id}: the nerd line`)
      }
    }
  }
})
