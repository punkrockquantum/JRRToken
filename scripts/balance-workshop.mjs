#!/usr/bin/env node
/**
 * Workshop balance check: enumerates every combination of the four stations' tiles (4 × 3 × 27 × 27 =
 * 8,748 builds), scores each with js/workshop/cfd.js and prints the tables the plan and the README quote.
 * Exits 1 when an invariant breaks, so it doubles as a check:
 *
 *   node scripts/balance-workshop.mjs            # tables + invariants
 *   node scripts/balance-workshop.mjs --json     # the raw numbers for a spreadsheet
 *
 * Invariants (the game's promises to the room):
 *   1. The thoughtful build (private connectivity, rack-scale NVL72, London, liquid hall, smallest block
 *      that fits, GB200 small on NVLink) scores the cap, and every build at the cap is a sensible one.
 *   2. The inference trap (RTX PRO 6000) never beats a well-chosen FP64 build: its best is far below par.
 *   3. The biggest power block never beats the right-sized one when the smaller block already fits.
 *   4. The public internet never beats a private product with the same other choices.
 *   5. Every station moves the score: the best tile beats the worst tile at each station by a clear margin.
 */
import { pathToFileURL } from "node:url"
import { STATION_IDS, SEND_BACK_PENALTY, APPROVAL_FLOOR, RUNS_CAP, SCORE_FLOOR, evaluateWorkshop, stationById, scoreWorkshop } from "../js/workshop/cfd.js"
import { stationCombos } from "../js/workshop/readout.js"

const BEST = {
  connectivity: { product: "combo" },
  oems: { design: "nvl72-rack" },
  dcpower: { metro: "lon", cooling: "liquid", power: "block-0" },
  cfd: { gpu: "gb200", size: "small", fabric: "nvlink" },
}

/** Every complete build: the cross product of the four stations' combos. */
export function allBuilds() {
  let builds = [{}]
  for (const stationId of STATION_IDS) {
    const combos = stationCombos(stationId)
    builds = builds.flatMap((partial) => combos.map((combo) => ({ ...partial, [stationId]: combo })))
  }
  return builds
}

function key(build) {
  return STATION_IDS.map((id) => Object.values(build[id]).join("/")).join(" | ")
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function tileTitle(stationId, decisionId, tileId) {
  const decision = stationById(stationId).decisions.find((d) => d.id === decisionId)
  const tile = decision.tiles.find((t) => t.id === tileId)
  return (tile?.title || tileId).replace(/^[A-C] · /, "")
}

export function analyse() {
  const builds = allBuilds()
  const rows = builds.map((build) => {
    const result = evaluateWorkshop(build)
    return { build, key: key(build), score: result.score, runs: result.runs, power: result.power.state, trap: result.gpu.trap, overBudget: result.overBudget, late: result.lateWeeks > 0, result }
  })
  const scores = rows.map((row) => row.score).sort((a, b) => a - b)
  const failures = []

  /* 1. the cap and who reaches it */
  const bestScore = scoreWorkshop(BEST)
  const cap = Math.max(...scores)
  const atCap = rows.filter((row) => row.score === cap)
  if (bestScore !== cap) failures.push(`the thoughtful build scores ${bestScore}, the cap is ${cap}`)
  for (const row of atCap) {
    const c = row.build
    const sensible = c.cfd.gpu === "gb200" && c.cfd.fabric === "nvlink" && c.connectivity.product !== "public" && row.power === "green" && !row.overBudget && !row.late
    if (!sensible) failures.push(`a build at the cap is not a sensible one: ${row.key}`)
  }

  /* 2. the trap */
  const trapBest = Math.max(...rows.filter((row) => row.trap).map((row) => row.score))
  const fp64Median = percentile(
    rows.filter((row) => !row.trap).map((row) => row.score).sort((a, b) => a - b),
    50,
  )
  if (trapBest >= 400) failures.push(`the inference trap can score ${trapBest}`)

  /* 3. biggest block vs right-sized block, same other choices */
  let oversizedWins = 0
  let oversizedCases = 0
  const byOthers = new Map()
  for (const row of rows) {
    const others = `${row.key.replace(/\/block-\d/, "")}`
    if (!byOthers.has(others)) byOthers.set(others, {})
    byOthers.get(others)[row.build.dcpower.power] = row
  }
  for (const group of byOthers.values()) {
    if (!group["block-0"] || !group["block-2"]) continue
    if (group["block-0"].result.power.shortKW === 0) {
      oversizedCases += 1
      if (group["block-2"].score > group["block-0"].score) oversizedWins += 1
    }
  }
  if (oversizedWins) failures.push(`the biggest power block beat a right-sized one ${oversizedWins} times`)

  /* 4. public internet vs private */
  let publicWins = 0
  const byNet = new Map()
  for (const row of rows) {
    const others = STATION_IDS.filter((id) => id !== "connectivity").map((id) => Object.values(row.build[id]).join("/")).join(" | ")
    if (!byNet.has(others)) byNet.set(others, {})
    byNet.get(others)[row.build.connectivity.product] = row.score
  }
  for (const group of byNet.values()) {
    const privateBest = Math.max(group.fabric, group.fiber, group.combo)
    if (group.public > privateBest) publicWins += 1
  }
  if (publicWins) failures.push(`the public internet beat every private product ${publicWins} times`)

  /* 5. each station's swing: best tile set minus worst tile set, holding the other three at BEST */
  const swing = STATION_IDS.map((stationId) => {
    const scoresHere = stationCombos(stationId).map((combo) => ({ combo, score: scoreWorkshop({ ...BEST, [stationId]: combo }) }))
    const top = scoresHere.reduce((a, b) => (b.score > a.score ? b : a))
    const bottom = scoresHere.reduce((a, b) => (b.score < a.score ? b : a))
    return { station: stationById(stationId).name, combos: scoresHere.length, best: top.score, worst: bottom.score, worstCombo: Object.values(bottom.combo).join("/"), swing: top.score - bottom.score }
  })
  for (const row of swing) if (row.swing < 150) failures.push(`${row.station} barely moves the score (${row.swing} points)`)

  /* Per-tile table: the mean and the best score of every build that contains the tile. */
  const tiles = []
  for (const stationId of STATION_IDS) {
    for (const decision of stationById(stationId).decisions) {
      for (const tile of decision.tiles) {
        const with_ = rows.filter((row) => row.build[stationId][decision.id] === tile.id)
        const mean = Math.round(with_.reduce((sum, row) => sum + row.score, 0) / with_.length)
        const best = Math.max(...with_.map((row) => row.score))
        const green = Math.round((100 * with_.filter((row) => row.power === "green").length) / with_.length)
        tiles.push({ station: stationById(stationId).short, decision: decision.id, tile: tileTitle(stationId, decision.id, tile.id), id: tile.id, mean, best, green })
      }
    }
  }

  /* Send-backs: what one, two and five cost the thoughtful build. */
  const sendBacks = [0, 1, 2, 3, 5, 8].map((n) => ({ sendBacks: n, score: scoreWorkshop(BEST, { sendBacks: n }) }))

  return {
    builds: rows.length,
    summary: { min: scores[0], p25: percentile(scores, 25), median: percentile(scores, 50), p75: percentile(scores, 75), max: cap, atCap: atCap.length, floor: rows.filter((row) => row.score === SCORE_FLOOR).length, green: rows.filter((row) => row.power === "green").length, overBudget: rows.filter((row) => row.overBudget).length, late: rows.filter((row) => row.late).length },
    best: { key: key(BEST), score: bestScore },
    top: [...rows].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, 8).map((row) => ({ key: row.key, score: row.score, runs: row.runs })),
    trap: { best: trapBest, fp64Median },
    oversized: { cases: oversizedCases, wins: oversizedWins },
    publicWins,
    swing,
    tiles,
    sendBacks,
    constants: { RUNS_CAP, SEND_BACK_PENALTY, APPROVAL_FLOOR, SCORE_FLOOR },
    failures,
  }
}

function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)))
  const line = (cells) => `| ${cells.map((c, i) => String(c).padEnd(widths[i])).join(" | ")} |`
  return [line(headers), `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`, ...rows.map(line)].join("\n")
}

export function report(a) {
  const out = []
  out.push(`Workshop balance: ${a.builds.toLocaleString("en-GB")} builds (4 × 3 × 27 × 27)`)
  out.push("")
  out.push(table(["min", "p25", "median", "p75", "max", "at cap", "at floor", "power green", "over budget", "late"], [[a.summary.min, a.summary.p25, a.summary.median, a.summary.p75, a.summary.max, a.summary.atCap, a.summary.floor, a.summary.green, a.summary.overBudget, a.summary.late]]))
  out.push("")
  out.push(`Thoughtful build (${a.best.key}): ${a.best.score}`)
  out.push(`Inference trap (RTX PRO 6000) at its best: ${a.trap.best} · median FP64 build: ${a.trap.fp64Median}`)
  out.push(`Biggest block vs right-sized block, same other choices: ${a.oversized.wins} wins in ${a.oversized.cases} cases`)
  out.push(`Public internet vs private, same other choices: ${a.publicWins} wins`)
  out.push("")
  out.push("Top builds (connectivity | OEM design | metro/cooling/block | GPU/size/fabric):")
  out.push(table(["score", "runs/night", "build"], a.top.map((row) => [row.score, row.runs, row.key])))
  out.push("")
  out.push("Station swing (best tiles minus worst tiles, the other three stations at the thoughtful build):")
  out.push(table(["station", "combos", "best", "worst", "worst tiles", "swing"], a.swing.map((row) => [row.station, row.combos, row.best, row.worst, row.worstCombo, row.swing])))
  out.push("")
  out.push("Tiles (mean and best score over every build containing the tile; % of those builds with green power):")
  out.push(table(["station", "decision", "tile", "mean", "best", "green %"], a.tiles.map((row) => [row.station, row.decision, row.tile, row.mean, row.best, row.green])))
  out.push("")
  out.push(`Send-backs on the thoughtful build (−${Math.round(a.constants.SEND_BACK_PENALTY * 100)}% each, floor ×${a.constants.APPROVAL_FLOOR}): ${a.sendBacks.map((row) => `${row.sendBacks} → ${row.score}`).join(" · ")}`)
  out.push("")
  out.push(a.failures.length ? `FAILED invariants:\n- ${a.failures.join("\n- ")}` : "All invariants hold.")
  return out.join("\n")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const analysis = analyse()
  if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(analysis, (k, v) => (k === "result" ? undefined : v), 2)}\n`)
  else process.stdout.write(`${report(analysis)}\n`)
  process.exitCode = analysis.failures.length ? 1 : 0
}
