import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { assignmentsApi, classroomsApi } from "../api";
import type { Assignment, Classroom, ClassroomStudent } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { dueState, formatDueIn } from "../lib/dueReminders";

export type TeacherNotificationItem = {
  id: string;
  kind: "join_request" | "ungraded" | "not_submitted";
  classroomId: number;
  classroomName: string;
  title: string;
  subtitle: string;
  to: string;
};

const REFETCH_MS = 45_000;

export function useTeacherNotifications() {
  const { user } = useAuth();
  const enabled =
    !!user && (user.role === "CLASS_TEACHER" || user.role === "SUBJECT_TEACHER");

  const classroomsQuery = useQuery({
    queryKey: ["classrooms"],
    queryFn: classroomsApi.list,
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? REFETCH_MS : false,
  });

  const owned = useMemo(() => {
    if (!user || !classroomsQuery.data) return [] as Classroom[];
    return classroomsQuery.data.filter((c) => c.class_teacher_id === user.id);
  }, [classroomsQuery.data, user]);

  const joinQueries = useQueries({
    queries: owned.map((c) => ({
      queryKey: ["classroom-join-requests", c.id] as const,
      queryFn: () => classroomsApi.listJoinRequests(c.id),
      enabled: enabled && owned.length > 0,
      staleTime: 15_000,
      refetchInterval: enabled ? REFETCH_MS : false,
    })),
  });

  const assignmentQueries = useQueries({
    queries: owned.map((c) => ({
      queryKey: ["assignments", c.id] as const,
      queryFn: () => assignmentsApi.listByClassroom(c.id),
      enabled: enabled && owned.length > 0,
      staleTime: 15_000,
      refetchInterval: enabled ? REFETCH_MS : false,
    })),
  });

  const items = useMemo(() => {
    const out: TeacherNotificationItem[] = [];

    owned.forEach((classroom, index) => {
      const joins = (joinQueries[index]?.data ?? []) as ClassroomStudent[];
      for (const join of joins) {
        const name = join.student_full_name?.trim() || `Student ${join.student_id}`;
        out.push({
          id: `join-${classroom.id}-${join.student_id}`,
          kind: "join_request",
          classroomId: classroom.id,
          classroomName: classroom.name,
          title: `${name} requested to join`,
          subtitle: classroom.name,
          to: `/classrooms/${classroom.id}/details`,
        });
      }

      const assignments = (assignmentQueries[index]?.data ?? []) as Assignment[];
      for (const assignment of assignments) {
        const submitted = assignment.submitted_count ?? 0;
        const graded = assignment.graded_count ?? 0;

        const missing = (assignment.student_count ?? 0) - submitted;
        if (missing > 0 && dueState(assignment.due_at) === "due_soon") {
          out.push({
            id: `not-submitted-${classroom.id}-${assignment.id}`,
            kind: "not_submitted",
            classroomId: classroom.id,
            classroomName: classroom.name,
            title:
              missing === 1
                ? `1 student hasn't submitted ${assignment.title}`
                : `${missing} students haven't submitted ${assignment.title}`,
            subtitle: `${classroom.name} · due ${formatDueIn(assignment.due_at)}`,
            to: `/classrooms/${classroom.id}/assignments?assignment=${assignment.id}`,
          });
        }

        const ungraded = submitted - graded;
        if (ungraded <= 0) continue;
        out.push({
          id: `ungraded-${classroom.id}-${assignment.id}`,
          kind: "ungraded",
          classroomId: classroom.id,
          classroomName: classroom.name,
          title:
            ungraded === 1
              ? `1 ungraded submission in ${assignment.title}`
              : `${ungraded} ungraded submissions in ${assignment.title}`,
          subtitle: classroom.name,
          to: `/classrooms/${classroom.id}/assignments`,
        });
      }
    });

    return out;
  }, [owned, joinQueries, assignmentQueries]);

  const loading =
    enabled &&
    (classroomsQuery.isLoading ||
      (owned.length > 0 &&
        (joinQueries.some((q) => q.isLoading) || assignmentQueries.some((q) => q.isLoading))));

  return {
    enabled: Boolean(user && (user.role === "CLASS_TEACHER" || user.role === "SUBJECT_TEACHER")),
    isOwner: owned.length > 0,
    items,
    count: items.length,
    loading,
  };
}
