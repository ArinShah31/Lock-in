import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { classroomsApi, codingPlatformApi } from "../api";
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
  icon: string;
  end?: boolean;
  show: boolean;
};

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

  const codingAccess = useQuery({
    queryKey: ["coding-access"],
    queryFn: codingPlatformApi.access,
    enabled: showCodingTab,
    staleTime: 30_000,
  });
  const codingEnabled = codingAccess.data?.enabled === true;

  const teacherClassrooms = useQuery({
    queryKey: ["classrooms"],
    queryFn: classroomsApi.list,
    enabled: isTeacher,
    staleTime: 30_000,
  });

  // Auto-hide Left Sidebar States (Windows Taskbar style)
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);

  const isExpanded = sidebarPinned || sidebarHovered;

  useEffect(() => {
    if (classroomsSection) setClassroomsOpen(true);
  }, [classroomsSection]);

  const flatLinks: FlatLink[] = [
    {
      to: "/",
      label: "Dashboard",
      icon: "dashboard",
      end: true,
      show: true,
    },
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
      to: "/classrooms",
      label: "Classrooms",
      icon: "auto_stories",
      end: true,
      show: user?.role !== "SUPER_ADMIN" && !isTeacher,
    },
    {
      to: "/subjects",
      label: "Subjects",
      icon: "menu_book",
      show: user?.role !== "SUPER_ADMIN" && user?.role !== "STUDENT",
    },
    {
      to: "/coding",
      label: codingEnabled ? "Coding" : "Coding (off)",
      icon: "code",
      show: showCodingTab,
    },
    {
      to: "/practice",
      label: "Practise",
      icon: "local_library",
      show: isStudent,
    },
  ].filter((l) => l.show);

  function navItemClass(isActive: boolean) {
    return `flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
      isActive
        ? "bg-[#031635] text-white font-semibold shadow-xs"
        : "text-[#44474e] hover:bg-[#e1e3e4]/60 hover:text-[#191c1d]"
    }`;
  }

  function subTreeClass(isActive: boolean) {
    return `flex items-center gap-2 py-1.5 pl-3 pr-2 rounded-md text-sm transition-all whitespace-nowrap ${
      isActive ? "text-[#031635] font-semibold bg-[#e1e3e4]/50" : "text-[#44474e] hover:text-[#191c1d]"
    }`;
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#191c1d] flex flex-col md:flex-row overflow-x-hidden relative">
      {/* Invisible Hover Trigger Edge for Desktop (Windows Auto-Hide Taskbar style) */}
      {!sidebarPinned && (
        <div
          onMouseEnter={() => setSidebarHovered(true)}
          className="hidden md:block fixed left-0 top-0 h-full w-4 z-40 cursor-pointer"
          title="Hover to surface navigation sidebar"
        />
      )}

      {/* SideNavBar (Desktop Auto-Hide / Collapsible) */}
      <aside
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
        className={`hidden md:flex flex-col fixed left-0 top-0 h-full bg-[#f3f4f5] border-r border-[#e1e3e4] py-5 z-30 shrink-0 transition-all duration-300 ease-in-out ${
          isExpanded ? "w-[260px] px-4 shadow-2xl" : "w-16 px-2.5 shadow-none"
        }`}
      >
        {/* Header (Logo & Pin Toggle Button) */}
        <div className="mb-6 flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <span className="material-symbols-outlined text-[#031635] text-2xl font-bold flex-shrink-0">
              auto_awesome
            </span>
            {isExpanded && (
              <div className="min-w-0 transition-opacity duration-200">
                <span className="font-display text-xl font-black text-[#031635] tracking-tight block">
                  ASTRA
                </span>
                <p className="text-[10px] text-[#44474e] font-semibold tracking-wider uppercase -mt-1 whitespace-nowrap">
                  Academic Intelligence
                </p>
              </div>
            )}
          </div>

          {/* Pin/Unpin Toggle Button */}
          {isExpanded && (
            <button
              onClick={() => setSidebarPinned(!sidebarPinned)}
              title={sidebarPinned ? "Unpin sidebar (Auto-hide on mouse leave)" : "Pin sidebar open"}
              className={`p-1.5 rounded-md transition-colors ${
                sidebarPinned
                  ? "bg-[#031635] text-white"
                  : "text-[#75777f] hover:text-[#031635] hover:bg-[#e1e3e4]"
              }`}
            >
              <span className="material-symbols-outlined text-sm">
                {sidebarPinned ? "push_pin" : "keep_off"}
              </span>
            </button>
          )}
        </div>

        {/* Action Button */}
        <button
          onClick={() => navigate(isTeacher ? "/classrooms/new" : "/classrooms")}
          className={`w-full bg-[#031635] text-white rounded-lg font-semibold text-sm mb-6 hover:bg-[#1a2b4b] transition-all shadow-xs flex items-center justify-center gap-2 ${
            isExpanded ? "py-2.5 px-4" : "py-2.5 px-0"
          }`}
          title={!isExpanded ? (isTeacher ? "New Classroom" : "Explore Workspace") : undefined}
        >
          <span className="material-symbols-outlined text-lg flex-shrink-0">add</span>
          {isExpanded && <span>{isTeacher ? "New Classroom" : "Explore Workspace"}</span>}
        </button>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {flatLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              title={!isExpanded ? link.label : undefined}
              className={({ isActive }) => navItemClass(isActive)}
            >
              <span className="material-symbols-outlined text-xl flex-shrink-0">{link.icon}</span>
              {isExpanded && <span>{link.label}</span>}
            </NavLink>
          ))}

          {isTeacher ? (
            <div className="pt-1">
              <div
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                  classroomsSection ? "bg-[#e1e3e4]/60 text-[#031635]" : "text-[#44474e] hover:bg-[#e1e3e4]/60"
                }`}
                title={!isExpanded ? "Classrooms" : undefined}
                onClick={() => {
                  setClassroomsOpen(true);
                  navigate("/classrooms");
                }}
              >
                <div className="flex items-center gap-3 font-medium text-sm">
                  <span className="material-symbols-outlined text-xl flex-shrink-0">school</span>
                  {isExpanded && <span>Classrooms</span>}
                </div>
                {isExpanded && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setClassroomsOpen(!classroomsOpen);
                    }}
                    className="text-[#75777f] hover:text-[#191c1d] p-0.5"
                  >
                    <span className="material-symbols-outlined text-sm">
                      {classroomsOpen ? "expand_less" : "expand_more"}
                    </span>
                  </button>
                )}
              </div>

              {isTeacher && isExpanded && classroomsOpen ? (
                <div className="ml-7 mt-1 border-l border-[#c5c6cf] pl-2 space-y-1.5">
                  <NavLink to="/classrooms" end className={({ isActive }) => subTreeClass(onYourClassrooms && isActive)}>
                    <span className="material-symbols-outlined text-xs">list</span>
                    <span>All Classrooms</span>
                  </NavLink>

                  <div className="px-1">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#75777f]">
                      Open classroom
                    </label>
                    <select
                      className="w-full rounded-md border border-[#c5c6cf] bg-white px-2 py-1.5 text-xs font-medium text-[#031635] outline-none focus:border-[#031635] focus:ring-1 focus:ring-[#031635]"
                      value={activeClassroomId}
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) {
                          navigate("/classrooms");
                          return;
                        }
                        navigate(`/classrooms/${id}/dashboard`);
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

                  <NavLink to="/classrooms/new" className={({ isActive }) => subTreeClass(onCreateClassroom && isActive)}>
                    <span className="material-symbols-outlined text-xs">add_circle</span>
                    <span>Create Classroom</span>
                  </NavLink>
                </div>
              ) : null}
            </div>
          ) : null}
        </nav>

        {/* User Profile Footer */}
        <div className="mt-auto pt-4 border-t border-[#e1e3e4]">
          {isExpanded ? (
            <div className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-[#e1e3e4] shadow-xs">
              <div className="min-w-0 flex-1 pr-2">
                <p className="text-sm font-semibold text-[#031635] truncate">{user?.full_name}</p>
                <p className="text-xs text-[#44474e] truncate">{user ? roleLabel[user.role] : ""}</p>
              </div>
              <button
                onClick={logout}
                title="Sign Out"
                className="text-[#75777f] hover:text-[#ba1a1a] transition-colors p-1 rounded-md hover:bg-[#ffdad6]/40"
              >
                <span className="material-symbols-outlined text-lg">logout</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={logout}
                title={`Sign Out (${user?.full_name})`}
                className="w-10 h-10 rounded-full bg-[#031635] text-white flex items-center justify-center font-bold text-xs hover:bg-[#ba1a1a] transition-colors shadow-xs"
              >
                {user?.full_name?.charAt(0).toUpperCase() || "U"}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Top Header for Mobile */}
      <header className="md:hidden flex items-center justify-between px-4 h-16 bg-white border-b border-[#e1e3e4] sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#031635] text-xl font-bold">auto_awesome</span>
          <span className="font-display font-bold text-[#031635] text-lg">ASTRA</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold px-2 py-1 bg-[#e8edf5] text-[#031635] rounded-full">
            {user ? roleLabel[user.role] : ""}
          </span>
          <button onClick={logout} className="text-[#44474e] hover:text-[#ba1a1a]">
            <span className="material-symbols-outlined text-xl">logout</span>
          </button>
        </div>
      </header>

      {/* Mobile Nav Horizontal Scroll */}
      <div className="md:hidden flex gap-2 overflow-x-auto p-3 bg-[#f3f4f5] border-b border-[#e1e3e4]">
        {flatLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition ${
                isActive ? "bg-[#031635] text-white font-semibold" : "bg-white text-[#44474e] border border-[#e1e3e4]"
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
        {isTeacher ? (
          <>
            <NavLink
              to="/classrooms"
              end
              className={({ isActive }) =>
                `whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  isActive || onYourClassrooms
                    ? "bg-[#031635] text-white font-semibold"
                    : "bg-white text-[#44474e] border border-[#e1e3e4]"
                }`
              }
            >
              Classrooms
            </NavLink>
            <NavLink
              to="/classrooms/new"
              className={({ isActive }) =>
                `whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  isActive ? "bg-[#031635] text-white font-semibold" : "bg-white text-[#44474e] border border-[#e1e3e4]"
                }`
              }
            >
              New classroom
            </NavLink>
          </>
        ) : null}
      </div>

      {/* Main Content Workspace (Center Column) */}
      <div
        className={`flex-1 flex flex-col transition-all duration-300 ease-in-out min-h-screen ${
          sidebarPinned ? "md:pl-[260px]" : "md:pl-16"
        }`}
      >
        {/* Desktop Top Bar */}
        <header className="hidden md:flex justify-between items-center px-8 h-16 bg-white border-b border-[#e1e3e4] sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-[#031635] font-bold text-base">
              Lumina Academic Workspace
            </h2>
            <span className="text-xs bg-[#f3f4f5] text-[#44474e] border border-[#e1e3e4] px-2.5 py-0.5 rounded-full font-medium">
              Fall Semester 2026
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Notifications (coming soon)"
              className="flex size-9 items-center justify-center rounded-full border border-[#e1e3e4] bg-[#f8f9fa] text-[#44474e] transition hover:bg-white hover:text-[#031635]"
            >
              <span className="material-symbols-outlined text-xl">notifications</span>
            </button>
            <button
              type="button"
              title={user ? `${user.full_name} (profile coming soon)` : "Profile (coming soon)"}
              className="flex size-9 items-center justify-center rounded-full bg-[#031635] text-sm font-bold text-white transition hover:bg-[#1a2b4b]"
            >
              {user?.full_name?.charAt(0)?.toUpperCase() || (
                <span className="material-symbols-outlined text-lg">person</span>
              )}
            </button>
          </div>
        </header>

        {/* Main Content Outlet */}
        <main className="flex-1 p-4 md:p-8 animate-rise w-full min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
