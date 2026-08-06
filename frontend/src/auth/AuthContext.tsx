import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authApi, logoutLocal, persistSession } from "../api";
import { clearCodingToken } from "../api/codingClient";
import type { AuthResponse, User, UserRole } from "../api/types";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: {
    full_name: string;
    email: string;
    password: string;
    role: UserRole;
    institution_id?: number | null;
    department_id?: number | null;
  }) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredUser(): User | null {
  const raw = localStorage.getItem("astra_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(readStoredUser);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((data: AuthResponse) => {
    clearCodingToken();
    persistSession(data);
    setUser(data.user);
  }, []);

  const refreshMe = useCallback(async () => {
    const token = localStorage.getItem("astra_access_token");
    if (!token) {
      clearCodingToken();
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await authApi.me();
      localStorage.setItem("astra_user", JSON.stringify(me));
      setUser(me);
    } catch {
      logoutLocal();
      clearCodingToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const onSessionExpired = () => {
      logoutLocal();
      clearCodingToken();
      setUser(null);
    };
    window.addEventListener("astra:session-expired", onSessionExpired);
    return () => window.removeEventListener("astra:session-expired", onSessionExpired);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: async (email, password) => {
        const data = await authApi.login({ email, password });
        applySession(data);
      },
      register: async (payload) => {
        const data = await authApi.register(payload);
        applySession(data);
      },
      logout: () => {
        logoutLocal();
        clearCodingToken();
        setUser(null);
      },
      refreshMe,
    }),
    [applySession, loading, refreshMe, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
