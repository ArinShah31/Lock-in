import type { ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { classroomsApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, PageHeader, Panel, SlidingIndicator } from "../components/ui";

function tabClass({ isActive }: { isActive: boolean }) {
  return [
    "relative border-b-2 border-transparent px-1 pb-2 text-sm font-semibold transition",
    isActive ? "text-[#031635]" : "text-[#44474e] hover:text-[#031635]",
  ].join(" ");
}

function Tab({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink to={to} className={tabClass}>
      {({ isActive }) => (
        <>
          {children}
          {isActive ? (
            <SlidingIndicator
              layoutId="classroom-tab-indicator"
              className="absolute inset-x-0 -bottom-[2px] h-[2px] bg-[#4f46e5]"
            />
          ) : null}
        </>
      )}
    </NavLink>
  );
}

export function ClassroomLayout() {
  const { classroomId } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const id = classroomId ? Number(classroomId) : NaN;
  const invalid = Number.isNaN(id);
  const isStudent = user?.role === "STUDENT";
  const isLeaderboard = location.pathname.endsWith("/leaderboard");

  const classroom = useQuery({
    queryKey: ["classroom", id],
    queryFn: () => classroomsApi.get(id),
    enabled: !invalid,
  });

  if (invalid) return <Navigate to="/classrooms" replace />;

  if (classroom.isLoading) {
    return (
      <div>
        <PageHeader title="Classroom" subtitle="Loading…" />
      </div>
    );
  }

  if (classroom.isError || !classroom.data) {
    return (
      <div>
        <PageHeader title="Classroom" subtitle="Could not load this classroom." />
        <ErrorText message={classroom.error instanceof Error ? classroom.error.message : "Not found"} />
        <NavLink to="/classrooms" className="text-sm font-semibold text-[#4f46e5] hover:underline">
          Back to classrooms
        </NavLink>
      </div>
    );
  }

  const c = classroom.data;

  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={`${c.code}${c.academic_year ? ` · ${c.academic_year}` : ""}${c.is_active ? "" : " · Inactive"}`}
        serif
      />
      <div className="mb-4">
        <NavLink to="/classrooms" className="text-sm font-semibold text-[#4f46e5] hover:underline">
          ← Back to classrooms
        </NavLink>
      </div>

      <div className="mb-6 flex flex-wrap gap-6 border-b border-[#e1e3e4]">
        <Tab to={`/classrooms/${id}/dashboard`}>Dashboard</Tab>

        <Tab to={`/classrooms/${id}/details`}>Details</Tab>

        {!isStudent ? <Tab to={`/classrooms/${id}/announcements`}>Announcements</Tab> : null}

        <Tab to={`/classrooms/${id}/course-builder`}>{isStudent ? "Course" : "Course builder"}</Tab>

        <Tab to={`/classrooms/${id}/documents`}>Documents</Tab>

        <Tab to={`/classrooms/${id}/presentations`}>Presentations</Tab>

        <Tab to={`/classrooms/${id}/assignments`}>Assignments</Tab>

        <Tab to={`/classrooms/${id}/leaderboard`}>Leaderboard</Tab>

        {user && user.id === c.class_teacher_id ? (
          <Tab to={`/classrooms/${id}/analytics`}>Analytics</Tab>
        ) : null}
      </div>

      {isLeaderboard ? (
        <Outlet context={{ classroom: c }} />
      ) : (
        <Panel>
          <Outlet context={{ classroom: c }} />
        </Panel>
      )}
    </div>
  );
}
