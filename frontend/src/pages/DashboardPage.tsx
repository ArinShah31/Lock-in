import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { classroomsApi, codingPlatformApi, institutionsApi, subjectsApi } from "../api";
import { codingApi, ensureCodingSession } from "../api/codingClient";
import { useAuth } from "../auth/AuthContext";
import { BrandLogo } from "../components/BrandLogo";
import ColorBends from "../components/ColorBends";
import { StudentStreaksCard } from "../components/StudentStreaksCard";
import { useStudentWorkProgress } from "../hooks/useStudentWorkProgress";
import { useStudentOnTimeStreak } from "../hooks/useStudentOnTimeStreak";
import { TeacherDashboardView } from "./TeacherDashboardView";
import {
  EmptyState,
  Panel,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";

type StudentCodingAssignment = {
  id: number;
  status: "ASSIGNED" | "IN_PROGRESS" | "SUBMITTED" | "BLOCKED";
  test_title?: string | null;
  duration_minutes?: number | null;
  is_published_results?: boolean;
};

type StudentPublishedResult = {
  average_score?: number | null;
  published: boolean;
};

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function StudentStatCard({
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
      className="student-stat-card animate-rise rounded-2xl border border-[#e1e3e4] bg-white p-4 shadow-xs"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#75777f]">{label}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-[#031635] xl:text-3xl">{value}</p>
        </div>
        <span className={`material-symbols-outlined rounded-xl p-2 text-[20px] ${toneClass}`}>
          {icon}
        </span>
      </div>
      <p className="mt-2 text-sm text-[#44474e]">{caption}</p>
    </div>
  );
}

function CompletionCurve({ percent, scorePercent }: { percent: number; scorePercent: number | null }) {
  const safe = clampPct(percent);
  const safeScore = scorePercent == null ? null : clampPct(scorePercent);
  const endY = 92 - safe * 0.62;
  const scoreEndY = safeScore == null ? 78 : 92 - safeScore * 0.62;
  const path = `M 12 92 C 62 88, 78 ${96 - safe * 0.34}, 118 ${86 - safe * 0.42} S 190 ${endY}, 246 ${endY}`;
  const scorePath =
    safeScore == null
      ? "M 12 78 C 70 78, 105 78, 145 78 S 205 78, 246 78"
      : `M 12 92 C 58 ${92 - safeScore * 0.22}, 82 ${95 - safeScore * 0.5}, 124 ${90 - safeScore * 0.57} S 198 ${scoreEndY}, 246 ${scoreEndY}`;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#e1e3e4] bg-[#031635] p-4 text-white shadow-xs">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(158,187,255,0.35),transparent_30%),radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.16),transparent_26%)]" />
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9ebbff]">
            Coding momentum
          </p>
          <p className="mt-1 font-display text-3xl font-extrabold">{safe}%</p>
          <p className="mt-1 text-xs text-[#d7e2ff]">Submitted tests out of assigned coding work.</p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-white">
          Live
        </span>
      </div>
      <svg className="relative z-10 mt-4 h-24 w-full" viewBox="0 0 260 110" role="img" aria-label="Coding completion curve">
        <defs>
          <linearGradient id="studentCurveFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#9ebbff" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#9ebbff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path} L 246 108 L 12 108 Z`} fill="url(#studentCurveFill)" />
        <path className="student-curve-line" d={path} fill="none" stroke="#9ebbff" strokeLinecap="round" strokeWidth="4" />
        <path
          className="student-score-line"
          d={scorePath}
          fill="none"
          stroke={safeScore == null ? "#d7e2ff" : "#6ee7b7"}
          strokeDasharray={safeScore == null ? "4 8" : undefined}
          strokeLinecap="round"
          strokeWidth="3"
        />
        <circle className="student-curve-dot" cx="246" cy={endY} r="5" fill="#ffffff" />
        {safeScore == null ? null : <circle cx="246" cy={scoreEndY} r="4" fill="#6ee7b7" />}
      </svg>
      <div className="relative z-10 mt-1.5 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-[#d7e2ff]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-5 rounded-full bg-[#9ebbff]" />
          Completion
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-5 rounded-full bg-[#6ee7b7]" />
          Score {safeScore == null ? "publishes later" : `${safeScore}% avg`}
        </span>
      </div>
    </div>
  );
}

// --- Student Dashboard View (Matching Starred Lumina Student Dashboard) ---
function StudentDashboardView() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: classroomsApi.list });
  const pendingRequests = useQuery({
    queryKey: ["my-join-requests"],
    queryFn: classroomsApi.myJoinRequests,
  });
  const codingAccess = useQuery({
    queryKey: ["coding-access"],
    queryFn: codingPlatformApi.access,
    staleTime: 30_000,
  });
  const codingAssignments = useQuery({
    queryKey: ["student-coding-assignments", user?.email],
    queryFn: async () => {
      await ensureCodingSession(false, user?.email);
      return codingApi<StudentCodingAssignment[]>("/student/assignments");
    },
    enabled: codingAccess.data?.enabled === true && !!user?.email,
    staleTime: 30_000,
    retry: false,
  });

  const enrolledCount = classrooms.data?.length ?? 0;
  const pendingCount = pendingRequests.data?.length ?? 0;
  const codingItems = codingAssignments.data ?? [];
  const publishedCodingIds = codingItems.filter((a) => a.is_published_results).map((a) => a.id);
  const codingResults = useQuery({
    queryKey: ["student-published-coding-results", publishedCodingIds.join(",")],
    queryFn: async () => {
      await ensureCodingSession(false, user?.email);
      const rows = await Promise.all(
        publishedCodingIds.map((id) =>
          codingApi<StudentPublishedResult>(`/student/assignments/${id}/results`),
        ),
      );
      return rows;
    },
    enabled: codingAccess.data?.enabled === true && publishedCodingIds.length > 0 && !!user?.email,
    staleTime: 30_000,
    retry: false,
  });
  const codingAssigned = codingItems.length;
  const codingSubmitted = codingItems.filter((a) => a.status === "SUBMITTED").length;
  const codingOpen = codingItems.filter((a) => a.status === "ASSIGNED" || a.status === "IN_PROGRESS").length;
  const publishedResults = codingItems.filter((a) => a.is_published_results).length;
  const publishedScores = (codingResults.data ?? [])
    .map((r) => r.average_score)
    .filter((score): score is number => typeof score === "number");
  const averagePublishedScore = publishedScores.length
    ? Math.round(publishedScores.reduce((sum, score) => sum + score, 0) / publishedScores.length)
    : null;
  const completionPct = codingAssigned ? Math.round((codingSubmitted / codingAssigned) * 100) : 0;
  const nextCoding = codingItems.find((a) => a.status === "IN_PROGRESS") ?? codingItems.find((a) => a.status === "ASSIGNED");
  const codingLoading = codingAccess.data?.enabled === true && codingAssignments.isLoading;
  const codingError = codingAccess.data?.enabled === true && codingAssignments.isError;
  const workProgress = useStudentWorkProgress();
  const onTimeStreak = useStudentOnTimeStreak();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_360px] xl:items-stretch xl:gap-5">
        <div className="flex flex-col space-y-4">
          <div className="relative min-h-[170px] overflow-hidden rounded-2xl border border-white/10 bg-[#0b1326] p-5 shadow-xs xl:min-h-[180px]">
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
              <div className="max-w-2xl rounded-2xl bg-[#0b1326]/55 p-3 backdrop-blur-[2px] sm:p-3.5">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-black/35 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/15">
                  <BrandLogo variant="base" className="h-3.5 w-auto" />
                  <span>ASTRA Student Intelligence</span>
                </div>
                <h1 className="font-display text-2xl font-extrabold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] md:text-3xl">
                  Welcome back, {user?.full_name.split(" ")[0]}!
                </h1>
                <p className="mt-1 text-sm text-white/90 drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)]">
                  Track classrooms, coding work, and upcoming academic checkpoints from one animated workspace.
                </p>
              </div>
              <div className="pointer-events-auto shrink-0">
                <button
                  type="button"
                  className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#031635] shadow-lg shadow-black/40 transition hover:bg-white/90"
                  onClick={() => navigate(nextCoding ? "/coding" : "/classrooms")}
                >
                  {nextCoding ? "Continue coding" : "Explore classrooms"}
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StudentStatCard
              label="Classrooms"
              value={enrolledCount}
              caption="Approved learning spaces"
              icon="school"
              delay={0}
            />
            <StudentStatCard
              label="Pending"
              value={pendingCount}
              caption="Join requests awaiting approval"
              icon="hourglass_top"
              tone="amber"
              delay={80}
            />
            <StudentStatCard
              label="Coding assigned"
              value={codingLoading ? "..." : codingAssigned}
              caption={
                codingError
                  ? "Could not load coding tests"
                  : codingAccess.data?.enabled
                    ? "Tests available to you"
                    : "Coding not enabled yet"
              }
              icon="code_blocks"
              tone="blue"
              delay={160}
            />
            <StudentStatCard
              label="Submitted"
              value={codingLoading ? "..." : codingSubmitted}
              caption={
                codingError ? "Refresh to retry coding sync" : `${codingOpen} open task${codingOpen === 1 ? "" : "s"}`
              }
              icon="task_alt"
              tone="green"
              delay={240}
            />
          </div>

          <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_280px]">
            <CompletionCurve percent={completionPct} scorePercent={averagePublishedScore} />
            <div className="rounded-2xl border border-[#e1e3e4] bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#75777f]">
                    Published results
                  </p>
                  <p className="mt-1 font-display text-2xl font-extrabold text-[#031635] xl:text-3xl">
                    {publishedResults}
                  </p>
                </div>
                <span className="material-symbols-outlined rounded-xl bg-[#e8edf5] p-2 text-[#3f5d9b]">
                  monitoring
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e8edf5]">
                <div
                  className="h-full rounded-full bg-[#3f5d9b] transition-[width] duration-700"
                  style={{ width: `${codingAssigned ? (publishedResults / codingAssigned) * 100 : 0}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-[#44474e]">
                Published teacher feedback appears inside the coding workspace.
              </p>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col xl:h-full">
          <StudentStreaksCard
            completionPct={workProgress.completionPct}
            completed={workProgress.completed}
            total={workProgress.total}
            segments={workProgress.segments}
            todoItems={workProgress.todoItems}
            isLoading={workProgress.isLoading}
            isError={workProgress.isError}
            streak={onTimeStreak.streak}
            streakLoading={onTimeStreak.isLoading}
            nextCoding={nextCoding ?? null}
            codingEnabled={codingAccess.data?.enabled === true}
            enrolledCount={enrolledCount}
          />
        </div>
      </div>
    </div>
  );
}

// --- Head of Department (HOD) Dashboard View ---
function HODDashboardView() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: classroomsApi.list });
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: subjectsApi.list });

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#e1e3e4] bg-white p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#e8edf5] text-[#031635] text-xs font-semibold mb-2">
            <span className="material-symbols-outlined text-sm">account_balance</span>
            <span>Head of Department Executive View</span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-extrabold text-[#031635]">
            Department Overview — {user?.full_name}
          </h1>
          <p className="text-sm text-[#44474e] mt-1">
            Oversee department faculty, active classrooms, subject coverage, and student performance.
          </p>
        </div>
        <PrimaryButton onClick={() => navigate("/team")}>
          Manage Faculty & Team
        </PrimaryButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Department Classrooms</span>
          <p className="font-display text-3xl font-extrabold text-[#031635] mt-2">{classrooms.data?.length ?? 0}</p>
          <p className="text-xs text-[#75777f] mt-1">Active class sections</p>
        </Panel>

        <Panel>
          <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Department Subjects</span>
          <p className="font-display text-3xl font-extrabold text-[#031635] mt-2">{subjects.data?.length ?? 0}</p>
          <p className="text-xs text-[#75777f] mt-1">Offered courses</p>
        </Panel>

        <Panel>
          <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Quick Actions</span>
          <div className="mt-2 space-y-1.5">
            <button onClick={() => navigate("/team")} className="text-xs text-[#3f5d9b] font-semibold hover:underline block">
              + Add Faculty Teacher
            </button>
            <button onClick={() => navigate("/subjects")} className="text-xs text-[#3f5d9b] font-semibold hover:underline block">
              + Review Department Subjects
            </button>
          </div>
        </Panel>
      </div>

      <Panel>
        <h3 className="font-display font-bold text-[#031635] text-lg mb-4">Department Classrooms Overview</h3>
        {!classrooms.data?.length ? (
          <EmptyState title="No active department classrooms" body="Faculty teachers will create classrooms under this department." />
        ) : (
          <div className="space-y-3">
            {classrooms.data.map((c) => (
              <div key={c.id} className="p-3.5 rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] flex items-center justify-between">
                <div>
                  <p className="font-bold text-[#031635] text-sm">{c.name} ({c.code})</p>
                  <p className="text-xs text-[#44474e]">Teacher Join Code: <span className="font-mono font-bold text-[#031635]">{c.join_code}</span></p>
                </div>
                <SecondaryButton onClick={() => navigate(`/classrooms/${c.id}/dashboard`)}>
                  Inspect →
                </SecondaryButton>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// --- Institution Admin Dashboard View ---
function InstitutionAdminDashboardView() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const institutions = useQuery({ queryKey: ["institutions"], queryFn: institutionsApi.list });
  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: classroomsApi.list });

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#e1e3e4] bg-white p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#e8edf5] text-[#031635] text-xs font-semibold mb-2">
            <span className="material-symbols-outlined text-sm">corporate_fare</span>
            <span>Institution Management View</span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-extrabold text-[#031635]">
            Institution Control Center — {user?.full_name}
          </h1>
          <p className="text-sm text-[#44474e] mt-1">
            Manage institutional departments, assign Heads of Departments (HODs), and oversee overall academic activity.
          </p>
        </div>
        <div className="flex gap-2">
          <PrimaryButton onClick={() => navigate("/team")}>
            Manage HODs & Staff
          </PrimaryButton>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Institution Scope</span>
          <p className="font-display text-xl font-bold text-[#031635] mt-2">
            {institutions.data?.find((i) => i.id === user?.institution_id)?.name || "Primary Institution"}
          </p>
          <p className="text-xs text-[#75777f] mt-1">Configured Scope</p>
        </Panel>

        <Panel>
          <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Total Classrooms</span>
          <p className="font-display text-3xl font-extrabold text-[#031635] mt-2">{classrooms.data?.length ?? 0}</p>
          <p className="text-xs text-[#75777f] mt-1">Across all departments</p>
        </Panel>

        <Panel>
          <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Team & Staff</span>
          <button onClick={() => navigate("/team")} className="text-sm font-semibold text-[#3f5d9b] hover:underline block mt-2">
            View Staff Directory →
          </button>
        </Panel>
      </div>
    </div>
  );
}

// --- Super Admin Dashboard View ---
function SuperAdminDashboardView() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const institutions = useQuery({ queryKey: ["institutions"], queryFn: institutionsApi.list });
  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: classroomsApi.list });
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: subjectsApi.list });

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#031635] bg-[#031635] text-white p-6 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-white text-xs font-semibold mb-2">
            <span className="material-symbols-outlined text-sm">admin_panel_settings</span>
            <span>Platform Super Admin</span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-extrabold text-white">
            System Administration — {user?.full_name}
          </h1>
          <p className="text-sm text-gray-300 mt-1">
            Global governance over registered educational institutions, administrators, and platform metrics.
          </p>
        </div>
        <PrimaryButton onClick={() => navigate("/institutions")}>
          + Add Institution
        </PrimaryButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Registered Institutions</span>
          <p className="font-display text-3xl font-extrabold text-[#031635] mt-2">{institutions.data?.length ?? 0}</p>
          <p className="text-xs text-[#75777f] mt-1">Platform-wide</p>
        </Panel>

        <Panel>
          <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Total Classrooms</span>
          <p className="font-display text-3xl font-extrabold text-[#031635] mt-2">{classrooms.data?.length ?? 0}</p>
          <p className="text-xs text-[#75777f] mt-1">Across all institutions</p>
        </Panel>

        <Panel>
          <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Total Subjects</span>
          <p className="font-display text-3xl font-extrabold text-[#031635] mt-2">{subjects.data?.length ?? 0}</p>
          <p className="text-xs text-[#75777f] mt-1">Active courses</p>
        </Panel>
      </div>

      <Panel>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-[#031635] text-lg">Institutions Directory</h3>
          <Link to="/institutions" className="text-xs text-[#3f5d9b] font-semibold hover:underline">
            Manage All →
          </Link>
        </div>

        {!institutions.data?.length ? (
          <EmptyState title="No institutions created" body="Create your first institution to onboard institution admins." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {institutions.data.map((inst) => (
              <div key={inst.id} className="p-4 rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] flex items-center justify-between">
                <div>
                  <p className="font-bold text-[#031635] text-base">{inst.name}</p>
                  <p className="text-xs text-[#44474e]">Code: <span className="font-mono font-bold">{inst.code}</span></p>
                </div>
                <span className="text-xs bg-[#e8edf5] text-[#031635] px-2.5 py-1 rounded font-semibold">
                  {inst.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// --- Main Dashboard Controller Page ---
export function DashboardPage() {
  const { user } = useAuth();

  if (!user) return null;

  switch (user.role) {
    case "STUDENT":
      return <StudentDashboardView />;
    case "CLASS_TEACHER":
    case "SUBJECT_TEACHER":
      return <TeacherDashboardView />;
    case "HOD":
      return <HODDashboardView />;
    case "INSTITUTION_ADMIN":
      return <InstitutionAdminDashboardView />;
    case "SUPER_ADMIN":
      return <SuperAdminDashboardView />;
    default:
      return <StudentDashboardView />;
  }
}
