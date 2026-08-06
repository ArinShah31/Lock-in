/** Client for coding-platform API, authenticated via SSO token exchange. */

const CODING_API_BASE = "/coding-api/v1";
const TOKEN_KEY = "astra_coding_access_token";

export class CodingApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getCodingToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setCodingToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearCodingToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function codingApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getCodingToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${CODING_API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.detail?.toString?.() || data.detail || message;
      if (Array.isArray(data.detail)) {
        message = data.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join("; ");
      }
    } catch {
      /* ignore */
    }
    throw new CodingApiError(res.status, typeof message === "string" ? message : "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type Language = "python" | "java" | "cpp" | "html" | "css" | "javascript";
export type QuestionType = "SYLLABUS" | "HIRING";

export type CodingQuestion = {
  id: number;
  title: string;
  prompt_markdown: string;
  starter_code: string;
  language: Language;
  difficulty: Difficulty;
  question_type: QuestionType;
  created_by_id: number;
  is_active: boolean;
};

export type CodingTest = {
  id: number;
  title: string;
  duration_minutes: number;
  invite_code: string;
  is_published_results: boolean;
  created_by_id: number;
  questions: {
    order_index: number;
    required_difficulty: Difficulty;
    question: CodingQuestion;
  }[];
};

export type AttemptEval = {
  eval_run_id: number | null;
  submission_id: number | null;
  question_id: number;
  question_title: string;
  difficulty: Difficulty;
  language: Language | null;
  code: string | null;
  total_score: number;
  verdict: string;
  feedback: string;
  scores: Record<string, unknown>;
};

export type AttemptRow = {
  assignment_id: number;
  student_id: number;
  student_name: string;
  student_email: string;
  session_status: string | null;
  violation_score: number | null;
  average_score: number | null;
  evals: AttemptEval[];
  test_id?: number | null;
  test_title?: string | null;
};

export type StudentResultSummary = {
  student_id: number;
  student_name: string;
  student_email: string;
  assignment_count: number;
  started_count: number;
  submitted_count: number;
};
