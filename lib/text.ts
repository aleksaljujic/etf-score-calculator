import { PERIODS, type Period } from "./types.js";

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj",
  м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "ć", у: "u", ф: "f", х: "h", ц: "c", ч: "č",
  џ: "dž", ш: "š",
};

/** Serbian Cyrillic → Serbian Latin, preserving capitalization. */
export function toLatin(text: string): string {
  return String(text).replace(/[Ѐ-ӿ]/g, (ch) => {
    const lower = ch.toLowerCase();
    const v = CYR[lower];
    if (v === undefined) return ch;
    return ch === lower ? v : v.charAt(0).toUpperCase() + v.slice(1);
  });
}

const DIA: Record<string, string> = { č: "c", ć: "c", š: "s", ž: "z", đ: "dj" };

/** Normalized key for comparing course names. */
export function normName(text: string): string {
  return toLatin(text)
    .toLowerCase()
    .replace(/[čćšžđ]/g, (m) => DIA[m])
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PERIOD_PREFIX: [string, Period][] = [
  ["jan", "januar"], ["feb", "februar"], ["apr", "april"], ["jun", "jun"], ["jul", "jul"],
  ["sep", "septembar"], ["okt", "oktobar"], ["oct", "oktobar"], ["nov", "novembar"],
];

/** Normalize an exam period ("октобар-ОС", "Septembar", "jun") to a Period. Returns null if unknown. */
export function normPeriod(text: unknown): Period | null {
  const t = toLatin(String(text ?? "")).toLowerCase().trim();
  if ((PERIODS as readonly string[]).includes(t)) return t as Period;
  for (const [prefix, p] of PERIOD_PREFIX) if (t.startsWith(prefix)) return p;
  return null;
}
