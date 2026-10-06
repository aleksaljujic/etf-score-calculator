import { normName } from "./text.js";

/** Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Character error rate of `hypothesis` against `reference` (edits / reference length). */
export function cer(hypothesis: string, reference: string): number {
  return levenshtein(hypothesis, reference) / Math.max(1, reference.length);
}

export interface Match<T> { item: T; cer: number }

/**
 * Best match by CER after normalization (Cyrillic → Latin, no diacritics, lowercase).
 * A trailing number must agree ("Matematika 1" never becomes "Matematika 2").
 */
export function bestMatch<T>(text: string, items: readonly T[], key: (t: T) => string, maxCer: number): Match<T> | null {
  const h = normName(text);
  if (!h) return null;
  const hNum = h.match(/(\d+)$/)?.[1] ?? "";
  let best: Match<T> | null = null;
  for (const item of items) {
    const r = normName(key(item));
    if ((r.match(/(\d+)$/)?.[1] ?? "") !== hNum) continue;
    const c = cer(h, r);
    if (!best || c < best.cer) best = { item, cer: c };
  }
  return best && best.cer <= maxCer ? best : null;
}
