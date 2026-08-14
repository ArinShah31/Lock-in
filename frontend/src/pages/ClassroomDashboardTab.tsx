import { useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignmentsApi,
  classroomsApi,
  codingPlatformApi,
  contentsApi,
  courseBuilderApi,
} from "../api";
import type { Assignment, Classroom, ClassroomAnnouncement } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { TeacherCodingAnalyticsPanel } from "../components/TeacherCodingAnalyticsPanel";
import {
  EmptyState,
  ErrorText,
  GhostButton,
  Panel,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";

type OutletCtx = { classroom: Classroom };

type AssignmentStatus = "graded" | "submitted" | "pending" | "not_submitted";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
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

function statusTheme(status: AssignmentStatus) {
  switch (status) {
    case "graded":
      return {
        accent: "border-l-[#22c55e]",
        badge: "bg-[#dcfce7] text-[#15803d]",
        label: "Graded",
      };
    case "submitted":
      return {
        accent: "border-l-[#f97316]",
        badge: "bg-[#ffedd5] text-[#c2410c]",
        label: "Submitted",
      };
    case "pending":
      return {
        accent: "border-l-[#f97316]",
        badge: "bg-[#ffedd5] text-[#c2410c]",
        label: "Pending",
      };
    case "not_submitted":
      return {
        accent: "border-l-[#3b82f6]",
        badge: "bg-[#dbeafe] text-[#1d4ed8]",
        label: "Not submitted",
      };
  }
}

function MetricTile({
  label,
  value,
  hint,
  icon,
  iconColor = "text-[#6366f1]",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: string;
  iconColor?: string;
}) {
  return (
    <div className="rounded-xl border border-[#e1e3e4] bg-white px-4 py-4 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-[#75777f]">{label}</span>
        <span className={`material-symbols-outlined text-xl ${iconColor}`}>{icon}</span>
      </div>
      <p className="mt-2 font-display text-3xl font-extrabold text-[#031635]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[#75777f]">{hint}</p> : null}
    </div>
  );
}

function QuickLink({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between rounded-xl border border-[#e1e3e4] bg-white px-3.5 py-3 text-left shadow-xs transition hover:border-[#6366f1]/40 hover:shadow-md"
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-[#031635]">
        <span className="material-symbols-outlined text-base text-[#6366f1]">{icon}</span>
        {label}
      </span>
      <span className="material-symbols-outlined text-sm text-[#6366f1]">chevron_right</span>
    </button>
  );
}

function ClassroomOverviewCard({
  classroom,
  isOwner,
  yearLabel,
  copied,
  onCopyJoinCode,
  onOpenCourse,
  onOpenAssignments,
  onManageDetails,
  onOpenCourseBuilder,
}: {
  classroom: Classroom;
  isOwner: boolean;
  yearLabel: string;
  copied: boolean;
  onCopyJoinCode: () => void;
  onOpenCourse: () => void;
  onOpenAssignments: () => void;
  onManageDetails: () => void;
  onOpenCourseBuilder: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[#e1e3e4] bg-white p-5 shadow-xs">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#ede9fe] px-3 py-1 text-xs font-semibold text-[#6366f1]">
            <span className="material-symbols-outlined text-sm">grid_view</span>
            <span>{isOwner ? "Classroom Command Center" : "Classroom Overview"}</span>
          </div>
          <h2 className="font-display text-2xl font-extrabold text-[#031635]">{classroom.name}</h2>
          <p className="mt-1 text-sm text-[#44474e]">
            {classroom.code}
            {" · "}
            {yearLabel}
            {" · "}
            <span
              className={
                classroom.is_active ? "font-semibold text-[#16a34a]" : "font-semibold text-[#dc2626]"
              }
            >
              {classroom.is_active ? "Active" : "Inactive"}
            </span>
          </p>
          {classroom.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-[#75777f]">{classroom.description}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {isOwner ? (
            <>
              <PrimaryButton onClick={onCopyJoinCode}>{copied ? "Copied!" : "Copy join code"}</PrimaryButton>
              <SecondaryButton onClick={onManageDetails}>Manage details</SecondaryButton>
              <GhostButton onClick={onOpenCourseBuilder}>Course builder</GhostButton>
            </>
          ) : (
            <>
              <PrimaryButton onClick={onOpenCourse}>Open course</PrimaryButton>
              <SecondaryButton onClick={onOpenAssignments}>Assignments</SecondaryButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RecentAnnouncements({ items }: { items: ClassroomAnnouncement[] }) {
  if (!items.length) {
    return (
      <EmptyState title="No announcements yet" body="Classroom announcements will show up here." />
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li
          key={a.id}
          className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-3.5 py-2.5 transition hover:border-[#6366f1]/30 hover:bg-white"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-[#031635]">{a.title}</p>
            <span className="shrink-0 text-[11px] text-[#75777f]">{formatDate(a.created_at)}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-[#44474e]">{a.body}</p>
        </li>
      ))}
    </ul>
  );
}

function RecentAssignmentRow({
  assignment,
  isOwner,
  onOpen,
}: {
  assignment: Assignment;
  isOwner: boolean;
  onOpen: (assignmentId: number) => void;
}) {
  const submitted = assignment.submitted_count ?? 0;
  const graded = assignment.graded_count ?? 0;
  const studentStatus = getStudentAssignmentStatus(assignment);
  const theme = statusTheme(studentStatus);
  const sub = assignment.my_submission;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(assignment.id)}
        className={`group flex w-full items-center justify-between gap-3 rounded-xl border border-[#e1e3e4] border-l-4 bg-white px-4 py-3 text-left shadow-xs transition hover:border-[#6366f1]/40 hover:shadow-md ${theme.accent}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-[#031635]">{assignment.title}</p>
            {!isOwner ? (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${theme.badge}`}>
                {theme.label}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-[#75777f]">
            {isOwner
              ? `${submitted} submitted · ${graded} graded`
              : sub?.is_graded
                ? `Grade ${sub.marks}/${assignment.max_marks}`
                : `Max ${assignment.max_marks} marks`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-[#75777f]">
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">calendar_today</span>
            Due {formatDate(assignment.due_at)}
          </span>
          <span className="material-symbols-outlined text-sm text-[#6366f1] opacity-0 transition group-hover:opacity-100">
            chevron_right
          </span>
        </div>
      </button>
    </li>
  );
}

function RecentAssignments({
  items,
  isOwner,
  onOpen,
  onViewAll,
}: {
  items: Assignment[];
  isOwner: boolean;
  onOpen: (assignmentId: number) => void;
  onViewAll: () => void;
}) {
  return (
    <Panel className="p-0">
      <div className="flex items-center justify-between border-b border-[#e1e3e4] px-5 py-4">
        <h3 className="font-display text-lg font-bold text-[#031635]">Recent assignments</h3>
        <button
          type="button"
          onClick={onViewAll}
          className="text-xs font-semibold text-[#6366f1] hover:underline"
        >
          All assignments →
        </button>
      </div>
      <div className="px-5 py-4">
        {!items.length ? (
          <EmptyState
            title="No assignments yet"
            body={
              isOwner
                ? "Create an assignment to track student work from this classroom."
                : "Assignments for this classroom will appear here."
            }
          />
        ) : (
          <ul className="space-y-2">
            {items.map((a) => (
              <RecentAssignmentRow
                key={a.id}
                assignment={a}
                isOwner={isOwner}
                onOpen={onOpen}
              />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function JoinCodeCard({
  joinCode,
  copied,
  onCopy,
}: {
  joinCode: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[#e0e7ff] bg-[#f5f3ff] px-5 py-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6366f1]">
            Student join code
          </p>
          <p className="mt-1 font-mono text-2xl font-extrabold tracking-[0.3em] text-[#031635]">
            {joinCode}
          </p>
          <p className="mt-1 text-xs text-[#75777f]">Share this code so students can request to join.</p>
        </div>
        <SecondaryButton onClick={onCopy}>{copied ? "Copied" : "Copy code"}</SecondaryButton>
      </div>
    </div>
  );
}

function NeedsAttentionPanel({
  items,
  isLoading,
  onApprove,
  onReject,
  onViewAll,
  isPending,
}: {
  items: { id: number; student_id: number; student_full_name?: string | null; student_email?: string | null }[];
  isLoading: boolean;
  onApprove: (studentId: number) => void;
  onReject: (studentId: number) => void;
  onViewAll: () => void;
  isPending: boolean;
}) {
  return (
    <Panel className="p-0">
      <div className="flex items-center justify-between border-b border-[#e1e3e4] px-5 py-4">
        <div>
          <h3 className="font-display text-lg font-bold text-[#031635]">Needs attention</h3>
          <p className="mt-0.5 text-xs text-[#75777f]">Pending student join requests</p>
        </div>
        {items.length ? (
          <button
            type="button"
            onClick={onViewAll}
            className="text-xs font-semibold text-[#6366f1] hover:underline"
          >
            View all in Details →
          </button>
        ) : null}
      </div>
      <div className="px-5 py-4">
        {isLoading ? (
          <p className="text-sm text-[#75777f]">Loading join requests…</p>
        ) : !items.length ? (
          <EmptyState
            title="All caught up"
            body="No pending join requests. New student requests will appear here for quick approval."
          />
        ) : (
          <ul className="space-y-2">
            {items.map((r) => (
              <li
                key={r.id}
                className="flex flex-col justify-between gap-3 rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 sm:flex-row sm:items-center"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ffedd5]">
                    <span className="material-symbols-outlined text-lg text-[#ea580c]">person</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#031635]">
                      {r.student_full_name ?? `Student ${r.student_id}`}
                    </p>
                    <p className="text-xs text-[#75777f]">{r.student_email}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <PrimaryButton onClick={() => onApprove(r.student_id)} disabled={isPending}>
                    Approve
                  </PrimaryButton>
                  <GhostButton onClick={() => onReject(r.student_id)} disabled={isPending}>
                    Reject
                  </GhostButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

export function ClassroomDashboardTab() {
  const { classroom } = useOutletContext<OutletCtx>();
  const { classroomId } = useParams();
  const id = Number(classroomId);
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isStudent = user?.role === "STUDENT";
  const isOwner =
    !!user &&
    (user.role === "CLASS_TEACHER" || user.role === "SUBJECT_TEACHER") &&
    user.id === classroom.class_teacher_id;

  const students = useQuery({
    queryKey: ["classroom-students", id],
    queryFn: () => classroomsApi.listStudents(id),
    enabled: !isStudent && !Number.isNaN(id),
  });
  const joinRequests = useQuery({
    queryKey: ["classroom-join-requests", id],
    queryFn: () => classroomsApi.listJoinRequests(id),
    enabled: isOwner && !Number.isNaN(id),
  });
  const announcements = useQuery({
    queryKey: ["classroom-announcements", id],
    queryFn: () => classroomsApi.listAnnouncements(id),
    enabled: isOwner && !Number.isNaN(id),
  });
  const assignments = useQuery({
    queryKey: ["assignments", id],
    queryFn: () => assignmentsApi.listByClassroom(id),
    enabled: !Number.isNaN(id),
  });
  const documents = useQuery({
    queryKey: ["documents", id],
    queryFn: () => contentsApi.listByClassroom(id),
    enabled: !Number.isNaN(id),
  });
  const course = useQuery({
    queryKey: ["classroom-course", id],
    queryFn: () => courseBuilderApi.get(id),
    enabled: !Number.isNaN(id),
  });
  const codingAccess = useQuery({
    queryKey: ["coding-access"],
    queryFn: codingPlatformApi.access,
    enabled: isOwner,
    staleTime: 30_000,
  });

  const classroomStudentEmails = useMemo(
    () =>
      (students.data || [])
        .map((s) => (s.student_email || "").trim())
        .filter(Boolean),
    [students.data],
  );
  const codingEnabled = codingAccess.data?.enabled === true;

  const approveJoin = useMutation({
    mutationFn: (studentId: number) => classroomsApi.approveJoin(id, studentId),
    onSuccess: async () => {
      setError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["classroom-join-requests", id] }),
        qc.invalidateQueries({ queryKey: ["classroom-students", id] }),
      ]);
    },
    onError: (err: Error) => setError(err.message),
  });

  const rejectJoin = useMutation({
    mutationFn: (studentId: number) => classroomsApi.rejectJoin(id, studentId),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["classroom-join-requests", id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const enrolledCount = students.data?.length ?? 0;
  const pendingCount = joinRequests.data?.length ?? 0;
  const assignmentCount = assignments.data?.length ?? 0;
  const documentCount = documents.data?.length ?? 0;
  const coursePublished = course.data?.is_published === true;
  const courseStatusLabel = course.isLoading ? "…" : coursePublished ? "Published" : "Draft";

  const recentAnnouncements = useMemo(
    () => [...(announcements.data ?? [])].slice(0, 3),
    [announcements.data],
  );
  const recentAssignments = useMemo(
    () => [...(assignments.data ?? [])].slice(0, 4),
    [assignments.data],
  );

  async function copyJoinCode() {
    try {
      await navigator.clipboard.writeText(classroom.join_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy join code");
    }
  }

  function openAssignment(assignmentId: number) {
    navigate(`/classrooms/${id}/assignments?assignment=${assignmentId}`);
  }

  const yearLabel = classroom.academic_year || "No year set";
  const joinPending = approveJoin.isPending || rejectJoin.isPending;

  return (
    <div className="space-y-6">
      <ErrorText message={error} />

      <ClassroomOverviewCard
        classroom={classroom}
        isOwner={isOwner}
        yearLabel={yearLabel}
        copied={copied}
        onCopyJoinCode={() => void copyJoinCode()}
        onOpenCourse={() => navigate(`/classrooms/${id}/course-builder`)}
        onOpenAssignments={() => navigate(`/classrooms/${id}/assignments`)}
        onManageDetails={() => navigate(`/classrooms/${id}/details`)}
        onOpenCourseBuilder={() => navigate(`/classrooms/${id}/course-builder`)}
      />

      {isOwner ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label="Students"
            value={students.isLoading ? "…" : enrolledCount}
            hint="Approved enrollments"
            icon="group"
          />
          <MetricTile
            label="Pending joins"
            value={joinRequests.isLoading ? "…" : pendingCount}
            hint="Awaiting approval"
            icon="person_add"
            iconColor="text-[#ea580c]"
          />
          <MetricTile
            label="Assignments"
            value={assignments.isLoading ? "…" : assignmentCount}
            hint="In this classroom"
            icon="assignment"
          />
          <MetricTile
            label="Course"
            value={courseStatusLabel}
            hint={documents.isLoading ? "…" : `${documentCount} shared material${documentCount === 1 ? "" : "s"}`}
            icon="menu_book"
            iconColor={coursePublished ? "text-[#16a34a]" : "text-[#75777f]"}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile
            label="Assignments"
            value={assignments.isLoading ? "…" : assignmentCount}
            hint="In this classroom"
            icon="assignment"
          />
          <MetricTile
            label="Documents"
            value={documents.isLoading ? "…" : documentCount}
            hint="Shared materials"
            icon="folder"
          />
          <MetricTile
            label="Course"
            value={courseStatusLabel}
            hint={coursePublished ? "Ready to learn" : "Not published yet"}
            icon="menu_book"
            iconColor={coursePublished ? "text-[#16a34a]" : "text-[#75777f]"}
          />
        </div>
      )}

      {isOwner ? (
        <JoinCodeCard joinCode={classroom.join_code} copied={copied} onCopy={() => void copyJoinCode()} />
      ) : null}

      {isOwner ? (
        students.isLoading ? (
          <Panel>
            <h3 className="font-display text-lg font-bold text-[#031635]">Coding insights</h3>
            <p className="mt-2 text-sm text-[#75777f]">Loading classroom students…</p>
          </Panel>
        ) : (
          <TeacherCodingAnalyticsPanel
            enabled={codingEnabled}
            studentEmails={classroomStudentEmails}
            scopeLabel={classroom.name}
          />
        )
      ) : null}

      {isOwner ? (
        <NeedsAttentionPanel
          items={joinRequests.data ?? []}
          isLoading={joinRequests.isLoading}
          onApprove={(studentId) => approveJoin.mutate(studentId)}
          onReject={(studentId) => rejectJoin.mutate(studentId)}
          onViewAll={() => navigate(`/classrooms/${id}/details`)}
          isPending={joinPending}
        />
      ) : null}

      {isOwner ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel className="p-0">
            <div className="flex items-center justify-between border-b border-[#e1e3e4] px-5 py-4">
              <h3 className="font-display text-lg font-bold text-[#031635]">Recent announcements</h3>
              <button
                type="button"
                onClick={() => navigate(`/classrooms/${id}/announcements`)}
                className="text-xs font-semibold text-[#6366f1] hover:underline"
              >
                Announcements →
              </button>
            </div>
            <div className="px-5 py-4">
              {announcements.isLoading ? (
                <p className="text-sm text-[#75777f]">Loading announcements…</p>
              ) : (
                <RecentAnnouncements items={recentAnnouncements} />
              )}
            </div>
          </Panel>

          {assignments.isLoading ? (
            <Panel>
              <p className="text-sm text-[#75777f]">Loading assignments…</p>
            </Panel>
          ) : (
            <RecentAssignments
              items={recentAssignments}
              isOwner={isOwner}
              onOpen={openAssignment}
              onViewAll={() => navigate(`/classrooms/${id}/assignments`)}
            />
          )}
        </div>
      ) : (
        <>
          {assignments.isLoading ? (
            <Panel>
              <p className="text-sm text-[#75777f]">Loading assignments…</p>
            </Panel>
          ) : (
            <RecentAssignments
              items={recentAssignments}
              isOwner={isOwner}
              onOpen={openAssignment}
              onViewAll={() => navigate(`/classrooms/${id}/assignments`)}
            />
          )}
        </>
      )}

      {isOwner ? (
        <div>
          <h3 className="mb-3 font-display text-lg font-bold text-[#031635]">Quick links</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <QuickLink label="Details" icon="info" onClick={() => navigate(`/classrooms/${id}/details`)} />
            <QuickLink
              label="Course builder"
              icon="menu_book"
              onClick={() => navigate(`/classrooms/${id}/course-builder`)}
            />
            <QuickLink label="Documents" icon="folder" onClick={() => navigate(`/classrooms/${id}/documents`)} />
            <QuickLink label="Assignments" icon="assignment" onClick={() => navigate(`/classrooms/${id}/assignments`)} />
            <QuickLink
              label="Announcements"
              icon="campaign"
              onClick={() => navigate(`/classrooms/${id}/announcements`)}
            />
            <QuickLink label="Analytics" icon="analytics" onClick={() => navigate(`/classrooms/${id}/analytics`)} />
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-[#e1e3e4] bg-white px-4 py-3.5 shadow-xs">
          <span className="material-symbols-outlined mt-0.5 text-[#6366f1]">auto_awesome</span>
          <p className="text-sm text-[#44474e]">
            <span className="font-semibold text-[#031635]">Tip </span>
            Open the course to study chapters, or check Assignments for due work and grades.
          </p>
        </div>
      )}
    </div>
  );
}
