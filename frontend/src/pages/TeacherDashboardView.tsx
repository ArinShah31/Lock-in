import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { classroomsApi, codingPlatformApi } from "../api";
import type { TeacherClassroomCard, TeacherOverview } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { TeacherAiChatWidget } from "../components/TeacherAiChatWidget";
import { TeacherCodingAnalyticsPanel } from "../components/TeacherCodingAnalyticsPanel";
import {
  EmptyState,
  ErrorText,
  Panel,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function StatCard({
  label,
  value,
  caption,
  icon,
}: {
  label: string;
  value: number | string;
  caption?: string;
  icon: string;
}) {
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">{label}</span>
        <span className="material-symbols-outlined text-[#3f5d9b]">{icon}</span>
      </div>
      <p className="font-display mt-2 text-3xl font-extrabold text-[#031635]">{value}</p>
      {caption ? <p className="mt-1 text-xs text-[#75777f]">{caption}</p> : null}
    </Panel>
  );
}

function WeeklyActivityChart({
  days,
}: {
  days: TeacherOverview["weekly_activity"];
}) {
  const max = Math.max(
    1,
    ...days.map((d) => d.assignment_submissions + d.practice_attempts),
  );
  if (!days.length || days.every((d) => d.assignment_submissions + d.practice_attempts === 0)) {
    return <p className="text-sm text-[#75777f]">No student activity recorded this week yet.</p>;
  }

  return (
    <div className="flex items-end gap-2 h-32">
      {days.map((day) => {
        const total = day.assignment_submissions + day.practice_attempts;
        return (
          <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-col justify-end h-24 gap-0.5">
              <div
                className="w-full rounded-t bg-[#9ebbff]"
                style={{ height: `${Math.round((day.practice_attempts / max) * 100)}%`, minHeight: day.practice_attempts ? 4 : 0 }}
                title={`${day.practice_attempts} practice attempts`}
              />
              <div
                className="w-full rounded-t bg-[#031635]"
                style={{ height: `${Math.round((day.assignment_submissions / max) * 100)}%`, minHeight: day.assignment_submissions ? 4 : 0 }}
                title={`${day.assignment_submissions} submissions`}
              />
            </div>
            <span className="text-[10px] font-semibold text-[#75777f]">
              {day.date.slice(5)}
            </span>
            <span className="text-[10px] text-[#44474e]">{total || ""}</span>
          </div>
        );
      })}
    </div>
  );
}

type ClassroomQuickAction = "assignments" | "documents" | "announcements";

const QUICK_ACTION_CONFIG: Record<
  ClassroomQuickAction,
  { title: string; description: string }
> = {
  assignments: {
    title: "Create assignment in which classroom?",
    description: "Choose where this assignment should appear.",
  },
  documents: {
    title: "Upload material to which classroom?",
    description: "Choose where this document should be available.",
  },
  announcements: {
    title: "Post announcement in which classroom?",
    description: "Choose which students should see this announcement.",
  },
};

function ClassroomPickerModal({
  action,
  classrooms,
  onSelect,
  onClose,
}: {
  action: ClassroomQuickAction;
  classrooms: TeacherClassroomCard[];
  onSelect: (classroomId: number) => void;
  onClose: () => void;
}) {
  const config = QUICK_ACTION_CONFIG[action];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#e1e3e4] bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="classroom-picker-title"
      >
        <h2 id="classroom-picker-title" className="font-display text-lg font-bold text-[#031635]">
          {config.title}
        </h2>
        <p className="mt-1 text-sm text-[#75777f]">{config.description}</p>
        <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
          {classrooms.map((c) => (
            <li key={c.classroom_id}>
              <button
                type="button"
                onClick={() => onSelect(c.classroom_id)}
                className="w-full rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] px-4 py-3 text-left transition hover:border-[#031635]"
              >
                <span className="font-medium text-[#031635]">{c.name}</span>
                <span className="mt-0.5 block font-mono text-xs text-[#75777f]">{c.code}</span>
              </button>
            </li>
          ))}
        </ul>
        <SecondaryButton type="button" onClick={onClose} className="mt-4 w-full">
          Cancel
        </SecondaryButton>
      </div>
    </div>,
    document.body,
  );
}

export function TeacherDashboardView() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [aiOpen, setAiOpen] = useState(false);
  const [pickerAction, setPickerAction] = useState<ClassroomQuickAction | null>(null);

  const overview = useQuery({
    queryKey: ["teacher-overview"],
    queryFn: classroomsApi.teacherOverview,
  });
  const codingAccess = useQuery({
    queryKey: ["coding-access"],
    queryFn: codingPlatformApi.access,
    staleTime: 30_000,
  });

  const firstClassroomId = overview.data?.classrooms[0]?.classroom_id;
  const hasClassrooms = (overview.data?.classrooms.length ?? 0) > 0;
  const codingEnabled = codingAccess.data?.enabled === true;

  const statsCaptions = useMemo(() => {
    if (!overview.data) return {};
    const s = overview.data.stats;
    return {
      students:
        s.students_joined_this_week > 0
          ? `+${s.students_joined_this_week} this week`
          : "Approved enrollments",
      documents:
        s.documents_added_this_week > 0
          ? `${s.documents_added_this_week} added recently`
          : "Uploaded materials",
      assignments:
        s.assignments_needing_review > 0
          ? `${s.assignments_needing_review} need review`
          : "Active assignments",
      classrooms: "Active learning spaces",
    };
  }, [overview.data]);

  if (overview.isLoading) {
    return <p className="text-sm text-[#75777f]">Loading your command center…</p>;
  }

  if (overview.isError || !overview.data) {
    return (
      <ErrorText
        message={
          overview.error instanceof Error ? overview.error.message : "Could not load teacher overview"
        }
      />
    );
  }

  const data = overview.data;

  function startClassroomAction(action: ClassroomQuickAction) {
    if (!data.classrooms.length) return;
    if (data.classrooms.length === 1) {
      navigate(`/classrooms/${data.classrooms[0].classroom_id}/${action}`);
      return;
    }
    setPickerAction(action);
  }

  function onPickClassroom(classroomId: number) {
    if (!pickerAction) return;
    navigate(`/classrooms/${classroomId}/${pickerAction}`);
    setPickerAction(null);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#e1e3e4] bg-white p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#e8edf5] text-[#031635] text-xs font-semibold mb-2">
            <span className="material-symbols-outlined text-sm">school</span>
            <span>Teacher Command Center</span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-extrabold text-[#031635]">
            {timeGreeting()}, Professor {user?.full_name.split(" ")[0]} 👋
          </h1>
          <p className="text-sm text-[#44474e] mt-1">
            Here's what's happening across your classrooms today.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <SecondaryButton onClick={() => setAiOpen(true)}>✨ Ask ASTRA</SecondaryButton>
          <PrimaryButton onClick={() => navigate("/classrooms/new")}>+ Create Classroom</PrimaryButton>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Students"
          value={data.stats.students}
          caption={statsCaptions.students}
          icon="groups"
        />
        <StatCard
          label="Documents"
          value={data.stats.documents}
          caption={statsCaptions.documents}
          icon="description"
        />
        <StatCard
          label="Assignments"
          value={data.stats.assignments}
          caption={statsCaptions.assignments}
          icon="assignment"
        />
        <StatCard
          label="Classrooms"
          value={data.stats.classrooms}
          caption={statsCaptions.classrooms}
          icon="school"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display font-bold text-[#031635] text-lg">Needs your attention</h3>
            {data.attention.length ? (
              <button
                type="button"
                onClick={() => {
                  const target = data.attention[0]?.to;
                  if (target) navigate(target);
                }}
                className="text-xs font-semibold text-[#3f5d9b] hover:underline"
              >
                View all
              </button>
            ) : null}
          </div>
          {!data.attention.length ? (
            <p className="rounded-lg border border-dashed border-[#e1e3e4] bg-[#f8f9fa] px-4 py-8 text-center text-sm text-[#44474e]">
              You're all caught up.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.attention.map((item) => (
                <li
                  key={item.kind}
                  className="flex items-start gap-2 rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] px-3 py-2.5 text-sm text-[#031635]"
                >
                  <span className="text-base" aria-hidden>
                    {item.kind === "ungraded_submissions" ? "🔴" : "🟡"}
                  </span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h3 className="font-display font-bold text-[#031635] text-lg mb-4">Quick actions</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <SecondaryButton onClick={() => navigate("/classrooms/new")}>Create Classroom</SecondaryButton>
            <SecondaryButton
              disabled={!hasClassrooms}
              onClick={() => startClassroomAction("assignments")}
            >
              Create Assignment
            </SecondaryButton>
            <SecondaryButton
              disabled={!hasClassrooms}
              onClick={() => startClassroomAction("documents")}
            >
              Upload Material
            </SecondaryButton>
            <SecondaryButton
              disabled={!hasClassrooms}
              onClick={() => startClassroomAction("announcements")}
            >
              New Announcement
            </SecondaryButton>
            <SecondaryButton onClick={() => setAiOpen(true)}>✨ Ask ASTRA</SecondaryButton>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h3 className="font-display font-bold text-[#031635] text-lg mb-4">Recent activity</h3>
          {!data.recent_activity.length ? (
            <p className="text-sm text-[#75777f]">No recent activity.</p>
          ) : (
            <ul className="space-y-3">
              {data.recent_activity.map((item, index) => (
                <li key={`${item.kind}-${item.occurred_at}-${index}`} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#3f5d9b]" />
                  <div>
                    <p className="text-sm text-[#031635]">{item.description}</p>
                    <p className="text-xs text-[#75777f]">{formatRelativeTime(item.occurred_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h3 className="font-display font-bold text-[#031635] text-lg mb-4">Student activity this week</h3>
          <WeeklyActivityChart days={data.weekly_activity} />
          <div className="mt-3 flex gap-4 text-[11px] font-semibold text-[#44474e]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded bg-[#031635]" /> Submissions
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded bg-[#9ebbff]" /> Practice
            </span>
          </div>
        </Panel>
      </div>

      <Panel>
        <h3 className="font-display font-bold text-[#031635] text-lg mb-4">✨ AI classroom insights</h3>
        {!data.struggling_topics.length ? (
          <p className="text-sm text-[#44474e]">
            Not enough practice data yet to highlight struggling topics. Once students complete quizzes and
            assessments, insights will appear here.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[#44474e]">Students appear to be struggling with:</p>
            {data.struggling_topics.map((topic) => (
              <div key={`${topic.classroom_id}-${topic.topic_label}`}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-[#031635]">
                    {topic.topic_label} · {topic.classroom_name}
                  </span>
                  <span className="text-xs text-[#75777f]">{topic.average_score}% avg</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#e8edf5]">
                  <div
                    className="h-full rounded-full bg-[#031635]"
                    style={{ width: `${Math.max(8, topic.average_score)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {firstClassroomId ? (
          <button
            type="button"
            onClick={() => navigate(`/classrooms/${firstClassroomId}/analytics`)}
            className="mt-4 text-sm font-semibold text-[#3f5d9b] hover:underline"
          >
            View analytics →
          </button>
        ) : null}
      </Panel>

      <TeacherCodingAnalyticsPanel enabled={codingEnabled} />

      <Panel>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-[#031635] text-lg">Your classrooms</h3>
          <SecondaryButton onClick={() => navigate("/classrooms/new")}>New Classroom</SecondaryButton>
        </div>
        {!data.classrooms.length ? (
          <EmptyState
            title="No classrooms created yet"
            body="Create your first classroom to generate a student join code and start managing content."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.classrooms.map((c) => (
              <div
                key={c.classroom_id}
                onClick={() => navigate(`/classrooms/${c.classroom_id}/dashboard`)}
                className="cursor-pointer rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-4 transition hover:border-[#031635] hover:shadow-xs"
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-display font-bold text-[#031635]">{c.name}</h4>
                  <span className="text-[10px] bg-[#e8edf5] text-[#031635] px-2 py-0.5 rounded font-bold">
                    {c.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="text-xs text-[#75777f] font-mono">{c.code}</p>
                <p className="mt-3 flex flex-wrap gap-3 text-xs text-[#44474e]">
                  <span>👥 {c.student_count} Students</span>
                  <span>📚 {c.document_count} Documents</span>
                  <span>📝 {c.assignment_count} Tasks</span>
                </p>
                {c.last_activity_at ? (
                  <p className="mt-2 text-xs text-[#75777f]">
                    Last activity: {formatRelativeTime(c.last_activity_at)}
                  </p>
                ) : null}
                <p className="mt-3 text-xs font-semibold text-[#3f5d9b]">Manage Classroom →</p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <TeacherAiChatWidget open={aiOpen} onOpenChange={setAiOpen} />

      {pickerAction ? (
        <ClassroomPickerModal
          action={pickerAction}
          classrooms={data.classrooms}
          onSelect={onPickClassroom}
          onClose={() => setPickerAction(null)}
        />
      ) : null}
    </div>
  );
}
