# ETF rang-poeni za master

Web app that calculates the ranking score **p** for master admission at ETF Belgrade (Elektrotehnički fakultet, Univerzitet u Beogradu) for candidates with 240 ECTS.

A student uploads one or more screenshots of the "Položeni ispiti" page from ETF eStudent. The table is read **in the browser** with Tesseract.js (Serbian Cyrillic), nothing is sent to a server and no API key is needed. The app finds the columns (from the header, or from the content when the header is cut off), reads grades and ECTS by matching digit shapes learned from the dates, corrects course names by character error rate (CER) against the official ETF curriculum, looks up each subject's year and semester, computes the stimulation factor r, and calculates p. Students can also paste the copied table as text. The app is for ETF students only.

```
p = Σ eᵢ(1+rᵢ)oᵢ / ESUM + (2 − M/M₀) − 2D
```

- r = 0.2 if passed in the first exam period (januar for winter courses, jun for summer), 0.1 in the next (februar / jul), otherwise 0, and only if passed in the academic year the course is held.
- M = months from enrollment to graduation, M₀ = 24, D = additional exams.

Source: [ETF master admission 2026/27](https://www.etf.bg.ac.rs/sr/upis/upis-kandidata-na-master-akademske-studije/studijski-program-elektrotehnika-i-racunarstvo).

## Project layout

| Path | What it is |
| --- | --- |
| `public/` | Static site (`index.html`, `styles.css`; `app.js` and `tesseract/` are built) |
| `src/app.ts`, `src/ocrEngine.ts` | Frontend and the browser OCR engine wrapper |
| `lib/ocr/` | OCR pipeline: preprocessing, column layout, digit templates |
| `lib/fuzzy.ts` | Levenshtein / CER matching of course names |
| `lib/formula.ts` | Score, r and M calculation |
| `lib/curriculum.ts`, `lib/curriculumData.ts` | ETF curriculum data and subject lookup |
| `lib/parsePaste.ts` | Parser for the copied exam table |
| `scripts/copy-tesseract.mjs` | Copies Tesseract.js, its WebAssembly core and Serbian data into `public/tesseract` |
| `scripts/ocr-check.ts` | Runs the same OCR pipeline in Node on a screenshot (`npm run ocr:check -- <image>`) |
| `tests/` | Vitest tests |

## Accuracy

Measured against the real tables:

| Screenshot | Rows | Grades | ECTS |
| --- | --- | --- | --- |
| ETF, zoomed, header cut off (918 px wide JPEG) | 41/45 | 41/41 | 41/41 |
| Full-resolution phone screenshot (1179 px PNG) | 43/43 | 43/43 | 43/43 |

Heavily compressed images (e.g. ~900 px wide with the whole page) are not readable reliably; the app asks for the original screenshot or zoomed parts. When the summed ECTS differs from the page footer, the app warns the student to check the table.

## Curriculum coverage

ETF ER 2019 (shared first year + all 6 modules) and ETF Softversko inženjerstvo 2017. Energetika electives (semesters 5–8 without a fixed semester) and subjects from other curricula stay as dashed guesses.

## Local development

```bash
npm install
npm test
npm run build
npx serve public        # or any static server
```

## Deploy on Vercel

Import the repository in Vercel (preset **Other**). `vercel.json` sets the build command and the `public` output directory. No environment variables are needed. The OCR files (about 5 MB on first use, then cached by the browser) are served from the site itself.
