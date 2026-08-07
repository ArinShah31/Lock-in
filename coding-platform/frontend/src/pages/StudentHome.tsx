import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type Assignment, type Session } from "../api";
import { useAuth } from "../auth";
import { MagicCard } from "../components/ui/magic-card";

function statusLabel(assignment: Assignment) {
  if (assignment.status === "SUBMITTED" && assignment.is_published_results) return "Results available";
  if (assignment.status === "SUBMITTED") return "Submitted";
  if (assignment.status === "IN_PROGRESS") return "In progress";
  if (assignment.status === "BLOCKED") return "Blocked";
  return "Assigned";
}

function statusChip(assignment: Assignment) {
  if (assignment.status === "SUBMITTED" && assignment.is_published_results) {
    return "border-[#cfe9d5] bg-[#edf9ef] text-[#1f6a34]";
  }
  if (assignment.status === "IN_PROGRESS") {
    return "border-[#ffe0b2] bg-[#fff4df] text-[#8a4f00]";
  }
  if (assignment.status === "BLOCKED") {
    return "border-[#f1d1d1] bg-[#fff2f1] text-[#a03a3a]";
  }
  return "border-[#d6e3ff] bg-[#eef4ff] text-[#3f5d9b]";
}

export function StudentHome() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string | null>(null);

  const assignments = useQuery({
    queryKey: ["student-assignments"],
    queryFn: () => api<Assignment[]>("/student/assignments"),
  });

  const join = useMutation({
    mutationFn: () =>
      api("/student/join", { method: "POST", body: JSON.stringify({ invite_code: invite }) }),
    onSuccess: async () => {
      setInvite("");
      await qc.invalidateQueries({ queryKey: ["student-assignments"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const start = useMutation({
    mutationFn: (assignmentId: number) =>
      api<Session>(`/student/assignments/${assignmentId}/start`, { method: "POST" }),
    onSuccess: (session) => navigate(`/exam/${session.id}`),
    onError: (e: Error) => setError(e.message),
  });

  function onJoin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    join.mutate();
  }

  const items = assignments.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3f5d9b]">Astra Coding</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[#031635]">Student workspace</h1>
          <p className="mt-1 text-sm text-[#44474e]">{user?.full_name}</p>
        </div>
        <button
          onClick={logout}
          className="rounded-md border border-[#c5c6cf] bg-white px-3 py-2 text-sm font-semibold text-[#031635] transition hover:border-[#031635]"
        >
          Log out
        </button>
      </header>

      <MagicCard className="mb-6 p-0 shadow-sm">
        <form onSubmit={onJoin} className="space-y-3 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Join a test</p>
            <p className="mt-1 text-sm text-[#44474e]">Enter the invite code from your teacher.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="flex-1 rounded-md border border-[#c5c6cf] bg-[#f8f9fa] px-3.5 py-2.5 uppercase tracking-[0.12em] text-[#191c1d] outline-none transition placeholder:normal-case placeholder:tracking-normal placeholder:text-[#75777f] focus:border-[#031635] focus:bg-white focus:ring-1 focus:ring-[#031635]"
              placeholder="Invite code"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={join.isPending}
              className="rounded-md bg-[#031635] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a2b4b] disabled:opacity-50"
            >
              {join.isPending ? "Joining…" : "Join test"}
            </button>
          </div>
        </form>
      </MagicCard>

      {error ? (
        <p className="mb-4 rounded-xl border border-[#f1d1d1] bg-[#fff2f1] px-3 py-2 text-sm text-[#a03a3a]">
          {error}
        </p>
      ) : null}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[#75777f]">Your tests</h2>
        <span className="text-xs font-semibold text-[#3f5d9b]">{items.length} assigned</span>
      </div>

      <div className="space-y-4">
        {!items.length && !assignments.isLoading ? (
          <MagicCard className="p-5 shadow-sm">
            <p className="font-semibold text-[#031635]">No tests yet</p>
            <p className="mt-1 text-sm text-[#44474e]">
              Join with an invite code, or wait for your teacher to assign one.
            </p>
          </MagicCard>
        ) : null}

        {items.map((a) => (
          <MagicCard key={a.id} className="p-0 shadow-sm">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-lg font-bold text-[#031635]">{a.test_title}</h3>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusChip(a)}`}>
                    {statusLabel(a)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[#44474e]">
                  {a.duration_minutes} min
                  {a.is_published_results ? " · results published" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {a.status !== "SUBMITTED" && a.status !== "BLOCKED" ? (
                  <button
                    className="rounded-md bg-[#031635] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#1a2b4b] disabled:opacity-50"
                    disabled={start.isPending}
                    onClick={() => start.mutate(a.id)}
                  >
                    {a.status === "IN_PROGRESS" ? "Resume exam" : "Start exam"}
                  </button>
                ) : null}
                {a.is_published_results ? <ResultsButton assignmentId={a.id} /> : null}
              </div>
            </div>
          </MagicCard>
        ))}
      </div>
    </div>
  );
}

function ResultsButton({ assignmentId }: { assignmentId: number }) {
  const [open, setOpen] = useState(false);
  const results = useQuery({
    queryKey: ["student-results", assignmentId],
    queryFn: () =>
      api<{
        published: boolean;
        message?: string;
        average_score?: number;
        evals: { question_title: string; total_score: number; verdict: string; feedback: string }[];
      }>(`/student/assignments/${assignmentId}/results`),
    enabled: open,
  });

  return (
    <div className="w-full sm:w-auto">
      <button
        className="rounded-md border border-[#c5c6cf] bg-white px-3.5 py-2 text-sm font-semibold text-[#031635] transition hover:border-[#031635]"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide results" : "View results"}
      </button>
      {open && results.data ? (
        <div className="mt-3 rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-3 text-sm text-[#44474e]">
          {results.data.message ? <p>{results.data.message}</p> : null}
          {results.data.average_score != null ? (
            <p className="font-semibold text-[#031635]">Average: {results.data.average_score}</p>
          ) : null}
          <ul className="mt-2 space-y-1">
            {(results.data.evals || []).map((e) => (
              <li key={e.question_title}>
                <span className="font-medium text-[#031635]">{e.question_title}</span>: {e.total_score} (
                {e.verdict}) — {e.feedback}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
