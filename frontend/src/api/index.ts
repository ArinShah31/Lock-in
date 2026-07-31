import { api, clearTokens, setTokens } from "./client";
import type {
  AuthResponse,
  ChapterAttempt,
  ChapterNotes,
  Classroom,
  ClassroomAnnouncement,
  ClassroomStudent,
  CourseArtifact,
  CourseArtifactType,
  CourseBuildJob,
  Department,
  Institution,
  LearningPath,
  Subject,
  SubjectMaterial,
  User,
  UserRole,
} from "./types";

export const authApi = {
  register: (body: {
    full_name: string;
    email: string;
    password: string;
    role: UserRole;
    institution_id?: number | null;
    department_id?: number | null;
  }) => api<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(body) }, false),

  login: (body: { email: string; password: string }) =>
    api<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(body) }, false),

  me: () => api<User>("/auth/me"),
};

export function persistSession(data: AuthResponse) {
  setTokens(data.tokens.access_token, data.tokens.refresh_token);
  localStorage.setItem("astra_user", JSON.stringify(data.user));
}

export function logoutLocal() {
  clearTokens();
}

export const institutionsApi = {
  list: () => api<Institution[]>("/institutions"),
  create: (body: { name: string; code: string; address?: string }) =>
    api<Institution>("/institutions", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: Partial<{ name: string; code: string; address: string; is_active: boolean }>) =>
    api<Institution>(`/institutions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deactivate: (id: number) => api<Institution>(`/institutions/${id}`, { method: "DELETE" }),
  listDepartments: (id: number) => api<Department[]>(`/institutions/${id}/departments`),
  createDepartment: (id: number, body: { name: string; code: string }) =>
    api<Department>(`/institutions/${id}/departments`, { method: "POST", body: JSON.stringify(body) }),
};

export const classroomsApi = {
  list: () => api<Classroom[]>("/classrooms"),
  create: (body: {
    institution_id: number;
    department_id?: number | null;
    class_teacher_id?: number | null;
    name: string;
    code: string;
    academic_year?: string;
    description?: string;
  }) => api<Classroom>("/classrooms", { method: "POST", body: JSON.stringify(body) }),
  get: (id: number) => api<Classroom>(`/classrooms/${id}`),
  update: (id: number, body: Record<string, unknown>) =>
    api<Classroom>(`/classrooms/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deactivate: (id: number) => api<Classroom>(`/classrooms/${id}`, { method: "DELETE" }),
  listStudents: (id: number) => api<ClassroomStudent[]>(`/classrooms/${id}/students`),
  addStudent: (id: number, student_id: number) =>
    api<ClassroomStudent>(`/classrooms/${id}/students`, {
      method: "POST",
      body: JSON.stringify({ student_id }),
    }),
  removeStudent: (id: number, studentId: number) =>
    api<ClassroomStudent>(`/classrooms/${id}/students/${studentId}`, { method: "DELETE" }),
  listAnnouncements: (id: number) => api<ClassroomAnnouncement[]>(`/classrooms/${id}/announcements`),
  createAnnouncement: (id: number, body: { title: string; body: string }) =>
    api<ClassroomAnnouncement>(`/classrooms/${id}/announcements`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export const usersApi = {
  list: () => api<User[]>("/users"),
  create: (body: {
    full_name: string;
    email: string;
    password: string;
    role: UserRole;
    institution_id?: number | null;
    department_id?: number | null;
  }) => api<User>("/users", { method: "POST", body: JSON.stringify(body) }),
};

export const subjectsApi = {
  list: () => api<Subject[]>("/subjects"),
  listByClassroom: (classroomId: number) => api<Subject[]>(`/classrooms/${classroomId}/subjects`),
  create: (body: {
    classroom_id: number;
    teacher_id: number;
    name: string;
    code: string;
    description?: string;
  }) => api<Subject>("/subjects", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: Record<string, unknown>) =>
    api<Subject>(`/subjects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  updateSyllabus: (id: number, body: { syllabus_text?: string; syllabus_file_url?: string }) =>
    api<Subject>(`/subjects/${id}/syllabus`, { method: "PUT", body: JSON.stringify(body) }),
  listMaterials: (id: number) => api<SubjectMaterial[]>(`/subjects/${id}/materials`),
  addMaterial: (
    id: number,
    body: { title: string; material_type?: string; file_url?: string; content_text?: string },
  ) => api<SubjectMaterial>(`/subjects/${id}/materials`, { method: "POST", body: JSON.stringify(body) }),
};

export const courseBuilderApi = {
  uploadSyllabus: (subjectId: number, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return api<Subject>(`/subjects/${subjectId}/course-builder/upload-syllabus`, { method: "POST", body });
  },
  generate: (subjectId: number, artifact_types: CourseArtifactType[] = ["LEARNING_PATH"]) =>
    api<CourseBuildJob>(`/subjects/${subjectId}/course-builder/generate`, {
      method: "POST",
      body: JSON.stringify({ artifact_types }),
    }),
  getJob: (subjectId: number, jobId: number) =>
    api<CourseBuildJob>(`/subjects/${subjectId}/course-builder/jobs/${jobId}`),
  listArtifacts: (subjectId: number) => api<CourseArtifact[]>(`/subjects/${subjectId}/course-builder/artifacts`),
  updateArtifact: (
    artifactId: number,
    body: Partial<Pick<CourseArtifact, "title" | "content" | "is_published">>,
  ) => api<CourseArtifact>(`/course-builder/artifacts/${artifactId}`, { method: "PATCH", body: JSON.stringify(body) }),
  getLearningPath: (subjectId: number) =>
    api<LearningPath>(`/subjects/${subjectId}/course-builder/learning-path`),
  getChapterNotes: (subjectId: number, chapterNumber: number) =>
    api<ChapterNotes>(`/subjects/${subjectId}/course-builder/chapters/${chapterNumber}/notes`),
  generateChapterNotes: (subjectId: number, chapterNumber: number) =>
    api<CourseBuildJob>(`/subjects/${subjectId}/course-builder/chapters/${chapterNumber}/notes/generate`, {
      method: "POST",
    }),
  setChapterLock: (subjectId: number, chapterNumber: number, is_unlocked: boolean) =>
    api<LearningPath>(`/subjects/${subjectId}/course-builder/chapters/${chapterNumber}/lock`, {
      method: "PATCH",
      body: JSON.stringify({ is_unlocked }),
    }),
  submitQuizAttempt: (subjectId: number, chapterNumber: number, selected_answers: string[]) =>
    api<ChapterAttempt>(`/subjects/${subjectId}/course-builder/chapters/${chapterNumber}/quiz-attempt`, {
      method: "POST",
      body: JSON.stringify({ selected_answers }),
    }),
  submitAssessmentAttempt: (subjectId: number, chapterNumber: number, answers: string[]) =>
    api<ChapterAttempt>(`/subjects/${subjectId}/course-builder/chapters/${chapterNumber}/assessment-attempt`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),
};
