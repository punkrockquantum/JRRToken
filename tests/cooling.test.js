import assert from "node:assert/strict"
import test from "node:test"

import { HALLS, PLATFORMS, USE_CASES, byId } from "../js/data.js"
import { ecosystem } from "../js/eco.js"
import { evaluateBuild } from "../js/model.js"
import { choicesToBuild, defaultChoices } from "../js/presets.js"
import { stepTiles } from "../js/steps.js"

/* User: "Under cooling, there should be an option for cold aisle containment." */

const air = byId(HALLS, "A")
const contained = byId(HALLS, "C")
const rear = byId(HALLS, "R")
const liquid = byId(HALLS, "B")
const build = (hall, platform, racks = 2) => evaluateBuild("chat", { hall, platform, racks, sites: ["lon"], data: "local", network: "fabric" })

test("cold aisle containment is an air hall whose rack cap and PUE sit between open air and the rear door, on a short fit-out", () => {
  assert.equal(contained.kind, "Cold aisle containment")
  assert.equal(contained.cooling, "air", "the servers stay air-cooled")
  assert.ok(air.maxRackKW >= 10 && air.maxRackKW <= 15, `open air cools about 10 to 15 kW a rack (${air.maxRackKW})`)
  assert.ok(contained.maxRackKW > air.maxRackKW && contained.maxRackKW < rear.maxRackKW, `cap ${air.maxRackKW} < ${contained.maxRackKW} < ${rear.maxRackKW}`)
  assert.ok(contained.maxRackKW >= 15 && contained.maxRackKW <= 30, "roughly 15 to 30 kW per rack")
  assert.ok(contained.pue < air.pue && contained.pue > rear.pue, `PUE ${air.pue} > ${contained.pue} > ${rear.pue}`)
  assert.ok(air.pue - contained.pue >= 0.08 && air.pue - contained.pue <= 0.2, "about 0.1 to 0.2 better than open air")
  assert.ok(contained.fitOutWeeks > air.fitOutWeeks && contained.fitOutWeeks <= 3, "days to a few weeks of fit-out")
  assert.match(contained.learn, /^Doors and panels keep cold air in front of the racks and hot air behind them, so the fans work less\./)
  assert.match(contained.learn, /game assumption|estimate/)
})

test("containment takes every air-cooled NVIDIA rack; open air throttles an HGX rack; NVL72 and Vera Rubin still overheat without liquid", () => {
  for (const platform of PLATFORMS) {
    const result = build("C", platform.id)
    if (platform.cooling === "liquid") {
      assert.ok(result.warnings.some((line) => /need liquid cooling/.test(line)), `${platform.id} overheats under containment`)
      assert.equal(ecosystem(result).find((part) => part.id === "cooling").state, "red", `${platform.id}: COOLING is red under containment`)
    } else {
      assert.ok(!result.warnings.some((line) => /overheat|too hot/.test(line)), `${platform.id} runs cool under containment: ${result.warnings.join(" | ")}`)
      assert.equal(ecosystem(result).find((part) => part.id === "cooling").state === "red", false, `${platform.id}: COOLING is not red under containment`)
    }
  }
  const hot = build("A", "h100")
  assert.ok(hot.warnings.some((line) => /runs too hot for the Air hall/.test(line)), hot.warnings.join(" | "))
  const hotLight = ecosystem(hot).find((part) => part.id === "cooling")
  assert.equal(hotLight.state, "red")
  assert.match(hotLight.ask, /^Would cold aisle containment keep these racks at full speed\?$/, "the light points at the cheap fix")
  assert.ok(!build("A", "rtx6000").warnings.some((line) => /too hot/.test(line)), "a 14 kW rack still fits open air")
  /* The same racks draw the same IT power in every air hall; only the meter moves with the PUE. */
  const inAir = build("A", "l40s")
  const inContainment = build("C", "l40s")
  assert.equal(inAir.itKW, inContainment.itKW)
  assert.ok(inContainment.facilityKW < inAir.facilityKW, "containment spends less at the meter")
  assert.ok(build("C", "b300").facilityKW < build("A", "b300").facilityKW)
  assert.equal(liquid.cooling, "liquid")
})

test("the cooling step offers containment in both modes, every tile wearing its kW band and PUE, and every story opens on it", () => {
  for (const uc of USE_CASES) {
    const simple = stepTiles(uc.id, "cooling", false)
    assert.deepEqual(simple.map((tile) => tile.label), ["Air-cooled hall", "Cold aisle containment", "Liquid-cooled hall"], uc.id)
    const nerd = stepTiles(uc.id, "cooling", true)
    assert.deepEqual(nerd.map((tile) => tile.label), ["Air cooling", "Cold aisle containment", "In-row cooling", "Rear door heat exchanger", "Direct liquid cooling"], uc.id)
    for (const tile of nerd) {
      assert.match(tile.tag, /^(up to |15–)\d+ kW · PUE \d\.\d\d$/, `${uc.id} ${tile.id}: ${tile.tag}`)
      assert.ok(tile.tag.includes(`PUE ${tile.hall.pue.toFixed(2)}`), tile.tag)
      assert.ok(tile.tag.includes(`${tile.hall.maxRackKW} kW`), tile.tag)
    }
    for (const tile of simple) {
      /* The simple board never says PUE: the overhead reads as a share of the power spent on cooling. */
      assert.match(tile.tag, /^(up to |15–)\d+ kW · \d+% on cooling$/, `${uc.id} ${tile.id}: ${tile.tag}`)
      assert.ok(tile.tag.includes(`${Math.round((tile.hall.pue - 1) * 100)}% on cooling`), tile.tag)
    }
    const aisle = simple.find((tile) => tile.id === "aisle")
    assert.equal(aisle.tag, `15–${contained.maxRackKW} kW · ${Math.round((contained.pue - 1) * 100)}% on cooling`)
    assert.equal(nerd.find((tile) => tile.id === "aisle").tag, `15–${contained.maxRackKW} kW · PUE ${contained.pue.toFixed(2)}`)
    assert.equal(aisle.why, "Doors and panels keep cold air in front of the racks and hot air behind them, so the fans work less.")
    assert.equal(aisle.lines[0], aisle.why, "the learn text opens in the same plain words")
    assert.match(aisle.lines[2], /NVL72 and Vera Rubin still need direct liquid cooling/)
    /* Every story opens on an HGX rack, which open air cannot cool: the opening hall is containment, and it runs cool. */
    const opening = defaultChoices(uc.id)
    assert.equal(opening.home, "aisle", uc.id)
    const result = evaluateBuild(uc.id, choicesToBuild(uc.id, opening, false))
    assert.equal(result.hall.id, "C")
    assert.ok(!result.warnings.some((line) => /overheat|too hot/.test(line)), `${uc.id}: ${result.warnings.join(" | ")}`)
  }
})
