/**
 * Client-side response composer for the simple view.
 *
 * No real model runs in the browser, so instead of pretending to answer,
 * the simulated response teaches: it weaves the user's own topic into an
 * explanation of exactly what the visualisation just showed, using the
 * real architecture numbers of the demo model.
 */

import type { DemoSpec } from './demoModels';

export const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'have', 'what', 'when',
  'where', 'which', 'about', 'does', 'how', 'why', 'can', 'could', 'would',
  'should', 'will', 'your', 'their', 'them', 'then', 'than', 'into', 'for',
  'are', 'was', 'were', 'been', 'being', 'you', 'not', 'but', 'all', 'any',
  'tell', 'explain', 'please', 'give', 'make', 'write', 'more', 'most',
]);

export interface ComposedResponse {
  text: string;
  words: string[];
}

/**
 * Canned answers for common demo questions, so the response genuinely
 * addresses the prompt when it can. Everything else falls back to an
 * honest "this demo cannot think" reply.
 */
const KNOWLEDGE: { match: RegExp; answer: string }[] = [
  {
    match: /sky.+blue|blue.+sky/i,
    answer:
      'Sunlight is a mix of every colour, and air molecules scatter short blue wavelengths far more strongly than long red ones \u2014 about ten times more. So wherever you look, scattered blue light reaches your eye from the whole dome of the sky, while at sunset the light travels through so much air that the blue is scattered away and red remains.',
  },
  {
    match: /how.+(ai|llm|model|gpt|chatbot).+work|what.+(is|are).+(ai|llm|language model)/i,
    answer:
      'A language model is a next-word guesser trained at colossal scale. It read trillions of words, and each time it guessed the next one wrong, its internal numbers were nudged. After enough nudging, guessing the next token turns out to require understanding grammar, facts and reasoning \u2014 and that is everything you just watched happen below.',
  },
  {
    match: /what.+token|token.+mean/i,
    answer:
      'A token is the unit a model actually reads and writes: a common word, a piece of a rare word, or a punctuation mark, each mapped to a number. Models are priced, measured and limited in tokens \u2014 which is why this whole simulator counts them.',
  },
  {
    match: /gpu|why.+graphics|nvidia|chip/i,
    answer:
      'GPUs matter because a neural network is mostly one operation \u2014 multiply enormous grids of numbers \u2014 and a GPU does thousands of those multiplications at once. For generating text the surprising truth is that the bottleneck is usually moving weights out of memory, not the maths itself.',
  },
  {
    match: /datacenter|data center|cooling|power/i,
    answer:
      'A datacenter is where the physics of AI gets paid for: every watt the chips draw becomes heat that cooling must remove, and power, cooling, networks and space all end up in the price of each token. The Full stack explorer tab of this app exists to show exactly that.',
  },
];

export function composeResponse(
  prompt: string,
  promptTokenCount: number,
  spec: DemoSpec
): ComposedResponse {
  const cleanPrompt = prompt.trim().replace(/\s+/g, ' ');
  const words = prompt.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const topics = [...new Set(words.filter((w) => !STOPWORDS.has(w) && w.length > 3))];
  const topic = topics.slice(0, 2).join(' and ') || 'that';

  const known = KNOWLEDGE.find((k) => k.match.test(cleanPrompt));
  const opening = known
    ? `You asked: \u201c${cleanPrompt}\u201d. ${known.answer}`
    : `You asked: \u201c${cleanPrompt}\u201d. An honest admission first: this demo cannot truly think, so it cannot give you a real answer about ${topic} \u2014 a live model would. But it produced these words exactly the way a real one would have produced that answer.`;

  const expertsPhrase = spec.expertsTotal
    ? `a handful of experts \u2014 just ${spec.expertsActive + spec.sharedExperts} of ${
        spec.expertsTotal + spec.sharedExperts
      } in each layer \u2014 woke up to do the thinking`
    : `its entire feed-forward network ran for every single token \u2014 dense models take no shortcuts, which is exactly why they cost more per token`;

  const text =
    `${opening} ` +
    `Here is how: your ${words.length} words became ${promptTokenCount} tokens, and each token became a list of ${spec.dModel.toLocaleString()} numbers. ` +
    `Those numbers flowed through ${spec.layers} transformer layers, where attention let every token look back at the rest of your prompt to decide what matters, ` +
    `and ${expertsPhrase}. ` +
    `At the very end, the model gave every one of its ${spec.vocab.toLocaleString()} vocabulary tokens a score, softmax turned those scores into probabilities, and one token was sampled from them and fed straight back into the stack to choose the next \u2014 one token at a time, billions of weights streaming out of memory for each one.`;

  return { text, words: text.split(' ') };
}

/** Common tokens used as plausible-looking runner-up predictions. */
const DISTRACTORS = [
  'the', 'a', 'and', 'of', 'to', 'in', 'that', 'is', 'it', 'model',
  'token', 'so', 'then', 'because', 'data', 'we', 'this', 'one', 'all', 'its',
];

export interface LogitCandidate {
  token: string;
  prob: number;
  winner: boolean;
}

/**
 * Fabricates a plausible top-5 next-token probability distribution.
 * Illustrates softmax + sampling; not real model output.
 *
 * By default the emitted token is also the most probable one (the common
 * case). With `sampled: true` the emitted token is a runner-up — showing
 * that generation samples from the distribution rather than always taking
 * the favourite (the behaviour the temperature setting controls).
 */
export function makeLogits(
  nextWord: string,
  promptWords: string[],
  opts: { sampled?: boolean } = {}
): LogitCandidate[] {
  const pool = [...new Set([...DISTRACTORS, ...promptWords])].filter(
    (w) => w.toLowerCase() !== nextWord.toLowerCase()
  );
  const pick = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0] ?? '\u2026';

  const others: LogitCandidate[] = [];
  let pWin: number;
  if (opts.sampled) {
    // The favourite loses: give a distractor the top probability.
    const pTop = 0.34 + Math.random() * 0.18;
    pWin = pTop * (0.4 + Math.random() * 0.3);
    others.push({ token: pick(), prob: pTop, winner: false });
    let remaining = 1 - pTop - pWin;
    for (let i = 0; i < 3; i++) {
      const p = i === 2 ? remaining * 0.6 : remaining * (0.3 + Math.random() * 0.25);
      remaining -= p;
      others.push({ token: pick(), prob: Math.min(p, pWin * 0.95), winner: false });
    }
  } else {
    pWin = 0.42 + Math.random() * 0.4;
    let remaining = 1 - pWin;
    for (let i = 0; i < 4; i++) {
      const p = i === 3 ? remaining * 0.6 : remaining * (0.35 + Math.random() * 0.3);
      remaining -= p;
      others.push({ token: pick(), prob: p, winner: false });
    }
  }
  return [{ token: nextWord, prob: pWin, winner: true }, ...others].sort(
    (a, b) => b.prob - a.prob
  );
}
