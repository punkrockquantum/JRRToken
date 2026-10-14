import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { searchBuilds } from "../js/balance.js"
import { TRAIN_BONUS_CAP } from "../js/data.js"
import { defaultSitePlans, evaluateBuild } from "../js/model.js"
import { choicesToBuild, expertChoices } from "../js/presets.js"
import { explainResult } from "../js/explain.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const main = readFileSync(join(root, "js/main.js"), "utf8")

function winning(id) {
  return searchBuilds(id)[0].build
}

test("closer to people is the site lesson", () => {
  assert.match(main, /Closer to people = faster/)
})

test("even inference plans match a simple multi-site build", () => {
  const build = winning("chat")
  const plain = evaluateBuild("chat", build)
  const plans = defaultSitePlans(plain.platform, build.racks, plain.sites)
  const even = evaluateBuild("chat", { ...build, sitePlans: plans })
  assert.equal(even.score, plain.score)
  assert.deepEqual(even.siteRacks, plain.siteRacks)
})

test("nerd mode off ignores a custom site plan", () => {
  const choices = {
    ...expertChoices("chat"),
    sitePlans: [
      { id: "lon", role: "edge", powerMW: 0.01 },
      { id: "fra", role: "inference", powerMW: 1 },
    ],
  }
  const off = choicesToBuild("chat", choices, false)
  const on = choicesToBuild("chat", choices, true)
  assert.equal(off.sitePlans, undefined)
  assert.ok(on.sitePlans.length === 2)
  const plain = evaluateBuild("chat", off)
  const simple = evaluateBuild("chat", choicesToBuild("chat", expertChoices("chat")))
  assert.equal(plain.score, simple.score)
})

test("an edge site shortens the remote trip and still pays one inter-site hop", () => {
  const build = winning("chat")
  const rackMW = evaluateBuild("chat", build).platform.rackKW / 1000
  const [home, away] = build.sites
  const edge = evaluateBuild("chat", {
    ...build,
    sitePlans: [
      { id: home, role: "inference", powerMW: rackMW * 2 },
      { id: away, role: "edge", powerMW: 0.01 },
    ],
  })
  const solo = evaluateBuild("chat", { ...build, sites: [home] })
  const split = evaluateBuild("chat", {
    ...build,
    sitePlans: [
      { id: home, role: "inference", powerMW: rackMW },
      { id: away, role: "inference", powerMW: rackMW },
    ],
  })
  const remoteEdge = edge.cohorts.find((row) => row.city === "Frankfurt")
  const remoteSolo = solo.cohorts.find((row) => row.city === "Frankfurt")
  const remoteSplit = split.cohorts.find((row) => row.city === "Frankfurt")
  assert.equal(remoteEdge.edge, true)
  assert.ok(remoteEdge.rttS < remoteSolo.rttS, `${remoteEdge.rttS} should beat the one-site trip ${remoteSolo.rttS}`)
  assert.ok(remoteEdge.rttS > remoteSplit.rttS, `${remoteEdge.rttS} should include the hop beyond a local site ${remoteSplit.rttS}`)
})

test("a training site does not serve tokens and its bonus is capped", () => {
  const build = winning("chat")
  const rackMW = evaluateBuild("chat", build).platform.rackKW / 1000
  const [home, away] = build.sites
  const split = evaluateBuild("chat", {
    ...build,
    sitePlans: [
      { id: home, role: "inference", powerMW: rackMW },
      { id: away, role: "inference", powerMW: rackMW },
    ],
  })
  const trained = evaluateBuild("chat", {
    ...build,
    sitePlans: [
      { id: home, role: "inference", powerMW: rackMW },
      { id: away, role: "training", powerMW: rackMW * 0.4 },
    ],
  })
  const huge = evaluateBuild("chat", {
    ...build,
    sitePlans: [
      { id: home, role: "inference", powerMW: rackMW },
      { id: away, role: "training", powerMW: rackMW * 30 },
    ],
  })
  assert.ok(trained.throughput < split.throughput * 0.75, "training racks are not answering users")
  assert.ok(trained.trainBonus > 0)
  assert.ok(trained.trainBonus <= TRAIN_BONUS_CAP)
  assert.equal(huge.trainBonus, TRAIN_BONUS_CAP)
  assert.equal(huge.sitePlans.find((row) => row.role === "training").racks, 0)
})

test("power past the hall slows the racks down", () => {
  const build = winning("chat")
  const [home, away] = build.sites
  const over = evaluateBuild("chat", {
    ...build,
    sitePlans: [
      { id: home, role: "inference", powerMW: 4 },
      { id: away, role: "inference", powerMW: 4 },
    ],
  })
  const within = evaluateBuild("chat", build)
  assert.ok(over.powerThrottle < 1)
  assert.ok(over.warnings.some((line) => /too much power/i.test(line)))
  assert.ok(over.throughput < within.throughput)
})

test("the plain explanation names the second site without nerd units", () => {
  const build = winning("chat")
  const result = evaluateBuild("chat", build)
  const choices = { ...expertChoices("chat"), cities: 2 }
  const plain = explainResult(result, choices, { nerd: false })
  const line = plain.lines.map((item) => item.show).join(" ")
  assert.match(line, /second site in Frankfurt/)
  assert.match(line, /40% of users/)
  assert.doesNotMatch(line, /\bms\b/)
  const nerd = explainResult(result, choices, { nerd: true })
  assert.match(nerd.lines.map((item) => item.show).join(" "), /from \d+ ms to (\d+|under 1) ms/)
})
