import { describe, expect, it } from "vitest";
import { computeScore, monthsBetween, stimulation } from "../lib/formula.js";
import type { AppState, ExamRow } from "../lib/types.js";

const row = (o: Partial<ExamRow>): ExamRow => ({
  name: "X", ects: 6, grade: 10, period: "januar", ay: 2021, sy: 1, sem: "W", syGuess: false, semGuess: false, ...o,
});

describe("stimulation factor r", () => {
  const fy = 2021;
  it("winter course: januar in its own year = 0.2, februar = 0.1, jun = 0", () => {
    expect(stimulation(row({ period: "januar" }), fy).r).toBe(0.2);
    expect(stimulation(row({ period: "februar" }), fy).r).toBe(0.1);
    expect(stimulation(row({ period: "jun" }), fy)).toEqual({ r: 0, reason: "later" });
  });
  it("winter course passed in januar of the NEXT academic year = 0", () => {
    expect(stimulation(row({ period: "januar", ay: 2022 }), fy)).toEqual({ r: 0, reason: "other-year" });
  });
  it("summer course: jun = 0.2, jul = 0.1, septembar = 0", () => {
    expect(stimulation(row({ sem: "S", period: "jun" }), fy).r).toBe(0.2);
    expect(stimulation(row({ sem: "S", period: "jul" }), fy).r).toBe(0.1);
    expect(stimulation(row({ sem: "S", period: "septembar" }), fy).r).toBe(0);
  });
  it("uses the course's study year to find its own academic year", () => {
    expect(stimulation(row({ sy: 3, ay: 2023, period: "januar" }), fy).r).toBe(0.2);
    expect(stimulation(row({ sy: 3, ay: 2022, period: "januar" }), fy).r).toBe(0);
  });
});

describe("monthsBetween", () => {
  it("counts whole months with the day-of-month adjustment", () => {
    expect(monthsBetween("2021-10-01", "2025-10-01")).toBe(48);
    expect(monthsBetween("2021-10-01", "2025-09-15")).toBe(47);
    expect(monthsBetween("2021-10-15", "2025-10-14")).toBe(47);
    expect(monthsBetween("bad", "2025-10-14")).toBeNaN();
  });
});

describe("computeScore", () => {
  const base: AppState = {
    firstYear: 2021, enroll: "2021-10-01", grad: "2025-10-01", m0: 24, d: 0,
    rows: [
      row({ ects: 6, grade: 10, sem: "W", sy: 1, period: "januar", ay: 2021 }), // 6·1.2·10 = 72
      row({ ects: 6, grade: 8, sem: "S", sy: 1, period: "jul", ay: 2021 }), // 6·1.1·8 = 52.8
      row({ ects: 4, grade: 9, sem: "W", sy: 2, period: "septembar", ay: 2022 }), // 4·1·9 = 36
    ],
  };
  it("matches a hand-computed example", () => {
    const s = computeScore(base);
    expect(s.esum).toBe(16);
    expect(s.weighted).toBeCloseTo(160.8 / 16, 10);
    expect(s.plainAverage).toBeCloseTo((60 + 48 + 36) / 16, 10);
    expect(s.months).toBe(48);
    expect(s.durationTerm).toBe(0);
    expect(s.p).toBeCloseTo(10.05, 10);
    expect(s.countR2).toBe(1);
    expect(s.countR1).toBe(1);
  });
  it("subtracts 2 per additional exam and adds the time bonus", () => {
    expect(computeScore({ ...base, d: 1 }).p).toBeCloseTo(8.05, 10);
    expect(computeScore({ ...base, grad: "2025-09-15" }).p).toBeCloseTo(10.05 + 2 - 47 / 24, 10);
  });
  it("returns NaN p for an empty table", () => {
    expect(computeScore({ ...base, rows: [] }).p).toBeNaN();
  });
});
