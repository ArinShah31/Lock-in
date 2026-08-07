import { useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignmentsApi,
  classroomsApi,
  contentsApi,
  courseBuilderApi,
} from "../api";
import type { Assignment, Classroom, ClassroomAnnouncement } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import {
  EmptyState,
  ErrorText,
  GhostButton,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";

type OutletCtx = { classroom: Classroom };

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function MetricTile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: string;
}) {
  return (
    <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">{label}</span>
        <span className="material-symbols-outlined text-[#3f5d9b] text-base">{icon}</span>
      </div>
      <p className="font-display text-3xl font-extrabold text-[#031635] mt-2">{value}</p>
      {hint ? <p className="text-xs text-[#75777f] mt-1">{hint}</p> : null}
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
      className="flex items-center justify-between rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-3.5 py-3 text-left transition hover:border-[#031635] hover:shadow-xs"
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-[#031635]">
        <span className="material-symbols-outlined text-base text-[#3f5d9b]">{icon}</span>
        {label}
      </span>
      <span className="material-symbols-outlined text-sm text-[#3f5d9b]">chevron_right</span>
    </button>
  );
}

function RecentAnnouncements({ items }: { items: ClassroomAnnouncement[] }) {
  if (!items.length) {
    return <EmptyState title="No announcements yet" body="Classroom announcements will show up here." />;
  }
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-3.5 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-semibold text-[#031635] text-sm">{a.title}</p>
            <span className="text-[11px] text-[#75777f] shrink-0">{formatDate(a.created_at)}</span>
          </div>
          <p className="text-sm text-[#44474e] mt-0.5 line-clamp-2">{a.body}</p>
        </li>
      ))}
    </ul>
  );
}

function RecentAssignments({
  items,
  isOwner,
  onOpen,
}: {
  items: Assignment[];
  isOwner: boolean;
  onOpen: (assignmentId: number) => void;
}) {
  if (!items.length) {
    return (
      <EmptyState
        title="No assignments yet"
        body={isOwner ? "Create an assignment to track student work from this classroom." : "Assignments for this classroom will appear here."}
      />
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((a) => {
        const submitted = a.submitted_count ?? 0;
        const graded = a.graded_count ?? 0;
        const studentStatus = a.my_submission
          ? a.my_submission.is_graded
            ? `Graded · ${a.my_submission.marks}/${a.max_marks}`
            : a.my_submission.is_late
              ? "Submitted (late)"
              : "Submitted"
          : "Not submitted";
        return (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onOpen(a.id)}
              className="w-full rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-3.5 py-2.5 text-left transition hover:border-[#031635]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-[#031635] text-sm">{a.title}</p>
                <span className="text-[11px] text-[#75777f] shrink-0">Due {formatDate(a.due_at)}</span>
              </div>
              <p className="text-xs text-[#44474e] mt-0.5">
                {isOwner ? `${submitted} submitted · ${graded} graded` : studentStatus}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
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
    enabled: !Number.isNaN(id),
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
  const courseStatusLabel = course.isLoading
    ? "…"
    : coursePublished
      ? "Published"
      : "Draft";

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

  return (
    <div className="space-y-6">
      <ErrorText message={error} />

      {/* Banner */}
      <div className="rounded-xl border border-[#e1e3e4] bg-white p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#e8edf5] text-[#031635] text-xs font-semibold mb-2">
            <span className="material-symbols-outlined text-sm">dashboard</span>
            <span>{isOwner ? "Classroom Command Center" : "Classroom Overview"}</span>
          </div>
          <h2 className="font-display text-2xl font-extrabold text-[#031635]">{classroom.name}</h2>
          <p className="text-sm text-[#44474e] mt-1">
            {classroom.code}
            {" · "}
            {yearLabel}
            {" · "}
            <span className={classroom.is_active ? "text-[#2f6b4f] font-semibold" : "text-[#ba1a1a] font-semibold"}>
              {classroom.is_active ? "Active" : "Inactive"}
            </span>
          </p>
          {classroom.description ? (
            <p className="text-sm text-[#75777f] mt-2 line-clamp-2">{classroom.description}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {isOwner ? (
            <>
              <PrimaryButton onClick={() => void copyJoinCode()}>
                {copied ? "Copied!" : "Copy join code"}
              </PrimaryButton>
              <SecondaryButton onClick={() => navigate(`/classrooms/${id}/details`)}>
                Manage details
              </SecondaryButton>
              <GhostButton onClick={() => navigate(`/classrooms/${id}/course-builder`)}>
                Course builder
              </GhostButton>
            </>
          ) : (
            <>
              <PrimaryButton onClick={() => navigate(`/classrooms/${id}/course-builder`)}>
                Open course
              </PrimaryButton>
              <SecondaryButton onClick={() => navigate(`/classrooms/${id}/assignments`)}>
                Assignments
              </SecondaryButton>
            </>
          )}
        </div>
      </div>

      {/* Metrics */}
      {isOwner ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label="Students" value={students.isLoading ? "…" : enrolledCount} hint="Approved enrollments" icon="group" />
          <MetricTile label="Pending joins" value={joinRequests.isLoading ? "…" : pendingCount} hint="Awaiting approval" icon="person_add" />
          <MetricTile label="Assignments" value={assignments.isLoading ? "…" : assignmentCount} hint="Active assignments" icon="assignment" />
          <MetricTile
            label="Course"
            value={courseStatusLabel}
            hint={documents.isLoading ? "…" : `${documentCount} document${documentCount === 1 ? "" : "s"}`}
            icon="menu_book"
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile label="Assignments" value={assignments.isLoading ? "…" : assignmentCount} hint="In this classroom" icon="assignment" />
          <MetricTile label="Documents" value={documents.isLoading ? "…" : documentCount} hint="Shared materials" icon="folder" />
          <MetricTile label="Course" value={courseStatusLabel} hint={coursePublished ? "Ready to learn" : "Not published yet"} icon="menu_book" />
        </div>
      )}

      {/* Join code (owner) */}
      {isOwner ? (
        <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-4 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Student join code</p>
            <p className="mt-1 font-display text-2xl tracking-[0.3em] font-extrabold text-[#031635] font-mono">
              {classroom.join_code}
            </p>
            <p className="text-xs text-[#75777f] mt-1">Share this code so students can request to join.</p>
          </div>
          <SecondaryButton onClick={() => void copyJoinCode()}>
            {copied ? "Copied" : "Copy code"}
          </SecondaryButton>
        </div>
      ) : null}

      {/* Needs attention (owner) */}
      {isOwner ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-bold text-[#031635] text-lg">Needs attention</h3>
            {pendingCount > 0 ? (
              <button
                type="button"
                onClick={() => navigate(`/classrooms/${id}/details`)}
                className="text-xs font-semibold text-[#3f5d9b] hover:underline"
              >
                View all in Details →
              </button>
            ) : null}
          </div>
          {joinRequests.isLoading ? (
            <p className="text-sm text-[#75777f]">Loading join requests…</p>
          ) : !joinRequests.data?.length ? (
            <EmptyState
              title="All caught up"
              body="No pending join requests. New student requests will appear here for quick approval."
            />
          ) : (
            <ul className="space-y-2">
              {joinRequests.data.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-3.5 py-2.5"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#031635]">
                      {r.student_full_name ?? `Student ${r.student_id}`}
                    </p>
                    <p className="text-xs text-[#75777f]">{r.student_email}</p>
                  </div>
                  <div className="flex gap-2">
                    <PrimaryButton
                      onClick={() => approveJoin.mutate(r.student_id)}
                      disabled={approveJoin.isPending || rejectJoin.isPending}
                    >
                      Approve
                    </PrimaryButton>
                    <GhostButton
                      onClick={() => rejectJoin.mutate(r.student_id)}
                      disabled={approveJoin.isPending || rejectJoin.isPending}
                    >
                      Reject
                    </GhostButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* Recent activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-bold text-[#031635] text-lg">Recent announcements</h3>
            <button
              type="button"
              onClick={() => navigate(`/classrooms/${id}/details`)}
              className="text-xs font-semibold text-[#3f5d9b] hover:underline"
            >
              Details →
            </button>
          </div>
          {announcements.isLoading ? (
            <p className="text-sm text-[#75777f]">Loading announcements…</p>
          ) : (
            <RecentAnnouncements items={recentAnnouncements} />
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-bold text-[#031635] text-lg">Recent assignments</h3>
            <button
              type="button"
              onClick={() => navigate(`/classrooms/${id}/assignments`)}
              className="text-xs font-semibold text-[#3f5d9b] hover:underline"
            >
              All assignments →
            </button>
          </div>
          {assignments.isLoading ? (
            <p className="text-sm text-[#75777f]">Loading assignments…</p>
          ) : (
            <RecentAssignments items={recentAssignments} isOwner={isOwner} onOpen={openAssignment} />
          )}
        </div>
      </div>

      {/* Quick links */}
      <div>
        <h3 className="font-display font-bold text-[#031635] text-lg mb-3">Quick links</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <QuickLink
            label="Details"
            icon="info"
            onClick={() => navigate(`/classrooms/${id}/details`)}
          />
          <QuickLink
            label={isStudent ? "Course" : "Course builder"}
            icon="menu_book"
            onClick={() => navigate(`/classrooms/${id}/course-builder`)}
          />
          <QuickLink
            label="Documents"
            icon="folder"
            onClick={() => navigate(`/classrooms/${id}/documents`)}
          />
          <QuickLink
            label="Assignments"
            icon="assignment"
            onClick={() => navigate(`/classrooms/${id}/assignments`)}
          />
          {isOwner ? (
            <QuickLink
              label="Analytics"
              icon="analytics"
              onClick={() => navigate(`/classrooms/${id}/analytics`)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
