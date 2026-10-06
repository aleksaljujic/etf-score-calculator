/**
 * Run the OCR pipeline on a screenshot in Node (same code as the browser).
 * Usage: npx tsx scripts/ocr-check.ts <image> [--dump words.json]
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createWorker, OEM, PSM } from "tesseract.js";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readScreenshot, type OcrEngine } from "../lib/ocr/pipeline.js";
import type { OcrWord } from "../lib/ocr/layout.js";

const require = createRequire(import.meta.url);
const langPath = join(dirname(require.resolve("@tesseract.js-data/srp/package.json")), "4.0.0_best_int");

const [, , file, flag, dumpPath] = process.argv;
const worker = await createWorker("srp", OEM.LSTM_ONLY, { langPath, gzip: true, cachePath: langPath });
const dumps: OcrWord[][] = [];
let cellN = 0;
const engine: OcrEngine = {
  createCanvas: (w, h) => createCanvas(w, h) as any,
  async recognize(canvas, { psm, whitelist }) {
    await worker.setParameters({ tessedit_pageseg_mode: psm as PSM, tessedit_char_whitelist: whitelist ?? "", preserve_interword_spaces: "1" });
    const png = (canvas as any).toBuffer("image/png");
    if (process.env.CELLS && psm === "7" && cellN < 12) writeFileSync(`${process.env.CELLS}/c${cellN++}.png`, png);
    const { data } = await worker.recognize(png, {}, { blocks: true });
    const words: OcrWord[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words)
      words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, conf: Math.round(w.confidence) });
    dumps.push(words);
    return words;
  },
  progress: (s) => console.error("·", s),
  debug: process.env.DEBUG ? (x) => console.error(JSON.stringify(x)) : undefined,
};
const t0 = Date.now();
const img = await loadImage(file);
let res; try { res = await readScreenshot(engine, img as any); } finally { if (flag === "--dump" && dumpPath) writeFileSync(dumpPath, JSON.stringify({ width: img.width, height: img.height, passes: dumps })); }
await worker.terminate();
const esum = res.rows.reduce((s, r) => s + r.ects, 0);
console.log(JSON.stringify({ ms: Date.now() - t0, rows: res.rows.length, skipped: res.skipped, esum, footer: res.footerEcts }));
for (const r of res.rows) console.log(`${r.grade}\t${r.ects}\t${r.ay}\t${r.period}\t${r.name}${r.nameCorrected ? `   ← "${r.ocrName}"` : ""}`);
