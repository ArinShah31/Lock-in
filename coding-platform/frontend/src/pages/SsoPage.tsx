import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type User } from "../api";
import { useAuth } from "../auth";

/** Exchange ASTRA SSO token for a coding-platform session. */
export function SsoPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { applySsoSession, clearSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const token = params.get("token");
    if (!token) {
      setError("Missing SSO token");
      return;
    }
    started.current = true;

    // Drop any previous student/teacher session before exchanging.
    clearSession();

    void (async () => {
      try {
        const data = await api<{ access_token: string; user: User }>(
          "/auth/sso",
          { method: "POST", body: JSON.stringify({ token }) },
          false,
        );
        applySsoSession(data.access_token, data.user);
        navigate(data.user.role === "TEACHER" ? "/teacher" : "/student", { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "SSO failed");
      }
    })();
  }, [params, navigate, applySsoSession, clearSession]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-200">
      {error ? (
        <div className="max-w-md rounded-xl border border-red-500/60 bg-red-950 px-5 py-4 text-sm text-red-50 shadow-lg">
          <p className="mb-1 font-semibold text-red-200">Could not sign you in</p>
          <p className="text-red-100/90">{error}</p>
          <a href="/login" className="mt-3 inline-block text-xs text-slate-300 underline">
            Go to coding login
          </a>
        </div>
      ) : (
        <p className="text-base text-slate-200">Signing you in…</p>
      )}
    </div>
  );
}
