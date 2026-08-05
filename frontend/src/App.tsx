import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ClassroomAssignmentsTab } from "./pages/ClassroomAssignmentsTab";
import { ClassroomCourseBuilderTab } from "./pages/ClassroomCourseBuilderTab";
import { ClassroomDashboardTab } from "./pages/ClassroomDashboardTab";
import { ClassroomDetailsTab } from "./pages/ClassroomDetailsTab";
import { ClassroomDocumentsTab } from "./pages/ClassroomDocumentsTab";
import { ClassroomLayout } from "./pages/ClassroomLayout";
import { ClassroomsPage } from "./pages/ClassroomsPage";
import { CodingPage } from "./pages/CodingPage";
import { CreateClassroomPage } from "./pages/CreateClassroomPage";
import { DashboardPage } from "./pages/DashboardPage";
import { InstitutionsPage } from "./pages/InstitutionsPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SubjectsPage } from "./pages/SubjectsPage";
import { TeamPage } from "./pages/TeamPage";

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
                  <Route path="course-builder" element={<ClassroomCourseBuilderTab />} />
                  <Route path="documents" element={<ClassroomDocumentsTab />} />
                  <Route path="assignments" element={<ClassroomAssignmentsTab />} />
                </Route>
                <Route path="/classrooms" element={<ClassroomsPage />} />
                <Route path="/subjects" element={<SubjectsPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/coding" element={<CodingPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
