import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { classroomsApi, codingPlatformApi } from "../api";
import type { TeacherClassroomCard, TeacherOverview } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { BrandLogo } from "../components/BrandLogo";
import ColorBends from "../components/ColorBends";
import { TeacherAiChatWidget } from "../components/TeacherAiChatWidget";
import { TeacherCodingAnalyticsPanel } from "../components/TeacherCodingAnalyticsPanel";
import {
  EmptyState,
  ErrorText,
  Panel,
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

function TeacherStatCard({
  label,
  value,
  caption,
  icon,
  tone = "navy",
  delay = 0,
}: {
  label: string;
  value: number | string;
  caption: string;
  icon: string;
  tone?: "navy" | "blue" | "green" | "amber";
  delay?: number;
}) {
  const toneClass = {
    navy: "bg-[#e8edf5] text-[#031635]",
    blue: "bg-[#edf3ff] text-[#3f5d9b]",
    green: "bg-[#e7f3ec] text-[#2f6b4f]",
    amber: "bg-[#f5efe4] text-[#9a6b2f]",
  }[tone];

  return (
    <div
      className="student-stat-card animate-rise rounded-2xl border border-[#e1e3e4] bg-white p-3.5 shadow-xs"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#75777f]">{label}</p>
          <p className="mt-0.5 font-display text-2xl font-extrabold text-[#031635]">{value}</p>
        </div>
        <span className={`material-symbols-outlined rounded-lg p-1.5 text-[18px] ${toneClass}`}>
          {icon}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-[#44474e]">{caption}</p>
    </div>
  );
}

function HeroStatChip({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur-sm">
      <span className="material-symbols-outlined text-sm">{icon}</span>
      {label}
    </span>
  );
}

function weekdayLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso.slice(5);
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function isToday(iso: string): boolean {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === new Date().toDateString();
}

function WeeklyActivityChart({
  days,
  className = "",
}: {
  days: TeacherOverview["weekly_activity"];
  className?: string;
}) {
  const max = Math.max(
    1,
    ...days.map((d) => d.assignment_submissions + d.practice_attempts),
  );
  if (!days.length || days.every((d) => d.assignment_submissions + d.practice_attempts === 0)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[#c9d8ef] bg-white/50 px-4 py-8 text-center">
        <span className="material-symbols-outlined mb-2 text-3xl text-[#8faed4]">bar_chart</span>
        <p className="text-sm font-medium text-[#3f5d9b]">No student activity this week yet</p>
        <p className="mt-1 text-xs text-[#75777f]">Activity will appear as students submit work and practice.</p>
      </div>
    );
  }

  return (
    <div
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#d4e2f4] bg-gradient-to-br from-[#eef5ff] via-[#f3f0ff] to-[#edf8f3] p-3 ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-x-3 top-3 bottom-8 flex flex-col justify-between"
        aria-hidden
      >
        {[0, 1, 2, 3].map((line) => (
          <div key={line} className="border-t border-dashed border-[#c5d6eb]/80" />
        ))}
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 items-stretch gap-1.5 sm:gap-2">
        {days.map((day) => {
          const total = day.assignment_submissions + day.practice_attempts;
          const heightPct = total ? Math.max(12, Math.round((total / max) * 100)) : 0;
          const today = isToday(day.date);
          const tooltip = total
            ? `${weekdayLabel(day.date)}: ${day.assignment_submissions} submission${day.assignment_submissions === 1 ? "" : "s"}, ${day.practice_attempts} practice`
            : `${weekdayLabel(day.date)}: no activity`;

          return (
            <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full max-w-11 flex-1 items-end justify-center">
                <div
                  className={`relative flex h-full w-full flex-col justify-end rounded-full bg-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ${
                    today ? "ring-[#7ba3f7]/60" : "ring-[#d7e4f5]"
                  }`}
                  title={tooltip}
                  aria-label={tooltip}
                >
                  {total > 0 ? (
                    <div
                      className="mx-auto flex w-[78%] flex-col justify-end overflow-hidden rounded-full shadow-sm"
                      style={{ height: `${heightPct}%` }}
                    >
                      {day.practice_attempts > 0 ? (
                        <div
                          className="w-full bg-gradient-to-t from-[#6b93eb] to-[#a8c8ff]"
                          style={{ flex: day.practice_attempts }}
                        />
                      ) : null}
                      {day.assignment_submissions > 0 ? (
                        <div
                          className="w-full bg-gradient-to-t from-[#2f6b8f] to-[#5a9ab8]"
                          style={{ flex: day.assignment_submissions }}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="mx-auto mb-1 h-1.5 w-[55%] rounded-full bg-[#dbe7f5]" />
                  )}
                </div>
              </div>
              <span
                className={`mt-1.5 shrink-0 text-[9px] font-semibold uppercase tracking-wide ${
                  today ? "rounded-full bg-[#3f5d9b] px-1.5 py-0.5 text-white" : "text-[#6b7f99]"
                }`}
              >
                {weekdayLabel(day.date)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DashboardPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Panel className={`p-4 shadow-xs hover:shadow-xs ${className}`}>
      {children}
    </Panel>
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
  const activityListRef = useRef<HTMLUListElement>(null);

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
    return <p className="text-sm text-[#75777f]">Loading your teaching workspace…</p>;
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
  const firstName = user?.full_name.split(" ")[0] ?? "there";
  const classroomCount = data.stats.classrooms;
  const studentCount = data.stats.students;
  const weekActivityTotals = data.weekly_activity.reduce(
    (acc, day) => ({
      submissions: acc.submissions + day.assignment_submissions,
      practice: acc.practice + day.practice_attempts,
    }),
    { submissions: 0, practice: 0 },
  );

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

  function scrollRecentActivity(direction: "up" | "down") {
    activityListRef.current?.scrollBy({
      top: direction === "up" ? -96 : 96,
      behavior: "smooth",
    });
  }

  return (
    <div className="space-y-5">
      <div className="relative min-h-[168px] overflow-hidden rounded-2xl border border-white/10 bg-[#0b1326] p-5 shadow-xs">
        <div className="absolute inset-0 z-0 overflow-hidden">
          <ColorBends
            className="absolute inset-0 h-full w-full"
            colors={["#0b1326", "#101c34", "#1e2a44", "#2a3f63"]}
            rotation={45}
            speed={0.25}
            scale={1.35}
            frequency={1}
            warpStrength={1}
            mouseInfluence={0.9}
            noise={0.1}
            parallax={0.4}
            iterations={2}
            intensity={1.6}
            bandWidth={5}
            transparent={false}
          />
        </div>
        <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-r from-black/50 via-black/25 to-transparent" />
        <div className="pointer-events-none relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-black/35 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/15">
              <BrandLogo variant="base" className="h-3.5 w-auto" />
              <span>ASTRA Teaching Intelligence</span>
            </div>
            <h1 className="font-display text-2xl font-extrabold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] md:text-3xl">
              {timeGreeting()}, {firstName}
            </h1>
            <p className="mt-1 text-sm text-white/90 drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)]">
              Review classrooms, assignments, and student activity from one workspace.
            </p>
            <div className="pointer-events-auto mt-3 flex flex-wrap gap-2 md:hidden">
              <HeroStatChip
                icon="school"
                label={`${classroomCount} classroom${classroomCount === 1 ? "" : "s"}`}
              />
              <HeroStatChip
                icon="groups"
                label={`${studentCount} student${studentCount === 1 ? "" : "s"}`}
              />
            </div>
          </div>
          <div className="pointer-events-auto flex shrink-0 flex-col items-start gap-3 md:items-end">
            <div className="hidden flex-wrap justify-end gap-2 md:flex">
              <HeroStatChip
                icon="school"
                label={`${classroomCount} classroom${classroomCount === 1 ? "" : "s"}`}
              />
              <HeroStatChip
                icon="groups"
                label={`${studentCount} student${studentCount === 1 ? "" : "s"}`}
              />
            </div>
            <button
              type="button"
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#031635] shadow-lg shadow-black/40 transition hover:bg-white/90"
              onClick={() => (hasClassrooms ? setAiOpen(true) : navigate("/classrooms/new"))}
            >
              {hasClassrooms ? "Ask ASTRA" : "Create classroom"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TeacherStatCard
          label="Students"
          value={data.stats.students}
          caption={statsCaptions.students ?? "Approved enrollments"}
          icon="groups"
          tone="blue"
          delay={0}
        />
        <TeacherStatCard
          label="Documents"
          value={data.stats.documents}
          caption={statsCaptions.documents ?? "Uploaded materials"}
          icon="description"
          tone="navy"
          delay={60}
        />
        <TeacherStatCard
          label="Assignments"
          value={data.stats.assignments}
          caption={statsCaptions.assignments ?? "Active assignments"}
          icon="assignment"
          tone="amber"
          delay={120}
        />
        <TeacherStatCard
          label="Classrooms"
          value={data.stats.classrooms}
          caption={statsCaptions.classrooms ?? "Active learning spaces"}
          icon="school"
          tone="green"
          delay={180}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <DashboardPanel>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold text-[#031635]">Needs your attention</h3>
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
            <p className="rounded-lg border border-dashed border-[#e1e3e4] bg-[#f8f9fa] px-4 py-5 text-center text-sm text-[#44474e]">
              You're all caught up.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.attention.map((item) => (
                <li
                  key={item.kind}
                  className="flex items-start gap-2 rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] px-3 py-2 text-sm text-[#031635]"
                >
                  <span
                    className={`material-symbols-outlined mt-0.5 text-[18px] ${
                      item.kind === "ungraded_submissions" ? "text-[#ba1a1a]" : "text-[#9a6b2f]"
                    }`}
                    aria-hidden
                  >
                    {item.kind === "ungraded_submissions" ? "error" : "warning"}
                  </span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          )}
        </DashboardPanel>

        <DashboardPanel>
          <h3 className="mb-3 font-display text-sm font-bold text-[#031635]">Quick actions</h3>
          <div className="grid gap-1.5 sm:grid-cols-2">
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
          </div>
        </DashboardPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <DashboardPanel className="flex h-full flex-col">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold text-[#031635]">Recent activity</h3>
            {data.recent_activity.length > 0 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => scrollRecentActivity("up")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] text-[#44474e] transition hover:border-[#031635] hover:text-[#031635]"
                  aria-label="Scroll recent activity up"
                >
                  <span className="material-symbols-outlined text-[18px]">keyboard_arrow_up</span>
                </button>
                <button
                  type="button"
                  onClick={() => scrollRecentActivity("down")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] text-[#44474e] transition hover:border-[#031635] hover:text-[#031635]"
                  aria-label="Scroll recent activity down"
                >
                  <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
                </button>
              </div>
            ) : null}
          </div>
          {!data.recent_activity.length ? (
            <p className="text-sm text-[#75777f]">No recent activity.</p>
          ) : (
            <ul
              ref={activityListRef}
              className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
              style={{ maxHeight: "280px" }}
            >
              {data.recent_activity.map((item, index) => (
                <li key={`${item.kind}-${item.occurred_at}-${index}`} className="flex gap-2.5 border-b border-[#f0f1f2] pb-2 last:border-0 last:pb-0">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#3f5d9b]" />
                  <div className="min-w-0">
                    <p className="text-sm leading-snug text-[#031635]">{item.description}</p>
                    <p className="text-[11px] text-[#75777f]">{formatRelativeTime(item.occurred_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DashboardPanel>

        <DashboardPanel className="flex h-full flex-col overflow-hidden border-[#dce6f5] bg-gradient-to-br from-white to-[#f7faff]">
          <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="material-symbols-outlined rounded-xl bg-gradient-to-br from-[#e8f2ff] to-[#ede8ff] p-2 text-[20px] text-[#3f5d9b]">
                monitoring
              </span>
              <div>
                <h3 className="font-display text-sm font-bold text-[#031635]">Student activity this week</h3>
                <p className="mt-0.5 text-[11px] text-[#6b7f99]">Track submissions and practice across your classrooms</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f4fa] px-2.5 py-1 text-[10px] font-semibold text-[#2f6b8f] ring-1 ring-[#c8e3ef]">
                <span className="h-2 w-2 rounded-full bg-gradient-to-t from-[#2f6b8f] to-[#5a9ab8]" />
                {weekActivityTotals.submissions} submissions
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#edf2ff] px-2.5 py-1 text-[10px] font-semibold text-[#4a6fbf] ring-1 ring-[#d4e0ff]">
                <span className="h-2 w-2 rounded-full bg-gradient-to-t from-[#6b93eb] to-[#a8c8ff]" />
                {weekActivityTotals.practice} practice
              </span>
            </div>
          </div>
          <WeeklyActivityChart days={data.weekly_activity} className="min-h-[140px] flex-1" />
        </DashboardPanel>
      </div>

      <DashboardPanel>
        <h3 className="mb-3 font-display text-sm font-bold text-[#031635]">AI classroom insights</h3>
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
            className="mt-3 text-xs font-semibold text-[#3f5d9b] hover:underline"
          >
            View analytics →
          </button>
        ) : null}
      </DashboardPanel>

      <TeacherCodingAnalyticsPanel enabled={codingEnabled} />

      <DashboardPanel>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-display text-sm font-bold text-[#031635]">Your classrooms</h3>
          <SecondaryButton onClick={() => navigate("/classrooms/new")}>New Classroom</SecondaryButton>
        </div>
        {!data.classrooms.length ? (
          <EmptyState
            title="No classrooms created yet"
            body="Create your first classroom to generate a student join code and start managing content."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.classrooms.map((c) => (
              <div
                key={c.classroom_id}
                onClick={() => navigate(`/classrooms/${c.classroom_id}/dashboard`)}
                className="cursor-pointer rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-3.5 transition hover:border-[#031635] hover:bg-white"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <h4 className="truncate font-display text-sm font-bold text-[#031635]">{c.name}</h4>
                  <span className="shrink-0 rounded bg-[#e8edf5] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#031635]">
                    {c.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-[#75777f]">{c.code}</p>
                <p className="mt-2 flex flex-wrap gap-2.5 text-[11px] text-[#44474e]">
                  <span className="inline-flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-[14px] text-[#3f5d9b]">groups</span>
                    {c.student_count}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-[14px] text-[#3f5d9b]">description</span>
                    {c.document_count}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-[14px] text-[#3f5d9b]">assignment</span>
                    {c.assignment_count}
                  </span>
                </p>
                {c.last_activity_at ? (
                  <p className="mt-1.5 text-[11px] text-[#75777f]">
                    {formatRelativeTime(c.last_activity_at)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </DashboardPanel>

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
