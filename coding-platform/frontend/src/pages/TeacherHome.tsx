import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type BloomLevel,
  type CodingTest,
  type Language,
  type Question,
  type RubricCriterion,
  type TestCase,
} from "../api";
import { useAuth } from "../auth";

const LANGUAGES: Language[] = ["python", "java", "cpp", "html", "css", "javascript"];
const BLOOM_LEVELS: BloomLevel[] = [
  "REMEMBER",
  "UNDERSTAND",
  "APPLY",
  "ANALYZE",
  "EVALUATE",
  "CREATE",
];

function bloomLabel(level: BloomLevel | string | undefined) {
  if (!level) return "";
  return level.charAt(0) + level.slice(1).toLowerCase();
}

type AttemptEval = {
  eval_run_id: number | null;
  submission_id: number | null;
  question_id: number;
  question_title: string;
  bloom_level: BloomLevel;
  language: Language | null;
  code: string | null;
  total_score: number;
  verdict: string;
  feedback: string;
  scores: Record<string, unknown>;
};

type AttemptRow = {
  assignment_id: number;
  student_name: string;
  student_email: string;
  session_status: string | null;
  violation_score: number | null;
  average_score: number | null;
  evals: AttemptEval[];
};

export function TeacherHome() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"bank" | "tests" | "results">("bank");
  const [error, setError] = useState<string | null>(null);
  const [openCodeKey, setOpenCodeKey] = useState<string | null>(null);
  const [editingEvalId, setEditingEvalId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ total_score: 0, feedback: "", verdict: "PASS" });

  const questions = useQuery({
    queryKey: ["questions"],
    queryFn: () => api<Question[]>("/teacher/questions"),
  });
  const tests = useQuery({
    queryKey: ["tests"],
    queryFn: () => api<CodingTest[]>("/teacher/tests"),
  });

  const [qForm, setQForm] = useState({
    title: "",
    prompt_markdown: "",
    starter_code: "",
    language: "python" as Language,
    bloom_level: "APPLY" as BloomLevel,
    rubric: [
      { name: "Correctness", description: "Solves the problem", weight: 55, max_points: 100 },
      { name: "Efficiency", description: "Reasonable complexity", weight: 15, max_points: 100 },
      { name: "Style", description: "Readable code", weight: 15, max_points: 100 },
      { name: "Edge cases", description: "Handles edge cases", weight: 15, max_points: 100 },
    ] as RubricCriterion[],
    test_cases: [
      {
        id: 1,
        description: "Typical case",
        input: "",
        expected_output: "",
        is_visible: true,
      },
      {
        id: 2,
        description: "Boundary case",
        input: "",
        expected_output: "",
        is_visible: true,
      },
      {
        id: 3,
        description: "Edge case",
        input: "",
        expected_output: "",
        is_visible: true,
      },
      {
        id: 4,
        description: "Large input",
        input: "",
        expected_output: "",
        is_visible: false,
      },
      {
        id: 5,
        description: "Tricky corner case",
        input: "",
        expected_output: "",
        is_visible: false,
      },
    ] as TestCase[],
  });
  const [testForm, setTestForm] = useState({
    title: "New coding test",
    duration_minutes: 45,
    question_ids: [] as number[],
  });
  const [assignEmail, setAssignEmail] = useState("student@example.com");
  const [selectedTestId, setSelectedTestId] = useState<number | null>(null);

  const createQuestion = useMutation({
    mutationFn: () => api<Question>("/teacher/questions", { method: "POST", body: JSON.stringify(qForm) }),
    onSuccess: async () => {
      setQForm((f) => ({
        ...f,
        title: "",
        prompt_markdown: "",
        starter_code: "",
        test_cases: f.test_cases.map((tc) => ({ ...tc, input: "", expected_output: "" })),
      }));
      await qc.invalidateQueries({ queryKey: ["questions"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const createTest = useMutation({
    mutationFn: () => api<CodingTest>("/teacher/tests", { method: "POST", body: JSON.stringify(testForm) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tests"] });
      setTab("tests");
    },
    onError: (e: Error) => setError(e.message),
  });

  const byBloom = useMemo(() => {
    const map = Object.fromEntries(BLOOM_LEVELS.map((level) => [level, [] as Question[]])) as Record<
      BloomLevel,
      Question[]
    >;
    for (const q of questions.data || []) {
      const level = (q.bloom_level || "APPLY") as BloomLevel;
      (map[level] ?? map.APPLY).push(q);
    }
    return map;
  }, [questions.data]);

  const attempts = useQuery({
    queryKey: ["attempts", selectedTestId],
    queryFn: () => api<AttemptRow[]>(`/results/tests/${selectedTestId}/attempts`),
    enabled: selectedTestId != null && tab === "results",
  });

  const publish = useMutation({
    mutationFn: (testId: number) => api(`/results/tests/${testId}/publish`, { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tests"] });
      await qc.invalidateQueries({ queryKey: ["attempts"] });
    },
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
      api<AttemptEval>(`/results/evals/${evalRunId}`, {
        method: "PATCH",
        body: JSON.stringify({ total_score, feedback, verdict }),
      }),
    onSuccess: async () => {
      setEditingEvalId(null);
      await qc.invalidateQueries({ queryKey: ["attempts"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const assign = useMutation({
    mutationFn: ({ testId, email }: { testId: number; email: string }) =>
      api(`/teacher/tests/${testId}/assign`, {
        method: "POST",
        body: JSON.stringify({ student_email: email }),
      }),
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

  function onCreateQuestion(e: FormEvent) {
    e.preventDefault();
    setError(null);
    createQuestion.mutate();
  }

  function onCreateTest(e: FormEvent) {
    e.preventDefault();
    setError(null);
    createTest.mutate();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-cyan-300">Teacher workspace</h1>
          <p className="text-sm text-slate-400">{user?.full_name}</p>
        </div>
        <button onClick={logout} className="rounded-xl border border-slate-600 px-3 py-1.5 text-sm">
          Log out
        </button>
      </header>

      <div className="mb-4 flex gap-2">
        {(["bank", "tests", "results"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-3 py-1.5 text-sm capitalize ${tab === t ? "bg-cyan-700" : "bg-slate-800"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {error ? <p className="mb-3 rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</p> : null}

      {tab === "bank" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={onCreateQuestion} className="space-y-2 rounded-2xl border border-slate-700 p-4">
            <h2 className="font-semibold text-slate-100">New question</h2>
            <input
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2"
              placeholder="Title"
              value={qForm.title}
              onChange={(e) => setQForm({ ...qForm, title: e.target.value })}
              required
            />
            <textarea
              className="min-h-28 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2"
              placeholder="Prompt (markdown)"
              value={qForm.prompt_markdown}
              onChange={(e) => setQForm({ ...qForm, prompt_markdown: e.target.value })}
              required
            />
            <textarea
              className="min-h-20 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-sm"
              placeholder="Starter code"
              value={qForm.starter_code}
              onChange={(e) => setQForm({ ...qForm, starter_code: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                className="rounded-lg border border-slate-600 bg-slate-950 px-2 py-2"
                value={qForm.language}
                onChange={(e) => setQForm({ ...qForm, language: e.target.value as Language })}
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <select
                className="rounded-lg border border-slate-600 bg-slate-950 px-2 py-2"
                value={qForm.bloom_level}
                onChange={(e) => setQForm({ ...qForm, bloom_level: e.target.value as BloomLevel })}
              >
                {BLOOM_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {bloomLabel(level)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">Test cases</h3>
                <span className="text-xs text-slate-400">First 3 visible to students; rest hidden</span>
              </div>
              {qForm.test_cases.map((tc, idx) => (
                <div key={tc.id} className="rounded-lg border border-slate-700 p-2">
                  <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                    <input
                      className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                      placeholder="Description"
                      value={tc.description}
                      onChange={(e) => {
                        const next = [...qForm.test_cases];
                        next[idx] = { ...tc, description: e.target.value };
                        setQForm({ ...qForm, test_cases: next });
                      }}
                    />
                    <label className="flex items-center gap-1 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={tc.is_visible}
                        onChange={(e) => {
                          const next = [...qForm.test_cases];
                          next[idx] = { ...tc, is_visible: e.target.checked };
                          setQForm({ ...qForm, test_cases: next });
                        }}
                      />
                      Visible
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <textarea
                      className="min-h-16 rounded border border-slate-600 bg-slate-950 px-2 py-1 font-mono text-xs"
                      placeholder="Input (stdin)"
                      value={tc.input}
                      onChange={(e) => {
                        const next = [...qForm.test_cases];
                        next[idx] = { ...tc, input: e.target.value };
                        setQForm({ ...qForm, test_cases: next });
                      }}
                    />
                    <textarea
                      className="min-h-16 rounded border border-slate-600 bg-slate-950 px-2 py-1 font-mono text-xs"
                      placeholder="Expected output"
                      value={tc.expected_output}
                      onChange={(e) => {
                        const next = [...qForm.test_cases];
                        next[idx] = { ...tc, expected_output: e.target.value };
                        setQForm({ ...qForm, test_cases: next });
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="mt-2 text-xs text-red-300 hover:text-red-200"
                    onClick={() => {
                      const next = qForm.test_cases.filter((_, i) => i !== idx);
                      setQForm({ ...qForm, test_cases: next });
                    }}
                  >
                    Remove case
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-sm text-cyan-300 hover:text-cyan-200"
                onClick={() => {
                  const nextId = Math.max(0, ...qForm.test_cases.map((tc) => tc.id)) + 1;
                  setQForm({
                    ...qForm,
                    test_cases: [
                      ...qForm.test_cases,
                      { id: nextId, description: `Case ${nextId}`, input: "", expected_output: "", is_visible: false },
                    ],
                  });
                }}
              >
                + Add test case
              </button>
            </div>
            <button className="rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-slate-950">Save question</button>
          </form>
          <div className="space-y-2 rounded-2xl border border-slate-700 p-4">
            <h2 className="font-semibold">Question bank</h2>
            {(questions.data || []).map((q) => (
              <div key={q.id} className="rounded-xl border border-slate-700 px-3 py-2 text-sm">
                <div className="font-medium">{q.title}</div>
                <div className="text-slate-400">
                  #{q.id} · {q.language} · {bloomLabel(q.bloom_level)} · {q.test_cases?.length || 0} test cases
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "tests" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={onCreateTest} className="space-y-2 rounded-2xl border border-slate-700 p-4">
            <h2 className="font-semibold">Create test (1 or more questions)</h2>
            <input
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2"
              value={testForm.title}
              onChange={(e) => setTestForm({ ...testForm, title: e.target.value })}
              required
            />
            <input
              type="number"
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2"
              value={testForm.duration_minutes}
              onChange={(e) => setTestForm({ ...testForm, duration_minutes: Number(e.target.value) })}
              min={10}
              max={300}
            />
            {BLOOM_LEVELS.map((level) => (
              <div key={level} className="text-sm">
                <span className="text-slate-400">{bloomLabel(level)}</span>
                <div className="mt-1 space-y-1">
                  {byBloom[level].map((q) => {
                    const selected = testForm.question_ids.includes(q.id);
                    return (
                      <label key={q.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            setTestForm((prev) => ({
                              ...prev,
                              question_ids: selected
                                ? prev.question_ids.filter((id) => id !== q.id)
                                : [...prev.question_ids, q.id],
                            }))
                          }
                        />
                        #{q.id} {q.title} ({q.language})
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <button className="rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-slate-950" disabled={createTest.isPending || testForm.question_ids.length < 1}>
              Create test
            </button>
          </form>
          <div className="space-y-3 rounded-2xl border border-slate-700 p-4">
            <h2 className="font-semibold">Your tests</h2>
            {(tests.data || []).map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-700 p-3 text-sm">
                <div className="font-medium">{t.title}</div>
                <div className="text-slate-400">
                  Invite code <span className="text-cyan-300">{t.invite_code}</span> · {t.duration_minutes} min ·{" "}
                  {t.is_published_results ? "results published" : "results private"}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    className="rounded-lg border border-slate-600 bg-slate-950 px-2 py-1"
                    value={assignEmail}
                    onChange={(e) => setAssignEmail(e.target.value)}
                    placeholder="student email"
                  />
                  <button
                    className="rounded-lg bg-slate-700 px-3 py-1"
                    onClick={() => assign.mutate({ testId: t.id, email: assignEmail })}
                  >
                    Assign
                  </button>
                  <button className="rounded-lg bg-slate-700 px-3 py-1" onClick={() => { setSelectedTestId(t.id); setTab("results"); }}>
                    Results
                  </button>
                  {!t.is_published_results ? (
                    <button className="rounded-lg bg-emerald-700 px-3 py-1" onClick={() => publish.mutate(t.id)}>
                      Publish results
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "results" ? (
        <div className="space-y-3 rounded-2xl border border-slate-700 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Attempts</h2>
            <select
              className="rounded-lg border border-slate-600 bg-slate-950 px-2 py-1"
              value={selectedTestId ?? ""}
              onChange={(e) => setSelectedTestId(Number(e.target.value) || null)}
            >
              <option value="">Select test…</option>
              {(tests.data || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
          {(attempts.data || []).map((a) => (
            <div key={a.assignment_id} className="rounded-xl border border-slate-700 p-3 text-sm">
              <div className="font-medium">
                {a.student_name} · {a.student_email}
              </div>
              <div className="text-slate-400">
                {a.session_status || "not started"} · violations {a.violation_score ?? 0} · avg{" "}
                {a.average_score ?? "—"}
              </div>
              <div className="mt-3 space-y-3">
                {a.evals.map((ev) => {
                  const codeKey = `${a.assignment_id}-${ev.question_id}`;
                  const codeOpen = openCodeKey === codeKey;
                  const isEditing = editingEvalId != null && editingEvalId === ev.eval_run_id;
                  return (
                    <div key={codeKey} className="rounded-lg border border-slate-700/80 bg-slate-950/40 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-slate-100">
                            {ev.question_title}{" "}
                            <span className="text-xs font-normal text-slate-400">
                              ({bloomLabel(ev.bloom_level)}
                              {ev.language ? ` · ${ev.language}` : ""})
                            </span>
                          </div>
                          <div className="mt-1 text-slate-300">
                            Score {ev.total_score} · {ev.verdict}
                            {ev.scores?.teacher_override ? (
                              <span className="ml-2 text-xs text-amber-300">teacher edited</span>
                            ) : null}
                          </div>
                          {!isEditing ? (
                            <p className="mt-1 text-slate-400">{ev.feedback}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-lg bg-slate-700 px-3 py-1 text-xs"
                            onClick={() => setOpenCodeKey(codeOpen ? null : codeKey)}
                          >
                            {codeOpen ? "Hide code" : "View code"}
                          </button>
                          {ev.eval_run_id ? (
                            <button
                              type="button"
                              className="rounded-lg bg-cyan-800 px-3 py-1 text-xs"
                              onClick={() => (isEditing ? setEditingEvalId(null) : startEdit(ev))}
                            >
                              {isEditing ? "Cancel" : "Edit result"}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {codeOpen ? (
                        <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-cyan-100 whitespace-pre-wrap">
                          {ev.code?.trim() ? ev.code : "(no code submitted)"}
                        </pre>
                      ) : null}

                      {isEditing ? (
                        <form
                          className="mt-3 grid gap-2 rounded-lg border border-slate-600 bg-slate-900/60 p-3"
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
                          <label className="grid gap-1 text-xs text-slate-300">
                            Score (0–100)
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.1}
                              className="rounded-lg border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                              value={editForm.total_score}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, total_score: Number(e.target.value) }))
                              }
                              required
                            />
                          </label>
                          <label className="grid gap-1 text-xs text-slate-300">
                            Verdict
                            <select
                              className="rounded-lg border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                              value={editForm.verdict}
                              onChange={(e) => setEditForm((f) => ({ ...f, verdict: e.target.value }))}
                            >
                              <option value="PASS">PASS</option>
                              <option value="BORDERLINE">BORDERLINE</option>
                              <option value="FAIL">FAIL</option>
                              <option value="ERROR">ERROR</option>
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs text-slate-300">
                            Explanation / feedback
                            <textarea
                              className="min-h-24 rounded-lg border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                              value={editForm.feedback}
                              onChange={(e) => setEditForm((f) => ({ ...f, feedback: e.target.value }))}
                              required
                            />
                          </label>
                          <button
                            type="submit"
                            className="justify-self-start rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold"
                            disabled={updateEval.isPending}
                          >
                            {updateEval.isPending ? "Saving…" : "Save changes"}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
                {!a.evals.length ? (
                  <p className="text-slate-500">No graded submissions yet.</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
