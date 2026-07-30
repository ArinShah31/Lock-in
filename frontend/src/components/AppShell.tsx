import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const roleLabel: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  INSTITUTION_ADMIN: "Institution Admin",
  HOD: "Head of Department",
  CLASS_TEACHER: "Class Teacher",
  SUBJECT_TEACHER: "Subject Teacher",
  STUDENT: "Student",
};

export function AppShell() {
  const { user, logout } = useAuth();

  const links = [
    {
      to: "/",
      label: user?.role === "SUPER_ADMIN" ? "Dashboard" : "Overview",
      show: user?.role !== "STUDENT",
    },
    {
      to: "/institutions",
      label: "Institutions",
      show: user?.role === "SUPER_ADMIN" || (user?.role !== "STUDENT" && !!user?.institution_id),
    },
    { to: "/team", label: "Team", show: user?.role === "INSTITUTION_ADMIN" || user?.role === "HOD" },
    { to: "/classrooms", label: "Classrooms", show: user?.role !== "SUPER_ADMIN" },
    { to: "/subjects", label: "Subjects", show: user?.role !== "SUPER_ADMIN" && user?.role !== "STUDENT" },
  ].filter((l) => l.show);

  return (
    <div className="relative min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-6 md:px-8">
        <aside className="animate-rise hidden w-64 shrink-0 flex-col rounded-3xl border border-line/70 bg-panel/70 p-5 backdrop-blur md:flex">
          <div className="mb-8">
            <p className="font-display text-3xl font-extrabold tracking-tight text-paper">ASTRA</p>
            <p className="mt-1 text-sm text-mist">Academic Intelligence</p>
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/"}
                className={({ isActive }) =>
                  `rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? "bg-accent/15 text-accent"
                      : "text-mist hover:bg-white/5 hover:text-paper"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-6 border-t border-line/60 pt-4">
            <p className="text-sm font-semibold text-paper">{user?.full_name}</p>
            <p className="text-xs text-mist">{user ? roleLabel[user.role] : ""}</p>
            <button
              type="button"
              onClick={logout}
              className="mt-3 w-full rounded-xl border border-line px-3 py-2 text-left text-sm text-mist transition hover:border-accent/40 hover:text-paper"
            >
              Sign out
            </button>
          </div>
        </aside>

        <main className="animate-rise-delay min-w-0 flex-1">
          <header className="mb-6 flex items-center justify-between rounded-3xl border border-line/70 bg-panel/50 px-5 py-4 backdrop-blur md:hidden">
            <div>
              <p className="font-display text-2xl text-paper">ASTRA</p>
              <p className="text-xs text-mist">{user?.full_name}</p>
            </div>
            <button type="button" onClick={logout} className="text-sm text-accent">
              Sign out
            </button>
          </header>

          <div className="mb-4 flex gap-2 overflow-x-auto md:hidden">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/"}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${
                    isActive ? "bg-accent text-ink" : "bg-panel text-mist"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>

          <Outlet />
        </main>
      </div>
    </div>
  );
}
