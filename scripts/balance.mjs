import { PLATFORMS, SITES, USE_CASES, byId } from "../js/data.js"
import { ecosystem } from "../js/eco.js"
import { evaluateBuild, formatMoney } from "../js/model.js"
import { allPresets, choicesToBuild, defaultChoices, expertChoices, metroSets } from "../js/presets.js"
import { allSimple, describeChoices, metroShortList, stepTiles, stepValue } from "../js/steps.js"

const money = (value) => formatMoney(value, 0)
const people = (fte) => Math.round(fte).toLocaleString("en-GB")
const rows = []
const metroName = (id) => byId(SITES, id)?.metro || id
const metros = (choices) => (choices.metros || []).map(metroName).join("+")

/* ---------- The simple board: every metro set × 3 GPUs × 3 halls × 3 memory × 3 connections × 3 storage × QPU ---------- */

console.log("Simple board (nerd off): naive = Vera Rubin + air + public internet on the home metro, maxed = widest metro set + the last tile of every step, typical = opening picture, best = top of the whole simple space")
console.log("\n| Story | Combos | Naive | Maxed | Typical | Best | Best tiles | Within 2% | Location near-misses (best per metro set) |")
console.log("|---|---:|---:|---:|---:|---:|---|---:|---|")
const bests = {}
const lights = (result) => ecosystem(result).map((part) => part.state[0].toUpperCase()).join("")
for (const useCase of USE_CASES) {
  const id = useCase.id
  const simple = (choices) => evaluateBuild(id, choicesToBuild(id, choices, false))
  const scored = allSimple(id).map((choices) => ({ choices, result: simple(choices) })).sort((a, b) => b.result.score - a.result.score)
  const best = scored[0]
  const near = scored.filter((item) => item.result.score >= best.result.score * 0.98)
  const home = defaultChoices(id).metros
  const widest = metroSets(id, metroShortList(id)).reduce((a, b) => (b.length > a.length ? b : a))
  const naive = simple({ ...defaultChoices(id), metros: home, brains: "rubin", home: "cool", wires: "cheap", memory: false, library: "none" }).score
  const maxed = simple({ ...defaultChoices(id), metros: widest, brains: "rubin", home: "super", wires: "fast", memory: true, hosts: "grace", library: "smart", helper: Boolean(useCase.orca) }).score
  const typical = simple(defaultChoices(id)).score
  const byMetros = new Map()
  for (const item of scored) {
    const key = (item.choices.metros || []).join("+")
    if (!byMetros.has(key)) byMetros.set(key, item)
  }
  const locationMisses = [...byMetros.values()].filter((item) => item !== best).map((item) => `${metros(item.choices)} ${item.result.score}`).join(", ")
  bests[id] = choicesToBuild(id, best.choices, false)
  console.log(`| ${useCase.name} | ${scored.length} | ${naive} | ${maxed} | ${typical} | ${best.result.score} | ${describeChoices(id, best.choices)} | ${near.length} | ${locationMisses} |`)
}

console.log("\nChecks: best 1,400 and 1-2 within 2%; maxed ≤ 300; naive 0; a near-miss in 700–1,100; optima differ in ≥ 2 of 5 decisions between any two stories")
for (const useCase of USE_CASES) {
  const id = useCase.id
  const simple = (choices) => evaluateBuild(id, choicesToBuild(id, choices, false))
  const scored = allSimple(id).map((choices) => ({ choices, result: simple(choices) })).sort((a, b) => b.result.score - a.result.score)
  const b = scored[0].choices
  const same = (a, key) => JSON.stringify(stepValue(id, key, a)) === JSON.stringify(stepValue(id, key, b))
  const misses = scored.filter((item) => {
    const diff = ["location", "gpu", "cooling", "memory", "wires", "storage", "qpu"].filter((key) => !same(item.choices, key))
    return diff.length === 1
  })
  const inBand = misses.filter((item) => item.result.score >= 700 && item.result.score <= 1100)
  const threeStar = misses.filter((item) => item.result.score >= 1350)
  console.log(`  ${id}: ${misses.length} one-step misses, ${inBand.length} in 700–1,100, ${threeStar.length} still three stars${threeStar.length ? ` (${threeStar.map((item) => `${describeChoices(id, item.choices)} ${item.result.score}`).join("; ")})` : ""}`)
}
const ids = USE_CASES.map((item) => item.id)
const fingerprint = (build) => [build.sites.join("+"), `${build.platform}x${build.racks}`, build.hall, `${build.kv}/${build.hosts}`, build.choices.wires, `${build.data}/${build.orca}`]
for (let i = 0; i < ids.length; i += 1) {
  for (let j = i + 1; j < ids.length; j += 1) {
    const a = fingerprint(bests[ids[i]])
    const c = fingerprint(bests[ids[j]])
    const differ = a.filter((part, index) => part !== c[index]).length
    console.log(`  ${ids[i]} vs ${ids[j]}: ${differ} of 6 decisions differ${differ < 2 ? "  <-- too alike" : ""}`)
  }
}

console.log("\nEcosystem lights on the simple space (P/C/C/D/C = power, cooling, compute, data, connections; G green, A amber, R red)")
for (const useCase of USE_CASES) {
  const id = useCase.id
  const counts = {}
  for (const choices of allSimple(id)) {
    const key = lights(evaluateBuild(id, choicesToBuild(id, choices, false)))
    counts[key] = (counts[key] || 0) + 1
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, n]) => `${key} ×${n}`).join(", ")
  console.log(`  ${id}: ${top}`)
}

console.log("\nLocation step: each metro on the short list with the rest of the build at the story's best")
for (const useCase of USE_CASES) {
  const id = useCase.id
  const best = bests[id].choices
  const line = stepTiles(id, "location").map((tile) => {
    const score = evaluateBuild(id, choicesToBuild(id, { ...best, metros: [tile.id] }, false)).score
    return `${tile.label} ${score} (${tile.hint})`
  }).join(" · ")
  console.log(`  ${id}: ${line}`)
}

/* ---------- The nerd board: every picture preset, built in nerd mode ---------- */

console.log("\nNerd board (every picture preset on the expert's metros)")
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
  console.log(`  best ${r.score} · ${describeChoices(useCase.id, best.choices)}`)
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
  const one = expertChoices(id).metros.slice(0, 1)
  const rubin = evaluateBuild(id, choicesToBuild(id, { ...expertChoices(id), brains: "rubin", home: "super", metros: one }, true))
  const wires = ["cheap", "peer", "fast", "private"].map((wires) => [wires, evaluateBuild(id, choicesToBuild(id, { ...expertChoices(id), wires }, true)).score])
  const order = [...wires].sort((a, b) => a[1] - b[1]).map(([name, score]) => `${name} ${score}`).join(" < ")
  console.log(`  ${id}: rubin ${rubin.score} (${Math.round((rubin.score / best.result.score) * 100)}% of best, live week ${Math.ceil(rubin.liveWeeks)}) · ${order}`)
}

console.log("\nPer-site designer grid (coarse, on the nerd best)")
for (const id of ["chat", "code", "robot"]) {
  const row = rows.find((item) => item.useCase.id === id)
  const build = choicesToBuild(id, row.best.choices, true)
  if (build.sites.length < 2) {
    console.log(`  ${id}: the nerd best uses one metro`)
    continue
  }
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
