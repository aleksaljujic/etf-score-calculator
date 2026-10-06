// Copies the OCR engine (Tesseract.js), its WebAssembly core and the Serbian language data
// into public/tesseract so the site serves them itself (no third-party CDN).
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const out = join(process.cwd(), "public", "tesseract");
mkdirSync(join(out, "core"), { recursive: true });
mkdirSync(join(out, "lang"), { recursive: true });

const tjs = join(pkgDir("tesseract.js"), "dist");
copyFileSync(join(tjs, "tesseract.min.js"), join(out, "tesseract.min.js"));
copyFileSync(join(tjs, "worker.min.js"), join(out, "worker.min.js"));

// LSTM-only builds are enough (OEM 1); the loader picks SIMD / relaxed-SIMD when the browser supports it.
const core = pkgDir("tesseract.js-core");
for (const f of readdirSync(core)) if (/^tesseract-core.*-lstm(\.wasm)?\.js$/.test(f)) copyFileSync(join(core, f), join(out, "core", f));

copyFileSync(join(pkgDir("@tesseract.js-data/srp"), "4.0.0_best_int", "srp.traineddata.gz"), join(out, "lang", "srp.traineddata.gz"));
console.log("Tesseract assets copied to public/tesseract");
