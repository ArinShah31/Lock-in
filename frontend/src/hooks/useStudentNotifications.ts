import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { assignmentsApi, classroomsApi } from "../api";
import type { ClassroomStudent, StudentAssignmentFeedItem } from "../api/types";
import { useAuth } from "../auth/AuthContext";

export type StudentNotificationItem = {
  id: string;
  kind: "join_pending" | "join_approved" | "join_rejected" | "new_assignment" | "graded";
  title: string;
  subtitle: string;
  to: string;
};

const REFETCH_MS = 45_000;
const GRADED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function daysAgo(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= GRADED_WINDOW_MS;
}

export function useStudentNotifications() {
  const { user } = useAuth();
  const enabled = !!user && user.role === "STUDENT";

  const membershipsQuery = useQuery({
    queryKey: ["my-memberships"],
    queryFn: classroomsApi.myMemberships,
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? REFETCH_MS : false,
  });

  const feedQuery = useQuery({
    queryKey: ["student-assignment-feed"],
    queryFn: assignmentsApi.myFeed,
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? REFETCH_MS : false,
  });

  const items = useMemo(() => {
    const out: StudentNotificationItem[] = [];
    const memberships = (membershipsQuery.data ?? []) as ClassroomStudent[];
    for (const m of memberships) {
      const room = m.classroom_name?.trim() || m.classroom_code || `Classroom ${m.classroom_id}`;
      if (m.status === "PENDING") {
        out.push({
          id: `join-pending-${m.classroom_id}`,
          kind: "join_pending",
          title: `Waiting for approval to join ${room}`,
          subtitle: room,
          to: "/classrooms",
        });
      } else if (m.status === "APPROVED" && daysAgo(m.decided_at)) {
        out.push({
          id: `join-approved-${m.classroom_id}-${m.decided_at}`,
          kind: "join_approved",
          title: `You’re in — join to ${room} was approved`,
          subtitle: room,
          to: `/classrooms/${m.classroom_id}/dashboard`,
        });
      } else if (m.status === "REJECTED" && daysAgo(m.decided_at)) {
        out.push({
          id: `join-rejected-${m.classroom_id}-${m.decided_at}`,
          kind: "join_rejected",
          title: `Join request for ${room} was declined`,
          subtitle: room,
          to: "/classrooms",
        });
      }
    }

    const feed = (feedQuery.data ?? []) as StudentAssignmentFeedItem[];
    for (const a of feed) {
      const room = a.classroom_name || `Classroom ${a.classroom_id}`;
      const sub = a.my_submission;
      if (!sub) {
        out.push({
          id: `new-assignment-${a.id}`,
          kind: "new_assignment",
          title: `New assignment: ${a.title}`,
          subtitle: room,
          to: `/classrooms/${a.classroom_id}/assignments?assignment=${a.id}`,
        });
        continue;
      }
      if (sub.graded_at && daysAgo(sub.graded_at)) {
        const marks =
          sub.marks != null ? ` — ${sub.marks}/${a.max_marks}` : "";
        out.push({
          id: `graded-${a.id}-${sub.graded_at}`,
          kind: "graded",
          title: `Graded: ${a.title}${marks}`,
          subtitle: room,
          to: `/classrooms/${a.classroom_id}/assignments?assignment=${a.id}`,
        });
      }
    }

    return out;
  }, [membershipsQuery.data, feedQuery.data]);

  return {
    enabled,
    items,
    count: items.length,
    loading: enabled && (membershipsQuery.isLoading || feedQuery.isLoading),
  };
}
