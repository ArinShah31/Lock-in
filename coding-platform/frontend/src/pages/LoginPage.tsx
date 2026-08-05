import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import type { Role } from "../api";

export function LoginPage() {
  const { user, login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
          const [email, setEmail] = useState("teacher@example.com");
  const [password, setPassword] = useState("DemoPass123");
  const [fullName, setFullName] = useState("Demo Teacher");
  const [role, setRole] = useState<Role>("TEACHER");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (user) {
    return <Navigate to={user.role === "TEACHER" ? "/teacher" : "/student"} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === "login") await login(email, password);
      else await register({ full_name: fullName, email, password, role });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4">
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-cyan-300">Astra Coding</h1>
      <p className="mb-6 text-slate-400">Standalone practice & assessment platform</p>
      <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-6">
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            className={`rounded-lg px-3 py-1 ${mode === "login" ? "bg-cyan-700" : "bg-slate-800"}`}
            onClick={() => setMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1 ${mode === "register" ? "bg-cyan-700" : "bg-slate-800"}`}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>
        {mode === "register" ? (
          <>
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2"
              placeholder="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
            <select
              className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="TEACHER">Teacher</option>
              <option value="STUDENT">Student</option>
            </select>
          </>
        ) : null}
        <input
          className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error ? <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        <button
          disabled={pending}
          className="w-full rounded-xl bg-cyan-500 py-2.5 font-semibold text-slate-950 disabled:opacity-50"
        >
          {pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        <p className="text-xs text-slate-500">
          Demo: teacher@example.com / student@example.com — DemoPass123
        </p>
      </form>
    </div>
  );
}
