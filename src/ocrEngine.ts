/** Browser OCR engine: Tesseract.js loaded on demand from /tesseract (self-hosted). */
import type { OcrWord } from "../lib/ocr/layout.js";
import type { CanvasLike, OcrEngine, RecognizeOptions } from "../lib/ocr/pipeline.js";

declare const Tesseract: {
  createWorker(lang: string, oem: number, options: Record<string, unknown>): Promise<TesseractWorker>;
};
interface TesseractWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(img: unknown, opts?: unknown, output?: unknown): Promise<{ data: { blocks?: Block[] | null } }>;
  terminate(): Promise<unknown>;
}
interface Block { paragraphs: { lines: { words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }

let scriptLoaded: Promise<void> | null = null;
let worker: Promise<TesseractWorker> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("ocr_load"));
    document.head.append(s);
  });
}

async function getWorker(): Promise<TesseractWorker> {
  scriptLoaded ??= loadScript("/tesseract/tesseract.min.js");
  await scriptLoaded;
  worker ??= Tesseract.createWorker("srp", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core/",
    langPath: "/tesseract/lang",
    gzip: true,
  });
  return worker;
}

/** Stop any running recognition (the next use starts a fresh worker). */
export async function stopOcr() {
  const w = worker;
  worker = null;
  if (w) (await w).terminate().catch(() => {});
}

export function browserEngine(progress: (step: string) => void): OcrEngine {
  return {
    createCanvas(w, h) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c as unknown as CanvasLike;
    },
    async recognize(canvas, { psm, whitelist }: RecognizeOptions): Promise<OcrWord[]> {
      const w = await getWorker();
      await w.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: whitelist ?? "", preserve_interword_spaces: "1" });
      const { data } = await w.recognize(canvas, {}, { blocks: true });
      const words: OcrWord[] = [];
      for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words) {
        words.push({ text: wd.text, x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1, conf: wd.confidence });
      }
      return words;
    },
    progress,
  };
}
