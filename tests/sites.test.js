import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { searchBuilds } from "../js/balance.js"
import { DATA_HOMES, TRAIN_BONUS_CAP, USER_BASES, USE_CASES } from "../js/data.js"
import { defaultSitePlans, evaluateBuild, kmBetween, metroDistances, metroOffers } from "../js/model.js"
import { choicesToBuild, expertChoices } from "../js/presets.js"
import { explainResult } from "../js/explain.js"
import { stepTiles } from "../js/steps.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const main = readFileSync(join(root, "js/main.js"), "utf8")
const intro = readFileSync(join(root, "js/intro.js"), "utf8")

const WINNING = new Map()
function winning(id) {
  if (!WINNING.has(id)) WINNING.set(id, searchBuilds(id)[0].build)
  return WINNING.get(id)
}

test("closer to people is the site lesson: every metro tile says how far it is from the users and the data", () => {
  assert.match(intro, /Closer, cooler and better connected means faster answers for less money/)
  assert.match(main, /"data-key": "users-place"/)
  for (const { id } of USE_CASES) {
    const offers = metroOffers(id)
    assert.equal(offers.length, 4, `${id} short list`)
    const km = (value) => `${Math.round(value).toLocaleString("en-GB")} km`
    for (const tile of stepTiles(id, "location")) {
      const offer = offers.find((item) => item.id === tile.id)
      assert.ok(offer, `${id} ${tile.id} is on the short list`)
      /* Two different figures on every tile, both from the haversine table. */
      const users = metroDistances(id, tile.id)
      assert.notEqual(Math.round(users.usersKm), Math.round(users.dataKm), `${id} ${tile.id}: users ${Math.round(users.usersKm)} km and data ${Math.round(users.dataKm)} km must differ`)
      assert.equal(tile.tag, `Users: ${km(offer.usersKm)} · Data: ${km(offer.dataKm)}`.toUpperCase())
      assert.ok(tile.rows.length >= 2 && tile.rows.length <= 3, `${id} ${tile.id} lists each audience and the data`)
      assert.equal(tile.rows.at(-1).label, "Data")
      assert.equal(tile.rows.at(-1).text, offer.dataKm <= 60 ? "same city" : km(offer.dataKm))
      assert.match(tile.hint, /^(Beside|Close to|[A-Z])/, `${id} ${tile.id} pitch: ${tile.hint}`)
      assert.match(tile.lines[1], /from the .*; the model and data live in /)
      assert.ok(tile.nerd.startsWith(`Farthest users: ${users.worstCity} ${km(users.worstKm)}. `), `${id} ${tile.id} nerd line names the farthest region: ${tile.nerd}`)
      assert.ok(users.worstKm >= users.usersKm - 1e-9)
      /* The weighted average is the share-weighted haversine, and the data figure is the plain haversine. */
      const expected = USER_BASES[id].places.reduce((sum, place) => sum + place.share * kmBetween(place, offer.site), 0)
      assert.ok(Math.abs(expected - offer.usersKm) < 1e-9, `${id} ${tile.id} users km`)
      assert.ok(Math.abs(kmBetween(offer.site, DATA_HOMES[id]) - offer.dataKm) < 1e-9, `${id} ${tile.id} data km`)
    }
    const home = DATA_HOMES[id]
    const nearest = offers.reduce((a, b) => (b.dataKm < a.dataKm ? b : a))
    /* Chat and code keep their weights in a US cloud region; the European stories have a metro beside the data. */
    if (id === "chat") assert.ok(nearest.dataKm > 5000, `chat: every metro is an ocean away from ${home.city} (${Math.round(nearest.dataKm)} km)`)
    else if (id === "drug") assert.ok(nearest.dataKm > 300 && nearest.dataKm < 500, `drug: the libraries sit in a Dublin cloud region, about 460 km from London (${Math.round(nearest.dataKm)} km)`)
    else assert.ok(nearest.dataKm <= 80, `${id}: one metro on the list sits beside ${home.city} (${Math.round(nearest.dataKm)} km)`)
  }
  const drug = Object.fromEntries(metroOffers("drug").map((offer) => [offer.id, offer]))
  assert.ok(Math.abs(drug.lon.usersKm - 79) < 10 && Math.abs(drug.lon.dataKm - 464) < 20, `London is 79 km from the Cambridge lab and 464 km from its Dublin data (${Math.round(drug.lon.usersKm)}, ${Math.round(drug.lon.dataKm)})`)
  const chat = Object.fromEntries(metroOffers("chat").map((offer) => [offer.id, offer]))
  assert.ok(chat.lon.customersKm < chat.par.customersKm && chat.fra.customersKm < chat.par.customersKm, "London and Frankfurt are nearer the shoppers than Paris")
  assert.ok(chat.lon.employeesKm < chat.fra.employeesKm, "London is nearer the Leeds support team than Frankfurt")
  assert.ok(chat.lon.customersKm !== chat.lon.employeesKm && chat.lon.employeesKm !== chat.lon.dataKm, "every audience is a different trip from London")
  for (const id of ["rag", "code", "research", "drug"]) {
    for (const offer of metroOffers(id)) assert.equal(offer.customersKm, null, `${id} ${offer.id}: a staff-only story has no customer trip`)
  }
  assert.ok(Math.abs(chat.lon.dataKm - 5917) < 60, `London is about 5,900 km from the weights in Ashburn (${Math.round(chat.lon.dataKm)})`)
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
  assert.deepEqual(build.sites, ["lon", "fra"], "the engine's best chat build sits in London and Frankfurt")
  const result = evaluateBuild("chat", build)
  const choices = { ...expertChoices("chat"), metros: build.sites }
  const plain = explainResult(result, choices, { nerd: false })
  const line = plain.lines.map((item) => item.show).join(" ")
  assert.match(line, /second site in Frankfurt/)
  assert.match(line, /36% of users/)
  assert.doesNotMatch(line, /\bms\b/)
  const nerd = explainResult(result, choices, { nerd: true })
  assert.match(nerd.lines.map((item) => item.show).join(" "), /from \d+ ms to (\d+|under 1) ms/)
})
