import { computeScore, type RReason } from "../lib/formula.js";
import { importExtraction, importPasted, type ImportResult } from "../lib/importRows.js";
import { parsePastedTable } from "../lib/parsePaste.js";
import { PERIODS, type AppState, type ExamRow, type ExtractResponse } from "../lib/types.js";

const KEY = "etf-score-v1";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const todayIso = () => new Date().toISOString().slice(0, 10);
const yearLabel = (y: number) => `${y}/${String(y + 1).slice(2)}`;
const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(2).replace(".", ",") : "–");
const signed = (v: number) => (Number.isFinite(v) ? (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2).replace(".", ",") : "–");

function defaultState(): AppState {
  const y = new Date().getFullYear() - 4;
  return { firstYear: y, enroll: `${y}-10-01`, grad: todayIso(), m0: 24, d: 0, rows: [] };
}
function load(): AppState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && Array.isArray(s.rows)) return { ...defaultState(), ...s };
  } catch { /* storage unavailable */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

let state = load();

const REASON: Record<RReason, string> = {
  first: "prvi rok",
  next: "sledeći rok",
  later: "kasniji rok",
  "other-year": "nije u svojoj godini",
  unknown: "nepoznato",
};

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function ayOptions(sel: number) {
  const now = new Date().getFullYear();
  const from = Math.min(state.firstYear - 1, sel);
  const to = Math.max(now, sel);
  let h = "";
  for (let y = from; y <= to; y++) h += `<option value="${y}"${y === sel ? " selected" : ""}>${yearLabel(y)}</option>`;
  return h;
}

function render() {
  const tb = $("rows");
  const score = computeScore(state);
  if (!state.rows.length) {
    tb.innerHTML = `<tr><td colspan="11" class="empty">Još nema ispita. Pošalji snimak ekrana iznad ili dodaj ispite ručno.</td></tr>`;
  } else {
    tb.innerHTML = state.rows.map((r, i) => {
      const { r: rv, reason, contribution } = score.perRow[i];
      return `<tr data-i="${i}">
        <td class="idx">${i + 1}</td>
        <td class="name"><input id="n${i}" data-k="name" value="${escapeAttr(r.name)}" aria-label="Naziv predmeta"></td>
        <td class="n"><input id="e${i}" data-k="ects" type="number" min="1" max="30" value="${r.ects}" aria-label="ESPB"></td>
        <td class="n"><select id="g${i}" data-k="grade" aria-label="Ocena">${[6, 7, 8, 9, 10].map((g) => `<option${g === r.grade ? " selected" : ""}>${g}</option>`).join("")}</select></td>
        <td><select id="p${i}" data-k="period" aria-label="Ispitni rok">${PERIODS.map((p) => `<option${p === r.period ? " selected" : ""}>${p}</option>`).join("")}</select></td>
        <td><select id="a${i}" data-k="ay" aria-label="Školska godina polaganja">${ayOptions(r.ay)}</select></td>
        <td class="${r.syGuess ? "guess" : ""}"><select id="y${i}" data-k="sy" aria-label="Godina studija predmeta">${[1, 2, 3, 4].map((y) => `<option${y === r.sy ? " selected" : ""}>${y}</option>`).join("")}</select></td>
        <td class="${r.semGuess ? "guess" : ""}"><select id="s${i}" data-k="sem" aria-label="Semestar"><option value="W"${r.sem === "W" ? " selected" : ""}>Zimski</option><option value="S"${r.sem === "S" ? " selected" : ""}>Letnji</option></select></td>
        <td><span class="chip ${rv === 0.2 ? "r2" : rv === 0.1 ? "r1" : "r0"}">${rv.toFixed(1).replace(".", ",")}</span><span class="why">${REASON[reason]}</span></td>
        <td class="contrib">${contribution.toFixed(1).replace(".", ",")}</td>
        <td><button class="btn ghost" data-del="${i}" type="button" aria-label="Ukloni ispit">✕</button></td>
      </tr>`;
    }).join("");
  }
  $("p").textContent = fmt(score.p);
  $("wavg").textContent = fmt(score.weighted);
  $("plain").textContent = fmt(score.plainAverage);
  $("esum").textContent = String(score.esum);
  $("time").textContent = signed(score.durationTerm);
  $("timeH").textContent = `Član za trajanje, M = ${Number.isFinite(score.months) ? score.months : "–"} meseci`;
  $("dpen").textContent = signed(score.dPenalty);
  $("rcount").textContent = `${score.countR2} / ${score.countR1}`;
  save();
}

function syncInputs() {
  const now = new Date().getFullYear();
  let h = "";
  for (let y = Math.min(2010, state.firstYear); y <= now; y++) h += `<option value="${y}"${y === state.firstYear ? " selected" : ""}>${yearLabel(y)}</option>`;
  $<HTMLSelectElement>("firstYear").innerHTML = h;
  $<HTMLInputElement>("enroll").value = state.enroll;
  $<HTMLInputElement>("grad").value = state.grad;
  $<HTMLInputElement>("m0").value = String(state.m0);
  $<HTMLInputElement>("d").value = String(state.d);
}

/* ---------- table editing ---------- */
$("rows").addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const tr = el.closest("tr");
  const k = el.dataset.k as keyof ExamRow | undefined;
  if (!tr || !k) return;
  const row = state.rows[Number(tr.dataset.i)];
  const numeric = ["ects", "grade", "ay", "sy"].includes(k);
  (row as unknown as Record<string, unknown>)[k] = numeric ? Number(el.value) : el.value;
  if (k === "sy") row.syGuess = false;
  if (k === "sem") row.semGuess = false;
  render();
});
$("rows").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-del]");
  if (!b) return;
  state.rows.splice(Number(b.dataset.del), 1);
  render();
});
$("add").addEventListener("click", () => {
  state.rows.push({ name: "Završni rad", ects: 9, grade: 10, period: "septembar", ay: new Date().getFullYear() - 1, sy: 4, sem: "S", syGuess: false, semGuess: false });
  render();
  $(`n${state.rows.length - 1}`)?.focus();
});
let armed = false;
$("reset").addEventListener("click", (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  if (!armed) {
    armed = true;
    btn.textContent = "Klikni ponovo za brisanje";
    setTimeout(() => { armed = false; btn.textContent = "Obriši sve"; }, 3000);
    return;
  }
  armed = false;
  btn.textContent = "Obriši sve";
  state.rows = [];
  render();
});
$("firstYear").addEventListener("change", (e) => {
  const y = Number((e.target as HTMLSelectElement).value);
  state.firstYear = y;
  state.enroll = `${y}-10-01`;
  syncInputs();
  render();
});
for (const id of ["enroll", "grad", "m0", "d"] as const) {
  $(id).addEventListener("input", (e) => {
    const v = (e.target as HTMLInputElement).value;
    if (id === "m0" || id === "d") state[id] = Number(v);
    else state[id] = v;
    render();
  });
}

/* ---------- status ---------- */
function setStatus(text: string, cls: "" | "ok" | "bad" = "") {
  const s = $("status");
  s.textContent = text;
  s.className = "status " + cls;
}

function applyImport(res: ImportResult) {
  state.rows = res.rows;
  state.firstYear = res.firstYear;
  state.enroll = `${res.firstYear}-10-01`;
  syncInputs();
  render();
  const esum = res.rows.reduce((s, r) => s + r.ects, 0);
  let msg = `Pronađeno ${res.rows.length} ispita, ${esum} ESPB. Prva godina postavljena na ${yearLabel(res.firstYear)} prema najranijem ispitu.`;
  if (res.curriculum.program) {
    msg += ` ${res.curriculum.matched} od ${res.rows.length} predmeta pronađeno u planu „${res.curriculum.program.replace(/ \(.*\)$/, "")}”.`;
  }
  const guesses = res.rows.some((r) => r.syGuess || r.semGuess) ? " Proveri isprekidana polja, to su procene." : "";
  if (res.footerEcts && res.footerEcts !== esum) {
    setStatus(`${msg} Na snimku piše ${res.footerEcts} ESPB, pa možda nedostaje ili je pogrešno pročitan neki red. Proveri tabelu.${guesses}`, "bad");
  } else {
    setStatus(msg + (res.footerEcts ? " Zbir se slaže sa snimkom." : "") + guesses, "ok");
  }
  $("p").scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------- screenshot upload ---------- */
const MAX_PIECES = 8;
const TARGET_TOTAL = 3_000_000; // decoded bytes; keeps the request under Vercel's ~4.5 MB limit

async function loadBitmap(file: File): Promise<ImageBitmap> {
  return await createImageBitmap(file);
}

function sliceRects(W: number, H: number, maxPieces: number) {
  const overlap = Math.round(W * 0.08);
  let sliceH = Math.round(W * 0.9);
  let n = Math.max(1, Math.ceil((H - overlap) / (sliceH - overlap)));
  if (n > maxPieces) { n = maxPieces; sliceH = Math.ceil((H + overlap * (n - 1)) / n); }
  const h = Math.min(sliceH, H);
  return Array.from({ length: n }, (_, i) => ({ y: Math.max(0, Math.min(H - h, i * (sliceH - overlap))), h }));
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", quality));
}

async function prepareImages(files: File[]): Promise<Blob[]> {
  const bitmaps = await Promise.all(files.map(loadBitmap));
  const per = Math.max(1, Math.floor(MAX_PIECES / bitmaps.length));
  const pieces: { bmp: ImageBitmap; y: number; h: number }[] = [];
  for (const bmp of bitmaps) for (const r of sliceRects(bmp.width, bmp.height, per)) pieces.push({ bmp, ...r });
  const use = pieces.slice(0, MAX_PIECES);
  // Try decreasing quality, then width, until the total fits.
  const attempts: [number, number][] = [[1400, 0.85], [1400, 0.72], [1200, 0.7], [1100, 0.62], [1000, 0.55], [900, 0.5]];
  for (const [maxW, q] of attempts) {
    const blobs: Blob[] = [];
    for (const p of use) {
      const scale = Math.min(1, maxW / p.bmp.width);
      const c = document.createElement("canvas");
      c.width = Math.round(p.bmp.width * scale);
      c.height = Math.round(p.h * scale);
      c.getContext("2d")!.drawImage(p.bmp, 0, p.y, p.bmp.width, p.h, 0, 0, c.width, c.height);
      blobs.push(await toBlob(c, q));
    }
    if (blobs.reduce((s, b) => s + b.size, 0) <= TARGET_TOTAL) return blobs;
  }
  throw new Error("too_large");
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

let ctl: AbortController | null = null;

async function handleFiles(list: FileList | File[]) {
  const files = [...list].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
  if (!files.length) { setStatus("Izaberi PNG, JPG ili WebP snimak ekrana.", "bad"); return; }
  const thumbs = $("thumbs");
  thumbs.innerHTML = "";
  for (const f of files) {
    const im = document.createElement("img");
    im.alt = "Poslati snimak ekrana";
    im.src = URL.createObjectURL(f);
    thumbs.append(im);
  }
  setStatus("Pripremam slike…");
  let blobs: Blob[];
  try {
    blobs = await prepareImages(files);
  } catch (e) {
    setStatus((e as Error).message === "too_large"
      ? "Slika je prevelika i posle smanjivanja. Pošalji kraći snimak ili ga podeli na dva dela."
      : "Slika ne može da se otvori. Probaj PNG ili JPG snimak ekrana.", "bad");
    return;
  }
  const images = await Promise.all(blobs.map(async (b) => ({ type: "image/jpeg", data: await blobToBase64(b) })));

  ctl = new AbortController();
  $("stop").hidden = false;
  setStatus("Čitam ispite… obično traje 20–60 sekundi.");
  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images }),
      signal: ctl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const wait = res.headers.get("Retry-After");
      setStatus((body?.message as string) || `Greška ${res.status}. Pokušaj ponovo.` + (wait ? ` (sačekaj ${wait} s)` : ""), "bad");
      if (res.status >= 500) $<HTMLDetailsElement>("pasteBox").open = true;
      return;
    }
    applyImport(importExtraction(body as ExtractResponse));
  } catch (e) {
    if ((e as Error).name === "AbortError") setStatus("Prekinuto.");
    else { setStatus("Nema veze sa serverom. Proveri internet i pokušaj ponovo, ili nalepi tabelu kao tekst.", "bad"); $<HTMLDetailsElement>("pasteBox").open = true; }
  } finally {
    $("stop").hidden = true;
    ctl = null;
  }
}

$("file").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files) handleFiles(input.files);
  input.value = "";
});
$("stop").addEventListener("click", () => ctl?.abort());
const drop = $("drop");
for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
drop.addEventListener("drop", (e) => { const f = (e as DragEvent).dataTransfer?.files; if (f?.length) handleFiles(f); });
document.addEventListener("paste", (e) => {
  if ((e.target as HTMLElement)?.id === "pasteText") return;
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) handleFiles(files);
});

/* ---------- paste fallback ---------- */
$("pasteGo").addEventListener("click", () => {
  const pasted = parsePastedTable($<HTMLTextAreaElement>("pasteText").value);
  const msg = $("pasteMsg");
  if (!pasted.length) {
    msg.textContent = "Nije pronađen nijedan ispit. Kopiraj celu tabelu, uključujući kolone sa rokom i datumom.";
    msg.className = "status bad";
    return;
  }
  msg.textContent = "";
  applyImport(importPasted(pasted));
});

syncInputs();
render();
