const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = localStorage.getItem("coding_access_token");
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") {
        message = data.detail;
      } else if (Array.isArray(data.detail)) {
        message = data.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join("; ");
      } else if (data.detail != null) {
        message = String(data.detail);
      }
    } catch {
      if (res.status === 404) {
        message = "Coding API not reachable (check Vite proxy → port 8011)";
      }
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type Role = "TEACHER" | "STUDENT";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type Language = "python" | "java" | "cpp" | "html" | "css" | "javascript";
export type QuestionType = "SYLLABUS" | "HIRING";

export type User = {
  id: number;
  full_name: string;
  email: string;
  role: Role;
};

export type Question = {
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
    question: Question;
  }[];
};

export type Assignment = {
  id: number;
  coding_test_id: number;
  student_id: number;
  status: string;
  test_title?: string | null;
  duration_minutes?: number | null;
  is_published_results?: boolean;
  student_email?: string | null;
  student_name?: string | null;
};

export type Session = {
  id: number;
  assignment_id: number;
  started_at: string;
  ends_at: string;
  status: string;
  violation_score: number;
  current_question_order: number;
  remaining_seconds: number;
  warning?: string | null;
};

export type ExamQuestion = {
  order_index: number;
  difficulty: Difficulty;
  question_id: number;
  title: string;
  prompt_markdown: string;
  starter_code: string;
  language: Language;
  unlocked: boolean;
  draft_code?: string | null;
};
