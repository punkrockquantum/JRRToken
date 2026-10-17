import assert from "node:assert/strict"
import test from "node:test"

import { HALLS, PLATFORMS, USE_CASES, byId, hallRackCap } from "../js/data.js"
import { ecosystem } from "../js/eco.js"
import { evaluateBuild } from "../js/model.js"
import { choicesToBuild, defaultChoices } from "../js/presets.js"
import { nodesPerRack, referenceDesign } from "../js/refarch.js"
import { stepTiles } from "../js/steps.js"

/* User: "Under cooling, there should be an option for cold aisle containment." */

const air = byId(HALLS, "A")
const contained = byId(HALLS, "C")
const rear = byId(HALLS, "R")
const inRow = byId(HALLS, "I")
const liquid = byId(HALLS, "B")
const build = (hall, platform, racks = 2, extra = {}) => evaluateBuild("chat", { hall, platform, racks, sites: ["lon"], data: "local", network: "fabric", ...extra })

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
    assert.deepEqual(simple.map((tile) => tile.label), ["Air-cooled hall", "Cold aisle containment", "Rear door heat exchanger", "Liquid-cooled hall"], uc.id)
    const nerd = stepTiles(uc.id, "cooling", true)
    assert.deepEqual(nerd.map((tile) => tile.label), ["Air cooling", "Cold aisle containment", "In-row cooling", "Rear door heat exchanger", "Direct liquid cooling"], uc.id)
    for (const tile of nerd) {
      assert.match(tile.tag, /^(up to |15–|40–)\d+ kW · PUE \d\.\d\d · (\d+ wk|ready now)$/, `${uc.id} ${tile.id}: ${tile.tag}`)
      assert.ok(tile.tag.includes(`PUE ${tile.hall.pue.toFixed(2)}`), tile.tag)
      assert.ok(tile.tag.includes(`${tile.hall.maxRackKW} kW`), tile.tag)
      assert.ok(tile.tag.endsWith(tile.hall.fitOutWeeks ? `${tile.hall.fitOutWeeks} wk` : "ready now"), "the lead time sits on the tile")
    }
    for (const tile of simple) {
      /* The simple board never says PUE: the overhead reads as a share of the power spent on cooling. */
      assert.match(tile.tag, /^(up to |15–|40–)\d+ kW · \d+% on cooling · (\d+ wk|ready now)$/, `${uc.id} ${tile.id}: ${tile.tag}`)
      assert.ok(tile.tag.includes(`${Math.round((tile.hall.pue - 1) * 100)}% on cooling`), tile.tag)
    }
    const aisle = simple.find((tile) => tile.id === "aisle")
    assert.equal(aisle.tag, `15–${contained.maxRackKW} kW · ${Math.round((contained.pue - 1) * 100)}% on cooling · ${contained.fitOutWeeks} wk`)
    assert.equal(nerd.find((tile) => tile.id === "aisle").tag, `15–${contained.maxRackKW} kW · PUE ${contained.pue.toFixed(2)} · ${contained.fitOutWeeks} wk`)
    const door = simple.find((tile) => tile.id === "rear")
    assert.equal(door.tag, `40–${rear.maxRackKW} kW · ${Math.round((rear.pue - 1) * 100)}% on cooling · ${rear.fitOutWeeks} wk`)
    assert.equal(door.why, "A radiator on the rack's back door cools the hot air as it leaves, so ordinary air-cooled servers pack far denser.")
    assert.match(door.lines[0], /^A radiator on the back door of the rack cools the hot air as it leaves, so ordinary air-cooled servers can be packed far denser\./)
    assert.match(door.lines[2], /NVL72 and Vera Rubin are direct-liquid designs/)
    assert.equal(door.liquidNeeded, false, "an HGX rack on the board: no liquid note")
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

/* User: "In cooling add Rear Door Heat Exchanger as an option to allow realistic power densities." */

test("the rear door heat exchanger: caps order open air < containment < in-row ≈ rear door < liquid; PUE between containment and liquid; chilled water lead and a per-rack cost", () => {
  assert.equal(rear.kind, "Rear door heat exchanger")
  assert.equal(rear.cooling, "air", "the servers stay air-cooled")
  assert.ok(air.maxRackKW < contained.maxRackKW && contained.maxRackKW < inRow.maxRackKW && inRow.maxRackKW <= rear.maxRackKW && rear.maxRackKW < liquid.maxRackKW)
  assert.ok(Math.abs(inRow.maxRackKW - rear.maxRackKW) <= 20, "in-row and the rear door are the two dense air halls")
  assert.ok(rear.maxRackKW >= 40 && rear.maxRackKW <= 100, "roughly 40 to 70 kW a rack, high-capacity doors to about 100")
  assert.ok(rear.pue < contained.pue && rear.pue > liquid.pue, `PUE ${contained.pue} > ${rear.pue} > ${liquid.pue}`)
  assert.ok(rear.fitOutWeeks >= 4 && rear.fitOutWeeks <= 8, "weeks for the chilled water")
  assert.ok(rear.rackNrc >= 15_000 && rear.rackNrc <= 40_000, "an active door is tens of thousands a rack")
  assert.ok(rear.rackNrc > inRow.rackNrc && inRow.rackNrc > contained.rackNrc, "a door costs more than an in-row cooler share; containment panels sit in the hall's fit-out")
  assert.equal(liquid.rackNrc, 0, "the NVL72 and Vera Rubin racks carry their manifolds and CDU share in the platform price")
  assert.match(rear.learn, /^A radiator on the back door of the rack cools the hot air as it leaves, so ordinary air-cooled servers can be packed far denser\./)
  /* The fit-out per rack lands in the capex, so the cheaper hall is cheaper on the sheet too. */
  const onDoor = build("R", "b300", 4)
  const inContainment = build("C", "b300", 4)
  assert.equal(onDoor.coolingCapex, rear.rackNrc * 4)
  assert.equal(onDoor.capex - inContainment.capex, (rear.rackNrc - contained.rackNrc) * 4)
})

test("the rear door packs an HGX rack two to four nodes deep where containment stops at two, and NVL72 on it still throttles", () => {
  const hopper = referenceDesign("h100")
  const b300 = referenceDesign("b300")
  assert.ok(nodesPerRack(hopper, rear) >= 4 && nodesPerRack(hopper, rear) > nodesPerRack(hopper, contained), `H100 nodes per rack: door ${nodesPerRack(hopper, rear)}, containment ${nodesPerRack(hopper, contained)}`)
  assert.ok(nodesPerRack(b300, rear) >= 4 && nodesPerRack(b300, contained) <= 2, `B300 nodes per rack: door ${nodesPerRack(b300, rear)}, containment ${nodesPerRack(b300, contained)}`)
  assert.equal(nodesPerRack(hopper, air), 1)
  /* Caps are nominal: a 30.4 kW pair of 6U air nodes still cools in a 30 kW containment rack, a 40 kW rack does not. */
  assert.equal(hallRackCap(contained), 31.5)
  assert.ok(!build("C", "b200", 2, { refarch: "b200-b" }).warnings.some((line) => /too hot/.test(line)), "a 6U B200 pair at 30.4 kW cools under containment")
  for (const id of ["gb200", "gb300", "vr"]) {
    const result = build("R", id)
    assert.ok(result.warnings.some((line) => /need liquid cooling, so in the air hall they overheat/.test(line)), `${id}: ${result.warnings.join(" | ")}`)
    assert.equal(ecosystem(result).find((part) => part.id === "cooling").state, "red", `${id}: COOLING is red on the rear door`)
  }
  for (const id of ["h100", "h200", "b200", "b300"]) assert.ok(!build("R", id).warnings.some((line) => /overheat|too hot/.test(line)), `${id} runs cool on the rear door`)
  /* With an NVL72 rack on the board, every air hall's tile says it needs direct liquid. */
  const tiles = stepTiles("chat", "cooling", false, { ...defaultChoices("chat"), brains: "gb200", brainsAuto: false })
  for (const tile of tiles) {
    if (tile.hall.cooling === "liquid") assert.equal(tile.liquidNeeded, false, tile.id)
    else {
      assert.equal(tile.liquidNeeded, true, tile.id)
      assert.match(tile.hint, /^needs direct liquid for GB200 NVL72$/, `${tile.id}: ${tile.hint}`)
    }
  }
})
