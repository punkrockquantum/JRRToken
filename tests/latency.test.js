import assert from "node:assert/strict"
import test from "node:test"

import { DATA_HOMES, EGRESS_PER_GB, SITES } from "../js/data.js"
import {
  FIBRE_S_PER_KM,
  INFLATION,
  LATE_GOODPUT,
  OPTIONS,
  OPTION_IDS,
  egressUsd,
  fibreRttS,
  firstToken,
  goLiveDays,
  gpuIdle,
  internetRttS,
  lateFactor,
  legBetween,
  legRtt,
  mathisBps,
  normalCdf,
  pMiss,
  pacedStepS,
  streamFeel,
  tokenImpact,
  transferHours,
  ttftS,
  usableBps,
} from "../js/latency.js"
import { kmBetween } from "../js/model.js"

const site = (id) => SITES.find((row) => row.id === id)
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected} ±${tolerance}`)

test("light in glass: 4.9 µs per km, fibre routes 1.2× the great circle, internet paths 2×", () => {
  assert.equal(FIBRE_S_PER_KM, 4.9e-6)
  assert.deepEqual(INFLATION, { fibre: 1.2, internet: 2.0 })
  assert.equal(OPTIONS.fabric.inflation, 1.2)
  assert.equal(OPTIONS.fiber.inflation, 1.2)
  assert.equal(OPTIONS.internet.inflation, 2.0)
  assert.deepEqual(OPTION_IDS, ["internet", "peer", "fabric", "fiber", "cross"])
  for (const id of OPTION_IDS) {
    const option = OPTIONS[id]
    assert.ok(option.name && option.inflation >= 1 && option.overheadS >= 0 && option.jitterFrac >= 0 && option.loss >= 0 && option.gbps > 0, id)
  }
})

test("sanity: London to Frankfurt is about 640 km and 7.5 ms round trip on fibre", () => {
  const km = kmBetween(site("lon"), site("fra"))
  near(km, 640, 30, "LON-FRA km")
  near(fibreRttS(km) * 1000, 7.5, 0.5, "LON-FRA fibre RTT ms")
  near(legBetween(site("lon"), site("fra"), "fabric").rttS * 1000, 7.8, 0.5, "LON-FRA ServiceFabric RTT ms")
  near(legBetween(site("lon"), site("fra"), "fiber").rttS * 1000, 7.5, 0.5, "LON-FRA dark fiber RTT ms")
})

test("sanity: London to Ashburn is about 5,900 km, 69 ms on fibre and at least 140 ms on the internet", () => {
  const km = kmBetween(site("lon"), DATA_HOMES.chat)
  near(km, 5900, 100, "LON-Ashburn km")
  near(fibreRttS(km) * 1000, 69, 2, "LON-Ashburn fibre RTT ms")
  assert.ok(internetRttS(km) >= 0.14, `LON-Ashburn internet RTT ${internetRttS(km)}`)
  const internet = legRtt(km, "internet")
  assert.ok(internet.jitterS > 0.04 && internet.loss > 0, "the internet path is jittery and lossy")
  assert.ok(internet.pathKm > fibreRttS(km) / (2 * FIBRE_S_PER_KM), "the internet path is longer than the fibre route")
})

test("a leg carries its option's overheads; a cross connect is 100 µs whatever the metro", () => {
  const cross = legRtt(0.5, "cross")
  near(cross.rttS * 1e6, 100 + 2 * 0.5 * 4.9, 1, "cross connect µs")
  assert.equal(cross.jitterS, 0)
  assert.equal(cross.loss, 0)
  assert.equal(legRtt(100, "nonsense").option, "fabric", "unknown options fall back to ServiceFabric")
  assert.equal(legRtt(-5, "fiber").rttS, 0, "negative distances clamp to zero")
  const peer = legRtt(100, "peer")
  const fabric = legRtt(100, "fabric")
  const internet = legRtt(100, "internet")
  assert.ok(fabric.rttS < peer.rttS && peer.rttS < internet.rttS, "fabric beats peering beats the open internet")
  assert.ok(fabric.jitterS < peer.jitterS && peer.jitterS < internet.jitterS)
})

test("first token = users RTT + trips × data RTT + store + queue + prefill; bulk legs are exempt", () => {
  assert.equal(ttftS({ usersRttS: 0.05, trips: 8, dataRttS: 0.01, storeS: 0.02, queueS: 0.03, prefillS: 0.4 }), 0.05 + 0.08 + 0.02 + 0.03 + 0.4)
  assert.equal(ttftS(), 0)
  const legs = [
    { rttS: 0.05, jitterS: 0.01 },
    { rttS: 0.01, jitterS: 0.002, trips: 8 },
    { rttS: 0.2, jitterS: 0.07, trips: 100, slaExempt: true },
  ]
  const first = firstToken(legs, { storeS: 0.02, queueS: 0.03, prefillS: 0.4 })
  near(first.meanS, 0.05 + 0.08 + 0.45, 1e-9, "mean")
  near(first.jitterS, 0.01 + 0.016, 1e-9, "jitter")
  assert.deepEqual(firstToken([]), { meanS: 0, jitterS: 0 })
  assert.deepEqual(firstToken(null), { meanS: 0, jitterS: 0 })
})

test("jitter pacing: the stream is only as smooth as the jitter allows", () => {
  assert.equal(pacedStepS(0.02, 0.005), 0.02)
  assert.equal(pacedStepS(0.02, 0.05), 0.05)
  assert.equal(streamFeel(0.02, 0.005), "smooth")
  assert.equal(streamFeel(0.02, 0.02), "stutters")
  assert.equal(streamFeel(0.02, 0.05), "stalls")
  assert.equal(streamFeel(0, 1), "smooth", "no token step means nothing to pace")
  const km = kmBetween(site("lon"), DATA_HOMES.chat)
  assert.equal(streamFeel(0.02, legRtt(km, "internet").jitterS), "stalls", "a transatlantic internet stream stalls at 50 tok/s")
  assert.equal(streamFeel(0.02, legRtt(km, "fabric").jitterS), "smooth", "ServiceFabric keeps the same stream smooth")
})

test("loss: the Mathis bound caps a lossy path, never a clean one", () => {
  assert.equal(mathisBps(0.069, 0), Infinity)
  near(mathisBps(0.069, 0.005), 1460 / (0.069 * Math.sqrt(0.005)), 1, "Mathis bytes per second")
  assert.ok(mathisBps(0.069, 0.005) * 8 / 1e6 < 3, "about 2.4 Mbps across the Atlantic with half a percent loss")
  assert.equal(mathisBps(0.0001, 0.005), mathisBps(0.001, 0.005), "the bound floors the round trip at 1 ms")
  const clean = legRtt(640, "fabric")
  assert.equal(usableBps(clean), 100e9 / 8, "a clean 100G port is port-bound")
  const lossy = legRtt(5900, "internet")
  assert.ok(usableBps(lossy) < 10e9 / 8, "the lossy path is Mathis-bound, below its 10G port")
})

test("GPU idle = 1 − min(1, streams × step / (step + wait))", () => {
  near(gpuIdle(1, 0.02, 0.18), 0.9, 1e-9, "one stream waiting 180 ms")
  assert.equal(gpuIdle(10, 0.02, 0.18), 0)
  assert.equal(gpuIdle(1, 0.02, 0), 0)
  assert.equal(gpuIdle(0, 0.02, 0.18), 1)
  assert.equal(gpuIdle(1, 0, 0), 0, "no cycle means no idle share")
})

test("P(miss) is a normal approximation scaled by LATE_GOODPUT; exempt work never pays", () => {
  near(normalCdf(0), 0.5, 1e-7, "Φ(0)")
  near(normalCdf(1.96), 0.975, 1e-3, "Φ(1.96)")
  near(normalCdf(-1.96), 0.025, 1e-3, "Φ(-1.96)")
  assert.equal(normalCdf(Infinity), 1)
  assert.equal(normalCdf(-Infinity), 0)
  near(pMiss(1, 0.1, 1), 0.5, 1e-7, "mean on the target")
  assert.ok(pMiss(0.7, 0.1, 1) < 0.002, "three sigma under the target")
  assert.ok(pMiss(1.3, 0.1, 1) > 0.998, "three sigma over the target")
  assert.equal(pMiss(0.9, 0, 1), 0, "no jitter: a step at the target")
  assert.equal(pMiss(1.1, 0, 1), 1)
  assert.equal(LATE_GOODPUT, 0.25)
  assert.equal(lateFactor(0), 1)
  assert.equal(lateFactor(1), 0.25)
  near(lateFactor(0.5), 0.625, 1e-9, "half late")
  assert.equal(lateFactor(1, { slaExempt: true }), 1, "a bulk feed skips the SLA haircut")
  assert.equal(lateFactor(2), 0.25, "P(miss) clamps to one")
})

test("model transfer: hours over the pipe, egress per GB, whole days added to go-live", () => {
  near(transferHours(1, 10), 8000 / 10 / 3600, 1e-9, "1 TB at 10 Gbps")
  near(transferHours(80, 10), 17.78, 0.01, "80 TB of repos at 10 Gbps")
  assert.equal(transferHours(1, 0), Infinity)
  assert.equal(EGRESS_PER_GB, 0.05)
  assert.equal(egressUsd(1), 50)
  assert.equal(egressUsd(80), 4000)
  assert.equal(egressUsd(2, 0.09), 180)
  assert.equal(goLiveDays(30, 80, 10), 31, "a day of copying on top of the lead time")
  assert.equal(goLiveDays(30, 0, 10), 30)
  assert.equal(goLiveDays(30, 400, 1), 30 + Math.ceil(400 * 8000 / 1 / 3600 / 24))
  assert.equal(goLiveDays(30, 1, 0), Infinity)
})

test("tokenImpact: one object per option, and the private options beat the internet on every axis", () => {
  const km = kmBetween(site("lon"), DATA_HOMES.chat)
  const story = (optionId) => tokenImpact({
    legs: [{ km: 20, optionId }, { km, optionId, trips: 2 }, { km, optionId: "internet", trips: 50, slaExempt: true }],
    targetS: 0.5,
    stepS: 0.02,
    streams: 4,
    prefillS: 0.2,
  })
  const internet = story("internet")
  const fabric = story("fabric")
  assert.ok(internet.firstTokenS > fabric.firstTokenS, "the internet first token is later")
  assert.ok(internet.jitterS > fabric.jitterS)
  assert.ok(internet.pMiss > fabric.pMiss)
  assert.ok(internet.lateFactor < fabric.lateFactor)
  assert.ok(internet.gpuIdle > fabric.gpuIdle, "the GPUs idle longer waiting on the internet")
  assert.ok(internet.usableBps < fabric.usableBps, "the interactive path is Mathis-bound on the internet")
  assert.equal(internet.bulkBps, fabric.bulkBps, "the bulk feed rides the same internet leg in both stories")
  assert.ok(fabric.bulkBps < fabric.usableBps, "the lossy bulk leg is the slower pipe")
  assert.equal(tokenImpact({ legs: [{ km: 10, optionId: "fabric" }] }).bulkBps, Infinity, "no bulk leg, no bulk cap")
  assert.equal(fabric.feel, "smooth")
  assert.equal(fabric.targetS, 0.5)
  assert.equal(fabric.legs.length, 3)
  assert.ok(fabric.legs[2].slaExempt, "the bulk leg is carried but exempt")
  near(fabric.firstTokenS, 0.2 + fabric.legs[0].rttS + 2 * fabric.legs[1].rttS, 1e-9, "fabric first token composition")
  assert.ok(fabric.pMiss < 0.01, `ServiceFabric answers in time: P(miss) ${fabric.pMiss}`)
  assert.equal(tokenImpact().legs.length, 0)
  assert.equal(tokenImpact().firstTokenS, 0)
})
