/**
 * The workshop engine (js/workshop/cfd.js): the four stations' tiles, the validation the Worker
 * relies on, the physics-backed numbers and the score's shape: the thoughtful build wins, the
 * inference trap loses, oversized power and public-internet links cost points, and every table can
 * see why.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { HALLS, METRO_POWER, SITES, byId } from "../js/data.js"
import { REFARCH } from "../js/refarch.js"
import {
  APPROVAL_FLOOR,
  RUNS_CAP,
  SCENARIO,
  SCORE_FLOOR,
  SEND_BACK_PENALTY,
  STATIONS,
  STATION_IDS,
  blankChoices,
  blockMW,
  completeChoices,
  connectivityLegs,
  defaultChoices,
  evaluateWorkshop,
  formatMoney,
  frameLatencyMs,
  metroFacts,
  metroGeometry,
  powerLadder,
  powerTileTitle,
  scoreWorkshop,
  stationById,
  stationLine,
  summaryLine,
  tileLearn,
  tileOf,
  transferHours,
  validateChoices,
} from "../js/workshop/cfd.js"

const BEST = {
  connectivity: { product: "combo" },
  oems: { design: "nvl72-rack" },
  dcpower: { metro: "lon", cooling: "liquid", power: "block-0" },
  cfd: { gpu: "gb200", size: "small", fabric: "nvlink" },
}
const TRAP = { ...BEST, cfd: { gpu: "rtx", size: "large", fabric: "ethernet" }, oems: { design: "air-node" }, dcpower: { metro: "lon", cooling: "air", power: "block-0" } }
const H200 = { connectivity: { product: "combo" }, oems: { design: "air-node" }, dcpower: { metro: "lon", cooling: "air", power: "block-0" }, cfd: { gpu: "h200", size: "medium", fabric: "infiniband" } }

test("stations: four stations, three to four tiles per decision, one plain sentence and a '?' text on every tile", () => {
  assert.deepEqual(STATION_IDS, ["connectivity", "oems", "dcpower", "cfd"])
  assert.deepEqual(
    STATIONS.map((station) => station.name),
    ["CONNECTIVITY", "OEMs", "DATACENTER & POWER", "CFD SUPERCOMPUTER"],
  )
  for (const station of STATIONS) {
    assert.ok(station.why.length > 20 && station.why.length < 200, `${station.id} why is one sentence`)
    assert.ok(station.decisions.length >= 1 && station.decisions.length <= 3, `${station.id} has at most three decisions`)
    for (const decision of station.decisions) {
      assert.ok(decision.tiles.length >= 3 && decision.tiles.length <= 4, `${station.id}/${decision.id} has 3–4 tiles`)
      assert.equal(new Set(decision.tiles.map((tile) => tile.id)).size, decision.tiles.length)
      for (const tile of decision.tiles) {
        assert.ok(tile.title && tile.line, `${station.id}/${decision.id}/${tile.id} has a title and a line`)
        assert.ok(tile.line.length <= 160, `${tile.id} line is short (${tile.line.length})`)
        const learn = tileLearn(station.id, decision.id, tile.id)
        assert.ok(learn.length >= 40, `${tile.id} has a '?' text`)
      }
    }
  }
  assert.deepEqual(stationById("cfd").decisions.map((decision) => decision.id), ["gpu", "size", "fabric"])
  assert.deepEqual(stationById("dcpower").decisions.map((decision) => decision.id), ["metro", "cooling", "power"])
  assert.deepEqual(stationById("connectivity").decisions[0].tiles.map((tile) => tile.id), ["public", "fabric", "fiber", "combo"])
  assert.deepEqual(stationById("oems").decisions[0].tiles.map((tile) => tile.letter), ["A", "B", "C"])
  assert.equal(stationById("qpu"), null)
  assert.equal(tileOf("cfd", "gpu", "rtx").trap, true)
  assert.ok(STATIONS.flatMap((s) => s.decisions.flatMap((d) => d.tiles)).filter((tile) => tile.trap).length === 1, "exactly one trap tile")
})

test("stations: the OEM designs, halls and metros come from the game's own tables", () => {
  for (const tile of stationById("oems").decisions[0].tiles) {
    const design = Object.values(REFARCH).flat().find((row) => row.id === tile.refarch)
    assert.ok(design, `${tile.id} points at js/refarch.js ${tile.refarch}`)
  }
  for (const tile of stationById("dcpower").decisions[1].tiles) {
    const hall = byId(HALLS, tile.hall)
    assert.deepEqual([tile.capKW, tile.pue, tile.fitOutWeeks, tile.liquid], [hall.maxRackKW, hall.pue, hall.fitOutWeeks, hall.cooling === "liquid"])
  }
  for (const tile of stationById("dcpower").decisions[0].tiles) {
    assert.equal(tile.title, byId(SITES, tile.id).metro)
    assert.deepEqual(powerLadder(tile.id), METRO_POWER[tile.id].blocksMW.slice(0, 3))
    assert.equal(blockMW(tile.id, "block-0"), powerLadder(tile.id)[0])
    assert.equal(blockMW(tile.id, "block-2"), powerLadder(tile.id)[2])
    assert.equal(blockMW(tile.id, "block-9"), powerLadder(tile.id)[2], "clamped")
    assert.match(powerTileTitle(tile.id, "block-1"), /^\d+(\.\d+)? MW$/)
    assert.match(metroFacts(tile.id), /Milton Keynes [\d,]+ km · Modena [\d,]+ km · data \d+ km · \$\d+\/MWh/)
  }
  const london = metroGeometry("lon")
  assert.ok(london.dataKm < 100 && london.dataKm > 30, `London is ${london.dataKm} km from the Milton Keynes data room`)
  assert.ok(metroGeometry("fra").dataKm > 600 && metroGeometry("par").dataKm > 300)
  assert.equal(metroGeometry("xyz"), null)
  assert.match(tileLearn("dcpower", "metro", "lon"), /London is a real Digital Realty metro/)
  assert.match(tileLearn("dcpower", "power", "block-0", "fra"), /MW contracted in Frankfurt/)
  assert.equal(tileLearn("nope", "x", "y"), "")
})

test("choices: defaults are the first (cheap) tile; validation refuses unknown tiles and stray keys; completeChoices fills the gaps", () => {
  assert.deepEqual(defaultChoices("cfd"), { gpu: "h200", size: "small", fabric: "ethernet" })
  assert.deepEqual(defaultChoices("dcpower"), { metro: "lon", cooling: "air", power: "block-0" })
  assert.deepEqual(Object.keys(blankChoices()), STATION_IDS)
  assert.deepEqual(validateChoices("cfd", BEST.cfd), { ok: true, choices: BEST.cfd, errors: [] })
  const bad = validateChoices("cfd", { gpu: "gb200", size: "huge", extra: 1 })
  assert.equal(bad.ok, false)
  assert.equal(bad.choices, null)
  assert.ok(bad.errors.some((line) => line.startsWith("size: pick one of small, medium, large")))
  assert.ok(bad.errors.some((line) => line.startsWith("fabric: pick one of")))
  assert.ok(bad.errors.some((line) => line === "extra is not a decision at this station."))
  assert.equal(validateChoices("cfd", "gb200").ok, false)
  assert.equal(validateChoices("cfd", ["gb200"]).ok, false)
  assert.equal(validateChoices("cfd", null).ok, false)
  assert.equal(validateChoices("qpu", {}).ok, false)
  assert.deepEqual(completeChoices({ cfd: { gpu: "gb200", size: "nope" } }).cfd, { gpu: "gb200", size: "small", fabric: "ethernet" })
  assert.deepEqual(completeChoices(null), blankChoices())
  assert.deepEqual(completeChoices({ oems: "air-node" }).oems, { design: "air-node" })
})

test("physics: frame latency and transfer hours follow js/physics.js; the four connectivity products behave as their tiles say", () => {
  assert.ok(frameLatencyMs(100, "fiber") < frameLatencyMs(100, "public"))
  assert.ok(frameLatencyMs(1000, "fiber") > frameLatencyMs(100, "fiber"))
  assert.equal(transferHours(20, 1).toFixed(1), "44.4")
  assert.equal(transferHours(20, 100).toFixed(1), "0.4")
  assert.equal(transferHours(20, 0), Infinity)
  const pub = connectivityLegs("lon", "public")
  const combo = connectivityLegs("lon", "combo")
  const fiber = connectivityLegs("lon", "fiber")
  const fabric = connectivityLegs("lon", "fabric")
  assert.deepEqual(pub.legs.map((leg) => leg.id), ["viz-mk", "viz-mo", "data", "inter"])
  assert.ok(pub.legs.every((leg) => leg.routeId === "public"))
  assert.ok(combo.legs.every((leg) => leg.routeId !== "public"))
  assert.deepEqual(fiber.legs.map((leg) => leg.routeId), ["fiber", "public", "fiber", "public"], "dark fibre reaches one far end")
  assert.ok(combo.frameMs <= fabric.frameMs && fabric.frameMs < pub.frameMs, `frames ${combo.frameMs} <= ${fabric.frameMs} < ${pub.frameMs}`)
  assert.ok(fiber.frameMs > combo.frameMs, "dark fibre alone leaves Modena on the public internet")
  assert.ok(combo.ingestHours < fabric.ingestHours && fabric.ingestHours < pub.ingestHours)
  assert.ok(combo.frameMs <= SCENARIO.vizTargetMs && combo.ingestHours <= SCENARIO.ingestTargetH)
  assert.ok(pub.frameMs > SCENARIO.vizTargetMs && pub.ingestHours > SCENARIO.ingestTargetH)
  assert.equal(connectivityLegs("lon", "nope").product.id, "public", "unknown products fall back to the public road")
  assert.ok(pub.legs[0].name.includes("Milton Keynes") && pub.legs[1].name.includes("Modena") && pub.legs[2].name.includes("20 TB"))
})

test("score: the thoughtful build hits the cap, the inference trap hits the floor, the H200 middle sits between, and every factor is in range", () => {
  const best = evaluateWorkshop(BEST)
  assert.equal(best.score, 1400)
  assert.deepEqual(best.factors, { runs: RUNS_CAP, approval: 1, budget: 1, power: 1, latency: 1, viz: 1, ingest: 1, late: 1 })
  assert.ok(best.runs > SCENARIO.parRuns && !best.overBudget && best.lateWeeks === 0 && best.power.state === "green" && best.net.allPrivate)
  assert.equal(best.gpu.gpus, 72)
  assert.equal(best.pflops, 3.24)
  assert.equal(best.racks, 1)
  assert.equal(best.design.mismatch, false)

  const trap = evaluateWorkshop(TRAP)
  assert.equal(trap.score, SCORE_FLOOR)
  assert.ok(trap.gpu.trap && trap.runs < 5, `the trap gives ${trap.runs} runs a night`)

  const middle = evaluateWorkshop(H200)
  assert.ok(middle.score > 800 && middle.score < 1000, `H200 medium on InfiniBand scores ${middle.score}`)
  assert.ok(middle.runs > 30 && middle.runs < SCENARIO.parRuns, `${middle.runs} runs`)

  const naive = evaluateWorkshop(blankChoices())
  assert.ok(naive.score < 300, `the defaults score ${naive.score}`)

  for (const choices of [BEST, TRAP, H200, blankChoices()]) {
    const r = evaluateWorkshop(choices)
    for (const [name, value] of Object.entries(r.factors)) assert.ok(value >= 0 && value <= RUNS_CAP, `${name}=${value}`)
    assert.ok(r.score >= SCORE_FLOOR && r.score <= 1400)
    assert.equal(scoreWorkshop(choices), r.score)
    assert.ok(Number.isFinite(r.capex) && r.capex > 0 && Number.isFinite(r.annualOpex))
    assert.ok(r.leadWeeks > 0)
    assert.ok(["green", "amber", "red"].includes(r.power.state))
  }
})

test("score: send-backs cost 3% each to a floor of 85%, never changing the engineering numbers", () => {
  const clean = evaluateWorkshop(H200)
  const one = evaluateWorkshop(H200, { sendBacks: 1 })
  const many = evaluateWorkshop(H200, { sendBacks: 9 })
  assert.equal(one.factors.approval, 1 - SEND_BACK_PENALTY)
  assert.equal(many.factors.approval, APPROVAL_FLOOR)
  assert.ok(clean.score > one.score && one.score > many.score)
  assert.equal(one.runs, clean.runs)
  assert.equal(one.capex, clean.capex)
  assert.equal(evaluateWorkshop(H200, { sendBacks: -3 }).factors.approval, 1)
})

test("score: an oversized power block, the public internet, a far metro, a design that does not fit and liquid racks in an air hall all cost points", () => {
  const base = evaluateWorkshop(BEST)
  const oversized = evaluateWorkshop({ ...BEST, dcpower: { ...BEST.dcpower, power: "block-2" } })
  assert.equal(oversized.power.state, "red")
  assert.ok(oversized.score < base.score && oversized.power.headroomPct > 50, `block-2 gives ${oversized.power.headroomPct}% headroom and ${oversized.score}`)
  assert.equal(oversized.runs, base.runs, "too much power does not change the runs")

  const publicNet = evaluateWorkshop({ ...BEST, connectivity: { product: "public" } })
  assert.ok(publicNet.score < base.score && publicNet.factors.latency < 1)
  assert.ok(publicNet.net.frameMs > base.net.frameMs && publicNet.net.ingestHours > 24)

  const far = evaluateWorkshop({ ...BEST, dcpower: { ...BEST.dcpower, metro: "fra" } })
  assert.ok(far.net.frameMs > base.net.frameMs, "Frankfurt is further from both offices and the data room")
  assert.ok(far.metro.dataKm > base.metro.dataKm)

  const mismatch = evaluateWorkshop({ ...BEST, oems: { design: "air-node" } })
  assert.equal(mismatch.design.mismatch, true)
  assert.ok(mismatch.leadWeeks >= base.leadWeeks + 6 && mismatch.capex > base.capex, "re-engineering costs six weeks and 10%")
  assert.ok(mismatch.score < base.score)

  const liquidInAir = evaluateWorkshop({ ...BEST, dcpower: { ...BEST.dcpower, cooling: "air" } })
  assert.equal(liquidInAir.cooling.liquidInAir, true)
  assert.ok(liquidInAir.runs < base.runs * 0.5 && liquidInAir.score < base.score)

  const tooSmall = evaluateWorkshop({ ...BEST, cfd: { ...BEST.cfd, size: "large" } })
  assert.ok(tooSmall.power.shortKW > 0 && tooSmall.power.throttle < 1 && tooSmall.power.state === "red", `three NVL72 racks in the smallest block throttle (${tooSmall.power.shortKW} kW short)`)
  const rightSized = evaluateWorkshop({ ...BEST, cfd: { ...BEST.cfd, size: "large" }, dcpower: { ...BEST.dcpower, power: "block-1" } })
  assert.ok(rightSized.runs > tooSmall.runs && rightSized.power.shortKW === 0)
  assert.ok(tooSmall.overBudget && tooSmall.factors.budget < 1, `three NVL72 racks cost ${formatMoney(tooSmall.capex)}`)

  const tight = evaluateWorkshop({ ...H200, cfd: { ...H200.cfd, size: "large" } })
  assert.ok(tight.power.headroomPct < 10 && tight.power.state !== "green", `a large H200 cluster nearly fills the smallest block (${tight.power.headroomPct}% headroom, ${tight.power.state})`)
})

test("lines: summary and station lines carry the numbers a table needs, money formats sensibly", () => {
  const r = evaluateWorkshop(BEST)
  assert.match(summaryLine(r), /^61\.6 runs a night \(par 40\) · \$4\.6M of \$9M · 3D view \d+ ms · data 0\.4 h · power 0\.25 MW for \d+ kW \(green\) · live in 14 wk$/)
  assert.match(stationLine("connectivity", r), /^3D view \d+ ms \(target 30\) · night's data home in 0\.4 h \(target 4\) · \$420k a year$/)
  assert.match(stationLine("oems", r), /^1 rack at 136 kW · liquid cooled · live in 14 wk$/)
  assert.match(stationLine("dcpower", r), /kW needed · 0\.25 MW block \(\d+% headroom, green\) · cooling fits · data \d+ km away$/)
  assert.match(stationLine("cfd", r), /^72 GPUs · 3\.24 PFLOPS FP64 · 61\.6 runs a night \(par 40\) · \$4\.6M of \$9M$/)
  const trap = evaluateWorkshop({ ...BEST, oems: { design: "air-node" } })
  assert.ok(stationLine("oems", trap).includes("DOES NOT FIT THIS GPU"))
  assert.ok(summaryLine(evaluateWorkshop({ ...BEST, cfd: { ...BEST.cfd, size: "large" } })).includes(" OVER"))
  assert.equal(formatMoney(9_000_000), "$9M")
  assert.equal(formatMoney(4_560_000), "$4.6M")
  assert.equal(formatMoney(420_000), "$420k")
  assert.equal(formatMoney(950), "$950")
  assert.equal(formatMoney("x"), "$0")
})

test("scenario: the brief is fiction, labelled, with the numbers the stations score against", () => {
  assert.equal(SCENARIO.team, "Apex Aero Racing")
  assert.ok(SCENARIO.brief.length >= 3 && SCENARIO.brief.every((line) => typeof line === "string" && line.length < 240))
  assert.ok(SCENARIO.brief.join(" ").toLowerCase().includes("fiction"), "the scenario says it is fictional")
  assert.deepEqual([SCENARIO.budget, SCENARIO.goLiveWeeks, SCENARIO.parRuns, SCENARIO.nightlyTB, SCENARIO.vizTargetMs, SCENARIO.ingestTargetH], [9_000_000, 16, 40, 20, 30, 4])
  assert.deepEqual(SCENARIO.cities.map((city) => [city.id, city.dataRoom]), [["mk", true], ["mo", false]])
  assert.equal(SCENARIO.cities.reduce((sum, city) => sum + city.share, 0), 1)
})
