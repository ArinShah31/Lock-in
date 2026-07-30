import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, Field, inputClass, PrimaryButton } from "../components/ui";

export function RegisterPage() {
  const { user, register } = useAuth();
  const [fullName, setFullName] = useState("");
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
      await register({
        full_name: fullName,
        email,
        password,
        role: "STUDENT",
        institution_id: null,
        department_id: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <form
        onSubmit={onSubmit}
        className="animate-rise w-full max-w-md space-y-4 rounded-3xl border border-line/70 bg-panel/70 p-7 backdrop-blur"
      >
        <div>
          <p className="font-display text-3xl text-paper">ASTRA</p>
          <h1 className="mt-2 font-display text-3xl text-paper">Student registration</h1>
          <p className="mt-1 text-sm text-mist">
            Faculty and admin accounts are created by your institution. Students can self-register here.
          </p>
        </div>

        <ErrorText message={error} />

        <Field label="Full name">
          <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
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
          {busy ? "Creating…" : "Create student account"}
        </PrimaryButton>

        <p className="text-sm text-mist">
          Already have an account?{" "}
          <Link className="text-accent hover:underline" to="/login">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
