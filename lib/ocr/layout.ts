/**
 * Turns OCR words (text + bounding box) from a "Položeni ispiti" screenshot into exam rows,
 * using the table header to locate columns. Pure functions: no DOM, no OCR engine.
 */
import { bestMatch, cer } from "../fuzzy.js";
import { normName, normPeriod, toLatin } from "../text.js";
import type { Period } from "../types.js";

export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number; conf?: number }

export type ColumnKey = "rb" | "akronim" | "naziv" | "ngr" | "tip" | "poeni" | "ocena" | "espb" | "rok" | "datum" | "nastavnik";
export interface Column { key: ColumnKey; x0: number; x1: number; left: number; right: number }
export interface Layout { columns: Column[]; headerBottom: number; lineHeight: number }

const HEADER_WORDS: [ColumnKey, string[]][] = [
  ["rb", ["r br", "rbr", "br"]],
  ["akronim", ["akronim"]],
  ["naziv", ["naziv"]],
  ["ngr", ["n gr", "ngr"]],
  ["tip", ["tip", "tip prijave", "tipprijave"]],
  ["poeni", ["poeni"]],
  ["ocena", ["ocena"]],
  ["espb", ["espb"]],
  ["rok", ["rok"]],
  ["datum", ["datum"]],
  ["nastavnik", ["potpisao", "nastavnik"]],
];
const REQUIRED: ColumnKey[] = ["ocena", "espb", "rok"];

const cx = (w: { x0: number; x1: number }) => (w.x0 + w.x1) / 2;
const cy = (w: { y0: number; y1: number }) => (w.y0 + w.y1) / 2;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function headerKey(text: string): ColumnKey | null {
  const t = normName(text);
  if (!t) return null;
  let best: { key: ColumnKey; c: number } | null = null;
  for (const [key, names] of HEADER_WORDS) {
    for (const n of names) {
      const c = cer(t, n);
      const limit = n.length <= 3 ? 0.34 : 0.4;
      if (c <= limit && (!best || c < best.c)) best = { key, c };
    }
  }
  return best?.key ?? null;
}

/** Find the header line and derive column boundaries from it. */
export function findLayout(words: OcrWord[]): Layout | null {
  const lineHeight = median(words.map((w) => w.y1 - w.y0)) || 10;
  const tagged = words.map((w) => ({ w, key: headerKey(w.text) })).filter((t) => t.key) as { w: OcrWord; key: ColumnKey }[];
  // Try each "ocena"/"espb"/"rok" word as the header's anchor and keep the line with most header words.
  let bestLine: { w: OcrWord; key: ColumnKey }[] = [];
  for (const anchor of tagged.filter((t) => REQUIRED.includes(t.key))) {
    const y = cy(anchor.w);
    const line = tagged.filter((t) => Math.abs(cy(t.w) - y) <= lineHeight * 1.6);
    const keys = new Set(line.map((t) => t.key));
    const ok = keys.has("rok") && (keys.has("ocena") || keys.has("espb")) && keys.size >= 4;
    if (ok && keys.size > new Set(bestLine.map((t) => t.key)).size) bestLine = line;
  }
  if (!bestLine.length) return null;
  // A misread header word ("ЕСПБ" → "2276") is recovered from its neighbours on the same line.
  const lineY = median(bestLine.map((t) => cy(t.w)));
  const onLine = words.filter((w) => Math.abs(cy(w) - lineY) <= lineHeight * 1.6 && /[\p{L}\d]{2,}/u.test(w.text));
  const fill = (missing: ColumnKey, leftKey: ColumnKey, rightKey: ColumnKey) => {
    if (bestLine.some((t) => t.key === missing)) return;
    const l = bestLine.find((t) => t.key === leftKey)?.w;
    const r = bestLine.find((t) => t.key === rightKey)?.w;
    if (!l || !r) return;
    const between = onLine.filter((w) => w.x0 >= l.x1 && w.x1 <= r.x0);
    if (between.length === 1) bestLine.push({ w: between[0], key: missing });
  };
  fill("espb", "ocena", "rok");
  fill("ocena", "poeni", "espb");
  fill("ocena", "tip", "espb");
  if (!bestLine.some((t) => t.key === "ocena") || !bestLine.some((t) => t.key === "espb")) return null;
  // One word per column: the leftmost occurrence of each key, then sort left → right.
  const byKey = new Map<ColumnKey, OcrWord>();
  for (const t of bestLine) {
    const prev = byKey.get(t.key);
    if (!prev) byKey.set(t.key, { ...t.w });
    else byKey.set(t.key, { ...prev, x0: Math.min(prev.x0, t.w.x0), x1: Math.max(prev.x1, t.w.x1), y1: Math.max(prev.y1, t.w.y1) });
  }
  const heads = [...byKey.entries()].sort((a, b) => a[1].x0 - b[1].x0);
  const columns: Column[] = heads.map(([key, w], i) => {
    const prev = heads[i - 1]?.[1];
    const next = heads[i + 1]?.[1];
    return {
      key, x0: w.x0, x1: w.x1,
      // Text cells are left-aligned with their header, so a column starts just before its header word.
      left: prev ? w.x0 - lineHeight * 0.4 : w.x0 - (w.x1 - w.x0),
      right: next ? next.x0 - lineHeight * 0.4 : w.x1 + (w.x1 - w.x0) * 2,
    };
  });
  const headerBottom = Math.max(...bestLine.map((t) => t.w.y1));
  return { columns, headerBottom, lineHeight };
}

export function columnOf(layout: Layout, x: number): ColumnKey | null {
  for (const c of layout.columns) if (x >= c.left && x < c.right) return c.key;
  return null;
}

export function column(layout: Layout, key: ColumnKey): Column | undefined {
  return layout.columns.find((c) => c.key === key);
}

const DATE_RE = /(\d{1,2})[.,:](\d{1,2})[.,:](\d{4})/;
const YEAR_RE = /(20\d{2})\s*\/?\s*(\d{2})/;

/** Row centers: one per exam, from date words (fallback: academic-year words) below the header. */
export function findRowCenters(layout: Layout, words: OcrWord[]): number[] {
  const datum = column(layout, "datum");
  const rok = column(layout, "rok");
  const ys: number[] = [];
  for (const w of words) {
    if (cy(w) <= layout.headerBottom) continue;
    const t = w.text.replace(/\s/g, "");
    const x = cx(w);
    if (datum && x >= datum.left && x < datum.right && /\d{2}.*\d{4}/.test(t)) ys.push(cy(w));
    else if (!datum && rok && x >= rok.left && x < rok.right && YEAR_RE.test(t)) ys.push(cy(w));
  }
  ys.sort((a, b) => a - b);
  const merged: number[] = [];
  for (const y of ys) {
    const last = merged[merged.length - 1];
    if (last !== undefined && y - last < layout.lineHeight * 1.2) merged[merged.length - 1] = (last + y) / 2;
    else merged.push(y);
  }
  return merged;
}

export interface CellWords { [key: string]: OcrWord[] }

/** Assign words to rows (between midpoints of row centers) and columns. */
export function assignCells(layout: Layout, centers: number[], words: OcrWord[]): CellWords[] {
  const rows: CellWords[] = centers.map(() => ({}));
  const bounds = centers.map((c, i) => ({
    top: i === 0 ? layout.headerBottom : (centers[i - 1] + c) / 2,
    bottom: i === centers.length - 1 ? c + (c - (centers[i - 1] ?? c - layout.lineHeight * 4)) / 2 : (c + centers[i + 1]) / 2,
  }));
  for (const w of words) {
    const y = cy(w);
    const i = bounds.findIndex((b) => y >= b.top && y < b.bottom);
    if (i < 0) continue;
    const key = columnOf(layout, cx(w));
    if (!key) continue;
    (rows[i][key] ??= []).push(w);
  }
  return rows;
}

const readingOrder = (ws: OcrWord[], lh: number) =>
  [...ws].sort((a, b) => (Math.abs(cy(a) - cy(b)) < lh * 0.6 ? a.x0 - b.x0 : cy(a) - cy(b)));

export function cellText(ws: OcrWord[] | undefined, lh: number): string {
  return ws ? readingOrder(ws, lh).map((w) => w.text).join(" ").replace(/\s+/g, " ").trim() : "";
}

/** Integer from a digits-only cell, e.g. "10", "8в" → 8. */
export function cellInt(text: string): number | null {
  const m = text.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").match(/\d{1,2}/);
  return m ? Number(m[0]) : null;
}

const MONTHS: { p: Period; names: string[] }[] = [
  { p: "januar", names: ["januar"] }, { p: "februar", names: ["februar"] }, { p: "april", names: ["april"] },
  { p: "jun", names: ["jun"] }, { p: "jul", names: ["jul"] }, { p: "avgust", names: ["avgust"] },
  { p: "septembar", names: ["septembar"] }, { p: "oktobar", names: ["oktobar"] },
  { p: "novembar", names: ["novembar"] }, { p: "decembar", names: ["decembar"] },
];

/** Exam period from a (possibly misread) Rok cell, e.g. "сеттмбар-ОС" → septembar. */
export function readMonth(text: string): Period | null {
  const direct = normPeriod(text);
  let best: { p: Period; c: number } | null = null;
  for (const token of normName(text).split(" ")) {
    if (token.length < 3 || /\d/.test(token)) continue;
    const m = bestMatch(token, MONTHS, (x) => x.names[0], token.length <= 4 ? 0.34 : 0.4);
    if (m && (!best || m.cer < best.c)) best = { p: m.item.p, c: m.cer };
  }
  return best?.p ?? direct;
}

export function readDate(text: string): { day: number; month: number; year: number } | null {
  const m = text.replace(/\s/g, "").match(DATE_RE);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  return { day, month, year };
}

export function readAcadYear(text: string): number | null {
  const m = text.replace(/\s/g, "").match(YEAR_RE);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  return (a + 1) % 100 === b ? a : null;
}

/** Find "Збир ЕСПБ поена 228" in the page text. */
export function readFooterEcts(words: OcrWord[], lh: number): number | null {
  const anchor = words.find((w) => cer(normName(w.text), "poena") <= 0.4);
  if (!anchor) return null;
  const right = words
    .filter((w) => Math.abs(cy(w) - cy(anchor)) < lh && w.x0 > anchor.x0)
    .sort((a, b) => a.x0 - b.x0)
    .map((w) => w.text.match(/^\d{2,3}$/)?.[0])
    .find(Boolean);
  return right ? Number(right) : null;
}

/** Course codes like "13E054OPG" that leak into the name cell. */
const looksLikeCode = (t: string) => t.length >= 4 && /\d/.test(t) && /\p{L}/u.test(t);

export const cleanName = (s: string) =>
  toLatin(s.split(/\s+/).filter((t) => !looksLikeCode(t)).join(" ")).replace(/[|_“”"'`~^*<>[\]{}=+—–]/g, " ").replace(/\s+/g, " ").replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, "").trim();
