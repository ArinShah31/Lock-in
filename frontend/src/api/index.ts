import { api, apiForm, clearTokens, setTokens, API_BASE } from "./client";
import type {
  Assignment,
  AssignmentSubmission,
  AuthResponse,
  Classroom,
  ClassroomAnnouncement,
  ClassroomCourse,
  ClassroomStudent,
  Content,
  CourseBuildJob,
  Department,
  Institution,
  StudentAssignmentFeedItem,
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
  }) =>
    api<AuthResponse>(
      "/auth/register",
      { method: "POST", body: JSON.stringify(body) },
      false,
    ),

  login: (body: { email: string; password: string }) =>
    api<AuthResponse>(
      "/auth/login",
      { method: "POST", body: JSON.stringify(body) },
      false,
    ),

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
    api<Institution>("/institutions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (
    id: number,
    body: Partial<{
      name: string;
      code: string;
      address: string;
      is_active: boolean;
    }>,
  ) =>
    api<Institution>(`/institutions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deactivate: (id: number) =>
    api<Institution>(`/institutions/${id}`, { method: "DELETE" }),
  listDepartments: (id: number) =>
    api<Department[]>(`/institutions/${id}/departments`),
  createDepartment: (id: number, body: { name: string; code: string }) =>
    api<Department>(`/institutions/${id}/departments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
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
  }) =>
    api<Classroom>("/classrooms", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  get: (id: number) => api<Classroom>(`/classrooms/${id}`),
  update: (id: number, body: Record<string, unknown>) =>
    api<Classroom>(`/classrooms/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deactivate: (id: number) =>
    api<Classroom>(`/classrooms/${id}`, { method: "DELETE" }),
  join: (join_code: string) =>
    api<ClassroomStudent>("/classrooms/join", {
      method: "POST",
      body: JSON.stringify({ join_code }),
    }),
  myJoinRequests: () => api<ClassroomStudent[]>("/classrooms/my-join-requests"),
  listJoinRequests: (id: number) =>
    api<ClassroomStudent[]>(`/classrooms/${id}/join-requests`),
  approveJoin: (id: number, studentId: number) =>
    api<ClassroomStudent>(
      `/classrooms/${id}/join-requests/${studentId}/approve`,
      { method: "POST" },
    ),
  rejectJoin: (id: number, studentId: number) =>
    api<ClassroomStudent>(
      `/classrooms/${id}/join-requests/${studentId}/reject`,
      { method: "POST" },
    ),
  listStudents: (id: number) =>
    api<ClassroomStudent[]>(`/classrooms/${id}/students`),
  removeStudent: (id: number, studentId: number) =>
    api<ClassroomStudent>(`/classrooms/${id}/students/${studentId}`, {
      method: "DELETE",
    }),
  listAnnouncements: (id: number) =>
    api<ClassroomAnnouncement[]>(`/classrooms/${id}/announcements`),
  createAnnouncement: (id: number, body: { title: string; body: string }) =>
    api<ClassroomAnnouncement>(`/classrooms/${id}/announcements`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export const contentsApi = {
  listByClassroom: (id: number) => api<Content[]>(`/contents/classrooms/${id}`),

  upload: async (classroomId: number, formData: FormData) => {
    const token = localStorage.getItem("astra_access_token");

    const url = `${API_BASE}/contents/classrooms/${classroomId}`;

    const response = await fetch(url, {
      method: "POST",
      headers: token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {},
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Upload failed");
    }

    return response.json();
  },

  delete: (classroomId: number, contentId: number) =>
    api<{ message: string }>(
      `/contents/classrooms/${classroomId}/${contentId}`,
      {
        method: "DELETE",
      },
    ),

  update: (
    contentId: number,
    body: {
      title?: string;
      description?: string;
    },
  ) =>
    api<Content>(`/contents/${contentId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

export const assignmentsApi = {
  myFeed: () => api<StudentAssignmentFeedItem[]>("/me/assignments"),
  listByClassroom: (classroomId: number) =>
    api<Assignment[]>(`/classrooms/${classroomId}/assignments`),
  get: (id: number) => api<Assignment>(`/assignments/${id}`),
  create: (classroomId: number, formData: FormData) =>
    apiForm<Assignment>(`/classrooms/${classroomId}/assignments`, formData),
  submit: (assignmentId: number, formData: FormData) =>
    apiForm<AssignmentSubmission>(
      `/assignments/${assignmentId}/submissions`,
      formData,
    ),
  listSubmissions: (assignmentId: number) =>
    api<AssignmentSubmission[]>(`/assignments/${assignmentId}/submissions`),
  grade: (
    assignmentId: number,
    studentId: number,
    body: { marks: number; feedback?: string },
  ) =>
    api<AssignmentSubmission>(
      `/assignments/${assignmentId}/submissions/${studentId}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),
};

export const courseBuilderApi = {
  get: (classroomId: number) =>
    api<ClassroomCourse>(`/classrooms/${classroomId}/course-builder`),
  uploadSyllabus: (classroomId: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiForm<ClassroomCourse>(
      `/classrooms/${classroomId}/course-builder/syllabus`,
      fd,
    );
  },
  setSources: (
    classroomId: number,
    body: { source_content_ids?: number[]; use_all_documents?: boolean },
  ) =>
    api<ClassroomCourse>(`/classrooms/${classroomId}/course-builder/sources`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  generateAll: (classroomId: number) =>
    api<CourseBuildJob>(
      `/classrooms/${classroomId}/course-builder/generate-all`,
      { method: "POST" },
    ),
  generateAssessments: (classroomId: number) =>
    api<CourseBuildJob>(
      `/classrooms/${classroomId}/course-builder/generate/assessments`,
      {
        method: "POST",
      },
    ),
  generateStructure: (classroomId: number) =>
    api<CourseBuildJob>(
      `/classrooms/${classroomId}/course-builder/generate/structure`,
      {
        method: "POST",
      },
    ),
  generateChapterContent: (classroomId: number, chapterNumber: number) =>
    api<CourseBuildJob>(
      `/classrooms/${classroomId}/course-builder/chapters/${chapterNumber}/generate-content`,
      { method: "POST" },
    ),
  generateChapterQuiz: (classroomId: number, chapterNumber: number) =>
    api<CourseBuildJob>(
      `/classrooms/${classroomId}/course-builder/chapters/${chapterNumber}/generate-quiz`,
      { method: "POST" },
    ),
  generateSubtopicVideo: (
    classroomId: number,
    chapterNumber: number,
    subtopicIndex: number,
  ) =>
    api<CourseBuildJob>(
      `/classrooms/${classroomId}/course-builder/chapters/${chapterNumber}/subtopics/${subtopicIndex}/generate-video`,
      { method: "POST" },
    ),
  setSubtopicVideo: (
    classroomId: number,
    chapterNumber: number,
    subtopicIndex: number,
    youtube_url: string | null,
  ) =>
    api<ClassroomCourse>(
      `/classrooms/${classroomId}/course-builder/chapters/${chapterNumber}/subtopics/${subtopicIndex}/video`,
      { method: "PATCH", body: JSON.stringify({ youtube_url }) },
    ),
  getJob: (classroomId: number, jobId: number) =>
    api<CourseBuildJob>(
      `/classrooms/${classroomId}/course-builder/jobs/${jobId}`,
    ),
  listJobs: (classroomId: number) =>
    api<CourseBuildJob[]>(`/classrooms/${classroomId}/course-builder/jobs`),
  publish: (classroomId: number, is_published: boolean) =>
    api<ClassroomCourse>(`/classrooms/${classroomId}/course-builder/publish`, {
      method: "PATCH",
      body: JSON.stringify({ is_published }),
    }),
  setChapterLock: (
    classroomId: number,
    chapterNumber: number,
    is_unlocked: boolean,
  ) =>
    api<ClassroomCourse>(
      `/classrooms/${classroomId}/course-builder/chapters/${chapterNumber}/lock`,
      {
        method: "PATCH",
        body: JSON.stringify({ is_unlocked }),
      },
    ),
  submitQuiz: (
    classroomId: number,
    chapterNumber: number,
    selected_answers: string[],
  ) =>
    api<{ score: number | null }>(
      `/classrooms/${classroomId}/course-builder/chapters/${chapterNumber}/quiz-attempt`,
      { method: "POST", body: JSON.stringify({ selected_answers }) },
    ),
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
  setCodingPlatform: (userId: number, enabled: boolean) =>
    api<User>(`/users/${userId}/coding-platform`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
};

export const codingPlatformApi = {
  access: () =>
    api<{ enabled: boolean; reason: string | null; frontend_url: string }>(
      "/coding-platform/access",
    ),
  students: () =>
    api<{ id: number; full_name: string; email: string }[]>(
      "/coding-platform/students",
    ),
  ssoToken: () =>
    api<{ token: string; frontend_url: string; expires_in_seconds: number }>(
      "/coding-platform/sso-token",
      { method: "POST" },
    ),
};

export const subjectsApi = {
  list: () => api<Subject[]>("/subjects"),
  listByClassroom: (classroomId: number) =>
    api<Subject[]>(`/classrooms/${classroomId}/subjects`),
  create: (body: {
    classroom_id: number;
    teacher_id: number;
    name: string;
    code: string;
    description?: string;
  }) =>
    api<Subject>("/subjects", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: Record<string, unknown>) =>
    api<Subject>(`/subjects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  updateSyllabus: (
    id: number,
    body: { syllabus_text?: string; syllabus_file_url?: string },
  ) =>
    api<Subject>(`/subjects/${id}/syllabus`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  listMaterials: (id: number) =>
    api<SubjectMaterial[]>(`/subjects/${id}/materials`),
  addMaterial: (
    id: number,
    body: {
      title: string;
      material_type?: string;
      file_url?: string;
      content_text?: string;
    },
  ) =>
    api<SubjectMaterial>(`/subjects/${id}/materials`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export type ChatResponse = {
  document_answer: string;
  additional_explanation?: string;
  used_document: boolean;
  used_general_knowledge: boolean;
};

export const aiApi = {
  chat: (body: { classroom_id: number; question: string }) =>
    api<ChatResponse>("/ai/chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
