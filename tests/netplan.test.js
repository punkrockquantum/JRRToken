import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { USE_CASES } from "../js/data.js"
import { ecosystem } from "../js/eco.js"
import { evaluateBuild } from "../js/model.js"
import { PRODUCTS, legacyWires, netHint, netIds, netOf, routeProducts, toggleProduct } from "../js/netplan.js"
import { bestConnectivity, routeKey, routeSummary } from "../js/optimise.js"
import { choicesToBuild, defaultChoices, expertChoices, metroSets } from "../js/presets.js"
import { applyTile, metroShortList, stepTiles, stepValue, tileOn, wiresHint } from "../js/steps.js"

const STORY_IDS = USE_CASES.map((useCase) => useCase.id)
const score = (id, choices, nerd) => evaluateBuild(id, choicesToBuild(id, choices, nerd))
const light = (id, choices, nerd) => ecosystem(score(id, choices, nerd)).find((part) => part.id === "connections")

test("ServiceFabric MCP is a visible product tile on the NET step in both modes, in the order the user asked for", () => {
  for (const id of STORY_IDS) {
    const simple = stepTiles(id, "wires", false, defaultChoices(id)).map((tile) => tile.label)
    assert.deepEqual(simple, ["Public internet", "Cross Connect", "ServiceFabric", "ServiceFabric MCP", "Dark Fiber"], `${id} simple tiles`)
    const nerd = stepTiles(id, "wires", true, defaultChoices(id)).map((tile) => tile.label)
    assert.deepEqual(nerd.slice(0, 5), simple, `${id} nerd starts with the simple five`)
    assert.deepEqual(nerd.slice(5), ["Peering", "Digital Internet", "Cloud on-ramp", "Metro Connect", "Pathway"], `${id} nerd adds the catalogue`)
    const mcp = stepTiles(id, "wires", false, defaultChoices(id)).find((tile) => tile.id === "mcp")
    assert.match(mcp.lines.join(" "), /Model Context Protocol server lets an AI agent see and configure ServiceFabric/)
    assert.match(mcp.lines.join(" "), /agentic routing/i)
    assert.equal(netIds(id, false).length, 5)
    assert.equal(netIds(id, true).length, PRODUCTS.length)
  }
})

test("product tiles multi-select: a tap toggles, the last product stays, and MCP without ServiceFabric shows the hint", () => {
  const base = defaultChoices("rag")
  assert.deepEqual(stepValue("rag", "wires", base), ["public"], "the opening wire is the public internet")
  const withFabric = applyTile("rag", "wires", "fabric", base, false)
  assert.deepEqual(stepValue("rag", "wires", withFabric), ["public", "fabric"])
  const fabricOnly = applyTile("rag", "wires", "public", withFabric, false)
  assert.deepEqual(stepValue("rag", "wires", fabricOnly), ["fabric"])
  const still = applyTile("rag", "wires", "fabric", fabricOnly, false)
  assert.deepEqual(stepValue("rag", "wires", still), ["fabric"], "the last product cannot be removed")
  const mcpOnly = applyTile("rag", "wires", "mcp", applyTile("rag", "wires", "public", applyTile("rag", "wires", "mcp", base, false), false), false)
  assert.deepEqual(stepValue("rag", "wires", mcpOnly), ["mcp"])
  assert.equal(wiresHint("rag", mcpOnly), "MCP configures ServiceFabric: add it too.")
  assert.equal(netHint(["fabric", "mcp"]), "")
  assert.equal(wiresHint("rag", applyTile("rag", "wires", "fabric", mcpOnly, false)), "")
  const tiles = stepTiles("rag", "wires", false, withFabric)
  assert.deepEqual(tiles.filter((tile) => tileOn("rag", "wires", tile, withFabric)).map((tile) => tile.id), ["public", "fabric"])
  assert.deepEqual(toggleProduct(["fabric"], "nonsense"), ["fabric"])
  assert.equal(legacyWires(["mcp"]), "cheap", "MCP alone is not a fabric")
  assert.equal(legacyWires(["fabric", "mcp"]), "fast")
  assert.equal(legacyWires(["fabric", "cross"]), "private")
})

test("the router treats ServiceFabric + MCP as one product: fabric legs go agent-configured and the control leg carries MCP", () => {
  const useCase = USE_CASES.find((item) => item.id === "code")
  const routed = routeProducts(useCase, ["iad", "sjc"], false, ["fabric", "mcp", "cross"])
  assert.equal(routed.agent, true)
  assert.equal(routed.routes.control.kind, "mcp")
  assert.equal(routed.routes.users.kind, "mcp", "the users leg rides the fabric, agent-configured")
  assert.equal(routed.routes.tools.kind, "cross", "the repos are one cross connect away")
  assert.deepEqual(routed.unused, [])
  const alone = routeProducts(useCase, ["iad"], false, ["mcp", "public"])
  assert.equal(alone.agent, false)
  assert.equal(alone.routes.control.kind, "off")
  assert.deepEqual(alone.unused, ["mcp"], "MCP without the fabric carries nothing")
  const pinned = routeProducts(useCase, ["iad"], false, ["fabric", "public"], { users: "public" })
  assert.equal(pinned.routes.users.kind, "public", "a pinned product carries its leg")
  assert.equal(pinned.routes.tools.kind, "fabric")
})

test("legacy choice sets still read as a product set and score as before", () => {
  for (const id of STORY_IDS) {
    const expert = expertChoices(id)
    const net = netOf(id, expert, undefined)
    assert.ok(net.length >= 1, id)
    assert.ok(Array.isArray(stepValue(id, "wires", expert)), id)
    const before = score(id, { ...expert, wires: "fast" }, false).score
    assert.ok(before > 0, id)
  }
})

test("OPTIMISE ROUTING: green CONNECTIONS light for every story × metro set within the default budget, in both modes", () => {
  for (const id of STORY_IDS) {
    for (const metros of metroSets(id, metroShortList(id))) {
      for (const nerd of [false, true]) {
        const base = { ...defaultChoices(id), metros }
        const out = bestConnectivity(id, metros, null, base, nerd)
        const result = score(id, out.choices, nerd)
        assert.ok(result.ok, `${id} ${metros} ${nerd}: scored`)
        assert.ok(!result.overBudget, `${id} ${metros} ${nerd}: inside the budget`)
        assert.equal(light(id, out.choices, nerd).state, "green", `${id} ${metros} ${nerd}: ${light(id, out.choices, nerd).why}`)
        assert.ok(out.after.score >= out.before.score - 1e-9, `${id} ${metros} ${nerd}: never worse (${out.before.score} → ${out.after.score})`)
        assert.equal(out.choices.routed.key, routeKey(id, metros))
      }
    }
  }
})

test("OPTIMISE ROUTING never scores below the current selection and is idempotent", () => {
  const sets = [["public"], ["fabric"], ["fabric", "mcp"], ["cross", "fiber"], ["public", "cross", "fabric", "mcp", "fiber"]]
  for (const id of STORY_IDS) {
    for (const nerd of [false, true]) {
      for (const net of sets) {
        const base = { ...expertChoices(id), net, wires: legacyWires(net) }
        const current = score(id, base, nerd).score
        const out = bestConnectivity(id, null, null, base, nerd)
        assert.ok(out.after.score >= current - 1e-9, `${id} ${nerd} ${net}: ${current} → ${out.after.score}`)
        const again = bestConnectivity(id, null, null, out.choices, nerd)
        assert.equal(again.changed, false, `${id} ${nerd} ${net}: a second click changes nothing`)
        assert.deepEqual(again.choices.net, out.choices.net)
        assert.deepEqual(again.choices.legs || {}, out.choices.legs || {})
        assert.equal(again.after.score, out.after.score)
      }
    }
  }
})

test("with MCP selected the optimiser keeps it and labels the result agent-routed; the summary names first token and cost per 1M tokens", () => {
  const base = { ...expertChoices("research"), net: ["fabric", "mcp"], wires: "fast" }
  const out = bestConnectivity("research", null, null, base, false)
  assert.ok(out.choices.net.includes("mcp"), out.choices.net.join(","))
  assert.equal(out.label, "agent-routed")
  assert.equal(out.agent, true)
  assert.match(out.summary, /^First token .+ → .+ · \$[\d.,]+[kM]? → \$[\d.,]+[kM]? per 1M tokens$/)
  assert.ok(out.lines.some((line) => /Users → ServiceFabric \(private, agent-configured, [\d.]+ ms\)/.test(line)), out.lines.join(" | "))
  assert.equal(light("research", out.choices, false).state, "green")
  assert.match(light("research", out.choices, false).why, /^Agent-routed/)
  const plain = bestConnectivity("research", null, null, { ...expertChoices("research"), net: ["public"], wires: "cheap" }, false)
  assert.equal(plain.label, "optimised")
  assert.ok(plain.lines.some((line) => /skipped/.test(line)), "the toast says what was skipped and why")
})

test("a nerd leg pinned to something worse turns the relative CONNECTIONS light amber or red; unpinning it is green again", () => {
  const out = bestConnectivity("rag", null, null, { ...expertChoices("rag"), net: ["public", "fabric", "cross"], wires: "private" }, true)
  assert.equal(light("rag", out.choices, true).state, "green")
  const worse = { ...out.choices, net: [...new Set([...out.choices.net, "public"])], legs: { ...(out.choices.legs || {}), users: "public" } }
  const part = light("rag", worse, true)
  assert.ok(part.state === "amber" || part.state === "red", `${part.state}: ${part.why}`)
  assert.match(part.why, /below the optimised one/)
  const summary = routeSummary("rag", worse, true)
  assert.equal(summary.legs.find((leg) => leg.id === "users").kind, "public")
  const back = { ...worse, legs: {} }
  assert.equal(light("rag", back, true).state, "green")
})

test("the product set snaps between boards: nerd-only products land on the simple product they refine", () => {
  const nerd = { ...expertChoices("rag"), net: ["dinet", "onramp", "ix"], wires: "private" }
  const simple = choicesToBuild("rag", nerd, false)
  assert.deepEqual(simple.choices.net, ["fabric", "cross", "public"])
  const kept = choicesToBuild("rag", nerd, true)
  assert.deepEqual(kept.choices.net, ["dinet", "onramp", "ix"])
})

test("the smokes press OPTIMISE ROUTING and read the CONNECTIONS light", () => {
  const desktop = readFileSync(new URL("../scripts/smoke.mjs", import.meta.url), "utf8")
  const mobile = readFileSync(new URL("../scripts/smoke-mobile.mjs", import.meta.url), "utf8")
  for (const [name, text] of [["smoke.mjs", desktop], ["smoke-mobile.mjs", mobile]]) {
    assert.match(text, /data-key="net-optimise"/, `${name} clicks net-optimise`)
    assert.match(text, /data-part="connections"/, `${name} reads the CONNECTIONS light`)
  }
})
