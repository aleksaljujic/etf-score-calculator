/**
 * Digit reader for table cells by template matching.
 * Tesseract often drops or misreads lone digits (6, 8, 9) in small screenshots, but it reads the
 * dates well. All numbers in the table use the same font, so glyphs from the dates (labelled by the
 * OCR'd date text) become per-digit templates, and grade/ECTS glyphs are matched against them.
 */

export interface Bitmap { w: number; h: number; bits: Uint8Array }
export interface Box { x0: number; y0: number; x1: number; y1: number; n: number }

const NW = 12, NH = 18;

/** Ink mask from RGBA pixels (dark = 1). */
export function toBitmap(rgba: Uint8ClampedArray, w: number, h: number, threshold = 100): Bitmap {
  const bits = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < bits.length; p++, i += 4) bits[p] = rgba[i] < threshold ? 1 : 0;
  return { w, h, bits };
}

/** 8-connected components. */
export function components(bm: Bitmap): Box[] {
  const { w, h, bits } = bm;
  const seen = new Uint8Array(w * h);
  const out: Box[] = [];
  const stack: number[] = [];
  for (let p = 0; p < bits.length; p++) {
    if (!bits[p] || seen[p]) continue;
    const box: Box = { x0: w, y0: h, x1: -1, y1: -1, n: 0 };
    stack.push(p);
    seen[p] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % w, y = (q / w) | 0;
      box.n++;
      if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const r = ny * w + nx;
        if (bits[r] && !seen[r]) { seen[r] = 1; stack.push(r); }
      }
    }
    out.push(box);
  }
  return out;
}

/**
 * Digit glyph boxes in reading order (one text line): merges pieces of a broken glyph that overlap
 * horizontally, drops dots and specks. With `line`, keeps only glyphs on the line nearest its center.
 */
export function glyphs(bm: Bitmap): Box[] {
  let boxes = components(bm).filter((b) => b.n >= 3);
  if (!boxes.length) return [];
  // Merge boxes that overlap horizontally by more than half of the narrower one.
  boxes.sort((a, b) => a.x0 - b.x0);
  const merged: Box[] = [];
  for (const b of boxes) {
    const m = merged[merged.length - 1];
    if (m) {
      const overlap = Math.min(m.x1, b.x1) - Math.max(m.x0, b.x0) + 1;
      const narrow = Math.min(m.x1 - m.x0 + 1, b.x1 - b.x0 + 1);
      if (overlap > narrow * 0.5) {
        m.x0 = Math.min(m.x0, b.x0); m.x1 = Math.max(m.x1, b.x1);
        m.y0 = Math.min(m.y0, b.y0); m.y1 = Math.max(m.y1, b.y1); m.n += b.n;
        continue;
      }
    }
    merged.push({ ...b });
  }
  boxes = merged;
  const hMax = Math.max(...boxes.map((b) => b.y1 - b.y0 + 1));
  // Digits are full height; dots, commas and noise are not.
  boxes = boxes.filter((b) => b.y1 - b.y0 + 1 >= hMax * 0.6);
  // Keep one line: the glyphs whose vertical center is near the tallest glyphs' center.
  const tall = boxes.filter((b) => b.y1 - b.y0 + 1 >= hMax * 0.85);
  const mid = tall.reduce((s, b) => s + (b.y0 + b.y1) / 2, 0) / Math.max(1, tall.length);
  return boxes.filter((b) => Math.abs((b.y0 + b.y1) / 2 - mid) <= hMax * 0.6);
}

/** Resample a glyph to a fixed NW×NH grid of ink coverage (0..1), plus its aspect ratio. */
export function features(bm: Bitmap, b: Box): { v: Float32Array; aspect: number } {
  const v = new Float32Array(NW * NH);
  const gw = b.x1 - b.x0 + 1, gh = b.y1 - b.y0 + 1;
  for (let y = b.y0; y <= b.y1; y++) {
    const ty = Math.min(NH - 1, Math.floor(((y - b.y0) / gh) * NH));
    for (let x = b.x0; x <= b.x1; x++) {
      if (!bm.bits[y * bm.w + x]) continue;
      const tx = Math.min(NW - 1, Math.floor(((x - b.x0) / gw) * NW));
      v[ty * NW + tx] += 1;
    }
  }
  const cellArea = (gw / NW) * (gh / NH);
  for (let i = 0; i < v.length; i++) v[i] = Math.min(1, v[i] / cellArea);
  return { v, aspect: gw / gh };
}

export class DigitTemplates {
  private sum = new Map<string, { v: Float32Array; aspect: number; n: number }>();

  add(digit: string, f: { v: Float32Array; aspect: number }) {
    const t = this.sum.get(digit) ?? { v: new Float32Array(NW * NH), aspect: 0, n: 0 };
    for (let i = 0; i < t.v.length; i++) t.v[i] += f.v[i];
    t.aspect += f.aspect;
    t.n++;
    this.sum.set(digit, t);
  }

  /** Label the glyphs of a cell with known text (e.g. a date read by OCR). Returns false if counts differ. */
  learn(bm: Bitmap, digitsText: string): boolean {
    const g = glyphs(bm);
    if (g.length !== digitsText.length) return false;
    g.forEach((b, i) => this.add(digitsText[i], features(bm, b)));
    return true;
  }

  get size() { return this.sum.size; }
  has(d: string) { return this.sum.has(d); }

  /** Best digit for a glyph and its distance (lower is better). */
  classify(f: { v: Float32Array; aspect: number }): { digit: string; dist: number } | null {
    let best: { digit: string; dist: number } | null = null;
    for (const [digit, t] of this.sum) {
      let d = 0;
      for (let i = 0; i < f.v.length; i++) { const e = f.v[i] - t.v[i] / t.n; d += e * e; }
      d = Math.sqrt(d / f.v.length) + Math.abs(f.aspect - t.aspect / t.n) * 0.5;
      if (!best || d < best.dist) best = { digit, dist: d };
    }
    return best;
  }

  /** Read a number from a cell bitmap; null if a glyph matches no template well. */
  read(bm: Bitmap, maxDist = 0.35): string | null {
    const g = glyphs(bm);
    if (!g.length || g.length > 3) return null;
    let out = "";
    for (const b of g) {
      const c = this.classify(features(bm, b));
      if (!c || c.dist > maxDist) return null;
      out += c.digit;
    }
    return out;
  }
}
