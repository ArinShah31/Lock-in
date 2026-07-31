import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ClassroomsPage } from "./pages/ClassroomsPage";
import { ChapterNotesPage } from "./pages/ChapterNotesPage";
import { CourseBuilderPage } from "./pages/CourseBuilderPage";
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
                <Route path="/classrooms" element={<ClassroomsPage />} />
                <Route path="/subjects" element={<SubjectsPage />} />
                <Route path="/course-builder" element={<CourseBuilderPage />} />
                <Route
                  path="/course-builder/subjects/:subjectId/chapters/:chapterNumber/notes"
                  element={<ChapterNotesPage />}
                />
                <Route path="/team" element={<TeamPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
