import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classroomsApi } from "../api";
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

        <Panel className="mb-6">
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
          <Panel className="mb-6">
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
