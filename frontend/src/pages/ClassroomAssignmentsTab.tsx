import { FormEvent, useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assignmentsApi } from "../api";
import type { Assignment, AssignmentSubmission, Classroom } from "../api/types";
import { uploadFileUrl } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { AssignmentsCalendar } from "../components/AssignmentsCalendar";
import {
  EmptyState,
  ErrorText,
  Field,
  GhostButton,
  inputClass,
  PrimaryButton,
} from "../components/ui";

type OutletCtx = { classroom: Classroom };

type AssignmentStatus = "graded" | "submitted" | "pending" | "not_submitted";

type TeacherCardStatus = "all_graded" | "partial" | "none";

type AssignmentStats = {
  total: number;
  submitted: number;
  pending: number;
  graded: number;
};

type StatusTheme = {
  accent: string;
  iconBg: string;
  iconColor: string;
  badgeBg: string;
  badgeText: string;
};

const CARD_ICONS = ["description", "quiz", "menu_book"] as const;

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isDueInFuture(iso: string): boolean {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
}

function getStudentAssignmentStatus(a: Assignment): AssignmentStatus {
  const sub = a.my_submission;
  if (!sub) return isDueInFuture(a.due_at) ? "pending" : "not_submitted";
  if (sub.is_graded) return "graded";
  return "submitted";
}

function getTeacherCardStatus(a: Assignment): TeacherCardStatus {
  const submitted = a.submitted_count ?? 0;
  const graded = a.graded_count ?? 0;
  if (submitted === 0) return "none";
  if (graded >= submitted) return "all_graded";
  return "partial";
}

function getStatusTheme(status: AssignmentStatus): StatusTheme {
  switch (status) {
    case "graded":
      return {
        accent: "border-l-[#22c55e]",
        iconBg: "bg-[#dcfce7]",
        iconColor: "text-[#16a34a]",
        badgeBg: "bg-[#dcfce7]",
        badgeText: "text-[#15803d]",
      };
    case "submitted":
      return {
        accent: "border-l-[#f97316]",
        iconBg: "bg-[#ffedd5]",
        iconColor: "text-[#ea580c]",
        badgeBg: "bg-[#ffedd5]",
        badgeText: "text-[#c2410c]",
      };
    case "pending":
      return {
        accent: "border-l-[#f97316]",
        iconBg: "bg-[#ffedd5]",
        iconColor: "text-[#ea580c]",
        badgeBg: "bg-[#ffedd5]",
        badgeText: "text-[#c2410c]",
      };
    case "not_submitted":
      return {
        accent: "border-l-[#3b82f6]",
        iconBg: "bg-[#dbeafe]",
        iconColor: "text-[#2563eb]",
        badgeBg: "bg-[#dbeafe]",
        badgeText: "text-[#1d4ed8]",
      };
  }
}

function getTeacherStatusTheme(status: TeacherCardStatus): StatusTheme {
  switch (status) {
    case "all_graded":
      return getStatusTheme("graded");
    case "partial":
      return getStatusTheme("submitted");
    case "none":
      return getStatusTheme("not_submitted");
  }
}

function studentStatusLabel(status: AssignmentStatus): string {
  switch (status) {
    case "graded":
      return "Graded";
    case "submitted":
      return "Submitted";
    case "pending":
      return "Pending";
    case "not_submitted":
      return "Not submitted";
  }
}

function computeStats(items: Assignment[], isTeacher: boolean): AssignmentStats {
  if (isTeacher) {
    return items.reduce(
      (acc, a) => {
        const submitted = a.submitted_count ?? 0;
        const graded = a.graded_count ?? 0;
        return {
          total: acc.total + 1,
          submitted: acc.submitted + submitted,
          pending: acc.pending + Math.max(0, submitted - graded),
          graded: acc.graded + graded,
        };
      },
      { total: 0, submitted: 0, pending: 0, graded: 0 },
    );
  }
  return items.reduce(
    (acc, a) => {
      const hasSubmission = !!a.my_submission;
      const isGraded = !!a.my_submission?.is_graded;
      return {
        total: acc.total + 1,
        submitted: acc.submitted + (hasSubmission ? 1 : 0),
        pending: acc.pending + (hasSubmission && !isGraded ? 1 : 0),
        graded: acc.graded + (isGraded ? 1 : 0),
      };
    },
    { total: 0, submitted: 0, pending: 0, graded: 0 },
  );
}

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

function MetricTile({
  label,
  value,
  icon,
  iconColor,
}: {
  label: string;
  value: number;
  icon: string;
  iconColor: string;
}) {
  return (
    <div className="rounded-xl border border-[#e1e3e4] bg-white px-4 py-4 shadow-xs">
      <div className="flex items-center justify-between">
        <span className={`material-symbols-outlined text-xl ${iconColor}`}>{icon}</span>
      </div>
      <p className="mt-2 font-display text-3xl font-extrabold text-[#031635]">{value}</p>
      <p className="mt-1 text-sm text-[#75777f]">{label}</p>
    </div>
  );
}

function AssignmentsHeader({
  isTeacher,
  showCreate,
  showCalendar,
  onToggleCreate,
  onToggleCalendar,
}: {
  isTeacher: boolean;
  showCreate: boolean;
  showCalendar: boolean;
  onToggleCreate: () => void;
  onToggleCalendar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e1e3e4] bg-white px-5 py-5 shadow-xs">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#ede9fe]">
          <span className="material-symbols-outlined text-2xl text-[#6366f1]">assignment</span>
        </div>
        <div>
          <h2 className="font-display text-xl font-extrabold text-[#031635]">Assignments</h2>
          <p className="mt-1 text-sm text-[#75777f]">
            {isTeacher
              ? "Create document assignments, review submissions, and grade."
              : "View assignments, upload your answers, and check grades."}
          </p>
        </div>
      </div>
      {isTeacher ? (
        <PrimaryButton onClick={onToggleCreate}>{showCreate ? "Cancel" : "New assignment"}</PrimaryButton>
      ) : (
        <button
          type="button"
          onClick={onToggleCalendar}
          className="inline-flex items-center gap-2 rounded-lg bg-[#6366f1] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#4f46e5]"
        >
          <span className="material-symbols-outlined text-base">calendar_month</span>
          {showCalendar ? "Hide Calendar" : "View Calendar"}
        </button>
      )}
    </div>
  );
}

function AssignmentCard({
  assignment,
  index,
  isTeacher,
  onOpen,
}: {
  assignment: Assignment;
  index: number;
  isTeacher: boolean;
  onOpen: (id: number) => void;
}) {
  const icon = CARD_ICONS[index % CARD_ICONS.length];
  const description =
    assignment.instructions?.trim() ||
    (assignment.file_name ? `Download and complete: ${assignment.file_name}` : "Open for full instructions.");

  if (isTeacher) {
    const teacherStatus = getTeacherCardStatus(assignment);
    const theme = getTeacherStatusTheme(teacherStatus);
    const submitted = assignment.submitted_count ?? 0;
    const graded = assignment.graded_count ?? 0;

    return (
      <li>
        <button
          type="button"
          onClick={() => onOpen(assignment.id)}
          className={`group flex w-full items-center gap-4 rounded-xl border border-[#e1e3e4] border-l-4 bg-white px-4 py-4 text-left shadow-xs transition hover:border-[#6366f1]/40 hover:shadow-md ${theme.accent}`}
        >
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${theme.iconBg}`}>
            <span className={`material-symbols-outlined text-xl ${theme.iconColor}`}>{icon}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[#031635]">{assignment.title}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#75777f]">
              <span className="inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">calendar_today</span>
                Due {formatDueDate(assignment.due_at)}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">close</span>
                Max {assignment.max_marks}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">group</span>
                {submitted} submitted · {graded} graded
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-[#44474e]">{description}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${theme.badgeBg} ${theme.badgeText}`}>
              {submitted === 0 ? "No submissions" : `${graded}/${submitted} graded`}
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border border-[#6366f1]/30 bg-[#ede9fe] px-3 py-1.5 text-xs font-semibold text-[#6366f1]">
              Review submissions
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </span>
          </div>
        </button>
      </li>
    );
  }

  const status = getStudentAssignmentStatus(assignment);
  const theme = getStatusTheme(status);
  const sub = assignment.my_submission;

  let ctaLabel = "Start Assignment";
  let ctaIcon = "upload";
  if (status === "graded") {
    ctaLabel = "View Feedback";
    ctaIcon = "rate_review";
  } else if (status === "submitted") {
    ctaLabel = "View submission";
    ctaIcon = "visibility";
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(assignment.id)}
        className={`group flex w-full items-center gap-4 rounded-xl border border-[#e1e3e4] border-l-4 bg-white px-4 py-4 text-left shadow-xs transition hover:border-[#6366f1]/40 hover:shadow-md ${theme.accent}`}
      >
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${theme.iconBg}`}>
          <span className={`material-symbols-outlined text-xl ${theme.iconColor}`}>{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[#031635]">{assignment.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#75777f]">
            <span className="inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">calendar_today</span>
              Due {formatDueDate(assignment.due_at)}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">close</span>
              Max {assignment.max_marks}
            </span>
            <span className={`inline-flex items-center gap-1 font-medium ${theme.badgeText}`}>
              <span className="material-symbols-outlined text-sm">
                {status === "graded" ? "grade" : status === "submitted" ? "check_circle" : "schedule"}
              </span>
              {studentStatusLabel(status)}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-[#44474e]">{description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {status === "graded" && sub ? (
            <div className="text-right">
              <p className="text-xs font-medium text-[#16a34a]">Grade</p>
              <p className="font-display text-xl font-extrabold text-[#15803d]">
                {sub.marks}/{assignment.max_marks}
              </p>
            </div>
          ) : (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${theme.badgeBg} ${theme.badgeText}`}>
              {studentStatusLabel(status)}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              status === "graded"
                ? "border border-[#6366f1]/30 bg-white text-[#6366f1]"
                : "border border-[#6366f1] bg-[#6366f1] text-white"
            }`}
          >
            <span className="material-symbols-outlined text-sm">{ctaIcon}</span>
            {ctaLabel}
            <span className="material-symbols-outlined text-sm">chevron_right</span>
          </span>
        </div>
      </button>
    </li>
  );
}

export function ClassroomAssignmentsTab() {
  const { classroom } = useOutletContext<OutletCtx>();
  const { classroomId } = useParams();
  const [searchParams] = useSearchParams();
  const id = Number(classroomId);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
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

  const assignmentList = assignments.data ?? [];

  const stats = useMemo(
    () => computeStats(assignmentList, isTeacher),
    [assignmentList, isTeacher],
  );

  useEffect(() => {
    const raw = searchParams.get("assignment");
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) setSelectedId(parsed);
  }, [searchParams]);

  const selected = useMemo(
    () => assignmentList.find((a) => a.id === selectedId) ?? null,
    [assignmentList, selectedId],
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

  function openAssignment(assignmentId: number) {
    setError(null);
    setSelectedId(assignmentId);
    setShowCalendar(false);
  }

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
            <h2 className="mt-3 font-display text-xl text-[#031635]">{active.title}</h2>
            <p className="mt-1 text-sm text-[#75777f]">
              Due {formatDueDate(active.due_at)} · Max {active.max_marks} marks
              {isTeacher ? ` · ${statusLabel(active, true)}` : ` · ${statusLabel(active, false)}`}
            </p>
          </div>
        </div>

        <ErrorText message={error} />

        {active.instructions ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-[#75777f]">
              Instructions
            </h3>
            <p className="whitespace-pre-wrap text-sm text-[#031635]">{active.instructions}</p>
          </div>
        ) : null}

        {promptUrl && active.file_name ? (
          <a
            href={promptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-sm font-semibold text-[#6366f1] hover:underline"
          >
            Download assignment file: {active.file_name}
          </a>
        ) : null}

        {isStudent ? (
          <div className="space-y-4 border-t border-[#e1e3e4] pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#75777f]">Your submission</h3>
            {mySub ? (
              <div className="rounded-xl border border-[#e1e3e4] px-3 py-3 text-sm">
                <p className="text-[#031635]">
                  {mySub.file_name}
                  {mySub.is_late ? <span className="ml-2 text-[#6366f1]">Late</span> : null}
                </p>
                <p className="text-xs text-[#75777f]">Submitted {new Date(mySub.submitted_at).toLocaleString()}</p>
                {uploadFileUrl(mySub.file_path) ? (
                  <a
                    href={uploadFileUrl(mySub.file_path)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex text-[#6366f1] hover:underline"
                  >
                    View uploaded file
                  </a>
                ) : null}
                {mySub.is_graded ? (
                  <div className="mt-3 rounded-xl border border-[#22c55e]/30 bg-[#dcfce7] px-3 py-2">
                    <p className="font-semibold text-[#15803d]">
                      Grade: {mySub.marks} / {active.max_marks}
                    </p>
                    {mySub.feedback ? <p className="mt-1 text-[#44474e]">{mySub.feedback}</p> : null}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[#75777f]">You can replace this file until it is graded.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-[#75777f]">No submission yet.</p>
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
          <div className="space-y-4 border-t border-[#e1e3e4] pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#75777f]">Submissions</h3>
            {!submissions.data?.length ? (
              <p className="text-sm text-[#75777f]">No submissions yet.</p>
            ) : (
              <ul className="space-y-3">
                {submissions.data.map((sub) => {
                  const fileHref = uploadFileUrl(sub.file_path);
                  const isEditing = gradingStudentId === sub.student_id;
                  return (
                    <li key={sub.id} className="rounded-xl border border-[#e1e3e4] px-3 py-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-[#031635]">
                            {sub.student_full_name ?? `Student ${sub.student_id}`}
                            {sub.is_late ? <span className="ml-2 text-[#6366f1]">Late</span> : null}
                          </p>
                          <p className="text-xs text-[#75777f]">
                            {sub.student_email}
                            {" · "}
                            {new Date(sub.submitted_at).toLocaleString()}
                          </p>
                          {fileHref ? (
                            <a
                              href={fileHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex text-[#6366f1] hover:underline"
                            >
                              {sub.file_name}
                            </a>
                          ) : null}
                          {sub.is_graded ? (
                            <p className="mt-2 text-[#031635]">
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
                        <form className="mt-3 grid gap-3 border-t border-[#e1e3e4] pt-3" onSubmit={onGrade}>
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
      <AssignmentsHeader
        isTeacher={isTeacher}
        showCreate={showCreate}
        showCalendar={showCalendar}
        onToggleCreate={() => setShowCreate((v) => !v)}
        onToggleCalendar={() => setShowCalendar((v) => !v)}
      />

      <ErrorText message={error} />

      {isTeacher && showCreate ? (
        <form className="grid gap-3 rounded-2xl border border-[#e1e3e4] bg-white p-4 shadow-xs" onSubmit={onCreate}>
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

      {!isTeacher && showCalendar ? (
        <AssignmentsCalendar
          items={assignmentList}
          onSelect={openAssignment}
          onClose={() => setShowCalendar(false)}
        />
      ) : null}

      {assignments.isLoading ? <p className="text-sm text-[#75777f]">Loading assignments…</p> : null}
      {assignments.isError ? <ErrorText message="Failed to load assignments." /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Total Assignments" value={stats.total} icon="assignment" iconColor="text-[#6366f1]" />
        <MetricTile label="Submitted" value={stats.submitted} icon="check_circle" iconColor="text-[#16a34a]" />
        <MetricTile label="Pending" value={stats.pending} icon="schedule" iconColor="text-[#ea580c]" />
        <MetricTile label="Graded" value={stats.graded} icon="grade" iconColor="text-[#2563eb]" />
      </div>

      {!assignmentList.length && !assignments.isLoading ? (
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
          {assignmentList.map((a, index) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              index={index}
              isTeacher={isTeacher}
              onOpen={openAssignment}
            />
          ))}
        </ul>
      )}

      {assignmentList.length ? (
        <p className="flex items-center justify-center gap-2 text-center text-sm text-[#75777f]">
          <span className="material-symbols-outlined text-base">lightbulb</span>
          Tip: Click on an assignment to view instructions and details.
        </p>
      ) : null}
    </div>
  );
}
