import { curriculumText } from "./curriculum.js";
import { normPeriod, toLatin } from "./text.js";
import type { ExtractResponse, ExtractedRow } from "./types.js";

export const EXTRACT_PROMPT = `These images are screenshots of the "Положени испити" (passed exams) page of eStudent, the student portal of ETF Belgrade (Elektrotehnički fakultet, Univerzitet u Beogradu), possibly a long page split into overlapping slices, in order top to bottom. Columns: Р.Бр. (row number), Акроним, Назив (course name), Н.гр., Тип пријаве, Поени, Оцена (grade 6-10), ЕСПБ (ECTS: 2, 3 or 6, or 12 for the final thesis), Рок (exam period, e.g. "2024/25 октобар 2"), Датум полагања (date), teacher.

Extract EVERY exam row exactly once (slices overlap; use the row number to avoid duplicates). Also read the footer line with average grade and total ECTS if visible.

For each row set the study year (1-4) and semester of the course using the official ETF curriculum below: first decide which program/module best matches the student's courses, then look each course up in it (ER students share the "1. godina" list). For courses not in the list, guess from the course name and when it was passed: winter semester exams are first held in januar, summer semester exams in jun; a course passed late still belongs to its original semester. Set "sureSemester" true only for courses found in the curriculum.

Reply with ONLY this JSON:
{"rows":[{"rb":1,"name":"course name transliterated to Serbian Latin","ects":6,"grade":7,"period":"januar|februar|april|jun|jul|avgust|septembar|oktobar|novembar|decembar","acadYear":2025,"date":"2026-09-03","studyYear":4,"semester":"W|S","sureSemester":false}],"footer":{"avg":8.89,"ects":228}}
acadYear is the FIRST year of the academic year in the Рок column (2025/26 -> 2025). Numbered periods like "октобар 2" or "септембар 2" are just the month ("oktobar", "septembar"). Use null for anything unreadable.
`;

export function buildPrompt(): string {
  return EXTRACT_PROMPT + "\n" + curriculumText();
}

/** Parse a model reply that should contain one JSON object. Throws on failure. */
export function parseModelJson(text: string): unknown {
  const t = String(text ?? "").trim();
  try { return JSON.parse(t); } catch { /* next */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* next */ } }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("no JSON in model reply");
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Validate, coerce, deduplicate and sort the model's output. */
export function normalizeExtraction(raw: unknown): ExtractResponse {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(obj.rows) ? obj.rows : [];
  const seen = new Map<string, ExtractedRow>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? toLatin(r.name).trim() : "";
    if (!name) continue;
    const grade = num(r.grade);
    const ects = num(r.ects);
    const period = normPeriod(r.period);
    if (grade === null || ects === null || !period) continue;
    const rb = num(r.rb);
    const sy = num(r.studyYear);
    const row: ExtractedRow = {
      rb: rb === null ? null : Math.round(rb),
      name,
      ects: Math.min(30, Math.max(1, Math.round(ects))),
      grade: Math.min(10, Math.max(6, Math.round(grade))),
      period,
      acadYear: num(r.acadYear),
      date: typeof r.date === "string" ? r.date : null,
      studyYear: sy !== null && sy >= 1 && sy <= 4 ? Math.round(sy) : null,
      semester: r.semester === "W" || r.semester === "S" ? r.semester : null,
      sureSemester: r.sureSemester === true,
    };
    const key = row.rb !== null ? `n${row.rb}` : `${normKey(name)}|${row.date ?? ""}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  const rows = [...seen.values()].sort((a, b) => (a.rb ?? 1e9) - (b.rb ?? 1e9));
  const footer = (obj.footer && typeof obj.footer === "object" ? obj.footer : {}) as Record<string, unknown>;
  return {
    rows,
    footer: { avg: num(footer.avg), ects: num(footer.ects) },
  };
}

function normKey(s: string) { return s.toLowerCase().replace(/\s+/g, " "); }
