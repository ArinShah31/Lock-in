import { Link, useParams } from "react-router-dom";

export function SubmittedPage() {
  const { sessionId } = useParams();
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-3 text-3xl font-bold text-emerald-300">Your Test Is Successfully Submitted</h1>
      <p className="mb-6 text-slate-400">
        Session #{sessionId}. Scores stay private until your teacher publishes results.
      </p>
      <Link to="/student" className="rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-slate-950">
        Back to assignments
      </Link>
    </div>
  );
}
