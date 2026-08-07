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
  coding_platform_enabled?: boolean;
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

export type AnalyticsShareCode = {
  classroom_id: number;
  analytics_share_code: string;
};

export type AnalyticsGrant = {
  id: number;
  viewer_classroom_id: number;
  source_classroom_id: number;
  granted_by_user_id: number;
  is_active: boolean;
  created_at: string;
  viewer_classroom_name?: string | null;
  viewer_classroom_code?: string | null;
  source_classroom_name?: string | null;
  source_classroom_code?: string | null;
  source_teacher_name?: string | null;
};

export type LinkedStudentAnalytics = {
  student_id: number;
  full_name: string;
  email: string;
  assignments_submitted: number;
  assignments_total: number;
  average_score_pct: number | null;
  last_submission_at: string | null;
};

export type SourceAnalyticsSummary = {
  source_classroom_id: number;
  source_classroom_name: string;
  source_classroom_code: string;
  source_teacher_name: string | null;
  student_count: number;
  assignment_count: number;
  course_published: boolean;
  average_completion_pct: number | null;
  students: LinkedStudentAnalytics[];
};

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

export type StudentAssignmentFeedItem = Assignment & {
  classroom_name: string;
  is_overdue: boolean;
};

export function uploadFileUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  if (filePath.startsWith("http")) return filePath;
  const origin = import.meta.env.VITE_API_ORIGIN ?? "http://127.0.0.1:8000";
  return `${origin}/${filePath.replace(/^\/+/, "")}`;
}

export type CourseSource = {
  title: string;
  url: string;
  source_type: string;
};

export type CourseSection = {
  title: string;
  content_markdown: string;
  key_points: string[];
  sources: CourseSource[];
};

export type CourseExample = {
  title: string;
  context: string;
  content_markdown: string;
  takeaway: string;
};

export type CourseApplication = {
  title: string;
  description: string;
};

export type CourseMisconception = {
  misconception: string;
  correction: string;
};

export type CourseKeyTerm = {
  term: string;
  definition: string;
};

export type CourseLesson = {
  lesson: number;
  title: string;
  overview: string;
  learning_objectives: string[];
  prerequisites: string[];
  sections: CourseSection[];
  examples: CourseExample[];
  real_world_applications: CourseApplication[];
  common_misconceptions: CourseMisconception[];
  key_terms: CourseKeyTerm[];
  summary: string;
  references: CourseSource[];
  learning_outcomes?: string[];
  notes_markdown?: string;
  practice_prompts?: string[];
  needs_video: boolean;
  youtube_video_id: string | null;
  youtube_title: string | null;
  youtube_url: string | null;
};

export type CourseFlashcard = {
  question: string;
  answer: string;
  topic?: string;
};

export type CourseQuizQuestion = {
  question: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
};

export type CourseChapter = {
  chapter: number;
  title: string;
  summary: string;
  timeline: string;
  objectives: string[];
  topics: string[];
  activities: string[];
  lessons: CourseLesson[];
  subtopics?: CourseLesson[];
  flashcards: CourseFlashcard[];
  quiz: CourseQuizQuestion[];
  is_unlocked: boolean;
  is_locked_for_viewer: boolean;
  content_ready: boolean;
  quiz_ready: boolean;
};

export type ClassroomCourse = {
  id: number;
  classroom_id: number;
  title: string;
  syllabus_file_name: string | null;
  source_content_ids: number[];
  is_published: boolean;
  chapters: CourseChapter[];
  created_at: string;
  updated_at: string;
};

export type CourseBuildJob = {
  id: number;
  classroom_id: number;
  course_id: number;
  stage: string;
  chapter_number: number | null;
  subtopic_index: number | null;
  status: string;
  progress_message: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type PracticeQuestion = {
  question: string;
  options: string[];
};

export type MockExamQuestion = {
  id: string;
  question_type: string;
  question: string;
  marks: number;
  options: string[];
  correct_answer?: string | null;
  expected_answer?: string | null;
  section_title: string;
};

export type MockExamSection = {
  id: string;
  title: string;
  instructions: string;
  question_type: string;
  marks_per_question: number;
  question_count: number;
  required_count?: number | null;
  questions: MockExamQuestion[];
};

export type MockExamPattern = {
  title: string;
  total_marks: number;
  duration_minutes: number;
  instructions: string;
  sections: MockExamSection[];
  pyq_file_name?: string | null;
  pyq_file_path?: string | null;
};

export type MockExam = {
  id: number;
  classroom_id: number;
  title: string;
  total_marks: number;
  duration_minutes: number;
  status: string;
  pyq_file_name?: string | null;
  pattern: MockExamPattern | Record<string, unknown>;
  paper: { instructions?: string; sections?: MockExamSection[] };
  error_message?: string | null;
  created_at: string;
  updated_at: string;
};

export type MockExamAttempt = {
  id: number;
  mock_exam_id: number;
  classroom_id: number;
  student_id: number;
  answers: Record<string, string>;
  mcq_score: number | null;
  theory_score: number | null;
  total_score: number | null;
  theory_status: string;
  feedback: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

export type PracticeQuiz = {
  chapter_number: number;
  title: string;
  summary: string;
  topic_label: string;
  question_count: number;
  latest_score: number | null;
  latest_attempted_at: string | null;
  questions: PracticeQuestion[];
};

export type PracticeFlashcard = {
  id: string;
  question: string;
  answer: string;
  cue: string;
};

export type PracticeFlashcardDeck = {
  id: string;
  title: string;
  subject: string;
  summary: string;
  focus: string;
  estimated_time: string;
  mastery_hint: string;
  cards: PracticeFlashcard[];
};

export type PracticeAssessment = {
  assessment_kind: string;
  target_key: string;
  title: string;
  meta: string;
  detail: string;
  question_count: number;
  duration_minutes: number;
  is_locked: boolean;
  latest_score: number | null;
  latest_attempted_at: string | null;
  questions: PracticeQuestion[];
};

export type PracticeSummary = {
  source_document_count: number;
  ready_quizzes: number;
  flashcard_decks: number;
  locked_assessments: number;
  completed_quizzes: number;
  completed_assessments: number;
};

export type PracticeOverview = {
  classroom_id: number;
  classroom_name: string;
  course_title: string | null;
  source_document_count: number;
  summary: PracticeSummary;
  quizzes: PracticeQuiz[];
  flashcard_decks: PracticeFlashcardDeck[];
  topic_assessments: PracticeAssessment[];
  subject_assessments: PracticeAssessment[];
};

export type PracticeAttempt = {
  id: number;
  classroom_id: number;
  score: number | null;
  attempt_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};
