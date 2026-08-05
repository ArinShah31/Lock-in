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
      className="w-full rounded-xl border border-line px-3 py-2.5 text-left transition hover:border-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-paper">{item.title}</p>
        <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-mist">
          {chip}
        </span>
      </div>
      <p className="mt-1 text-xs text-mist">{item.classroom_name}</p>
      <p className="mt-0.5 text-xs text-mist">
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
      <h2 className="font-display text-xl text-paper">Your assignments</h2>
      <p className="mt-1 text-xs text-mist">Across all your classrooms</p>

      {isLoading ? <p className="mt-4 text-sm text-mist">Loading…</p> : null}
      {isError ? <p className="mt-4 text-sm text-red-300">Could not load assignments.</p> : null}

      {!isLoading && !isError && !hasAny ? (
        <div className="mt-4">
          <EmptyState title="All caught up" body="No overdue or upcoming assignments right now." />
        </div>
      ) : null}

      {!isLoading && !isError && hasAny ? (
        <div className="mt-4 space-y-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-mist">
              Past due {overdue.length ? `(${overdue.length})` : ""}
            </h3>
            {!overdue.length ? (
              <p className="text-sm text-mist">None</p>
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
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-mist">
              Upcoming {upcoming.length ? `(${upcoming.length})` : ""}
            </h3>
            {!upcoming.length ? (
              <p className="text-sm text-mist">None</p>
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
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-mist">
              Awaiting grade {awaitingGrade.length ? `(${awaitingGrade.length})` : ""}
            </h3>
            {!awaitingGrade.length ? (
              <p className="text-sm text-mist">None</p>
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
      <div>
        <PageHeader
          title="Classrooms"
          subtitle="Enter the 5-character join code from your teacher. Access starts after approval."
        />
        <ErrorText message={error} />
        {success ? (
          <p className="mb-4 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">{success}</p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-6">
            <Panel>
              <h2 className="mb-4 font-display text-xl text-paper">Join a classroom</h2>
              <form onSubmit={onJoin} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field label="Join code">
                    <input
                      className={`${inputClass} uppercase tracking-[0.3em]`}
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
                <h2 className="mb-4 font-display text-xl text-paper">Pending requests</h2>
                <ul className="space-y-2">
                  {pendingJoins.data.map((r) => (
                    <li key={r.id} className="rounded-xl border border-line px-3 py-2 text-sm text-mist">
                      <span className="text-paper">{r.classroom_name ?? `Classroom ${r.classroom_id}`}</span>
                      {r.classroom_code ? ` (${r.classroom_code})` : ""} · awaiting approval
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            <Panel>
              <h2 className="mb-4 font-display text-xl text-paper">Your classrooms</h2>
              {!classrooms.data?.length ? (
                <EmptyState title="No classrooms yet" body="Ask your teacher for a join code to get started." />
              ) : (
                <div className="space-y-3">
                  {classrooms.data.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full rounded-2xl border border-line bg-ink-soft/40 px-4 py-3 text-left transition hover:border-accent/40"
                      onClick={() => openClassroom(c.id)}
                    >
                      <p className="font-semibold text-paper">
                        {c.name} <span className="text-mist">({c.code})</span>
                      </p>
                      <p className="mt-1 text-xs text-mist">Year: {c.academic_year || "—"}</p>
                      {c.description ? <p className="mt-2 text-sm text-mist">{c.description}</p> : null}
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
    <div>
      <PageHeader
        title="Classrooms"
        subtitle={
          canCreate
            ? "Classrooms you own. Open one to manage join codes and students."
            : "Classrooms in your scope. Open one to view details."
        }
      />
      <ErrorText message={error} />
      {success ? (
        <p className="mb-4 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">{success}</p>
      ) : null}

      <Panel>
        <h2 className="mb-4 font-display text-xl text-paper">Your classrooms</h2>
        {!classrooms.data?.length ? (
          <div className="space-y-4">
            <EmptyState
              title="No classrooms"
              body={
                canCreate
                  ? "Create a classroom from the sidebar to get a join code for students."
                  : "Classrooms you can access will appear here."
              }
            />
            {canCreate ? (
              <Link
                to="/classrooms/new"
                className="inline-flex rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-accent-deep"
              >
                Create classroom
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            {classrooms.data.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full rounded-2xl border border-line bg-ink-soft/40 px-4 py-3 text-left transition hover:border-accent/40"
                onClick={() => openClassroom(c.id)}
              >
                <p className="font-semibold text-paper">
                  {c.name} <span className="text-mist">({c.code})</span>
                </p>
                <p className="text-xs text-mist">
                  {canCreate ? (
                    <>
                      Join code <span className="font-semibold tracking-widest text-accent">{c.join_code}</span>
                      {" · "}
                    </>
                  ) : null}
                  {c.is_active ? "Active" : "Inactive"}
                </p>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
