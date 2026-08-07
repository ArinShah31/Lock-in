import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import type { Role } from "../api";
import { MagicCard } from "../components/ui/magic-card";

const fieldClass =
  "w-full rounded-md border border-[#c5c6cf] bg-[#f8f9fa] px-3.5 py-2.5 text-sm text-[#191c1d] outline-none transition placeholder:text-[#75777f] focus:border-[#031635] focus:bg-white focus:ring-1 focus:ring-[#031635]";

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
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3f5d9b]">Astra Coding</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[#031635]">Sign in to coding</h1>
      <p className="mb-6 mt-1 text-sm text-[#44474e]">Standalone practice & assessment platform</p>

      <MagicCard className="p-0 shadow-sm">
        <form onSubmit={onSubmit} className="space-y-3 p-6">
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 font-semibold transition ${
                mode === "login" ? "bg-[#031635] text-white" : "border border-[#e1e3e4] bg-white text-[#031635]"
              }`}
              onClick={() => setMode("login")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 font-semibold transition ${
                mode === "register" ? "bg-[#031635] text-white" : "border border-[#e1e3e4] bg-white text-[#031635]"
              }`}
              onClick={() => setMode("register")}
            >
              Register
            </button>
          </div>
          {mode === "register" ? (
            <>
              <input
                className={fieldClass}
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
              <select className={fieldClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="TEACHER">Teacher</option>
                <option value="STUDENT">Student</option>
              </select>
            </>
          ) : null}
          <input
            className={fieldClass}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className={fieldClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? (
            <p className="rounded-lg border border-[#f1d1d1] bg-[#fff2f1] px-3 py-2 text-sm text-[#a03a3a]">
              {error}
            </p>
          ) : null}
          <button
            disabled={pending}
            className="w-full rounded-md bg-[#031635] py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a2b4b] disabled:opacity-50"
          >
            {pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
          <p className="text-xs text-[#75777f]">
            Demo: teacher@example.com / student@example.com — DemoPass123
          </p>
        </form>
      </MagicCard>
    </div>
  );
}
