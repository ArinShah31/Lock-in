import { FormEvent, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assignmentsApi } from "../api";
import type { Assignment, AssignmentSubmission, Classroom } from "../api/types";
import { uploadFileUrl } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import {
  EmptyState,
  ErrorText,
  Field,
  GhostButton,
  inputClass,
  PrimaryButton,
} from "../components/ui";

type OutletCtx = { classroom: Classroom };

function statusLabel(a: Assignment, isTeacher: boolean): string {
  if (isTeacher) {
    const submitted = a.submitted_count ?? 0;
    const graded = a.graded_count ?? 0;
    return `${submitted} submitted · ${graded} graded`;
  }
  const sub = a.my_submission;
  if (!sub) return "Not submitted";
  if (sub.is_graded) return `Graded · ${sub.marks}/${a.max_marks}`;
  if (sub.is_late) return "Submitted (late)";
  return "Submitted";
}

export function ClassroomAssignmentsTab() {
  const { classroom } = useOutletContext<OutletCtx>();
  const { classroomId } = useParams();
  const id = Number(classroomId);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: "",
    instructions: "",
    max_marks: "100",
    due_at: "",
  });
  const [promptFile, setPromptFile] = useState<File | null>(null);
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const [gradeMarks, setGradeMarks] = useState("");
  const [gradeFeedback, setGradeFeedback] = useState("");
  const [gradingStudentId, setGradingStudentId] = useState<number | null>(null);

  const isTeacher = !!user && user.id === classroom.class_teacher_id;
  const isStudent = user?.role === "STUDENT";

  const assignments = useQuery({
    queryKey: ["assignments", id],
    queryFn: () => assignmentsApi.listByClassroom(id),
    enabled: !Number.isNaN(id),
  });

  const selected = useMemo(
    () => assignments.data?.find((a) => a.id === selectedId) ?? null,
    [assignments.data, selectedId],
  );

  const detail = useQuery({
    queryKey: ["assignment", selectedId],
    queryFn: () => assignmentsApi.get(selectedId!),
    enabled: selectedId != null,
  });

  const submissions = useQuery({
    queryKey: ["assignment-submissions", selectedId],
    queryFn: () => assignmentsApi.listSubmissions(selectedId!),
    enabled: selectedId != null && isTeacher,
  });

  const createMutation = useMutation({
    mutationFn: (body: FormData) => assignmentsApi.create(id, body),
    onSuccess: async (created) => {
      setShowCreate(false);
      setForm({ title: "", instructions: "", max_marks: "100", due_at: "" });
      setPromptFile(null);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["assignments", id] });
      setSelectedId(created.id);
    },
    onError: (err: Error) => setError(err.message),
  });

  const submitMutation = useMutation({
    mutationFn: (body: FormData) => assignmentsApi.submit(selectedId!, body),
    onSuccess: async () => {
      setAnswerFile(null);
      setError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["assignments", id] }),
        qc.invalidateQueries({ queryKey: ["assignment", selectedId] }),
      ]);
    },
    onError: (err: Error) => setError(err.message),
  });

  const gradeMutation = useMutation({
    mutationFn: ({
      studentId,
      marks,
      feedback,
    }: {
      studentId: number;
      marks: number;
      feedback?: string;
    }) => assignmentsApi.grade(selectedId!, studentId, { marks, feedback }),
    onSuccess: async () => {
      setGradingStudentId(null);
      setGradeMarks("");
      setGradeFeedback("");
      setError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["assignment-submissions", selectedId] }),
        qc.invalidateQueries({ queryKey: ["assignments", id] }),
        qc.invalidateQueries({ queryKey: ["assignment", selectedId] }),
      ]);
    },
    onError: (err: Error) => setError(err.message),
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) {
      setError("Title is required");
      return;
    }
    if (!form.due_at) {
      setError("Due date is required");
      return;
    }
    if (!form.instructions.trim() && !promptFile) {
      setError("Provide instructions and/or an attachment");
      return;
    }
    const fd = new FormData();
    fd.append("title", form.title.trim());
    fd.append("max_marks", String(Number(form.max_marks)));
    fd.append("due_at", new Date(form.due_at).toISOString());
    if (form.instructions.trim()) fd.append("instructions", form.instructions.trim());
    if (promptFile) fd.append("file", promptFile);
    createMutation.mutate(fd);
  }

  function onSubmitAnswer(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!answerFile) {
      setError("Choose a file to upload");
      return;
    }
    const fd = new FormData();
    fd.append("file", answerFile);
    submitMutation.mutate(fd);
  }

  function startGrade(sub: AssignmentSubmission, maxMarks: number) {
    setGradingStudentId(sub.student_id);
    setGradeMarks(sub.marks != null ? String(sub.marks) : String(maxMarks));
    setGradeFeedback(sub.feedback ?? "");
  }

  function onGrade(e: FormEvent) {
    e.preventDefault();
    if (gradingStudentId == null) return;
    setError(null);
    const marks = Number(gradeMarks);
    if (Number.isNaN(marks) || marks < 0) {
      setError("Enter a valid mark");
      return;
    }
    gradeMutation.mutate({
      studentId: gradingStudentId,
      marks,
      feedback: gradeFeedback.trim() || undefined,
    });
  }

  const active = detail.data ?? selected;
  const mySub = active?.my_submission ?? null;
  const canSubmit = isStudent && active && !mySub?.is_graded;

  if (selectedId != null && active) {
    const promptUrl = uploadFileUrl(active.file_path);
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <GhostButton onClick={() => setSelectedId(null)}>← All assignments</GhostButton>
            <h2 className="mt-3 font-display text-xl text-paper">{active.title}</h2>
            <p className="mt-1 text-sm text-mist">
              Due {new Date(active.due_at).toLocaleString()} · Max {active.max_marks} marks
              {isTeacher ? ` · ${statusLabel(active, true)}` : ` · ${statusLabel(active, false)}`}
            </p>
          </div>
        </div>

        <ErrorText message={error} />

        {active.instructions ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-mist">Instructions</h3>
            <p className="whitespace-pre-wrap text-sm text-paper">{active.instructions}</p>
          </div>
        ) : null}

        {promptUrl && active.file_name ? (
          <a
            href={promptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-sm font-semibold text-accent hover:underline"
          >
            Download assignment file: {active.file_name}
          </a>
        ) : null}

        {isStudent ? (
          <div className="space-y-4 border-t border-line pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-mist">Your submission</h3>
            {mySub ? (
              <div className="rounded-xl border border-line px-3 py-3 text-sm">
                <p className="text-paper">
                  {mySub.file_name}
                  {mySub.is_late ? <span className="ml-2 text-accent">Late</span> : null}
                </p>
                <p className="text-xs text-mist">Submitted {new Date(mySub.submitted_at).toLocaleString()}</p>
                {uploadFileUrl(mySub.file_path) ? (
                  <a
                    href={uploadFileUrl(mySub.file_path)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex text-accent hover:underline"
                  >
                    View uploaded file
                  </a>
                ) : null}
                {mySub.is_graded ? (
                  <div className="mt-3 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2">
                    <p className="font-semibold text-paper">
                      Grade: {mySub.marks} / {active.max_marks}
                    </p>
                    {mySub.feedback ? <p className="mt-1 text-mist">{mySub.feedback}</p> : null}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-mist">You can replace this file until it is graded.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-mist">No submission yet.</p>
            )}

            {canSubmit ? (
              <form className="grid gap-3" onSubmit={onSubmitAnswer}>
                <Field label={mySub ? "Replace answer file" : "Upload answer file"}>
                  <input
                    className={inputClass}
                    type="file"
                    onChange={(e) => setAnswerFile(e.target.files?.[0] ?? null)}
                    required
                  />
                </Field>
                <PrimaryButton type="submit" disabled={submitMutation.isPending}>
                  {mySub ? "Resubmit" : "Submit"}
                </PrimaryButton>
              </form>
            ) : null}
          </div>
        ) : null}

        {isTeacher ? (
          <div className="space-y-4 border-t border-line pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-mist">Submissions</h3>
            {!submissions.data?.length ? (
              <p className="text-sm text-mist">No submissions yet.</p>
            ) : (
              <ul className="space-y-3">
                {submissions.data.map((sub) => {
                  const fileHref = uploadFileUrl(sub.file_path);
                  const isEditing = gradingStudentId === sub.student_id;
                  return (
                    <li key={sub.id} className="rounded-xl border border-line px-3 py-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-paper">
                            {sub.student_full_name ?? `Student ${sub.student_id}`}
                            {sub.is_late ? <span className="ml-2 text-accent">Late</span> : null}
                          </p>
                          <p className="text-xs text-mist">
                            {sub.student_email}
                            {" · "}
                            {new Date(sub.submitted_at).toLocaleString()}
                          </p>
                          {fileHref ? (
                            <a
                              href={fileHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex text-accent hover:underline"
                            >
                              {sub.file_name}
                            </a>
                          ) : null}
                          {sub.is_graded ? (
                            <p className="mt-2 text-paper">
                              Grade: {sub.marks} / {active.max_marks}
                              {sub.feedback ? ` · ${sub.feedback}` : ""}
                            </p>
                          ) : null}
                        </div>
                        <GhostButton onClick={() => startGrade(sub, active.max_marks)}>
                          {sub.is_graded ? "Update grade" : "Grade"}
                        </GhostButton>
                      </div>
                      {isEditing ? (
                        <form className="mt-3 grid gap-3 border-t border-line pt-3" onSubmit={onGrade}>
                          <Field label={`Marks (max ${active.max_marks})`}>
                            <input
                              className={inputClass}
                              type="number"
                              min={0}
                              max={active.max_marks}
                              step="0.5"
                              value={gradeMarks}
                              onChange={(e) => setGradeMarks(e.target.value)}
                              required
                            />
                          </Field>
                          <Field label="Feedback">
                            <textarea
                              className={inputClass}
                              rows={3}
                              value={gradeFeedback}
                              onChange={(e) => setGradeFeedback(e.target.value)}
                            />
                          </Field>
                          <div className="flex gap-2">
                            <PrimaryButton type="submit" disabled={gradeMutation.isPending}>
                              Save grade
                            </PrimaryButton>
                            <GhostButton onClick={() => setGradingStudentId(null)}>Cancel</GhostButton>
                          </div>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-paper">Assignments</h2>
          <p className="text-sm text-mist">
            {isTeacher
              ? "Create document assignments, review submissions, and grade."
              : "View assignments, upload your answers, and check grades."}
          </p>
        </div>
        {isTeacher ? (
          <PrimaryButton onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Cancel" : "New assignment"}
          </PrimaryButton>
        ) : null}
      </div>

      <ErrorText message={error} />

      {isTeacher && showCreate ? (
        <form className="grid gap-3 rounded-2xl border border-line p-4" onSubmit={onCreate}>
          <Field label="Title">
            <input
              className={inputClass}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </Field>
          <Field label="Instructions">
            <textarea
              className={inputClass}
              rows={4}
              value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
              placeholder="Optional if you attach a file"
            />
          </Field>
          <Field label="Attachment (optional)">
            <input
              className={inputClass}
              type="file"
              onChange={(e) => setPromptFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Due date">
              <input
                className={inputClass}
                type="datetime-local"
                value={form.due_at}
                onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))}
                required
              />
            </Field>
            <Field label="Max marks">
              <input
                className={inputClass}
                type="number"
                min={1}
                step="0.5"
                value={form.max_marks}
                onChange={(e) => setForm((f) => ({ ...f, max_marks: e.target.value }))}
                required
              />
            </Field>
          </div>
          <PrimaryButton type="submit" disabled={createMutation.isPending}>
            Publish assignment
          </PrimaryButton>
        </form>
      ) : null}

      {assignments.isLoading ? <p className="text-sm text-mist">Loading assignments…</p> : null}
      {assignments.isError ? <ErrorText message="Failed to load assignments." /> : null}

      {!assignments.data?.length && !assignments.isLoading ? (
        <EmptyState
          title="No assignments yet"
          body={
            isTeacher
              ? "Create an assignment with instructions and/or a document for students."
              : "Your teacher has not published any assignments yet."
          }
        />
      ) : (
        <ul className="space-y-3">
          {assignments.data?.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="w-full rounded-2xl border border-line bg-ink-soft/40 px-4 py-3 text-left transition hover:border-accent/40"
                onClick={() => {
                  setError(null);
                  setSelectedId(a.id);
                }}
              >
                <p className="font-semibold text-paper">{a.title}</p>
                <p className="mt-1 text-xs text-mist">
                  Due {new Date(a.due_at).toLocaleString()} · Max {a.max_marks}
                  {" · "}
                  {statusLabel(a, isTeacher)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
