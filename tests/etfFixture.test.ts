import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePastedTable } from "../lib/parsePaste.js";
import { importPasted } from "../lib/importRows.js";

// Copied ETF eStudent table (Signali i sistemi student): footer says 45 exams, 228 ESPB, average 8.89.
const TEXT = readFileSync(new URL("./fixtures-etf.txt", import.meta.url), "utf8");

describe("ETF eStudent table", () => {
  const rows = parsePastedTable(TEXT);
  it("reads every row, including avgust and numbered periods", () => {
    expect(rows).toHaveLength(45);
    expect(rows.reduce((s, r) => s + r.ects, 0)).toBe(228);
    expect(rows[0]).toEqual({ name: "Obrada i prepoznavanje govora", ects: 6, grade: 7, period: "avgust", ay: 2025 });
    expect(rows[3]).toMatchObject({ name: "Mrežna administracija i programiranje", period: "oktobar" });
    expect(rows[31]).toMatchObject({ name: "Fizika 1", grade: 8 });
    expect(rows[44]).toMatchObject({ name: "Praktikum iz osnova elektrotehnike 1", ects: 2 });
  });
  it("matches the module and the portal's average", () => {
    const res = importPasted(rows);
    expect(res.firstYear).toBe(2021);
    expect(res.curriculum.program).toBe("ETF ER 2019 – Signali i sistemi");
    const plain = rows.reduce((s, r) => s + r.ects * r.grade, 0) / 228;
    const simple = rows.reduce((s, r) => s + r.grade, 0) / rows.length;
    expect([plain.toFixed(2), simple.toFixed(2)]).toContain("8.89");
    const m1 = res.rows.find((r) => r.name === "Matematika 1")!;
    expect(m1).toMatchObject({ sy: 1, sem: "W", semGuess: false });
  });
});
