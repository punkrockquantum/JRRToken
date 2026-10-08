let ctx = null
let muted = false

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

function audio() {
  if (muted) return null
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {})
  return ctx
}

export function play(name) {
  const ac = audio()
  const notes = TUNES[name]
  if (!ac || !notes) return
  let t = ac.currentTime
  for (const [freq, length] of notes) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = "square"
    osc.frequency.setValueAtTime(freq, t)
    gain.gain.setValueAtTime(0.06, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
    osc.connect(gain).connect(ac.destination)
    osc.start(t)
    osc.stop(t + length + 0.02)
    t += length * 0.9
  }
}

export function setMuted(value) {
  muted = Boolean(value)
}

export function isMuted() {
  return muted
}
