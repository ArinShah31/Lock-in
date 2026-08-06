import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type Assignment, type Session } from "../api";
import { useAuth } from "../auth";

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

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-cyan-300">Student workspace</h1>
          <p className="text-sm text-slate-400">{user?.full_name}</p>
        </div>
        <button onClick={logout} className="rounded-xl border border-slate-600 px-3 py-1.5 text-sm">
          Log out
        </button>
      </header>

      <form onSubmit={onJoin} className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-slate-700 p-4">
        <input
          className="flex-1 rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 uppercase"
          placeholder="Invite code"
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
          required
        />
        <button className="rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-slate-950">Join test</button>
      </form>

      {error ? <p className="mb-3 rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</p> : null}

      <div className="space-y-3">
        {(assignments.data || []).map((a) => (
          <div key={a.id} className="rounded-2xl border border-slate-700 p-4">
            <div className="font-semibold">{a.test_title}</div>
            <div className="text-sm text-slate-400">
              {a.duration_minutes} min · {a.status}
              {a.is_published_results ? " · results available" : ""}
            </div>
            <div className="mt-3 flex gap-2">
              {a.status !== "SUBMITTED" && a.status !== "BLOCKED" ? (
                <button
                  className="rounded-xl bg-cyan-600 px-3 py-1.5 text-sm font-semibold"
                  onClick={() => start.mutate(a.id)}
                >
                  {a.status === "IN_PROGRESS" ? "Resume exam" : "Start exam"}
                </button>
              ) : null}
              {a.is_published_results ? <ResultsButton assignmentId={a.id} /> : null}
            </div>
          </div>
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
    <div>
      <button className="rounded-xl border border-slate-600 px-3 py-1.5 text-sm" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide results" : "View results"}
      </button>
      {open && results.data ? (
        <div className="mt-2 rounded-xl bg-slate-900 p-3 text-sm">
          {results.data.message ? <p>{results.data.message}</p> : null}
          {results.data.average_score != null ? <p>Average: {results.data.average_score}</p> : null}
          <ul className="mt-2 space-y-1">
            {(results.data.evals || []).map((e) => (
              <li key={e.question_title}>
                {e.question_title}: {e.total_score} ({e.verdict}) — {e.feedback}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
