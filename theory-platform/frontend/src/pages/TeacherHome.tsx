import { FormEvent, type DragEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type BloomLevel,
  type Question,
  type QuestionDraft,
  type RubricCriterion,
  type SubjectArea,
  type TheoryTest,
} from "../api";
import { useAuth } from "../auth";

const SUBJECT_AREAS: SubjectArea[] = [
  "general",
  "science",
  "mathematics",
  "humanities",
  "business",
  "computer_science",
];
const BLOOM_LEVELS: BloomLevel[] = [
  "REMEMBER",
  "UNDERSTAND",
  "APPLY",
  "ANALYZE",
  "EVALUATE",
  "CREATE",
];

const DND_BANK = "application/x-astra-theory-bank-qid";
const DND_SEQ = "application/x-astra-theory-seq-index";

const fieldClass =
  "w-full rounded-md border border-[#c5c6cf] bg-white px-3.5 py-2.5 text-sm text-[#191c1d] outline-none placeholder:text-[#75777f] focus:border-[#031635] focus:ring-1 focus:ring-[#031635]";
const panelClass = "rounded-2xl border border-[#e1e3e4] bg-white p-5 shadow-sm";
const primaryBtn =
  "rounded-md bg-[#031635] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1a2b4b] disabled:opacity-50";
const secondaryBtn =
  "rounded-md border border-[#c5c6cf] bg-white px-3 py-1.5 text-sm font-semibold text-[#031635] transition hover:border-[#031635]";

type TheoryTab = "bank" | "generate" | "tests" | "results";

function bloomLabel(level: BloomLevel | string | undefined) {
  if (!level) return "";
  return level.charAt(0) + level.slice(1).toLowerCase();
}

function subjectLabel(subject: string) {
  return subject.replaceAll("_", " ");
}

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

type AttemptEval = {
  eval_run_id: number | null;
  submission_id: number | null;
  question_id: number;
  question_title: string;
  bloom_level: BloomLevel;
  subject: SubjectArea | null;
  answer_text: string | null;
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
  const [tab, setTab] = useState<TheoryTab>("generate");
  const [error, setError] = useState<string | null>(null);
  const [expandedQuestionId, setExpandedQuestionId] = useState<number | null>(null);
  const [openAnswerKey, setOpenAnswerKey] = useState<string | null>(null);
  const [editingEvalId, setEditingEvalId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ total_score: "", feedback: "", verdict: "PASS" });
  const [assignEmail, setAssignEmail] = useState("student@example.com");
  const [selectedTestId, setSelectedTestId] = useState<number | null>(null);
  const [seqDropIndex, setSeqDropIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const [genForm, setGenForm] = useState({
    topic_or_scenario: "",
    bloom_level: "APPLY" as BloomLevel,
    subject: "general" as SubjectArea,
  });
  const [testForm, setTestForm] = useState({
    title: "New theory test",
    duration_minutes: 45,
    question_ids: [] as number[],
  });

  const questions = useQuery({
    queryKey: ["questions"],
    queryFn: () => api<Question[]>("/teacher/questions"),
  });
  const tests = useQuery({
    queryKey: ["tests"],
    queryFn: () => api<TheoryTest[]>("/teacher/tests"),
  });
  const attempts = useQuery({
    queryKey: ["attempts", selectedTestId],
    queryFn: () => api<AttemptRow[]>(`/results/tests/${selectedTestId}/attempts`),
    enabled: selectedTestId != null && tab === "results",
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

  const questionById = useMemo(() => {
    const map = new Map<number, Question>();
    for (const q of questions.data || []) map.set(q.id, q);
    return map;
  }, [questions.data]);

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

  const generateQuestion = useMutation({
    mutationFn: () =>
      api<QuestionDraft>("/teacher/questions/generate", {
        method: "POST",
        body: JSON.stringify(genForm),
      }),
    onSuccess: (res) => {
      setDraft(res);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const createQuestion = useMutation({
    mutationFn: (body: object) =>
      api<Question>("/teacher/questions", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["questions"] });
      setTab("bank");
    },
    onError: (e: Error) => setError(e.message),
  });

  const createTest = useMutation({
    mutationFn: () => api<TheoryTest>("/teacher/tests", { method: "POST", body: JSON.stringify(testForm) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tests"] });
      setTestForm((prev) => ({ ...prev, question_ids: [] }));
    },
    onError: (e: Error) => setError(e.message),
  });

  const publish = useMutation({
    mutationFn: (testId: number) => api(`/results/tests/${testId}/publish`, { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tests"] });
      await qc.invalidateQueries({ queryKey: ["attempts"] });
    },
  });

  const assign = useMutation({
    mutationFn: ({ testId, email }: { testId: number; email: string }) =>
      api(`/teacher/tests/${testId}/assign`, {
        method: "POST",
        body: JSON.stringify({ student_email: email }),
      }),
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

  function startEdit(ev: AttemptEval) {
    if (!ev.eval_run_id) return;
    setEditingEvalId(ev.eval_run_id);
    setEditForm({
      total_score: String(ev.total_score ?? ""),
      feedback: ev.feedback,
      verdict: ev.verdict,
    });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3f5d9b]">Astra Theory</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[#031635]">Teacher workspace</h1>
          <p className="mt-1 text-sm text-[#44474e]">{user?.full_name}</p>
        </div>
        <button onClick={logout} className={secondaryBtn}>
          Log out
        </button>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        {(
          [
            ["generate", "Generate question"],
            ["bank", "Bank"],
            ["tests", "Tests"],
            ["results", "Results"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              tab === key ? "bg-[#031635] text-white" : "border border-[#e1e3e4] bg-white text-[#031635]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-3 rounded-lg border border-[#f1d1d1] bg-[#fff2f1] px-3 py-2 text-sm text-[#a03a3a]">{error}</p>
      ) : null}

      {tab === "generate" ? (
        <div className="space-y-6">
          <form
            className={`space-y-3 ${panelClass}`}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setError(null);
              generateQuestion.mutate();
            }}
          >
            <h2 className="font-semibold text-[#031635]">Generate question</h2>
            <p className="text-sm text-[#75777f]">
              Describe a topic or scenario. The AI writes a Bloom-aligned written question and marking guide.
            </p>
            <textarea
              className={`${fieldClass} min-h-28`}
              placeholder="e.g. Explain photosynthesis for class 10, including light and dark reactions."
              value={genForm.topic_or_scenario}
              onChange={(e) => setGenForm({ ...genForm, topic_or_scenario: e.target.value })}
              required
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                className={fieldClass}
                value={genForm.subject}
                onChange={(e) => setGenForm({ ...genForm, subject: e.target.value as SubjectArea })}
              >
                {SUBJECT_AREAS.map((s) => (
                  <option key={s} value={s}>
                    {subjectLabel(s)}
                  </option>
                ))}
              </select>
              <select
                className={fieldClass}
                value={genForm.bloom_level}
                onChange={(e) => setGenForm({ ...genForm, bloom_level: e.target.value as BloomLevel })}
              >
                {BLOOM_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {bloomLabel(level)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={primaryBtn} disabled={generateQuestion.isPending}>
                {generateQuestion.isPending ? "Generating…" : draft ? "Regenerate" : "Generate question"}
              </button>
              {draft ? (
                <button type="button" className={secondaryBtn} onClick={() => setDraft(null)}>
                  Clear
                </button>
              ) : null}
            </div>
          </form>

          {draft ? (
            <form
              className={`space-y-3 ${panelClass}`}
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                setError(null);
                createQuestion.mutate({
                  title: draft.title,
                  prompt_markdown: draft.prompt_markdown,
                  model_answer: draft.model_answer,
                  subject: draft.subject,
                  bloom_level: draft.bloom_level,
                  rubric: draft.rubric.filter((row) => row.name.trim()),
                  source_prompt: draft.source_prompt || genForm.topic_or_scenario,
                });
              }}
            >
              <h2 className="font-semibold text-[#031635]">Review draft, then save to bank</h2>
              <input
                className={fieldClass}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                required
              />
              <textarea
                className={`${fieldClass} min-h-40`}
                value={draft.prompt_markdown}
                onChange={(e) => setDraft({ ...draft, prompt_markdown: e.target.value })}
                required
              />
              <textarea
                className={`${fieldClass} min-h-28`}
                value={draft.model_answer}
                onChange={(e) => setDraft({ ...draft, model_answer: e.target.value })}
              />
              <ul className="space-y-1 text-sm text-[#44474e]">
                {(draft.rubric ?? []).map((row: RubricCriterion, i) => (
                  <li key={`${row.name}-${i}`} className="flex justify-between gap-3">
                    <span className="font-medium text-[#031635]">{row.name}</span>
                    <span className="text-[#3f5d9b]">{Number(row.weight) || 0}%</span>
                  </li>
                ))}
              </ul>
              <button type="submit" className={primaryBtn} disabled={createQuestion.isPending}>
                {createQuestion.isPending ? "Saving…" : "Save to bank"}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {tab === "bank" ? (
        <div className={panelClass}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-[#031635]">Question bank</h2>
            <button type="button" className={primaryBtn} onClick={() => setTab("generate")}>
              Generate question
            </button>
          </div>
          {!questions.data?.length ? (
            <p className="text-sm text-[#75777f]">
              No questions yet. Generate one, then drag it into a test on the Tests tab.
            </p>
          ) : (
            <ul className="space-y-2">
              {questions.data.map((q) => {
                const expanded = expandedQuestionId === q.id;
                return (
                  <li key={q.id} className="overflow-hidden rounded-xl border border-[#e1e3e4] text-sm">
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[#f8f9fa]"
                      onClick={() => setExpandedQuestionId(expanded ? null : q.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[#031635]">{q.title}</div>
                        <div className="text-[#44474e]">
                          #{q.id} · {subjectLabel(q.subject)} · {bloomLabel(q.bloom_level)}
                        </div>
                      </div>
                      <span className="material-symbols-outlined mt-0.5 text-[#75777f]">
                        {expanded ? "expand_less" : "expand_more"}
                      </span>
                    </button>
                    {expanded ? (
                      <div className="border-t border-[#e1e3e4] bg-[#f8f9fa] px-3 py-3 text-[#44474e]">
                        <p className="whitespace-pre-wrap">{q.prompt_markdown}</p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "tests" ? (
        <div className="space-y-6">
          <form
            className={`space-y-4 ${panelClass}`}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setError(null);
              createTest.mutate();
            }}
          >
            <h2 className="font-semibold text-[#031635]">Create test</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className={fieldClass}
                value={testForm.title}
                onChange={(e) => setTestForm({ ...testForm, title: e.target.value })}
                required
              />
              <input
                type="number"
                className={fieldClass}
                min={10}
                max={300}
                value={testForm.duration_minutes}
                onChange={(e) => setTestForm({ ...testForm, duration_minutes: Number(e.target.value) })}
              />
            </div>
            <p className="text-sm text-[#75777f]">
              Drag questions into the sequence (or click a tile to add). Reorder by dragging chips.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-3">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[#44474e]">Question bank</h3>
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
                                  #{q.id} · {subjectLabel(q.subject)} · {bloomLabel(q.bloom_level)}
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
                <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[#44474e]">Test sequence</h3>
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
                            highlight ? "border-[#031635] bg-[#eef4ff]" : "border-[#e1e3e4] bg-[#f8f9fa]"
                          }`}
                        >
                          <span className="mt-0.5 shrink-0 rounded-md bg-[#031635] px-1.5 py-0.5 text-[10px] font-bold text-white">
                            Q{index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-[#031635]">{q?.title ?? `#${id}`}</div>
                            <div className="text-xs text-[#75777f]">
                              #{id}
                              {q ? ` · ${subjectLabel(q.subject)} · ${bloomLabel(q.bloom_level)}` : ""}
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
            <button type="submit" className={primaryBtn} disabled={createTest.isPending || testForm.question_ids.length < 1}>
              {createTest.isPending ? "Creating…" : "Create test"}
            </button>
          </form>

          <div className={panelClass}>
            <h2 className="mb-3 font-semibold text-[#031635]">Your tests</h2>
            {(tests.data || []).length === 0 ? (
              <p className="text-sm text-[#75777f]">No tests yet.</p>
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {(tests.data || []).map((t) => (
                  <li key={t.id} className="rounded-xl border border-[#e1e3e4] p-3 text-sm">
                    <div className="font-medium text-[#031635]">{t.title}</div>
                    <div className="text-[#75777f]">
                      Invite <span className="font-semibold text-[#3f5d9b]">{t.invite_code}</span> · {t.duration_minutes}{" "}
                      min · {t.is_published_results ? "results published" : "results private"}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        className={`${fieldClass} max-w-56 py-1.5`}
                        value={assignEmail}
                        onChange={(e) => setAssignEmail(e.target.value)}
                        placeholder="student email"
                      />
                      <button
                        type="button"
                        className={secondaryBtn}
                        onClick={() => assign.mutate({ testId: t.id, email: assignEmail })}
                      >
                        Assign
                      </button>
                      <button
                        type="button"
                        className={secondaryBtn}
                        onClick={() => {
                          setSelectedTestId(t.id);
                          setTab("results");
                        }}
                      >
                        Results
                      </button>
                      {!t.is_published_results ? (
                        <button type="button" className={primaryBtn} onClick={() => publish.mutate(t.id)}>
                          Publish results
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {tab === "results" ? (
        <div className={`space-y-3 ${panelClass}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-[#031635]">Attempts</h2>
            <select
              className={`${fieldClass} max-w-xs py-1.5`}
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
            <div key={a.assignment_id} className="rounded-xl border border-[#e1e3e4] p-3 text-sm">
              <div className="font-medium text-[#031635]">
                {a.student_name} · {a.student_email}
              </div>
              <div className="text-[#75777f]">
                {a.session_status || "not started"} · violations {a.violation_score ?? 0} · avg {a.average_score ?? "—"}
              </div>
              <div className="mt-3 space-y-3">
                {a.evals.map((ev) => {
                  const answerKey = `${a.assignment_id}-${ev.question_id}`;
                  const answerOpen = openAnswerKey === answerKey;
                  const isEditing = editingEvalId != null && editingEvalId === ev.eval_run_id;
                  return (
                    <div key={answerKey} className="rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-[#031635]">
                            {ev.question_title}{" "}
                            <span className="text-xs font-normal text-[#75777f]">
                              ({bloomLabel(ev.bloom_level)}
                              {ev.subject ? ` · ${subjectLabel(ev.subject)}` : ""})
                            </span>
                          </div>
                          <div className="mt-1 text-[#44474e]">
                            Score {ev.total_score} · {ev.verdict}
                          </div>
                          {!isEditing ? <p className="mt-1 text-[#75777f]">{ev.feedback}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={secondaryBtn}
                            onClick={() => setOpenAnswerKey(answerOpen ? null : answerKey)}
                          >
                            {answerOpen ? "Hide answer" : "View answer"}
                          </button>
                          {ev.eval_run_id ? (
                            <button
                              type="button"
                              className={secondaryBtn}
                              onClick={() => (isEditing ? setEditingEvalId(null) : startEdit(ev))}
                            >
                              {isEditing ? "Cancel" : "Edit result"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {answerOpen ? (
                        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-[#e1e3e4] bg-white p-3 text-xs text-[#191c1d]">
                          {ev.answer_text?.trim() ? ev.answer_text : "(no answer submitted)"}
                        </pre>
                      ) : null}
                      {isEditing ? (
                        <form
                          className="mt-3 grid gap-2 rounded-lg border border-[#e1e3e4] bg-white p-3"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!ev.eval_run_id) return;
                            const score = Number(editForm.total_score);
                            if (!Number.isFinite(score) || score < 0 || score > 100) {
                              setError("Enter a score between 0 and 100.");
                              return;
                            }
                            updateEval.mutate({
                              evalRunId: ev.eval_run_id,
                              total_score: score,
                              feedback: editForm.feedback,
                              verdict: editForm.verdict,
                            });
                          }}
                        >
                          <input
                            type="text"
                            inputMode="decimal"
                            className={fieldClass}
                            placeholder="Score (0–100)"
                            value={editForm.total_score}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "" || /^\d{0,3}(\.\d{0,2})?$/.test(v)) {
                                setEditForm((f) => ({ ...f, total_score: v }));
                              }
                            }}
                            required
                          />
                          <select
                            className={fieldClass}
                            value={editForm.verdict}
                            onChange={(e) => setEditForm((f) => ({ ...f, verdict: e.target.value }))}
                          >
                            <option value="PASS">PASS</option>
                            <option value="BORDERLINE">BORDERLINE</option>
                            <option value="FAIL">FAIL</option>
                            <option value="ERROR">ERROR</option>
                          </select>
                          <textarea
                            className={`${fieldClass} min-h-24`}
                            value={editForm.feedback}
                            onChange={(e) => setEditForm((f) => ({ ...f, feedback: e.target.value }))}
                            required
                          />
                          <button type="submit" className={primaryBtn} disabled={updateEval.isPending}>
                            {updateEval.isPending ? "Saving…" : "Save changes"}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
                {!a.evals.length ? <p className="text-[#75777f]">No graded submissions yet.</p> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
