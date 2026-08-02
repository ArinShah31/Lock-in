export type UserRole =
  | "SUPER_ADMIN"
  | "INSTITUTION_ADMIN"
  | "HOD"
  | "CLASS_TEACHER"
  | "SUBJECT_TEACHER"
  | "STUDENT";

export type User = {
  id: number;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  institution_id: number | null;
  department_id: number | null;
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
};

export type AuthResponse = {
  user: User;
  tokens: TokenPair;
};

export type Institution = {
  id: number;
  name: string;
  code: string;
  address: string | null;
  is_active: boolean;
  created_at: string;
};

export type Department = {
  id: number;
  institution_id: number;
  name: string;
  code: string;
  is_active: boolean;
};

export type Classroom = {
  id: number;
  institution_id: number;
  department_id: number | null;
  class_teacher_id: number;
  name: string;
  code: string;
  join_code: string;
  academic_year: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

export type MembershipStatus = "PENDING" | "APPROVED" | "REJECTED";

export type ClassroomStudent = {
  id: number;
  classroom_id: number;
  student_id: number;
  status: MembershipStatus;
  is_active: boolean;
  joined_at: string;
  student_full_name?: string | null;
  student_email?: string | null;
  classroom_name?: string | null;
  classroom_code?: string | null;
};

export type Subject = {
  id: number;
  classroom_id: number;
  teacher_id: number;
  name: string;
  code: string;
  description: string | null;
  syllabus_text: string | null;
  syllabus_file_url: string | null;
  is_published: boolean;
  is_active: boolean;
  created_at: string;
};

export type ClassroomAnnouncement = {
  id: number;
  classroom_id: number;
  author_id: number;
  title: string;
  body: string;
  is_active: boolean;
  created_at: string;
};

export type SubjectMaterial = {
  id: number;
  subject_id: number;
  uploaded_by: number;
  title: string;
  material_type: string;
  file_url: string | null;
  content_text: string | null;
  is_active: boolean;
  created_at: string;
};

export type Content = {
  id: number;
  classroom_id: number;
  uploaded_by: number;
  title: string;
  description: string | null;
  content_type: string;
  file_name: string;
  file_path: string;
  external_url: string | null;
  file_size: number;
  mime_type: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
};

export type AssignmentSubmission = {
  id: number;
  assignment_id: number;
  student_id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  submitted_at: string;
  is_late: boolean;
  marks: number | null;
  feedback: string | null;
  graded_at: string | null;
  graded_by: number | null;
  student_full_name?: string | null;
  student_email?: string | null;
  is_graded: boolean;
};

export type Assignment = {
  id: number;
  classroom_id: number;
  created_by: number;
  title: string;
  instructions: string | null;
  max_marks: number;
  due_at: string;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  is_active: boolean;
  created_at: string;
  submitted_count?: number | null;
  graded_count?: number | null;
  my_submission?: AssignmentSubmission | null;
};

export function uploadFileUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  if (filePath.startsWith("http")) return filePath;
  const origin = import.meta.env.VITE_API_ORIGIN ?? "http://127.0.0.1:8000";
  return `${origin}/${filePath.replace(/^\/+/, "")}`;
}
