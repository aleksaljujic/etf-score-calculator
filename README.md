# ETF rang-poeni za master

Web app that calculates the ranking score **p** for master admission at ETF Belgrade (Elektrotehnički fakultet, Univerzitet u Beogradu) for candidates with 240 ECTS.

A student uploads a screenshot of the "Položeni ispiti" page from ETF eStudent. The app is for ETF students only. A serverless function sends it to an Azure OpenAI vision model, which returns every exam as JSON. The app looks up each subject's year and semester in the official ETF curriculum, computes the stimulation factor r from when each exam was passed, and calculates p. Without a screenshot, the student can paste the copied table as text; that path needs no API.

```
p = Σ eᵢ(1+rᵢ)oᵢ / ESUM + (2 − M/M₀) − 2D
```

- r = 0.2 if passed in the first exam period (januar for winter courses, jun for summer), 0.1 in the next (februar / jul), otherwise 0, and only if passed in the academic year the course is held.
- M = months from enrollment to graduation, M₀ = 24, D = additional exams.

Source: [ETF master admission 2026/27](https://www.etf.bg.ac.rs/sr/upis/upis-kandidata-na-master-akademske-studije/studijski-program-elektrotehnika-i-racunarstvo).

## Project layout

| Path | What it is |
| --- | --- |
| `public/` | Static frontend (`index.html`, `styles.css`; `app.js` is built) |
| `src/app.ts` | Frontend logic, bundled with esbuild into `public/app.js` |
| `api/extract.ts` | Vercel function `POST /api/extract` |
| `lib/formula.ts` | Score, r and M calculation |
| `lib/curriculum.ts`, `lib/curriculumData.ts` | ETF curriculum data and subject lookup |
| `lib/parsePaste.ts` | Parser for the copied exam table |
| `lib/extract.ts` | Extraction prompt, model JSON parsing and validation |
| `lib/server/` | Request handling, Azure OpenAI client, rate limiting |
| `tests/` | Vitest tests |

## Curriculum coverage

ETF ER 2019 (shared first year + all 6 modules) and ETF Softversko inženjerstvo 2017, i.e. students who enrolled roughly 2019–2022. Energetika electives (semesters 5–8 without a fixed semester), older or newer curricula, and other faculties fall back to the model's guess, shown as dashed fields for the student to check.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the Azure values
npm test
npm run build
npx vercel dev               # http://localhost:3000
```

## Deploy on Vercel

1. In Vercel: **Add New → Project → Import** this GitHub repository. Framework preset: **Other**. The build command and output directory come from `vercel.json`.
2. **Settings → Environment Variables**, add:
   - `AZURE_OPENAI_ENDPOINT` — e.g. `https://<resource>.openai.azure.com`
   - `AZURE_OPENAI_API_KEY`
   - `AZURE_OPENAI_DEPLOYMENT` — a deployment of a model that accepts images
   - `AZURE_OPENAI_API_VERSION` — e.g. `2024-10-21` (use one your resource supports)
   - optional `AZURE_OPENAI_TEMPERATURE=0` for models that accept temperature
3. Recommended: add **Upstash Redis** from the Vercel Marketplace (Storage tab). It sets `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`), which enables a shared per-IP rate limit. Without it, a per-instance in-memory limit is used.
4. Redeploy. Every push to `main` deploys; pull requests get preview URLs.

The API key lives only in Vercel's environment variables. It is never sent to the browser or committed.

## Cost and abuse protection

Every screenshot is one vision call billed to your Azure subscription.

- Per-IP rate limit: `RATE_LIMIT_REQUESTS` per `RATE_LIMIT_WINDOW_SECONDS` (default 5 per 10 minutes).
- Up to `MAX_IMAGES` (8) images, `MAX_IMAGE_BYTES` each and `MAX_TOTAL_BYTES` total. The browser slices long screenshots and compresses them to about 3 MB so requests stay under Vercel's ~4.5 MB body limit.
- Cross-site POSTs are rejected (Origin must match the host).
- Upstream call times out after `MODEL_TIMEOUT_MS` (55 s); the function's `maxDuration` is 60 s in `vercel.json`.
- Set a budget alert on the Azure subscription and a tokens-per-minute limit on the deployment.
- Images and results are not stored or logged.
