/**
 * Booth mode (nerd OFF): small pure helpers behind the simple screens, kept out of
 * main.js so they can be unit-tested. The tile sets, hidden defaults and headline live
 * in presets.js and explain.js; this module holds the copy that is booth-only.
 */
import { coachKey, plainCoach } from "./coach.js"

/**
 * One sentence per lesson for the simple board: what the crowd feels and the data-center
 * fix, joined so a first-time visitor reads a single line under the gauges.
 */
const BOOTH_COACH = {
  start: "Pick a GPU to start the factory.",
  overspend: "Too many GPUs for your wallet: the money runs out before the hall pays off.",
  power: "The lights are flickering: these racks pull more power than the hall can feed.",
  liquid: "These racks need liquid cooling, and air alone cannot keep them running.",
  hot: "These GPUs run too hot for this hall, so cooling is the limit.",
  space: "The hall is stuffed full, and more racks need more floor and power.",
  lead: "The racks arrive after the deadline, so pick a GPU you can get sooner.",
  store: "This story needs its documents in the same building.",
  wires: "People are waiting on a slow connection, and fast GPUs cannot fix slow wires.",
  far: "People in the far city are waiting, so a hall closer to them answers faster.",
  slow: "People are waiting for the first word, so move closer or add the KV memory.",
  short: "The crowd is bigger than your GPUs, so more muscle in a cool hall serves more people.",
  idle: "GPUs are sitting idle, and idle racks still burn power and money.",
  nice: "Nice, close, cool and connected: can you spend a little less?",
}

export const BOOTH_COACH_KEYS = Object.keys(BOOTH_COACH)

/** The single coach sentence under the booth gauges; a lesson without booth copy falls back to the nerd line. */
export function boothCoach(result) {
  return BOOTH_COACH[coachKey(result)] ?? plainCoach(result)
}
