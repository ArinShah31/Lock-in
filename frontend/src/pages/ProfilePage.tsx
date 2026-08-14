import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "../api";
import type { ProfileActivity } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { EditProfileModal } from "../components/EditProfileModal";
import {
  EmptyState,
  ErrorText,
  PageHeader,
  Panel,
  PrimaryButton,
} from "../components/ui";

const roleLabel: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  INSTITUTION_ADMIN: "Institution Admin",
  HOD: "Head of Department",
  CLASS_TEACHER: "Class Teacher",
  SUBJECT_TEACHER: "Subject Teacher",
  STUDENT: "Student",
};

function formatRelativeTime(iso: string) {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Panel className="text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#75777f]">{label}</p>
      <p className="mt-2 font-display text-2xl font-extrabold text-[#031635]">{value}</p>
    </Panel>
  );
}

function ActivityList({ items }: { items: ProfileActivity[] }) {
  if (!items.length) {
    return <EmptyState title="No recent activity" body="Your learning actions will appear here as you complete assignments and practice." />;
  }
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item.kind}-${item.occurred_at}-${index}`} className="rounded-lg border border-[#e1e3e4] px-4 py-3">
          <p className="text-sm font-semibold text-[#031635]">{item.title}</p>
          <p className="text-xs text-[#75777f]">{item.subtitle}</p>
          <p className="mt-1 text-xs text-[#44474e]">{formatRelativeTime(item.occurred_at)}</p>
        </div>
      ))}
    </div>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const editAnchorRef = useRef<HTMLDivElement>(null);
  const profile = useQuery({
    queryKey: ["my-profile"],
    queryFn: authApi.profile,
    enabled: !!user,
  });

  const identity = profile.data?.identity;
  const subtitle = useMemo(() => {
    if (!identity) return "";
    return [identity.department_name, identity.institution_name].filter(Boolean).join(" · ");
  }, [identity]);

  if (profile.isLoading) {
    return <p className="text-sm text-[#44474e]">Loading profile...</p>;
  }
  if (profile.error) {
    return <ErrorText message={profile.error instanceof Error ? profile.error.message : "Could not load profile"} />;
  }
  if (!profile.data || !identity) return null;

  const avatarSrc = identity.avatar_url?.startsWith("http") ? identity.avatar_url : identity.avatar_url || undefined;
  const isStudent = !!profile.data.student;
  const isTeacher = !!profile.data.teacher;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="My Profile"
        subtitle="Your academic identity and progress in ASTRA."
        action={
          <div ref={editAnchorRef} className="inline-flex">
            <PrimaryButton onClick={() => setEditOpen(true)}>Edit Profile</PrimaryButton>
          </div>
        }
      />

      <Panel className="overflow-hidden">
        <div className="flex items-center gap-4">
          <div className="flex size-20 items-center justify-center overflow-hidden rounded-full bg-[#6366f1] text-2xl font-bold text-white">
            {avatarSrc ? (
              <img src={avatarSrc} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
            ) : (
              identity.full_name.charAt(0).toUpperCase()
            )}
          </div>
          <div>
            <h2 className="font-display text-2xl font-extrabold text-[#031635]">{identity.full_name}</h2>
            {subtitle ? <p className="text-sm text-[#44474e]">{subtitle}</p> : null}
            <p className="mt-2 inline-flex rounded-full bg-[#ede9fe] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[#6366f1]">
              {roleLabel[identity.role] ?? identity.role}
            </p>
          </div>
        </div>
      </Panel>

      {isStudent && profile.data.student ? (
        <>
          <section className="space-y-3">
            <h3 className="font-display text-lg font-bold text-[#031635]">Academic Overview</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Classrooms" value={profile.data.student.academic_overview.classrooms} />
              <StatCard label="Completed" value={profile.data.student.academic_overview.assignments_completed} />
              <StatCard
                label="Avg Score"
                value={
                  profile.data.student.academic_overview.average_score_pct != null
                    ? `${profile.data.student.academic_overview.average_score_pct}%`
                    : "—"
                }
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="font-display text-lg font-bold text-[#031635]">Achievements</h3>
            <EmptyState
              title="Achievements coming soon"
              body="This section is reserved for future badges and milestones."
            />
          </section>

          <section className="space-y-3">
            <h3 className="font-display text-lg font-bold text-[#031635]">Recent Activity</h3>
            <ActivityList items={profile.data.student.recent_activity} />
          </section>
        </>
      ) : null}

      {isTeacher && profile.data.teacher ? (
        <>
          <section className="space-y-3">
            <h3 className="font-display text-lg font-bold text-[#031635]">Teaching Overview</h3>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard label="Classrooms" value={profile.data.teacher.teaching_overview.classrooms} />
              <StatCard label="Students" value={profile.data.teacher.teaching_overview.students} />
              <StatCard label="Assignments" value={profile.data.teacher.teaching_overview.assignments} />
              <StatCard label="Documents" value={profile.data.teacher.teaching_overview.documents} />
              <StatCard label="Submissions" value={profile.data.teacher.teaching_overview.submissions} />
              <StatCard
                label="Avg. Score"
                value={
                  profile.data.teacher.teaching_overview.average_score_pct != null
                    ? `${profile.data.teacher.teaching_overview.average_score_pct}%`
                    : "—"
                }
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="font-display text-lg font-bold text-[#031635]">Teaching Activity</h3>
            <ActivityList items={profile.data.teacher.recent_activity} />
          </section>
        </>
      ) : null}

      <EditProfileModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initialName={identity.full_name}
        onSaved={() => void profile.refetch()}
        anchorRef={editAnchorRef}
      />
    </div>
  );
}
