import { describe, expect, it } from "vitest";
import { parsePastedTable } from "../lib/parsePaste.js";
import { normPeriod, toLatin } from "../lib/text.js";

const PASTE = `Р.Бр.	Акроним	Назив	Н.гр.	Тип пријаве	Поени	Оцена	ЕСПБ	Рок	Датум полагања	Потписао наставник
1	13Е054ОПГ	Обрада и препознавање говора	1	изборни предмет		7	6	2025/26 август	04.09.2026.	Жељко Ђуровић
4	19Е033МАП	Мрежна администрација и програмирање	1	изборни предмет		10	6	2024/25 октобар 2	27.10.2025.	Зоран Чича
7	13Е044ДОС	Дигитална обрада слике	1	изборни предмет	73,00	8	6	2024/25 септембар 2	27.09.2025.	Драгомир Ел Мезени
27	13Е082М3	Математика 3	1	обавезан предмет		9	6	2022/23 фебруар	04.02.2023.	Синиша Јешић
Просечна оцена 8,89 Збир ЕСПБ поена 228`;

describe("parsePastedTable", () => {
  it("reads the table copied from eStudent", () => {
    expect(parsePastedTable(PASTE)).toEqual([
      { name: "Obrada i prepoznavanje govora", ects: 6, grade: 7, period: "avgust", ay: 2025 },
      { name: "Mrežna administracija i programiranje", ects: 6, grade: 10, period: "oktobar", ay: 2024 },
      { name: "Digitalna obrada slike", ects: 6, grade: 8, period: "septembar", ay: 2024 },
      { name: "Matematika 3", ects: 6, grade: 9, period: "februar", ay: 2022 },
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
