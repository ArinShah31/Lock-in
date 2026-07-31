import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const roleLabel: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  INSTITUTION_ADMIN: "Institution Admin",
  HOD: "Head of Department",
  CLASS_TEACHER: "Class Teacher",
  SUBJECT_TEACHER: "Subject Teacher",
  STUDENT: "Student",
};

type FlatLink = {
  to: string;
  label: string;
  end?: boolean;
  show: boolean;
};

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isTeacher = user?.role === "CLASS_TEACHER" || user?.role === "SUBJECT_TEACHER";
  const classroomsSection =
    location.pathname === "/classrooms" || location.pathname.startsWith("/classrooms/");
  const onYourClassrooms =
    location.pathname === "/classrooms" || /^\/classrooms\/\d+(\/.*)?$/.test(location.pathname);
  const onCreateClassroom = location.pathname === "/classrooms/new";

  const [classroomsOpen, setClassroomsOpen] = useState(classroomsSection);

  useEffect(() => {
    if (classroomsSection) setClassroomsOpen(true);
  }, [classroomsSection]);

  const flatLinks: FlatLink[] = [
    {
      to: "/",
      label: user?.role === "SUPER_ADMIN" ? "Dashboard" : "Overview",
      end: true,
      show: user?.role !== "STUDENT",
    },
    {
      to: "/institutions",
      label: "Institutions",
      show: user?.role === "SUPER_ADMIN" || (user?.role !== "STUDENT" && !!user?.institution_id),
    },
    {
      to: "/team",
      label: "Team",
      show: user?.role === "INSTITUTION_ADMIN" || user?.role === "HOD",
    },
    {
      to: "/classrooms",
      label: "Classrooms",
      end: true,
      show: user?.role !== "SUPER_ADMIN" && !isTeacher,
    },
    {
      to: "/subjects",
      label: "Subjects",
      show: user?.role !== "SUPER_ADMIN" && user?.role !== "STUDENT",
    },
  ].filter((l) => l.show);

  function topLinkClass(isActive: boolean) {
    return `flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
      isActive ? "bg-accent/15 text-accent" : "text-mist hover:bg-white/5 hover:text-paper"
    }`;
  }

  function treeItemClass(isActive: boolean) {
    return `relative flex items-center gap-2 rounded-lg py-1.5 pl-1 pr-2 text-sm transition ${
      isActive ? "text-accent" : "text-mist hover:text-paper"
    }`;
  }

  const mobileLinks: { to: string; label: string; end?: boolean }[] = [
    ...flatLinks.map((l) => ({ to: l.to, label: l.label, end: l.end })),
  ];
  if (isTeacher) {
    mobileLinks.push({ to: "/classrooms", label: "Your classrooms", end: true });
    mobileLinks.push({ to: "/classrooms/new", label: "Create classroom" });
  }

  return (
    <div className="relative min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-6 md:px-8">
        <aside className="animate-rise hidden w-64 shrink-0 flex-col rounded-3xl border border-line/70 bg-panel/70 p-5 backdrop-blur md:flex">
          <div className="mb-8">
            <p className="font-display text-3xl font-extrabold tracking-tight text-paper">ASTRA</p>
            <p className="mt-1 text-sm text-mist">Academic Intelligence</p>
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            {flatLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) => topLinkClass(isActive)}
              >
                <span>{link.label}</span>
              </NavLink>
            ))}

            {isTeacher ? (
              <div>
                <div className={topLinkClass(classroomsSection)}>
                  <button
                    type="button"
                    className="flex-1 text-left"
                    onClick={() => {
                      setClassroomsOpen(true);
                      navigate("/classrooms");
                    }}
                  >
                    Classrooms
                  </button>
                  <button
                    type="button"
                    aria-label={classroomsOpen ? "Collapse classrooms" : "Expand classrooms"}
                    className="rounded-md p-0.5 hover:bg-white/5"
                    onClick={() => setClassroomsOpen((open) => !open)}
                  >
                    <svg
                      className={`h-4 w-4 shrink-0 transition-transform ${classroomsOpen ? "rotate-180" : ""}`}
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>

                {classroomsOpen ? (
                  <ul className="relative ml-4 mt-1 space-y-0.5 border-l border-line/70 pl-3">
                    <li>
                      <NavLink to="/classrooms" end className={treeItemClass(onYourClassrooms)}>
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            onYourClassrooms ? "bg-accent" : "border border-mist/60 bg-transparent"
                          }`}
                        />
                        <span>Your classrooms</span>
                      </NavLink>
                    </li>
                    <li>
                      <NavLink to="/classrooms/new" className={treeItemClass(onCreateClassroom)}>
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            onCreateClassroom ? "bg-accent" : "border border-mist/60 bg-transparent"
                          }`}
                        />
                        <span>Create classroom</span>
                      </NavLink>
                    </li>
                  </ul>
                ) : null}
              </div>
            ) : null}
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
            {mobileLinks.map((link) => (
              <NavLink
                key={`${link.to}-${link.label}`}
                to={link.to}
                end={link.end}
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
