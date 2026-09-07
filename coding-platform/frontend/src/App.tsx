import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { ReturnToAstraPage } from "./pages/ReturnToAstraPage";
import { TeacherHome } from "./pages/TeacherHome";
import { StudentHome } from "./pages/StudentHome";
import { ExamPage } from "./pages/ExamPage";
import { SubmittedPage } from "./pages/SubmittedPage";
import { SsoPage } from "./pages/SsoPage";

function Guard({ role, children }: { role: "TEACHER" | "STUDENT"; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-300">Loading…</div>;
  if (!user) return <Navigate to="/no-access" replace />;
  if (user.role !== role) {
    return <Navigate to={user.role === "TEACHER" ? "/teacher" : "/student"} replace />;
  }
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route
        path="/"
        element={
          loading ? (
            <div className="p-8">Loading…</div>
          ) : user ? (
            <Navigate to={user.role === "TEACHER" ? "/teacher" : "/student"} replace />
          ) : (
            <Navigate to="/no-access" replace />
          )
        }
      />
      <Route path="/no-access" element={<ReturnToAstraPage />} />
      <Route path="/sso" element={<SsoPage />} />
      <Route
        path="/teacher/*"
        element={
          <Guard role="TEACHER">
            <TeacherHome />
          </Guard>
        }
      />
      <Route
        path="/student"
        element={
          <Guard role="STUDENT">
            <StudentHome />
          </Guard>
        }
      />
      <Route
        path="/exam/:sessionId"
        element={
          <Guard role="STUDENT">
            <ExamPage />
          </Guard>
        }
      />
      <Route
        path="/submitted/:sessionId"
        element={
          <Guard role="STUDENT">
            <SubmittedPage />
          </Guard>
        }
      />
    </Routes>
  );
}
