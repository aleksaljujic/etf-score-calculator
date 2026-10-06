import { normPeriod, toLatin } from "./text.js";
import type { Period } from "./types.js";

export interface PastedRow { name: string; ects: number; grade: number; period: Period; ay: number }

// "2024/25 октобар 2 27.10.2025." (numbered periods) or "2023/24 август 28.08.2024."
const ROK_RE = /(\d{4})\/\d{2}\s*(\p{L}+)[^\s]*(?:\s+\d)?\s+(\d{1,2}\.\d{1,2}\.\d{4})\.?/gu;
// JS \b is ASCII-only, so use a lookahead for Cyrillic words.
const TYPE_RE = /\s+\d+\s+(обавезан|изборни|obavezan|izborni)(?=\s|$).*$/iu;

/**
 * Parse the passed-exams table copied from ETF eStudent.
 * Rows are anchored on "<academic year> <month>... <date>" (the Rok and date columns).
 */
export function parsePastedTable(text: string): PastedRow[] {
  const t = String(text).replace(/ /g, " ").replace(/\s+/g, " ");
  const rows: PastedRow[] = [];
  let last = 0;
  for (const m of t.matchAll(ROK_RE)) {
    let seg = t.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    seg = seg.replace(/^[^\d]*/, ""); // previous row's teacher name, headers
    const nums = seg.match(/(\d{1,2})\s+(\d{1,2})\s*$/);
    if (!nums) continue;
    const grade = Number(nums[1]);
    const ects = Number(nums[2]);
    if (grade < 6 || grade > 10 || ects < 1 || ects > 30) continue;
    let body = seg.slice(0, nums.index).trim();
    body = body.replace(/^\d+\s+/, "").replace(/^\S+\s+/, ""); // row number, course code
    body = TYPE_RE.test(body)
      ? body.replace(TYPE_RE, "").trim()
      : body.replace(/\s+\d+[.,]\d+\s*$/, "").replace(/\s+1\s*$/, "").trim();
    const period = normPeriod(m[2]);
    if (!body || !period) continue;
    rows.push({ name: toLatin(body), ects, grade, period, ay: Number(m[1]) });
  }
  return rows;
}
