/** Square-wave cues. Everything goes through one master gain, so mute is instant. */

export const MUTE_KEY = "token-quest-muted"

const TUNES = {
  blip: [[880, 0.05]],
  select: [[660, 0.05], [990, 0.07]],
  back: [[440, 0.06], [330, 0.08]],
  error: [[180, 0.12], [140, 0.16]],
  coin: [[988, 0.06], [1319, 0.18]],
  start: [[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.2]],
  fanfare: [[523, 0.1], [523, 0.1], [523, 0.1], [698, 0.3], [880, 0.1], [784, 0.1], [1047, 0.4]],
  miss: [[392, 0.12], [370, 0.12], [349, 0.12], [330, 0.3]],
  token: [[1568, 0.03]],
}

const memoryStore = { value: null }
let AudioCtor = null
let storage = null
let ctx = null
let master = null
let muted = false
let unlocked = false
const live = new Set()

function defaultStore() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage
  } catch {
    /* Storage can be blocked in a private frame. */
  }
  return {
    getItem: () => memoryStore.value,
    setItem: (_key, value) => {
      memoryStore.value = value
    },
  }
}

function store() {
  return storage || defaultStore()
}

function ctor() {
  if (AudioCtor) return AudioCtor
  return globalThis.AudioContext || globalThis.webkitAudioContext || null
}

/** Test seam: inject an AudioContext class and a storage object, and forget any live context. */
export function bindAudio({ AudioContext: Ctor = null, storage: nextStore = null } = {}) {
  AudioCtor = Ctor
  storage = nextStore
  ctx = null
  master = null
  unlocked = false
  live.clear()
  muted = false
}

export function loadMute() {
  muted = store().getItem(MUTE_KEY) === "1"
  return muted
}

export function isMuted() {
  return muted
}

function silence() {
  for (const osc of live) {
    try {
      osc.stop()
    } catch {
      /* Already stopped. */
    }
  }
  live.clear()
  if (!master) return
  master.gain.value = 0
  try {
    master.gain.setValueAtTime(0, ctx?.currentTime || 0)
  } catch {
    /* A fake context may not schedule. The value above is enough. */
  }
}

/** Call from a click, tap, or key. No AudioContext is created before this. */
export function unlock() {
  unlocked = true
  ensure()
}

function ensure() {
  if (!unlocked) return null
  const Ctor = ctor()
  if (!Ctor) return null
  if (!ctx) {
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 1
    master.connect(ctx.destination)
  }
  if (ctx.state === "suspended") ctx.resume()?.catch?.(() => {})
  return ctx
}

export function setMuted(value) {
  muted = Boolean(value)
  try {
    store().setItem(MUTE_KEY, muted ? "1" : "0")
  } catch {
    /* The in-memory flag still holds for this session. */
  }
  if (muted) silence()
  else if (master) {
    master.gain.value = 1
    try {
      master.gain.setValueAtTime(1, ctx?.currentTime || 0)
    } catch {
      /* See silence(). */
    }
  }
}

/**
 * Play a named cue. `pitch` scales every note (used while tokens stream).
 * Does nothing before the first gesture, while muted, or for an unknown name.
 */
export function play(name, { pitch = 1 } = {}) {
  try {
    if (!unlocked || muted) return
    const ac = ensure()
    const notes = TUNES[name]
    if (!ac || !master || !notes) return
    const scale = Number.isFinite(pitch) && pitch > 0 ? pitch : 1
    let t = ac.currentTime
    for (const [freq, length] of notes) {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = "square"
      osc.frequency.setValueAtTime(freq * scale, t)
      gain.gain.setValueAtTime(0.06, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
      osc.connect(gain)
      gain.connect(master)
      osc.start(t)
      osc.stop(t + length + 0.02)
      live.add(osc)
      if (typeof osc.addEventListener === "function") osc.addEventListener("ended", () => live.delete(osc))
      t += length * 0.9
    }
  } catch {
    /* Sound never blocks a click. */
  }
}
