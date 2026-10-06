import { describe, expect, it } from "vitest";
import { applyCurriculum, candidates } from "../lib/curriculum.js";
import { importExtraction, importPasted } from "../lib/importRows.js";
import type { ExamRow } from "../lib/types.js";

const row = (name: string, sy: number | null = null, sem: "W" | "S" | null = null, ay = 2021): ExamRow => ({
  name, ects: 6, grade: 8, period: "jun", ay, sy, sem, syGuess: true, semGuess: true,
});

describe("candidates", () => {
  it("matches exact names, ignoring diacritics and Cyrillic", () => {
    expect(candidates("Математика 1").map((e) => e.semester)).toContain(1);
    expect(candidates("Numericka analiza i diskretna matematika").length).toBeGreaterThan(0);
  });
  it("never matches a different number", () => {
    expect(candidates("Matematika 4")).toEqual([]);
    expect(candidates("Programiranje 2").every((e) => e.name === "Programiranje 2")).toBe(true);
  });
  it("tolerates small typos", () => {
    expect(candidates("Operativni sistemi1").length).toBeGreaterThan(0);
    expect(candidates("Projektovanje softvra").length).toBeGreaterThan(0);
    expect(candidates("Arhitektura racunara").length).toBeGreaterThan(0);
  });
});

describe("applyCurriculum", () => {
  const rti = () => [
    row("Matematika 1", 1, "S"), // model guessed wrong semester
    row("Programiranje 1", 1, "W"),
    row("Algoritmi i strukture podataka", 2, "W", 2022),
    row("Signali i sistemi", 2, "S", 2022),
    row("Arhitektura računara", 2, "S", 2022),
    row("Operativni sistemi 1", 2, "S", 2022),
    row("Konkurentno i distribuirano programiranje", 3, "W", 2023),
    row("Neki izmišljen predmet", 3, "W", 2023),
  ];
  it("picks the RTI module and corrects guesses", () => {
    const rows = rti();
    const res = applyCurriculum(rows);
    expect(res.program).toBe("ETF ER 2019 – Računarska tehnika i informatika");
    expect(rows[0]).toMatchObject({ sy: 1, sem: "W", syGuess: false, semGuess: false });
    expect(rows[3]).toMatchObject({ sy: 2, sem: "W", semGuess: false }); // Signali i sistemi = semester 3 in RTI
    expect(rows[7]).toMatchObject({ syGuess: true, semGuess: true }); // unknown subject stays a guess
    expect(res.matched).toBe(7);
  });
});

describe("import pipeline", () => {
  it("sets first year from the earliest exam and fills guesses", () => {
    const res = importPasted([
      { name: "Nepoznat A", ects: 6, grade: 9, period: "januar", ay: 2021 },
      { name: "Nepoznat B", ects: 6, grade: 8, period: "jul", ay: 2023 },
    ]);
    expect(res.firstYear).toBe(2021);
    expect(res.rows[0]).toMatchObject({ sy: 1, sem: "W", syGuess: true, semGuess: true });
    expect(res.rows[1]).toMatchObject({ sy: 3, sem: "S" });
  });
  it("keeps the model's sure semester for a subject outside the curriculum", () => {
    const res = importExtraction({
      footer: { avg: null, ects: 6 },
      rows: [{ rb: 1, name: "Izborni predmet van plana", ects: 6, grade: 10, period: "jun", acadYear: 2021, date: null, studyYear: 1, semester: "S", sureSemester: true }],
    });
    expect(res.rows[0]).toMatchObject({ sy: 1, sem: "S", semGuess: false, syGuess: true });
    expect(res.footerEcts).toBe(6);
  });
});
