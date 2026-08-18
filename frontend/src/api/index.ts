import { api, apiForm, apiBlob, clearTokens, setTokens, API_BASE, getAccessToken } from "./client";
import type {
  AnalyticsGrant,
  AnalyticsShareCode,
  Assignment,
  AssignmentSubmission,
  AuthResponse,
  Classroom,
  ClassroomAnnouncement,
  ClassroomLeaderboard,
  ClassroomCourse,
  ClassroomPresentation,
  ClassroomPresentationDetail,
  ClassroomStudent,
  Content,
  CourseBuildJob,
  Department,
  Institution,
  MockExam,
  MockExamAttempt,
  MockExamPattern,
  SourceAnalyticsSummary,
  StudentAssignmentFeedItem,
  StudentStreak,
  PracticeAttempt,
  PracticeOverview,
  TeacherOverview,
  TeacherChatResponse,
  Subject,
  SubjectMaterial,
  User,
  UserProfile,
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

  google: (body: { id_token: string }) =>
    api<AuthResponse>("/auth/google", { method: "POST", body: JSON.stringify(body) }, false),

  me: () => api<User>("/auth/me"),
  profile: () => api<UserProfile>("/auth/me/profile"),
  updateMe: (body: { full_name: string }) =>
    api<User>("/auth/me", { method: "PATCH", body: JSON.stringify(body) }),
  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiForm<User>("/auth/me/avatar", formData);
  },
  changePassword: (body: { current_password: string; new_password: string }) =>
    api<void>("/auth/change-password", { method: "POST", body: JSON.stringify(body) }),
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
  join: (join_code: string) =>
    api<ClassroomStudent>("/classrooms/join", {
      method: "POST",
      body: JSON.stringify({ join_code }),
    }),
  myJoinRequests: () => api<ClassroomStudent[]>("/classrooms/my-join-requests"),
  myMemberships: () => api<ClassroomStudent[]>("/classrooms/my-memberships"),
  listJoinRequests: (id: number) => api<ClassroomStudent[]>(`/classrooms/${id}/join-requests`),
  approveJoin: (id: number, studentId: number) =>
    api<ClassroomStudent>(`/classrooms/${id}/join-requests/${studentId}/approve`, { method: "POST" }),
  rejectJoin: (id: number, studentId: number) =>
    api<ClassroomStudent>(`/classrooms/${id}/join-requests/${studentId}/reject`, { method: "POST" }),
  listStudents: (id: number) => api<ClassroomStudent[]>(`/classrooms/${id}/students`),
  removeStudent: (id: number, studentId: number) =>
    api<ClassroomStudent>(`/classrooms/${id}/students/${studentId}`, { method: "DELETE" }),
  listAnnouncements: (id: number) => api<ClassroomAnnouncement[]>(`/classrooms/${id}/announcements`),
  createAnnouncement: (id: number, body: { title: string; body: string }) =>
    api<ClassroomAnnouncement>(`/classrooms/${id}/announcements`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  leaderboard: (id: number) => api<ClassroomLeaderboard>(`/classrooms/${id}/leaderboard`),
  teacherOverview: () => api<TeacherOverview>("/classrooms/teacher-overview"),
};

export const classroomAnalyticsApi = {
  getShareCode: (classroomId: number) =>
    api<AnalyticsShareCode>(`/classrooms/${classroomId}/analytics-share-code`),
  rotateShareCode: (classroomId: number) =>
    api<AnalyticsShareCode>(`/classrooms/${classroomId}/analytics-share-code/rotate`, {
      method: "POST",
    }),
  grantAccess: (sourceClassroomId: number, viewerCode: string) =>
    api<AnalyticsGrant>(`/classrooms/${sourceClassroomId}/analytics-grants`, {
      method: "POST",
      body: JSON.stringify({ viewer_code: viewerCode }),
    }),
  listInbound: (viewerClassroomId: number) =>
    api<AnalyticsGrant[]>(`/classrooms/${viewerClassroomId}/analytics-grants`),
  listOutbound: (sourceClassroomId: number) =>
    api<AnalyticsGrant[]>(`/classrooms/${sourceClassroomId}/analytics-grants/outbound`),
  revoke: (classroomId: number, grantId: number) =>
    api<AnalyticsGrant>(`/classrooms/${classroomId}/analytics-grants/${grantId}`, {
      method: "DELETE",
    }),
  sourceSummary: (viewerClassroomId: number, sourceClassroomId: number) =>
    api<SourceAnalyticsSummary>(
      `/classrooms/${viewerClassroomId}/analytics/sources/${sourceClassroomId}`,
    ),
};

export const contentsApi = {
  listByClassroom: (id: number) =>
    api<Content[]>(`/contents/classrooms/${id}`),

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
    apiForm<AssignmentSubmission>(`/assignments/${assignmentId}/submissions`, formData),
  listSubmissions: (assignmentId: number) =>
    api<AssignmentSubmission[]>(`/assignments/${assignmentId}/submissions`),
  grade: (assignmentId: number, studentId: number, body: { marks: number; feedback?: string }) =>
    api<AssignmentSubmission>(`/assignments/${assignmentId}/submissions/${studentId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

export const streakApi = {
  me: () => api<StudentStreak>("/me/streak"),
};

export const courseBuilderApi = {
  get: (classroomId: number) => api<ClassroomCourse>(`/classrooms/${classroomId}/course-builder`),
  uploadSyllabus: (classroomId: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiForm<ClassroomCourse>(`/classrooms/${classroomId}/course-builder/syllabus`, fd);
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
    api<CourseBuildJob>(`/classrooms/${classroomId}/course-builder/generate-all`, { method: "POST" }),
  generateStructure: (classroomId: number) =>
    api<CourseBuildJob>(`/classrooms/${classroomId}/course-builder/generate/structure`, {
      method: "POST",
    }),
  generateChapterContent: (classroomId: number, chapterNumber: number) =>
    api<CourseBuildJob>(
      `/classrooms/${classroomId}/course-builder/chapters/${chapterNumber}/generate-content`,
      { method: "POST" },
    ),
  generateSubtopicVideo: (classroomId: number, chapterNumber: number, subtopicIndex: number) =>
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
    api<CourseBuildJob>(`/classrooms/${classroomId}/course-builder/jobs/${jobId}`),
  listJobs: (classroomId: number) =>
    api<CourseBuildJob[]>(`/classrooms/${classroomId}/course-builder/jobs`),
  publish: (classroomId: number, is_published: boolean) =>
    api<ClassroomCourse>(`/classrooms/${classroomId}/course-builder/publish`, {
      method: "PATCH",
      body: JSON.stringify({ is_published }),
    }),
  setChapterLock: (classroomId: number, chapterNumber: number, is_unlocked: boolean) =>
    api<ClassroomCourse>(`/classrooms/${classroomId}/course-builder/chapters/${chapterNumber}/lock`, {
      method: "PATCH",
      body: JSON.stringify({ is_unlocked }),
    }),
};

export const practiceApi = {
  get: async (classroomId: number) => {
    const data = await api<PracticeOverview>(`/classrooms/${classroomId}/practice`);
    return {
      ...data,
      scenarios: data.scenarios ?? [],
      summary: {
        ...data.summary,
        ready_scenarios: data.summary?.ready_scenarios ?? 0,
        completed_scenarios: data.summary?.completed_scenarios ?? 0,
      },
    };
  },
  extractMockPattern: (classroomId: number, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiForm<MockExamPattern>(
      `/classrooms/${classroomId}/practice/mock-exams/pattern`,
      formData,
    );
  },
  createMockExam: (
    classroomId: number,
    body: {
      title: string;
      total_marks: number;
      duration_minutes: number;
      pattern: Record<string, unknown>;
      pyq_file_name?: string | null;
      pyq_file_path?: string | null;
    },
  ) =>
    api<MockExam>(`/classrooms/${classroomId}/practice/mock-exams`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listMockExams: (classroomId: number) =>
    api<MockExam[]>(`/classrooms/${classroomId}/practice/mock-exams`),
  publishMockExam: (classroomId: number, examId: number, is_published: boolean) =>
    api<MockExam>(`/classrooms/${classroomId}/practice/mock-exams/${examId}/publish`, {
      method: "PATCH",
      body: JSON.stringify({ is_published }),
    }),
  regenerateMockExam: (classroomId: number, examId: number) =>
    api<MockExam>(`/classrooms/${classroomId}/practice/mock-exams/${examId}/regenerate`, {
      method: "POST",
    }),
  submitMockExam: (classroomId: number, examId: number, answers: Record<string, string>) =>
    api<MockExamAttempt>(`/classrooms/${classroomId}/practice/mock-exams/${examId}/attempt`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),
  listMockExamAttempts: (classroomId: number, examId: number) =>
    api<MockExamAttempt[]>(`/classrooms/${classroomId}/practice/mock-exams/${examId}/attempts`),
  reviewMockExamAttempt: (
    classroomId: number,
    examId: number,
    attemptId: number,
    body: { theory_score: number; feedback?: string | null },
  ) =>
    api<MockExamAttempt>(`/classrooms/${classroomId}/practice/mock-exams/${examId}/attempts/${attemptId}/review`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  submitQuiz: (classroomId: number, chapterNumber: number, selected_answers: string[]) =>
    api<PracticeAttempt>(`/classrooms/${classroomId}/practice/quizzes/${chapterNumber}/attempt`, {
      method: "POST",
      body: JSON.stringify({ selected_answers }),
    }),
  submitScenario: (
    classroomId: number,
    chapterNumber: number,
    scenarioId: string,
    selected_answers: string[],
  ) =>
    api<PracticeAttempt>(
      `/classrooms/${classroomId}/practice/scenarios/${chapterNumber}/${scenarioId}/attempt`,
      {
        method: "POST",
        body: JSON.stringify({ selected_answers }),
      },
    ),
  submitAssessment: (
    classroomId: number,
    assessmentKind: string,
    targetKey: string,
    selected_answers: string[],
  ) =>
    api<PracticeAttempt>(`/classrooms/${classroomId}/practice/assessments/${assessmentKind}/${targetKey}/attempt`, {
      method: "POST",
      body: JSON.stringify({ selected_answers }),
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
  setCodingPlatform: (userId: number, enabled: boolean) =>
    api<User>(`/users/${userId}/coding-platform`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
};

export const codingPlatformApi = {
  access: () =>
    api<{ enabled: boolean; reason: string | null; frontend_url: string }>("/coding-platform/access"),
  students: () =>
    api<{ id: number; full_name: string; email: string }[]>("/coding-platform/students"),
  ssoToken: () =>
    api<{ token: string; frontend_url: string; expires_in_seconds: number }>(
      "/coding-platform/sso-token",
      { method: "POST" },
    ),
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

export type ChatResponse = {
  document_answer: string;
  additional_explanation?: string;
  used_document: boolean;
  used_general_knowledge: boolean;
  blocked?: boolean;
};

export const aiApi = {
  chat: (body: { classroom_id: number; question: string }) =>
    api<ChatResponse>("/ai/chat", {
      method: "POST",
      body: JSON.stringify(body),
      // Visual PDF analysis can take several minutes (render pages + Gemini vision).
      timeoutMs: 600_000,
    }),
  teacherChat: (body: { question: string; classroom_id?: number | null }) =>
    api<TeacherChatResponse>(
      "/ai/teacher-chat",
      {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 60_000,
      },
    ),
};

export const presentationsApi = {
  list: (classroomId: number) =>
    api<ClassroomPresentation[]>(`/classrooms/${classroomId}/presentations`),
  get: (classroomId: number, presentationId: number) =>
    api<ClassroomPresentationDetail>(`/classrooms/${classroomId}/presentations/${presentationId}`),
  upload: (classroomId: number, title: string, file: File) => {
    const fd = new FormData();
    fd.append("title", title);
    fd.append("file", file);
    return apiForm<ClassroomPresentationDetail>(
      `/classrooms/${classroomId}/presentations`,
      fd,
      "POST",
      300_000,
    );
  },
  patchSlide: (classroomId: number, presentationId: number, slideId: number, script: string) =>
    api<ClassroomPresentationDetail["slides"][number]>(
      `/classrooms/${classroomId}/presentations/${presentationId}/slides/${slideId}`,
      { method: "PATCH", body: JSON.stringify({ script }) },
    ),
  generateVoiceover: (classroomId: number, presentationId: number, slideId?: number) =>
    api<ClassroomPresentationDetail>(
      `/classrooms/${classroomId}/presentations/${presentationId}/voiceover${
        slideId ? `?slide_id=${slideId}` : ""
      }`,
      { method: "POST", timeoutMs: 180_000 },
    ),
  generateVideo: (classroomId: number, presentationId: number) =>
    api<ClassroomPresentationDetail>(
      `/classrooms/${classroomId}/presentations/${presentationId}/video`,
      { method: "POST", timeoutMs: 30_000 },
    ),
  remove: (classroomId: number, presentationId: number) =>
    api<void>(`/classrooms/${classroomId}/presentations/${presentationId}`, { method: "DELETE" }),
  download: async (classroomId: number, presentationId: number, fileName: string) => {
    const blob = await apiBlob(`/classrooms/${classroomId}/presentations/${presentationId}/download`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  },
  audioUrl: (classroomId: number, presentationId: number, slideId: number) =>
    `/classrooms/${classroomId}/presentations/${presentationId}/slides/${slideId}/audio`,
  imageUrl: (classroomId: number, presentationId: number, slideId: number) =>
    `/classrooms/${classroomId}/presentations/${presentationId}/slides/${slideId}/image`,
  videoUrl: (classroomId: number, presentationId: number) =>
    `/classrooms/${classroomId}/presentations/${presentationId}/video`,
  fetchBlob: (path: string, timeoutMs = 120_000) => apiBlob(path, timeoutMs),
  mediaSrc: (path: string) => {
    const token = getAccessToken() ?? "";
    return `${API_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  },
};
