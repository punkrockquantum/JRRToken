import assert from "node:assert/strict"
import test from "node:test"
import { MUTE_KEY, bindAudio, isMuted, loadMute, play, setMuted, unlock } from "../js/sound.js"

function harness() {
  const started = []
  const stopped = []
  const links = []
  class FakeContext {
    constructor() {
      this.state = "suspended"
      this.currentTime = 0
      this.destination = { name: "destination" }
    }

    resume() {
      this.state = "running"
      return Promise.resolve()
    }

    createGain() {
      const node = {
        name: "gain",
        gain: {
          value: 1,
          setValueAtTime(value) {
            this.value = value
          },
          exponentialRampToValueAtTime() {},
        },
        connect(target) {
          links.push([node, target])
          return target
        },
      }
      return node
    }

    createOscillator() {
      const osc = {
        name: "osc",
        type: "",
        frequency: { setValueAtTime() {} },
        connect(target) {
          links.push([osc, target])
          return target
        },
        start() {
          started.push(osc)
        },
        stop() {
          stopped.push(osc)
        },
      }
      return osc
    }
  }
  const mem = new Map()
  const storage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => mem.set(key, value),
  }
  bindAudio({ AudioContext: FakeContext, storage })
  return { started, stopped, links, mem, storage, FakeContext }
}

test("mute silences playback and unmute lets it play again", () => {
  const { started, stopped, links, mem } = harness()
  play("blip")
  assert.equal(started.length, 0, "no sound before the first gesture")

  unlock()
  play("blip")
  assert.equal(started.length, 1)
  const osc = started[0]
  const note = links.find(([from]) => from === osc)?.[1]
  const master = links.find(([from]) => from === note)?.[1]
  assert.ok(note && master)
  assert.ok(links.some(([from, target]) => from === master && target?.name === "destination"))
  assert.equal(links.some(([from, target]) => from === osc && target?.name === "destination"), false)

  setMuted(true)
  assert.equal(isMuted(), true)
  assert.equal(mem.get(MUTE_KEY), "1")
  assert.equal(master.gain.value, 0)
  assert.ok(stopped.includes(osc))
  play("coin")
  play("fanfare")
  assert.equal(started.length, 1, "muted play() is a no-op")

  setMuted(false)
  assert.equal(isMuted(), false)
  assert.equal(mem.get(MUTE_KEY), "0")
  assert.equal(master.gain.value, 1)
  play("coin")
  assert.equal(started.length, 3)
})

test("a reloaded page keeps the kiosk mute flag", () => {
  const { mem, storage, FakeContext, started } = harness()
  unlock()
  setMuted(true)
  bindAudio({ AudioContext: FakeContext, storage })
  assert.equal(loadMute(), true)
  assert.equal(isMuted(), true)
  unlock()
  play("start")
  assert.equal(started.length, 0)
  assert.equal(mem.get(MUTE_KEY), "1")
})
