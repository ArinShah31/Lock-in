import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, Field, inputClass, PrimaryButton } from "../components/ui";

export function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <section className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(62,207,191,0.25),transparent_40%),linear-gradient(160deg,#07111f,#10233a)]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <p className="font-display text-5xl font-extrabold text-paper">ASTRA</p>
          <div className="animate-rise max-w-lg">
            <h1 className="font-display text-5xl leading-[1.05] text-paper">
              Academic intelligence for modern classrooms.
            </h1>
            <p className="mt-4 text-lg text-mist">
              Guide learning, manage institutions, and keep faculty in control of every decision.
            </p>
          </div>
          <p className="text-sm text-mist/70">Faculty-approved AI. Structured learning. Clear outcomes.</p>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-10">
        <form onSubmit={onSubmit} className="animate-rise-delay w-full max-w-md space-y-5 rounded-3xl border border-line/70 bg-panel/70 p-7 backdrop-blur">
          <div>
            <p className="font-display text-3xl text-paper lg:hidden">ASTRA</p>
            <h2 className="font-display mt-2 text-3xl text-paper">Welcome back</h2>
            <p className="mt-1 text-sm text-mist">Sign in to continue to your workspace.</p>
          </div>

          <ErrorText message={error} />

          <Field label="Email">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </Field>

          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </PrimaryButton>

          <p className="text-sm text-mist">
            New here?{" "}
            <Link className="text-accent hover:underline" to="/register">
              Register a student
            </Link>
          </p>
        </form>
      </section>
    </div>
  );
}
