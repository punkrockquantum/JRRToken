import assert from "node:assert/strict"
import test from "node:test"
import { USE_CASES, byId } from "../js/data.js"
import { detailLine, feelState, firstTokenState, idleState, wireImpact } from "../js/impact.js"
import { streamFeel } from "../js/latency.js"
import { evaluateBuild, formatSeconds } from "../js/model.js"
import { choicesToBuild, expertChoices, simpleChoices, wireIds } from "../js/presets.js"

test("every TOKEN IMPACT strip value is an evaluateBuild output for the same build", () => {
  for (const useCase of USE_CASES) {
    const base = expertChoices(useCase.id)
    for (const nerd of [false, true]) {
      for (const wires of wireIds(useCase.id, nerd)) {
        const strip = wireImpact(useCase.id, base, wires, nerd)
        const result = evaluateBuild(useCase.id, choicesToBuild(useCase.id, { ...base, wires }, nerd))
        const tag = `${useCase.id}/${wires}${nerd ? "/nerd" : ""}`
        assert.equal(strip.firstToken.seconds, result.ttft, `${tag} first token`)
        assert.equal(strip.firstToken.targetS, useCase.ttft, `${tag} target`)
        assert.equal(strip.idle.share, result.wireIdle, `${tag} idle`)
        assert.equal(strip.detail.pMiss, result.pMiss, `${tag} P(miss)`)
        assert.equal(strip.detail.mrc, result.net.mrc, `${tag} monthly`)
        assert.equal(strip.detail.nrc, result.net.nrc, `${tag} one-off`)
        assert.equal(strip.detail.leadDays, result.net.leadDays, `${tag} lead`)
        assert.equal(strip.result.score, result.score, `${tag} score`)
        const live = result.legResults.filter((leg) => leg.kind !== "off")
        assert.equal(strip.detail.legs.length, live.length, `${tag} legs`)
        for (const [i, leg] of live.entries()) {
          assert.equal(strip.detail.legs[i].rttMs, leg.rttS * 1000, `${tag} ${leg.id} rtt`)
          assert.equal(strip.detail.legs[i].jitterMs, leg.jitterS * 1000, `${tag} ${leg.id} jitter`)
          assert.equal(strip.detail.legs[i].loss, leg.loss, `${tag} ${leg.id} loss`)
          assert.equal(strip.detail.legs[i].gbps, leg.gbps, `${tag} ${leg.id} bandwidth`)
          assert.equal(strip.detail.legs[i].mrc, leg.mrc, `${tag} ${leg.id} cost`)
          assert.equal(strip.detail.legs[i].leadDays, leg.leadDays, `${tag} ${leg.id} lead`)
        }
        const batch = useCase.legs.some((leg) => leg.slaExempt)
        const ingress = live.find((leg) => /ingress|lab/.test(useCase.legs.find((item) => item.id === leg.id)?.role || ""))
        const expectedFeel = batch ? "smooth" : streamFeel(1 / result.streamTps, ingress ? ingress.jitterS : result.jitterS)
        assert.equal(strip.stream.feel, expectedFeel, `${tag} stream feel`)
        assert.ok(["good", "ok", "bad"].includes(strip.firstToken.state) && strip.stream.state === feelState(expectedFeel) && strip.idle.state === idleState(result.wireIdle), `${tag} colours`)
        assert.ok(strip.why.length > 20 && strip.why.length <= 130 && /[.!]$/.test(strip.why), `${tag} why is one sentence: ${strip.why}`)
        assert.ok(strip.firstToken.label.includes(formatSeconds(result.ttft)), `${tag} label quotes the first token`)
      }
    }
  }
})

test("the strip colours tell the truth: public internet idles the GPUs, robots on the open internet miss, private glass is green", () => {
  const robot = wireImpact("robot", expertChoices("robot"), "cheap")
  assert.equal(robot.firstToken.state, "bad")
  assert.ok(robot.detail.pMiss > 0.5)
  assert.match(robot.why, /miss the 50ms target/)
  const chat = wireImpact("chat", expertChoices("chat"), "cheap")
  assert.equal(chat.idle.state, "bad")
  assert.ok(chat.idle.share > 0.5, `public internet leaves the GPUs idle ${chat.idle.share}`)
  assert.match(chat.why, /idle \d+% of the time/)
  const combo = wireImpact("robot", expertChoices("robot"), "combo")
  assert.equal(combo.firstToken.state, "good")
  assert.equal(combo.stream.feel, "smooth")
  assert.equal(combo.idle.state, "good")
  assert.match(combo.why, /Private glass/)
  const drug = wireImpact("drug", expertChoices("drug"), "cheap")
  assert.match(drug.firstToken.label, /batch/)
  assert.match(drug.why, /never late/)
  assert.equal(firstTokenState(0.5, 1), "good")
  assert.equal(firstTokenState(0.9, 1), "ok")
  assert.equal(firstTokenState(1.1, 1), "bad")
})

test("the nerd line reads per-leg RTT, jitter, loss, bandwidth, then P(miss), monthly cost and lead time", () => {
  const strip = wireImpact("code", expertChoices("code"), "cheap", true)
  const line = detailLine(strip.detail)
  assert.match(line, /Public internet \d+ ms ±\d+ ms 0\.5% loss 10 Gbps/)
  assert.match(line, /P\(miss\) \d+%|P\(miss\) <1%/)
  assert.match(line, /\$[\d.]+k?\/mo/)
  assert.match(line, /\d+ wk lead|\d+ d lead|no lead time/)
  const fabric = detailLine(wireImpact("code", expertChoices("code"), "fast", true).detail)
  assert.doesNotMatch(fabric, /loss/, "ServiceFabric drops nothing")
  assert.match(fabric, /ServiceFabric [\d.]+ ms ±[\d.]+ ms [\d.]+ Gbps/)
})

test("the simple board snaps a nerd-only wire onto its tile before measuring, so the strip matches the pick it shows", () => {
  const base = expertChoices("chat")
  const snapped = simpleChoices("chat", { ...base, wires: "private" })
  assert.equal(wireImpact("chat", base, "private", false).result.score, wireImpact("chat", base, snapped.wires, false).result.score)
  assert.equal(byId(USE_CASES, "chat").ttft, wireImpact("chat", base, "fast").firstToken.targetS)
})
