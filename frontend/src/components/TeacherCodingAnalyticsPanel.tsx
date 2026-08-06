import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  clearCodingToken,
  codingApi,
  ensureCodingSession,
  type StudentResultSummary,
  type TeacherCodingAnalytics,
} from "../api/codingClient";
import { EmptyState, Panel, PrimaryButton, SecondaryButton, inputClass } from "./ui";

const RESULTS_MODE_KEY = "astra_coding_results_view";

const VERDICT_STYLE: Record<string, { bar: string; chip: string; dot: string }> = {
  PASS: {
    bar: "bg-[#2f6b4f]",
    chip: "bg-[#e7f3ec] text-[#2f6b4f]",
    dot: "bg-[#2f6b4f]",
  },
  BORDERLINE: {
    bar: "bg-[#9a6b2f]",
    chip: "bg-[#f5efe4] text-[#9a6b2f]",
    dot: "bg-[#9a6b2f]",
  },
  FAIL: {
    bar: "bg-[#ba1a1a]",
    chip: "bg-[#ffdad6] text-[#ba1a1a]",
    dot: "bg-[#ba1a1a]",
  },
  ERROR: {
    bar: "bg-[#75777f]",
    chip: "bg-[#e8edf5] text-[#44474e]",
    dot: "bg-[#75777f]",
  },
};

function statusLabel(status: string | null | undefined) {
  if (!status) return "not started";
  return status.toLowerCase().replace(/_/g, " ");
}

function KpiTile({
  label,
  count,
  hint,
  onClick,
}: {
  label: string;
  count: number;
  hint?: string;
  onClick?: () => void;
}) {
  const className =
    "rounded-xl border border-[#e1e3e4] bg-white px-3 py-3 text-left transition hover:border-[#031635]/35 hover:shadow-xs";
  const inner = (
    <>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#75777f]">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-[#031635]">{count}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-[#75777f]">{hint}</p> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}

function CategoryBar({
  label,
  count,
  max,
  onClick,
}: {
  label: string;
  count: number;
  max: number;
  onClick?: () => void;
}) {
  const pct = max > 0 ? Math.max((count / max) * 100, count > 0 ? 6 : 0) : 0;
  const inner = (
    <>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-[#44474e]">{label}</span>
        <span className="text-xs font-bold text-[#031635]">{count}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-[#e8edf5]">
        <div
          className="h-full rounded-full bg-[#031635] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-lg px-1 py-1.5 text-left hover:bg-white/70 -mx-1"
      >
        {inner}
      </button>
    );
  }
  return <div className="py-1.5">{inner}</div>;
}

function VerdictMix({
  mix,
  onOpen,
}: {
  mix: { label: string; count: number }[];
  onOpen: () => void;
}) {
  const total = mix.reduce((sum, v) => sum + v.count, 0);
  if (total === 0) {
    return <p className="text-sm text-[#75777f]">No test verdicts yet.</p>;
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-4 w-full overflow-hidden rounded-full bg-[#e8edf5] ring-1 ring-[#e1e3e4] transition hover:ring-[#031635]/30"
        title="Open results"
      >
        {mix.map((v) => {
          if (v.count <= 0) return null;
          const style = VERDICT_STYLE[v.label] ?? VERDICT_STYLE.ERROR;
          const width = `${(v.count / total) * 100}%`;
          return (
            <span
              key={v.label}
              className={`h-full ${style.bar}`}
              style={{ width }}
              title={`${v.label}: ${v.count}`}
            />
          );
        })}
      </button>
      <ul className="grid grid-cols-2 gap-2">
        {mix.map((v) => {
          const style = VERDICT_STYLE[v.label] ?? VERDICT_STYLE.ERROR;
          const pct = total > 0 ? Math.round((v.count / total) * 100) : 0;
          return (
            <li key={v.label}>
              <button
                type="button"
                onClick={onOpen}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-[#e1e3e4] bg-white px-2.5 py-2 text-left hover:border-[#031635]/35"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                  <span className="truncate text-xs font-medium text-[#44474e]">{v.label}</span>
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${style.chip}`}>
                  {v.count}
                  <span className="ml-1 font-semibold opacity-70">{pct}%</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TeacherCodingAnalyticsPanel({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [studentFilter, setStudentFilter] = useState<number | "all">("all");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureCodingSession();
        if (!cancelled) setReady(true);
      } catch (e) {
        clearCodingToken();
        if (!cancelled) setBootError(e instanceof Error ? e.message : "Could not connect");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const students = useQuery({
    queryKey: ["coding-result-students"],
    queryFn: () => codingApi<StudentResultSummary[]>("/results/students"),
    enabled: enabled && ready,
    staleTime: 30_000,
  });

  const analytics = useQuery({
    queryKey: ["coding-teacher-analytics", studentFilter],
    queryFn: () =>
      codingApi<TeacherCodingAnalytics>(
        studentFilter === "all"
          ? "/results/analytics"
          : `/results/analytics?student_id=${studentFilter}`,
      ),
    enabled: enabled && ready,
    staleTime: 30_000,
  });

  const data = analytics.data;
  const focusedStudent = studentFilter !== "all";
  const scoreMax = useMemo(
    () => Math.max(1, ...(data?.score_distribution.map((b) => b.count) || [0])),
    [data],
  );

  function openResults(opts: {
    mode: "tests" | "students";
    testId?: number;
    studentId?: number;
  }) {
    try {
      localStorage.setItem(RESULTS_MODE_KEY, opts.mode);
    } catch {
      /* ignore */
    }
    navigate("/coding", {
      state: {
        tab: "results",
        resultsMode: opts.mode,
        selectedTestId: opts.testId ?? null,
        selectedStudentId: opts.studentId ?? (focusedStudent ? studentFilter : null),
      },
    });
  }

  if (!enabled) {
    return (
      <Panel>
        <h3 className="font-display font-bold text-[#031635] text-lg">Coding insights</h3>
        <p className="mt-2 text-sm text-[#44474e]">
          Coding analytics appear here when your HOD enables the coding platform for your account.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-bold text-[#031635] text-lg">Coding insights</h3>
          <p className="mt-1 text-xs text-[#75777f]">
            {focusedStudent && data?.student_name
              ? `Focused on ${data.student_name}`
              : "Across all your coding tests"}
            {data
              ? focusedStudent
                ? ` · ${data.participation.assigned} assigned test${data.participation.assigned === 1 ? "" : "s"}`
                : ` · ${data.test_count} test${data.test_count === 1 ? "" : "s"}`
              : ""}
          </p>
          <div className="mt-3 max-w-md">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#75777f]">
              View analytics for
            </label>
            <select
              className={inputClass}
              value={studentFilter === "all" ? "all" : String(studentFilter)}
              onChange={(e) => {
                const v = e.target.value;
                setStudentFilter(v === "all" ? "all" : Number(v));
              }}
              disabled={students.isLoading}
            >
              <option value="all">All students</option>
              {(students.data || []).map((s) => (
                <option key={s.student_id} value={s.student_id}>
                  {s.student_name} ({s.assignment_count} test{s.assignment_count === 1 ? "" : "s"})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <SecondaryButton
            onClick={() =>
              openResults({
                mode: focusedStudent ? "students" : "tests",
                studentId: focusedStudent ? Number(studentFilter) : undefined,
              })
            }
          >
            Open results
          </SecondaryButton>
          <PrimaryButton onClick={() => navigate("/coding")}>Coding workspace</PrimaryButton>
        </div>
      </div>

      {bootError || analytics.isError ? (
        <EmptyState
          title="Could not load coding analytics"
          body={
            bootError ||
            (analytics.error instanceof Error ? analytics.error.message : "Coding API unavailable")
          }
        />
      ) : analytics.isLoading || !ready ? (
        <p className="text-sm text-[#75777f]">Loading coding analytics…</p>
      ) : !data || (!focusedStudent && data.test_count === 0) ? (
        <EmptyState
          title="No coding tests yet"
          body="Create and assign a coding test to unlock participation, scores, verdicts, and proctor risk."
        />
      ) : data.participation.assigned === 0 ? (
        <EmptyState
          title={focusedStudent ? "No tests for this student" : "No students assigned"}
          body={
            focusedStudent
              ? "This student has not been assigned any of your coding tests yet."
              : "Assign a test to a classroom to start collecting analytics."
          }
        />
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#44474e]">
                {focusedStudent ? "Test progress" : "Participation"}
              </h4>
              <span className="text-[11px] text-[#75777f]">Tap a tile to open Results</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiTile
                label="Assigned"
                count={data.participation.assigned}
                onClick={() =>
                  openResults({
                    mode: "students",
                    studentId: focusedStudent ? Number(studentFilter) : undefined,
                  })
                }
              />
              <KpiTile
                label="Started"
                count={data.participation.started}
                onClick={() =>
                  openResults({
                    mode: focusedStudent ? "students" : "tests",
                    studentId: focusedStudent ? Number(studentFilter) : undefined,
                  })
                }
              />
              <KpiTile
                label="Submitted"
                count={data.participation.submitted}
                onClick={() =>
                  openResults({
                    mode: focusedStudent ? "students" : "tests",
                    studentId: focusedStudent ? Number(studentFilter) : undefined,
                  })
                }
              />
              <KpiTile
                label="Not started"
                count={data.participation.not_started}
                onClick={() =>
                  openResults({
                    mode: "students",
                    studentId: focusedStudent ? Number(studentFilter) : undefined,
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#44474e]">
                  Score distribution
                </h4>
                <span className="material-symbols-outlined text-[#3f5d9b] text-base">bar_chart</span>
              </div>
              {data.scored_attempt_count === 0 ? (
                <p className="text-sm text-[#75777f]">No graded attempts yet.</p>
              ) : (
                <div className="space-y-1">
                  {data.score_distribution.map((b) => (
                    <CategoryBar
                      key={b.label}
                      label={b.label}
                      count={b.count}
                      max={scoreMax}
                      onClick={() =>
                        openResults({
                          mode: focusedStudent ? "students" : "tests",
                          studentId: focusedStudent ? Number(studentFilter) : undefined,
                        })
                      }
                    />
                  ))}
                </div>
              )}
              <p className="mt-3 text-[11px] text-[#75777f]">
                Based on {data.scored_attempt_count} scored attempt
                {data.scored_attempt_count === 1 ? "" : "s"} (avg across questions).
              </p>
            </div>

            <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#44474e]">
                  Verdict mix
                </h4>
                <span className="material-symbols-outlined text-[#3f5d9b] text-base">rule</span>
              </div>
              <VerdictMix
                mix={data.verdict_mix}
                onOpen={() =>
                  openResults({
                    mode: focusedStudent ? "students" : "tests",
                    studentId: focusedStudent ? Number(studentFilter) : undefined,
                  })
                }
              />
            </div>

            <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-4 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#44474e]">
                  Proctor risk
                </h4>
                <span className="material-symbols-outlined text-[#ba1a1a] text-base">shield</span>
              </div>
              <p className="mb-3 text-[11px] text-[#75777f]">
                Flagged at ≥ {Math.max(data.violation_threshold / 2, 1)} violations (block at{" "}
                {data.violation_threshold}).
              </p>
              {!data.proctor_risk.length ? (
                <div className="rounded-lg border border-dashed border-[#e1e3e4] bg-white px-3 py-4 text-sm text-[#75777f]">
                  {focusedStudent
                    ? "No elevated risk for this student."
                    : "No elevated proctor risk right now."}
                </div>
              ) : (
                <ul className="space-y-2">
                  {data.proctor_risk.map((r) => {
                    const blocked = r.session_status === "BLOCKED";
                    return (
                      <li key={`${r.assignment_id}-${r.student_id}`}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 rounded-lg border border-[#e1e3e4] bg-white px-3 py-2.5 text-left transition hover:border-[#ba1a1a]/40"
                          onClick={() =>
                            openResults({
                              mode: "students",
                              studentId: r.student_id,
                              testId: r.test_id,
                            })
                          }
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ffdad6] text-[#ba1a1a]">
                            <span className="material-symbols-outlined text-[18px]">gpp_maybe</span>
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-[#031635]">
                              {focusedStudent ? r.test_title : r.student_name}
                            </p>
                            <p className="truncate text-[11px] text-[#44474e]">
                              {focusedStudent
                                ? statusLabel(r.session_status)
                                : `${r.test_title} · ${statusLabel(r.session_status)}`}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="rounded-full bg-[#ffdad6] px-2 py-0.5 text-[10px] font-bold text-[#ba1a1a]">
                              {r.violation_score} violations
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                blocked
                                  ? "bg-[#031635] text-white"
                                  : "bg-[#e8edf5] text-[#3f5d9b]"
                              }`}
                            >
                              {blocked ? "Blocked" : "Watch"}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {focusedStudent && (data.per_test?.length ?? 0) > 0 ? (
            <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#44474e]">
                  Per-test performance
                </h4>
                <span className="material-symbols-outlined text-[#3f5d9b] text-base">quiz</span>
              </div>
              <ul className="space-y-2">
                {data.per_test!.map((t) => (
                  <li key={t.assignment_id}>
                    <button
                      type="button"
                      className="w-full rounded-lg border border-[#e1e3e4] bg-white px-3 py-2.5 text-left hover:border-[#031635]"
                      onClick={() =>
                        openResults({
                          mode: "students",
                          studentId: Number(studentFilter),
                          testId: t.test_id,
                        })
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-[#031635]">{t.test_title}</p>
                          <p className="mt-0.5 text-[11px] text-[#44474e]">
                            {statusLabel(t.session_status)} · {t.eval_count} graded question
                            {t.eval_count === 1 ? "" : "s"} · violations {t.violation_score ?? 0}
                          </p>
                        </div>
                        <span className="shrink-0 rounded bg-[#e8edf5] px-2 py-0.5 text-xs font-bold text-[#031635]">
                          avg {t.average_score ?? "—"}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
