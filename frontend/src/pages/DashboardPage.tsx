import { useQuery } from "@tanstack/react-query";
import { classroomsApi, institutionsApi, subjectsApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, PageHeader, Panel } from "../components/ui";

export function DashboardPage() {
  const { user } = useAuth();
  const institutions = useQuery({ queryKey: ["institutions"], queryFn: institutionsApi.list });
  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: classroomsApi.list });
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: subjectsApi.list });

  const cards = [
    {
      label: "Institutions",
      value: institutions.data?.length ?? "—",
      hint: user?.role === "SUPER_ADMIN" ? "Platform-wide" : "Your institution scope",
    },
    {
      label: "Classrooms",
      value: classrooms.data?.length ?? "—",
      hint: "Active learning spaces",
    },
    {
      label: "Subjects",
      value: subjects.data?.length ?? "—",
      hint: "Courses you can access",
    },
  ];

  return (
    <div>
      <PageHeader
        title={`Hello, ${user?.full_name.split(" ")[0] ?? "there"}`}
        subtitle="Your Astra workspace for institutions, classrooms, and subjects."
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Panel key={card.label}>
            <p className="text-xs uppercase tracking-[0.16em] text-mist">{card.label}</p>
            <p className="mt-3 font-display text-4xl text-paper">{card.value}</p>
            <p className="mt-2 text-sm text-mist">{card.hint}</p>
          </Panel>
        ))}
      </div>

      <Panel>
        <h2 className="font-display text-2xl text-paper">What you can do now</h2>
        <ul className="mt-4 space-y-2 text-sm text-mist">
          {user?.role === "SUPER_ADMIN" ? (
            <li>Create institutions and assign institution admins from the Institutions page.</li>
          ) : null}
          {user?.role === "INSTITUTION_ADMIN" ? (
            <li>Create departments and HODs from Institutions and Team pages.</li>
          ) : null}
          {user?.role === "HOD" ? (
            <li>Create teachers from Team. Students self-register and join classrooms with a teacher code.</li>
          ) : null}
          {user?.role === "CLASS_TEACHER" || user?.role === "SUBJECT_TEACHER" ? (
            <li>Create classrooms, share the 5-character join code, and approve student join requests.</li>
          ) : null}
          {user?.role === "SUBJECT_TEACHER" || user?.role === "CLASS_TEACHER" ? (
            <li>Manage subjects, syllabus, and course materials.</li>
          ) : null}
          {user?.role === "STUDENT" ? (
            <li>Join classrooms with a teacher join code; access starts after approval.</li>
          ) : null}
          {user?.role === "HOD" ? <li>Monitor department classrooms and subjects.</li> : null}
        </ul>

        {user?.role !== "SUPER_ADMIN" && !classrooms.data?.length ? (
          <div className="mt-6">
            <EmptyState
              title="No classrooms yet"
              body="Create an institution first (Super Admin), then add classrooms from the Classrooms page."
            />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
