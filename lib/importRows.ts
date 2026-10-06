import { applyCurriculum, fillGuesses, type CurriculumResult } from "./curriculum.js";
import type { PastedRow } from "./parsePaste.js";
import type { ExamRow, ExtractResponse } from "./types.js";

export interface ImportResult {
  rows: ExamRow[];
  firstYear: number;
  curriculum: CurriculumResult;
  footerEcts: number | null;
}

function finish(rows: ExamRow[], footerEcts: number | null, fallbackYear: number): ImportResult {
  const years = rows.map((r) => r.ay).filter((y) => Number.isFinite(y));
  const firstYear = years.length ? Math.min(...years) : fallbackYear;
  const curriculum = applyCurriculum(rows);
  fillGuesses(rows, firstYear);
  return { rows, firstYear, curriculum, footerEcts };
}

export function importExtraction(res: ExtractResponse, currentYear = new Date().getFullYear()): ImportResult {
  const rows: ExamRow[] = res.rows.map((r) => ({
    name: r.name,
    ects: r.ects,
    grade: r.grade,
    period: r.period,
    ay: r.acadYear ?? currentYear - 1,
    sy: r.studyYear,
    sem: r.semester,
    syGuess: true,
    semGuess: !r.sureSemester,
  }));
  return finish(rows, res.footer.ects, currentYear - 1);
}

export function importPasted(pasted: PastedRow[], currentYear = new Date().getFullYear()): ImportResult {
  const rows: ExamRow[] = pasted.map((r) => ({ ...r, sy: null, sem: null, syGuess: true, semGuess: true }));
  return finish(rows, null, currentYear - 1);
}
