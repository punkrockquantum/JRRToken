import assert from "node:assert/strict"
import test from "node:test"
import { NETWORKS, USE_CASES, byId } from "../js/data.js"
import { wireImpact } from "../js/impact.js"
import { OPTIONS, legRtt } from "../js/latency.js"
import { linkProfile, metroOffers } from "../js/model.js"
import { LEAD_DAYS } from "../js/network.js"
import { FIBRE_S_PER_KM, ROUTE, roundTripS } from "../js/physics.js"
import { expertChoices, metroSets, wireIds } from "../js/presets.js"
import { simpleDefaults } from "../js/steps.js"

/*
 * The user's correction: "ServiceFabric is not worse latency than peering and it is much better
 * than public internet." ServiceFabric is Digital Realty's private software-defined
 * interconnection; peering at an exchange shortens public paths but is still shared; the public
 * internet is transit. The physics table, the per-leg engine and the tiles must all agree.
 */

const KM = [0, 1, 2, 5, 15, 100, 360, 640, 1900, 5900, 6600, 10000]

test("one physics table: 4.9 µs per km, and cross ≤ fiber ≤ fabric = mcp ≤ eye ≤ peer < public at every distance", () => {
  assert.equal(FIBRE_S_PER_KM, 4.9e-6)
  for (const km of KM) {
    const rtt = (id) => linkProfile(byId(NETWORKS, id), km).rttS
    /* Inside the campus a cross connect is a few microseconds of patch; beyond it the trip is fibre physics, like dark fibre. */
    if (km >= 1) assert.ok(rtt("cross") <= rtt("fiber") + 1e-12, `${km} km cross ${rtt("cross")} ≤ fiber ${rtt("fiber")}`)
    assert.ok(rtt("cross") <= rtt("fabric"), `${km} km cross ≤ fabric`)
    assert.ok(rtt("fiber") <= rtt("fabric"), `${km} km fiber ≤ fabric`)
    assert.equal(rtt("fabric"), rtt("mcp"), `${km} km MCP is the same fabric`)
    assert.ok(rtt("fabric") <= rtt("eye"), `${km} km fabric ≤ eyeball`)
    assert.ok(rtt("eye") <= rtt("peer"), `${km} km eyeball ≤ peering`)
    assert.ok(rtt("peer") < rtt("public"), `${km} km peering < public`)
    /* The open internet is at least twice ServiceFabric's round trip and at least 20 ms slower, from the first km. */
    assert.ok(rtt("public") >= 2 * rtt("fabric"), `${km} km public ${rtt("public")} ≥ 2 × fabric ${rtt("fabric")}`)
    assert.ok(rtt("public") - rtt("fabric") >= 0.02, `${km} km public is ≥ 20 ms slower than fabric`)
    /* Jitter and loss follow the same order. */
    const jit = (id) => linkProfile(byId(NETWORKS, id), km).jitterS
    assert.ok(jit("fabric") <= jit("eye") && jit("eye") <= jit("peer") && jit("peer") <= jit("public"), `${km} km jitter order`)
    assert.ok(ROUTE.fabric.loss === 0 && ROUTE.peer.loss > 0 && ROUTE.public.loss > ROUTE.peer.loss, "loss order")
    /* The latency readout and the scoring engine read the same table. */
    assert.equal(legRtt(km, "fabric").rttS, roundTripS(km, "fabric"), `${km} km latency.js fabric`)
    assert.equal(legRtt(km, "internet").rttS, roundTripS(km, "public"), `${km} km latency.js internet`)
    assert.equal(legRtt(km, "peer").rttS, roundTripS(km, "peer"), `${km} km latency.js peer`)
    if (km > 2) assert.equal(linkProfile(byId(NETWORKS, "fabric"), km).rttS, roundTripS(km, "fabric"), `${km} km model.js fabric`)
  }
  assert.deepEqual(Object.keys(OPTIONS), ["internet", "peer", "fabric", "fiber", "cross"])
  assert.equal(OPTIONS.internet.inflation, ROUTE.public.inflation)
  /* Lead times: a ServiceFabric port (15-day published SLA) is live before an exchange port or an eyeball hand-off. */
  assert.ok(LEAD_DAYS.fabricPort <= LEAD_DAYS.peer && LEAD_DAYS.peer <= LEAD_DAYS.eye, "fabric is live first")
  assert.ok(LEAD_DAYS.peer <= LEAD_DAYS.public, "peering is live no later than transit")
})

const FEEL = { smooth: 0, stutters: 1, stalls: 2 }

test("every story × metro set × crowd × simple wire tile: ServiceFabric is never worse than Peering, Peering never worse than the open internet", () => {
  let checked = 0
  for (const useCase of USE_CASES) {
    const id = useCase.id
    const batch = (useCase.legs || []).some((leg) => leg.slaExempt)
    const sets = metroSets(id, metroOffers(id).map((offer) => offer.id))
    const wires = wireIds(id)
    assert.ok(["cheap", "peer", "fast"].every((wire) => wires.includes(wire)), `${id} offers the three plain tiles`)
    for (const base of [simpleDefaults(id), expertChoices(id)]) {
      for (const users of ["small", "medium", "large"]) {
        for (const metros of sets) {
          const on = Object.fromEntries(["cheap", "peer", "fast"].map((wire) => [wire, wireImpact(id, { ...base, metros, users, wires: wire }, wire, false)]))
          const label = `${id} ${users} ${metros.join("+")}`
          const fast = on.fast.result
          const peer = on.peer.result
          const cheap = on.cheap.result
          /* The shown first-token time, stream label and GPU-idle share never get worse as the product gets better. */
          assert.ok(fast.ttft <= peer.ttft + 1e-9, `${label} first token: ServiceFabric ${fast.ttft} vs Peering ${peer.ttft}`)
          assert.ok(peer.ttft <= cheap.ttft + 1e-9, `${label} first token: Peering ${peer.ttft} vs internet ${cheap.ttft}`)
          assert.ok(FEEL[on.fast.stream.feel] <= FEEL[on.peer.stream.feel], `${label} stream: ${on.fast.stream.feel} vs ${on.peer.stream.feel}`)
          assert.ok(FEEL[on.peer.stream.feel] <= FEEL[on.cheap.stream.feel], `${label} stream: ${on.peer.stream.feel} vs ${on.cheap.stream.feel}`)
          assert.ok((fast.wireIdle || 0) <= (peer.wireIdle || 0) + 1e-9, `${label} GPU idle: ServiceFabric ${fast.wireIdle} vs Peering ${peer.wireIdle}`)
          assert.ok((peer.wireIdle || 0) <= (cheap.wireIdle || 0) + 1e-9, `${label} GPU idle: Peering ${peer.wireIdle} vs internet ${cheap.wireIdle}`)
          assert.ok((fast.pMiss || 0) <= (peer.pMiss || 0) + 1e-9, `${label} P(miss)`)
          /* Scores follow: live-user stories strictly prefer the better product; batch screening may tie. */
          if (batch) {
            assert.ok(fast.score >= peer.score, `${label} score: ServiceFabric ${fast.score} vs Peering ${peer.score}`)
            assert.ok(peer.score >= cheap.score, `${label} score: Peering ${peer.score} vs internet ${cheap.score}`)
          } else {
            assert.ok(fast.score >= peer.score, `${label} score: ServiceFabric ${fast.score} vs Peering ${peer.score}`)
            assert.ok(peer.score >= cheap.score, `${label} score: Peering ${peer.score} vs internet ${cheap.score}`)
            if (fast.score > 0 && fast.score === peer.score) assert.ok(fast.ttft < peer.ttft + 1e-9, `${label} a tied score still shows ServiceFabric's shorter first token`)
          }
          /* Each tile's users leg really is that product (or a cross connect where the users are in the building). */
          const legOf = (result) => (result.legResults || []).find((leg) => leg.id === "users" || leg.id === "lab")
          assert.ok(["fabric", "cross"].includes(legOf(fast)?.kind), `${label} ServiceFabric tile users leg: ${legOf(fast)?.kind}`)
          assert.ok(["peer", "eye", "cross"].includes(legOf(peer)?.kind), `${label} Peering tile users leg: ${legOf(peer)?.kind}`)
          assert.equal(legOf(cheap)?.kind, "public", `${label} internet tile users leg`)
          checked += 1
        }
      }
    }
  }
  assert.ok(checked >= 250, `${checked} combinations checked`)
})

test("a right-sized ServiceFabric link never caps the crowd it was sized for, and its ingress pipe is at least 1 Gbps", () => {
  for (const useCase of USE_CASES) {
    for (const users of ["small", "medium", "large"]) {
      const impact = wireImpact(useCase.id, { ...expertChoices(useCase.id), users, wires: "fast" }, "fast", false)
      const result = impact.result
      /* A build that cannot load its model never reaches the wire; every other build's pipe carries the whole crowd. */
      if (result.bottleneck !== "fit") assert.ok(result.capTok >= result.demand, `${useCase.id} ${users} the ServiceFabric pipe carries ${result.capTok} of ${result.demand} tok/s`)
      for (const leg of result.legResults.filter((item) => item.kind === "fabric" && item.id !== "control")) {
        assert.ok(leg.gbps >= 1, `${useCase.id} ${users} ${leg.id} is a ${leg.gbps} Gbps link`)
      }
    }
  }
})
