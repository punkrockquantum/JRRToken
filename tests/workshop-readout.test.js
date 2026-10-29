/**
 * The read-out (js/workshop/readout.js) and the balance of the whole tile space
 * (scripts/balance-workshop.mjs): what went well, what to do differently with a quantified gain, the
 * architect's notes, the closing line, and the invariants the room is promised.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { STATION_IDS, evaluateWorkshop, scoreWorkshop } from "../js/workshop/cfd.js"
import { DR_CLOSING, bestAlternatives, describeChoices, doDifferently, generateReadout, stationCombos, wentWell } from "../js/workshop/readout.js"
import { allBuilds, analyse, report } from "../scripts/balance-workshop.mjs"

const BEST = {
  connectivity: { product: "combo" },
  oems: { design: "nvl72-rack" },
  dcpower: { metro: "lon", cooling: "liquid", power: "block-0" },
  cfd: { gpu: "gb200", size: "small", fabric: "nvlink" },
}
const TRAP = {
  connectivity: { product: "public" },
  oems: { design: "air-node" },
  dcpower: { metro: "par", cooling: "air", power: "block-2" },
  cfd: { gpu: "rtx", size: "large", fabric: "ethernet" },
}
const H200_LARGE = { ...BEST, oems: { design: "air-node" }, dcpower: { metro: "lon", cooling: "air", power: "block-1" }, cfd: { gpu: "h200", size: "large", fabric: "infiniband" } }

const approvedAll = (choices, { sendBacks = {} } = {}) => STATION_IDS.map((station) => ({ station, choices: choices[station], approval: "approved", sendBacks: sendBacks[station] || 0, hostNote: sendBacks[station] ? "cost" : null }))

test("readout: station combos and choice descriptions", () => {
  assert.deepEqual(
    STATION_IDS.map((id) => stationCombos(id).length),
    [4, 3, 27, 27],
  )
  assert.equal(describeChoices("cfd", BEST.cfd), "GB200 NVL72 rack · Small · NVLink-scale fabric + GPU-adjacent storage")
  assert.equal(describeChoices("oems", BEST.oems), "Rack-scale NVL72")
  assert.equal(describeChoices("dcpower", BEST.dcpower, "lon"), "London · Direct liquid · smallest block")
  assert.equal(describeChoices("connectivity", { product: "public" }), "Public internet")
})

test("readout: the thoughtful build gets three true things, nothing to do differently, no notes, the closing line", () => {
  const out = generateReadout({ choices: BEST, decisions: approvedAll(BEST), rank: 1, teams: 6, teamName: "Downforce Dynamos" })
  assert.equal(out.score, scoreWorkshop(BEST))
  assert.deepEqual([out.rank, out.teams, out.teamName], [1, 6, "Downforce Dynamos"])
  assert.equal(out.wentWell.length, 3)
  assert.match(out.wentWell[0], /Approved first time at all four stations/)
  assert.match(out.wentWell[1], /FP64-capable GPUs: 72 × GB200 NVL72 give 3\.24 PFLOPS/)
  assert.match(out.wentWell[2], /Right-sized power: a 0\.25 MW block/)
  assert.deepEqual(out.doDifferently, ["Nothing beats this build at any one station: every alternative we tried scored lower."])
  assert.deepEqual(out.architectNotes, [])
  assert.equal(out.closing, DR_CLOSING)
  assert.match(out.summary, /^61\.6 runs a night · \$4\.6M · \d+ ms 3D frames · power green · live in 14 wk$/)
  assert.equal(out.detail.score, out.score)
  /* The longer list still only says true things. */
  const all = wentWell(evaluateWorkshop(BEST), { sendBacks: 0, limit: 10 })
  assert.ok(all.some((line) => /back to the car \(\+9%\)/.test(line)), all.join(" | "))
  assert.ok(all.some((line) => /Live in 14 weeks, inside the 16-week deadline/.test(line)))
  assert.ok(all.some((line) => /London sits \d+ km from the UK data room/.test(line)))
})

test("readout: the inference trap is told why, with the points and the runs it left on the table", () => {
  const decisions = approvedAll(TRAP, { sendBacks: { oems: 1, cfd: 2 } })
  const out = generateReadout({ choices: TRAP, decisions, rank: 9, teams: 10 })
  assert.equal(out.score, scoreWorkshop(TRAP, { sendBacks: 3 }))
  assert.ok(out.wentWell.length >= 1 && out.wentWell.length <= 3)
  assert.ok(out.wentWell.some((line) => /Approved first time at 2 of 4 stations/.test(line)), out.wentWell.join(" | "))
  assert.ok(!out.wentWell.some((line) => /FP64-capable/.test(line)), "an RTX build is not praised for FP64")
  assert.equal(out.doDifferently.length, 3, out.doDifferently.join(" | "))
  const [first, second, third] = out.doDifferently
  assert.match(first, /^CFD SUPERCOMPUTER: .+ instead of RTX PRO 6000 servers · Large · Ethernet \+ file storage would have scored \+\d+ \(\d+, [\d.]+ → [\d.]+ runs a night\): CFD needs FP64/)
  assert.match(second, /^Then (CONNECTIVITY|OEMs|DATACENTER & POWER): .+ instead of .+, \+\d+ more \(\d+/)
  assert.match(third, /^(Then (CONNECTIVITY|OEMs|DATACENTER & POWER): .+, \+\d+ more|From there, the top build on the board scores 1524)/)
  const scores = out.doDifferently.map((line) => Number(/\((\d+)/.exec(line)?.[1] || /scores (\d+)/.exec(line)?.[1]))
  assert.ok(scores[0] < scores[1] && scores[1] < scores[2], `the path climbs: ${scores.join(" → ")}`)
  assert.deepEqual(out.architectNotes, ["OEMs: sent back once (cost).", "CFD SUPERCOMPUTER: sent back 2 times (cost)."])
  /* At the floor only the GPU lifts the score on its own; the path then fixes the rest one station at a time. */
  const alternatives = bestAlternatives(TRAP, { sendBacks: 3 })
  assert.equal(alternatives.length, 1)
  assert.equal(alternatives[0].station, "cfd", "the GPU is the only single fix that moves a build off the floor")
  assert.ok(alternatives[0].gain > 0 && alternatives[0].score === out.score + alternatives[0].gain)
  /* Several single-station fixes: sorted by gain, each strictly better than the base. */
  const middling = { connectivity: { product: "public" }, oems: { design: "liquid-node" }, dcpower: { metro: "fra", cooling: "rear-door", power: "block-1" }, cfd: { gpu: "gb200", size: "medium", fabric: "infiniband" } }
  const many = bestAlternatives(middling)
  const base = scoreWorkshop(middling)
  assert.ok(many.length >= 3, `${many.length} stations have a better tile`)
  for (let i = 1; i < many.length; i += 1) assert.ok(many[i - 1].gain >= many[i].gain)
  for (const alt of many) assert.ok(alt.gain > 0 && alt.score === base + alt.gain && alt.combo && alt.fromCombo)
})

test("readout: a good but expensive build sits at a local optimum, so it is shown the top build and its gap", () => {
  const lines = doDifferently(H200_LARGE)
  assert.equal(lines.length, 1, lines.join(" | "))
  assert.match(lines[0], /^No single station change beats this build\. The top build on the board scores 1524 \(\+70\): 61\.6 runs a night for \$4\.6M, \$4\.4M back to the car\. It differs at OEMs: Rack-scale NVL72; DATACENTER & POWER: London · Direct liquid · smallest block; CFD SUPERCOMPUTER: GB200 NVL72 rack · Small · NVLink-scale fabric \+ GPU-adjacent storage\.$/)
  /* A build one step from the top gets the step, not the gap. */
  const oneOff = doDifferently({ ...BEST, cfd: { ...BEST.cfd, fabric: "ethernet" } })
  assert.equal(oneOff.length, 1)
  assert.match(oneOff[0], /^CFD SUPERCOMPUTER: GB200 NVL72 rack · Small · NVLink-scale fabric \+ GPU-adjacent storage instead of GB200 NVL72 rack · Small · Ethernet \+ file storage would have scored \+\d+ \(1524, 45\.4 → 61\.6 runs a night\): a fabric and storage that keep the GPUs fed\.$/)
})

test("readout: a station never saved is called out first, and partial decisions still score", () => {
  const decisions = [
    { station: "cfd", choices: BEST.cfd, approval: "approved", sendBacks: 0, hostNote: null },
    { station: "oems", choices: BEST.oems, approval: "approved", sendBacks: 1, hostNote: "power" },
  ]
  const choices = { cfd: BEST.cfd, oems: BEST.oems }
  const out = generateReadout({ choices, decisions })
  assert.equal(out.doDifferently[0], "You never saved a choice at CONNECTIVITY and DATACENTER & POWER: the cheapest tile stood in for you.")
  assert.ok(out.doDifferently.length >= 2 && out.doDifferently.length <= 4)
  assert.deepEqual(out.architectNotes, ["OEMs: sent back once (power)."])
  assert.ok(out.wentWell.some((line) => /Approved first time at/.test(line)) === false, "one first-time approval is not a headline")
  assert.equal(out.rank, null)
})

test("balance: every build scores, the thoughtful build is the unique top (per metro), the trap and the oversized block lose", () => {
  const builds = allBuilds()
  assert.equal(builds.length, 4 * 3 * 27 * 27)
  const a = analyse()
  assert.deepEqual(a.failures, [])
  assert.equal(a.builds, 8748)
  assert.equal(a.summary.max, scoreWorkshop(BEST))
  assert.equal(a.summary.min, 100)
  assert.equal(a.summary.atCap, 3, "the three metros tie: with private connectivity all three meet the latency targets")
  assert.ok(a.trap.best < 200, `the trap's best is ${a.trap.best}`)
  assert.equal(a.oversized.wins, 0)
  assert.ok(a.oversized.cases > 2000)
  assert.equal(a.publicWins, 0)
  for (const row of a.swing) assert.ok(row.swing >= 400, `${row.station} swings ${row.swing}`)
  const trapTile = a.tiles.find((tile) => tile.id === "rtx")
  assert.ok(trapTile.mean <= 110 && trapTile.best < 200)
  const biggest = a.tiles.find((tile) => tile.id === "block-2")
  const smallest = a.tiles.find((tile) => tile.id === "block-0")
  assert.ok(biggest.green < smallest.green && biggest.mean < smallest.mean)
  assert.equal(a.sendBacks[0].score, scoreWorkshop(BEST))
  assert.ok(a.sendBacks[5].score === a.sendBacks[4].score, "five send-backs reach the approval floor")
  const text = report(a)
  assert.match(text, /All invariants hold\./)
  assert.match(text, /\| score \| runs\/night \| build/)
})
