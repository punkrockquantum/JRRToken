import { DATA_TIERS, HALLS, PLATFORMS, USE_CASES } from "../js/data.js"
import { MAX_RACKS, evaluateDeployment, evaluatePlan } from "../js/model.js"

function options(useCase, hall) {
  const list = []
  for (const platform of PLATFORMS) {
    for (let racks = 1; racks <= MAX_RACKS; racks += 1) {
      for (const data of DATA_TIERS) {
        for (const kv of [false, true]) {
          for (const orca of useCase.orca ? [false, true] : [false]) {
            const build = { platform: platform.id, racks, data: data.id, kv, orca }
            const result = evaluateDeployment(useCase.id, hall.id, build)
            if (!result.ok || result.itKW > hall.itMW * 1000 || racks > platform.supply) continue
            list.push({ build, result })
          }
        }
      }
    }
  }
  return list
}

function solo(item) {
  return item.result.points
}

const table = {}
for (const useCase of USE_CASES) {
  for (const hall of HALLS) {
    const list = options(useCase, hall)
    table[`${useCase.id}:${hall.id}`] = list
    const perPlatform = PLATFORMS.map((platform) => {
      const mine = list.filter((item) => item.build.platform === platform.id)
      if (!mine.length) return `${platform.id}:—`
      const best = mine.reduce((a, b) => (solo(b) > solo(a) ? b : a))
      const r = best.result
      return `${platform.id}:${solo(best)}(${best.build.racks}r ${best.build.data}${best.build.kv ? "+kv" : ""} ${r.bottleneck} ttft${r.ttft.toFixed(2)} cov${(r.goodput / r.demand).toFixed(2)})`
    })
    console.log(`${useCase.id} @${hall.id}  ${perPlatform.join("  ")}`)
  }
}
if (process.argv.includes("--table")) process.exit(0)

const ids = USE_CASES.map((item) => item.id)
const combos = []
for (let a = 0; a < ids.length; a += 1)
  for (let b = a + 1; b < ids.length; b += 1)
    for (let c = b + 1; c < ids.length; c += 1) combos.push([ids[a], ids[b], ids[c]])

const results = []
for (const picks of combos) {
  let best = null
  for (let mask = 0; mask < 8; mask += 1) {
    const halls = {}
    picks.forEach((id, index) => {
      halls[id] = mask & (1 << index) ? "B" : "A"
    })
    if (new Set(Object.values(halls)).size < 2) continue
    const lists = picks.map((id) => {
      const list = table[`${id}:${halls[id]}`]
      return list
        .slice()
        .sort((x, y) => solo(y) - solo(x))
        .slice(0, 60)
    })
    for (const x of lists[0])
      for (const y of lists[1])
        for (const z of lists[2]) {
          const plan = {
            picks,
            halls,
            builds: { [picks[0]]: x.build, [picks[1]]: y.build, [picks[2]]: z.build },
          }
          const result = evaluatePlan(plan)
          if (!result.ok) continue
          if (!best || result.score > best.result.score) best = { plan, result }
        }
  }
  results.push({ picks, best })
}
results.sort((a, b) => (b.best?.result.score ?? 0) - (a.best?.result.score ?? 0))
for (const { picks, best } of results) {
  if (!best) {
    console.log(`${picks.join("+")}: no valid plan`)
    continue
  }
  const parts = best.plan.picks.map((id) => {
    const b = best.plan.builds[id]
    return `${id}@${best.plan.halls[id]}=${b.platform}x${b.racks} ${b.data}${b.kv ? "+kv" : ""}${b.orca ? "+orca" : ""}`
  })
  console.log(
    `${picks.join("+")}: score ${best.result.score} cov ${best.result.coverage.toFixed(2)} MW ${(best.result.facilityKW / 1000).toFixed(2)} | ${parts.join(" | ")}`,
  )
}
