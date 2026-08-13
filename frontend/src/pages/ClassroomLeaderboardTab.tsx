import { useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { classroomsApi } from "../api";
import type { Classroom, ClassroomLeaderboard, LeaderboardEntry } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import ProfileCard from "../components/ProfileCard";
import { ErrorText } from "../components/ui";

type OutletCtx = { classroom: Classroom };
type LeaderboardFilter = "overall" | "practice" | "exams" | "coding";

function sortValue(entry: LeaderboardEntry, filter: LeaderboardFilter): number {
  if (filter === "practice") return entry.quiz_points;
  if (filter === "exams") return entry.exam_points;
  if (filter === "coding") return entry.coding_points;
  return entry.total_points;
}

function sortedEntries(entries: LeaderboardEntry[], filter: LeaderboardFilter): LeaderboardEntry[] {
  const ranked = [...entries].sort((a, b) => {
    const diff = sortValue(b, filter) - sortValue(a, filter);
    if (diff !== 0) return diff;
    return a.full_name.localeCompare(b.full_name);
  });

  let rank = 0;
  let lastValue: number | null = null;
  return ranked.map((entry, index) => {
    const value = sortValue(entry, filter);
    if (lastValue !== value) {
      rank = index + 1;
      lastValue = value;
    }
    return { ...entry, rank };
  });
}

function filterPillClass(active: boolean): string {
  return [
    "rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition",
    active
      ? "border-cyan-300/60 bg-cyan-400/20 text-white shadow-[0_0_20px_rgba(34,211,238,0.35)]"
      : "border-white/15 bg-white/5 text-violet-200/80 hover:border-white/30 hover:text-white",
  ].join(" ");
}

function rankBadge(rank: number): string {
  if (rank === 1) return "👑";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${String(rank).padStart(3, "0")}`;
}

function initialsAvatarDataUrl(initials: string): string {
  const safe = initials.replace(/[<>&'"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="140" font-family="system-ui,sans-serif" font-weight="700">${safe}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function Avatar({
  initials,
  size = "md",
  glow = false,
}: {
  initials: string;
  size?: "sm" | "md" | "lg";
  glow?: boolean;
}) {
  const sizeClass =
    size === "lg"
      ? "h-20 w-20 text-xl"
      : size === "md"
        ? "h-14 w-14 text-base"
        : "h-10 w-10 text-xs";
  return (
    <div
      className={[
        "flex shrink-0 items-center justify-center rounded-full border-2 border-white/30 bg-gradient-to-br from-violet-500 to-blue-500 font-bold text-white",
        sizeClass,
        glow ? "shadow-[0_0_28px_rgba(167,139,250,0.75)] ring-4 ring-cyan-300/30" : "shadow-lg",
      ].join(" ")}
    >
      {initials}
    </div>
  );
}

const PODIUM_TITLES = {
  1: "Champion",
  2: "Silver",
  3: "Bronze",
} as const;

function PodiumProfileCard({
  entry,
  place,
  points,
}: {
  entry: LeaderboardEntry | undefined;
  place: 1 | 2 | 3;
  points: number;
}) {
  const order = { 1: "order-2", 2: "order-1", 3: "order-3" } as const;

  if (!entry) {
    return (
      <div className={`flex flex-1 flex-col items-center justify-end ${order[place]}`}>
        <div className="h-[280px] w-full max-w-[11rem] rounded-3xl border border-dashed border-white/20 bg-white/5 sm:h-[320px]" />
      </div>
    );
  }

  const avatarUrl = entry.avatar_url || initialsAvatarDataUrl(entry.initials);

  return (
    <div className={`flex flex-1 flex-col items-center justify-end ${order[place]}`}>
      <ProfileCard
        className={`pc-leaderboard ${place === 1 ? "pc-leaderboard-first" : ""}`}
        name={entry.full_name}
        title={`${PODIUM_TITLES[place]} · ${points.toLocaleString()} XP`}
        handle={entry.initials}
        status={`${points.toLocaleString()} XP`}
        avatarUrl={avatarUrl}
        miniAvatarUrl={avatarUrl}
        contactText={`Rank #${entry.rank}`}
        showUserInfo
        enableTilt
        enableMobileTilt={false}
        behindGlowEnabled
        behindGlowColor="rgba(34, 211, 238, 0.55)"
        innerGradient="linear-gradient(145deg, rgba(8, 40, 73, 0.85) 0%, rgba(96, 73, 110, 0.55) 100%)"
        onContactClick={() => undefined}
      />
    </div>
  );
}

function GameEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 px-6 py-14 text-center backdrop-blur-sm">
      <p className="font-display text-2xl font-bold text-white">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-violet-200/80">{body}</p>
    </div>
  );
}

export function ClassroomLeaderboardTab() {
  const { classroom } = useOutletContext<OutletCtx>();
  const { classroomId } = useParams();
  const id = Number(classroomId);
  const { user } = useAuth();
  const [filter, setFilter] = useState<LeaderboardFilter>("overall");
  const isStudent = user?.role === "STUDENT";

  const leaderboard = useQuery({
    queryKey: ["classroom-leaderboard", id],
    queryFn: () => classroomsApi.leaderboard(id),
    enabled: !Number.isNaN(id),
  });

  const entries = useMemo(() => {
    if (!leaderboard.data?.entries.length) return [];
    return sortedEntries(leaderboard.data.entries, filter);
  }, [leaderboard.data?.entries, filter]);

  const podium = useMemo(() => {
    const first = entries.find((entry) => entry.rank === 1);
    const second = entries.find((entry) => entry.rank === 2);
    const third = entries.find((entry) => entry.rank === 3);
    return { first, second, third };
  }, [entries]);

  const hasAnyPoints = entries.some((entry) => sortValue(entry, filter) > 0);

  if (leaderboard.isLoading) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-[#020817] via-[#0a2540] to-[#061a33] px-6 py-16 text-center text-violet-200">
        Loading arena…
      </div>
    );
  }

  if (leaderboard.isError) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-[#020817] via-[#0a2540] to-[#061a33] p-6">
        <ErrorText
          message={
            leaderboard.error instanceof Error ? leaderboard.error.message : "Could not load leaderboard"
          }
        />
      </div>
    );
  }

  const data = leaderboard.data as ClassroomLeaderboard;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#010b1a] via-[#082849] to-[#041428] shadow-[0_24px_80px_rgba(49,46,129,0.45)]">
      <div className="pointer-events-none absolute -left-20 top-0 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-purple-500/25 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-8 h-40 w-40 -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />

      <div className="relative space-y-8 px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-300/90">Battle Arena</p>
            <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Class Leaderboard
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-violet-200/85">
              Climb the ranks with practice quizzes, scenarios, assessments, mock exams, and coding tests.
              XP is earned from your best attempt on each activity — more practice, higher rank.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={filterPillClass(filter === "overall")}
              onClick={() => setFilter("overall")}
            >
              Overall
            </button>
            <button
              type="button"
              className={filterPillClass(filter === "practice")}
              onClick={() => setFilter("practice")}
            >
              Practice
            </button>
            <button
              type="button"
              className={filterPillClass(filter === "exams")}
              onClick={() => setFilter("exams")}
            >
              Mock Exams
            </button>
            <button
              type="button"
              className={filterPillClass(filter === "coding")}
              onClick={() => setFilter("coding")}
            >
              Coding
            </button>
          </div>
        </div>

        {!data.entries.length ? (
          <GameEmptyState
            title="No contenders yet"
            body="Approved students will enter the arena once they start earning XP from practice."
          />
        ) : !hasAnyPoints ? (
          <GameEmptyState
            title="Arena awaits its first champion"
            body="Complete quizzes, scenarios, assessments, mock exams, or coding tests to claim your spot on the board."
          />
        ) : (
          <>
            <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-8 backdrop-blur-md sm:px-10">
              <p className="mb-6 text-center text-xs font-bold uppercase tracking-[0.24em] text-violet-200/70">
                Top Champions
              </p>
              <div className="mx-auto flex max-w-5xl items-end justify-center gap-3 sm:gap-6">
                <PodiumProfileCard
                  entry={podium.second}
                  place={2}
                  points={podium.second ? sortValue(podium.second, filter) : 0}
                />
                <PodiumProfileCard
                  entry={podium.first}
                  place={1}
                  points={podium.first ? sortValue(podium.first, filter) : 0}
                />
                <PodiumProfileCard
                  entry={podium.third}
                  place={3}
                  points={podium.third ? sortValue(podium.third, filter) : 0}
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20 backdrop-blur-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5 text-xs uppercase tracking-[0.16em] text-violet-200/70">
                      <th className="px-4 py-3 font-bold">Rank</th>
                      <th className="px-4 py-3 font-bold">Player</th>
                      <th className="px-4 py-3 font-bold">Practice XP</th>
                      <th className="px-4 py-3 font-bold">Exam XP</th>
                      <th className="px-4 py-3 font-bold">Coding XP</th>
                      <th className="px-4 py-3 font-bold">Total XP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const isTopThree = entry.rank <= 3;
                      const highlightPractice = filter === "practice";
                      const highlightExams = filter === "exams";
                      const highlightCoding = filter === "coding";
                      const highlightTotal = filter === "overall";
                      return (
                        <tr
                          key={entry.student_id}
                          className={[
                            "border-b border-white/5 transition last:border-0",
                            isTopThree ? "bg-gradient-to-r from-white/10 to-transparent" : "hover:bg-white/5",
                          ].join(" ")}
                        >
                          <td className="px-4 py-4">
                            <span
                              className={[
                                "inline-flex min-w-[3rem] items-center justify-center rounded-full px-2 py-1 text-xs font-bold",
                                isTopThree
                                  ? "bg-gradient-to-r from-violet-500/40 to-blue-500/40 text-white"
                                  : "font-mono text-violet-300/80",
                              ].join(" ")}
                            >
                              {rankBadge(entry.rank)}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <Avatar initials={entry.initials} size="sm" glow={entry.rank === 1} />
                              <p className="font-semibold text-white">{entry.full_name}</p>
                            </div>
                          </td>
                          <td
                            className={`px-4 py-4 ${highlightPractice ? "font-bold text-cyan-300" : "text-violet-200/80"}`}
                          >
                            {entry.quiz_points.toLocaleString()}
                          </td>
                          <td
                            className={`px-4 py-4 ${highlightExams ? "font-bold text-cyan-300" : "text-violet-200/80"}`}
                          >
                            {entry.exam_points.toLocaleString()}
                          </td>
                          <td
                            className={`px-4 py-4 ${highlightCoding ? "font-bold text-cyan-300" : "text-violet-200/80"}`}
                          >
                            {entry.coding_points.toLocaleString()}
                          </td>
                          <td
                            className={`px-4 py-4 ${highlightTotal ? "font-bold text-white" : "text-violet-200/80"}`}
                          >
                            {entry.total_points.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {isStudent && data.viewer ? (
          <div className="rounded-2xl border border-cyan-300/30 bg-gradient-to-r from-cyan-500/15 via-violet-500/15 to-blue-500/15 px-5 py-4 backdrop-blur-sm">
            {data.viewer.rank != null ? (
              <p className="text-sm text-white">
                <span className="font-bold text-cyan-200">Your stats:</span> You have{" "}
                <span className="font-extrabold text-white">{data.viewer.total_points.toLocaleString()} XP</span>{" "}
                and are ranked{" "}
                <span className="font-extrabold text-white">#{data.viewer.rank}</span> out of{" "}
                <span className="font-extrabold text-white">{data.viewer.students_count}</span> players in{" "}
                {classroom.name}.
              </p>
            ) : (
              <p className="text-sm text-white">
                <span className="font-bold text-cyan-200">Your stats:</span> You have{" "}
                <span className="font-extrabold text-white">{data.viewer.total_points.toLocaleString()} XP</span> in{" "}
                {classroom.name}. Hit practice mode and claim your rank.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
