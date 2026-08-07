import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { practiceApi } from "../api";
import type { MockExam, MockExamAttempt, MockExamPattern, MockExamSection } from "../api/types";
import {
  EmptyState,
  ErrorText,
  Field,
  GhostButton,
  inputClass,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";

type Step = "upload" | "review" | "manage";

function emptySection(): MockExamSection {
  return {
    id: `section-${Math.random().toString(36).slice(2, 8)}`,
    title: "Section A",
    instructions: "",
    question_type: "MCQ",
    marks_per_question: 1,
    question_count: 5,
    required_count: null,
    questions: [],
  };
}

function defaultPattern(): MockExamPattern {
  return {
    title: "Mock Exam",
    total_marks: 60,
    duration_minutes: 60,
    instructions: "",
    sections: [emptySection()],
  };
}

function questionCount(exam: MockExam) {
  return (exam.paper?.sections ?? []).reduce((sum, section) => sum + (section.questions?.length ?? 0), 0);
}

export function ClassroomMockExamsPanel({ classroomId }: { classroomId: number }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("manage");
  const [error, setError] = useState<string | null>(null);
  const [pattern, setPattern] = useState<MockExamPattern>(defaultPattern());
  const [pyqName, setPyqName] = useState<string | null>(null);
  const [pyqPath, setPyqPath] = useState<string | null>(null);
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<number, { theory_score: string; feedback: string }>>({});

  const exams = useQuery({
    queryKey: ["mock-exams", classroomId],
    queryFn: () => practiceApi.listMockExams(classroomId),
    enabled: Number.isFinite(classroomId),
  });

  const selectedExam = useMemo(
    () => exams.data?.find((exam) => exam.id === selectedExamId) ?? null,
    [exams.data, selectedExamId],
  );

  const attempts = useQuery({
    queryKey: ["mock-exam-attempts", classroomId, selectedExamId],
    queryFn: () => practiceApi.listMockExamAttempts(classroomId, selectedExamId!),
    enabled: selectedExamId != null,
  });

  useEffect(() => {
    if (selectedExamId == null && exams.data?.length) {
      setSelectedExamId(exams.data[0].id);
    }
  }, [exams.data, selectedExamId]);

  const extractPattern = useMutation({
    mutationFn: (file: File) => practiceApi.extractMockPattern(classroomId, file),
    onSuccess: (data, file) => {
      setPattern({
        title: data.title || "Mock Exam",
        total_marks: data.total_marks || 60,
        duration_minutes: data.duration_minutes || 60,
        instructions: data.instructions || "",
        sections: (data.sections?.length ? data.sections : [emptySection()]).map((section) => ({
          ...section,
          questions: section.questions ?? [],
        })),
      });
      setPyqName(data.pyq_file_name || file.name);
      setPyqPath(data.pyq_file_path || null);
      setStep("review");
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not extract PYQ pattern");
    },
  });

  const createExam = useMutation({
    mutationFn: () =>
      practiceApi.createMockExam(classroomId, {
        title: pattern.title.trim() || "Mock Exam",
        total_marks: pattern.total_marks,
        duration_minutes: pattern.duration_minutes,
        pattern: pattern as unknown as Record<string, unknown>,
        pyq_file_name: pyqName,
        pyq_file_path: pyqPath,
      }),
    onSuccess: async (exam) => {
      await qc.invalidateQueries({ queryKey: ["mock-exams", classroomId] });
      setSelectedExamId(exam.id);
      setStep("manage");
      setError(exam.error_message || null);
      setPyqName(null);
      setPyqPath(null);
      setPattern(defaultPattern());
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not generate mock exam");
    },
  });

  const publishExam = useMutation({
    mutationFn: ({ examId, is_published }: { examId: number; is_published: boolean }) =>
      practiceApi.publishMockExam(classroomId, examId, is_published),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["mock-exams", classroomId] });
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not update publish state");
    },
  });

  const regenerateExam = useMutation({
    mutationFn: (examId: number) => practiceApi.regenerateMockExam(classroomId, examId),
    onSuccess: async (exam) => {
      await qc.invalidateQueries({ queryKey: ["mock-exams", classroomId] });
      setSelectedExamId(exam.id);
      setError(exam.error_message || null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not regenerate mock exam");
    },
  });

  const reviewAttempt = useMutation({
    mutationFn: ({
      attemptId,
      theory_score,
      feedback,
    }: {
      attemptId: number;
      theory_score: number;
      feedback?: string | null;
    }) =>
      practiceApi.reviewMockExamAttempt(classroomId, selectedExamId!, attemptId, {
        theory_score,
        feedback,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["mock-exam-attempts", classroomId, selectedExamId] });
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not save review");
    },
  });

  function updateSection(index: number, patch: Partial<MockExamSection>) {
    setPattern((prev) => ({
      ...prev,
      sections: prev.sections.map((section, i) => (i === index ? { ...section, ...patch } : section)),
    }));
  }

  return (
    <div className="space-y-4 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">
              M
            </span>
            <h3 className="font-semibold text-paper">Mock Exams</h3>
          </div>
          <p className="mt-1 text-sm text-mist">
            Upload a PYQ, review the extracted pattern, generate a fresh paper from classroom docs, then publish for
            Practice → Assessments → Subject Wise.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton
            onClick={() => {
              setStep("upload");
              setError(null);
            }}
          >
            New from PYQ
          </SecondaryButton>
          <GhostButton onClick={() => setStep("manage")}>Manage published</GhostButton>
        </div>
      </div>

      <ErrorText message={error} />

      {step === "upload" ? (
        <div className="space-y-3 rounded-xl border border-dashed border-line bg-panel/40 px-4 py-6">
          <p className="text-sm font-medium text-paper">Step 1 · Upload PYQ (PDF or image)</p>
          <p className="text-sm text-mist">
            Gemini extracts structure only (sections, marks, counts). Question content is not reused.
          </p>
          <input
            type="file"
            accept=".pdf,image/png,image/jpeg,image/webp,application/pdf"
            className={inputClass}
            disabled={extractPattern.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              extractPattern.mutate(file);
            }}
          />
          {extractPattern.isPending ? <p className="text-sm text-accent">Extracting paper pattern…</p> : null}
        </div>
      ) : null}

      {step === "review" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-paper">Step 2 · Review editable blueprint</p>
              {pyqName ? <p className="text-xs text-mist">Source: {pyqName}</p> : null}
            </div>
            <GhostButton onClick={() => setStep("upload")}>Re-upload</GhostButton>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Title">
              <input
                className={inputClass}
                value={pattern.title}
                onChange={(e) => setPattern((prev) => ({ ...prev, title: e.target.value }))}
              />
            </Field>
            <Field label="Total marks">
              <input
                type="number"
                min={1}
                className={inputClass}
                value={pattern.total_marks}
                onChange={(e) =>
                  setPattern((prev) => ({ ...prev, total_marks: Number(e.target.value) || 0 }))
                }
              />
            </Field>
            <Field label="Duration (minutes)">
              <input
                type="number"
                min={1}
                className={inputClass}
                value={pattern.duration_minutes}
                onChange={(e) =>
                  setPattern((prev) => ({ ...prev, duration_minutes: Number(e.target.value) || 0 }))
                }
              />
            </Field>
          </div>

          <Field label="Instructions">
            <textarea
              className={inputClass}
              rows={3}
              value={pattern.instructions}
              onChange={(e) => setPattern((prev) => ({ ...prev, instructions: e.target.value }))}
            />
          </Field>

          <div className="space-y-3">
            {pattern.sections.map((section, index) => (
              <div key={section.id || index} className="space-y-3 rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-paper">Section {index + 1}</p>
                  <GhostButton
                    onClick={() =>
                      setPattern((prev) => ({
                        ...prev,
                        sections: prev.sections.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    Remove
                  </GhostButton>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Title">
                    <input
                      className={inputClass}
                      value={section.title}
                      onChange={(e) => updateSection(index, { title: e.target.value })}
                    />
                  </Field>
                  <Field label="Question type">
                    <select
                      className={inputClass}
                      value={section.question_type}
                      onChange={(e) => updateSection(index, { question_type: e.target.value })}
                    >
                      <option value="MCQ">MCQ</option>
                      <option value="SHORT">Short</option>
                      <option value="THEORY">Theory</option>
                      <option value="MIXED">Mixed</option>
                    </select>
                  </Field>
                  <Field label="Question count">
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={section.question_count}
                      onChange={(e) =>
                        updateSection(index, { question_count: Number(e.target.value) || 0 })
                      }
                    />
                  </Field>
                  <Field label="Marks per question">
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      className={inputClass}
                      value={section.marks_per_question}
                      onChange={(e) =>
                        updateSection(index, { marks_per_question: Number(e.target.value) || 0 })
                      }
                    />
                  </Field>
                  <Field label="Required count (optional)">
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={section.required_count ?? ""}
                      onChange={(e) =>
                        updateSection(index, {
                          required_count: e.target.value === "" ? null : Number(e.target.value) || 0,
                        })
                      }
                    />
                  </Field>
                </div>
                <Field label="Section instructions">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={section.instructions}
                    onChange={(e) => updateSection(index, { instructions: e.target.value })}
                  />
                </Field>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <SecondaryButton
              onClick={() =>
                setPattern((prev) => ({
                  ...prev,
                  sections: [...prev.sections, emptySection()],
                }))
              }
            >
              Add section
            </SecondaryButton>
            <PrimaryButton
              disabled={createExam.isPending || !pattern.sections.length}
              onClick={() => createExam.mutate()}
            >
              {createExam.isPending ? "Generating paper…" : "Step 3 · Generate mock paper"}
            </PrimaryButton>
          </div>
        </div>
      ) : null}

      {step === "manage" ? (
        <div className="space-y-4">
          {!exams.data?.length ? (
            <EmptyState
              title="No mock exams yet"
              body="Upload a previous-year paper to extract a pattern and generate a classroom mock exam."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
              <div className="space-y-2">
                {exams.data.map((exam) => (
                  <button
                    key={exam.id}
                    type="button"
                    onClick={() => setSelectedExamId(exam.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left text-sm transition ${
                      selectedExamId === exam.id
                        ? "border-accent bg-accent/10 text-paper"
                        : "border-line text-mist hover:border-accent/40 hover:text-paper"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-paper">{exam.title}</span>
                      <span className="text-[11px] uppercase tracking-wide">
                        {exam.status === "PUBLISHED" ? "Published" : "Draft"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs">
                      {exam.total_marks} marks · {exam.duration_minutes} mins · {questionCount(exam)} questions
                    </p>
                    {exam.error_message ? (
                      <p className="mt-1 text-xs text-red-400">{exam.error_message}</p>
                    ) : null}
                  </button>
                ))}
              </div>

              {selectedExam ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-paper">{selectedExam.title}</h4>
                      <p className="text-sm text-mist">
                        {selectedExam.total_marks} marks · {selectedExam.duration_minutes} minutes ·{" "}
                        {questionCount(selectedExam)} questions
                      </p>
                      {selectedExam.error_message ? (
                        <p className="mt-2 text-sm text-red-400">{selectedExam.error_message}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(selectedExam.error_message || questionCount(selectedExam) === 0) &&
                      selectedExam.status !== "PUBLISHED" ? (
                        <SecondaryButton
                          disabled={regenerateExam.isPending}
                          onClick={() => regenerateExam.mutate(selectedExam.id)}
                        >
                          {regenerateExam.isPending ? "Regenerating…" : "Regenerate paper"}
                        </SecondaryButton>
                      ) : null}
                      <PrimaryButton
                        disabled={
                          publishExam.isPending ||
                          (!!selectedExam.error_message && selectedExam.status !== "PUBLISHED") ||
                          (selectedExam.status !== "PUBLISHED" && questionCount(selectedExam) === 0)
                        }
                        onClick={() =>
                          publishExam.mutate({
                            examId: selectedExam.id,
                            is_published: selectedExam.status !== "PUBLISHED",
                          })
                        }
                      >
                        {selectedExam.status === "PUBLISHED" ? "Unpublish" : "Publish to students"}
                      </PrimaryButton>
                    </div>
                  </div>

                  {(selectedExam.paper?.sections ?? []).map((section) => (
                    <div key={section.id} className="rounded-xl border border-line p-3">
                      <p className="text-sm font-semibold text-paper">{section.title}</p>
                      {section.instructions ? (
                        <p className="mt-1 text-xs text-mist">{section.instructions}</p>
                      ) : null}
                      <ul className="mt-2 space-y-2">
                        {(section.questions ?? []).map((question, qi) => (
                          <li key={question.id || qi} className="text-sm text-mist">
                            <span className="font-medium text-paper">
                              {qi + 1}. [{question.question_type} · {question.marks}m]{" "}
                            </span>
                            {question.question}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}

                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-mist">
                      Student attempts · theory review
                    </h4>
                    {attempts.isLoading ? (
                      <p className="text-sm text-mist">Loading attempts…</p>
                    ) : !attempts.data?.length ? (
                      <p className="text-sm text-mist">No student attempts yet.</p>
                    ) : (
                      attempts.data.map((attempt) => (
                        <AttemptReviewCard
                          key={attempt.id}
                          attempt={attempt}
                          exam={selectedExam}
                          draft={
                            reviewDrafts[attempt.id] ?? {
                              theory_score: attempt.theory_score != null ? String(attempt.theory_score) : "",
                              feedback: attempt.feedback ?? "",
                            }
                          }
                          onDraftChange={(draft) =>
                            setReviewDrafts((prev) => ({ ...prev, [attempt.id]: draft }))
                          }
                          saving={reviewAttempt.isPending}
                          onSave={() => {
                            const draft = reviewDrafts[attempt.id] ?? {
                              theory_score: attempt.theory_score != null ? String(attempt.theory_score) : "0",
                              feedback: attempt.feedback ?? "",
                            };
                            reviewAttempt.mutate({
                              attemptId: attempt.id,
                              theory_score: Number(draft.theory_score) || 0,
                              feedback: draft.feedback || null,
                            });
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AttemptReviewCard({
  attempt,
  exam,
  draft,
  onDraftChange,
  onSave,
  saving,
}: {
  attempt: MockExamAttempt;
  exam: MockExam;
  draft: { theory_score: string; feedback: string };
  onDraftChange: (draft: { theory_score: string; feedback: string }) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const theoryQuestions = useMemo(() => {
    const items: { id: string; question: string; marks: number; expected?: string | null }[] = [];
    for (const section of exam.paper?.sections ?? []) {
      for (const question of section.questions ?? []) {
        const type = (question.question_type || "").toUpperCase();
        if (type !== "MCQ") {
          items.push({
            id: question.id,
            question: question.question,
            marks: question.marks,
            expected: question.expected_answer,
          });
        }
      }
    }
    return items;
  }, [exam.paper]);

  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-paper">Student #{attempt.student_id}</p>
          <p className="text-xs text-mist">
            Submitted {new Date(attempt.submitted_at).toLocaleString()} · MCQ {attempt.mcq_score ?? 0} ·{" "}
            {attempt.theory_status === "REVIEWED" ? "Theory reviewed" : "Pending theory review"}
          </p>
        </div>
        <p className="text-sm text-paper">
          Total: {attempt.total_score != null ? attempt.total_score : "—"}
        </p>
      </div>

      {theoryQuestions.length ? (
        <div className="space-y-2">
          {theoryQuestions.map((question) => (
            <div key={question.id} className="rounded-lg border border-line/70 px-3 py-2 text-sm">
              <p className="font-medium text-paper">
                [{question.marks}m] {question.question}
              </p>
              <p className="mt-1 text-mist">
                Student answer: {attempt.answers?.[question.id] || <em>No answer</em>}
              </p>
              {question.expected ? (
                <p className="mt-1 text-xs text-accent">Expected: {question.expected}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-mist">No theory questions on this paper.</p>
      )}

      {theoryQuestions.length ? (
        <div className="grid gap-3 md:grid-cols-[160px_1fr_auto]">
          <Field label="Theory score">
            <input
              type="number"
              min={0}
              step="0.5"
              className={inputClass}
              value={draft.theory_score}
              onChange={(e) => onDraftChange({ ...draft, theory_score: e.target.value })}
            />
          </Field>
          <Field label="Feedback">
            <input
              className={inputClass}
              value={draft.feedback}
              onChange={(e) => onDraftChange({ ...draft, feedback: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <PrimaryButton disabled={saving} onClick={onSave}>
              {saving ? "Saving…" : attempt.theory_status === "REVIEWED" ? "Update review" : "Save review"}
            </PrimaryButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
