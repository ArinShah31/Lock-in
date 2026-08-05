import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codingPlatformApi, classroomsApi } from "../api";
import {
  clearCodingToken,
  codingApi,
  getCodingToken,
  setCodingToken,
  type AttemptEval,
  type AttemptRow,
  type CodingQuestion,
  type CodingTest,
  type Difficulty,
  type Language,
  type QuestionType,
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
const DIFFS: Difficulty[] = ["EASY", "MEDIUM", "HARD"];

async function ensureCodingSession() {
  if (getCodingToken()) return;
  const { token } = await codingPlatformApi.ssoToken();
  const data = await fetch("/coding-api/v1/auth/sso", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!data.ok) {
    const err = await data.json().catch(() => ({}));
    throw new Error(err.detail || "SSO exchange failed");
  }
  const body = (await data.json()) as { access_token: string };
  setCodingToken(body.access_token);
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
          <p className="text-sm text-mist">
            {redirecting ? "Redirecting to the coding platform…" : "Waiting…"}
          </p>
        </Panel>
      </div>
    );
  }

  return <TeacherCodingWorkspace />;
}

function TeacherCodingWorkspace() {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [tab, setTab] = useState<"bank" | "tests" | "results">("bank");
  const [error, setError] = useState<string | null>(null);
  const [openCodeKey, setOpenCodeKey] = useState<string | null>(null);
  const [editingEvalId, setEditingEvalId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ total_score: 0, feedback: "", verdict: "PASS" });
  const [selectedTestId, setSelectedTestId] = useState<number | null>(null);
  const [classroomByTest, setClassroomByTest] = useState<Record<number, number>>({});
  const [assignMsg, setAssignMsg] = useState<string | null>(null);

  const [qForm, setQForm] = useState({
    title: "",
    prompt_markdown: "",
    starter_code: "",
    language: "python" as Language,
    difficulty: "EASY" as Difficulty,
    question_type: "SYLLABUS" as QuestionType,
  });
  const [testForm, setTestForm] = useState({
    title: "New Progressive Test",
    duration_minutes: 45,
    easy_question_id: 0,
    medium_question_id: 0,
    hard_question_id: 0,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureCodingSession();
        if (!cancelled) setReady(true);
      } catch (e) {
        clearCodingToken();
        if (!cancelled) setBootError(e instanceof Error ? e.message : "Could not connect");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const questions = useQuery({
    queryKey: ["coding-questions"],
    queryFn: () => codingApi<CodingQuestion[]>("/teacher/questions"),
    enabled: ready,
  });
  const tests = useQuery({
    queryKey: ["coding-tests"],
    queryFn: () => codingApi<CodingTest[]>("/teacher/tests"),
    enabled: ready,
  });
  const myClassrooms = useQuery({
    queryKey: ["coding-my-classrooms"],
    queryFn: classroomsApi.list,
    enabled: ready,
  });
  const attempts = useQuery({
    queryKey: ["coding-attempts", selectedTestId],
    queryFn: () => codingApi<AttemptRow[]>(`/results/tests/${selectedTestId}/attempts`),
    enabled: ready && selectedTestId != null && tab === "results",
  });

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

  const byDiff = useMemo(() => {
    const map: Record<Difficulty, CodingQuestion[]> = { EASY: [], MEDIUM: [], HARD: [] };
    for (const q of questions.data || []) map[q.difficulty].push(q);
    return map;
  }, [questions.data]);

  const createQuestion = useMutation({
    mutationFn: () =>
      codingApi<CodingQuestion>("/teacher/questions", { method: "POST", body: JSON.stringify(qForm) }),
    onSuccess: async () => {
      setQForm((f) => ({ ...f, title: "", prompt_markdown: "", starter_code: "" }));
      await qc.invalidateQueries({ queryKey: ["coding-questions"] });
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
      await qc.invalidateQueries({ queryKey: ["coding-tests"] });
      await qc.invalidateQueries({ queryKey: ["coding-attempts"] });
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
      codingApi<AttemptEval>(`/results/evals/${evalRunId}`, {
        method: "PATCH",
        body: JSON.stringify({ total_score, feedback, verdict }),
      }),
    onSuccess: async () => {
      setEditingEvalId(null);
      await qc.invalidateQueries({ queryKey: ["coding-attempts"] });
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
        subtitle="Question bank, progressive tests, and result review."
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

      <div className="mb-4 flex gap-2">
        {(["bank", "tests", "results"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-xl px-3 py-1.5 text-sm capitalize ${
              tab === t ? "bg-accent text-ink" : "border border-line text-mist"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "bank" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <h2 className="mb-4 font-display text-xl text-paper">New question</h2>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                setError(null);
                createQuestion.mutate();
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
              <div className="grid gap-4 sm:grid-cols-3">
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
                <Field label="Difficulty">
                  <select
                    className={inputClass}
                    value={qForm.difficulty}
                    onChange={(e) => setQForm({ ...qForm, difficulty: e.target.value as Difficulty })}
                  >
                    {DIFFS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Type">
                  <select
                    className={inputClass}
                    value={qForm.question_type}
                    onChange={(e) =>
                      setQForm({ ...qForm, question_type: e.target.value as QuestionType })
                    }
                  >
                    <option value="SYLLABUS">SYLLABUS</option>
                    <option value="HIRING">HIRING</option>
                  </select>
                </Field>
              </div>
              <div>
                <PrimaryButton type="submit" disabled={createQuestion.isPending}>
                  Save question
                </PrimaryButton>
              </div>
            </form>
          </Panel>
          <Panel>
            <h2 className="mb-4 font-display text-xl text-paper">Question bank</h2>
            {!questions.data?.length ? (
              <EmptyState title="No questions yet" body="Create your first coding question." />
            ) : (
              <ul className="space-y-2">
                {questions.data.map((q) => (
                  <li key={q.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                    <div className="font-medium text-paper">{q.title}</div>
                    <div className="text-mist">
                      #{q.id} · {q.language} · {q.difficulty} · {q.question_type}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "tests" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <h2 className="mb-4 font-display text-xl text-paper">Create test (E→M→H)</h2>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                setError(null);
                createTest.mutate();
              }}
            >
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
              {(["EASY", "MEDIUM", "HARD"] as Difficulty[]).map((diff) => (
                <Field key={diff} label={`${diff} question`}>
                  <select
                    className={inputClass}
                    value={
                      diff === "EASY"
                        ? testForm.easy_question_id
                        : diff === "MEDIUM"
                          ? testForm.medium_question_id
                          : testForm.hard_question_id
                    }
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      if (diff === "EASY") setTestForm({ ...testForm, easy_question_id: id });
                      else if (diff === "MEDIUM") setTestForm({ ...testForm, medium_question_id: id });
                      else setTestForm({ ...testForm, hard_question_id: id });
                    }}
                    required
                  >
                    <option value={0}>Select…</option>
                    {byDiff[diff].map((q) => (
                      <option key={q.id} value={q.id}>
                        #{q.id} {q.title} ({q.language})
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
              <div>
                <PrimaryButton type="submit" disabled={createTest.isPending}>
                  Create test
                </PrimaryButton>
              </div>
            </form>
          </Panel>
          <Panel>
            <h2 className="mb-3 font-display text-xl text-paper">Your tests</h2>
            {assignMsg ? <p className="mb-3 text-sm text-accent">{assignMsg}</p> : null}
            {!tests.data?.length ? (
              <EmptyState title="No tests yet" body="Build a progressive 3-question test." />
            ) : (
              <ul className="space-y-3">
                {tests.data.map((t) => {
                  const selectedClassroomId = classroomByTest[t.id] || 0;
                  return (
                    <li key={t.id} className="rounded-xl border border-line p-3 text-sm">
                      <div className="font-medium text-paper">{t.title}</div>
                      <div className="text-mist">
                        Invite <span className="text-accent">{t.invite_code}</span> · {t.duration_minutes}{" "}
                        min · {t.is_published_results ? "results published" : "results private"}
                      </div>
                      <div className="mt-3 flex flex-col gap-2">
                        <label className="block space-y-1.5">
                          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
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
                            className="rounded-xl border border-line px-3 py-2 text-mist disabled:opacity-50"
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
                            className="rounded-xl border border-line px-3 py-2 text-mist"
                            onClick={() => {
                              setSelectedTestId(t.id);
                              setTab("results");
                            }}
                          >
                            Results
                          </button>
                          {!t.is_published_results ? (
                            <button
                              type="button"
                              className="rounded-xl bg-accent px-3 py-2 font-semibold text-ink"
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
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl text-paper">Attempts</h2>
            <select
              className={inputClass}
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
            <div key={a.assignment_id} className="mb-3 rounded-xl border border-line p-3 text-sm">
              <div className="font-medium text-paper">
                {a.student_name} · {a.student_email}
              </div>
              <div className="text-mist">
                {a.session_status || "not started"} · violations {a.violation_score ?? 0} · avg{" "}
                {a.average_score ?? "—"}
              </div>
              <div className="mt-3 space-y-3">
                {a.evals.map((ev) => {
                  const codeKey = `${a.assignment_id}-${ev.question_id}`;
                  const codeOpen = openCodeKey === codeKey;
                  const isEditing = editingEvalId != null && editingEvalId === ev.eval_run_id;
                  return (
                    <div key={codeKey} className="rounded-lg border border-line/80 bg-ink-soft/40 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-paper">
                            {ev.question_title}{" "}
                            <span className="text-xs font-normal text-mist">
                              ({ev.difficulty}
                              {ev.language ? ` · ${ev.language}` : ""})
                            </span>
                          </div>
                          <div className="mt-1 text-mist">
                            Score {ev.total_score} · {ev.verdict}
                            {ev.scores?.teacher_override ? (
                              <span className="ml-2 text-xs text-amber-300">teacher edited</span>
                            ) : null}
                          </div>
                          {!isEditing ? <p className="mt-1 text-mist">{ev.feedback}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-line px-3 py-1 text-xs text-mist"
                            onClick={() => setOpenCodeKey(codeOpen ? null : codeKey)}
                          >
                            {codeOpen ? "Hide code" : "View code"}
                          </button>
                          {ev.eval_run_id ? (
                            <button
                              type="button"
                              className="rounded-lg bg-accent/20 px-3 py-1 text-xs text-accent"
                              onClick={() => (isEditing ? setEditingEvalId(null) : startEdit(ev))}
                            >
                              {isEditing ? "Cancel" : "Edit result"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {codeOpen ? (
                        <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-line bg-ink p-3 text-xs text-paper whitespace-pre-wrap">
                          {ev.code?.trim() ? ev.code : "(no code submitted)"}
                        </pre>
                      ) : null}
                      {isEditing ? (
                        <form
                          className="mt-3 grid gap-2 rounded-lg border border-line p-3"
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
                {!a.evals.length ? <p className="text-mist">No graded submissions yet.</p> : null}
              </div>
            </div>
          ))}
        </Panel>
      ) : null}
    </div>
  );
}
