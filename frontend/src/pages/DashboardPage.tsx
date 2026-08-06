import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { classroomsApi, codingPlatformApi, institutionsApi, subjectsApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import { TeacherCodingAnalyticsPanel } from "../components/TeacherCodingAnalyticsPanel";
import {
  EmptyState,
  Panel,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";

// --- Student Dashboard View (Matching Starred Lumina Student Dashboard) ---
function StudentDashboardView() {
  const { user } = useAuth();

  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: classroomsApi.list });
  const pendingRequests = useQuery({
    queryKey: ["my-join-requests"],
    queryFn: classroomsApi.myJoinRequests,
  });

  const enrolledCount = classrooms.data?.length ?? 0;
  const pendingCount = pendingRequests.data?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Top row: welcome banner + Time Engine */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="rounded-xl border border-[#e1e3e4] bg-white p-6 shadow-xs relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#eef2ff] text-[#4f46e5] text-xs font-semibold mb-2">
                <span className="material-symbols-outlined text-sm">auto_awesome</span>
                <span>Lumina Student Intelligence Workspace</span>
              </div>
              <h1 className="font-display text-2xl md:text-3xl font-extrabold text-[#031635]">
                Welcome back, {user?.full_name.split(" ")[0]}!
              </h1>
              <p className="academic-text text-[#44474e] text-sm mt-1">
                "Continuous academic rigor and organized study intervals yield peak retention."
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-center px-4 py-2 bg-[#f8f9fa] border border-[#e1e3e4] rounded-lg">
                <p className="text-xs text-[#75777f] uppercase font-bold tracking-wider">Classrooms</p>
                <p className="font-display text-xl font-bold text-[#031635]">{enrolledCount}</p>
              </div>
              <div className="text-center px-4 py-2 bg-[#f8f9fa] border border-[#e1e3e4] rounded-lg">
                <p className="text-xs text-[#75777f] uppercase font-bold tracking-wider">Pending</p>
                <p className="font-display text-xl font-bold text-[#3f5d9b]">{pendingCount}</p>
              </div>
            </div>
          </div>
        </div>

        <Panel className="h-fit">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-[#e1e3e4]">
            <h3 className="font-display font-bold text-[#031635] text-base flex items-center gap-2">
              <span className="material-symbols-outlined text-[#4f46e5]">schedule</span>
              Time Engine
            </h3>
            <span className="text-xs text-[#44474e] font-medium">Fall '26</span>
          </div>

          <div className="space-y-4">
            <div className="timeline-node pl-8">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-[#031635]">09:00 AM — Academic Orientation</p>
                <span className="shrink-0 text-[10px] bg-[#eef2ff] text-[#4f46e5] px-2 py-0.5 rounded font-bold">Today</span>
              </div>
              <p className="text-xs text-[#44474e] mt-0.5">Review registered subjects & syllabus outline.</p>
            </div>

            <div className="timeline-node pl-8">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-[#031635]">11:30 AM — Course Builder Sync</p>
                <span className="shrink-0 text-[10px] bg-[#f8f9fa] border border-[#e1e3e4] text-[#44474e] px-2 py-0.5 rounded font-bold">Upcoming</span>
              </div>
              <p className="text-xs text-[#44474e] mt-0.5">Access new material uploaded by class faculty.</p>
            </div>

            <div className="timeline-node pl-8">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-[#031635]">05:00 PM — Assignment Submission</p>
                <span className="shrink-0 text-[10px] bg-[#ffdad6] text-[#ba1a1a] px-2 py-0.5 rounded font-bold">Due Soon</span>
              </div>
              <p className="text-xs text-[#44474e] mt-0.5">Check classroom assignments tab for deadlines.</p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

// --- Teacher Dashboard View (Class Teacher & Subject Teacher) ---
function TeacherDashboardView() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: classroomsApi.list });
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: subjectsApi.list });
  const codingAccess = useQuery({
    queryKey: ["coding-access"],
    queryFn: codingPlatformApi.access,
    staleTime: 30_000,
  });

  const activeClassrooms = classrooms.data?.length ?? 0;
  const activeSubjects = subjects.data?.length ?? 0;
  const codingEnabled = codingAccess.data?.enabled === true;

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="rounded-xl border border-[#e1e3e4] bg-white p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#e8edf5] text-[#031635] text-xs font-semibold mb-2">
            <span className="material-symbols-outlined text-sm">school</span>
            <span>Faculty Command Center</span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-extrabold text-[#031635]">
            Welcome, Professor {user?.full_name.split(" ")[0]}
          </h1>
          <p className="text-sm text-[#44474e] mt-1">
            Manage your classroom join codes, course materials, student approvals, and assignments.
          </p>
        </div>

        <div className="flex gap-3">
          <PrimaryButton onClick={() => navigate("/classrooms/new")}>
            + Create Classroom
          </PrimaryButton>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Your Classrooms</span>
            <span className="material-symbols-outlined text-[#3f5d9b]">school</span>
          </div>
          <p className="font-display text-3xl font-extrabold text-[#031635] mt-2">{activeClassrooms}</p>
          <p className="text-xs text-[#75777f] mt-1">Active learning spaces</p>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Active Subjects</span>
            <span className="material-symbols-outlined text-[#4f46e5]">menu_book</span>
          </div>
          <p className="font-display text-3xl font-extrabold text-[#031635] mt-2">{activeSubjects}</p>
          <p className="text-xs text-[#75777f] mt-1">Courses & syllabus managed</p>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#44474e]">Role</span>
            <span className="material-symbols-outlined text-[#3f5d9b]">badge</span>
          </div>
          <p className="font-display text-lg font-bold text-[#031635] mt-2">{user?.role.replace("_", " ")}</p>
          <p className="text-xs text-[#75777f] mt-1">Full management access</p>
        </Panel>
      </div>

      <TeacherCodingAnalyticsPanel enabled={codingEnabled} />

      {/* Classrooms List */}
      <Panel>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-[#031635] text-lg">Your Classrooms & Join Codes</h3>
          <SecondaryButton onClick={() => navigate("/classrooms/new")}>
            New Classroom
          </SecondaryButton>
        </div>

        {classrooms.isLoading ? (
          <p className="text-sm text-[#75777f]">Loading classrooms…</p>
        ) : classrooms.isError ? (
          <EmptyState
            title="Could not load classrooms"
            body={classrooms.error instanceof Error ? classrooms.error.message : "Check that the ASTRA API is running on the Vite proxy port."}
          />
        ) : !classrooms.data?.length ? (
          <EmptyState
            title="No classrooms created yet"
            body="Create your first classroom to generate a student join code and start managing syllabus content."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classrooms.data.map((c) => (
              <div
                key={c.id}
                onClick={() => navigate(`/classrooms/${c.id}/dashboard`)}
                className="p-4 rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] hover:border-[#031635] hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-[#44474e] uppercase">
                      Code: <span className="text-[#031635] font-mono font-bold tracking-widest text-sm bg-white px-2 py-0.5 rounded border border-[#e1e3e4]">{c.join_code}</span>
                    </span>
                    <span className="text-[10px] bg-[#e8edf5] text-[#031635] px-2 py-0.5 rounded font-bold">
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <h4 className="font-display font-bold text-[#031635] text-base">{c.name}</h4>
                  <p className="text-xs text-[#75777f] mt-0.5">Code: {c.code}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-[#e1e3e4] flex items-center justify-between text-xs text-[#3f5d9b] font-semibold">
                  <span>Manage Classroom →</span>
                  <span className="material-symbols-outlined text-sm">chevron_right</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
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
