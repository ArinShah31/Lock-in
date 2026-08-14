import { FormEvent, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assignmentsApi, classroomsApi } from "../api";
import type { Classroom, ClassroomStudent, StudentAssignmentFeedItem } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { AssignmentsCalendar } from "../components/AssignmentsCalendar";
import {
  EmptyState,
  ErrorText,
  inputClass,
  Panel,
  PrimaryButton,
} from "../components/ui";

type LocationState = {
  success?: string;
};

const UPCOMING_WINDOW_DAYS = 14;
const PENDING_PREVIEW = 3;
const CLASSROOM_PREVIEW = 4;

function formatDueAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDueRelative(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = d.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return diffMs < 0 ? `${mins}m overdue` : `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return diffMs < 0 ? `${hours}h overdue` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return diffMs < 0 ? `${days}d overdue` : `in ${days}d`;
}

function formatRequestDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function classroomInitials(code: string, name: string): string {
  const fromCode = code.replace(/[^A-Za-z0-9]/g, "");
  if (fromCode.length >= 2) return fromCode.slice(0, 2).toUpperCase();
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (name.slice(0, 2) || "CL").toUpperCase();
}

function WorkspaceHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#ede9fe]">
        <span className="material-symbols-outlined text-2xl text-[#6366f1]">cottage</span>
      </div>
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-[#031635] md:text-3xl">
          Classrooms Workspace
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[#75777f]">{subtitle}</p>
      </div>
    </div>
  );
}

function FooterTip({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#e1e3e4] bg-white px-4 py-3.5 shadow-xs">
      <span className="material-symbols-outlined mt-0.5 text-[#6366f1]">auto_awesome</span>
      <p className="text-sm text-[#44474e]">
        <span className="font-semibold text-[#031635]">Tip </span>
        {message}
      </p>
    </div>
  );
}

function OverdueAssignmentRow({
  item,
  onOpen,
}: {
  item: StudentAssignmentFeedItem;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative w-full rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-3 text-left transition hover:border-[#f87171] hover:bg-white"
    >
      <span className="absolute right-3 top-3 rounded-full bg-[#fee2e2] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#dc2626]">
        Overdue
      </span>
      <div className="flex items-start gap-3 pr-16">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#fee2e2]">
          <span className="material-symbols-outlined text-lg text-[#dc2626]">description</span>
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-[#031635]">{item.title}</p>
          <p className="mt-0.5 text-xs text-[#44474e]">{item.classroom_name}</p>
          <p className="mt-1 text-xs font-medium text-[#dc2626]">
            {formatDueRelative(item.due_at)} · {formatDueAbsolute(item.due_at)}
          </p>
        </div>
      </div>
    </button>
  );
}

function AssignmentRow({
  item,
  chip,
  chipClass,
  cardClass,
  icon,
  iconClass,
  onOpen,
}: {
  item: StudentAssignmentFeedItem;
  chip: string;
  chipClass: string;
  cardClass: string;
  icon: string;
  iconClass: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-xl border px-3 py-3 text-left transition hover:shadow-xs ${cardClass}`}
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <span className="material-symbols-outlined text-lg">{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-[#031635]">{item.title}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${chipClass}`}>
              {chip}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#44474e]">{item.classroom_name}</p>
          <p className="mt-1 text-xs text-[#6366f1]">
            {formatDueRelative(item.due_at)} · {formatDueAbsolute(item.due_at)}
          </p>
        </div>
      </div>
    </button>
  );
}

function SectionEmptyState({
  icon,
  iconClass,
  title,
  body,
}: {
  icon: string;
  iconClass: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-[#e1e3e4] bg-[#f8f9fa] px-4 py-6 text-center">
      <div className={`mb-2 flex h-10 w-10 items-center justify-center rounded-full ${iconClass}`}>
        <span className="material-symbols-outlined text-xl">{icon}</span>
      </div>
      <p className="text-sm font-semibold text-[#031635]">{title}</p>
      <p className="mt-1 text-xs text-[#75777f]">{body}</p>
    </div>
  );
}

function StudentAssignmentsPanel({
  items,
  isLoading,
  isError,
  onOpen,
}: {
  items: StudentAssignmentFeedItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onOpen: (item: StudentAssignmentFeedItem) => void;
}) {
  const [showCalendar, setShowCalendar] = useState(false);
  const now = useMemo(() => new Date(), [items]);
  const upcomingCutoff = useMemo(
    () => new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    [now],
  );

  const { overdue, upcoming, awaitingGrade } = useMemo(() => {
    const list = items ?? [];
    const overdueList: StudentAssignmentFeedItem[] = [];
    const upcomingList: StudentAssignmentFeedItem[] = [];
    const awaiting: StudentAssignmentFeedItem[] = [];

    for (const item of list) {
      const sub = item.my_submission;
      if (sub && !sub.is_graded) {
        awaiting.push(item);
        continue;
      }
      if (sub?.is_graded) continue;
      if (item.is_overdue) {
        overdueList.push(item);
        continue;
      }
      const due = new Date(item.due_at);
      if (!Number.isNaN(due.getTime()) && due >= now && due <= upcomingCutoff) {
        upcomingList.push(item);
      } else if (!Number.isNaN(due.getTime()) && due > upcomingCutoff) {
        upcomingList.push(item);
      }
    }

    return { overdue: overdueList, upcoming: upcomingList, awaitingGrade: awaiting.slice(0, 8) };
  }, [items, now, upcomingCutoff]);

  const calendarItems = useMemo(
    () => (items ?? []).map((item) => ({ id: item.id, title: item.title, due_at: item.due_at })),
    [items],
  );

  function openFromCalendar(assignmentId: number) {
    const item = items?.find((a) => a.id === assignmentId);
    if (item) {
      setShowCalendar(false);
      onOpen(item);
    }
  }

  return (
    <div className="space-y-4">
      {showCalendar ? (
        <AssignmentsCalendar
          items={calendarItems}
          onSelect={openFromCalendar}
          onClose={() => setShowCalendar(false)}
          title="Assignment calendar"
          subtitle="Across all your classrooms"
        />
      ) : null}

      <Panel className="sticky top-3 p-0">
        <div className="border-b border-[#e1e3e4] px-5 py-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-[#031635]">
            <span className="material-symbols-outlined text-[#6366f1]">assignment</span>
            Your assignments
          </h2>
          <p className="mt-1 text-xs text-[#75777f]">Across all your classrooms</p>
        </div>

        <div className="space-y-5 px-5 py-4">
          {isLoading ? <p className="text-sm text-[#75777f]">Loading…</p> : null}
          {isError ? <p className="text-sm text-red-600">Could not load assignments.</p> : null}

          {!isLoading && !isError ? (
            <>
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#dc2626]">
                  Past due {overdue.length ? `(${overdue.length})` : ""}
                </h3>
                {!overdue.length ? (
                  <SectionEmptyState
                    icon="task_alt"
                    iconClass="bg-[#f3f4f6] text-[#75777f]"
                    title="No overdue assignments"
                    body="You're on track with due dates."
                  />
                ) : (
                  <ul className="space-y-2">
                    {overdue.map((item) => (
                      <li key={item.id}>
                        <OverdueAssignmentRow item={item} onOpen={() => onOpen(item)} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#75777f]">Upcoming</h3>
                {!upcoming.length ? (
                  <SectionEmptyState
                    icon="calendar_month"
                    iconClass="bg-[#ede9fe] text-[#6366f1]"
                    title="No upcoming assignments"
                    body="You're all caught up!"
                  />
                ) : (
                  <ul className="space-y-2">
                    {upcoming.map((item) => (
                      <li key={item.id}>
                        <AssignmentRow
                          item={item}
                          chip="Due soon"
                          chipClass="bg-[#ede9fe] text-[#6366f1]"
                          cardClass="border-[#e0e7ff] bg-[#f8f9ff] hover:border-[#6366f1]/40 hover:bg-white"
                          icon="event"
                          iconClass="bg-[#ede9fe] text-[#6366f1]"
                          onOpen={() => onOpen(item)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#75777f]">
                  Awaiting grade {awaitingGrade.length ? `(${awaitingGrade.length})` : ""}
                </h3>
                {!awaitingGrade.length ? (
                  <SectionEmptyState
                    icon="bar_chart"
                    iconClass="bg-[#dcfce7] text-[#16a34a]"
                    title="No assignments"
                    body="Great job!"
                  />
                ) : (
                  <ul className="space-y-2">
                    {awaitingGrade.map((item) => (
                      <li key={item.id}>
                        <AssignmentRow
                          item={item}
                          chip={item.my_submission?.is_late ? "Late" : "Submitted"}
                          chipClass="bg-[#dcfce7] text-[#15803d]"
                          cardClass="border-[#bbf7d0] bg-[#f0fdf4] hover:border-[#22c55e]/40 hover:bg-white"
                          icon="upload_file"
                          iconClass="bg-[#dcfce7] text-[#16a34a]"
                          onOpen={() => onOpen(item)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </div>

        <div className="border-t border-[#e1e3e4] px-5 py-4">
          <button
            type="button"
            onClick={() => setShowCalendar((v) => !v)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#6366f1]/40 bg-white px-4 py-2.5 text-sm font-semibold text-[#6366f1] transition hover:bg-[#ede9fe]"
          >
            <span className="material-symbols-outlined text-base">calendar_month</span>
            {showCalendar ? "Hide Calendar" : "View Calendar"}
          </button>
        </div>
      </Panel>
    </div>
  );
}

function PendingRequestCard({ request }: { request: ClassroomStudent }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ffedd5]">
          <span className="material-symbols-outlined text-xl text-[#ea580c]">domain</span>
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-[#031635]">
            {request.classroom_name ?? `Classroom ${request.classroom_id}`}
            {request.classroom_code ? ` (${request.classroom_code})` : ""}
          </p>
          <p className="text-xs text-[#75777f]">Requested on {formatRequestDate(request.joined_at)}</p>
        </div>
      </div>
      <span className="shrink-0 rounded-full bg-[#ffedd5] px-2.5 py-1 text-[10px] font-bold text-[#c2410c]">
        Awaiting Approval
      </span>
    </li>
  );
}

function EnrolledClassroomCard({
  classroom,
  onOpen,
}: {
  classroom: Classroom;
  onOpen: (id: number) => void;
}) {
  const initials = classroomInitials(classroom.code, classroom.name);

  return (
    <button
      type="button"
      className="group flex w-full flex-col rounded-2xl border border-[#e1e3e4] bg-white text-left shadow-xs transition hover:border-[#6366f1]/40 hover:shadow-md"
      onClick={() => onOpen(classroom.id)}
    >
      <div className="flex items-start gap-4 p-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#ede9fe] font-display text-lg font-extrabold text-[#6366f1]">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-bold text-[#6366f1]">({classroom.code})</span>
            <span className="shrink-0 rounded-full bg-[#f3f4f6] px-2 py-0.5 text-[10px] font-medium text-[#44474e]">
              {classroom.academic_year || "Active"}
            </span>
          </div>
          <p className="mt-1 font-display text-base font-bold text-[#031635] group-hover:text-[#6366f1]">
            {classroom.name}
          </p>
          {classroom.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-[#75777f]">{classroom.description}</p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-[#e1e3e4] px-4 py-3 text-xs font-semibold text-[#6366f1]">
        <span className="inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-sm">open_in_new</span>
          Enter Workspace
        </span>
        <span className="material-symbols-outlined text-sm transition group-hover:translate-x-0.5">chevron_right</span>
      </div>
    </button>
  );
}

function TeacherClassroomCard({
  classroom,
  canCreate,
  onOpen,
}: {
  classroom: Classroom;
  canCreate: boolean;
  onOpen: (id: number) => void;
}) {
  return (
    <button
      type="button"
      className="group flex w-full flex-col rounded-2xl border border-[#e1e3e4] bg-white text-left shadow-xs transition hover:border-[#6366f1]/40 hover:shadow-md"
      onClick={() => onOpen(classroom.id)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-bold text-[#6366f1]">({classroom.code})</span>
          <span className="shrink-0 rounded-full bg-[#f3f4f6] px-2 py-0.5 text-[10px] font-medium text-[#44474e]">
            {classroom.is_active ? "Active" : "Inactive"}
          </span>
        </div>
        <p className="mt-1 font-display text-base font-bold text-[#031635] group-hover:text-[#6366f1]">
          {classroom.name}
        </p>
        {canCreate ? (
          <p className="mt-2 text-xs text-[#75777f]">
            Join code:{" "}
            <span className="rounded border border-[#e1e3e4] bg-[#f8f9fa] px-2 py-0.5 font-mono font-bold text-[#031635]">
              {classroom.join_code}
            </span>
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between border-t border-[#e1e3e4] px-4 py-3 text-xs font-semibold text-[#6366f1]">
        <span>Manage Classroom</span>
        <span className="material-symbols-outlined text-sm transition group-hover:translate-x-0.5">chevron_right</span>
      </div>
    </button>
  );
}

export function ClassroomsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isStudent = user?.role === "STUDENT";
  const canCreate = user?.role === "CLASS_TEACHER" || user?.role === "SUBJECT_TEACHER";

  const navState = (location.state as LocationState | null) ?? null;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(navState?.success ?? null);
  const [joinCode, setJoinCode] = useState("");
  const [showAllPending, setShowAllPending] = useState(false);
  const [showAllClassrooms, setShowAllClassrooms] = useState(false);

  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: classroomsApi.list });
  const pendingJoins = useQuery({
    queryKey: ["my-join-requests"],
    queryFn: classroomsApi.myJoinRequests,
    enabled: isStudent,
  });
  const assignmentFeed = useQuery({
    queryKey: ["my-assignments"],
    queryFn: assignmentsApi.myFeed,
    enabled: isStudent,
  });

  const joinClassroom = useMutation({
    mutationFn: (code: string) => classroomsApi.join(code),
    onSuccess: async () => {
      setJoinCode("");
      setSuccess("Join request sent. Waiting for teacher approval.");
      await qc.invalidateQueries({ queryKey: ["my-join-requests"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  function onJoin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    joinClassroom.mutate(joinCode.trim().toUpperCase());
  }

  function openClassroom(id: number) {
    navigate(`/classrooms/${id}/dashboard`);
  }

  function openAssignment(item: StudentAssignmentFeedItem) {
    navigate(`/classrooms/${item.classroom_id}/assignments?assignment=${item.id}`);
  }

  const pendingList = pendingJoins.data ?? [];
  const visiblePending = showAllPending ? pendingList : pendingList.slice(0, PENDING_PREVIEW);
  const classroomList = classrooms.data ?? [];
  const visibleClassrooms = showAllClassrooms ? classroomList : classroomList.slice(0, CLASSROOM_PREVIEW);

  if (isStudent) {
    return (
      <div className="space-y-6">
        <WorkspaceHeader subtitle="Enter the 5-character join code from your teacher to enroll in learning spaces." />
        <ErrorText message={error} />
        {success ? (
          <p className="mb-4 flex items-center gap-2 rounded-md border border-[#4f46e5]/30 bg-[#eef2ff] px-3.5 py-2.5 text-sm font-medium text-[#4f46e5]">
            <span className="material-symbols-outlined text-base">check_circle</span>
            <span>{success}</span>
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-6">
            <div className="rounded-2xl border border-[#e0e7ff] bg-[#f5f3ff] p-5 shadow-xs">
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ede9fe]">
                  <span className="material-symbols-outlined text-xl text-[#6366f1]">group</span>
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-[#031635]">Join a Classroom</h2>
                  <p className="mt-0.5 text-sm text-[#75777f]">
                    Enter the 5-character code shared by your teacher.
                  </p>
                </div>
              </div>
              <form onSubmit={onJoin} className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6366f1]">
                    Join code
                  </span>
                  <div className="relative">
                    <input
                      className={`${inputClass} w-full bg-white pr-12 text-center font-mono text-base font-bold uppercase tracking-widest`}
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 5))}
                      maxLength={5}
                      minLength={5}
                      pattern="[A-Za-z0-9]{5}"
                      placeholder="e.g. AB12C"
                      required
                    />
                    <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#a5b4fc]">
                      qr_code_scanner
                    </span>
                  </div>
                </label>
                <button
                  type="submit"
                  disabled={joinClassroom.isPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#6366f1] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#4f46e5] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  Request to join
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </button>
              </form>
            </div>

            <Panel className="p-0">
              <div className="flex items-start justify-between gap-3 border-b border-[#e1e3e4] px-5 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ffedd5]">
                    <span className="material-symbols-outlined text-xl text-[#ea580c]">schedule</span>
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold text-[#031635]">Pending Requests</h2>
                    <p className="mt-0.5 text-sm text-[#75777f]">
                      Track classrooms waiting for teacher approval.
                    </p>
                  </div>
                </div>
                {pendingList.length > PENDING_PREVIEW ? (
                  <button
                    type="button"
                    onClick={() => setShowAllPending((v) => !v)}
                    className="shrink-0 text-xs font-semibold text-[#6366f1] hover:underline"
                  >
                    {showAllPending ? "Show less" : "View all >"}
                  </button>
                ) : null}
              </div>
              <div className="px-5 py-4">
                {pendingJoins.isLoading ? (
                  <p className="text-sm text-[#75777f]">Loading…</p>
                ) : !pendingList.length ? (
                  <p className="text-sm text-[#75777f]">No pending requests.</p>
                ) : (
                  <ul className="space-y-2">
                    {visiblePending.map((r) => (
                      <PendingRequestCard key={r.id} request={r} />
                    ))}
                  </ul>
                )}
              </div>
            </Panel>

            <Panel className="p-0">
              <div className="flex items-start justify-between gap-3 border-b border-[#e1e3e4] px-5 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#dbeafe]">
                    <span className="material-symbols-outlined text-xl text-[#2563eb]">menu_book</span>
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold text-[#031635]">Enrolled Classrooms</h2>
                    <p className="mt-0.5 text-sm text-[#75777f]">Your active learning spaces.</p>
                  </div>
                </div>
                {classroomList.length > CLASSROOM_PREVIEW ? (
                  <button
                    type="button"
                    onClick={() => setShowAllClassrooms((v) => !v)}
                    className="shrink-0 text-xs font-semibold text-[#6366f1] hover:underline"
                  >
                    {showAllClassrooms ? "Show less" : "View all >"}
                  </button>
                ) : null}
              </div>
              <div className="px-5 py-4">
                {!classroomList.length ? (
                  <EmptyState title="No classrooms yet" body="Ask your teacher for a join code to get started." />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {visibleClassrooms.map((c) => (
                      <EnrolledClassroomCard key={c.id} classroom={c} onOpen={openClassroom} />
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          </div>

          <StudentAssignmentsPanel
            items={assignmentFeed.data}
            isLoading={assignmentFeed.isLoading}
            isError={assignmentFeed.isError}
            onOpen={openAssignment}
          />
        </div>

        <FooterTip message="Join a classroom to access announcements, materials, assignments, and more." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WorkspaceHeader
        subtitle={
          canCreate
            ? "Classrooms you own. Open one to manage join codes, student requests, and course content."
            : "Classrooms in your active academic scope."
        }
      />
      <ErrorText message={error} />
      {classrooms.isError ? (
        <ErrorText
          message={classrooms.error instanceof Error ? classrooms.error.message : "Failed to load classrooms"}
        />
      ) : null}
      {success ? (
        <p className="mb-4 rounded-md border border-[#4f46e5]/30 bg-[#eef2ff] px-3.5 py-2.5 text-sm font-medium text-[#4f46e5]">
          {success}
        </p>
      ) : null}

      <Panel className="p-0">
        <div className="flex items-center justify-between border-b border-[#e1e3e4] px-5 py-4">
          <h2 className="font-display text-lg font-bold text-[#031635]">Your Classrooms</h2>
          {canCreate ? (
            <Link
              to="/classrooms/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#6366f1] px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#4f46e5]"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Create Classroom
            </Link>
          ) : null}
        </div>

        <div className="px-5 py-4">
          {classrooms.isLoading ? (
            <p className="text-sm text-[#75777f]">Loading classrooms…</p>
          ) : !classroomList.length ? (
            <EmptyState
              title="No classrooms"
              body={
                canCreate
                  ? "Create a classroom to get a 5-character join code for students."
                  : "Classrooms in your scope will appear here."
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {classroomList.map((c) => (
                <TeacherClassroomCard
                  key={c.id}
                  classroom={c}
                  canCreate={canCreate}
                  onOpen={openClassroom}
                />
              ))}
            </div>
          )}
        </div>
      </Panel>

      <FooterTip message="Open a classroom to manage join codes, content, and student requests." />
    </div>
  );
}
