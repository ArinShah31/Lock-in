import { FormEvent, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assignmentsApi, classroomsApi } from "../api";
import type { StudentAssignmentFeedItem } from "../api/types";
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

type LocationState = {
  success?: string;
};

const UPCOMING_WINDOW_DAYS = 14;

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

function StudentAssignmentRow({
  item,
  chip,
  onOpen,
}: {
  item: StudentAssignmentFeedItem;
  chip: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-[#e1e3e4] px-3 py-2.5 text-left transition hover:border-[#031635]/40"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-[#031635]">{item.title}</p>
        <span className="shrink-0 rounded border border-[#e1e3e4] px-1.5 py-0.5 text-[10px] text-[#44474e]">
          {chip}
        </span>
      </div>
      <p className="mt-1 text-xs text-[#44474e]">{item.classroom_name}</p>
      <p className="mt-0.5 text-xs text-[#44474e]">
        {formatDueRelative(item.due_at)} · {formatDueAbsolute(item.due_at)}
      </p>
    </button>
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
        // Still show farther-out work, but after the near window
        upcomingList.push(item);
      }
    }

    return { overdue: overdueList, upcoming: upcomingList, awaitingGrade: awaiting.slice(0, 8) };
  }, [items, now, upcomingCutoff]);

  const hasAny = overdue.length + upcoming.length + awaitingGrade.length > 0;

  return (
    <Panel className="sticky top-3">
      <h2 className="font-display text-xl text-[#031635]">Your assignments</h2>
      <p className="mt-1 text-xs text-[#44474e]">Across all your classrooms</p>

      {isLoading ? <p className="mt-4 text-sm text-[#44474e]">Loading…</p> : null}
      {isError ? <p className="mt-4 text-sm text-red-300">Could not load assignments.</p> : null}

      {!isLoading && !isError && !hasAny ? (
        <div className="mt-4">
          <EmptyState title="All caught up" body="No overdue or upcoming assignments right now." />
        </div>
      ) : null}

      {!isLoading && !isError && hasAny ? (
        <div className="mt-4 space-y-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#44474e]">
              Past due {overdue.length ? `(${overdue.length})` : ""}
            </h3>
            {!overdue.length ? (
              <p className="text-sm text-[#44474e]">None</p>
            ) : (
              <ul className="space-y-2">
                {overdue.map((item) => (
                  <li key={item.id}>
                    <StudentAssignmentRow
                      item={item}
                      chip="Overdue"
                      onOpen={() => onOpen(item)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#44474e]">
              Upcoming {upcoming.length ? `(${upcoming.length})` : ""}
            </h3>
            {!upcoming.length ? (
              <p className="text-sm text-[#44474e]">None</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((item) => (
                  <li key={item.id}>
                    <StudentAssignmentRow
                      item={item}
                      chip="Due soon"
                      onOpen={() => onOpen(item)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#44474e]">
              Awaiting grade {awaitingGrade.length ? `(${awaitingGrade.length})` : ""}
            </h3>
            {!awaitingGrade.length ? (
              <p className="text-sm text-[#44474e]">None</p>
            ) : (
              <ul className="space-y-2">
                {awaitingGrade.map((item) => (
                  <li key={item.id}>
                    <StudentAssignmentRow
                      item={item}
                      chip={item.my_submission?.is_late ? "Late" : "Submitted"}
                      onOpen={() => onOpen(item)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </Panel>
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

  if (isStudent) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Classrooms Workspace"
          subtitle="Enter the 5-character join code from your teacher to enroll in learning spaces."
        />
        <ErrorText message={error} />
        {success ? (
          <p className="mb-4 rounded-md border border-[#4f46e5]/30 bg-[#eef2ff] px-3.5 py-2.5 text-sm font-medium text-[#4f46e5] flex items-center gap-2">
            <span className="material-symbols-outlined text-base">check_circle</span>
            <span>{success}</span>
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-6">
            <Panel>
              <h2 className="mb-3 font-display text-lg font-bold text-[#031635] flex items-center gap-2">
                <span className="material-symbols-outlined text-[#3f5d9b]">vpn_key</span>
                Join a Classroom
              </h2>
              <form onSubmit={onJoin} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field label="Join code">
                    <input
                      className={`${inputClass} uppercase tracking-widest font-mono font-bold text-center text-base`}
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 5))}
                      maxLength={5}
                      minLength={5}
                      pattern="[A-Za-z0-9]{5}"
                      placeholder="AB12C"
                      required
                    />
                  </Field>
                </div>
                <PrimaryButton type="submit" disabled={joinClassroom.isPending}>
                  Request to join
                </PrimaryButton>
              </form>
            </Panel>

            {pendingJoins.data?.length ? (
              <Panel>
                <h2 className="mb-3 font-display text-lg font-bold text-[#031635] flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-600">pending</span>
                  Pending Requests
                </h2>
                <ul className="space-y-2">
                  {pendingJoins.data.map((r) => (
                    <li key={r.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm flex items-center justify-between">
                      <span className="font-semibold text-[#031635]">
                        {r.classroom_name ?? `Classroom ${r.classroom_id}`} {r.classroom_code ? `(${r.classroom_code})` : ""}
                      </span>
                      <span className="text-xs bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded">Awaiting Approval</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            <Panel>
              <h2 className="mb-4 font-display text-lg font-bold text-[#031635]">Enrolled Classrooms</h2>
              {!classrooms.data?.length ? (
                <EmptyState title="No classrooms yet" body="Ask your teacher for a join code to get started." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {classrooms.data.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-4 text-left transition hover:border-[#031635] hover:bg-white hover:shadow-xs group flex flex-col justify-between"
                      onClick={() => openClassroom(c.id)}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-[#3f5d9b] uppercase">({c.code})</span>
                          <span className="text-[10px] bg-[#e8edf5] text-[#031635] px-2 py-0.5 rounded font-medium">
                            {c.academic_year || "Active"}
                          </span>
                        </div>
                        <p className="font-display font-bold text-[#031635] text-base group-hover:text-[#3f5d9b] transition-colors">
                          {c.name}
                        </p>
                        {c.description ? <p className="mt-1 text-xs text-[#44474e] line-clamp-2">{c.description}</p> : null}
                      </div>
                      <div className="mt-4 pt-2 border-t border-[#e1e3e4] flex items-center justify-between text-xs text-[#031635] font-semibold">
                        <span>Enter Workspace</span>
                        <span className="material-symbols-outlined text-sm group-hover:translate-x-1 transition-transform">arrow_forward</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <StudentAssignmentsPanel
            items={assignmentFeed.data}
            isLoading={assignmentFeed.isLoading}
            isError={assignmentFeed.isError}
            onOpen={openAssignment}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Classrooms Workspace"
        subtitle={
          canCreate
            ? "Classrooms you own. Open one to manage join codes, student requests, and course content."
            : "Classrooms in your active academic scope."
        }
      />
      <ErrorText message={error} />
      {success ? (
        <p className="mb-4 rounded-md border border-[#4f46e5]/30 bg-[#eef2ff] px-3.5 py-2.5 text-sm font-medium text-[#4f46e5]">{success}</p>
      ) : null}

      <Panel>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold text-[#031635]">Your Classrooms</h2>
          {canCreate ? (
            <Link
              to="/classrooms/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-[#031635] px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#1a2b4b]"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Create Classroom
            </Link>
          ) : null}
        </div>

        {!classrooms.data?.length ? (
          <div className="space-y-4">
            <EmptyState
              title="No classrooms"
              body={
                canCreate
                  ? "Create a classroom to get a 5-character join code for students."
                  : "Classrooms in your scope will appear here."
              }
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {classrooms.data.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-4 text-left transition hover:border-[#031635] hover:bg-white hover:shadow-xs group flex flex-col justify-between"
                onClick={() => openClassroom(c.id)}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-[#44474e] uppercase">({c.code})</span>
                    <span className="text-[10px] bg-[#e8edf5] text-[#031635] px-2 py-0.5 rounded font-bold">
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="font-display font-bold text-[#031635] text-base group-hover:text-[#3f5d9b] transition-colors">
                    {c.name}
                  </p>
                  {canCreate ? (
                    <p className="text-xs text-[#44474e] mt-2 font-mono">
                      Join code: <span className="font-bold text-[#031635] bg-white px-2 py-0.5 rounded border border-[#e1e3e4]">{c.join_code}</span>
                    </p>
                  ) : null}
                </div>
                <div className="mt-4 pt-2 border-t border-[#e1e3e4] flex items-center justify-between text-xs text-[#3f5d9b] font-semibold">
                  <span>Manage Classroom →</span>
                  <span className="material-symbols-outlined text-sm group-hover:translate-x-1 transition-transform">chevron_right</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
