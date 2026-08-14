import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ClassroomAnalyticsTab } from "./pages/ClassroomAnalyticsTab";
import { ClassroomAnnouncementsTab } from "./pages/ClassroomAnnouncementsTab";
import { ClassroomAssignmentsTab } from "./pages/ClassroomAssignmentsTab";
import { ClassroomCourseBuilderTab } from "./pages/ClassroomCourseBuilderTab";
import { ClassroomDashboardTab } from "./pages/ClassroomDashboardTab";
import { ClassroomDetailsTab } from "./pages/ClassroomDetailsTab";
import { ClassroomDocumentsTab } from "./pages/ClassroomDocumentsTab";
import { ClassroomLayout } from "./pages/ClassroomLayout";
import { ClassroomLeaderboardTab } from "./pages/ClassroomLeaderboardTab";
import { ClassroomPresentationPlayer } from "./pages/ClassroomPresentationPlayer";
import { ClassroomPresentationsTab } from "./pages/ClassroomPresentationsTab";
import { ClassroomsPage } from "./pages/ClassroomsPage";
import { CodingPage } from "./pages/CodingPage";
import { CreateClassroomPage } from "./pages/CreateClassroomPage";
import { DashboardPage } from "./pages/DashboardPage";
import { InstitutionsPage } from "./pages/InstitutionsPage";
import { LoginPage } from "./pages/LoginPage";
import { PracticePage } from "./pages/PracticePage";
import { RegisterPage } from "./pages/RegisterPage";
import { SubjectsPage } from "./pages/SubjectsPage";
import { TeamPage } from "./pages/TeamPage";
import { ProfilePage } from "./pages/ProfilePage";
import { AccountSettingsPage } from "./pages/AccountSettingsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { HelpPage } from "./pages/HelpPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/institutions" element={<InstitutionsPage />} />
                <Route path="/classrooms/new" element={<CreateClassroomPage />} />
                <Route path="/classrooms/:classroomId" element={<ClassroomLayout />}>
                  <Route index element={<Navigate to="dashboard" replace />} />
                  <Route path="dashboard" element={<ClassroomDashboardTab />} />
                  <Route path="details" element={<ClassroomDetailsTab />} />
                  <Route path="announcements" element={<ClassroomAnnouncementsTab />} />
                  <Route path="course-builder" element={<ClassroomCourseBuilderTab />} />
                  <Route path="documents" element={<ClassroomDocumentsTab />} />
                  <Route path="presentations/:presentationId" element={<ClassroomPresentationPlayer />} />
                  <Route path="presentations" element={<ClassroomPresentationsTab />} />
                  <Route path="assignments" element={<ClassroomAssignmentsTab />} />
                  <Route path="leaderboard" element={<ClassroomLeaderboardTab />} />
                  <Route path="analytics" element={<ClassroomAnalyticsTab />} />
                </Route>
                <Route path="/classrooms" element={<ClassroomsPage />} />
                <Route path="/subjects" element={<SubjectsPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/practice" element={<PracticePage />} />
                <Route path="/coding" element={<CodingPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/settings" element={<AccountSettingsPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/help" element={<HelpPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
