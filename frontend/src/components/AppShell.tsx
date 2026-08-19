import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { classroomsApi, codingPlatformApi, theoryPlatformApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import { BrandLogo } from "./BrandLogo";
import { NotificationBell } from "./NotificationBell";
import { AccountMenu } from "./AccountMenu";

const roleLabel: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  INSTITUTION_ADMIN: "Institution Admin",
  HOD: "Head of Department",
  CLASS_TEACHER: "Class Teacher",
  SUBJECT_TEACHER: "Subject Teacher",
  STUDENT: "Student",
};

const SIDEBAR_TRANSITION =
  "transition-[width,padding-left,padding-right,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]";
const CONTENT_TRANSITION =
  "transition-[padding-left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]";
const FADE_IN =
  "transition-[opacity,transform,max-width] duration-200 ease-out delay-75";
const FADE_OUT =
  "transition-[opacity,transform,max-width] duration-150 ease-in delay-0";

type NavLinkItem = {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  show: boolean;
};

function SidebarFadeIn({
  show,
  children,
  className = "",
  maxWidthClass = "max-w-[220px]",
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
  maxWidthClass?: string;
}) {
  return (
    <div
      className={[
        "min-w-0 overflow-hidden whitespace-nowrap",
        show ? FADE_IN : FADE_OUT,
        show
          ? `${maxWidthClass} translate-x-0 opacity-100`
          : "pointer-events-none w-0 max-w-0 translate-x-1 opacity-0",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function SidebarSectionLabel({ label, visible }: { label: string; visible: boolean }) {
  return (
    <div
      className={[
        "overflow-hidden",
        visible
          ? "max-h-8 opacity-100 transition-[max-height,opacity] duration-200 ease-out delay-75"
          : "max-h-0 opacity-0 transition-[max-height,opacity] duration-150 ease-in delay-0",
      ].join(" ")}
    >
      <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-[#75777f]">
        {label}
      </p>
    </div>
  );
}

function SidebarNavItem({
  to,
  label,
  icon,
  end,
  expanded,
  layoutExpanded,
}: {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  expanded: boolean;
  layoutExpanded: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={!layoutExpanded ? label : undefined}
      className={({ isActive }) =>
        [
          "flex items-center rounded-xl py-2.5 text-sm transition-[colors,padding,gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] whitespace-nowrap",
          layoutExpanded ? "gap-3 px-3" : "justify-center gap-0 px-0",
          isActive
            ? layoutExpanded
              ? "border-l-4 border-[#6366f1] bg-[#f5f3ff] font-semibold text-[#6366f1]"
              : "bg-[#f5f3ff] font-semibold text-[#6366f1]"
            : layoutExpanded
              ? "border-l-4 border-transparent text-[#031635] hover:bg-[#f8f9fa]"
              : "text-[#031635] hover:bg-[#f8f9fa]",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              isActive ? "bg-[#ede9fe] text-[#6366f1]" : "bg-[#f3f4f6] text-[#75777f]"
            }`}
          >
            <span className="material-symbols-outlined text-xl">{icon}</span>
          </span>
          <SidebarFadeIn show={expanded}>
            <span className="font-medium">{label}</span>
          </SidebarFadeIn>
        </>
      )}
    </NavLink>
  );
}

function mobilePillClass(isActive: boolean) {
  return [
    "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition",
    isActive
      ? "bg-[#6366f1] font-semibold text-white shadow-xs"
      : "border border-[#e1e3e4] bg-white text-[#44474e]",
  ].join(" ");
}

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isTeacher = user?.role === "CLASS_TEACHER" || user?.role === "SUBJECT_TEACHER";
  const isStudent = user?.role === "STUDENT";
  const showCodingTab = isTeacher || isStudent;

  const classroomsSection =
    location.pathname === "/classrooms" || location.pathname.startsWith("/classrooms/");
  const onYourClassrooms =
    location.pathname === "/classrooms" || /^\/classrooms\/\d+(\/.*)?$/.test(location.pathname);
  const onCreateClassroom = location.pathname === "/classrooms/new";
  const activeClassroomId = location.pathname.match(/^\/classrooms\/(\d+)/)?.[1] ?? "";

  const [classroomsOpen, setClassroomsOpen] = useState(classroomsSection);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarLayoutExpanded, setSidebarLayoutExpanded] = useState(false);

  const isExpanded = sidebarPinned || sidebarHovered;

  useEffect(() => {
    if (isExpanded) {
      setSidebarLayoutExpanded(true);
      return;
    }
    const timer = window.setTimeout(() => setSidebarLayoutExpanded(false), 300);
    return () => window.clearTimeout(timer);
  }, [isExpanded]);

  const codingAccess = useQuery({
    queryKey: ["coding-access"],
    queryFn: codingPlatformApi.access,
    enabled: showCodingTab,
    staleTime: 30_000,
  });
  const codingEnabled = codingAccess.data?.enabled === true;

  const theoryAccess = useQuery({
    queryKey: ["theory-access"],
    queryFn: theoryPlatformApi.access,
    enabled: showCodingTab,
    staleTime: 30_000,
  });
  const theoryEnabled = theoryAccess.data?.enabled === true;

  const teacherClassrooms = useQuery({
    queryKey: ["classrooms"],
    queryFn: classroomsApi.list,
    enabled: isTeacher,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (classroomsSection) setClassroomsOpen(true);
  }, [classroomsSection]);

  const mainLinks: NavLinkItem[] = useMemo(
    () =>
      [
        {
          to: "/",
          label: "Dashboard",
          icon: "dashboard",
          end: true,
          show: true,
        },
        {
          to: "/classrooms",
          label: "Classrooms",
          icon: "auto_stories",
          end: true,
          show: user?.role !== "SUPER_ADMIN" && !isTeacher,
        },
        {
          to: "/coding",
          label: codingEnabled ? "Coding" : "Coding (off)",
          icon: "code",
          show: showCodingTab,
        },
        {
          to: "/theory",
          label: theoryEnabled ? "Theory" : "Theory (off)",
          icon: "menu_book",
          show: showCodingTab,
        },
        {
          to: "/practice",
          label: "Practise",
          icon: "school",
          show: isStudent,
        },
      ].filter((l) => l.show),
    [codingEnabled, theoryEnabled, isStudent, isTeacher, showCodingTab, user?.role],
  );

  const resourceLinks: NavLinkItem[] = useMemo(
    () =>
      [
        {
          to: "/institutions",
          label: "Institutions",
          icon: "account_balance",
          show: user?.role === "SUPER_ADMIN" || (user?.role !== "STUDENT" && !!user?.institution_id),
        },
        {
          to: "/team",
          label: "Team",
          icon: "groups",
          show: user?.role === "INSTITUTION_ADMIN" || user?.role === "HOD",
        },
        {
          to: "/subjects",
          label: "Subjects",
          icon: "menu_book",
          show: user?.role !== "SUPER_ADMIN" && user?.role !== "STUDENT",
        },
      ].filter((l) => l.show),
    [user?.institution_id, user?.role],
  );

  const mobileLinks = useMemo(
    () => [...mainLinks, ...resourceLinks],
    [mainLinks, resourceLinks],
  );

  function subTreeClass(isActive: boolean) {
    return [
      "flex items-center gap-2 rounded-lg py-1.5 pl-3 pr-2 text-sm transition-colors whitespace-nowrap",
      isActive
        ? "bg-[#ede9fe] font-semibold text-[#6366f1]"
        : "text-[#44474e] hover:bg-[#f8f9fa] hover:text-[#031635]",
    ].join(" ");
  }

  const showTeacherSubTree = isExpanded && classroomsOpen;

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#f8f9fa] text-[#191c1d] md:flex-row">
      {!sidebarPinned ? (
        <div
          onMouseEnter={() => setSidebarHovered(true)}
          className="fixed left-0 top-0 z-40 hidden h-full w-4 cursor-pointer md:block"
          title="Hover to surface navigation sidebar"
        />
      ) : null}

      <aside
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
        className={[
          "fixed left-0 top-0 z-30 hidden h-full shrink-0 flex-col overflow-hidden border-r border-[#e1e3e4] bg-white py-5 md:flex",
          SIDEBAR_TRANSITION,
          isExpanded ? "w-[260px] px-4 shadow-lg" : "w-16 px-2.5 shadow-none",
        ].join(" ")}
      >
        <div
          className={`mb-6 flex items-center px-1 transition-[justify-content] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarLayoutExpanded ? "justify-between" : "justify-center"}`}
        >
          <div
            className={`flex min-w-0 items-center overflow-hidden transition-[gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarLayoutExpanded ? "gap-2.5" : "gap-0"}`}
          >
            <BrandLogo variant="base" className="h-8 w-auto shrink-0" />
            <SidebarFadeIn show={isExpanded} maxWidthClass="max-w-[160px]">
              <div className="min-w-0">
                <span className="block font-display text-xl font-black tracking-tight text-[#031635]">
                  ASTRA
                </span>
                <p className="-mt-1 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-[#75777f]">
                  Academic Intelligence
                </p>
              </div>
            </SidebarFadeIn>
          </div>

          <SidebarFadeIn show={isExpanded} maxWidthClass="max-w-8">
            <button
              onClick={() => setSidebarPinned(!sidebarPinned)}
              title={sidebarPinned ? "Collapse sidebar" : "Keep sidebar open"}
              className="rounded-md p-1.5 text-[#75777f] transition-colors hover:bg-[#f3f4f6] hover:text-[#6366f1]"
            >
              <span className="material-symbols-outlined text-sm">keyboard_double_arrow_left</span>
            </button>
          </SidebarFadeIn>
        </div>

        <button
          onClick={() => navigate(isTeacher ? "/classrooms/new" : "/classrooms")}
          className={`mb-6 flex w-full items-center rounded-xl bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] py-2.5 text-sm font-semibold text-white shadow-xs transition-[filter,gap,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:brightness-105 ${
            sidebarLayoutExpanded ? "gap-2 px-3" : "justify-center gap-0 px-0"
          }`}
          title={!sidebarLayoutExpanded ? (isTeacher ? "New Classroom" : "Explore Workspace") : undefined}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/95">
            <span className="material-symbols-outlined text-lg text-[#6366f1]">add</span>
          </span>
          <SidebarFadeIn show={isExpanded}>
            <span>{isTeacher ? "New Classroom" : "Explore Workspace"}</span>
          </SidebarFadeIn>
        </button>

        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden pr-0.5">
          <SidebarSectionLabel label="Main" visible={isExpanded && mainLinks.length > 0} />

          {mainLinks.map((link) => (
            <SidebarNavItem
              key={link.to}
              to={link.to}
              label={link.label}
              icon={link.icon}
              end={link.end}
              expanded={isExpanded}
              layoutExpanded={sidebarLayoutExpanded}
            />
          ))}

          {isTeacher ? (
            <div className="pt-1">
              <div
                className={`flex cursor-pointer items-center rounded-xl py-2.5 transition-[colors,padding,gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  sidebarLayoutExpanded ? "justify-between px-3" : "justify-center px-0"
                } ${
                  classroomsSection
                    ? sidebarLayoutExpanded
                      ? "border-l-4 border-[#6366f1] bg-[#f5f3ff] text-[#6366f1]"
                      : "bg-[#f5f3ff] text-[#6366f1]"
                    : sidebarLayoutExpanded
                      ? "border-l-4 border-transparent text-[#031635] hover:bg-[#f8f9fa]"
                      : "text-[#031635] hover:bg-[#f8f9fa]"
                }`}
                title={!sidebarLayoutExpanded ? "Classrooms" : undefined}
                onClick={() => {
                  setClassroomsOpen(true);
                  navigate("/classrooms");
                }}
              >
                <div
                  className={`flex min-w-0 items-center text-sm font-medium transition-[gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    sidebarLayoutExpanded ? "gap-3" : "gap-0"
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      classroomsSection
                        ? "bg-[#ede9fe] text-[#6366f1]"
                        : "bg-[#f3f4f6] text-[#75777f]"
                    }`}
                  >
                    <span className="material-symbols-outlined text-xl">auto_stories</span>
                  </span>
                  <SidebarFadeIn show={isExpanded}>
                    <span className={classroomsSection ? "font-semibold" : ""}>Classrooms</span>
                  </SidebarFadeIn>
                </div>
                <SidebarFadeIn show={isExpanded} maxWidthClass="max-w-6">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setClassroomsOpen(!classroomsOpen);
                    }}
                    className="rounded-md p-0.5 text-[#75777f] hover:text-[#6366f1]"
                  >
                    <span className="material-symbols-outlined text-sm">
                      {classroomsOpen ? "expand_less" : "expand_more"}
                    </span>
                  </button>
                </SidebarFadeIn>
              </div>

              <div
                className={[
                  "overflow-hidden transition-[max-height,opacity] ease-[cubic-bezier(0.22,1,0.36,1)]",
                  showTeacherSubTree
                    ? "max-h-96 opacity-100 duration-300 delay-75"
                    : "max-h-0 opacity-0 duration-150 delay-0",
                ].join(" ")}
              >
                <div className="ml-4 mt-1 space-y-1.5 border-l border-[#e0e7ff] pl-3">
                  <NavLink
                    to="/classrooms"
                    end
                    className={({ isActive }) => subTreeClass(onYourClassrooms && isActive)}
                  >
                    <span className="material-symbols-outlined text-xs">list</span>
                    <span>All Classrooms</span>
                  </NavLink>

                  <div className="px-1">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#75777f]">
                      Open classroom
                    </label>
                    <select
                      className="w-full rounded-md border border-[#e1e3e4] bg-white px-2 py-1.5 text-xs font-medium text-[#031635] outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]"
                      value={activeClassroomId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        if (!nextId) {
                          navigate("/classrooms");
                          return;
                        }
                        navigate(`/classrooms/${nextId}/dashboard`);
                      }}
                      disabled={teacherClassrooms.isLoading}
                    >
                      <option value="">
                        {teacherClassrooms.isLoading
                          ? "Loading…"
                          : teacherClassrooms.data?.length
                            ? "Select a classroom…"
                            : "No classrooms yet"}
                      </option>
                      {(teacherClassrooms.data || []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <NavLink
                    to="/classrooms/new"
                    className={({ isActive }) => subTreeClass(onCreateClassroom && isActive)}
                  >
                    <span className="material-symbols-outlined text-xs">add_circle</span>
                    <span>Create Classroom</span>
                  </NavLink>
                </div>
              </div>
            </div>
          ) : null}

          {resourceLinks.length > 0 ? (
            <hr
              className={[
                "my-3 border-[#e1e3e4]",
                isExpanded
                  ? "opacity-100 transition-opacity duration-200 ease-out delay-75"
                  : "opacity-0 transition-opacity duration-150 ease-in delay-0",
              ].join(" ")}
            />
          ) : null}

          <SidebarSectionLabel
            label="Resources"
            visible={isExpanded && resourceLinks.length > 0}
          />

          {resourceLinks.map((link) => (
            <SidebarNavItem
              key={link.to}
              to={link.to}
              label={link.label}
              icon={link.icon}
              end={link.end}
              expanded={isExpanded}
              layoutExpanded={sidebarLayoutExpanded}
            />
          ))}
        </nav>

        <div className="relative mt-auto border-t border-[#e1e3e4] pt-4">
          <div
            className={[
              isExpanded
                ? "pointer-events-auto opacity-100 transition-opacity duration-200 ease-out delay-75"
                : "pointer-events-none opacity-0 transition-opacity duration-150 ease-in delay-0",
            ].join(" ")}
          >
            <div className="flex items-center justify-between rounded-xl border border-[#e1e3e4] bg-white p-2.5 shadow-xs">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 pr-2">
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="size-9 shrink-0 rounded-full border border-[#e1e3e4] object-cover"
                  />
                ) : (
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#6366f1] text-xs font-bold text-white">
                    {user?.full_name?.charAt(0).toUpperCase() || "U"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#031635]">{user?.full_name}</p>
                  <p className="truncate text-xs text-[#75777f]">{user ? roleLabel[user.role] : ""}</p>
                </div>
              </div>
              <button
                onClick={logout}
                title="Sign Out"
                className="rounded-md p-1 text-[#75777f] transition-colors hover:bg-[#ffdad6]/40 hover:text-[#ba1a1a]"
              >
                <span className="material-symbols-outlined text-lg">logout</span>
              </button>
            </div>
          </div>

          <div
            className={[
              "absolute inset-x-0 top-4 flex justify-center",
              isExpanded
                ? "pointer-events-none opacity-0 transition-opacity duration-150 ease-in delay-0"
                : "pointer-events-auto opacity-100 transition-opacity duration-200 ease-out delay-75",
            ].join(" ")}
          >
            <button
              onClick={logout}
              title={`Sign Out (${user?.full_name})`}
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[#6366f1] text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#ba1a1a]"
            >
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-full object-cover"
                />
              ) : (
                user?.full_name?.charAt(0).toUpperCase() || "U"
              )}
            </button>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#e1e3e4] bg-white px-4 md:hidden">
        <div className="flex items-center gap-2">
          <BrandLogo variant="base" className="h-7 w-auto" />
          <span className="font-display text-lg font-bold text-[#031635]">ASTRA</span>
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell compact />
          <AccountMenu compact />
        </div>
      </header>

      <div className="flex gap-2 overflow-x-auto border-b border-[#e1e3e4] bg-white p-3 md:hidden">
        {mobileLinks.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => mobilePillClass(isActive)}>
            {link.label}
          </NavLink>
        ))}
        {isTeacher ? (
          <>
            <NavLink
              to="/classrooms"
              end
              className={({ isActive }) => mobilePillClass(isActive || onYourClassrooms)}
            >
              Classrooms
            </NavLink>
            <NavLink
              to="/classrooms/new"
              className={({ isActive }) => mobilePillClass(isActive || onCreateClassroom)}
            >
              New classroom
            </NavLink>
          </>
        ) : null}
      </div>

      <div
        className={[
          "flex min-h-screen flex-1 flex-col",
          CONTENT_TRANSITION,
          sidebarPinned ? "md:pl-[260px]" : "md:pl-16",
        ].join(" ")}
      >
        <header className="sticky top-0 z-10 hidden h-16 shrink-0 items-center justify-between border-b border-[#e1e3e4] bg-white px-8 md:flex">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-base font-bold text-[#031635]">Lumina Academic Workspace</h2>
            <span className="rounded-full border border-[#e1e3e4] bg-[#f3f4f5] px-2.5 py-0.5 text-xs font-medium text-[#44474e]">
              Fall Semester 2026
            </span>
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell />
            <AccountMenu />
          </div>
        </header>

        <main className="animate-rise w-full min-w-0 flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
