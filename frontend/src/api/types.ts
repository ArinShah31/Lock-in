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
  academic_year: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
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

export type ClassroomStudent = {
  id: number;
  classroom_id: number;
  student_id: number;
  is_active: boolean;
  joined_at: string;
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

export type CourseArtifactType =
  | "LEARNING_PATH"
  | "ROADMAP"
  | "FLASHCARDS"
  | "QUIZ"
  | "ASSESSMENT"
  | "CHAPTER_NOTES";

export type CourseBuildStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export type CourseBuildJob = {
  id: number;
  subject_id: number;
  created_by_id: number;
  status: CourseBuildStatus;
  requested_artifacts: string[];
  syllabus_file_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type CourseArtifact = {
  id: number;
  subject_id: number;
  job_id: number | null;
  created_by_id: number;
  artifact_type: CourseArtifactType;
  title: string;
  content: unknown;
  is_published: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Flashcard = {
  question: string;
  answer: string;
  topic: string;
  difficulty: string;
};

export type QuizQuestion = {
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  difficulty: string;
};

export type AssessmentPrompt = {
  prompt: string;
};

export type Assessment = {
  title: string;
  instructions: string;
  prompts: AssessmentPrompt[];
  rubric: string[];
  estimated_minutes: number;
};

export type LearningChapter = {
  chapter: number;
  title: string;
  summary: string | null;
  timeline: string | null;
  objectives: string[];
  topics: string[];
  activities: string[];
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
  assessment: Assessment | null;
  is_unlocked: boolean;
  is_current: boolean;
  is_locked_for_viewer: boolean;
};

export type LearningPath = {
  subject_id: number;
  artifact_id: number | null;
  is_published: boolean;
  current_chapter: number;
  chapters: LearningChapter[];
};

export type LessonNote = {
  lesson: number;
  title: string;
  summary: string;
  learning_outcomes: string[];
  notes_markdown: string;
  key_terms: string[];
  examples: string[];
  practice_prompts: string[];
};

export type ChapterNotesStatus = "READY" | "MISSING" | "GENERATING" | "FAILED";

export type ChapterNotes = {
  subject_id: number;
  chapter: number;
  chapter_title: string | null;
  status: ChapterNotesStatus;
  intro: string | null;
  lessons: LessonNote[];
  artifact_id: number | null;
  job_id: number | null;
  is_published: boolean;
  is_unlocked: boolean;
  is_locked_for_viewer: boolean;
  error_message: string | null;
};

export type ChapterAttempt = {
  id: number;
  subject_id: number;
  chapter_number: number;
  attempt_type: string;
  score: number | null;
  payload: unknown;
  created_at: string;
};
