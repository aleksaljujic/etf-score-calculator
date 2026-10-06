import { CURRICULUM_DATA } from "./curriculumData.js";
import { normName } from "./text.js";
import type { ExamRow } from "./types.js";

interface CurriculumFile {
  programs: Record<string, { url: string; courses: { name: string; semesters: number[] }[] }>;
}

export const CURRICULUM = CURRICULUM_DATA as unknown as CurriculumFile;
export const FIRST_YEAR_ER = "ETF ER 2019 – 1. godina";

interface Entry { program: string; semester: number; name: string; key: string; num: string }

const ENTRIES: Entry[] = [];
for (const [program, p] of Object.entries(CURRICULUM.programs)) {
  for (const c of p.courses) {
    const key = normName(c.name);
    for (const semester of c.semesters) ENTRIES.push({ program, semester, name: c.name, key, num: trailingNumber(key) });
  }
}

function trailingNumber(key: string): string {
  return key.match(/(\d+)$/)?.[1] ?? "";
}

function bigrams(t: string): Map<string, number> {
  const s = t.replace(/ /g, "");
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export function dice(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, ta = 0, tb = 0;
  A.forEach((v) => (ta += v));
  B.forEach((v) => (tb += v));
  A.forEach((v, g) => { if (B.has(g)) inter += Math.min(v, B.get(g)!); });
  return ta + tb ? (2 * inter) / (ta + tb) : 0;
}

/** Curriculum entries matching a course name (exact, else fuzzy with the same trailing number). */
export function candidates(name: string): Entry[] {
  const key = normName(name);
  const exact = ENTRIES.filter((e) => e.key === key);
  if (exact.length) return exact;
  const num = trailingNumber(key);
  let best = 0;
  let out: Entry[] = [];
  for (const e of ENTRIES) {
    if (e.num !== num) continue;
    const d = dice(key, e.key);
    if (d > best) { best = d; out = [e]; }
    else if (d === best && d > 0) out.push(e);
  }
  return best >= 0.86 ? out : [];
}

const yearOf = (s: number) => Math.ceil(s / 2);
const semOf = (s: number) => (s % 2 ? "W" : "S") as "W" | "S";

export interface CurriculumResult { program: string | null; matched: number }

/**
 * Fill study year / semester from the ETF curriculum. Mutates rows.
 * Skips non-ETF students (other faculties have different curricula).
 */
export function applyCurriculum(rows: ExamRow[], faculty = ""): CurriculumResult {
  const hits = rows.map((r) => candidates(r.name));
  const withHit = hits.filter((h) => h.length).length;
  // Trust a named faculty; otherwise require most subjects to be ETF subjects (other faculties share some names).
  const named = faculty.trim();
  const isEtf = named
    ? /etf|elektrotehni/i.test(named)
    : rows.length >= 5 && withHit >= rows.length * 0.75;
  if (!isEtf || !withHit) return { program: null, matched: 0 };

  // Score each program by how many rows it explains; ER modules share the ER first-year list.
  const programs = Object.keys(CURRICULUM.programs).filter((p) => p !== FIRST_YEAR_ER);
  const score: Record<string, number> = {};
  for (const p of programs) {
    score[p] = hits.filter((h) => h.some((e) => e.program === p || (p.startsWith("ETF ER") && e.program === FIRST_YEAR_ER))).length;
  }
  const program = programs.sort((a, b) => score[b] - score[a])[0];
  const allowed = new Set([program]);
  if (program.startsWith("ETF ER")) allowed.add(FIRST_YEAR_ER);

  let matched = 0;
  rows.forEach((row, i) => {
    let h = hits[i];
    if (!h.length) return;
    const inProgram = h.filter((e) => allowed.has(e.program));
    if (inProgram.length) h = inProgram;
    const sems = [...new Set(h.map((e) => e.semester))].sort((a, b) => a - b);
    const fit = sems.find((s) => yearOf(s) === row.sy && semOf(s) === row.sem);
    const pick = fit ?? (sems.length === 1 ? sems[0] : undefined);
    if (pick !== undefined) {
      row.sy = yearOf(pick); row.sem = semOf(pick); row.syGuess = false; row.semGuess = false; matched++;
      return;
    }
    if (sems.every((s) => s % 2 === sems[0] % 2)) {
      row.sem = semOf(sems[0]); row.semGuess = false;
      if (!sems.some((s) => yearOf(s) === row.sy)) row.sy = yearOf(sems[0]);
      row.syGuess = true;
      matched++;
    }
  });
  return { program, matched };
}

/** Fill anything still missing with simple guesses, relative to the earliest academic year. */
export function fillGuesses(rows: ExamRow[], firstYear: number): void {
  for (const r of rows) {
    if (r.sy == null) { r.sy = Math.min(4, Math.max(1, r.ay - firstYear + 1)); r.syGuess = true; }
    if (r.sem == null) { r.sem = r.period === "jun" || r.period === "jul" ? "S" : "W"; r.semGuess = true; }
  }
}

/** Curriculum as plain text for the extraction prompt. */
export function curriculumText(): string {
  return Object.entries(CURRICULUM.programs)
    .map(([program, p]) => {
      const lines = p.courses.flatMap((c) => c.semesters.map((s) => `${s}|${c.name}`));
      return `### ${program} (semester 1-8|course; odd = winter, even = summer; year = ceil(semester/2))\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
