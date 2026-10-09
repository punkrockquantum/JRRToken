import { USE_CASES } from "../js/data.js"
import { evaluateBuild, formatMoney } from "../js/model.js"
import { allPresets, choicesToBuild, defaultChoices, expertChoices } from "../js/presets.js"

const money = (value) => formatMoney(value, 0)
const people = (fte) => Math.round(fte).toLocaleString("en-GB")
const rows = []

for (const useCase of USE_CASES) {
  const scored = allPresets(useCase.id).map((choices) => ({
    choices,
    result: evaluateBuild(useCase.id, choicesToBuild(useCase.id, choices)),
  })).sort((a, b) => b.result.score - a.result.score)
  const best = scored[0]
  const naive = evaluateBuild(useCase.id, choicesToBuild(useCase.id, { ...expertChoices(useCase.id), brains: "huge", wires: "cheap" }))
  const typical = evaluateBuild(useCase.id, choicesToBuild(useCase.id, defaultChoices(useCase.id)))
  const expert = evaluateBuild(useCase.id, choicesToBuild(useCase.id, expertChoices(useCase.id)))
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
