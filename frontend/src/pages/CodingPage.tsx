import { FormEvent, type DragEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { codingPlatformApi, classroomsApi } from "../api";
import {
  clearCodingToken,
  codingApi,
  ensureCodingSession,
  type AttemptEval,
  type AttemptRow,
  type BloomLevel,
  type CodingQuestion,
  type CodingTest,
  type Language,
  type QuestionDraft,
  type RubricCriterion,
  type StudentResultSummary,
} from "../api/codingClient";
import { useAuth } from "../auth/AuthContext";
import {
  EmptyState,
  ErrorText,
  Field,
  inputClass,
  PageHeader,
  Panel,
  PrimaryButton,
} from "../components/ui";

const LANGUAGES: Language[] = ["python", "java", "cpp", "html", "css", "javascript"];
const BLOOM_LEVELS: BloomLevel[] = [
  "REMEMBER",
  "UNDERSTAND",
  "APPLY",
  "ANALYZE",
  "EVALUATE",
  "CREATE",
];
const RESULTS_MODE_KEY = "astra_coding_results_view";

type CodingTab = "bank" | "generate" | "tests" | "results";

const BLOOM_LEVEL_NUM: Record<string, number> = {
  REMEMBER: 1,
  UNDERSTAND: 2,
  APPLY: 3,
  ANALYZE: 4,
  EVALUATE: 5,
  CREATE: 6,
};

function bloomLabel(level: BloomLevel | string | undefined) {
  if (!level) return "";
  const key = String(level).toUpperCase();
  const n = BLOOM_LEVEL_NUM[key];
  const name = key.charAt(0) + key.slice(1).toLowerCase();
  return n ? `L${n} ${name}` : name;
}

const DND_BANK = "application/x-astra-bank-qid";
const DND_SEQ = "application/x-astra-seq-index";

function insertQuestionId(ids: number[], id: number, at: number | null): number[] {
  if (ids.includes(id)) return ids;
  if (at === null || at < 0 || at >= ids.length) return [...ids, id];
  const next = [...ids];
  next.splice(at, 0, id);
  return next;
}

function reorderQuestionIds(ids: number[], from: number, to: number): number[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length) return ids;
  const next = [...ids];
  const [item] = next.splice(from, 1);
  const clamped = Math.min(to, next.length);
  next.splice(clamped, 0, item);
  return next;
}

const RUBRIC_ICONS = [
  { icon: "view_in_ar", bg: "bg-[#e8edf5]", fg: "text-[#3f5d9b]" },
  { icon: "account_tree", bg: "bg-[#e7f3ec]", fg: "text-[#2f6b4f]" },
  { icon: "memory", bg: "bg-[#f5efe4]", fg: "text-[#9a6b2f]" },
  { icon: "code", bg: "bg-[#eee8f5]", fg: "text-[#5b4b8a]" },
  { icon: "check_circle", bg: "bg-[#e8edf5]", fg: "text-[#031635]" },
];

function emptyRubricRow(): RubricCriterion {
  return { name: "", description: "", weight: 0, max_points: 100 };
}

/** Pick one other row to absorb leftover weight so prior edits stay intact. */
function slackIndex(rows: RubricCriterion[], editedIndex: number): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (i !== editedIndex) return i;
  }
  return -1;
}

/**
 * Set one row's weight; only the last other row absorbs the delta.
 * Previously typed weights on the remaining rows stay unchanged.
 */
function setWeightKeepingTotal(rows: RubricCriterion[], index: number, raw: number): RubricCriterion[] {
  if (!rows.length) return rows;
  if (rows.length === 1) {
    return [{ ...rows[0], weight: 100, max_points: 100 }];
  }

  const next = rows.map((row) => ({ ...row, max_points: 100 }));
  const slack = slackIndex(next, index);
  const othersFixed = next.reduce(
    (sum, row, i) => (i === index || i === slack ? sum : sum + (Number(row.weight) || 0)),
    0,
  );
  // Edited weight cannot leave the slack row outside [0, 100]
  const maxEditable = Math.round((100 - othersFixed) * 100) / 100;
  const W = Math.max(0, Math.min(maxEditable, Number.isFinite(raw) ? raw : 0));
  const slackWeight = Math.round((100 - othersFixed - W) * 100) / 100;

  next[index] = { ...next[index], weight: Math.round(W * 100) / 100 };
  next[slack] = { ...next[slack], weight: Math.max(0, Math.min(100, slackWeight)) };
  return next;
}

function RubricEditor({
  rows,
  onChange,
}: {
  rows: RubricCriterion[];
  onChange: (rows: RubricCriterion[]) => void;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftText, setDraftText] = useState("");

  function updateField(index: number, patch: Partial<Pick<RubricCriterion, "name" | "description">>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch, max_points: 100 } : row)));
  }

  function addCriterion() {
    // Keep existing weights; new row starts at 0 (total still 100 until you edit it).
    onChange([...rows.map((row) => ({ ...row, max_points: 100 })), emptyRubricRow()]);
  }

  function removeCriterion(index: number) {
    if (editingIndex === index) {
      setEditingIndex(null);
      setDraftText("");
    }
    if (rows.length <= 1) {
      onChange([]);
      return;
    }
    const removed = Number(rows[index]?.weight) || 0;
    const kept = rows.filter((_, i) => i !== index).map((row) => ({ ...row, max_points: 100 }));
    // Pour removed weight into the last remaining row only.
    const last = kept.length - 1;
    kept[last] = {
      ...kept[last],
      weight: Math.round((Number(kept[last].weight) + removed) * 100) / 100,
    };
    onChange(kept);
  }

  function commitWeight(index: number, text: string) {
    const trimmed = text.trim();
    if (trimmed === "" || !Number.isFinite(Number(trimmed))) {
      // Restore previous value — do not snap empty → 0 while typing.
      return;
    }
    onChange(setWeightKeepingTotal(rows, index, Number(trimmed)));
  }

  const totalWeight = Math.round(rows.reduce((sum, row) => sum + (Number(row.weight) || 0), 0) * 100) / 100;

  return (
    <div className="overflow-hidden rounded-xl border border-[#e1e3e4] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e1e3e4] px-4 py-3">
        <div>
          <h3 className="font-display text-lg font-bold text-[#031635]">Rubric</h3>
          <p className="mt-0.5 text-sm text-[#75777f]">
            Weights always add up to 100%. Editing one only adjusts the last other criterion.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg bg-[#031635] px-3 py-2 text-sm font-semibold text-white"
          onClick={addCriterion}
        >
          <span className="material-symbols-outlined text-base">add</span>
          Add Criterion
        </button>
      </div>

      <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_7rem_2.5rem] gap-3 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#75777f] sm:grid">
        <span>Criterion</span>
        <span>Description</span>
        <span className="text-[#3f5d9b]">Weight</span>
        <span className="sr-only">Actions</span>
      </div>

      <div className="divide-y divide-[#e1e3e4]">
        {rows.map((row, index) => {
          const style = RUBRIC_ICONS[index % RUBRIC_ICONS.length];
          const isEditing = editingIndex === index;
          return (
            <div
              key={index}
              className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_7rem_2.5rem]"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style.bg} ${style.fg}`}
                >
                  <span className="material-symbols-outlined text-[20px]">{style.icon}</span>
                </span>
                <input
                  className="min-w-0 flex-1 rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] px-2.5 py-2 text-sm font-semibold text-[#031635] outline-none focus:border-[#031635]"
                  placeholder="Criterion name"
                  value={row.name}
                  onChange={(e) => updateField(index, { name: e.target.value })}
                />
              </div>
              <input
                className="rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] px-2.5 py-2 text-sm text-[#44474e] outline-none focus:border-[#031635]"
                placeholder="What to look for"
                value={row.description}
                onChange={(e) => updateField(index, { description: e.target.value })}
              />
              <input
                type="text"
                inputMode="decimal"
                className="rounded-lg border border-[#d6e3ff] bg-[#eef4ff] px-2.5 py-2 text-sm font-semibold text-[#3f5d9b] outline-none focus:border-[#031635]"
                placeholder="0"
                value={isEditing ? draftText : String(row.weight)}
                onFocus={() => {
                  setEditingIndex(index);
                  // Start empty when 0 so the teacher can type immediately.
                  setDraftText(Number(row.weight) === 0 ? "" : String(row.weight));
                }}
                onChange={(e) => {
                  const text = e.target.value.replace(/[^\d.]/g, "");
                  setDraftText(text);
                  if (text !== "" && Number.isFinite(Number(text))) {
                    onChange(setWeightKeepingTotal(rows, index, Number(text)));
                  }
                }}
                onBlur={() => {
                  commitWeight(index, draftText);
                  setEditingIndex(null);
                  setDraftText("");
                }}
              />
              <button
                type="button"
                className="justify-self-end text-[#75777f] hover:text-[#ba1a1a]"
                title="Remove criterion"
                onClick={() => removeCriterion(index)}
              >
                <span className="material-symbols-outlined text-[20px]">delete</span>
              </button>
            </div>
          );
        })}
        {!rows.length ? (
          <p className="px-4 py-6 text-sm text-[#75777f]">No criteria yet. Add one to start the rubric.</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e1e3e4] bg-[#f8f9fa] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#031635]">
          <span className="material-symbols-outlined text-[#3f5d9b]">workspace_premium</span>
          Total
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-[#44474e]">
            <span className="font-display text-xl font-extrabold text-[#3f5d9b]">{totalWeight}</span>
            <span className="mx-1 text-[#75777f]">/</span>
            <span className="font-display text-xl font-extrabold text-[#031635]">100%</span>
          </p>
          <span className="rounded-full bg-[#e7f3ec] px-2.5 py-1 text-xs font-bold text-[#2f6b4f]">
            100%
          </span>
        </div>
      </div>
    </div>
  );
}

type ResultsViewMode = "tests" | "students";

function readResultsMode(): ResultsViewMode {
  try {
    const v = localStorage.getItem(RESULTS_MODE_KEY);
    return v === "students" ? "students" : "tests";
  } catch {
    return "tests";
  }
}

function statusLabel(status: string | null | undefined) {
  if (!status) return "not started";
  return status.toLowerCase().replace(/_/g, " ");
}

const RUBRIC_SCORE_META = new Set(["teacher_override", "correctness"]);

function rubricScoreEntries(scores: Record<string, unknown> | null | undefined): { name: string; value: string }[] {
  if (!scores) return [];
  return Object.entries(scores)
    .filter(([key, val]) => !RUBRIC_SCORE_META.has(key) && typeof val === "number")
    .map(([name, value]) => ({ name, value: String(value) }));
}

export function CodingPage() {
  const { user } = useAuth();
  const isTeacher = user?.role === "CLASS_TEACHER" || user?.role === "SUBJECT_TEACHER";
  const isStudent = user?.role === "STUDENT";

  const access = useQuery({
    queryKey: ["coding-access"],
    queryFn: codingPlatformApi.access,
  });

  const [ssoError, setSsoError] = useState<string | null>(() => {
    const cached = sessionStorage.getItem("coding_launch_error");
    if (cached) sessionStorage.removeItem("coding_launch_error");
    return cached;
  });
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!isStudent || !access.data?.enabled) return;
    let cancelled = false;
    setRedirecting(true);
    void (async () => {
      try {
        const { token, frontend_url } = await codingPlatformApi.ssoToken();
        if (cancelled) return;
        window.location.assign(`${frontend_url}/sso?token=${encodeURIComponent(token)}`);
      } catch (e) {
        if (!cancelled) {
          setSsoError(e instanceof Error ? e.message : "Could not open coding platform");
          setRedirecting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStudent, access.data?.enabled]);

  if (access.isLoading) {
    return (
      <div>
        <PageHeader title="Coding" subtitle="Loading access…" />
      </div>
    );
  }

  if (!isTeacher && !isStudent) {
    return (
      <div>
        <PageHeader title="Coding" />
        <Panel>
          <EmptyState title="Not available" body="Coding platform is for teachers and students." />
        </Panel>
      </div>
    );
  }

  if (!access.data?.enabled) {
    return (
      <div>
        <PageHeader title="Coding" subtitle="Coding assessments for your department." />
        <Panel>
          <EmptyState
            title="Coding platform is disabled"
            body={access.data?.reason || "Ask your HOD to enable the coding platform."}
          />
        </Panel>
      </div>
    );
  }

  if (isStudent) {
    return (
      <div>
        <PageHeader title="Coding" subtitle="Opening your coding workspace…" />
        <Panel>
          <ErrorText message={ssoError} />
          <p className="text-sm text-[#44474e]">
            {redirecting ? "Redirecting to the coding platform…" : "Waiting…"}
          </p>
        </Panel>
      </div>
    );
  }

  return <TeacherCodingWorkspace expectedEmail={user?.email} />;
}

function TeacherCodingWorkspace({ expectedEmail }: { expectedEmail?: string }) {
  const qc = useQueryClient();
  const location = useLocation();
  const navState = (location.state as {
    tab?: CodingTab;
    resultsMode?: ResultsViewMode;
    selectedTestId?: number | null;
    selectedStudentId?: number | null;
  } | null) ?? null;

  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [tab, setTab] = useState<CodingTab>(navState?.tab ?? "bank");
  const [expandedQuestionId, setExpandedQuestionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openCodeKey, setOpenCodeKey] = useState<string | null>(null);
  const [editingEvalId, setEditingEvalId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ total_score: 0, feedback: "", verdict: "PASS" });
  const [selectedTestId, setSelectedTestId] = useState<number | null>(navState?.selectedTestId ?? null);
  const [expandedAttemptId, setExpandedAttemptId] = useState<number | null>(null);
  const [resultsTestSearch, setResultsTestSearch] = useState("");
  const [classroomByTest, setClassroomByTest] = useState<Record<number, number>>({});
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [resultsMode, setResultsMode] = useState<ResultsViewMode>(
    () => navState?.resultsMode ?? readResultsMode(),
  );
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(
    navState?.selectedStudentId ?? null,
  );
  const [selectedStudentAttemptId, setSelectedStudentAttemptId] = useState<number | null>(null);

  const [qForm, setQForm] = useState({
    title: "",
    prompt_markdown: "",
    starter_code: "",
    language: "python" as Language,
    bloom_level: "APPLY" as BloomLevel,
    rubric: [emptyRubricRow(), emptyRubricRow(), emptyRubricRow(), emptyRubricRow()] as RubricCriterion[],
  });
  const [testForm, setTestForm] = useState({
    title: "New coding test",
    duration_minutes: 45,
    question_ids: [] as number[],
  });
  const [seqDropIndex, setSeqDropIndex] = useState<number | null>(null);
  const [genForm, setGenForm] = useState({
    topic_or_scenario: "",
    bloom_level: "APPLY" as BloomLevel,
    language: "python" as Language,
  });
  const [draft, setDraft] = useState<QuestionDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void (async () => {
      try {
        await ensureCodingSession(false, expectedEmail);
        if (!cancelled) setReady(true);
      } catch (e) {
        clearCodingToken();
        if (!cancelled) setBootError(e instanceof Error ? e.message : "Could not connect");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expectedEmail]);

  const questions = useQuery({
    queryKey: ["coding-questions", expectedEmail],
    queryFn: () => codingApi<CodingQuestion[]>("/teacher/questions"),
    enabled: ready,
  });
  const tests = useQuery({
    queryKey: ["coding-tests", expectedEmail],
    queryFn: () => codingApi<CodingTest[]>("/teacher/tests"),
    enabled: ready,
  });
  const myClassrooms = useQuery({
    queryKey: ["coding-my-classrooms"],
    queryFn: classroomsApi.list,
    enabled: ready,
  });
  const attempts = useQuery({
    queryKey: ["coding-attempts", expectedEmail, selectedTestId],
    queryFn: () => codingApi<AttemptRow[]>(`/results/tests/${selectedTestId}/attempts`),
    enabled: ready && selectedTestId != null && tab === "results" && resultsMode === "tests",
  });
  const resultStudents = useQuery({
    queryKey: ["coding-result-students", expectedEmail],
    queryFn: () => codingApi<StudentResultSummary[]>("/results/students"),
    enabled: ready && tab === "results" && resultsMode === "students",
  });
  const studentAttempts = useQuery({
    queryKey: ["coding-student-attempts", expectedEmail, selectedStudentId],
    queryFn: () => codingApi<AttemptRow[]>(`/results/students/${selectedStudentId}/attempts`),
    enabled:
      ready &&
      tab === "results" &&
      resultsMode === "students" &&
      selectedStudentId != null,
  });

  useEffect(() => {
    try {
      localStorage.setItem(RESULTS_MODE_KEY, resultsMode);
    } catch {
      /* ignore */
    }
  }, [resultsMode]);

  function switchResultsMode(mode: ResultsViewMode) {
    setResultsMode(mode);
    setSelectedStudentId(null);
    setSelectedStudentAttemptId(null);
    setExpandedAttemptId(null);
    setOpenCodeKey(null);
    setEditingEvalId(null);
  }

  const importQuestions = useMutation({
    mutationFn: () =>
      codingApi<CodingQuestion[]>("/teacher/questions/import-all", { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["coding-questions"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => {
    if (!ready || questions.isLoading || questions.isError || importQuestions.isPending) return;
    if ((questions.data?.length ?? 0) > 0) return;
    importQuestions.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot when bank empty
  }, [ready, questions.isLoading, questions.data]);

  const byBloom = useMemo(() => {
    const map = Object.fromEntries(BLOOM_LEVELS.map((level) => [level, [] as CodingQuestion[]])) as Record<
      BloomLevel,
      CodingQuestion[]
    >;
    for (const q of questions.data || []) {
      const level = (q.bloom_level || "APPLY") as BloomLevel;
      (map[level] ?? map.APPLY).push(q);
    }
    return map;
  }, [questions.data]);

  const questionById = useMemo(() => {
    const map = new Map<number, CodingQuestion>();
    for (const q of questions.data || []) map.set(q.id, q);
    return map;
  }, [questions.data]);

  const filteredResultsTests = useMemo(() => {
    const q = resultsTestSearch.trim().toLowerCase();
    const list = tests.data || [];
    if (!q) return list;
    return list.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.invite_code.toLowerCase().includes(q),
    );
  }, [tests.data, resultsTestSearch]);

  function addQuestionToSequence(id: number, at: number | null = null) {
    setTestForm((prev) => ({
      ...prev,
      question_ids: insertQuestionId(prev.question_ids, id, at),
    }));
  }

  function onSequenceDragOver(e: DragEvent, index: number | null) {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DND_SEQ) ? "move" : "copy";
    setSeqDropIndex(index);
  }

  function onSequenceDrop(e: DragEvent, index: number | null) {
    e.preventDefault();
    setSeqDropIndex(null);
    const bankRaw = e.dataTransfer.getData(DND_BANK);
    if (bankRaw) {
      const id = Number(bankRaw);
      if (Number.isFinite(id)) addQuestionToSequence(id, index);
      return;
    }
    const seqRaw = e.dataTransfer.getData(DND_SEQ);
    if (seqRaw !== "") {
      const from = Number(seqRaw);
      if (!Number.isFinite(from)) return;
      const to = index === null ? testForm.question_ids.length - 1 : index;
      setTestForm((prev) => ({
        ...prev,
        question_ids: reorderQuestionIds(prev.question_ids, from, to),
      }));
    }
  }
  const createQuestion = useMutation({
    mutationFn: (body: object) =>
      codingApi<CodingQuestion>("/teacher/questions", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      setQForm((f) => ({
        ...f,
        title: "",
        prompt_markdown: "",
        starter_code: "",
        rubric: [emptyRubricRow(), emptyRubricRow(), emptyRubricRow(), emptyRubricRow()],
      }));
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["coding-questions"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const generateQuestion = useMutation({
    mutationFn: () =>
      codingApi<QuestionDraft>("/teacher/questions/generate", {
        method: "POST",
        body: JSON.stringify(genForm),
      }),
    onSuccess: (res) => {
      setDraft(res);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const createTest = useMutation({
    mutationFn: () =>
      codingApi<CodingTest>("/teacher/tests", { method: "POST", body: JSON.stringify(testForm) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["coding-tests"] });
      setTab("tests");
    },
    onError: (e: Error) => setError(e.message),
  });

  const publish = useMutation({
    mutationFn: (testId: number) =>
      codingApi(`/results/tests/${testId}/publish`, { method: "POST" }),
    onSuccess: async () => {
      setEditingEvalId(null);
      await qc.invalidateQueries({ queryKey: ["coding-tests"] });
      await qc.invalidateQueries({ queryKey: ["coding-attempts"] });
      await qc.invalidateQueries({ queryKey: ["coding-student-attempts"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const updateEval = useMutation({
    mutationFn: ({
      evalRunId,
      total_score,
      feedback,
      verdict,
    }: {
      evalRunId: number;
      total_score: number;
      feedback: string;
      verdict: string;
    }) =>
      codingApi<AttemptEval>(`/results/evals/${evalRunId}`, {
        method: "PATCH",
        body: JSON.stringify({ total_score, feedback, verdict }),
      }),
    onSuccess: async () => {
      setEditingEvalId(null);
      await qc.invalidateQueries({ queryKey: ["coding-attempts"] });
      await qc.invalidateQueries({ queryKey: ["coding-student-attempts"] });
      await qc.invalidateQueries({ queryKey: ["coding-result-students"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const assignClassroom = useMutation({
    mutationFn: async ({ testId, classroomId }: { testId: number; classroomId: number }) => {
      // Sync classroom students onto coding platform, then assign each.
      await codingPlatformApi.students();
      const members = await classroomsApi.listStudents(classroomId);
      const emails = members
        .map((m) => m.student_email)
        .filter((email): email is string => !!email);
      if (!emails.length) throw new Error("No approved students in that classroom");
      const results = await Promise.allSettled(
        emails.map((email) =>
          codingApi(`/teacher/tests/${testId}/assign`, {
            method: "POST",
            body: JSON.stringify({ student_email: email }),
          }),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.length - ok;
      return { ok, fail, total: emails.length };
    },
    onSuccess: (res) => {
      setAssignMsg(
        res.fail
          ? `Assigned ${res.ok}/${res.total} students; ${res.fail} failed.`
          : `Assigned test to ${res.ok} student(s) in the classroom.`,
      );
      void qc.invalidateQueries({ queryKey: ["coding-result-students"] });
      void qc.invalidateQueries({ queryKey: ["coding-attempts"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function startEdit(ev: AttemptEval) {
    if (!ev.eval_run_id) return;
    setEditingEvalId(ev.eval_run_id);
    setEditForm({
      total_score: ev.total_score,
      feedback: ev.feedback,
      verdict: ev.verdict,
    });
  }

  function renderAttemptDetails(
    a: AttemptRow,
    opts?: { showStudent?: boolean; showTest?: boolean; bodyOnly?: boolean },
  ) {
    const bodyOnly = !!opts?.bodyOnly;
    const showStudent = !bodyOnly && opts?.showStudent !== false;
    const showTest = !bodyOnly && !!opts?.showTest;
    const gradesLocked = !!a.is_published_results;
    return (
      <div
        key={a.assignment_id}
        className={bodyOnly ? "border-t border-[#e1e3e4] px-3 pb-3 pt-3 text-sm" : "mb-3 rounded-xl border border-[#e1e3e4] p-3 text-sm"}
      >
        {showStudent ? (
          <div className="font-medium text-[#031635]">
            {a.student_name} · {a.student_email}
          </div>
        ) : null}
        {showTest && a.test_title ? (
          <div className="font-medium text-[#031635]">{a.test_title}</div>
        ) : null}
        {!bodyOnly ? (
          <div className="text-[#44474e]">
            {statusLabel(a.session_status)} · violations {a.violation_score ?? 0} · avg{" "}
            {a.average_score ?? "—"}
            {gradesLocked ? " · grades locked" : ""}
          </div>
        ) : null}
        <div className={bodyOnly ? "space-y-3" : "mt-3 space-y-3"}>
          {a.evals.map((ev) => {
            const codeKey = `${a.assignment_id}-${ev.question_id}`;
            const codeOpen = openCodeKey === codeKey;
            const isEditing = !gradesLocked && editingEvalId != null && editingEvalId === ev.eval_run_id;
            const rubricRows = rubricScoreEntries(ev.scores as Record<string, unknown> | undefined);
            return (
              <div key={codeKey} className="rounded-lg border border-[#e1e3e4]/80 bg-[#f8f9fa] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-[#031635]">
                      {ev.question_title}{" "}
                      <span className="text-xs font-normal text-[#44474e]">
                        ({ev.bloom_level ? bloomLabel(ev.bloom_level) : ""}
                        {ev.language ? ` · ${ev.language}` : ""})
                      </span>
                    </div>
                    <div className="mt-1 text-[#44474e]">
                      Score {ev.total_score} · {ev.verdict}
                      {ev.scores?.teacher_override ? (
                        <span className="ml-2 text-xs text-amber-700">teacher edited</span>
                      ) : null}
                    </div>
                    {!isEditing ? (
                      <>
                        {rubricRows.length ? (
                          <div className="mt-2">
                            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#75777f]">
                              Rubric
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {rubricRows.map((row) => (
                                <span
                                  key={row.name}
                                  className="rounded-md border border-[#e1e3e4] bg-white px-2 py-0.5 text-xs text-[#44474e]"
                                >
                                  {row.name}: <span className="font-semibold text-[#031635]">{row.value}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="mt-2">
                          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#75777f]">
                            Feedback
                          </p>
                          <p className="mt-1 text-[#44474e]">
                            {ev.feedback?.trim() ? ev.feedback : "No feedback yet."}
                          </p>
                        </div>
                      </>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-[#e1e3e4] px-3 py-1 text-xs text-[#44474e]"
                      onClick={() => setOpenCodeKey(codeOpen ? null : codeKey)}
                    >
                      {codeOpen ? "Hide code" : "View code"}
                    </button>
                    {ev.eval_run_id && !gradesLocked ? (
                      <button
                        type="button"
                        className="rounded-lg bg-[#031635]/10 px-3 py-1 text-xs text-[#031635]"
                        onClick={() => (isEditing ? setEditingEvalId(null) : startEdit(ev))}
                      >
                        {isEditing ? "Cancel" : "Edit result"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {codeOpen ? (
                  <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-[#e1e3e4] bg-[#191c1d] p-3 text-xs text-white whitespace-pre-wrap">
                    {ev.code?.trim() ? ev.code : "(no code submitted)"}
                  </pre>
                ) : null}
                {isEditing ? (
                  <form
                    className="mt-3 grid gap-2 rounded-lg border border-[#e1e3e4] p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!ev.eval_run_id) return;
                      updateEval.mutate({
                        evalRunId: ev.eval_run_id,
                        total_score: Number(editForm.total_score),
                        feedback: editForm.feedback,
                        verdict: editForm.verdict,
                      });
                    }}
                  >
                    <Field label="Score (0–100)">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        className={inputClass}
                        value={editForm.total_score}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, total_score: Number(e.target.value) }))
                        }
                        required
                      />
                    </Field>
                    <Field label="Verdict">
                      <select
                        className={inputClass}
                        value={editForm.verdict}
                        onChange={(e) => setEditForm((f) => ({ ...f, verdict: e.target.value }))}
                      >
                        <option value="PASS">PASS</option>
                        <option value="BORDERLINE">BORDERLINE</option>
                        <option value="FAIL">FAIL</option>
                        <option value="ERROR">ERROR</option>
                      </select>
                    </Field>
                    <Field label="Explanation / feedback">
                      <textarea
                        className={`${inputClass} min-h-24`}
                        value={editForm.feedback}
                        onChange={(e) => setEditForm((f) => ({ ...f, feedback: e.target.value }))}
                        required
                      />
                    </Field>
                    <PrimaryButton type="submit" disabled={updateEval.isPending}>
                      {updateEval.isPending ? "Saving…" : "Save changes"}
                    </PrimaryButton>
                  </form>
                ) : null}
              </div>
            );
          })}
          {!a.evals.length ? <p className="text-[#44474e]">No graded submissions yet.</p> : null}
        </div>
      </div>
    );
  }

  if (bootError) {
    return (
      <div>
        <PageHeader title="Coding" />
        <Panel>
          <EmptyState title="Could not open coding workspace" body={bootError} />
        </Panel>
      </div>
    );
  }

  if (!ready) {
    return (
      <div>
        <PageHeader title="Coding" subtitle="Connecting to coding platform…" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Coding"
        subtitle="Generate Bloom-aligned questions, build tests, and review results."
        action={
          <PrimaryButton
            disabled={!ready || importQuestions.isPending}
            onClick={() => importQuestions.mutate()}
          >
            {importQuestions.isPending ? "Importing…" : "Import questions"}
          </PrimaryButton>
        }
      />
      <ErrorText message={error} />

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["bank", "Bank"],
            ["generate", "Generate question"],
            ["tests", "Tests"],
            ["results", "Results"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-xl px-3 py-1.5 text-sm ${
              tab === key ? "bg-[#031635] text-white" : "border border-[#e1e3e4] text-[#44474e]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "bank" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <h2 className="mb-4 font-display text-xl text-[#031635]">New question</h2>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                setError(null);
                createQuestion.mutate({
                  title: qForm.title,
                  prompt_markdown: qForm.prompt_markdown,
                  starter_code: qForm.starter_code,
                  language: qForm.language,
                  bloom_level: qForm.bloom_level,
                  rubric: qForm.rubric.filter((row) => row.name.trim()),
                });
              }}
            >
              <Field label="Title">
                <input
                  className={inputClass}
                  value={qForm.title}
                  onChange={(e) => setQForm({ ...qForm, title: e.target.value })}
                  required
                />
              </Field>
              <Field label="Prompt">
                <textarea
                  className={`${inputClass} min-h-32`}
                  value={qForm.prompt_markdown}
                  onChange={(e) => setQForm({ ...qForm, prompt_markdown: e.target.value })}
                  required
                />
              </Field>
              <Field label="Starter code">
                <textarea
                  className={`${inputClass} min-h-28 font-mono text-xs`}
                  value={qForm.starter_code}
                  onChange={(e) => setQForm({ ...qForm, starter_code: e.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Language">
                  <select
                    className={inputClass}
                    value={qForm.language}
                    onChange={(e) => setQForm({ ...qForm, language: e.target.value as Language })}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Bloom level">
                  <select
                    className={inputClass}
                    value={qForm.bloom_level}
                    onChange={(e) => setQForm({ ...qForm, bloom_level: e.target.value as BloomLevel })}
                  >
                    {BLOOM_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {bloomLabel(level)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <RubricEditor
                rows={qForm.rubric}
                onChange={(rubric) => setQForm({ ...qForm, rubric })}
              />
              <div>
                <PrimaryButton type="submit" disabled={createQuestion.isPending}>
                  Save question
                </PrimaryButton>
              </div>
            </form>
          </Panel>
          <Panel>
            <h2 className="mb-4 font-display text-xl text-[#031635]">Question bank</h2>
            {!questions.data?.length ? (
              <EmptyState title="No questions yet" body="Create your first coding question." />
            ) : (
              <ul className="space-y-2">
                {questions.data.map((q) => {
                  const expanded = expandedQuestionId === q.id;
                  const criteria = (q.rubric ?? []).filter((row) => row.name.trim());
                  return (
                    <li key={q.id} className="overflow-hidden rounded-xl border border-[#e1e3e4] text-sm">
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[#f8f9fa]"
                        onClick={() =>
                          setExpandedQuestionId(expanded ? null : q.id)
                        }
                        aria-expanded={expanded}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-[#031635]">{q.title}</div>
                          <div className="text-[#44474e]">
                            #{q.id} · {q.language} · {bloomLabel(q.bloom_level)}
                            {q.rubric?.length ? ` · ${q.rubric.length} criteria` : ""}
                          </div>
                        </div>
                        <span className="material-symbols-outlined mt-0.5 shrink-0 text-[#75777f]">
                          {expanded ? "expand_less" : "expand_more"}
                        </span>
                      </button>
                      {expanded ? (
                        <div className="border-t border-[#e1e3e4] bg-[#f8f9fa] px-3 py-2">
                          {criteria.length ? (
                            <ul className="space-y-1">
                              {criteria.map((row, i) => (
                                <li
                                  key={`${row.name}-${i}`}
                                  className="flex items-center justify-between gap-3 text-[#44474e]"
                                >
                                  <span className="min-w-0 truncate font-medium text-[#031635]">
                                    {row.name}
                                  </span>
                                  <span className="shrink-0 font-semibold text-[#3f5d9b]">
                                    {Number(row.weight) || 0}%
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-[#75777f]">No rubric criteria for this question.</p>
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "generate" ? (
        <div className="space-y-6">
          <Panel>
            <h2 className="mb-4 font-display text-xl text-[#031635]">Generate question</h2>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                setError(null);
                generateQuestion.mutate();
              }}
            >
              <Field label="Topic or scenario">
                <textarea
                  className={`${inputClass} min-h-28`}
                  placeholder="Describe the topic, syllabus idea, or scenario the question should be based on."
                  value={genForm.topic_or_scenario}
                  onChange={(e) => setGenForm({ ...genForm, topic_or_scenario: e.target.value })}
                  required
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Bloom level">
                  <select
                    className={inputClass}
                    value={genForm.bloom_level}
                    onChange={(e) => setGenForm({ ...genForm, bloom_level: e.target.value as BloomLevel })}
                  >
                    {BLOOM_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {bloomLabel(level)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Language">
                  <select
                    className={inputClass}
                    value={genForm.language}
                    onChange={(e) => setGenForm({ ...genForm, language: e.target.value as Language })}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <PrimaryButton type="submit" disabled={generateQuestion.isPending}>
                  {generateQuestion.isPending ? "Generating…" : draft ? "Regenerate" : "Generate"}
                </PrimaryButton>
                {draft ? (
                  <button
                    type="button"
                    className="rounded-xl border border-[#e1e3e4] px-3 py-1.5 text-sm text-[#44474e]"
                    onClick={() => setDraft(null)}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </form>
          </Panel>
          {draft ? (
            <Panel>
              <h2 className="mb-4 font-display text-xl text-[#031635]">Edit draft, then save to bank</h2>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  setError(null);
                  createQuestion.mutate({
                    title: draft.title,
                    prompt_markdown: draft.prompt_markdown,
                    starter_code: draft.starter_code,
                    language: draft.language,
                    bloom_level: draft.bloom_level,
                    rubric: draft.rubric.filter((row) => row.name.trim()),
                    source_prompt: draft.source_prompt || genForm.topic_or_scenario,
                  });
                }}
              >
                <Field label="Title">
                  <input
                    className={inputClass}
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Prompt">
                  <textarea
                    className={`${inputClass} min-h-40`}
                    value={draft.prompt_markdown}
                    onChange={(e) => setDraft({ ...draft, prompt_markdown: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Starter code">
                  <textarea
                    className={`${inputClass} min-h-32 font-mono text-xs`}
                    value={draft.starter_code}
                    onChange={(e) => setDraft({ ...draft, starter_code: e.target.value })}
                  />
                </Field>
                <RubricEditor
                  rows={draft.rubric}
                  onChange={(rubric) => setDraft({ ...draft, rubric })}
                />
                <div>
                  <PrimaryButton type="submit" disabled={createQuestion.isPending}>
                    {createQuestion.isPending ? "Saving…" : "Save to bank"}
                  </PrimaryButton>
                </div>
              </form>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {tab === "tests" ? (
        <div className="space-y-6">
          <Panel>
            <h2 className="mb-4 font-display text-xl text-[#031635]">Create test</h2>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                setError(null);
                createTest.mutate();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Title">
                  <input
                    className={inputClass}
                    value={testForm.title}
                    onChange={(e) => setTestForm({ ...testForm, title: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Duration (minutes)">
                  <input
                    type="number"
                    className={inputClass}
                    min={10}
                    max={300}
                    value={testForm.duration_minutes}
                    onChange={(e) =>
                      setTestForm({ ...testForm, duration_minutes: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>

              <p className="text-sm text-[#75777f]">
                Drag questions into the sequence (or click a tile to add). Reorder by dragging chips.
              </p>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-3">
                  <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[#44474e]">
                    Question bank
                  </h3>
                  <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
                    {BLOOM_LEVELS.map((level) => (
                      <div key={level}>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#75777f]">
                          {bloomLabel(level)}
                        </p>
                        {byBloom[level].length ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {byBloom[level].map((q) => {
                              const selected = testForm.question_ids.includes(q.id);
                              return (
                                <button
                                  key={q.id}
                                  type="button"
                                  draggable={!selected}
                                  disabled={selected}
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData(DND_BANK, String(q.id));
                                    e.dataTransfer.effectAllowed = "copy";
                                  }}
                                  onClick={() => {
                                    if (!selected) addQuestionToSequence(q.id);
                                  }}
                                  className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                                    selected
                                      ? "cursor-default border-[#d6e3ff] bg-[#eef4ff] opacity-70"
                                      : "cursor-grab border-[#e1e3e4] bg-white hover:border-[#031635] active:cursor-grabbing"
                                  }`}
                                >
                                  <div className="font-semibold text-[#031635]">{q.title}</div>
                                  <div className="mt-0.5 text-xs text-[#75777f]">
                                    #{q.id} · {q.language} · {bloomLabel(q.bloom_level)}
                                    {selected ? " · In test" : ""}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-[#75777f]">No questions at this level.</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  className={`rounded-xl border border-dashed p-3 ${
                    seqDropIndex !== null ? "border-[#031635] bg-[#eef4ff]" : "border-[#e1e3e4] bg-white"
                  }`}
                  onDragOver={(e) => onSequenceDragOver(e, testForm.question_ids.length)}
                  onDragLeave={() => setSeqDropIndex(null)}
                  onDrop={(e) => onSequenceDrop(e, null)}
                >
                  <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[#44474e]">
                    Test sequence
                  </h3>
                  {testForm.question_ids.length ? (
                    <ul className="space-y-2">
                      {testForm.question_ids.map((id, index) => {
                        const q = questionById.get(id);
                        const highlight = seqDropIndex === index;
                        return (
                          <li
                            key={`${id}-${index}`}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(DND_SEQ, String(index));
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragOver={(e) => {
                              e.stopPropagation();
                              onSequenceDragOver(e, index);
                            }}
                            onDrop={(e) => {
                              e.stopPropagation();
                              onSequenceDrop(e, index);
                            }}
                            className={`flex cursor-grab items-start gap-2 rounded-xl border px-3 py-2 active:cursor-grabbing ${
                              highlight
                                ? "border-[#031635] bg-[#eef4ff]"
                                : "border-[#e1e3e4] bg-[#f8f9fa]"
                            }`}
                          >
                            <span className="mt-0.5 shrink-0 rounded-md bg-[#031635] px-1.5 py-0.5 text-[10px] font-bold text-white">
                              Q{index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold text-[#031635]">
                                {q?.title ?? `#${id}`}
                              </div>
                              <div className="text-xs text-[#75777f]">
                                #{id}
                                {q ? ` · ${q.language} · ${bloomLabel(q.bloom_level)}` : ""}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="shrink-0 text-[#75777f] hover:text-[#ba1a1a]"
                              title="Remove from sequence"
                              onClick={() =>
                                setTestForm((prev) => ({
                                  ...prev,
                                  question_ids: prev.question_ids.filter((qid) => qid !== id),
                                }))
                              }
                            >
                              <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="py-10 text-center text-sm text-[#75777f]">
                      Drop question tiles here to build the ordered test.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <PrimaryButton type="submit" disabled={createTest.isPending || testForm.question_ids.length < 1}>
                  {createTest.isPending ? "Creating…" : "Create test"}
                </PrimaryButton>
              </div>
            </form>
          </Panel>

          <Panel>
            <h2 className="mb-3 font-display text-xl text-[#031635]">Your tests</h2>
            {assignMsg ? <p className="mb-3 text-sm text-[#031635]">{assignMsg}</p> : null}
            {!tests.data?.length ? (
              <EmptyState title="No tests yet" body="Build a test with one or more bank questions." />
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {tests.data.map((t) => {
                  const selectedClassroomId = classroomByTest[t.id] || 0;
                  return (
                    <li key={t.id} className="rounded-xl border border-[#e1e3e4] p-3 text-sm">
                      <div className="font-medium text-[#031635]">{t.title}</div>
                      <div className="text-[#44474e]">
                        Invite <span className="text-[#031635]">{t.invite_code}</span> · {t.duration_minutes}{" "}
                        min · {t.questions?.length ?? 0} question{(t.questions?.length ?? 0) === 1 ? "" : "s"} ·{" "}
                        {t.is_published_results ? "results published" : "results private"}
                      </div>
                      {t.questions?.length ? (
                        <p className="mt-1 text-xs text-[#75777f]">
                          {t.questions
                            .map((link) => `Q${link.order_index} ${bloomLabel(link.bloom_level)}`)
                            .join(" → ")}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-col gap-2">
                        <label className="block space-y-1.5">
                          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#44474e]">
                            Classroom
                          </span>
                          <select
                            className={inputClass}
                            value={selectedClassroomId || ""}
                            onChange={(e) =>
                              setClassroomByTest((prev) => ({
                                ...prev,
                                [t.id]: Number(e.target.value) || 0,
                              }))
                            }
                          >
                            <option value="">
                              {(myClassrooms.data?.length ?? 0) === 0
                                ? "No classrooms yet"
                                : "Select classroom…"}
                            </option>
                            {(myClassrooms.data || []).map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.code})
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-xl border border-[#e1e3e4] px-3 py-2 text-[#44474e] disabled:opacity-50"
                            disabled={!selectedClassroomId || assignClassroom.isPending}
                            onClick={() => {
                              setError(null);
                              setAssignMsg(null);
                              assignClassroom.mutate({
                                testId: t.id,
                                classroomId: selectedClassroomId,
                              });
                            }}
                          >
                            {assignClassroom.isPending ? "Assigning…" : "Assign classroom"}
                          </button>
                          <button
                            type="button"
                            className="rounded-xl border border-[#e1e3e4] px-3 py-2 text-[#44474e]"
                            onClick={() => {
                              setSelectedTestId(t.id);
                              switchResultsMode("tests");
                              setTab("results");
                            }}
                          >
                            Results
                          </button>
                          {!t.is_published_results ? (
                            <button
                              type="button"
                              className="rounded-xl bg-[#031635] px-3 py-2 font-semibold text-white"
                              onClick={() => publish.mutate(t.id)}
                            >
                              Publish
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "results" ? (
        <Panel>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-xl text-[#031635]">Attempts</h2>
            <div className="inline-flex rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] p-0.5">
              <button
                type="button"
                onClick={() => switchResultsMode("tests")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  resultsMode === "tests"
                    ? "bg-[#031635] text-white shadow-xs"
                    : "text-[#44474e] hover:text-[#031635]"
                }`}
              >
                By tests
              </button>
              <button
                type="button"
                onClick={() => switchResultsMode("students")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  resultsMode === "students"
                    ? "bg-[#031635] text-white shadow-xs"
                    : "text-[#44474e] hover:text-[#031635]"
                }`}
              >
                By students
              </button>
            </div>
          </div>

          {resultsMode === "tests" ? (
            <>
              {!selectedTestId ? (
                <>
                  <div className="mb-4">
                    <input
                      className={inputClass}
                      type="search"
                      placeholder="Search tests by title or invite code…"
                      value={resultsTestSearch}
                      onChange={(e) => setResultsTestSearch(e.target.value)}
                    />
                  </div>
                  {tests.isLoading ? (
                    <p className="text-sm text-[#75777f]">Loading tests…</p>
                  ) : !(tests.data?.length) ? (
                    <EmptyState title="No tests yet" body="Create a test first, then review attempts here." />
                  ) : !filteredResultsTests.length ? (
                    <EmptyState title="No tests match" body="Try a different title or invite code." />
                  ) : (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {filteredResultsTests.map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            className="flex h-full w-full flex-col rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-4 py-3 text-left transition hover:border-[#031635] hover:bg-white"
                            onClick={() => {
                              setSelectedTestId(t.id);
                              setOpenCodeKey(null);
                              setEditingEvalId(null);
                            }}
                          >
                            <div className="font-medium text-[#031635]">{t.title}</div>
                            <div className="mt-1 text-xs text-[#44474e]">
                              Invite <span className="font-semibold text-[#031635]">{t.invite_code}</span>
                              {" · "}
                              {t.duration_minutes} min
                              {" · "}
                              {t.questions?.length ?? 0} question
                              {(t.questions?.length ?? 0) === 1 ? "" : "s"}
                            </div>
                            <div className="mt-2 text-xs font-semibold text-[#3f5d9b]">
                              {t.is_published_results ? "Results published" : "Results private"}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        className="text-xs font-semibold text-[#3f5d9b] hover:underline"
                        onClick={() => {
                          setSelectedTestId(null);
                          setExpandedAttemptId(null);
                          setOpenCodeKey(null);
                          setEditingEvalId(null);
                        }}
                      >
                        ← All tests
                      </button>
                      <h3 className="font-display text-lg text-[#031635]">
                        {tests.data?.find((t) => t.id === selectedTestId)?.title ?? `Test #${selectedTestId}`}
                      </h3>
                    </div>
                    {tests.data?.find((t) => t.id === selectedTestId)?.is_published_results ? (
                      <span className="rounded-full bg-[#e7f3ec] px-2.5 py-1 text-xs font-bold text-[#2f6b4f]">
                        Results published
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="rounded-xl bg-[#031635] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={publish.isPending}
                        onClick={() => {
                          if (selectedTestId == null) return;
                          setError(null);
                          publish.mutate(selectedTestId);
                        }}
                      >
                        {publish.isPending ? "Publishing…" : "Publish results"}
                      </button>
                    )}
                  </div>
                  {attempts.isLoading ? (
                    <p className="text-sm text-[#75777f]">Loading attempts…</p>
                  ) : !(attempts.data?.length) ? (
                    <EmptyState title="No students assigned" body="Assign this test to a classroom first." />
                  ) : (
                    <ul className="space-y-2">
                      {attempts.data.map((a) => {
                        const row: AttemptRow = {
                          ...a,
                          is_published_results:
                            a.is_published_results ||
                            !!tests.data?.find((t) => t.id === selectedTestId)?.is_published_results,
                        };
                        const expanded = expandedAttemptId === a.assignment_id;
                        return (
                          <li
                            key={a.assignment_id}
                            className="overflow-hidden rounded-xl border border-[#e1e3e4] bg-white"
                          >
                            <button
                              type="button"
                              className="flex w-full items-start gap-2 px-3 py-3 text-left hover:bg-[#f8f9fa]"
                              aria-expanded={expanded}
                              onClick={() => {
                                setExpandedAttemptId(expanded ? null : a.assignment_id);
                                setOpenCodeKey(null);
                                setEditingEvalId(null);
                              }}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-[#031635]">
                                  {a.student_name}{" "}
                                  <span className="text-xs font-normal text-[#44474e]">
                                    · {a.student_email}
                                  </span>
                                </div>
                                <div className="mt-1 text-xs text-[#44474e]">
                                  {statusLabel(a.session_status)} · violations {a.violation_score ?? 0} · avg{" "}
                                  {a.average_score ?? "—"}
                                  {row.is_published_results ? " · grades locked" : ""}
                                </div>
                              </div>
                              <span className="material-symbols-outlined mt-0.5 shrink-0 text-[#75777f]">
                                {expanded ? "expand_less" : "expand_more"}
                              </span>
                            </button>
                            {expanded
                              ? renderAttemptDetails(row, { bodyOnly: true })
                              : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              {selectedStudentId == null ? (
                <>
                  {resultStudents.isLoading ? (
                    <p className="text-sm text-[#75777f]">Loading students…</p>
                  ) : !(resultStudents.data?.length) ? (
                    <EmptyState
                      title="No assigned students"
                      body="Students appear here after you assign at least one test."
                    />
                  ) : (
                    <ul className="space-y-2">
                      {resultStudents.data.map((s) => (
                        <li key={s.student_id}>
                          <button
                            type="button"
                            className="w-full rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-4 py-3 text-left transition hover:border-[#031635] hover:bg-white"
                            onClick={() => {
                              setSelectedStudentId(s.student_id);
                              setSelectedStudentAttemptId(null);
                              setOpenCodeKey(null);
                              setEditingEvalId(null);
                            }}
                          >
                            <div className="font-medium text-[#031635]">
                              {s.student_name}{" "}
                              <span className="text-xs font-normal text-[#44474e]">· {s.student_email}</span>
                            </div>
                            <div className="mt-1 text-xs text-[#44474e]">
                              {s.assignment_count} test{s.assignment_count === 1 ? "" : "s"} · {s.started_count}{" "}
                              started · {s.submitted_count} submitted
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : selectedStudentAttemptId == null ? (
                <>
                  <button
                    type="button"
                    className="mb-3 text-xs font-semibold text-[#3f5d9b] hover:underline"
                    onClick={() => {
                      setSelectedStudentId(null);
                      setSelectedStudentAttemptId(null);
                    }}
                  >
                    ← All students
                  </button>
                  {studentAttempts.isLoading ? (
                    <p className="text-sm text-[#75777f]">Loading tests…</p>
                  ) : !(studentAttempts.data?.length) ? (
                    <EmptyState title="No tests for this student" body="This student has no assignments yet." />
                  ) : (
                    <ul className="space-y-2">
                      {studentAttempts.data.map((a) => (
                        <li key={a.assignment_id}>
                          <button
                            type="button"
                            className="w-full rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-4 py-3 text-left transition hover:border-[#031635] hover:bg-white"
                            onClick={() => {
                              setSelectedStudentAttemptId(a.assignment_id);
                              setOpenCodeKey(null);
                              setEditingEvalId(null);
                            }}
                          >
                            <div className="font-medium text-[#031635]">{a.test_title || `Test #${a.test_id}`}</div>
                            <div className="mt-1 text-xs text-[#44474e]">
                              {statusLabel(a.session_status)} · violations {a.violation_score ?? 0} · avg{" "}
                              {a.average_score ?? "—"}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="mb-3 text-xs font-semibold text-[#3f5d9b] hover:underline"
                    onClick={() => {
                      setSelectedStudentAttemptId(null);
                      setOpenCodeKey(null);
                      setEditingEvalId(null);
                    }}
                  >
                    ← Back to student’s tests
                  </button>
                  {studentAttempts.data
                    ?.filter((a) => a.assignment_id === selectedStudentAttemptId)
                    .map((a) => renderAttemptDetails(a, { showStudent: true, showTest: true }))}
                </>
              )}
            </>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
