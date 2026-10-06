import { describe, expect, it } from "vitest";
import { parsePastedTable } from "../lib/parsePaste.js";
import { normalizeExtraction, parseModelJson, buildPrompt } from "../lib/extract.js";
import { normPeriod, toLatin } from "../lib/text.js";

const PASTE = `Р.Бр.	Акроним	Назив	Н.гр.	Тип пријаве	Поени	Оцена	ЕСПБ	Рок	Датум полагања	Потписао наставник
1	140033	Пројектовање софтвера	1	обавезан предмет		7	6	2025/26 септембар-ОС	03.09.2026.	Синиша Влајић
2	140034	Интелигентни системи	1	обавезан предмет	91,00	10	6	2025/26 јун-ОС	20.06.2026.	Бојан Томић
4	И14127	Увод у неуронске мреже	1	изборни предмет		10	4	2024/25 октобар-ОС	26.10.2025.	Александар Ракићевић
17	140003	Математика 3	1	обавезан предмет		9	6	2023/24 јун-ОС	09.07.2024.	Оливера Михић
Просечна оцена 8,74 Збир ЕСПБ поена 231`;

describe("parsePastedTable", () => {
  it("reads the copied portal table", () => {
    expect(parsePastedTable(PASTE)).toEqual([
      { name: "Projektovanje softvera", ects: 6, grade: 7, period: "septembar", ay: 2025 },
      { name: "Inteligentni sistemi", ects: 6, grade: 10, period: "jun", ay: 2025 },
      { name: "Uvod u neuronske mreže", ects: 4, grade: 10, period: "oktobar", ay: 2024 },
      { name: "Matematika 3", ects: 6, grade: 9, period: "jun", ay: 2023 },
    ]);
  });
  it("works when everything is on one line", () => {
    expect(parsePastedTable(PASTE.replace(/\s+/g, " "))).toHaveLength(4);
  });
  it("returns nothing for unrelated text", () => {
    expect(parsePastedTable("hello world")).toEqual([]);
  });
});

describe("text helpers", () => {
  it("transliterates Cyrillic and keeps capitals", () => {
    expect(toLatin("Љубљана Ђорђе")).toBe("Ljubljana Đorđe");
  });
  it("normalizes exam periods", () => {
    expect(normPeriod("октобар-ОС")).toBe("oktobar");
    expect(normPeriod("Jun")).toBe("jun");
    expect(normPeriod("јул")).toBe("jul");
    expect(normPeriod("xyz")).toBeNull();
  });
});

describe("parseModelJson", () => {
  const obj = { rows: [] };
  it("parses plain, fenced and wrapped JSON", () => {
    expect(parseModelJson(JSON.stringify(obj))).toEqual(obj);
    expect(parseModelJson("```json\n" + JSON.stringify(obj) + "\n```")).toEqual(obj);
    expect(parseModelJson("Here you go: " + JSON.stringify(obj) + " Done.")).toEqual(obj);
  });
  it("throws when there is no JSON", () => {
    expect(() => parseModelJson("sorry, I cannot read this")).toThrow();
  });
});

describe("normalizeExtraction", () => {
  it("coerces, deduplicates by row number and sorts", () => {
    const out = normalizeExtraction({
      faculty: "FON",
      rows: [
        { rb: 2, name: "Б", ects: "6", grade: 11, period: "јун-ОС", acadYear: 2023, studyYear: 9, semester: "S" },
        { rb: 1, name: "A", ects: 6, grade: 7, period: "januar", acadYear: 2022, studyYear: 1, semester: "W", sureSemester: true },
        { rb: 2, name: "duplicate", ects: 6, grade: 8, period: "jun", acadYear: 2023 },
        { rb: 3, name: "", ects: 6, grade: 8, period: "jun" },
        { rb: 4, name: "bad period", ects: 6, grade: 8, period: "maj" },
      ],
      footer: { avg: "8,74", ects: 12 },
    });
    expect(out.faculty).toBe("FON");
    expect(out.rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(out.rows[1]).toMatchObject({ grade: 10, period: "jun", studyYear: null, sureSemester: false });
    expect(out.footer).toEqual({ avg: 8.74, ects: 12 });
  });
  it("handles garbage input", () => {
    expect(normalizeExtraction(null)).toEqual({ faculty: "", rows: [], footer: { avg: null, ects: null } });
  });
});

describe("buildPrompt", () => {
  it("includes the curriculum", () => {
    const p = buildPrompt();
    expect(p).toContain("### ETF ER 2019 – Računarska tehnika i informatika");
    expect(p).toContain("1|Matematika 1");
  });
});
