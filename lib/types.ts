export const PERIODS = ["januar", "februar", "april", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"] as const;
export type Period = (typeof PERIODS)[number];
export type Semester = "W" | "S"; // W = zimski (winter), S = letnji (summer)

export interface ExamRow {
  name: string;
  ects: number;
  grade: number;
  period: Period;
  /** Academic year START in which the exam was passed (2025 for 2025/26). */
  ay: number;
  /** Study year of the course in the curriculum (1–4). */
  sy: number | null;
  sem: Semester | null;
  syGuess: boolean;
  semGuess: boolean;
}

export interface AppState {
  firstYear: number;
  enroll: string;
  grad: string;
  m0: number;
  d: number;
  rows: ExamRow[];
}

/** Row shape returned by /api/extract. */
export interface ExtractedRow {
  rb: number | null;
  name: string;
  ects: number;
  grade: number;
  period: Period;
  acadYear: number | null;
  date: string | null;
  studyYear: number | null;
  semester: Semester | null;
  sureSemester: boolean;
}

export interface ExtractResponse {
  rows: ExtractedRow[];
  footer: { avg: number | null; ects: number | null };
}
