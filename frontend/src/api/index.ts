import { api, clearTokens, setTokens } from "./client";
import type {
  AuthResponse,
  Classroom,
  ClassroomAnnouncement,
  ClassroomStudent,
  Department,
  Institution,
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
