import { describe, expect, it } from 'vitest';
import { DEMO_MODELS } from './demoModels';
import { composeResponse, makeLogits } from './respond';
import { tokenId, tokenize } from './tokenize';

const DEEPSEEK = DEMO_MODELS.find((d) => d.id === 'deepseek')!;
const MISTRAL = DEMO_MODELS.find((d) => d.id === 'mistral')!;

describe('tokenize', () => {
  it('keeps short words whole and splits long words into subwords', () => {
    const toks = tokenize('Why is photosynthesis green?');
    expect(toks).toContain('Why');
    expect(toks).toContain('is');
    expect(toks).toContain('?');
    // "photosynthesis" (14 chars) must be split into multiple pieces
    expect(toks.filter((t) => t.replace('\u2027', '').length <= 4).length).toBeGreaterThan(0);
    expect(toks.length).toBeGreaterThan(4);
  });

  it('separates punctuation from words', () => {
    expect(tokenize('Hello, world!')).toEqual(['Hello', ',', 'world', '!']);
  });

  it('assigns stable in-range token IDs', () => {
    expect(tokenId('sky', 128000)).toBe(tokenId('sky', 128000));
    expect(tokenId('sky', 128000)).not.toBe(tokenId('blue', 128000));
    for (const t of ['sky', 'blue', '?', 'a']) {
      const id = tokenId(t, 32768);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(32768);
    }
  });
});

describe('composeResponse', () => {
  it('quotes the prompt back and answers known questions', () => {
    const r = composeResponse('Why is the sky blue?', 7, DEEPSEEK);
    expect(r.text).toContain('You asked: \u201cWhy is the sky blue?\u201d');
    // Known question: gets a real answer (Rayleigh scattering).
    expect(r.text.toLowerCase()).toContain('scatter');
    expect(r.text).toContain('7 tokens');
    expect(r.words.length).toBeGreaterThan(40);
  });

  it('is honest about unknown questions while still reflecting the prompt', () => {
    const r = composeResponse('What is the capital of Peru?', 8, DEEPSEEK);
    expect(r.text).toContain('You asked: \u201cWhat is the capital of Peru?\u201d');
    expect(r.text.toLowerCase()).toContain('cannot');
    expect(r.text.toLowerCase()).toContain('capital');
  });

  it('reflects the selected demo model architecture', () => {
    const ds = composeResponse('Why is the sky blue?', 7, DEEPSEEK);
    expect(ds.text).toContain('61 transformer layers');
    expect(ds.text).toContain('9 of 257');
    const mi = composeResponse('Why is the sky blue?', 7, MISTRAL);
    expect(mi.text).toContain('88 transformer layers');
    expect(mi.text).toContain('dense models');
    expect(mi.text).not.toContain('experts');
  });

  it('handles empty-ish prompts without crashing', () => {
    const r = composeResponse('a b', 2, DEEPSEEK);
    expect(r.words.length).toBeGreaterThan(10);
  });
});

describe('makeLogits', () => {
  it('by default the emitted token is also the most probable', () => {
    for (let i = 0; i < 20; i++) {
      const logits = makeLogits('token', ['sky', 'blue', 'light']);
      expect(logits).toHaveLength(5);
      const winner = logits.find((l) => l.winner);
      expect(winner?.token).toBe('token');
      const max = Math.max(...logits.map((l) => l.prob));
      expect(winner?.prob).toBe(max);
      const total = logits.reduce((a, b) => a + b.prob, 0);
      expect(total).toBeLessThanOrEqual(1.001);
      for (const l of logits) expect(l.prob).toBeGreaterThan(0);
    }
  });

  it('in sampled mode the emitted token is a runner-up, showing sampling', () => {
    for (let i = 0; i < 20; i++) {
      const logits = makeLogits('token', ['sky', 'blue', 'light'], { sampled: true });
      const winner = logits.find((l) => l.winner);
      expect(winner?.token).toBe('token');
      const max = Math.max(...logits.map((l) => l.prob));
      expect(winner!.prob).toBeLessThan(max);
      const total = logits.reduce((a, b) => a + b.prob, 0);
      expect(total).toBeLessThanOrEqual(1.001);
      for (const l of logits) expect(l.prob).toBeGreaterThan(0);
    }
  });
});
