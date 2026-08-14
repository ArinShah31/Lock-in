import { useQuery } from "@tanstack/react-query";
import { streakApi } from "../api";

const STALE_MS = 30_000;

export function useStudentOnTimeStreak() {
  const query = useQuery({
    queryKey: ["student-on-time-streak"],
    queryFn: streakApi.me,
    staleTime: STALE_MS,
  });

  return {
    streak: query.data?.streak ?? 0,
    lastBreak: query.data?.last_break ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
