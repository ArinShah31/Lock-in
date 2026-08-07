import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type User } from "../api";
import { useAuth } from "../auth";
import { MagicCard } from "../components/ui/magic-card";

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
    <div className="flex min-h-screen items-center justify-center p-6">
      <MagicCard className="w-full max-w-md p-5 shadow-sm">
        {error ? (
          <div className="text-sm">
            <p className="font-semibold text-[#a03a3a]">Could not sign you in</p>
            <p className="mt-1 text-[#44474e]">{error}</p>
            <a href="/login" className="mt-3 inline-block text-xs font-semibold text-[#3f5d9b] underline">
              Go to coding login
            </a>
          </div>
        ) : (
          <p className="text-sm text-[#44474e]">Signing you in to Astra Coding…</p>
        )}
      </MagicCard>
    </div>
  );
}
