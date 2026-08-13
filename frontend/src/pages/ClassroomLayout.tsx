import { NavLink, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { classroomsApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, PageHeader, Panel } from "../components/ui";

function tabClass({ isActive }: { isActive: boolean }) {
  return [
    "border-b-2 px-1 pb-2 text-sm font-semibold transition",
    isActive ? "border-accent text-paper" : "border-transparent text-mist hover:text-paper",
  ].join(" ");
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
        <NavLink to="/classrooms" className="text-sm font-semibold text-accent hover:underline">
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
      />
      <div className="mb-4">
        <NavLink to="/classrooms" className="text-sm font-semibold text-accent hover:underline">
          ← Back to classrooms
        </NavLink>
      </div>

      <div className="mb-6 flex flex-wrap gap-6 border-b border-line">
        <NavLink to={`/classrooms/${id}/dashboard`} className={tabClass}>
          Dashboard
        </NavLink>

        <NavLink to={`/classrooms/${id}/details`} className={tabClass}>
          Details
        </NavLink>

        {!isStudent ? (
          <NavLink to={`/classrooms/${id}/announcements`} className={tabClass}>
            Announcements
          </NavLink>
        ) : null}

        <NavLink to={`/classrooms/${id}/course-builder`} className={tabClass}>
          {isStudent ? "Course" : "Course builder"}
        </NavLink>

        <NavLink to={`/classrooms/${id}/documents`} className={tabClass}>
          Documents
        </NavLink>

        <NavLink to={`/classrooms/${id}/assignments`} className={tabClass}>
          Assignments
        </NavLink>

        <NavLink to={`/classrooms/${id}/leaderboard`} className={tabClass}>
          Leaderboard
        </NavLink>

        {user && user.id === c.class_teacher_id ? (
          <NavLink to={`/classrooms/${id}/analytics`} className={tabClass}>
            Analytics
          </NavLink>
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
