import { PLATFORMS, USE_CASES, byId } from "../js/data.js"
import { evaluateBuild, formatMoney } from "../js/model.js"
import { allPresets, allSimple, choicesToBuild, defaultChoices, expertChoices, simpleTiles, simpleToChoices } from "../js/presets.js"

const money = (value) => formatMoney(value, 0)
const people = (fte) => Math.round(fte).toLocaleString("en-GB")
const rows = []

/* ---------- The simple board: 3 GPUs × 3 halls × 3 connections × 3 memory/data tiles ---------- */

console.log("Simple board (nerd off): naive = Vera Rubin + air + public internet, maxed = last tile of every row, typical = opening picture, best = top of the 81 tiles")
console.log("\n| Story | Naive | Maxed | Typical | Best | Best tiles | Within 2% | Near-misses (wrong hall / wire) |")
console.log("|---|---:|---:|---:|---:|---|---:|---|")
const bests = {}
for (const useCase of USE_CASES) {
  const id = useCase.id
  const simple = (combo) => evaluateBuild(id, choicesToBuild(id, simpleToChoices(id, combo), false))
  const scored = allSimple(id).map((combo) => ({ combo, result: simple(combo) })).sort((a, b) => b.result.score - a.result.score)
  const best = scored[0]
  const near = scored.filter((item) => item.result.score >= best.result.score * 0.98)
  const tiles = simpleTiles(id)
  const label = (row, key) => tiles[row].find((tile) => tile.id === key)?.label || key
  const naive = simple({ brains: "rubin", hall: "cool", wires: "cheap", data: "off" }).score
  const maxed = simple({ brains: "rubin", hall: "plus", wires: "fast", data: "plus" }).score
  const typical = simple({ brains: "medium", hall: "cool", wires: "peer", data: "off" }).score
  const b = best.combo
  const misses = scored.filter((item) => item.combo.brains === b.brains && item.combo.data === b.data && ((item.combo.hall !== b.hall) !== (item.combo.wires !== b.wires)))
  const tilesLine = `${label("brains", b.brains)} · ${label("halls", b.hall)} · ${label("wires", b.wires)} · ${label("data", b.data)}`
  bests[id] = choicesToBuild(id, simpleToChoices(id, b), false)
  console.log(`| ${useCase.name} | ${naive} | ${maxed} | ${typical} | ${best.result.score} | ${tilesLine} | ${near.length} | ${misses.map((item) => `${item.combo.hall}/${item.combo.wires} ${item.result.score}`).join(", ")} |`)
}

console.log("\nChecks: best 1,400 and alone within 2%; maxed ≤ 300; naive 0; a near-miss in 700–1,100; optima differ in ≥ 2 of 4 decisions between any two stories")
const ids = USE_CASES.map((item) => item.id)
const fingerprint = (build) => [`${build.platform}x${build.racks}`, `${build.hall}/${build.sites.length}`, build.choices.wires, `${build.data}/${build.kv}/${build.hosts}/${build.orca}`]
for (let i = 0; i < ids.length; i += 1) {
  for (let j = i + 1; j < ids.length; j += 1) {
    const a = fingerprint(bests[ids[i]])
    const c = fingerprint(bests[ids[j]])
    const differ = a.filter((part, index) => part !== c[index]).length
    console.log(`  ${ids[i]} vs ${ids[j]}: ${differ} of 4 decisions differ${differ < 2 ? "  <-- too alike" : ""}`)
  }
}

console.log("\nSimple board, every tile set (GPU / hall / connection / memory-data → score)")
for (const useCase of USE_CASES) {
  const id = useCase.id
  const line = allSimple(id)
    .map((combo) => `${combo.brains}/${combo.hall}/${combo.wires}/${combo.data} ${evaluateBuild(id, choicesToBuild(id, simpleToChoices(id, combo), false)).score}`)
    .join(", ")
  console.log(`  ${id}: ${line}`)
}

/* ---------- The nerd board: every picture preset, built in nerd mode ---------- */

console.log("\nNerd board (every picture preset)")
for (const useCase of USE_CASES) {
  const scored = allPresets(useCase.id).map((choices) => ({
    choices,
    result: evaluateBuild(useCase.id, choicesToBuild(useCase.id, choices, true)),
  })).sort((a, b) => b.result.score - a.result.score)
  const best = scored[0]
  const naive = evaluateBuild(useCase.id, choicesToBuild(useCase.id, { ...expertChoices(useCase.id), brains: "huge", wires: "cheap" }, true))
  const typical = evaluateBuild(useCase.id, choicesToBuild(useCase.id, defaultChoices(useCase.id), true))
  const expert = evaluateBuild(useCase.id, choicesToBuild(useCase.id, expertChoices(useCase.id), true))
  const near = scored.filter((item) => item.result.score >= best.result.score * 0.9)
  rows.push({ useCase, best, naive, typical, expert, near })
  const r = best.result
  console.log(`\n${useCase.name}`)
  console.log(`  best ${r.score} · ${JSON.stringify(best.choices)}`)
  console.log(`  people ${people(r.fteEquivalent)} · hours ${Math.round(r.humanHoursPerYear).toLocaleString("en-GB")} · saving ${money(r.annualSavings)}/year`)
  console.log(`  expert ${expert.score} · typical ${typical.score} · naive ${naive.score} · ${near.length} pictures within 10%`)
}

console.log("\n| Story | Naive | Typical | Best | People | Saving / year | Within 10% |")
console.log("|---|---:|---:|---:|---:|---:|---:|")
for (const { useCase, best, naive, typical, near } of rows) {
  const r = best.result
  console.log(`| ${useCase.name} | ${naive.score} | ${typical.score} | ${r.score} | ${people(r.fteEquivalent)} | ${money(r.annualSavings)} | ${near.length} |`)
}

console.log("\nVera Rubin NVL72 ×1 (liquid hall, one metro) and connection order on the expert picture")
for (const { useCase, best } of rows) {
  const id = useCase.id
  const rubin = evaluateBuild(id, choicesToBuild(id, { ...expertChoices(id), brains: "rubin", home: "super", cities: 1 }, true))
  const wires = ["cheap", "peer", "fast", "private"].map((wires) => [wires, evaluateBuild(id, choicesToBuild(id, { ...expertChoices(id), wires }, true)).score])
  const order = [...wires].sort((a, b) => a[1] - b[1]).map(([name, score]) => `${name} ${score}`).join(" < ")
  console.log(`  ${id}: rubin ${rubin.score} (${Math.round((rubin.score / best.result.score) * 100)}% of best, live week ${Math.ceil(rubin.liveWeeks)}) · ${order}`)
}

console.log("\nMulti-site deltas (best picture at each metro count)")
for (const { useCase, best } of rows) {
  const byCities = new Map()
  for (const item of allPresets(useCase.id).map((choices) => ({ choices, result: evaluateBuild(useCase.id, choicesToBuild(useCase.id, choices, true)) }))) {
    const count = item.choices.cities || 1
    if (!byCities.has(count) || item.result.score > byCities.get(count).result.score) byCities.set(count, item)
  }
  const one = byCities.get(1)
  const many = [...byCities.entries()].filter(([count]) => count >= 2).sort((a, b) => b[1].result.score - a[1].result.score)[0]
  if (!many) {
    const partner = useCase.id === "research" ? "par" : "fra"
    const two = evaluateBuild(useCase.id, { ...choicesToBuild(useCase.id, best.choices, true), sites: ["lon", partner] })
    console.log(`  ${useCase.id}: 1 site ${one.result.score} >= 2 sites ${two.score} (data gravity)`)
    continue
  }
  const gap = ((many[1].result.score / one.result.score - 1) * 100).toFixed(1)
  console.log(`  ${useCase.id}: ${many[0]} sites ${many[1].result.score} vs 1 site ${one.result.score} (${gap}%)`)
}

console.log("\nPer-site designer grid (coarse, on the nerd best)")
for (const id of ["chat", "code", "robot"]) {
  const row = rows.find((item) => item.useCase.id === id)
  const build = choicesToBuild(id, row.best.choices, true)
  const platform = byId(PLATFORMS, build.platform)
  const rackMW = platform.rackKW / 1000
  const [a, b] = build.sites
  const base = row.best.result.score
  const designs = [
    ["even inference", [{ id: a, role: "inference", powerMW: rackMW }, { id: b, role: "inference", powerMW: rackMW }]],
    ["big inference + edge", [{ id: a, role: "inference", powerMW: rackMW * 2 }, { id: b, role: "edge", powerMW: 0.01 }]],
    ["edge, tiny power", [{ id: a, role: "inference", powerMW: rackMW * 2 }, { id: b, role: "edge", powerMW: 0.005 }]],
    ["inference + training", [{ id: a, role: "inference", powerMW: rackMW * 2 }, { id: b, role: "training", powerMW: rackMW * 0.3 }]],
    ["split 70/30", [{ id: a, role: "inference", powerMW: rackMW * 1.4 }, { id: b, role: "inference", powerMW: rackMW * 0.6 }]],
  ]
  let winner = { name: "nerd best", score: base }
  console.log(`  ${id} nerd best ${base}`)
  for (const [name, sitePlans] of designs) {
    const score = evaluateBuild(id, { ...build, sitePlans }).score
    const gap = ((score / base - 1) * 100).toFixed(1)
    console.log(`    ${name}: ${score} (${gap}%)`)
    if (score > winner.score) winner = { name, score }
  }
  const margin = ((winner.score / base - 1) * 100).toFixed(1)
  console.log(`    winner: ${winner.name} ${winner.score} (${margin}% over nerd best)`)
}
