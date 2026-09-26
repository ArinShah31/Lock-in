import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Role, type User } from "./api";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: {
    full_name: string;
    email: string;
    password: string;
    role: Role;
  }) => Promise<void>;
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
    // Incoming ASTRA SSO must not be overwritten by a previous theory session.
    if (isSsoRoute()) {
      localStorage.removeItem("theory_access_token");
      setUser(null);
      setLoading(false);
      return;
    }

    const token = localStorage.getItem("theory_access_token");
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
        localStorage.removeItem("theory_access_token");
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
      login: async (email, password) => {
        const data = await api<{ access_token: string; user: User }>(
          "/auth/login",
          { method: "POST", body: JSON.stringify({ email, password }) },
          false,
        );
        sessionGen.current += 1;
        localStorage.setItem("theory_access_token", data.access_token);
        setUser(data.user);
        setLoading(false);
      },
      register: async (payload) => {
        const data = await api<{ access_token: string; user: User }>(
          "/auth/register",
          { method: "POST", body: JSON.stringify(payload) },
          false,
        );
        sessionGen.current += 1;
        localStorage.setItem("theory_access_token", data.access_token);
        setUser(data.user);
        setLoading(false);
      },
      applySsoSession: (accessToken, nextUser) => {
        sessionGen.current += 1;
        localStorage.setItem("theory_access_token", accessToken);
        setUser(nextUser);
        setLoading(false);
      },
      clearSession: () => {
        sessionGen.current += 1;
        localStorage.removeItem("theory_access_token");
        setUser(null);
        setLoading(false);
      },
      logout: () => {
        sessionGen.current += 1;
        localStorage.removeItem("theory_access_token");
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
