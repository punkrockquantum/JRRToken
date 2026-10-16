import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { HALLS, PLATFORMS, USE_CASES, byId } from "../js/data.js"
import { evaluateBuild } from "../js/model.js"
import { brainPick, choicesToBuild, expertChoices, simpleChoices } from "../js/presets.js"
import {
  REFARCH,
  designCard,
  designFacts,
  designFor,
  designLines,
  designsFor,
  fitsHall,
  leadBand,
  nodesPerRack,
  racksNeeded,
  referenceDesign,
  withDesign,
} from "../js/refarch.js"
import { applyTile, stepTiles } from "../js/steps.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
/** The OEM names that may appear in code comments beside a datasheet URL and nowhere a player can read. */
const VENDORS = /Dell|Supermicro|HPE|Hewlett|Lenovo|Cray|PowerEdge|ThinkSystem/

function filesIn(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) filesIn(path, out)
    else if (/\.(js|mjs|css|html)$/.test(name)) out.push(path)
  }
  return out
}

/** Source with its comments removed: block comments anywhere, line comments that are a whole line. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

const nerdBuild = (id, patch = {}) => choicesToBuild(id, { ...expertChoices(id), ...patch }, true)

test("every platform has three or four anonymised designs with the plan's fields, the platform's own design first", () => {
  for (const platform of PLATFORMS) {
    const designs = designsFor(platform.id)
    assert.ok(designs.length >= 3 && designs.length <= 4, `${platform.id} offers ${designs.length} designs`)
    assert.equal(designs.filter((design) => design.reference).length, 1, `${platform.id} has one reference design`)
    assert.equal(designs[0], referenceDesign(platform.id), `${platform.id} lists its reference design first`)
    assert.deepEqual(designs.map((design) => design.letter), ["A", "B", "C", "D"].slice(0, designs.length), `${platform.id} letters`)
    assert.equal(new Set(designs.map((design) => design.id)).size, designs.length, `${platform.id} ids are unique`)
    for (const design of designs) {
      for (const key of ["id", "letter", "form", "who", "kind", "cpu", "memory", "nics", "nvme", "cooling"]) assert.equal(typeof design[key], "string", `${design.id}.${key}`)
      for (const key of ["gpusPerNode", "u", "nodeKW", "leadDelta", "priceMult"]) assert.equal(typeof design[key], "number", `${design.id}.${key}`)
      assert.ok(["node", "rack"].includes(design.kind), design.id)
      if (design.kind === "rack") {
        assert.equal(design.traysPerRack, 18, `${design.id} is an NVL72-class rack of 18 trays`)
        assert.equal(design.gpusPerNode, 4, design.id)
        assert.ok(design.rackKW > 100, design.id)
        assert.equal(platform.cooling, "liquid", `${design.id} belongs to a liquid platform`)
      } else if (platform.hbmTBs < 2) {
        /* PCIe cards: eight 350–600 W GPUs in a 3U–4U air box. */
        assert.equal(design.gpusPerNode, 8, `${design.id} is an 8-GPU PCIe node`)
        assert.ok(design.u >= 3 && design.u <= 5, design.id)
        assert.ok(design.nodeKW >= 3 && design.nodeKW <= 8, design.id)
        assert.equal(design.cooling, "air", `${design.id} PCIe servers are air-cooled`)
      } else {
        assert.equal(design.gpusPerNode, 8, `${design.id} is an 8-GPU HGX node`)
        assert.ok(design.u >= 4 && design.u <= 10, design.id)
        assert.ok(design.nodeKW >= 10 && design.nodeKW <= 16, design.id)
      }
      assert.ok(Math.abs(design.leadDelta) <= 4, `${design.id} lead shift is modest`)
      assert.ok(design.priceMult >= 0.9 && design.priceMult <= 1.1, `${design.id} price shift is modest`)
      for (const hall of HALLS) {
        const facts = designFacts(design, platform.id, hall.id, 96)
        assert.deepEqual(facts.map(([label]) => label), ["GPUs/node", "Height", "CPUs", "Memory", "NICs", "NVMe", "Node power", "Cooling", "Nodes/rack", "Racks", "Lead"], design.id)
        for (const [label, value] of facts) assert.ok(typeof value === "string" && value.length > 0, `${design.id} ${hall.id} ${label}`)
        const lines = designLines(design, platform.id, hall.id, 96)
        assert.equal(lines.length, 3, `${design.id} learn lines`)
        const card = designCard(design, platform.id, hall.id, 96)
        assert.match(card.title, /^[A-D] · /, design.id)
        assert.match(card.lead, /^lead \d+–\d+ wk/, `${design.id} ${card.lead}`)
      }
    }
    assert.equal(designFor(platform.id, "no-such-design"), null)
    assert.equal(designFor(platform.id, null), null)
  }
  assert.equal(designsFor("h100"), designsFor("h200"), "HGX H100 and H200 share the Hopper chassis designs")
  assert.equal(designsFor("b300n"), designsFor("b300"), "the single HGX B300 node ships in the same chassis designs as the rack")
  assert.notEqual(designsFor("l40s"), designsFor("rtx6000"), "the two PCIe cards have their own server lists")
})

test("player text never names a vendor: designs, cards, facts, learn lines and every non-comment line of source", () => {
  assert.doesNotMatch(JSON.stringify(REFARCH), VENDORS, "the design data itself")
  for (const platform of PLATFORMS) {
    for (const design of designsFor(platform.id)) {
      for (const hall of HALLS) {
        const text = [
          ...designFacts(design, platform.id, hall.id, 72).flat(),
          ...designLines(design, platform.id, hall.id, 72),
          ...Object.values(designCard(design, platform.id, hall.id, 72)),
        ].join(" ")
        assert.doesNotMatch(text, VENDORS, `${design.id} in ${hall.id}`)
      }
    }
  }
  const files = ["js", "css"].flatMap((dir) => filesIn(join(root, dir)))
  files.push(join(root, "index.html"))
  const hits = files.filter((path) => VENDORS.test(withoutComments(readFileSync(path, "utf8")))).map((path) => path.slice(root.length + 1))
  assert.deepEqual(hits, [], "vendor names outside comments")
  const sourced = readFileSync(join(root, "js/refarch.js"), "utf8")
  assert.ok((sourced.match(/https?:\/\/\S+/g) || []).length >= 20, "the datasheet URLs sit in the comments")
  assert.doesNotMatch(withoutComments(sourced), /https?:\/\//, "no URL outside a comment: the player never sees a datasheet link")
})

test("nodes per rack follow the hall's power cap or the rack's height, and rack-scale designs bring 18 trays", () => {
  const air = byId(HALLS, "A")
  const rear = byId(HALLS, "R")
  const liquid = byId(HALLS, "B")
  const hopperRef = referenceDesign("h100")
  assert.equal(nodesPerRack(hopperRef, air), 3, "10.2 kW nodes: three in a 40 kW rack")
  assert.equal(nodesPerRack(hopperRef, rear), 5, "a 70 kW rear-door rack would take six, but five 8U nodes fill 42U")
  assert.equal(nodesPerRack(hopperRef, liquid), 5, "an 8U node fills 42U five times before 240 kW bites")
  assert.equal(nodesPerRack(referenceDesign("b200"), air), 2, "14.3 kW Blackwell nodes: two in a 40 kW rack, as the game's rack")
  assert.equal(nodesPerRack(referenceDesign("b300"), liquid), 4, "four 10U nodes fill 42U")
  for (const id of ["gb200", "gb300", "vr"]) for (const hall of HALLS) assert.equal(nodesPerRack(referenceDesign(id), hall), 18, `${id} ${hall.id}`)
  assert.equal(racksNeeded(referenceDesign("b300"), air, 96), 6, "six 16-GPU racks for 96 GPUs on air")
  assert.equal(racksNeeded(referenceDesign("b300"), rear, 96), 3, "four nodes a rack at 70 kW: three racks")
  assert.equal(racksNeeded(referenceDesign("gb200"), liquid, 144), 2)
  assert.equal(racksNeeded(referenceDesign("gb200"), liquid, 0), 0)
  assert.equal(fitsHall(referenceDesign("gb200"), air), false, "an NVL72 rack wants the liquid hall")
  assert.equal(fitsHall(referenceDesign("gb200"), liquid), true)
  assert.equal(fitsHall(referenceDesign("h100"), air), true)
  const band = leadBand(referenceDesign("b300"), byId(PLATFORMS, "b300"))
  assert.deepEqual([band.lo, band.mid, band.hi], [11, 12, 13])
  assert.match(leadBand(referenceDesign("vr"), byId(PLATFORMS, "vr")).text, /\(announced\)$/)
})

test("the reference design ships the platform's own numbers; the others shift power, lead and price modestly and never the GPUs", () => {
  for (const platform of PLATFORMS) {
    const ref = withDesign(platform, referenceDesign(platform.id))
    assert.deepEqual([ref.rackKW, ref.leadWeeks, ref.capex, ref.gpusPerRack, ref.tokPerGpu], [platform.rackKW, platform.leadWeeks, platform.capex, platform.gpusPerRack, platform.tokPerGpu], platform.id)
    for (const design of designsFor(platform.id)) {
      const shipped = withDesign(platform, design)
      assert.equal(shipped.id, platform.id)
      assert.equal(shipped.name, platform.name, "the player still sees the NVIDIA platform name")
      assert.deepEqual([shipped.gpusPerRack, shipped.tokPerGpu, shipped.hbmGB, shipped.domain, shipped.cooling, shipped.supply], [platform.gpusPerRack, platform.tokPerGpu, platform.hbmGB, platform.domain, platform.cooling, platform.supply], design.id)
      assert.ok(Math.abs(shipped.rackKW / platform.rackKW - 1) <= 0.1, `${design.id} rack power within 10%: ${shipped.rackKW} vs ${platform.rackKW}`)
      assert.ok(Math.abs(shipped.leadWeeks - platform.leadWeeks) <= 4, `${design.id} lead within four weeks`)
      assert.ok(Math.abs(shipped.capex / platform.capex - 1) <= 0.1, `${design.id} price within 10%`)
    }
  }
  assert.equal(withDesign(null, referenceDesign("h100")), null)
  assert.equal(withDesign(byId(PLATFORMS, "h100"), null), byId(PLATFORMS, "h100"))
})

test("a design on the build nudges the score, power, lead and cabinets a little; the reference design changes nothing", () => {
  let powerMoved = 0
  let leadMoved = 0
  let cabinetsMoved = 0
  let tipped = 0
  for (const { id } of USE_CASES) {
    const plain = evaluateBuild(id, nerdBuild(id))
    const platformId = plain.platform.id
    assert.equal(plain.design, null)
    assert.deepEqual(plain.cabinets, plain.siteRacks, `${id}: without a design the cabinets are the game's racks`)
    const ref = evaluateBuild(id, nerdBuild(id, { refarch: referenceDesign(platformId).id }))
    assert.equal(ref.design?.id, referenceDesign(platformId).id)
    assert.equal(ref.score, plain.score, `${id}: the reference design scores exactly the plain build`)
    assert.equal(ref.itKW, plain.itKW, id)
    assert.equal(ref.liveWeeks, plain.liveWeeks, id)
    for (const design of designsFor(platformId)) {
      const result = evaluateBuild(id, nerdBuild(id, { refarch: design.id }))
      assert.equal(result.design?.id, design.id, `${id} ${design.id} is applied`)
      assert.equal(result.gpus, plain.gpus, `${id} ${design.id}: the GPU count never changes`)
      assert.equal(result.racks, plain.racks, `${id} ${design.id}: the game's rack units never change`)
      /* The inputs move a little. The score follows the model: a hotter or dearer box can tip a build that sits
         at the edge of a small power room or budget (RAG's 0.27 MW, $7.72M suite) over the cliff, and the card
         warns before the pick. */
      const cliff = (result.overPower && !plain.overPower) || (result.overBudget && !plain.overBudget) || result.lateWeeks > plain.lateWeeks
      if (cliff) tipped += 1
      else assert.ok(result.score >= plain.score * 0.75 && result.score <= plain.score * 1.25, `${id} ${design.id}: ${result.score} vs ${plain.score} is a modest change`)
      assert.ok(Math.abs(result.itKW / plain.itKW - 1) <= 0.1, `${id} ${design.id}: IT power within 10%`)
      assert.ok(Math.abs(result.liveWeeks - plain.liveWeeks) <= 4, `${id} ${design.id}: go-live within four weeks`)
      assert.ok(result.cabinets.every((count, index) => count <= plain.siteRacks[index]), `${id} ${design.id}: a denser rack never needs more cabinets than the game's racks`)
      if (result.itKW !== plain.itKW) powerMoved += 1
      if (result.liveWeeks !== plain.liveWeeks) leadMoved += 1
      if (result.cabinets.some((count, index) => count !== plain.siteRacks[index])) cabinetsMoved += 1
    }
    const wrong = evaluateBuild(id, nerdBuild(id, { refarch: "no-such-design" }))
    assert.equal(wrong.design, null)
    assert.equal(wrong.score, plain.score, `${id}: an unknown design is ignored`)
  }
  assert.ok(powerMoved > 0 && leadMoved > 0 && cabinetsMoved > 0, `designs move power (${powerMoved}), lead (${leadMoved}) and cabinets (${cabinetsMoved}) somewhere`)
  assert.ok(tipped <= 6, `only a handful of story × design pairs fall off a power or deadline cliff (${tipped})`)
  /* The RAG suite is the known cliff: its expert build leaves about 1% of the power room spare. */
  const rag = evaluateBuild("rag", nerdBuild("rag"))
  assert.ok(rag.siteKW <= rag.powerCapKW && rag.siteKW > rag.powerCapKW * 0.97, `rag sits just under its power cap: ${rag.siteKW} of ${rag.powerCapKW}`)
  const cool = evaluateBuild("rag", nerdBuild("rag", { refarch: "b300-c" }))
  assert.deepEqual([cool.overPower, cool.overBudget], [false, true], "the direct-liquid B300 node fits the power room but its price breaks the $7.72M budget")
  assert.equal(evaluateBuild("rag", nerdBuild("rag", { refarch: "b300-b" })).overPower, true, "a hotter air box tips the suite over its power room")
})

test("the simple board forgets a design, nerd mode carries it, and a new GPU tile drops a design built for another platform", () => {
  const chat = { ...expertChoices("chat"), refarch: "gb200-c" }
  assert.equal(choicesToBuild("chat", chat, true).refarch, "gb200-c")
  assert.equal("refarch" in choicesToBuild("chat", chat, false), false, "the simple build has no design")
  assert.equal("refarch" in simpleChoices("chat", chat), false, "simple choices drop the design")
  assert.equal("refarch" in choicesToBuild("chat", expertChoices("chat"), true), false, "no design, no key")
  const kept = applyTile("chat", "gpu", "b300", { ...expertChoices("chat"), brains: "h100", refarch: "hgx-b" })
  assert.equal("refarch" in kept, false, "a B300 tile drops a Hopper node design")
  const hopper = applyTile("chat", "gpu", "h200", { ...expertChoices("chat"), brains: "h100", refarch: "hgx-b" })
  assert.ok(designFor("h200", "hgx-b") && designFor("h100", "hgx-b"), "Hopper HGX platforms share their node designs")
  assert.equal(hopper.refarch, "hgx-b", "the same design family keeps its design")
  const node = applyTile("chat", "gpu", "b300n", { ...expertChoices("chat"), brains: "b300", refarch: "b300-b" })
  assert.equal(node.refarch, "b300-b", "the single B300 node keeps the B300 chassis design")
  const dropped = applyTile("chat", "gpu", "gb200", { ...expertChoices("chat"), brains: "b300", refarch: "b300-b" })
  assert.equal(dropped.brains, "gb200")
  assert.equal("refarch" in dropped, false, "a GB200 tile drops a B300 design")
  for (const tile of stepTiles("chat", "gpu", true)) assert.ok(designsFor(tile.platform.id).length >= 3, `${tile.id} has designs`)
})
