import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { assignmentsApi, classroomsApi, codingPlatformApi, practiceApi } from "../api";
import { codingApi, ensureCodingSession } from "../api/codingClient";
import type { MockExam, PracticeOverview, StudentAssignmentFeedItem } from "../api/types";
import { useAuth } from "../auth/AuthContext";

type StudentCodingAssignment = {
  id: number;
  status: "ASSIGNED" | "IN_PROGRESS" | "SUBMITTED" | "BLOCKED";
  test_title?: string | null;
};

export type StudentTodoItem = {
  id: string;
  title: string;
  type: "assignment" | "coding" | "quiz" | "scenario" | "assessment" | "exam";
  badge: string;
  href: string;
  priority: number;
};

export type WorkProgressSegment = {
  key: string;
  label: string;
  description: string;
  completed: number;
  total: number;
  fill: string;
};

export type WorkProgressBreakdown = {
  assignments: { total: number; completed: number };
  coding: { total: number; completed: number };
  practice: { total: number; completed: number };
  segments: WorkProgressSegment[];
};

type ClassroomPracticeBundle = {
  classroomId: number;
  classroomName: string;
  overview: PracticeOverview;
  publishedExams: Array<{ exam: MockExam; hasAttempt: boolean }>;
};

const STALE_MS = 30_000;

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function unlockedAssessmentCount(overview: PracticeOverview) {
  const topic = overview.topic_assessments?.filter((a) => !a.is_locked).length ?? 0;
  const subject = overview.subject_assessments?.filter((a) => !a.is_locked).length ?? 0;
  return topic + subject;
}

async function fetchClassroomPractice(classroomId: number, classroomName: string): Promise<ClassroomPracticeBundle> {
  const [overview, exams] = await Promise.all([
    practiceApi.get(classroomId),
    practiceApi.listMockExams(classroomId),
  ]);
  const published = exams.filter((exam) => exam.status === "PUBLISHED");
  const publishedExams = await Promise.all(
    published.map(async (exam) => {
      try {
        const attempts = await practiceApi.listMockExamAttempts(classroomId, exam.id);
        return { exam, hasAttempt: attempts.length > 0 };
      } catch {
        return { exam, hasAttempt: false };
      }
    }),
  );
  return { classroomId, classroomName, overview, publishedExams };
}

function buildAssignmentTodos(items: StudentAssignmentFeedItem[]): StudentTodoItem[] {
  const todos: StudentTodoItem[] = [];

  for (const item of items) {
    if (item.my_submission) continue;

    const isOverdue = item.is_overdue;
    todos.push({
      id: `assignment-${item.id}`,
      title: item.title,
      type: "assignment",
      badge: isOverdue ? "Overdue" : "Due",
      href: `/classrooms/${item.classroom_id}/assignments?assignment=${item.id}`,
      priority: isOverdue ? 0 : 4,
    });
  }

  return todos;
}

function buildCodingTodos(items: StudentCodingAssignment[]): StudentTodoItem[] {
  return items
    .filter((item) => item.status === "ASSIGNED" || item.status === "IN_PROGRESS")
    .map((item) => ({
      id: `coding-${item.id}`,
      title: item.test_title || "Coding test",
      type: "coding" as const,
      badge: item.status === "IN_PROGRESS" ? "Resume" : "Coding",
      href: "/coding",
      priority: item.status === "IN_PROGRESS" ? 1 : 2,
    }));
}

function buildPracticeTodos(bundle: ClassroomPracticeBundle): StudentTodoItem[] {
  const { classroomId, overview } = bundle;
  const todos: StudentTodoItem[] = [];

  for (const quiz of overview.quizzes ?? []) {
    if (quiz.latest_score != null) continue;
    todos.push({
      id: `quiz-${classroomId}-${quiz.chapter_number}`,
      title: quiz.title,
      type: "quiz",
      badge: "Quiz",
      href: "/practice",
      priority: 3,
    });
  }

  for (const scenario of overview.scenarios ?? []) {
    if (scenario.latest_score != null) continue;
    todos.push({
      id: `scenario-${classroomId}-${scenario.id}`,
      title: scenario.title,
      type: "scenario",
      badge: "Scenario",
      href: "/practice",
      priority: 3,
    });
  }

  const assessments = [
    ...(overview.topic_assessments ?? []),
    ...(overview.subject_assessments ?? []),
  ];
  for (const assessment of assessments) {
    if (assessment.is_locked || assessment.latest_score != null) continue;
    todos.push({
      id: `assessment-${classroomId}-${assessment.assessment_kind}-${assessment.target_key}`,
      title: assessment.title,
      type: "assessment",
      badge: "Assessment",
      href: "/practice",
      priority: 3,
    });
  }

  for (const { exam, hasAttempt } of bundle.publishedExams) {
    if (hasAttempt) continue;
    todos.push({
      id: `exam-${classroomId}-${exam.id}`,
      title: exam.title,
      type: "exam",
      badge: "Exam",
      href: "/practice",
      priority: 3,
    });
  }

  return todos;
}

function aggregateProgress(
  assignments: StudentAssignmentFeedItem[],
  coding: StudentCodingAssignment[],
  practiceBundles: ClassroomPracticeBundle[],
): WorkProgressBreakdown & { total: number; completed: number; completionPct: number } {
  let assignmentTotal = 0;
  let assignmentCompleted = 0;
  for (const item of assignments) {
    assignmentTotal += 1;
    if (item.my_submission) assignmentCompleted += 1;
  }

  let codingTotal = 0;
  let codingCompleted = 0;
  for (const item of coding) {
    codingTotal += 1;
    if (item.status === "SUBMITTED") codingCompleted += 1;
  }

  let practiceTotal = 0;
  let practiceCompleted = 0;
  for (const bundle of practiceBundles) {
    const { overview } = bundle;
    const summary = overview.summary;
    practiceTotal +=
      (summary?.ready_quizzes ?? 0) +
      (summary?.ready_scenarios ?? 0) +
      unlockedAssessmentCount(overview) +
      bundle.publishedExams.length;
    practiceCompleted +=
      (summary?.completed_quizzes ?? 0) +
      (summary?.completed_scenarios ?? 0) +
      (summary?.completed_assessments ?? 0) +
      bundle.publishedExams.filter((entry) => entry.hasAttempt).length;
  }

  const total = assignmentTotal + codingTotal + practiceTotal;
  const completed = assignmentCompleted + codingCompleted + practiceCompleted;
  const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const segments: WorkProgressSegment[] = [
    {
      key: "assignments",
      label: "Tasks",
      description: "Classroom file assignments across your enrolled classes",
      completed: assignmentCompleted,
      total: assignmentTotal,
      fill: "#3f5d9b",
    },
    {
      key: "coding",
      label: "Code",
      description: "Coding tests assigned in the coding workspace",
      completed: codingCompleted,
      total: codingTotal,
      fill: "#6366f1",
    },
    {
      key: "practice",
      label: "Practice",
      description: "Quizzes, scenarios, assessments, and published mock exams",
      completed: practiceCompleted,
      total: practiceTotal,
      fill: "#2f9e73",
    },
  ].filter((segment) => segment.total > 0);

  return {
    total,
    completed,
    completionPct: clampPct(completionPct),
    assignments: { total: assignmentTotal, completed: assignmentCompleted },
    coding: { total: codingTotal, completed: codingCompleted },
    practice: { total: practiceTotal, completed: practiceCompleted },
    segments,
  };
}

export function useStudentWorkProgress() {
  const { user } = useAuth();
  const enabled = !!user && user.role === "STUDENT";

  const classroomsQuery = useQuery({
    queryKey: ["classrooms"],
    queryFn: classroomsApi.list,
    enabled,
    staleTime: STALE_MS,
  });

  const feedQuery = useQuery({
    queryKey: ["student-assignment-feed"],
    queryFn: assignmentsApi.myFeed,
    enabled,
    staleTime: STALE_MS,
  });

  const codingAccessQuery = useQuery({
    queryKey: ["coding-access"],
    queryFn: codingPlatformApi.access,
    enabled,
    staleTime: STALE_MS,
  });

  const codingEnabled = codingAccessQuery.data?.enabled === true;

  const codingQuery = useQuery({
    queryKey: ["student-coding-assignments", user?.email],
    queryFn: async () => {
      try {
        await ensureCodingSession(false, user?.email);
        return await codingApi<StudentCodingAssignment[]>("/student/assignments");
      } catch {
        // Coding SSO/API is optional for the streaks card; keep assignments/practice visible.
        return [] as StudentCodingAssignment[];
      }
    },
    enabled: enabled && codingEnabled && !!user?.email,
    staleTime: STALE_MS,
    retry: false,
  });

  const classrooms = classroomsQuery.data ?? [];

  const practiceQueries = useQueries({
    queries: classrooms.map((room) => ({
      queryKey: ["student-work-practice", room.id] as const,
      queryFn: () =>
        fetchClassroomPractice(room.id, room.name).catch(() => null),
      enabled: enabled && classrooms.length > 0,
      staleTime: STALE_MS,
      retry: false,
    })),
  });

  const practiceBundles = useMemo(
    () =>
      practiceQueries
        .map((query) => query.data)
        .filter((bundle): bundle is ClassroomPracticeBundle => bundle != null),
    [practiceQueries],
  );

  const assignments = feedQuery.data ?? [];
  const codingItems = codingQuery.data ?? [];

  const progress = useMemo(
    () => aggregateProgress(assignments, codingItems, practiceBundles),
    [assignments, codingItems, practiceBundles],
  );

  const todoItems = useMemo(() => {
    const merged = [
      ...buildAssignmentTodos(assignments),
      ...buildCodingTodos(codingItems),
      ...practiceBundles.flatMap(buildPracticeTodos),
    ];
    return merged.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title)).slice(0, 4);
  }, [assignments, codingItems, practiceBundles]);

  const isLoading =
    classroomsQuery.isLoading ||
    feedQuery.isLoading ||
    codingAccessQuery.isLoading ||
    (codingEnabled && codingQuery.isLoading) ||
    (classrooms.length > 0 && practiceQueries.some((query) => query.isLoading));

  const isError = classroomsQuery.isError || feedQuery.isError;

  return {
    total: progress.total,
    completed: progress.completed,
    completionPct: progress.completionPct,
    segments: progress.segments,
    todoItems,
    isLoading,
    isError,
  };
}
