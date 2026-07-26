/**
 * Illustrative subword tokenizer for the simple view.
 *
 * Real frontier models use byte-pair encoding (BPE) learned from data; this
 * mimics the visible behaviour (short common words = one token, long words
 * split into subword pieces, punctuation separated) so users can see text
 * become tokens without shipping a real vocabulary.
 */
/**
 * Stable illustrative token ID (FNV-1a hash into the vocabulary range).
 * Real IDs come from the model's learned vocabulary; these exist so the
 * visualisation can show that every token maps to a fixed integer.
 */
export function tokenId(token: string, vocab = 128000): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % vocab;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.trim().split(/\s+/)) {
    if (!raw) continue;
    const parts = raw.match(/[a-zA-Z0-9']+|[^a-zA-Z0-9']+/g) ?? [];
    for (const p of parts) {
      if (!/[a-zA-Z0-9]/.test(p)) {
        out.push(p);
        continue;
      }
      if (p.length <= 6) {
        out.push(p);
        continue;
      }
      let i = 0;
      while (i < p.length) {
        const size = Math.min(i === 0 ? 4 : 4, p.length - i);
        out.push((i === 0 ? '' : '\u2027') + p.slice(i, i + size));
        i += size;
      }
    }
  }
  return out;
}
