import type { ExamRow, AppState } from "./types.js";

export type RReason = "first" | "next" | "later" | "other-year" | "unknown";

/**
 * Stimulation factor r for one exam (ETF 2026/27 master competition):
 * 0.2 if passed in the first exam period the student was eligible for it,
 * 0.1 in the next period, 0 otherwise — and only if passed in the academic
 * year in which the course is held.
 */
export function stimulation(row: Pick<ExamRow, "sy" | "sem" | "period" | "ay">, firstYear: number): { r: number; reason: RReason } {
  if (row.sy == null || row.sem == null) return { r: 0, reason: "unknown" };
  const ownYear = firstYear + row.sy - 1;
  if (row.ay !== ownYear) return { r: 0, reason: "other-year" };
  const first = row.sem === "W" ? "januar" : "jun";
  const next = row.sem === "W" ? "februar" : "jul";
  if (row.period === first) return { r: 0.2, reason: "first" };
  if (row.period === next) return { r: 0.1, reason: "next" };
  return { r: 0, reason: "later" };
}

/** Whole months between two ISO dates, minus one if the day of month is not yet reached. */
export function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00Z");
  const b = new Date(toIso + "T00:00:00Z");
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return NaN;
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return m;
}

export interface ScoreResult {
  p: number;
  weighted: number;
  plainAverage: number;
  esum: number;
  months: number;
  durationTerm: number;
  dPenalty: number;
  countR2: number;
  countR1: number;
  perRow: { r: number; reason: RReason; contribution: number }[];
}

/** p = Σ eᵢ(1+rᵢ)oᵢ / ESUM + (2 − M/M0) − 2D */
export function computeScore(state: AppState): ScoreResult {
  let esum = 0, sumW = 0, sumPlain = 0, countR2 = 0, countR1 = 0;
  const perRow = state.rows.map((row) => {
    const { r, reason } = stimulation(row, state.firstYear);
    const e = Number(row.ects) || 0;
    const o = Number(row.grade) || 0;
    const contribution = e * (1 + r) * o;
    esum += e;
    sumW += contribution;
    sumPlain += e * o;
    if (r === 0.2) countR2++;
    else if (r === 0.1) countR1++;
    return { r, reason, contribution };
  });
  const m0 = Number(state.m0) > 0 ? Number(state.m0) : 24;
  const months = monthsBetween(state.enroll, state.grad);
  const durationTerm = 2 - months / m0;
  const dPenalty = -2 * (Number(state.d) || 0);
  const weighted = esum ? sumW / esum : NaN;
  const plainAverage = esum ? sumPlain / esum : NaN;
  return {
    p: weighted + durationTerm + dPenalty,
    weighted, plainAverage, esum, months, durationTerm, dPenalty, countR2, countR1, perRow,
  };
}
