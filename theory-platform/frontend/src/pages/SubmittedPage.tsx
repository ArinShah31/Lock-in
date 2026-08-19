import { Link, useParams } from "react-router-dom";

const LMS_DASHBOARD_URL =
  (import.meta.env.VITE_LMS_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:5173";

export function SubmittedPage() {
  const { sessionId } = useParams();
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-3 text-3xl font-bold text-emerald-300">Your Test Is Successfully Submitted</h1>
      <p className="mb-6 text-slate-400">
        Session #{sessionId}. Scores stay private until your teacher publishes results.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link to="/student" className="rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-slate-950">
          Back to assignments
        </Link>
        <button
          type="button"
          className="rounded-xl border border-slate-500 px-4 py-2 font-semibold text-slate-200 transition hover:border-slate-300"
          onClick={() => window.location.assign(`${LMS_DASHBOARD_URL}/`)}
        >
          ← Back to dashboard
        </button>
      </div>
    </div>
  );
}
