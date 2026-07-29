import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { UserRole } from "../api/types";
import { ErrorText, Field, inputClass, PrimaryButton } from "../components/ui";

const roles: UserRole[] = [
  "SUPER_ADMIN",
  "INSTITUTION_ADMIN",
  "HOD",
  "CLASS_TEACHER",
  "SUBJECT_TEACHER",
  "STUDENT",
];

export function RegisterPage() {
  const { user, register } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("STUDENT");
  const [institutionId, setInstitutionId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
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
        role,
        institution_id: role === "SUPER_ADMIN" ? null : Number(institutionId),
        department_id: departmentId ? Number(departmentId) : null,
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
        className="animate-rise w-full max-w-xl space-y-4 rounded-3xl border border-line/70 bg-panel/70 p-7 backdrop-blur"
      >
        <div>
          <p className="font-display text-3xl text-paper">ASTRA</p>
          <h1 className="mt-2 font-display text-3xl text-paper">Create your account</h1>
          <p className="mt-1 text-sm text-mist">Join your institution workspace.</p>
        </div>

        <ErrorText message={error} />

        <div className="grid gap-4 md:grid-cols-2">
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
          <Field label="Role">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          {role !== "SUPER_ADMIN" ? (
            <>
              <Field label="Institution ID">
                <input
                  className={inputClass}
                  type="number"
                  value={institutionId}
                  onChange={(e) => setInstitutionId(e.target.value)}
                  required
                />
              </Field>
              <Field label="Department ID (optional)">
                <input
                  className={inputClass}
                  type="number"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                />
              </Field>
            </>
          ) : null}
        </div>

        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
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
