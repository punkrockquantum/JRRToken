import assert from "node:assert/strict"
import test from "node:test"
import { coach } from "../js/coach.js"
import { DATA_TIERS, FTE_HOURS, HALLS, HORIZON_WEEKS, HUMAN_WORK, KV_TIER, METRO_OFFERS, NETWORKS, ORCA, PLATFORMS, PRICE_NOTE, USE_CASES, byId } from "../js/data.js"
import { boardHtml, leagueCsv, leagueJson, ordinal, rankOf, rivalFor, sortLeague, upsertEntry } from "../js/league.js"
import {
  LATE_FLOOR,
  LATE_PER_WEEK,
  POWER_PRICE,
  STAR_POINTS,
  blendScore,
  evaluateBuild,
  peoplePower,
  savingsFactorFor,
  formatMoney,
  lossPhrase,
  linkEligibility,
  linkProfile,
  networkDelay,
  orcaHitMult,
  planErrors,
  scenarioFor,
  selectionDelta,
  stars,
} from "../js/model.js"
import {
  FABRIC_SPEEDS,
  LEAD_DAYS,
  NET_PRICES,
  OUTAGE_HAIRCUT,
  PORT_SPEEDS,
  mcpPropose,
  networkBill,
} from "../js/network.js"
import { SYNERGY_CAP, capSynergy, legEligibility } from "../js/routes.js"
import { normalizeEmail, validateEmail, validateName } from "../js/names.js"

const fabric = (overrides = {}) => ({ port: 10, vc: 1, dest: "internet", layer: "l2", redundant: true, ...overrides })
const build = (overrides = {}) => ({
  hall: "B",
  platform: "vr",
  racks: 1,
  data: "file",
  kv: false,
  orca: false,
  graphs: "large",
  network: "fabric",
  fabric: fabric(),
  ...overrides,
})

test("money is shown in dollars, with no credit wording", () => {
  assert.equal(formatMoney(1_200_000), "$1.2M")
  assert.equal(formatMoney(2_750_000), "$2.75M")
  assert.equal(formatMoney(-2_510_000), "-$2.51M")
  assert.equal(formatMoney(450_000), "$450k")
  assert.equal(formatMoney(12.4), "$12")
  assert.equal(formatMoney(-40), "-$40")
  assert.equal(formatMoney(0.0594, 3), "$0.059")
  assert.match(leagueCsv([]), /^name,email,score,useCase,costPerM,at,consent,consentAt/)
  assert.doesNotMatch(leagueCsv([]), /CR|credit/i)
})

test("the roster runs from the L40S to Vera Rubin and the halls differ in cooling, space, and power", () => {
  assert.deepEqual(PLATFORMS.map((p) => p.id), ["l40s", "rtx6000", "h100", "h200", "b200", "b300", "b300n", "gb200", "gb300", "vr"])
  const rtx = byId(PLATFORMS, "rtx6000")
  assert.deepEqual([rtx.hbmGB, rtx.hbmTBs, rtx.pflops, rtx.precision, rtx.domain, rtx.cooling, rtx.gpusPerRack], [96, 1.6, 2, "FP4", 8, "air", 16], "RTX PRO 6000 Blackwell Server Edition: 96 GB GDDR7 at 1.6 TB/s, FP4, PCIe")
  const l40s = byId(PLATFORMS, "l40s")
  assert.deepEqual([l40s.hbmGB, l40s.hbmTBs, l40s.precision, l40s.cooling], [48, 0.864, "FP8", "air"], "L40S: 48 GB GDDR6 at 864 GB/s, no FP4")
  const node = byId(PLATFORMS, "b300n")
  assert.deepEqual([node.gpusPerRack, node.hbmGB, node.capex * 2, node.tokPerGpu], [8, 288, byId(PLATFORMS, "b300").capex, byId(PLATFORMS, "b300").tokPerGpu], "one HGX B300 node is half the rack")
  assert.ok(PLATFORMS.every((p) => /^(L40S|RTX PRO|HGX|GB[23]00|Vera Rubin)/.test(p.name)), "NVIDIA only")
  const rubin = byId(PLATFORMS, "vr")
  assert.equal(rubin.name, "Vera Rubin NVL72")
  assert.equal(rubin.pflops, 35)
  assert.equal(rubin.rackKW, 210)
  assert.equal(rubin.gpusPerRack, 72)
  assert.equal(rubin.domain, 72)
  assert.equal(byId(PLATFORMS, "b300").rackKW, 30)
  assert.equal(byId(PLATFORMS, "gb300").capex, 4_200_000)
  assert.equal(byId(HALLS, "B").maxRackKW, 240)
  assert.equal(ORCA.name, "ORCA PT-3")
  assert.equal(ORCA.kw, 6)
  assert.equal(ORCA.space, 2)
  assert.ok(PLATFORMS.filter((p) => p.domain === 72).every((p) => p.cooling === "liquid"))
  assert.deepEqual(HALLS.map((h) => h.cooling), ["air", "air", "air", "liquid"])
  assert.deepEqual(HALLS.map((h) => h.rackSpace), [24, 18, 20, 12])
  assert.deepEqual(HALLS.map((h) => h.fitOutWeeks), [0, 6, 4, 10])
  assert.ok(!USE_CASES.some((u) => /train/i.test(u.name)))
})

test("score is efficiency times a bounded people-power savings factor", () => {
  for (const useCase of USE_CASES) {
    const r = evaluateBuild(useCase.id, build({ orca: Boolean(useCase.orca), sites: undefined }))
    assert.equal(r.ok, true, useCase.id)
    const expected = blendScore({
      par: useCase.parCost,
      coverage: r.coverage,
      slaFactor: r.slaFactor,
      launchFactor: r.launchFactor,
      costPerM: r.costPerM,
      savingsFactor: r.savingsFactor,
    })
    assert.equal(r.score, expected, useCase.id)
    assert.ok(Math.abs(r.costPerM - (r.hourlyCost * 1e6) / (r.goodTok * 3600)) < 1e-9)
    assert.ok(r.coverage <= 1)
  }
})

test("a liquid rack in the air hall still runs, throttled, with a warning", () => {
  const air = evaluateBuild("chat", build({ hall: "A", platform: "gb300" }))
  const liquid = evaluateBuild("chat", build({ hall: "B", platform: "gb300" }))
  assert.equal(air.ok, true)
  assert.ok(air.warnings.some((line) => /overheat|liquid cooling/i.test(line)))
  assert.ok(air.throughput < liquid.throughput * 0.25)
  assert.ok(air.score < liquid.score / 3)
  const tip = coach(air)
  assert.equal(tip.title, "THIS WILL HURT")
  assert.match(tip.text, /overheat|liquid cooling/i)
})

test("choosing air or liquid cooling changes the score, and a liquid rack says so", () => {
  let changed = 0
  for (const id of ["chat", "code", "research"]) {
    const air = evaluateBuild(id, build({ hall: "A", platform: "gb200", racks: 2, data: "local" }))
    const liquid = evaluateBuild(id, build({ hall: "B", platform: "gb200", racks: 2, data: "local" }))
    if (air.score !== liquid.score) changed += 1
    assert.match(air.warnings.join(" "), /These racks need liquid cooling/)
    assert.ok(air.throughput < liquid.throughput)
  }
  assert.ok(changed >= 2, "cooling should matter in at least two stories")
  const ready = evaluateBuild("chat", build({ hall: "A", platform: "h100", racks: 2, data: "local" }))
  const fitted = evaluateBuild("chat", build({ hall: "B", platform: "h100", racks: 2, data: "local" }))
  assert.ok(fitted.liveWeeks > ready.liveWeeks, "an air-coolable rack in the liquid hall waits for the fit-out")
})

test("a giant model spills off one NVLink domain on HGX H100", () => {
  const h100 = evaluateBuild("research", build({ hall: "A", platform: "h100", racks: 4 }))
  const nvl = evaluateBuild("research", build({ platform: "gb300", racks: 1 }))
  assert.equal(h100.fits, false)
  assert.equal(h100.bottleneck, "fit")
  assert.equal(nvl.fits, true)
  assert.ok(nvl.score > h100.score * 3)
})

test("RAG without a vector index or file store is slow and poorly grounded", () => {
  // Beside the company cloud in Frankfurt, where the documents live.
  const local = evaluateBuild("rag", build({ data: "local", kv: true, sites: ["fra"], fabric: fabric({ dest: "cloud" }) }))
  const vector = evaluateBuild("rag", build({ data: "vector", kv: true, sites: ["fra"], fabric: fabric({ dest: "cloud" }) }))
  assert.equal(local.slaMet, false)
  assert.equal(local.quality, 0.55)
  assert.equal(vector.slaMet, true)
  assert.ok(vector.ttft < local.ttft)
  assert.ok(vector.score > local.score * 3)
  assert.equal(local.leak, "store")
})

test("the KV cache tier stops agents re-reading context", () => {
  const off = evaluateBuild("code", build({ hall: "A", platform: "b300", racks: 6 }))
  const on = evaluateBuild("code", build({ hall: "A", platform: "b300", racks: 6, kv: true }))
  assert.ok(on.prefillShare < off.prefillShare)
  assert.ok(on.ttft < off.ttft)
  assert.ok(on.goodput > off.goodput)
})

test("Vera Rubin's HBM4 bandwidth beats GB300 per megawatt on chat", () => {
  const vr = evaluateBuild("chat", build({ data: "local", kv: true }))
  const gb = evaluateBuild("chat", build({ platform: "gb300", racks: 2, data: "local", kv: true }))
  assert.ok(vr.streamTps > gb.streamTps)
  assert.ok(vr.tokPerMW > gb.tokPerMW)
})

test("idle capacity lowers efficiency: a rack past demand costs more per token", () => {
  const right = evaluateBuild("robot", build({ hall: "A", platform: "h200", racks: 2, data: "local", kv: true, fabric: fabric({ dest: "partner", vc: 5 }) }))
  const idle = evaluateBuild("robot", build({ platform: "gb200", racks: 2, data: "local", kv: true, fabric: fabric({ dest: "partner", vc: 5 }) }))
  assert.ok(idle.throughput > idle.demand * 1.3)
  assert.ok(right.throughput < right.demand * 1.3)
  assert.ok(idle.costPerM > right.costPerM)
  assert.equal(idle.overBudget, false)
  assert.equal(idle.leak, "idle")
})

test("ORCA PT-3 raises drug hits per candidate and leaves tokens per second alone", () => {
  const drug = byId(USE_CASES, "drug")
  const chat = byId(USE_CASES, "chat")
  const cross = byId(NETWORKS, "cross")
  const partner = fabric({ dest: "partner", vc: 5 })
  // Four air-cooled Blackwell Ultra racks fit the lab's small power room; ORCA's 6 kW must not tip it over.
  const lab = { hall: "R", platform: "b300", racks: 4 }
  const without = evaluateBuild("drug", build({ ...lab, fabric: partner }))
  const small = evaluateBuild("drug", build({ ...lab, orca: true, graphs: "small", fabric: partner }))
  const large = evaluateBuild("drug", build({ ...lab, orca: true, graphs: "large", fabric: partner }))
  const remote = evaluateBuild("drug", build({ ...lab, orca: true, graphs: "large", network: "public" }))
  const chatRun = evaluateBuild("chat", build({ orca: true }))
  assert.equal(large.throughput, without.throughput)
  assert.equal(orcaHitMult(drug, { orca: true, platform: null, graphs: "large" }, cross), 1)
  assert.equal(small.hitMult, 1.3)
  assert.equal(large.hitMult, 2.2)
  assert.ok(remote.hitMult < large.hitMult)
  assert.equal(chatRun.orca, false)
  assert.equal(orcaHitMult(chat, { orca: true, platform: "b300", graphs: "large" }, cross), 1)
  assert.ok(large.costPerM < without.costPerM)
  assert.ok(large.score > without.score)
})

test("only a missing use case or GPU is an error", () => {
  assert.deepEqual(planErrors({ useCase: null }), ["Choose a use case."])
  assert.deepEqual(planErrors({ useCase: "chat", build: { platform: null } }), ["Choose a GPU."])
  assert.deepEqual(planErrors({ useCase: "chat", build: build() }), [])
  const bare = evaluateBuild("chat", { ...build(), platform: null })
  assert.equal(bare.ok, false)
  assert.equal(bare.score, 0)
})

test("max-everything overshoots the budget for every use case, scores zero, and shows a dollar loss", async () => {
  const { maxedBuild } = await import("../js/balance.js")
  for (const useCase of USE_CASES) {
    const r = evaluateBuild(useCase.id, maxedBuild(useCase.id))
    assert.equal(r.ok, true, useCase.id)
    assert.ok(r.budgetSpend > r.budget, useCase.id)
    assert.ok(r.overBudget, useCase.id)
    assert.equal(r.score, 0, useCase.id)
    assert.ok(r.annualSavings > -5e9 && r.annualSavings < 5e9, `${useCase.id} saving ${r.annualSavings}`)
    const year = 365 * 24
    const peopleYear = (r.hourlyCost - r.amort - r.finance) * year + r.finance * 1.25
    assert.ok(Math.abs(peopleYear - (r.annualFactory - r.capex)) < 1, `${useCase.id} people-year ${peopleYear}`)
    assert.ok(r.annualFactory < r.capex + r.finance * year / 20, `${useCase.id} still multiplies the overspend by every hour`)
    assert.ok(r.warnings.some((line) => /Over the budget/.test(line)))
    assert.deepEqual(r.badges, [])
    assert.equal(stars(r), 0)
    assert.equal(r.leak, "overspend")
  }
})

test("rack space is capped: overflow is throttled and billed", () => {
  const fits = evaluateBuild("drug", build({ hall: "B", platform: "b300", racks: 10, data: "local" }))
  const spill = evaluateBuild("drug", build({ hall: "B", platform: "b300", racks: 16, data: "local" }))
  assert.equal(fits.overSpace, false)
  assert.equal(spill.overSpace, true)
  assert.ok(spill.spaceBill > 0)
  assert.ok(spill.warnings.some((line) => /holds 12 racks/.test(line)))
})

test("power available caps the build: overflow browns out, is billed, and costs points", () => {
  for (const useCase of USE_CASES) {
    const sc = scenarioFor(useCase)
    const r = evaluateBuild(useCase.id, build({ hall: "B", platform: "gb300", racks: 1, data: "local" }))
    const offer = METRO_OFFERS[useCase.id].find((item) => item.id === r.sites[0].id)
    assert.ok(Math.abs(r.powerMW - Math.round(sc.powerMW * offer.powerMult * 1000) / 1000) < 1e-9, `${useCase.id}: the metro's available share of the scenario power`)
    assert.ok(Math.abs(r.powerCapKW - (r.powerMW * 1000) / r.hall.pue) < 1e-9, useCase.id)
    assert.ok(Math.abs(r.powerUsedMW - (r.siteKW * r.hall.pue) / 1000) < 1e-9, useCase.id)
  }
  const ok = evaluateBuild("chat", build({ hall: "B", platform: "gb300", racks: 2, data: "local", kv: true }))
  const hot = evaluateBuild("chat", build({ hall: "B", platform: "gb300", racks: 4, data: "local", kv: true }))
  assert.equal(ok.overPower, false)
  assert.equal(hot.overPower, true)
  assert.ok(hot.powerUsedMW > hot.powerMW)
  assert.ok(hot.warnings.some((line) => /over the 0.6 MW available/.test(line)))
  assert.ok(hot.throughput < (hot.racks / ok.racks) * ok.throughput * 0.9, "brown-out throttles the extra racks")
  assert.ok(hot.score < ok.score)
})

test("lead time: nothing earns until the slowest part is live, and a late launch costs points", () => {
  const chat = (overrides) => evaluateBuild("chat", build({ data: "local", kv: true, ...overrides }))
  const air = chat({ hall: "A", platform: "b300", racks: 6 })
  assert.equal(air.liveWeeks, 12)
  assert.equal(air.lateWeeks, 0)
  assert.equal(air.launchFactor, 1)
  assert.ok(Math.abs(air.live - (HORIZON_WEEKS - 12) / HORIZON_WEEKS) < 1e-12)
  const vr = chat({ hall: "B", platform: "vr", racks: 1 })
  assert.equal(vr.liveWeeks, 30)
  assert.equal(vr.lateWeeks, 30 - scenarioFor(vr.useCase).deadlineWeeks)
  assert.ok(Math.abs(vr.launchFactor - Math.max(LATE_FLOOR, 1 - vr.lateWeeks * LATE_PER_WEEK)) < 1e-12)
  assert.ok(vr.lateRevenue > 0 && vr.lostRevenue > vr.lateRevenue)
  assert.ok(vr.warnings.some((line) => /weeks after the deadline/.test(line)))
  assert.equal(vr.leadParts.reduce((a, b) => (b.weeks > a.weeks ? b : a)).id, "gpu")
  const fullYear = (vr.revenue / vr.live) * 24 * 365
  assert.ok(Math.abs(vr.lostRevenue - fullYear * (1 - vr.live)) < 1e-6)
  const liquid = chat({ hall: "B", platform: "h100", racks: 2 })
  assert.equal(liquid.liveWeeks, 10, "the liquid fit-out is the slowest part for a fast GPU")
  const orca = evaluateBuild("drug", build({ hall: "R", platform: "b300", racks: 4, orca: true }))
  assert.equal(orca.liveWeeks, ORCA.leadWeeks, "ORCA is the slowest part beside 12-week Blackwell Ultra racks")
  const research = evaluateBuild("research", build({ hall: "B", platform: "vr", racks: 1 }))
  assert.equal(research.lateWeeks, 0, "Vera Rubin's lead time fits the long research deadline")
})

test("ORCA's price is charged in the back end but never counts against the visible budget", () => {
  const base = build({ hall: "B", platform: "gb200", racks: 2, data: "file" })
  const off = evaluateBuild("drug", base)
  const on = evaluateBuild("drug", { ...base, orca: true })
  assert.equal(ORCA.capex, 5_000_000)
  assert.equal(on.orcaCapex, ORCA.capex)
  assert.equal(on.capex - off.capex, ORCA.capex)
  assert.equal(on.budgetSpend, off.budgetSpend)
  assert.ok(Math.abs(on.amort - off.amort - ORCA.capex / (3 * 365 * 24)) < 1e-6)
  assert.ok(on.hourlyCost > off.hourlyCost)
  assert.ok(on.score > off.score, "ORCA still pays for drug discovery")
  const chatOn = evaluateBuild("chat", { ...base, orca: true })
  assert.equal(chatOn.orcaCapex, 0)
})

test("price and lead-time table: realistic estimates, newest GPUs cost most and arrive last", () => {
  const capex = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.capex]))
  assert.deepEqual(capex, { l40s: 160000, rtx6000: 240000, h100: 600000, h200: 700000, b200: 950000, b300: 1150000, b300n: 575000, gb200: 3200000, gb300: 4200000, vr: 6500000 })
  const lead = PLATFORMS.map((p) => p.leadWeeks)
  assert.deepEqual(lead, [...lead].sort((a, b) => a - b))
  const range = { l40s: [2, 4], rtx6000: [2, 6], h100: [6, 8], h200: [6, 8], b200: [10, 14], b300: [10, 14], b300n: [10, 14], gb200: [16, 24], gb300: [16, 24], vr: [26, 40] }
  for (const p of PLATFORMS) assert.ok(p.leadWeeks >= range[p.id][0] && p.leadWeeks <= range[p.id][1], p.id)
  assert.deepEqual(DATA_TIERS.map((t) => [t.id, t.capex, t.leadWeeks]), [["local", 0, 0], ["file", 400000, 6], ["vector", 550000, 6]])
  assert.deepEqual([KV_TIER.capex, KV_TIER.leadWeeks], [250000, 4])
  assert.ok(ORCA.leadWeeks >= 12 && ORCA.leadWeeks <= 30, "two cabinets beside the GPUs: months, not a year")
  assert.equal(POWER_PRICE, 0.1)
  assert.deepEqual([NET_PRICES.crossNrc, NET_PRICES.crossMrc, NET_PRICES.portMrc[10], NET_PRICES.fiberNrc, NET_PRICES.opticsNrc, NET_PRICES.fiberMrcBase], [500, 400, 1200, 60000, 40000, 2500])
  const vcs = Object.values(NET_PRICES.vcMrc)
  assert.ok(Math.min(...vcs) >= 400 && Math.max(...vcs) <= 1500)
  assert.equal(NET_PRICES.transitPerMbps * NET_PRICES.transitCommitGbps * 1000, 3000)
  assert.match(PRICE_NOTE, /estimates/)
  for (const useCase of USE_CASES) {
    const sc = scenarioFor(useCase)
    const vr = byId(PLATFORMS, "vr")
    assert.ok(vr.capex * vr.supply > sc.budget, `${useCase.id}: the budget cannot buy max GPUs`)
    assert.ok(sc.powerMW > 0 && sc.deadlineWeeks > 0 && sc.deadlineWeeks < HORIZON_WEEKS && sc.pricePerM > 0, useCase.id)
  }
})

test("stars follow score thresholds and need the SLA", () => {
  assert.deepEqual(STAR_POINTS, [...STAR_POINTS].sort((a, b) => a - b))
  assert.equal(stars({ ok: true, slaMet: true, overBudget: false, score: STAR_POINTS[2] }), 3)
  assert.equal(stars({ ok: true, slaMet: true, overBudget: false, score: STAR_POINTS[0] }), 1)
  assert.equal(stars({ ok: true, slaMet: false, overBudget: false, score: 5000 }), 0)
})

test("a live delta previews the score and $ per million tokens", () => {
  const delta = selectionDelta("chat", build({ data: "local" }), { racks: 2 })
  assert.ok(Number.isFinite(delta.score))
  assert.ok(delta.capex > 0)
  assert.ok(delta.costPerM != null)
})

/* ---------- Network ---------- */

test("published ServiceFabric speeds and ports are the only options", () => {
  assert.deepEqual(FABRIC_SPEEDS, [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 1, 2, 2.5, 5, 10, 100])
  assert.deepEqual(PORT_SPEEDS, [10, 100])
  const big = networkBill({ useCase: byId(USE_CASES, "chat"), kind: "fabric", fabric: fabric({ port: 10, vc: 100 }), legs: [{ id: "user" }] })
  assert.equal(big.config.vc, 10)
  assert.ok(big.warnings.some((line) => /10 Gbps port/.test(line)))
  const inet = networkBill({ useCase: byId(USE_CASES, "chat"), kind: "fabric", fabric: fabric({ port: 100, vc: 100, dest: "internet" }), legs: [{ id: "user" }] })
  assert.equal(inet.config.vc, 10)
  assert.ok(inet.warnings.some((line) => /Digital Internet/.test(line)))
})

test("dark fiber costs far more up front than a cross connect, and takes weeks not days", () => {
  const rag = byId(USE_CASES, "rag")
  const cross = networkBill({ useCase: rag, kind: "cross", legs: [{ id: "user" }] })
  const fiber = networkBill({ useCase: rag, kind: "fiber", legs: [{ id: "user" }] })
  assert.ok(fiber.nrc > cross.nrc * 50)
  assert.ok(fiber.items.some((item) => /optics/.test(item.label)))
  assert.ok(fiber.leadDays >= 8 * 7 && fiber.leadDays <= 16 * 7)
  assert.ok(cross.leadDays <= 15)
  assert.ok(cross.nrc > 0 && cross.mrc > 0)
})

test("an under-sized ServiceFabric connection caps throughput", () => {
  const right = evaluateBuild("chat", build({ data: "local", kv: true, fabric: fabric({ vc: 1 }) }))
  const thin = evaluateBuild("chat", build({ data: "local", kv: true, fabric: fabric({ vc: 0.05 }) }))
  assert.equal(thin.bandwidthCapped, true)
  assert.ok(thin.throughput < right.throughput * 0.25)
  assert.ok(thin.score < right.score)
  assert.equal(thin.bottleneck, "bandwidth")
  const fat = evaluateBuild("chat", build({ data: "local", kv: true, fabric: fabric({ port: 100, vc: 100, dest: "cloud" }) }))
  assert.ok(fat.netCost > right.netCost)
})

test("redundancy raises cost and removes the outage haircut", () => {
  const single = evaluateBuild("research", build({ fabric: fabric({ redundant: false, dest: "internet" }) }))
  const dual = evaluateBuild("research", build({ fabric: fabric({ redundant: true, dest: "internet" }) }))
  assert.ok(dual.netCost > single.netCost)
  assert.ok(dual.net.mrc > single.net.mrc)
  assert.equal(single.net.haircut, OUTAGE_HAIRCUT)
  assert.equal(dual.net.haircut, 0)
  assert.ok(dual.goodTok > single.goodTok)
})

test("ServiceFabric MCP gives the same latency and price as a manual ServiceFabric config", () => {
  const config = fabric({ vc: 1, dest: "internet", layer: "l3" })
  const agent = evaluateBuild("code", build({ racks: 1, network: "mcp", fabric: config }))
  const manual = evaluateBuild("code", build({ racks: 1, network: "fabric", fabric: { ...agent.net.config } }))
  assert.equal(agent.ttft, manual.ttft)
  assert.equal(agent.netCost, manual.netCost)
  assert.equal(agent.capex, manual.capex)
  assert.equal(agent.net.leadDays, manual.net.leadDays)
  assert.equal(linkProfile(byId(NETWORKS, "mcp"), 640).rttS, linkProfile(byId(NETWORKS, "fabric"), 640).rttS)
  const proposal = mcpPropose("safe", byId(USE_CASES, "code"), agent.net ? [{ id: "user" }, { id: "retrieval" }, { id: "tool" }] : [], 1)
  const priced = networkBill({ useCase: byId(USE_CASES, "code"), kind: "fabric", fabric: proposal.config, legs: [{ id: "user" }, { id: "retrieval" }, { id: "tool" }] })
  assert.equal(proposal.bill.mrc, priced.mrc)
  assert.equal(proposal.config.layer, "l3")
  assert.equal(proposal.config.redundant, true)
})

test("MCP's labelled agility benefit steps an under-sized connection up one tier", () => {
  const thin = fabric({ vc: 0.1, dest: "internet" })
  const manual = evaluateBuild("chat", build({ racks: 2, data: "local", kv: true, network: "fabric", fabric: thin }))
  const agent = evaluateBuild("chat", build({ racks: 2, data: "local", kv: true, network: "mcp", fabric: thin }))
  assert.deepEqual(agent.net.rightSized, { from: 0.1, to: 0.2 })
  assert.equal(manual.bandwidthCapped, true)
  assert.ok(agent.throughput > manual.throughput)
  assert.equal(agent.ttft <= manual.ttft, true)
})

test("Layer 2 reaches one destination; Layer 3 reaches all of them for a router fee", () => {
  const l2 = evaluateBuild("code", build({ platform: "gb300", racks: 2, fabric: fabric({ layer: "l2", dest: "internet" }) }))
  const l3 = evaluateBuild("code", build({ platform: "gb300", racks: 2, fabric: fabric({ layer: "l3", dest: "internet" }) }))
  assert.deepEqual(l2.net.unreached.sort(), ["cloud", "partner"])
  assert.ok(l2.warnings.some((line) => /Layer 2 link reaches one destination/.test(line)))
  assert.deepEqual(l3.net.unreached, [])
  assert.ok(l3.net.items.some((item) => /virtual router/.test(item.label)))
  assert.ok(l2.ttft > l3.ttft)
  assert.ok(l3.score > l2.score)
})

test("Cross Connect is unavailable off-campus; dark fiber stays regional", () => {
  const chatGate = linkEligibility("chat", { sites: ["lon"] }, byId(NETWORKS, "cross"))
  assert.equal(chatGate.ok, false)
  assert.match(chatGate.reason, /one building/)
  assert.equal(linkEligibility("rag", { sites: ["lon"] }, byId(NETWORKS, "cross")).ok, true)
  assert.equal(linkEligibility("code", { sites: ["iad", "sjc"] }, byId(NETWORKS, "cross")).ok, false)
  assert.equal(linkEligibility("rag", { sites: ["lon"] }, byId(NETWORKS, "fiber")).ok, false)
  assert.equal(linkEligibility("chat", { sites: ["lon", "iad"] }, byId(NETWORKS, "fiber")).ok, false)
  assert.equal(linkEligibility("chat", { sites: ["lon", "fra"] }, byId(NETWORKS, "fiber")).ok, true)
  const forced = evaluateBuild("chat", build({ network: "cross" }))
  assert.equal(forced.wire.id, "public")
  assert.ok(forced.warnings.some((line) => /falls back to the public internet/.test(line)))
})

test("network latency: cross ≤ fibre ≤ fabric = MCP < public at the same distance", () => {
  const km = 640
  const order = ["cross", "fiber", "fabric", "mcp", "public"].map((id) => linkProfile(byId(NETWORKS, id), km).rttS)
  // Beyond the building, a cross connect to an on-ramp is fibre physics to the far region.
  assert.ok(order[0] <= order[1])
  assert.ok(linkProfile(byId(NETWORKS, "cross"), 0).rttS < linkProfile(byId(NETWORKS, "fiber"), 20).rttS)
  assert.ok(order[1] <= order[2])
  assert.equal(order[2], order[3])
  assert.ok(order[4] > Math.max(...order.slice(0, 4)))
  const fabricLink = byId(NETWORKS, "fabric")
  const few = networkDelay({ id: "code", toolCalls: 2, data: "none", bytesPerToken: 180, ttft: 3 }, fabricLink, { id: "local" }, { avgKm: 800, interKm: 0 })
  const many = networkDelay({ id: "code", toolCalls: 8, data: "none", bytesPerToken: 180, ttft: 3 }, fabricLink, { id: "local" }, { avgKm: 800, interKm: 0 })
  assert.equal(many.trips - few.trips, 6)
  const pub = evaluateBuild("code", build({ platform: "gb300", racks: 2, network: "public" }))
  const fab = evaluateBuild("code", build({ platform: "gb300", racks: 2, fabric: fabric({ layer: "l3" }) }))
  assert.ok(pub.ttft > fab.ttft)
  assert.ok(pub.throughput < fab.throughput * 0.5)
  assert.ok(pub.score < fab.score)
})

test("more metros bring users closer and duplicate storage and ports", () => {
  const one = evaluateBuild("chat", build({ racks: 2, data: "local", kv: true, sites: ["lon"], fabric: fabric({ vc: 1 }) }))
  const two = evaluateBuild("chat", build({ racks: 2, data: "local", kv: true, sites: ["lon", "fra"], fabric: fabric({ vc: 0.3, layer: "l3" }) }))
  assert.ok(two.userKm < one.userKm)
  assert.ok(two.userRttS < one.userRttS)
  assert.ok(two.interKm > 400)
  assert.deepEqual(two.siteRacks, [1, 1])
  assert.ok(two.net.items[0].label.startsWith("4×"))
  const thin = evaluateBuild("chat", build({ racks: 1, data: "local", sites: ["lon", "iad"] }))
  assert.ok(thin.warnings.some((line) => /not enough racks/i.test(line)))
})

function routed(useCaseId, kinds, extra = {}) {
  const useCase = byId(USE_CASES, useCaseId)
  const vc = extra.vc ?? 2
  const routes = {}
  for (const leg of useCase.legs) {
    const kind = kinds[leg.id] ?? kinds.all ?? (leg.when === "optional" ? "off" : "fabric")
    routes[leg.id] = {
      kind,
      fabric: { port: vc > 10 ? 100 : 10, vc, dest: leg.dest, layer: extra.layer || "l2", redundant: Boolean(extra.redundant) },
      backup: kinds.backup?.[leg.id] || null,
    }
  }
  return routes
}

const routedHw = { hall: "B", platform: "vr", racks: 1, data: "vector", kv: true, graphs: "large", sites: ["lon"], network: "mix" }

test("per-leg costs and delays add up to the build", () => {
  const routes = routed("rag", { users: "fabric", store: "cross", control: "mcp" })
  const result = evaluateBuild("rag", { ...routedHw, routes })
  const added = result.legResults.reduce((sum, leg) => sum + leg.addedS, 0)
  assert.ok(Math.abs(result.waitS - added) < 1e-9)
  const nrc = result.net.items.reduce((sum, item) => sum + item.nrc, 0)
  const mrc = result.net.items.reduce((sum, item) => sum + item.mrc, 0)
  assert.ok(Math.abs(result.net.nrc - nrc) < 1e-6)
  assert.ok(Math.abs(result.net.mrc - mrc) < 1e-6)
  assert.equal(result.net.items.filter((item) => /port/.test(item.label)).length, 1)
  assert.ok(result.legResults.find((leg) => leg.id === "store").kind === "cross")
  assert.ok(result.legResults.find((leg) => leg.id === "users").kind === "fabric")
})

test("each combo fires only for its exact mixture", () => {
  const rag = (kinds, extra) => evaluateBuild("rag", { ...routedHw, ...extra, routes: routed("rag", kinds, extra) }).combos.map((combo) => combo.id)
  assert.ok(rag({ users: "fabric", store: "cross", control: "off" }).includes("onramp"))
  assert.ok(!rag({ users: "fabric", store: "fabric", control: "off" }).includes("onramp"))
  assert.ok(!rag({ users: "cross", store: "cross", control: "off" }).includes("onramp"))
  assert.ok(rag({ all: "fabric", control: "off" }).includes("private"))
  assert.ok(!rag({ users: "public", store: "cross", control: "off" }).includes("private"))
  assert.ok(rag({ users: "fabric", store: "fabric", control: "mcp" }).includes("fabricMcp"))
  assert.ok(!rag({ users: "fabric", store: "mcp", control: "mcp" }).includes("fabricMcp"))
  assert.ok(!rag({ users: "fabric", store: "fabric", control: "fabric" }).includes("fabricMcp"))

  const chatFiber = evaluateBuild("chat", { ...routedHw, data: "local", sites: ["lon", "fra"], racks: 2, routes: routed("chat", { users: "fabric", inter: "fiber", control: "off" }) })
  assert.ok(chatFiber.combos.some((combo) => combo.id === "backbone"))
  assert.equal(chatFiber.legResults.find((leg) => leg.id === "inter").addedS, 0)
  assert.equal(chatFiber.net.leadDays, LEAD_DAYS.fiber)
  assert.ok(chatFiber.net.nrc >= NET_PRICES.fiberNrc + NET_PRICES.opticsNrc)
  const chatNear = evaluateBuild("chat", { ...routedHw, data: "local", sites: ["lon"], routes: routed("chat", { users: "fabric", inter: "fiber", control: "off" }) })
  assert.ok(!chatNear.combos.some((combo) => combo.id === "backbone"))

  const drug = (vc, kind) => evaluateBuild("drug", { ...routedHw, data: "file", orca: true, routes: routed("drug", { lab: kind, orca: "cross", control: "off" }, { vc }) })
  assert.ok(drug(100, "fabric").combos.some((combo) => combo.id === "bulk"))
  assert.ok(drug(100, "fiber").combos.some((combo) => combo.id === "bulk"))
  assert.ok(!drug(1, "fabric").combos.some((combo) => combo.id === "bulk"))
  assert.ok(!drug(1, "public").combos.some((combo) => combo.id === "bulk"))

  const bare = evaluateBuild("rag", { ...routedHw, routes: routed("rag", { all: "fabric", control: "off" }, { redundant: false }) })
  const backed = evaluateBuild("rag", { ...routedHw, routes: routed("rag", { all: "fabric", control: "off", backup: { users: "cross" } }, { redundant: false }) })
  assert.equal(bare.net.haircut, OUTAGE_HAIRCUT)
  assert.ok(backed.combos.some((combo) => combo.id === "redundant"))
  assert.equal(backed.net.haircut, 0)
  assert.ok(backed.net.nrc > bare.net.nrc && backed.net.mrc > bare.net.mrc)
  assert.ok(!rag({ all: "fabric", control: "off" }, { redundant: false }).includes("redundant"))
})

test("synergy cannot multiply goodput by more than 25%", () => {
  assert.equal(SYNERGY_CAP, 1.25)
  assert.equal(capSynergy(1.05 * 1.08 * 1.12), 1.25)
  for (const useCase of USE_CASES) {
    const result = evaluateBuild(useCase.id, { ...routedHw, orca: Boolean(useCase.orca), data: useCase.orca ? "file" : "vector", routes: routed(useCase.id, { all: "fabric", control: "mcp" }, { vc: 100 }) })
    if (result.synergy) assert.ok(result.synergy.goodputMult <= SYNERGY_CAP, useCase.id)
  }
})

test("all-internet is worst for chat and agents, and still viable for drug discovery", () => {
  const chat = (kind) => evaluateBuild("chat", { ...routedHw, data: "local", kv: true, routes: routed("chat", { all: kind, control: "off" }, { vc: 1 }) })
  const pub = chat("public")
  for (const kind of ["fabric", "mcp"]) assert.ok(pub.score < chat(kind).score, kind)
  assert.ok(pub.score <= chat("cross").score)
  assert.ok(pub.score <= chat("fiber").score)
  const code = (kind) => evaluateBuild("code", { ...routedHw, platform: "gb300", racks: 2, sites: ["iad"], data: "file", routes: routed("code", { all: kind, control: "off" }, { vc: 2 }) })
  assert.ok(code("public").score < code("fabric").score)

  const drugPub = evaluateBuild("drug", { ...routedHw, hall: "R", platform: "b300", racks: 4, data: "file", kv: false, orca: true, routes: routed("drug", { lab: "public", orca: "cross", control: "off" }, { vc: 1 }) })
  const drugFat = evaluateBuild("drug", { ...routedHw, hall: "R", platform: "b300", racks: 4, data: "file", kv: false, orca: true, routes: routed("drug", { lab: "fabric", orca: "cross", control: "off" }, { vc: 100 }) })
  assert.ok(drugPub.score > 0)
  assert.ok(drugPub.score > pub.score * 5, "all-internet still works for bulk, latency-insensitive drug data")
  assert.equal(drugPub.bandwidthCapped, true)
  assert.equal(drugPub.publicTrips, 0)
  assert.ok(drugPub.score < drugFat.score)
  assert.ok(drugPub.net.mrc < drugFat.net.mrc)
})

test("a RAG mixture beats any single product on first-token time and score", () => {
  const once = (kinds) => evaluateBuild("rag", { ...routedHw, routes: routed("rag", kinds, { vc: 10 }) })
  const mix = once({ users: "fabric", store: "cross", control: "mcp" })
  assert.deepEqual(mix.combos.map((combo) => combo.id).sort(), ["onramp", "private"])
  for (const kind of ["fabric", "mcp", "cross", "fiber", "public"]) {
    const single = once({ all: kind })
    assert.ok(mix.ttft < single.ttft, kind)
    assert.ok(mix.score > single.score, `${kind} ${single.score} vs ${mix.score}`)
  }
})

test("ServiceFabric MCP never changes latency, including on the control leg alone", () => {
  const hw = { ...routedHw, data: "local", kv: true, routes: null }
  const fabricRun = evaluateBuild("chat", { ...hw, routes: routed("chat", { all: "fabric", control: "off" }, { vc: 1 }) })
  const mcpRun = evaluateBuild("chat", { ...hw, routes: routed("chat", { all: "mcp", control: "off" }, { vc: 1 }) })
  assert.deepEqual(mcpRun.legResults.map((leg) => leg.rttS), fabricRun.legResults.map((leg) => leg.rttS))
  assert.equal(linkProfile(byId(NETWORKS, "mcp"), 640).rttS, linkProfile(byId(NETWORKS, "fabric"), 640).rttS)
  const quiet = evaluateBuild("rag", { ...routedHw, routes: routed("rag", { users: "fabric", store: "fabric", control: "off" }) })
  const watched = evaluateBuild("rag", { ...routedHw, routes: routed("rag", { users: "fabric", store: "fabric", control: "mcp" }) })
  assert.deepEqual(watched.legResults.filter((leg) => leg.id !== "control").map((leg) => leg.rttS), quiet.legResults.filter((leg) => leg.id !== "control").map((leg) => leg.rttS))
  assert.ok(watched.combos.some((combo) => combo.id === "fabricMcp"))
  const agent = evaluateBuild("code", { ...routedHw, platform: "gb300", racks: 2, sites: ["iad"], data: "file", routes: routed("code", { users: "public", tools: "fabric", control: "mcp" }, { vc: 0.2 }) })
  const manual = evaluateBuild("code", { ...routedHw, platform: "gb300", racks: 2, sites: ["iad"], data: "file", routes: routed("code", { users: "public", tools: "fabric", control: "off" }, { vc: 0.2 }) })
  assert.equal(agent.waitS, manual.waitS)
  assert.ok(agent.net.items.some((item) => /10%/.test(item.label)))
  assert.ok(agent.legResults.find((leg) => leg.id === "tools").rightSized)
  assert.equal(manual.bandwidthCapped, true)
})

test("a cross connect off campus falls back per leg; dark fiber stays regional", () => {
  assert.equal(legEligibility(byId(USE_CASES, "chat").legs[0], "cross", { avgKm: 800, interKm: 0, sites: [{}] }).ok, false)
  assert.match(legEligibility(byId(USE_CASES, "chat").legs[0], "cross", { avgKm: 800, interKm: 0, sites: [{}] }).reason, /one building/)
  assert.equal(legEligibility(byId(USE_CASES, "rag").legs[1], "cross", { avgKm: 0, interKm: 0, sites: [{}] }).ok, true)
  assert.equal(legEligibility(byId(USE_CASES, "chat").legs[1], "fiber", { avgKm: 100, interKm: 640, sites: [{}, {}] }).ok, true)
  assert.equal(legEligibility(byId(USE_CASES, "chat").legs[1], "fiber", { avgKm: 100, interKm: 6000, sites: [{}, {}] }).ok, false)
  const forced = evaluateBuild("chat", { ...routedHw, data: "local", routes: routed("chat", { users: "cross", control: "off" }) })
  assert.equal(forced.legResults.find((leg) => leg.id === "users").kind, "public")
  assert.ok(forced.warnings.some((line) => /falls back to the public internet/.test(line)))
})

test("balance: every use case's best sits in one band, with at least two strategies within 10%", async () => {
  const { nearStrategies, searchBuilds } = await import("../js/balance.js")
  const bests = []
  for (const useCase of USE_CASES) {
    const list = searchBuilds(useCase.id)
    assert.ok(list.length > 0, useCase.id)
    bests.push(list[0].result.score)
    // Optima are sharp on purpose now (one picture within 2%), so the second strategy sits within 20%.
    assert.ok(nearStrategies(list, 0.2).length >= 2, `${useCase.id} has one strategy near the top`)
  }
  assert.ok(Math.min(...bests) >= 1250, bests.join(","))
  assert.ok(Math.max(...bests) <= 1550, bests.join(","))
})

test("full names are required, and the league keeps each player's best without showing email", () => {
  assert.equal(validateName("  Ada   Lovelace ").name, "Ada Lovelace")
  assert.equal(validateName("Anne-Marie O'Neill").ok, true)
  assert.equal(validateName("José Martínez").ok, true)
  assert.equal(validateName("Madonna").ok, false)
  assert.equal(validateName("Player 1").ok, false)

  const league = upsertEntry([{ name: "Ada Lovelace", score: 3000, at: 1 }], { name: "ada lovelace", score: 2500, at: 2 })
  assert.equal(league[0].score, 3000)
  const next = upsertEntry(league, { name: "Grace Hopper", score: 3200, at: 3 })
  assert.equal(sortLeague(next)[0].name, "Grace Hopper")
  assert.equal(rankOf(next, "ada lovelace"), 2)
  assert.equal(rivalFor(next, 3100).name, "Grace Hopper")
  assert.equal(rivalFor(next, 3300), null)
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal), ["1ST", "2ND", "3RD", "4TH", "11TH", "12TH", "13TH", "21ST"])

  assert.equal(normalizeEmail("  Ada@Example.COM "), "ada@example.com")
  assert.equal(validateEmail("ada@example.com").ok, true)
  assert.equal(validateEmail("not-an-email").ok, false)
  assert.equal(validateEmail("a@b").ok, false)
  assert.equal(validateEmail("a @b.com").ok, false)
  assert.equal(validateEmail(`${"a".repeat(250)}@b.com`).ok, false)

  const saved = upsertEntry([], {
    name: "Ada Lovelace",
    email: "ada@example.com",
    score: 1300,
    useCase: "rag",
    costPerM: 0.187,
    at: 1,
    consent: true,
    consentAt: 4,
  })
  const updated = upsertEntry(saved, { name: "ada lovelace", email: "winner@example.com", score: 1200, at: 9, consent: true, consentAt: 11 })
  assert.equal(updated[0].score, 1300)
  assert.equal(updated[0].useCase, "rag")
  assert.equal(updated[0].email, "winner@example.com")
  assert.equal(updated[0].consentAt, 11)
  const exported = leagueJson(updated)
  assert.match(exported, /winner@example.com/)
  assert.match(exported, /"useCase": "rag"/)
  assert.match(exported, /"costPerM": 0.187/)
  assert.match(leagueCsv(updated), /winner@example.com,1300,rag,0.187/)
  const board = boardHtml(updated)
  assert.equal(board.includes("@"), false)
  assert.match(board, /Ada Lovelace/)
})

test("people-power turns good tokens into hours, people, and money saved", () => {
  const work = { tokensPerTask: 3600, humanMinutes: 60, loadedCost: FTE_HOURS }
  const one = peoplePower({ goodTok: 1, work, capex: 0, hourlyOpex: 0 })
  assert.ok(Math.abs(one.tasksPerHour - 1) < 1e-9)
  assert.ok(Math.abs(one.humanHoursPerYear - 365 * 24) < 1e-6)
  assert.ok(Math.abs(one.fteEquivalent - (365 * 24) / FTE_HOURS) < 1e-9)
  assert.ok(Math.abs(one.humanCostAvoided - 365 * 24) < 1e-6)
  const half = peoplePower({ goodTok: 0.5, work, capex: 0, hourlyOpex: 0 })
  assert.ok(Math.abs(half.fteEquivalent - one.fteEquivalent / 2) < 1e-9, "live weeks already sit inside goodTok")
  for (const [id, row] of Object.entries(HUMAN_WORK)) {
    assert.ok(row.tokensPerTask > 0 && row.humanMinutes > 0 && row.loadedCost > 0, id)
  }
})

test("a negative saving on the results card stays inside a few billion", () => {
  assert.equal(lossPhrase(-400_000_000), formatMoney(400_000_000))
  assert.equal(lossPhrase(-2_400_000_000), formatMoney(2_400_000_000))
  assert.equal(lossPhrase(-6_000_000_000), "over $5B")
})

test("absurd capex flips the saving, and serving half the crowd scores lower", () => {
  const broke = peoplePower({ goodTok: 10, demand: 1_000_000, work: HUMAN_WORK.chat, capex: 1e15, hourlyOpex: 0 })
  const paid = peoplePower({ goodTok: 1000, demand: 1_000_000, work: HUMAN_WORK.chat, capex: 1_000, hourlyOpex: 1 })
  assert.ok(broke.annualSavings < 0)
  assert.ok(paid.annualSavings > 0)
  const par = HUMAN_WORK.chat.savingsPar
  assert.ok(savingsFactorFor(broke.annualSavings, par) < savingsFactorFor(paid.annualSavings, par))
  const full = blendScore({ par: 1, coverage: 1, slaFactor: 1, launchFactor: 1, costPerM: 1, savingsFactor: savingsFactorFor(paid.annualSavings, par) })
  const halfCrowd = blendScore({ par: 1, coverage: 0.5, slaFactor: 1, launchFactor: 1, costPerM: 1, savingsFactor: savingsFactorFor(paid.annualSavings, par) })
  assert.ok(halfCrowd < full)
  assert.ok(halfCrowd > 0)
  const halfTokens = peoplePower({ goodTok: 500, demand: 1_000_000, work: HUMAN_WORK.chat, capex: 0, hourlyOpex: 0 })
  const fullTokens = peoplePower({ goodTok: 1000, demand: 1_000_000, work: HUMAN_WORK.chat, capex: 0, hourlyOpex: 0 })
  assert.ok(Math.abs(halfTokens.annualSavings - fullTokens.annualSavings / 2) < 1, "half the tokens save half as much when the factory is free")
})

test("people-power uses the share, ignores tokens above demand, and caps the enterprise", () => {
  const work = HUMAN_WORK.chat
  const full = peoplePower({ goodTok: 1000, demand: 10_000, work, capex: 0, hourlyOpex: 0 })
  const halfShare = peoplePower({ goodTok: 1000, demand: 10_000, work: { ...work, share: work.share / 2 }, capex: 0, hourlyOpex: 0 })
  assert.ok(Math.abs(halfShare.humanHoursPerYear * 2 - full.humanHoursPerYear) < 1e-4)
  const overDemand = peoplePower({ goodTok: 80_000, demand: 1000, work, capex: 0, hourlyOpex: 0 })
  const atDemand = peoplePower({ goodTok: 1000, demand: 1000, work, capex: 0, hourlyOpex: 0 })
  assert.ok(Math.abs(overDemand.fteEquivalent - atDemand.fteEquivalent) < 1e-6)
  const saturated = peoplePower({ goodTok: 600_000, demand: 600_000, work, capex: 0, hourlyOpex: 0 })
  assert.equal(saturated.capped, true)
  assert.ok(saturated.fteEquivalent <= work.fteCap + 1e-6)
  assert.ok(saturated.fteEquivalent > work.fteCap * 0.99)
})
