import { computeScore, type RReason } from "../lib/formula.js";
import { importPasted, type ImportResult } from "../lib/importRows.js";
import { OcrLayoutError, readScreenshots, type ImageLike } from "../lib/ocr/pipeline.js";
import { browserEngine, stopOcr } from "./ocrEngine.js";
import { parsePastedTable } from "../lib/parsePaste.js";
import { PERIODS, type AppState, type ExamRow } from "../lib/types.js";

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

function applyImport(res: ImportResult, skipped = 0) {
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
  if (skipped) msg += ` ${skipped} red(ova) nije moglo da se pročita; dodaj ih ručno.`;
  if (res.footerEcts && res.footerEcts !== esum) {
    setStatus(`${msg} Na snimku piše ${res.footerEcts} ESPB, pa možda nedostaje ili je pogrešno pročitan neki red. Proveri tabelu.${guesses}`, "bad");
  } else {
    setStatus(msg + (res.footerEcts ? " Zbir se slaže sa snimkom." : "") + guesses, "ok");
  }
  $("p").scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------- screenshot reading (OCR in the browser) ---------- */
const STEP: Record<string, string> = {
  prepare: "Pripremam sliku",
  text: "Čitam tabelu",
  rows: "Tražim redove",
  numbers: "Čitam ocene, ESPB i rokove",
};
let running = false;
let cancelled = false;

async function handleFiles(list: FileList | File[]) {
  const files = [...list].filter((f) => /^image\//.test(f.type));
  if (!files.length) { setStatus("Izaberi sliku (PNG ili JPG snimak ekrana).", "bad"); return; }
  if (running) return;
  const thumbs = $("thumbs");
  thumbs.innerHTML = "";
  for (const f of files) {
    const im = document.createElement("img");
    im.alt = "Poslati snimak ekrana";
    im.src = URL.createObjectURL(f);
    thumbs.append(im);
  }
  running = true;
  cancelled = false;
  $("stop").hidden = false;
  try {
    setStatus("Učitavam OCR (prvi put oko 5 MB)…");
    const imgs: ImageLike[] = [];
    for (const f of files) {
      const bmp = await createImageBitmap(f);
      if (bmp.width < 700) { setStatus(`Slika je premala (${bmp.width} px). Pošalji originalni snimak ili zumiraj tabelu.`, "bad"); return; }
      imgs.push(bmp as unknown as ImageLike);
    }
    let prefix = "";
    const engine = browserEngine((step) => setStatus(prefix + (STEP[step] ?? "Čitam") + "…"));
    const res = await readScreenshots(engine, imgs, (i) => { prefix = files.length > 1 ? `Slika ${i + 1}/${files.length}: ` : ""; });
    if (cancelled) return;
    const rows = res.rows, footer = res.footerEcts, skipped = res.skipped;
    if (!rows.length) {
      setStatus("Na slici nije pronađen nijedan ispit. Pošalji jasniji snimak tabele „Položeni ispiti” ili nalepi tabelu kao tekst.", "bad");
      $<HTMLDetailsElement>("pasteBox").open = true;
      return;
    }
    applyImport(importPasted(rows, footer), skipped);
  } catch (e) {
    if (cancelled) { setStatus("Prekinuto."); return; }
    const msg = e instanceof OcrLayoutError ? e.message : (e as Error)?.message === "ocr_load"
      ? "OCR nije mogao da se učita. Proveri internet i pokušaj ponovo."
      : "Čitanje slike nije uspelo. Pokušaj sa drugim snimkom ili nalepi tabelu kao tekst.";
    setStatus(msg, "bad");
    $<HTMLDetailsElement>("pasteBox").open = true;
  } finally {
    running = false;
    $("stop").hidden = true;
  }
}

$("file").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files) handleFiles(input.files);
  input.value = "";
});
$("stop").addEventListener("click", () => { cancelled = true; void stopOcr(); });
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
