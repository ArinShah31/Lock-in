import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contentsApi, courseBuilderApi } from "../api";
import type { Classroom, CourseBuildJob, CourseChapter } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import {
  EmptyState,
  ErrorText,
  Field,
  GhostButton,
  inputClass,
  PrimaryButton,
} from "../components/ui";

type OutletCtx = { classroom: Classroom };

const ACTIVE_JOB_STATUSES = new Set(["PENDING", "RUNNING"]);

function isActiveJob(job: CourseBuildJob) {
  return ACTIVE_JOB_STATUSES.has(job.status);
}

function pickActiveJob(jobs: CourseBuildJob[]): CourseBuildJob | null {
  const active = jobs.filter(isActiveJob);
  if (!active.length) return null;
  const parent = active.find((j) => j.stage === "GENERATE_ALL" || j.stage === "GENERATE_ASSESSMENTS");
  return parent ?? active[0];
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "GENERATE_ALL":
      return "Generate all";
    case "GENERATE_ASSESSMENTS":
      return "Assessments";
    case "STRUCTURE":
      return "Structure";
    case "CHAPTER_CONTENT":
      return "Chapter content";
    case "VIDEO":
      return "Video";
    case "CHAPTER_QUIZ":
      return "Chapter quiz";
    default:
      return stage;
  }
}

/** Rough pipeline steps for the progress panel. */
function pipelineSteps(job: CourseBuildJob): { label: string; state: "done" | "active" | "pending" }[] {
  const msg = (job.progress_message || "").toLowerCase();
  const stage = job.stage;
  const finished = job.status === "COMPLETED";
  const failed = job.status === "FAILED";

  if (stage === "GENERATE_ASSESSMENTS") {
    return [
      {
        label: "Assessments",
        state: finished ? "done" : failed ? "pending" : "active",
      },
    ];
  }

  if (stage !== "GENERATE_ALL") {
    return [
      {
        label: stageLabel(stage),
        state: finished ? "done" : failed ? "pending" : "active",
      },
    ];
  }

  let currentIdx = 0;
  if (msg.includes("video")) currentIdx = 2;
  else if (msg.includes("content") || msg.includes("notes") || msg.includes("lesson")) currentIdx = 1;
  else if (msg.includes("structure") || msg.includes("starting")) currentIdx = 0;
  if (finished) currentIdx = 3;

  const labels = ["Structure", "Chapter notes", "Videos"];
  return labels.map((label, i) => ({
    label,
    state: finished || i < currentIdx ? "done" : i === currentIdx ? "active" : "pending",
  }));
}

function estimateProgress(job: CourseBuildJob): number | null {
  if (job.status === "COMPLETED") return 100;
  if (job.status === "FAILED" || job.status === "PENDING") return job.status === "PENDING" ? 0 : null;
  const msg = job.progress_message || "";
  const m = msg.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) {
    const cur = Number(m[1]);
    const total = Number(m[2]);
    if (total > 0) {
      const base = job.stage === "GENERATE_ALL" && msg.toLowerCase().includes("structure") ? 5 : 10;
      return Math.min(95, Math.round(base + (cur / total) * 80));
    }
  }
  if (job.stage === "GENERATE_ASSESSMENTS") return 40;
  if (job.stage === "GENERATE_ALL") {
    const lower = msg.toLowerCase();
    if (lower.includes("structure")) return 8;
    if (lower.includes("video")) return 75;
    if (lower.includes("content") || lower.includes("notes")) return 40;
    return 5;
  }
  return 35;
}

async function pollJob(classroomId: number, job: CourseBuildJob): Promise<CourseBuildJob> {
  let current = job;
  for (let i = 0; i < 180; i++) {
    if (current.status === "COMPLETED" || current.status === "FAILED") return current;
    await new Promise((r) => setTimeout(r, 2000));
    current = await courseBuilderApi.getJob(classroomId, job.id);
  }
  throw new Error("Generation timed out");
}

function YouTubeEmbed({ videoId, title }: { videoId: string; title?: string | null }) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl border border-line bg-black">
      <iframe
        title={title || "YouTube video"}
        src={`https://www.youtube.com/embed/${videoId}`}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

function GenerationProgressPanel({
  job,
  recent,
}: {
  job: CourseBuildJob | null;
  recent: CourseBuildJob[];
}) {
  if (!job && !recent.length) return null;
  const display = job ?? recent[0];
  const active = isActiveJob(display);
  const pct = estimateProgress(display);
  const steps = pipelineSteps(display);

  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        active
          ? "border-accent/40 bg-accent/10"
          : display.status === "FAILED"
            ? "border-red-500/40 bg-red-500/10"
            : "border-line bg-ink-soft/30"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-paper">
          {active ? "Generation in progress" : display.status === "FAILED" ? "Generation failed" : "Last generation"}
        </h3>
        <span className="text-xs text-mist">
          {stageLabel(display.stage)} · {display.status}
          {display.id ? ` · #${display.id}` : ""}
        </span>
      </div>

      {pct != null ? (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-soft">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              display.status === "FAILED" ? "bg-red-400" : "bg-accent"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}

      <p className="mt-2 text-sm text-paper">
        {display.progress_message || (active ? "Starting…" : "—")}
      </p>
      {display.error_message ? (
        <p className="mt-1 text-sm text-red-300">{display.error_message}</p>
      ) : null}

      {steps.length > 1 ? (
        <ol className="mt-3 flex flex-wrap gap-2">
          {steps.map((s) => (
            <li
              key={s.label}
              className={`rounded-lg border px-2 py-1 text-xs ${
                s.state === "done"
                  ? "border-accent/40 text-accent"
                  : s.state === "active"
                    ? "border-paper/40 bg-paper/10 text-paper"
                    : "border-line text-mist"
              }`}
            >
              {s.state === "done" ? "✓ " : s.state === "active" ? "→ " : ""}
              {s.label}
            </li>
          ))}
        </ol>
      ) : null}

      {active ? (
        <p className="mt-2 text-xs text-mist">
          Generate all and regenerate actions are disabled until this job finishes.
        </p>
      ) : null}
    </div>
  );
}

export function ClassroomCourseBuilderTab() {
  const { classroom } = useOutletContext<OutletCtx>();
  const { classroomId } = useParams();
  const id = Number(classroomId);
  const { user } = useAuth();
  const qc = useQueryClient();
  const isTeacher = !!user && user.id === classroom.class_teacher_id;
  const [error, setError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<number[]>([]);
  const [videoUrlDrafts, setVideoUrlDrafts] = useState<Record<string, string>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [quizScore, setQuizScore] = useState<number | null>(null);

  const jobs = useQuery({
    queryKey: ["classroom-course-jobs", id],
    queryFn: () => courseBuilderApi.listJobs(id),
    enabled: isTeacher && !Number.isNaN(id),
    refetchInterval: (q) => {
      const list = q.state.data ?? [];
      return list.some(isActiveJob) ? 2000 : false;
    },
  });

  const activeJob = useMemo(() => pickActiveJob(jobs.data ?? []), [jobs.data]);
  const isGenerating = !!activeJob || localBusy;

  const course = useQuery({
    queryKey: ["classroom-course", id],
    queryFn: () => courseBuilderApi.get(id),
    enabled: !Number.isNaN(id),
    refetchInterval: () => (isGenerating ? 4000 : false),
  });

  const documents = useQuery({
    queryKey: ["documents", id],
    queryFn: () => contentsApi.listByClassroom(id),
    enabled: isTeacher && !Number.isNaN(id),
  });

  // After a job finishes (including jobs already running when the page loaded), refresh course.
  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    if (activeJob) {
      wasGeneratingRef.current = true;
      return;
    }
    if (wasGeneratingRef.current) {
      wasGeneratingRef.current = false;
      void qc.invalidateQueries({ queryKey: ["classroom-course", id] });
    }
  }, [activeJob, id, qc]);

  useEffect(() => {
    if (course.data?.source_content_ids) setSelectedDocs(course.data.source_content_ids);
  }, [course.data?.source_content_ids]);

  useEffect(() => {
    if (!course.data?.chapters.length) {
      setSelectedChapter(null);
      return;
    }
    setSelectedChapter((prev) => {
      if (prev != null && course.data!.chapters.some((c) => c.chapter === prev)) return prev;
      const unlocked = course.data!.chapters.find((c) => !c.is_locked_for_viewer);
      return unlocked?.chapter ?? course.data!.chapters[0].chapter;
    });
  }, [course.data]);

  const active: CourseChapter | null = useMemo(() => {
    if (!course.data || selectedChapter == null) return null;
    return course.data.chapters.find((c) => c.chapter === selectedChapter) ?? null;
  }, [course.data, selectedChapter]);

  async function runJob(start: () => Promise<CourseBuildJob>) {
    if (isGenerating) {
      setError("A generation job is already running. Wait for it to finish.");
      return;
    }
    setError(null);
    setLocalBusy(true);
    try {
      const job = await start();
      await qc.invalidateQueries({ queryKey: ["classroom-course-jobs", id] });
      const done = await pollJob(id, job);
      await qc.invalidateQueries({ queryKey: ["classroom-course-jobs", id] });
      await qc.invalidateQueries({ queryKey: ["classroom-course", id] });
      if (done.status === "FAILED") throw new Error(done.error_message || "Generation failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      await qc.invalidateQueries({ queryKey: ["classroom-course-jobs", id] });
    } finally {
      setLocalBusy(false);
    }
  }

  const uploadSyllabus = useMutation({
    mutationFn: (file: File) => courseBuilderApi.uploadSyllabus(id, file),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["classroom-course", id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const saveSources = useMutation({
    mutationFn: () =>
      courseBuilderApi.setSources(id, {
        source_content_ids: selectedDocs,
        use_all_documents: false,
      }),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["classroom-course", id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (course.isLoading) return <p className="text-sm text-mist">Loading course builder…</p>;
  if (course.isError) return <ErrorText message="Failed to load course builder." />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-paper">Course builder</h2>
        <p className="text-sm text-mist">
          {isTeacher
            ? "Upload a syllabus, include classroom documents, then Generate all for structure, notes, and videos. Generate assessments afterward for quizzes and flashcards."
            : "Follow the published learning path for this classroom."}
        </p>
      </div>

      <ErrorText message={error} />

      {isTeacher ? (
        <GenerationProgressPanel job={activeJob} recent={jobs.data ?? []} />
      ) : null}

      {isTeacher ? (
        <div className="space-y-4 rounded-2xl border border-line p-4">
          <h3 className="font-semibold text-paper">Sources</h3>
          <Field label="Syllabus upload">
            <input
              className={inputClass}
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadSyllabus.mutate(file);
              }}
            />
          </Field>
          {course.data?.syllabus_file_name ? (
            <p className="text-xs text-mist">Current syllabus: {course.data.syllabus_file_name}</p>
          ) : null}

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Classroom documents</p>
              <GhostButton
                onClick={() => setSelectedDocs((documents.data ?? []).map((d) => d.id))}
              >
                Select all
              </GhostButton>
              <GhostButton onClick={() => setSelectedDocs([])}>Clear</GhostButton>
            </div>
            {!documents.data?.length ? (
              <p className="text-sm text-mist">No documents yet — upload some in the Documents tab.</p>
            ) : (
              <ul className="max-h-40 space-y-2 overflow-y-auto">
                {documents.data.map((doc) => (
                  <li key={doc.id}>
                    <label className="flex items-center gap-2 text-sm text-paper">
                      <input
                        type="checkbox"
                        checked={selectedDocs.includes(doc.id)}
                        onChange={(e) => {
                          setSelectedDocs((prev) =>
                            e.target.checked ? [...prev, doc.id] : prev.filter((x) => x !== doc.id),
                          );
                        }}
                      />
                      {doc.title}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <PrimaryButton onClick={() => saveSources.mutate()} disabled={saveSources.isPending}>
                Save document selection
              </PrimaryButton>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <PrimaryButton
              disabled={isGenerating}
              onClick={() => void runJob(() => courseBuilderApi.generateAll(id))}
            >
              {isGenerating ? "Generating…" : "Generate all"}
            </PrimaryButton>
            <GhostButton
              disabled={
                isGenerating ||
                !(course.data?.chapters.some(
                  (ch) => (ch.lessons?.length || ch.subtopics?.length || 0) > 0,
                ) ?? false)
              }
              onClick={() => void runJob(() => courseBuilderApi.generateAssessments(id))}
            >
              Generate assessments
            </GhostButton>
            <GhostButton
              disabled={isGenerating}
              onClick={() => void runJob(() => courseBuilderApi.generateStructure(id))}
            >
              Regenerate structure
            </GhostButton>
            <GhostButton
              onClick={() =>
                void (async () => {
                  setError(null);
                  try {
                    await courseBuilderApi.publish(id, !course.data?.is_published);
                    await qc.invalidateQueries({ queryKey: ["classroom-course", id] });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Publish failed");
                  }
                })()
              }
            >
              {course.data?.is_published ? "Unpublish" : "Publish for students"}
            </GhostButton>
          </div>
          <p className="text-xs text-mist">
            Published: {course.data?.is_published ? "Yes" : "No"} · Sources:{" "}
            {course.data?.syllabus_file_name ? "syllabus" : "no syllabus"}
            {course.data?.source_content_ids?.length
              ? ` + ${course.data.source_content_ids.length} docs`
              : ""}
          </p>
        </div>
      ) : null}

      {!course.data?.chapters.length ? (
        <EmptyState
          title={isTeacher ? "No course yet" : "Course not ready"}
          body={
            isTeacher
              ? "Add sources, then click Generate all to build structure, full study notes, and videos. Use Generate assessments afterward for quizzes and flashcards."
              : "Your teacher has not published a course for this classroom yet."
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-mist">Chapters</h3>
            {course.data.chapters.map((ch) => (
              <button
                key={ch.chapter}
                type="button"
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                  selectedChapter === ch.chapter
                    ? "border-accent/50 bg-accent/10 text-paper"
                    : "border-line text-mist hover:text-paper"
                }`}
                onClick={() => {
                  setQuizAnswers({});
                  setQuizScore(null);
                  setSelectedChapter(ch.chapter);
                }}
              >
                <span className="font-medium">{ch.chapter}. {ch.title}</span>
                {ch.is_locked_for_viewer ? (
                  <span className="mt-1 block text-xs">Locked</span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="space-y-5">
            {!active ? (
              <EmptyState title="Select a chapter" body="Choose a chapter from the list." />
            ) : active.is_locked_for_viewer ? (
              <EmptyState title="Chapter locked" body="Your teacher has not unlocked this chapter yet." />
            ) : (
              <>
                <div>
                  <h3 className="font-display text-2xl text-paper">{active.title}</h3>
                  <p className="mt-2 text-sm text-mist">{active.summary}</p>
                  {active.objectives?.length ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mist">
                      {active.objectives.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                {isTeacher ? (
                  <div className="flex flex-wrap gap-2">
                    <GhostButton
                      disabled={isGenerating}
                      onClick={() =>
                        void runJob(() => courseBuilderApi.generateChapterContent(id, active.chapter))
                      }
                    >
                      Regenerate content
                    </GhostButton>
                    <GhostButton
                      disabled={isGenerating}
                      onClick={() =>
                        void runJob(() => courseBuilderApi.generateChapterQuiz(id, active.chapter))
                      }
                    >
                      Regenerate assessments
                    </GhostButton>
                    <GhostButton
                      onClick={() =>
                        void (async () => {
                          try {
                            await courseBuilderApi.setChapterLock(id, active.chapter, !active.is_unlocked);
                            await qc.invalidateQueries({ queryKey: ["classroom-course", id] });
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Lock update failed");
                          }
                        })()
                      }
                    >
                      {active.is_unlocked ? "Lock chapter" : "Unlock for students"}
                    </GhostButton>
                  </div>
                ) : null}

                <div className="space-y-4">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-mist">Lessons</h4>
                  {!(active.lessons?.length || active.subtopics?.length) ? (
                    <p className="text-sm text-mist">No lessons yet — generate content for this chapter.</p>
                  ) : (
                    (active.lessons?.length ? active.lessons : active.subtopics || []).map((lesson, idx) => {
                      const draftKey = `${active.chapter}-${idx}`;
                      return (
                        <div key={draftKey} className="space-y-3 rounded-2xl border border-line p-4">
                          <div>
                            <h5 className="font-semibold text-paper">
                              Lesson {lesson.lesson || idx + 1}: {lesson.title}
                            </h5>
                            {lesson.summary ? <p className="mt-1 text-sm text-mist">{lesson.summary}</p> : null}
                            {!lesson.needs_video ? (
                              <p className="mt-1 text-xs text-mist">No auto video (intro/overview)</p>
                            ) : null}
                          </div>

                          {lesson.learning_outcomes?.length ? (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
                                Learning outcomes
                              </p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist">
                                {lesson.learning_outcomes.map((o) => (
                                  <li key={o}>{o}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {lesson.notes_markdown ? (
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-mist">
                                Study notes
                              </p>
                              <pre className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-ink-soft/40 p-3 font-sans text-sm leading-relaxed text-paper">
                                {lesson.notes_markdown}
                              </pre>
                            </div>
                          ) : null}

                          {lesson.key_terms?.length ? (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Key terms</p>
                              <p className="mt-1 text-sm text-mist">{lesson.key_terms.join(" · ")}</p>
                            </div>
                          ) : null}

                          {lesson.examples?.length ? (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Examples</p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist">
                                {lesson.examples.map((ex) => (
                                  <li key={ex}>{ex}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {lesson.practice_prompts?.length ? (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
                                Practice prompts
                              </p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist">
                                {lesson.practice_prompts.map((p) => (
                                  <li key={p}>{p}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {lesson.youtube_video_id ? (
                            <YouTubeEmbed videoId={lesson.youtube_video_id} title={lesson.youtube_title} />
                          ) : lesson.needs_video ? (
                            <p className="text-sm text-mist">No video yet.</p>
                          ) : null}
                          {lesson.youtube_title ? (
                            <p className="text-xs text-mist">{lesson.youtube_title}</p>
                          ) : null}

                          {isTeacher ? (
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                              <div className="flex-1">
                                <Field label="YouTube URL (optional override)">
                                  <input
                                    className={inputClass}
                                    placeholder="https://www.youtube.com/watch?v=..."
                                    value={videoUrlDrafts[draftKey] ?? lesson.youtube_url ?? ""}
                                    onChange={(e) =>
                                      setVideoUrlDrafts((d) => ({ ...d, [draftKey]: e.target.value }))
                                    }
                                  />
                                </Field>
                              </div>
                              <PrimaryButton
                                onClick={() =>
                                  void (async () => {
                                    try {
                                      const url = (
                                        videoUrlDrafts[draftKey] ??
                                        lesson.youtube_url ??
                                        ""
                                      ).trim();
                                      await courseBuilderApi.setSubtopicVideo(
                                        id,
                                        active.chapter,
                                        idx,
                                        url || null,
                                      );
                                      await qc.invalidateQueries({ queryKey: ["classroom-course", id] });
                                    } catch (err) {
                                      setError(err instanceof Error ? err.message : "Video update failed");
                                    }
                                  })()
                                }
                              >
                                Save video
                              </PrimaryButton>
                              {lesson.needs_video ? (
                                <GhostButton
                                  disabled={isGenerating}
                                  onClick={() =>
                                    void runJob(() =>
                                      courseBuilderApi.generateSubtopicVideo(id, active.chapter, idx),
                                    )
                                  }
                                >
                                  Auto-find
                                </GhostButton>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>

                {active.flashcards.length ? (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-mist">Flashcards</h4>
                    <ul className="space-y-2">
                      {active.flashcards.map((fc, i) => (
                        <li key={`${fc.question}-${i}`} className="rounded-xl border border-line px-3 py-2 text-sm">
                          <p className="font-medium text-paper">{fc.question}</p>
                          <p className="text-mist">{fc.answer}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : isTeacher ? (
                  <p className="text-sm text-mist">
                    No flashcards yet — use Generate assessments after notes are ready.
                  </p>
                ) : null}

                {active.quiz.length ? (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-mist">Quiz</h4>
                    {active.quiz.map((q, qi) => (
                      <div key={`${q.question}-${qi}`} className="rounded-xl border border-line p-3">
                        <p className="text-sm font-medium text-paper">
                          {qi + 1}. {q.question}
                        </p>
                        <div className="mt-2 space-y-1">
                          {q.options.map((opt) => (
                            <label key={opt} className="flex items-center gap-2 text-sm text-mist">
                              <input
                                type="radio"
                                name={`q-${active.chapter}-${qi}`}
                                checked={quizAnswers[qi] === opt}
                                onChange={() => setQuizAnswers((a) => ({ ...a, [qi]: opt }))}
                                disabled={isTeacher}
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    {!isTeacher ? (
                      <PrimaryButton
                        onClick={() =>
                          void (async () => {
                            try {
                              const answers = active.quiz.map((_, i) => quizAnswers[i] ?? "");
                              const result = await courseBuilderApi.submitQuiz(id, active.chapter, answers);
                              setQuizScore(result.score);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Quiz submit failed");
                            }
                          })()
                        }
                      >
                        Submit quiz
                      </PrimaryButton>
                    ) : null}
                    {quizScore != null ? (
                      <p className="text-sm text-accent">Score: {quizScore.toFixed(0)}%</p>
                    ) : null}
                  </div>
                ) : isTeacher ? (
                  <p className="text-sm text-mist">
                    No quiz yet — use Generate assessments (or Regenerate assessments on this chapter).
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
