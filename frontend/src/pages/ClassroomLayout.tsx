import { NavLink, Navigate, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { classroomsApi } from "../api";
import { ErrorText, PageHeader, Panel } from "../components/ui";

function tabClass({ isActive }: { isActive: boolean }) {
  return [
    "border-b-2 px-1 pb-2 text-sm font-semibold transition",
    isActive ? "border-accent text-paper" : "border-transparent text-mist hover:text-paper",
  ].join(" ");
}

export function ClassroomLayout() {
  const { classroomId } = useParams();
  const id = classroomId ? Number(classroomId) : NaN;
  const invalid = Number.isNaN(id);

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

      <div className="mb-6 flex gap-6 border-b border-line">
  <NavLink to={`/classrooms/${id}/dashboard`} className={tabClass}>
    Dashboard
  </NavLink>

  <NavLink to={`/classrooms/${id}/details`} className={tabClass}>
    Details
  </NavLink>

  <NavLink to={`/classrooms/${id}/course-builder`} className={tabClass}>
    Course builder
  </NavLink>

  <NavLink to={`/classrooms/${id}/documents`} className={tabClass}>
    Documents
  </NavLink>

  <NavLink to={`/classrooms/${id}/assignments`} className={tabClass}>
    Assignments
  </NavLink>
</div>

      <Panel>
        <Outlet context={{ classroom: c }} />
      </Panel>
    </div>
  );
}
