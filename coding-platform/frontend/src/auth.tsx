import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type User } from "./api";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  applySsoSession: (accessToken: string, user: User) => void;
  clearSession: () => void;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

function isSsoRoute() {
  return window.location.pathname === "/sso";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionGen = useRef(0);

  useEffect(() => {
    // Incoming ASTRA SSO must not be overwritten by a previous coding session.
    if (isSsoRoute()) {
      localStorage.removeItem("coding_access_token");
      setUser(null);
      setLoading(false);
      return;
    }

    const token = localStorage.getItem("coding_access_token");
    if (!token) {
      setLoading(false);
      return;
    }

    const gen = sessionGen.current;
    api<User>("/auth/me")
      .then((me) => {
        if (sessionGen.current !== gen) return;
        setUser(me);
      })
      .catch(() => {
        if (sessionGen.current !== gen) return;
        localStorage.removeItem("coding_access_token");
        setUser(null);
      })
      .finally(() => {
        if (sessionGen.current !== gen) return;
        setLoading(false);
      });
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      applySsoSession: (accessToken, nextUser) => {
        sessionGen.current += 1;
        localStorage.setItem("coding_access_token", accessToken);
        setUser(nextUser);
        setLoading(false);
      },
      clearSession: () => {
        sessionGen.current += 1;
        localStorage.removeItem("coding_access_token");
        setUser(null);
        setLoading(false);
      },
      logout: () => {
        sessionGen.current += 1;
        localStorage.removeItem("coding_access_token");
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
