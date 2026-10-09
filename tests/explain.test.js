import assert from "node:assert/strict"
import test from "node:test"
import { explainResult } from "../js/explain.js"
import { evaluateBuild } from "../js/model.js"
import { choicesToBuild, defaultChoices, expertChoices } from "../js/presets.js"

test("the results explanation names the products and points at a better tile", () => {
  const choices = expertChoices("chat")
  const result = evaluateBuild("chat", choicesToBuild("chat", choices))
  const exp = explainResult(result, choices)
  assert.equal(exp.title, "WHAT YOU BUILT AND WHY IT SCORED THIS WAY")
  assert.deepEqual(exp.lines.map((line) => line.id), ["compute", "memory", "storage", "network", "money", "people", "next"])
  assert.ok(exp.lines.length >= 5 && exp.lines.length <= 7)
  const compute = exp.lines.find((line) => line.id === "compute").text
  assert.match(compute, /2× GB200 NVL72/)
  assert.match(compute, /liquid-cooled hall/)
  assert.match(compute, /London/)
  assert.match(exp.lines.find((line) => line.id === "memory").text, /KV cache tier/)
  assert.match(exp.lines.find((line) => line.id === "network").text, /ServiceFabric/)
  assert.match(exp.lines.find((line) => line.id === "money").text, /budget/)
  assert.match(exp.lines.find((line) => line.id === "people").text, /people/)
  if (exp.suggestion.better) assert.ok(exp.suggestion.score > result.score)
  else assert.match(exp.suggestion.text, /This is the best build/)

  const weak = { ...defaultChoices("research"), brains: "small", wires: "cheap", home: "cool", memory: false }
  const weakResult = evaluateBuild("research", choicesToBuild("research", weak))
  const weakExp = explainResult(weakResult, weak)
  assert.equal(weakExp.suggestion.better, true)
  assert.ok(weakExp.suggestion.score > weakResult.score, `${weakExp.suggestion.score} vs ${weakResult.score}`)
  assert.match(weakExp.suggestion.text, /would have scored about/)
})
