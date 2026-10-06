/**
 * Screenshot → exam rows without an AI model:
 * 1. upscale + binarize, 2. OCR the page, 3. find columns from the header,
 * 4. re-read number columns with digit-only OCR, 5. fix course names by CER against the curriculum.
 * The canvas and OCR engine are injected so the same code runs in the browser and in Node tests.
 */
import { CURRICULUM } from "../curriculum.js";
import { bestMatch } from "../fuzzy.js";
import type { PastedRow } from "../parsePaste.js";
import type { Period } from "../types.js";
import { DigitTemplates, features, glyphs, toBitmap, type Bitmap } from "./digits.js";
import {
  assignCells, cellInt, inferLayout, cellText, cleanName, column, findLayout, findRowCenters, readAcadYear, readDate,
  readFooterEcts, readMonth, type ColumnKey, type Layout, type OcrWord,
} from "./layout.js";

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): any;
}
export interface RecognizeOptions { psm: "4" | "6" | "7" | "8" | "10" | "11"; whitelist?: string }
export interface OcrEngine {
  createCanvas(w: number, h: number): CanvasLike;
  recognize(canvas: CanvasLike, opts: RecognizeOptions): Promise<OcrWord[]>;
  progress?(step: string): void;
  debug?(info: unknown): void;
}
export interface ImageLike { width: number; height: number }

export interface OcrRow extends PastedRow { nameCorrected: boolean; ocrName: string }
export interface OcrResult {
  rows: OcrRow[];
  skipped: number;
  footerEcts: number | null;
}

export class OcrLayoutError extends Error {}

const MAX_PIXELS = 16_000_000; // iOS Safari canvas limit is ~16.7 MP
const TARGET_WIDTH = 2400;

/** Upscale to ~2400 px wide, grayscale, stretch contrast, invert dark header bars. */
export function prepare(engine: OcrEngine, img: ImageLike): CanvasLike {
  let scale = Math.min(3, Math.max(1, TARGET_WIDTH / img.width));
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (img.width * img.height)));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = engine.createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data as Uint8ClampedArray;
  const gray = new Uint8Array(w * h);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    gray[p] = g;
    hist[g]++;
  }
  // Contrast stretch only (Tesseract binarizes internally; a hard threshold breaks thin strokes).
  // Dark cells (the header bar) are inverted so their white text becomes dark text.
  let lo = 0, hi = 255, acc = 0;
  const n = w * h;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.01) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.01) { hi = i; break; } }
  const range = Math.max(1, hi - lo);
  const bars = darkBars(gray, w, h);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    let v = Math.max(0, Math.min(255, ((gray[p] - lo) * 255) / range));
    const bar = bars[(p / w) | 0];
    if (bar) { const x = p % w; if (x >= bar[0] && x <= bar[1]) v = 255 - v; }
    if (v > 185) v = 255; // light grey row stripes and cell backgrounds → white
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  eraseRules(d, w, h, Math.round(w / 28), bars);
  ctx.putImageData(id, 0, 0);
  return c;
}

/**
 * Erase table grid lines: horizontal or vertical runs of non-white pixels longer than `minRun`.
 * Letters are much shorter than that; the lines otherwise make Tesseract merge whole rows into one word.
 */
function eraseRules(d: Uint8ClampedArray, w: number, h: number, minRun: number, bars: ([number, number] | null)[]) {
  const ink = (p: number) => d[p * 4] < 200;
  const clear = (p: number) => { const i = p * 4; d[i] = d[i + 1] = d[i + 2] = 255; };
  const marks = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && ink(y * w + x);
      if (on && start < 0) start = x;
      if (!on && start >= 0) { if (x - start >= minRun) for (let k = start; k < x; k++) marks[y * w + k] = 1; start = -1; }
    }
  }
  for (let x = 0; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && ink(y * w + x);
      if (on && start < 0) start = y;
      if (!on && start >= 0) { if (y - start >= minRun) for (let k = start; k < y; k++) marks[k * w + x] = 1; start = -1; }
    }
  }
  // Keep the (inverted) header bar intact: its grey background would otherwise count as a line.
  const inBar = (p: number) => { const b = bars[(p / w) | 0]; if (!b) return false; const x = p % w; return x >= b[0] - 4 && x <= b[1] + 4; };
  for (let p = 0; p < marks.length; p++) if (marks[p] && !inBar(p)) clear(p);
}

/**
 * Rows that cross a dark bar (the table header: white text on black). Returns the bar's
 * x-range per row so only the bar is inverted, not the white page around it.
 */
function darkBars(gray: Uint8Array, w: number, h: number): ([number, number] | null)[] {
  const win = Math.max(8, Math.round(w / 60));
  const out: ([number, number] | null)[] = new Array(h).fill(null);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let darkInWin = 0, first = -1, last = -1, covered = 0;
    for (let x = 0; x < w; x++) {
      if (gray[row + x] < 110) darkInWin++;
      if (x >= win && gray[row + x - win] < 110) darkInWin--;
      if (x >= win - 1 && darkInWin >= win * 0.6) {
        if (first < 0) first = x - win + 1;
        last = x;
        covered++;
      }
    }
    if (first >= 0 && covered > w * 0.3) out[y] = [first, last];
  }
  // Text rows inside the bar are less dark; fill short gaps between bar rows.
  const maxGap = Math.round(w / 45);
  let prev = -1;
  for (let y = 0; y < h; y++) {
    if (!out[y]) continue;
    if (prev >= 0 && y - prev > 1 && y - prev <= maxGap) {
      const r: [number, number] = [Math.min(out[prev]![0], out[y]![0]), Math.max(out[prev]![1], out[y]![1])];
      for (let k = prev + 1; k < y; k++) out[k] = r;
    }
    prev = y;
  }
  return out;
}

export function otsu(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 160;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = i; }
  }
  // Light-grey table stripes sit near the threshold; bias slightly toward white.
  return Math.min(225, threshold + 10);
}

function crop(engine: OcrEngine, src: CanvasLike, x: number, y: number, w: number, h: number): CanvasLike {
  const c = engine.createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

async function readStrip(engine: OcrEngine, page: CanvasLike, layout: Layout, key: ColumnKey, whitelist: string): Promise<OcrWord[]> {
  const col = column(layout, key);
  if (!col) return [];
  const pad = layout.lineHeight * 0.3;
  const x = Math.max(0, col.left - pad);
  const y = Math.max(0, layout.headerBottom + 1);
  const w = Math.min(page.width - x, col.right - col.left + pad * 2);
  const h = page.height - y;
  const strip = crop(engine, page, x, y, w, h);
  const words = await engine.recognize(strip, { psm: "6", whitelist });
  return words.map((wd) => ({ ...wd, x0: wd.x0 + x, x1: wd.x1 + x, y0: wd.y0 + y, y1: wd.y1 + y }));
}

/** Whiten table rules: pixel columns/rows that are dark along most of the crop, and flatten grey row stripes. */
function removeRules(c: CanvasLike) {
  const ctx = c.getContext("2d");
  const { width: w, height: h } = c;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data as Uint8ClampedArray;
  const at = (x: number, y: number) => d[(y * w + x) * 4];
  for (let x = 0; x < w; x++) {
    let dark = 0;
    for (let y = 0; y < h; y++) if (at(x, y) < 200) dark++;
    if (dark > h * 0.7) for (let y = 0; y < h; y++) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; }
  }
  for (let y = 0; y < h; y++) {
    let dark = 0;
    for (let x = 0; x < w; x++) if (at(x, y) < 200) dark++;
    if (dark > w * 0.7) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; }
  }
  // Light grey backgrounds (alternating rows) → white, so only the ink remains.
  for (let i = 0; i < d.length; i += 4) if (d[i] > 175) d[i] = d[i + 1] = d[i + 2] = 255;
  ctx.putImageData(id, 0, 0);
}

/** Cropped, cleaned cell images of one column, one per row. */
function cellCanvases(engine: OcrEngine, page: CanvasLike, layout: Layout, key: ColumnKey, centers: number[]): (CanvasLike | null)[] {
  const col = column(layout, key);
  if (!col) return centers.map(() => null);
  const lh = layout.lineHeight;
  return centers.map((c, i) => {
    const top = i === 0 ? Math.max(layout.headerBottom + 2, c - lh * 2.2) : (centers[i - 1] + c) / 2;
    const bottom = i === centers.length - 1 ? Math.min(page.height, c + lh * 2.2) : (c + centers[i + 1]) / 2;
    const x = Math.max(0, col.left);
    const cell = crop(engine, page, x, top, Math.min(page.width, col.right) - x, bottom - top);
    removeRules(cell);
    return cell;
  });
}

function bitmapOf(c: CanvasLike): Bitmap {
  const id = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  return toBitmap(id.data, c.width, c.height);
}

/** Tesseract on one cell, enlarged and padded (fallback for the digit templates). */
async function ocrCell(engine: OcrEngine, cell: CanvasLike | null, lh: number, opts: RecognizeOptions): Promise<string> {
  if (!cell) return "";
  const k = Math.max(1, Math.min(3, 40 / lh));
  const pad = Math.round(lh * k);
  const padded = engine.createCanvas(Math.round(cell.width * k) + pad * 2, Math.round(cell.height * k) + pad * 2);
  const pctx = padded.getContext("2d");
  pctx.fillStyle = "#fff";
  pctx.fillRect(0, 0, padded.width, padded.height);
  pctx.imageSmoothingEnabled = true;
  pctx.drawImage(cell, 0, 0, cell.width, cell.height, pad, pad, cell.width * k, cell.height * k);
  const words = await engine.recognize(padded, opts);
  return words.map((wd) => wd.text).join(" ").trim();
}

/** "ddmmyyyy" that is a real date in a sensible range (used to label digit templates). */
function plausibleDate(digits: string): boolean {
  if (!/^\d{8}$/.test(digits)) return false;
  const d = Number(digits.slice(0, 2)), m = Number(digits.slice(2, 4)), y = Number(digits.slice(4));
  return d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2005 && y <= 2035;
}

/** Allowed values: grades 6–10; ECTS 2, 3 or 6 per course, 12 for the final thesis. */
export const GRADES = ["6", "7", "8", "9", "10"] as const;
export const ECTS_VALUES = ["2", "3", "6", "12"] as const;

const COURSE_NAMES = [...new Set(Object.values(CURRICULUM.programs).flatMap((p) => p.courses.map((c) => c.name)))];
const MONTH_OF_DATE: Record<number, Period> = { 1: "januar", 2: "februar", 4: "april", 6: "jun", 7: "jul", 8: "avgust", 9: "septembar", 10: "oktobar", 11: "novembar", 12: "decembar" };

export async function readScreenshot(engine: OcrEngine, img: ImageLike): Promise<OcrResult> {
  engine.progress?.("prepare");
  const page = prepare(engine, img);
  engine.progress?.("text");
  const words = await engine.recognize(page, { psm: "6" });
  const layout = findLayout(words) ?? inferLayout(words, page.width);
  if (!layout) throw new OcrLayoutError("Tabela položenih ispita nije prepoznata na slici.");
  const lh = layout.lineHeight;

  engine.progress?.("rows");
  const dates = await readStrip(engine, page, layout, "datum", "0123456789.");
  let centers = findRowCenters(layout, dates);
  if (centers.length < 2) centers = findRowCenters(layout, words);
  if (!centers.length) throw new OcrLayoutError("Redovi tabele nisu pronađeni.");

  const dateCells = assignCells(layout, centers, dates);

  const textCells = assignCells(layout, centers, words);
  const rawNames = textCells.map((c) => cleanName(cellText(c.naziv, lh)));

  // Learn digit shapes from the dates, then read grades and ECTS by template matching.
  engine.progress?.("numbers");
  const templates = new DigitTemplates();
  const dateImgs = cellCanvases(engine, page, layout, "datum", centers);
  dateImgs.forEach((img, i) => {
    const digits = cellText(dateCells[i].datum, lh).replace(/\D/g, "");
    if (img && plausibleDate(digits)) templates.learn(bitmapOf(img), digits);
  });
  const readNumbers = async (key: ColumnKey, allowed: readonly string[]) => {
    const imgs = cellCanvases(engine, page, layout, key, centers);
    const out: string[] = [];
    for (const img of imgs) {
      // Only a few values are possible (ECTS 2/3/6/12, grades 6–10): the best-fitting one wins.
      const viaTemplate = img && templates.size >= 6 ? templates.readOneOf(bitmapOf(img), allowed) : null;
      if (viaTemplate && allowed.includes(viaTemplate)) { out.push(viaTemplate); continue; }
      const t = await ocrCell(engine, img, lh, { psm: "8", whitelist: "0123456789" });
      const n = t.match(/\d+/)?.[0] ?? "";
      out.push(allowed.includes(n) ? n : "");
    }
    return out;
  };
  const gradeTexts = await readNumbers("ocena", GRADES);
  const ectsTexts = await readNumbers("espb", ECTS_VALUES);
  const rokImgs = cellCanvases(engine, page, layout, "rok", centers);
  const rokTexts: string[] = [];
  for (const img of rokImgs) rokTexts.push(await ocrCell(engine, img, lh, { psm: "6" }));


  const rows: OcrRow[] = [];
  let skipped = 0;
  textCells.forEach((cells, i) => {
    const ocrName = rawNames[i];
    const grade = cellInt(gradeTexts[i]) ?? cellInt(cellText(cells.ocena, lh));
    const ectsVal = cellInt(ectsTexts[i]) ?? cellInt(cellText(cells.espb, lh));
    const date = readDate(cellText(dateCells[i].datum, lh)) ?? readDate(cellText(cells.datum, lh));
    const rokText = rokTexts[i] || cellText(cells.rok, lh);
    const period = readMonth(rokText) ?? readMonth(cellText(cells.rok, lh)) ?? (date ? MONTH_OF_DATE[date.month] ?? null : null);
    let ay = readAcadYear(rokText) ?? readAcadYear(cellText(cells.rok, lh));
    if (ay == null && date) ay = period === "novembar" || period === "decembar" ? date.year : date.year - 1;
    engine.debug?.({ i, ocrName, g: gradeTexts[i], e: ectsTexts[i], rokText, d: cellText(dateCells[i].datum, lh) });

    if (!ocrName || grade == null || grade < 6 || grade > 10 || ectsVal == null || !(ECTS_VALUES as readonly string[]).includes(String(ectsVal)) || !period || ay == null) {
      skipped++;
      return;
    }
    // Fix OCR spelling by CER against the ETF course list.
    const match = bestMatch(ocrName, COURSE_NAMES, (x) => x, 0.4);
    rows.push({ name: match ? match.item : ocrName, nameCorrected: !!match && match.cer > 0, ocrName, ects: ectsVal, grade, period, ay });
  });

  return { rows, skipped, footerEcts: readFooterEcts(words, lh) };
}
