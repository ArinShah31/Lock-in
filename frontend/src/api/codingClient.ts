/** Client for coding-platform API, authenticated via SSO token exchange. */

import { api } from "./client";

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

async function exchangeSsoToken(): Promise<void> {
  const { token } = await api<{ token: string }>("/coding-platform/sso-token", { method: "POST" });
  const data = await fetch(`${CODING_API_BASE}/auth/sso`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!data.ok) {
    const err = await data.json().catch(() => ({}));
    throw new CodingApiError(data.status, err.detail || "SSO exchange failed");
  }
  const body = (await data.json()) as { access_token: string };
  setCodingToken(body.access_token);
}

/** Validate cached coding JWT or mint a fresh one via ASTRA SSO. */
export async function ensureCodingSession(force = false): Promise<void> {
  if (!force) {
    const existing = getCodingToken();
    if (existing) {
      try {
        const res = await fetch(`${CODING_API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${existing}` },
        });
        if (res.ok) return;
      } catch {
        /* fall through to re-SSO */
      }
      clearCodingToken();
    }
  } else {
    clearCodingToken();
  }
  await exchangeSsoToken();
}

export async function codingApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  let token = getCodingToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(`${CODING_API_BASE}${path}`, { ...options, headers });

  // Stale coding JWT (e.g. after API restart / port switch) → refresh once.
  if (res.status === 401 && !path.includes("/auth/sso")) {
    clearCodingToken();
    try {
      await exchangeSsoToken();
      token = getCodingToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      res = await fetch(`${CODING_API_BASE}${path}`, { ...options, headers });
    } catch {
      /* keep original 401 response handling below */
    }
  }

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
    if (res.status === 401) clearCodingToken();
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

export type TeacherCodingAnalytics = {
  test_count: number;
  participation: {
    assigned: number;
    started: number;
    submitted: number;
    not_started: number;
  };
  score_distribution: { label: string; count: number }[];
  verdict_mix: { label: string; count: number }[];
  proctor_risk: {
    student_id: number;
    student_name: string;
    student_email: string;
    test_id: number;
    test_title: string;
    assignment_id: number;
    violation_score: number;
    session_status: string | null;
  }[];
  violation_threshold: number;
  scored_attempt_count: number;
  student_id?: number | null;
  student_name?: string | null;
  student_email?: string | null;
  per_test?: {
    test_id: number;
    test_title: string;
    assignment_id: number;
    session_status: string | null;
    average_score: number | null;
    violation_score: number | null;
    eval_count: number;
  }[];
};
