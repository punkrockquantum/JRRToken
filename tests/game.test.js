import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { maxedBuild, searchBuilds, typicalBuild } from "../js/balance.js"
import { DOES, ORCA, USE_CASES } from "../js/data.js"
import { evaluateBuild } from "../js/model.js"
import { allPresets, choicesToBuild, defaultChoices, expertChoices } from "../js/presets.js"
import { blockedReason, peopleLead, savingsLine } from "../js/results.js"
import { plainCoach } from "../js/coach.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const main = readFileSync(join(root, "js/main.js"), "utf8")

test("balance: naive scores zero, a typical first try is mid-table, and a thoughtful build wins", () => {
  for (const useCase of USE_CASES) {
    const list = searchBuilds(useCase.id)
    const best = list[0].result
    const naive = evaluateBuild(useCase.id, maxedBuild(useCase.id))
    const typical = evaluateBuild(useCase.id, typicalBuild(useCase.id))
    assert.equal(naive.score, 0, `${useCase.id}: max racks of the newest GPU busts the budget`)
    assert.ok(naive.overBudget && (naive.overPower || naive.lateWeeks > 0), `${useCase.id}: naive also busts power or the deadline`)
    assert.ok(naive.profit < 0, useCase.id)
    assert.ok(typical.score > 0 && typical.score < best.score, useCase.id)
    assert.ok(best.score >= 1390 && best.score <= 1470, `${useCase.id} engine best ${best.score} stays within 5% of the simple board`)
    assert.ok(best.profit > 0, `${useCase.id}: a good build is profitable`)
    assert.ok(!best.overBudget && !best.overPower, useCase.id)
    const siteCount = (item) => (item.build.sites || []).length
    if (["chat", "code", "robot"].includes(useCase.id)) {
      const multi = list.find((item) => siteCount(item) >= 2)
      const single = list.find((item) => siteCount(item) === 1)
      assert.ok(multi.result.score > single.result.score * 1.1, `${useCase.id} multi ${multi.result.score} vs single ${single.result.score}`)
    } else {
      const partner = useCase.id === "research" ? "par" : "fra"
      const two = evaluateBuild(useCase.id, { ...list[0].build, sites: [list[0].build.sites[0], partner] })
      assert.ok(best.score >= two.score, `${useCase.id} one site ${best.score} vs two ${two.score}`)
    }
  }
})

test("expert tricks: Vera Rubin only pays when the deadline allows, ORCA only pays for drug discovery", () => {
  for (const useCase of USE_CASES) {
    const best = searchBuilds(useCase.id)[0]
    if (useCase.id === "research") {
      assert.equal(best.build.platform, "gb200", "dense NVFP4 and the higher rack price make GB200 the research winner")
      const rubin = searchBuilds("research").find((item) => item.build.platform === "vr")
      assert.equal(rubin.result.lateWeeks, 0, "Vera Rubin still arrives inside the long research deadline")
      assert.ok(best.result.score > rubin.result.score)
    } else assert.notEqual(best.build.platform, "vr", `${useCase.id}: Vera Rubin arrives too late`)
    if (useCase.id === "chat") {
      assert.equal(best.result.lateWeeks, 0, "the best chat build goes live on time")
      const lateGb300 = searchBuilds("chat").find((item) => item.build.platform === "gb300")
      assert.ok(best.result.score >= lateGb300.result.score, "an on-time chat build matches or beats a late GB300")
    }
  }
  const drug = searchBuilds("drug")
  assert.equal(drug[0].build.orca, true)
  assert.ok(drug[0].result.score > drug.find((item) => !item.build.orca).result.score)
  for (const useCase of USE_CASES.filter((item) => !item.orca)) {
    const base = searchBuilds(useCase.id)[0].build
    assert.equal(evaluateBuild(useCase.id, { ...base, orca: true }).orcaCapex, 0, `${useCase.id} cannot buy ORCA`)
  }
})

test("picture presets map onto builds, and the preset board stays in the scoring band", () => {
  /* The nerd board is the full tile set; the simple board snaps every step onto its three tiles. */
  const nerd = (id, choices) => choicesToBuild(id, choices, true)
  const chat = nerd("chat", expertChoices("chat"))
  assert.equal(chat.platform, "gb200")
  assert.equal(chat.racks, 2)
  assert.equal(chat.kv, true)
  assert.equal(chat.data, "local")
  assert.equal(nerd("rag", expertChoices("rag")).data, "vector", "the RAG expert picks the vector index")
  assert.equal(choicesToBuild("rag", { ...expertChoices("rag"), library: "basic" }).data, "file", "storage is a real step on the simple board")
  assert.equal(choicesToBuild("rag", { ...expertChoices("rag"), library: "none" }).data, "local", "no index is a real simple-board choice")
  assert.equal(nerd("rag", { ...expertChoices("rag"), library: "none" }).data, "local", "nerd mode exposes storage")
  assert.equal(choicesToBuild("chat", { ...expertChoices("chat"), library: "smart" }).data, "vector", "chat can waste money on an index it never searches")
  assert.equal(chat.hall, "B")
  assert.equal(chat.routes.users.kind, "fabric")
  assert.equal(nerd("chat", { brains: "huge" }).platform, "vr")
  assert.equal(nerd("chat", { brains: "huge" }).racks, 4)
  assert.equal(choicesToBuild("chat", { brains: "huge" }).racks, 2, "the simple board snaps HUGE onto the big tile")
  assert.equal(choicesToBuild("chat", { wires: "cheap" }).routes.users.kind, "public")
  assert.equal(choicesToBuild("drug", { helper: true }).orca, true)
  assert.equal(choicesToBuild("chat", { helper: true }).orca, false)
  assert.match(main, /nerd: false/)
  assert.match(main, /const nerdLine = state\.nerd && stepId !== "wires" && stepId !== "gpu" && stepId !== "model" \? selected\?\.nerd \|\| "" : ""/)
  assert.match(main, /stepId === "gpu" && state\.nerd \? refarchPanel\(result, selected\) : null/, "the nerd GPU step shows the reference architectures")
  assert.match(main, /const impact = stepId === "wires" \? wireImpact\(id, choices, tile\.id, state\.nerd\) : null/)
  assert.match(main, /extra: impact \? impactStrip\(impact, tile\.id\) : null/)
  for (const useCase of USE_CASES) {
    const scored = allPresets(useCase.id).map((choices) => ({
      choices,
      result: evaluateBuild(useCase.id, nerd(useCase.id, choices)),
    })).sort((a, b) => b.result.score - a.result.score)
    const best = scored[0].result
    const expert = evaluateBuild(useCase.id, nerd(useCase.id, expertChoices(useCase.id)))
    const typical = evaluateBuild(useCase.id, nerd(useCase.id, defaultChoices(useCase.id)))
    const huge = evaluateBuild(useCase.id, nerd(useCase.id, { ...expertChoices(useCase.id), brains: "huge" }))
    assert.equal(huge.score, 0, `${useCase.id} huge`)
    assert.ok(huge.overBudget, useCase.id)
    assert.ok(typical.score >= 0 && typical.score <= 1200 && typical.score < best.score * 0.8, `${useCase.id} typical ${typical.score}`)
    assert.ok(best.score >= 1390 && best.score <= 1430, `${useCase.id} preset best ${best.score}`)
    const near = scored.filter((item) => item.result.score >= best.score * 0.83)
    assert.ok(near.length >= 2, `${useCase.id} near ${near.length}`)
    if (useCase.id === "chat" || useCase.id === "rag" || useCase.id === "code") {
      assert.ok(expert.score >= 1390 && expert.score <= 1430, `${useCase.id} expert ${expert.score}`)
    } else {
      assert.ok(expert.score >= best.score * 0.9, `${useCase.id} expert ${expert.score} vs ${best.score}`)
    }
    assert.ok(expert.fteEquivalent > typical.fteEquivalent, useCase.id)
    const hugeSave = huge.annualSavings
    const bestSave = best.annualSavings
    assert.ok(hugeSave < bestSave, `${useCase.id} huge saving ${hugeSave} vs best ${bestSave}`)
    assert.ok(hugeSave > -5e9, `${useCase.id} huge loss ${hugeSave} is past a few billion`)
    assert.ok(best.fteEquivalent >= 200 && best.fteEquivalent <= 25_000, `${useCase.id} people ${best.fteEquivalent}`)
    assert.ok(best.annualSavings > 50e6 && best.annualSavings < 3e9, `${useCase.id} saving ${best.annualSavings}`)
    const samples = [
      expert,
      typical,
      huge,
      evaluateBuild(useCase.id, nerd(useCase.id, { ...expertChoices(useCase.id), brains: "small" })),
    ]
    const factors = new Set(samples.map((item) => item.savingsFactor.toFixed(2)))
    assert.ok(factors.size >= 3, `${useCase.id} factors ${[...factors].join(",")}`)
    assert.ok([...factors].every((factor) => Number(factor) >= 0.6 && Number(factor) <= 1.5))
  }
  assert.doesNotMatch(main, /billion people/i)
  assert.doesNotMatch(main, /more than people would/)
  assert.match(main, /= \$\{peopleCount\(fte\)\} people/)
  assert.match(main, /"OVER BUDGET"/)
  assert.match(main, /class: "learn-btn"/)
  assert.match(main, /function openLearn/)
  const steps = readFileSync(join(root, "js/steps.js"), "utf8")
  for (const line of [
    "Which Digital Realty metros",
    "The computers that run the AI",
    "How the racks are cooled",
    "What the GPUs remember between turns",
    "How answers and data travel",
    "Where documents and checkpoints live",
    "A quantum helper beside the GPUs",
    "NVIDIA ${platform?.name || pick.platform} ×${pick.racks}",
    "the classic, runs on air",
    "strongest rack on air",
    "72 GPUs as one, liquid",
    "next gen, liquid, arrives late",
    "KV cache OFF",
    "KV cache ON",
    "KV cache ON + CPU host memory",
    "Local only",
    "File & object",
    "Vector index",
    "Air-cooled hall",
    "Rear-door hall",
    "Liquid-cooled hall",
    "Direct liquid cooling",
    "Rear door heat exchanger",
    "Public internet",
    "cheap, busy, slow at peaks",
    "Peering + eyeballs",
    "straight into home networks",
    "ServiceFabric",
    "private lane, fast and steady",
    "Cross connect + Dark fiber",
    "your own glass in the building and between sites",
    "Users: ${km(offer.usersKm)} · Data: ${km(offer.dataKm)}",
    "Farthest users: ",
    "ORCA PT-3",
    "photonic quantum accelerator",
    "72 GPUs joined by NVLink act as one giant GPU.",
    "finds strong binders about twice as often",
  ]) assert.ok(steps.includes(line), line)
  for (const line of ["Let an agent configure it", "MCP ON", "USERS ", "MODEL & DATA ", "NEW STORY", "Game numbers are estimates."]) assert.ok(main.includes(line), line)
  const page = readFileSync(join(root, "index.html"), "utf8")
  assert.match(page, /id="nerd-bar"/)
  assert.match(page, /aria-pressed="false"/)
  assert.match(main, /function toggleNerd/)
  assert.match(main, /getElementById\("nerd-bar"\)/)
  const cheapChat = evaluateBuild("chat", nerd("chat", { ...expertChoices("chat"), wires: "cheap" }))
  const cheapCode = evaluateBuild("code", nerd("code", { ...expertChoices("code"), wires: "cheap" }))
  assert.ok(cheapChat.coverage < 0.5 && cheapCode.coverage < 0.5)
})

test("an unaffordable build says why and does not claim the saving; an affordable one is unchanged", () => {
  for (const useCase of USE_CASES) {
    const huge = evaluateBuild(useCase.id, choicesToBuild(useCase.id, { ...expertChoices(useCase.id), brains: "huge" }, true))
    const blocked = blockedReason(huge)
    assert.equal(huge.score, 0, useCase.id)
    assert.equal(blocked.kind, "budget", useCase.id)
    assert.match(blocked.text, /^You can't afford this: about \$[\d.]+M over budget$/, useCase.id)
    const saving = savingsLine(huge)
    assert.doesNotMatch(saving, /^Saving about/, useCase.id)
    assert.match(saving, /^If you could pay for it, it would save about \$[\d.]+ (million|billion) a year$|^Costs about /, useCase.id)
    assert.match(peopleLead(huge), /^Your factory would do the work of about [\d,]+ people$/)
    assert.equal(plainCoach(huge), "Too many GPUs for your wallet: the money runs out before the hall pays off.")

    const best = evaluateBuild(useCase.id, choicesToBuild(useCase.id, expertChoices(useCase.id)))
    assert.equal(blockedReason(best), null, useCase.id)
    assert.match(savingsLine(best), /^Saving about \$[\d.]+ (million|billion) a year after paying for the factory$/)
    assert.match(peopleLead(best), /^Your factory does the work of about [\d,]+ people$/)
  }
  const late = { ok: true, overBudget: false, overPower: false, score: 0, lateWeeks: 3.2, annualSavings: 1e8 }
  assert.equal(blockedReason(late).text, "Launched 4 weeks late")
  assert.match(savingsLine(late), /^If it launched on time, it would save about/)
  const hot = { ok: true, overBudget: false, overPower: true, score: 0, lateWeeks: 0, annualSavings: 1e8 }
  assert.equal(blockedReason(hot).text, "Too much power for this hall")
  assert.equal(blockedReason({ ...hot, score: 120 }), null, "power that has not floored the score is only a warning")
  assert.match(savingsLine({ ok: true, overBudget: true, finance: 1e6, annualSavings: -3e8 }), /^Costs about \$300M more than it saves each year$/)
})

test("the game screen never shows ORCA's price", () => {
  assert.doesNotMatch(main, /ORCA\.capex|orcaCapex|result\.capex\b|hardwareCapex/)
  assert.doesNotMatch(`${ORCA.learn} ${DOES.orca}`, /\$|5,000,000|5M\b/)
  assert.match(main, /budgetSpend/)
})

test("one game screen with a step rail, and the sync wiring is in place", () => {
  assert.doesNotMatch(main, /FLOW = \[|usecase:|compute:/)
  assert.match(main, /function rail\(stepId\)/)
  assert.match(main, /STEPS\.map\(\(step, index\) =>/)
  assert.match(main, /screens = \{ title: titleScreen, intro: introScreen, stories: storyScreen, game: gameScreen \}/)
  for (const key of ["budget", "power", "golive", "speed", "demand", "cost"]) assert.match(main, new RegExp(`key: "${key}"`))
  assert.match(main, /recordAttempt\(payload\)\.then/)
  assert.match(main, /fetchLeague\(\)\.then/)
  assert.match(main, /consentAt = consent\.checked \? new Date\(\)\.toISOString\(\) : ""/)
  assert.match(main, /"\/api\/export\.xlsx", \{ headers: \{ "X-Staff-Pin"/)
  assert.match(main, /"\/api\/reset", \{ method: "POST"/)
  assert.match(main, /fetch\("\/api\/health"/)
})
