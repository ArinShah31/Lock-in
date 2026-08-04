import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contentsApi, courseBuilderApi } from "../api";
import type {
  Classroom,
  Content,
  CourseBuildJob,
  CourseChapter,
  CourseLesson,
  ClassroomCourse,
} from "../api/types";
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

function pipelineSteps(job: CourseBuildJob): { label: string; state: "done" | "active" | "pending" }[] {
  const msg = (job.progress_message || "").toLowerCase();
  const stage = job.stage;
  const finished = job.status === "COMPLETED";
  const failed = job.status === "FAILED";

  if (stage === "GENERATE_ASSESSMENTS") {
    return [{ label: "Assessments", state: finished ? "done" : failed ? "pending" : "active" }];
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

function chapterLessons(ch: CourseChapter): CourseLesson[] {
  return ch.lessons?.length ? ch.lessons : ch.subtopics || [];
}

function lessonHasNotes(lesson: CourseLesson): boolean {
  if (lesson.sections?.some((s) => !!s.content_markdown?.trim())) return true;
  return !!lesson.notes_markdown?.trim();
}

type ChapterReadiness = "Empty" | "Partial" | "Notes ready";

function chapterReadiness(ch: CourseChapter): ChapterReadiness {
  const lessons = chapterLessons(ch);
  if (!lessons.length) return "Empty";
  const withNotes = lessons.filter(lessonHasNotes).length;
  if (withNotes === 0) return "Empty";
  if (withNotes < lessons.length) return "Partial";
  return "Notes ready";
}

function teacherStatusLabel(opts: {
  hasSources: boolean;
  hasChapters: boolean;
  isGenerating: boolean;
  isPublished: boolean;
}): string {
  if (opts.isGenerating) return "Generating…";
  if (!opts.hasSources) return "Add a syllabus or documents";
  if (!opts.hasChapters) return "Ready to generate";
  if (opts.isPublished) return "Live for students";
  return "Review & publish";
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
  id,
}: {
  job: CourseBuildJob | null;
  recent: CourseBuildJob[];
  id?: string;
}) {
  if (!job && !recent.length) return null;
  const display = job ?? recent[0];
  const active = isActiveJob(display);
  const pct = estimateProgress(display);
  const steps = pipelineSteps(display);

  return (
    <div
      id={id}
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

      <p className="mt-2 text-sm text-paper">{display.progress_message || (active ? "Starting…" : "—")}</p>
      {display.error_message ? <p className="mt-1 text-sm text-red-300">{display.error_message}</p> : null}

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

function SetupPanel({
  open,
  onToggle,
  syllabusName,
  selectedDocs,
  documents,
  uploadPending,
  savePending,
  onUpload,
  onSelectAll,
  onClear,
  onToggleDoc,
  onSave,
}: {
  open: boolean;
  onToggle: () => void;
  syllabusName: string | null | undefined;
  selectedDocs: number[];
  documents: Content[] | undefined;
  uploadPending: boolean;
  savePending: boolean;
  onUpload: (file: File) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleDoc: (docId: number, checked: boolean) => void;
  onSave: () => void;
}) {
  const summaryParts: string[] = [];
  if (syllabusName) summaryParts.push(syllabusName);
  if (selectedDocs.length) summaryParts.push(`${selectedDocs.length} document${selectedDocs.length === 1 ? "" : "s"}`);
  const summary = summaryParts.length ? summaryParts.join(" · ") : "No sources yet";

  return (
    <div className="rounded-2xl border border-line">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={onToggle}
      >
        <div>
          <h3 className="font-semibold text-paper">1. Sources</h3>
          <p className="text-xs text-mist">{summary}</p>
        </div>
        <span className="text-sm text-mist">{open ? "Hide" : "Edit"}</span>
      </button>
      {open ? (
        <div className="space-y-4 border-t border-line px-4 py-4">
          <Field label="Syllabus upload">
            <input
              className={inputClass}
              type="file"
              disabled={uploadPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
              }}
            />
          </Field>
          {syllabusName ? <p className="text-xs text-mist">Current syllabus: {syllabusName}</p> : null}

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Classroom documents</p>
              <GhostButton onClick={onSelectAll}>Select all</GhostButton>
              <GhostButton onClick={onClear}>Clear</GhostButton>
            </div>
            {!documents?.length ? (
              <p className="text-sm text-mist">No documents yet — upload some in the Documents tab.</p>
            ) : (
              <ul className="max-h-40 space-y-2 overflow-y-auto">
                {documents.map((doc) => (
                  <li key={doc.id}>
                    <label className="flex items-center gap-2 text-sm text-paper">
                      <input
                        type="checkbox"
                        checked={selectedDocs.includes(doc.id)}
                        onChange={(e) => onToggleDoc(doc.id, e.target.checked)}
                      />
                      {doc.title}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <PrimaryButton onClick={onSave} disabled={savePending}>
                {savePending ? "Saving…" : "Save document selection"}
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BuildPanel({
  hasSources,
  isGenerating,
  isPublished,
  activeJob,
  recentJobs,
  onGenerateAll,
  onRegenerateStructure,
  onTogglePublish,
}: {
  hasSources: boolean;
  isGenerating: boolean;
  isPublished: boolean;
  activeJob: CourseBuildJob | null;
  recentJobs: CourseBuildJob[];
  onGenerateAll: () => void;
  onRegenerateStructure: () => void;
  onTogglePublish: () => void;
}) {
  const generateDisabled = isGenerating || !hasSources;
  return (
    <div className="sticky top-3 z-10 space-y-3 rounded-2xl border border-line bg-ink/95 p-4 backdrop-blur">
      <div>
        <h3 className="font-semibold text-paper">2. Build</h3>
        <p className="text-xs text-mist">Generate structure, study notes, and videos from your sources.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <PrimaryButton disabled={generateDisabled} onClick={onGenerateAll}>
          {isGenerating ? "Generating…" : "Generate all"}
        </PrimaryButton>
        <GhostButton disabled={isGenerating || !hasSources} onClick={onRegenerateStructure}>
          Regenerate structure
        </GhostButton>
        <GhostButton onClick={onTogglePublish}>
          {isPublished ? "Unpublish" : "Publish for students"}
        </GhostButton>
      </div>
      {!hasSources ? (
        <p className="text-xs text-mist">Add a syllabus or select documents before generating.</p>
      ) : null}
      <GenerationProgressPanel id="course-builder-progress" job={activeJob} recent={recentJobs} />
    </div>
  );
}

function readinessBadgeClass(r: ChapterReadiness): string {
  if (r === "Notes ready") return "border-accent/40 text-accent";
  if (r === "Partial") return "border-paper/30 text-paper";
  return "border-line text-mist";
}

function LessonBody({
  lesson,
  idx,
  chapterNumber,
  classroomId,
  isTeacher,
  isGenerating,
  expandedSections,
  onToggleSection,
  videoUrlDrafts,
  setVideoUrlDrafts,
  onRunJob,
  setError,
  qc,
}: {
  lesson: CourseLesson;
  idx: number;
  chapterNumber: number;
  classroomId: number;
  isTeacher: boolean;
  isGenerating: boolean;
  expandedSections: Set<string>;
  onToggleSection: (key: string) => void;
  videoUrlDrafts: Record<string, string>;
  setVideoUrlDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  onRunJob: (start: () => Promise<CourseBuildJob>) => Promise<void>;
  setError: (msg: string | null) => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const draftKey = `${chapterNumber}-${idx}`;
  const objectives = lesson.learning_objectives?.length
    ? lesson.learning_objectives
    : lesson.learning_outcomes || [];

  return (
    <div className="space-y-4 border-t border-line px-4 py-4">
      {lesson.overview ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Overview</p>
          <p className="mt-1 text-sm text-mist">{lesson.overview}</p>
        </div>
      ) : null}

      {objectives.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Learning objectives</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist">
            {objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.prerequisites?.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Prerequisites</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist">
            {lesson.prerequisites.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.sections?.length ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Sections</p>
          {lesson.sections.map((section, sIdx) => {
            const sKey = `${draftKey}-s${sIdx}`;
            const open = expandedSections.has(sKey);
            return (
              <div key={sKey} className="rounded-xl border border-line">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  onClick={() => onToggleSection(sKey)}
                >
                  <span className="font-medium text-paper">{section.title}</span>
                  <span className="text-xs text-mist">{open ? "Hide" : "Show"}</span>
                </button>
                {open ? (
                  <div className="space-y-2 border-t border-line px-3 py-3">
                    {section.content_markdown ? (
                      <pre className="max-h-[22rem] overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-mist">
                        {section.content_markdown}
                      </pre>
                    ) : null}
                    {section.key_points?.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-mist">
                        {section.key_points.map((kp) => (
                          <li key={kp}>{kp}</li>
                        ))}
                      </ul>
                    ) : null}
                    {section.sources?.length ? (
                      <ul className="space-y-1 text-sm">
                        {section.sources.map((src, srcIdx) => (
                          <li key={`${src.title}-${srcIdx}`} className="text-mist">
                            {src.url ? (
                              <a
                                href={src.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent underline-offset-2 hover:underline"
                              >
                                {src.title || src.url}
                              </a>
                            ) : (
                              <span>{src.title}</span>
                            )}
                            {src.source_type ? (
                              <span className="text-xs text-mist"> · {src.source_type}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : lesson.notes_markdown ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-mist">Study notes</p>
          <pre className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-ink-soft/40 p-3 font-sans text-sm leading-relaxed text-paper">
            {lesson.notes_markdown}
          </pre>
        </div>
      ) : null}

      {lesson.examples?.length ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Examples</p>
          {lesson.examples.map((ex, exIdx) => (
            <div key={`${ex.title}-${exIdx}`} className="rounded-xl border border-line p-3">
              <p className="font-medium text-paper">{ex.title || "Example"}</p>
              {ex.context ? <p className="mt-1 text-sm text-mist">{ex.context}</p> : null}
              {ex.content_markdown ? (
                <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-mist">{ex.content_markdown}</pre>
              ) : null}
              {ex.takeaway ? <p className="mt-2 text-sm text-accent">Takeaway: {ex.takeaway}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {lesson.real_world_applications?.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Real-world applications</p>
          <ul className="mt-1 space-y-2">
            {lesson.real_world_applications.map((app, appIdx) => (
              <li key={`${app.title}-${appIdx}`} className="text-sm text-mist">
                <span className="font-medium text-paper">{app.title}</span>
                {app.description ? ` — ${app.description}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.common_misconceptions?.length ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Common misconceptions</p>
          {lesson.common_misconceptions.map((m, mIdx) => (
            <div key={`${m.misconception}-${mIdx}`} className="text-sm text-mist">
              <p>
                <span className="font-medium text-paper">Myth:</span> {m.misconception}
              </p>
              <p>
                <span className="font-medium text-paper">Correction:</span> {m.correction}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {lesson.key_terms?.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Key terms</p>
          <ul className="mt-1 space-y-1 text-sm text-mist">
            {lesson.key_terms.map((kt, ktIdx) => (
              <li key={`${kt.term}-${ktIdx}`}>
                <span className="font-medium text-paper">{kt.term}</span>
                {kt.definition ? ` — ${kt.definition}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.summary ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Summary</p>
          <p className="mt-1 text-sm text-mist">{lesson.summary}</p>
        </div>
      ) : null}

      {lesson.references?.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">References</p>
          <ul className="mt-1 space-y-1 text-sm">
            {lesson.references.map((ref, refIdx) => (
              <li key={`${ref.title}-${refIdx}`} className="text-mist">
                {ref.url ? (
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    {ref.title || ref.url}
                  </a>
                ) : (
                  <span>{ref.title}</span>
                )}
                {ref.source_type ? <span className="text-xs"> · {ref.source_type}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.youtube_video_id ? (
        <YouTubeEmbed videoId={lesson.youtube_video_id} title={lesson.youtube_title} />
      ) : lesson.needs_video ? (
        <p className="text-sm text-mist">No video yet.</p>
      ) : null}
      {lesson.youtube_title ? <p className="text-xs text-mist">{lesson.youtube_title}</p> : null}

      {isTeacher ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="YouTube URL (optional override)">
              <input
                className={inputClass}
                placeholder="https://www.youtube.com/watch?v=..."
                value={videoUrlDrafts[draftKey] ?? lesson.youtube_url ?? ""}
                onChange={(e) => setVideoUrlDrafts((d) => ({ ...d, [draftKey]: e.target.value }))}
              />
            </Field>
          </div>
          <PrimaryButton
            onClick={() =>
              void (async () => {
                try {
                  const url = (videoUrlDrafts[draftKey] ?? lesson.youtube_url ?? "").trim();
                  await courseBuilderApi.setSubtopicVideo(classroomId, chapterNumber, idx, url || null);
                  await qc.invalidateQueries({ queryKey: ["classroom-course", classroomId] });
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
                void onRunJob(() =>
                  courseBuilderApi.generateSubtopicVideo(classroomId, chapterNumber, idx),
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
  const [setupOpen, setSetupOpen] = useState(true);
  const [setupTouched, setSetupTouched] = useState(false);
  const [expandedLessons, setExpandedLessons] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

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

  const hasSources = !!(
    course.data?.syllabus_file_name ||
    (course.data?.source_content_ids?.length ?? 0) > 0 ||
    selectedDocs.length > 0
  );

  useEffect(() => {
    if (setupTouched) return;
    setSetupOpen(!hasSources);
  }, [hasSources, setupTouched]);

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

  useEffect(() => {
    setExpandedLessons(new Set());
    setExpandedSections(new Set());
    setQuizAnswers({});
    setQuizScore(null);
  }, [selectedChapter]);

  const active: CourseChapter | null = useMemo(() => {
    if (!course.data || selectedChapter == null) return null;
    return course.data.chapters.find((c) => c.chapter === selectedChapter) ?? null;
  }, [course.data, selectedChapter]);

  const activeLessons = active ? chapterLessons(active) : [];

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

  function toggleLesson(key: string) {
    setExpandedLessons((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSection(key: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAllLessons() {
    if (!active) return;
    setExpandedLessons(new Set(activeLessons.map((_, idx) => `${active.chapter}-${idx}`)));
  }

  function collapseAllLessons() {
    setExpandedLessons(new Set());
    setExpandedSections(new Set());
  }

  if (course.isLoading) return <p className="text-sm text-mist">Loading course builder…</p>;
  if (course.isError) return <ErrorText message="Failed to load course builder." />;

  const data = course.data as ClassroomCourse;
  const status = teacherStatusLabel({
    hasSources,
    hasChapters: !!data.chapters.length,
    isGenerating,
    isPublished: data.is_published,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-paper">Course builder</h2>
          <p className="text-sm text-mist">
            {isTeacher
              ? "Sources → Generate → Review chapters → Publish for students."
              : "Follow the published learning path for this classroom."}
          </p>
        </div>
        {isTeacher ? (
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-lg border border-line px-3 py-1 text-xs font-medium text-paper">
              {status}
            </span>
            {isGenerating ? (
              <a href="#course-builder-progress" className="text-xs text-accent underline-offset-2 hover:underline">
                View progress
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <ErrorText message={error} />

      {isTeacher ? (
        <>
          <SetupPanel
            open={setupOpen}
            onToggle={() => {
              setSetupTouched(true);
              setSetupOpen((v) => !v);
            }}
            syllabusName={data.syllabus_file_name}
            selectedDocs={selectedDocs}
            documents={documents.data}
            uploadPending={uploadSyllabus.isPending}
            savePending={saveSources.isPending}
            onUpload={(file) => uploadSyllabus.mutate(file)}
            onSelectAll={() => setSelectedDocs((documents.data ?? []).map((d) => d.id))}
            onClear={() => setSelectedDocs([])}
            onToggleDoc={(docId, checked) => {
              setSelectedDocs((prev) =>
                checked ? [...prev, docId] : prev.filter((x) => x !== docId),
              );
            }}
            onSave={() => saveSources.mutate()}
          />

          <BuildPanel
            hasSources={hasSources}
            isGenerating={isGenerating}
            isPublished={data.is_published}
            activeJob={activeJob}
            recentJobs={jobs.data ?? []}
            onGenerateAll={() => void runJob(() => courseBuilderApi.generateAll(id))}
            onRegenerateStructure={() => void runJob(() => courseBuilderApi.generateStructure(id))}
            onTogglePublish={() =>
              void (async () => {
                setError(null);
                try {
                  await courseBuilderApi.publish(id, !data.is_published);
                  await qc.invalidateQueries({ queryKey: ["classroom-course", id] });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Publish failed");
                }
              })()
            }
          />
        </>
      ) : null}

      {!data.chapters.length ? (
        <EmptyState
          title={isTeacher ? "No course yet" : "Course not ready"}
          body={
            isTeacher
              ? "Add sources above, then click Generate all to build structure, study notes, and videos."
              : "Your teacher has not published a course for this classroom yet."
          }
        />
      ) : (
        <div className="space-y-3">
          {isTeacher ? <h3 className="font-semibold text-paper">3. Review</h3> : null}
          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <div className="space-y-2">
              <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-mist">Chapters</h4>
              {data.chapters.map((ch) => {
                const readiness = chapterReadiness(ch);
                return (
                  <button
                    key={ch.chapter}
                    type="button"
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                      selectedChapter === ch.chapter
                        ? "border-accent/50 bg-accent/10 text-paper"
                        : "border-line text-mist hover:text-paper"
                    }`}
                    onClick={() => setSelectedChapter(ch.chapter)}
                  >
                    <span className="font-medium">
                      {ch.chapter}. {ch.title}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${readinessBadgeClass(readiness)}`}>
                        {readiness}
                      </span>
                      {isTeacher ? (
                        <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-mist">
                          {ch.is_unlocked ? "Unlocked" : "Locked"}
                        </span>
                      ) : ch.is_locked_for_viewer ? (
                        <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-mist">Locked</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-4">
              {!active ? (
                <EmptyState title="Select a chapter" body="Choose a chapter from the list." />
              ) : active.is_locked_for_viewer ? (
                <EmptyState title="Chapter locked" body="Your teacher has not unlocked this chapter yet." />
              ) : (
                <>
                  <div className="space-y-3 rounded-2xl border border-line p-4">
                    <div>
                      <h3 className="font-display text-2xl text-paper">{active.title}</h3>
                      {active.summary ? <p className="mt-2 text-sm text-mist">{active.summary}</p> : null}
                      {active.objectives?.length ? (
                        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mist">
                          {active.objectives.map((o) => (
                            <li key={o}>{o}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {isTeacher ? (
                        <>
                          <GhostButton
                            disabled={isGenerating}
                            onClick={() =>
                              void runJob(() =>
                                courseBuilderApi.generateChapterContent(id, active.chapter),
                              )
                            }
                          >
                            Regenerate content
                          </GhostButton>
                          <GhostButton
                            onClick={() =>
                              void (async () => {
                                try {
                                  await courseBuilderApi.setChapterLock(
                                    id,
                                    active.chapter,
                                    !active.is_unlocked,
                                  );
                                  await qc.invalidateQueries({ queryKey: ["classroom-course", id] });
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : "Lock update failed");
                                }
                              })()
                            }
                          >
                            {active.is_unlocked ? "Lock chapter" : "Unlock for students"}
                          </GhostButton>
                        </>
                      ) : null}
                      {activeLessons.length ? (
                        <>
                          <GhostButton onClick={expandAllLessons}>Expand all</GhostButton>
                          <GhostButton onClick={collapseAllLessons}>Collapse all</GhostButton>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-mist">Lessons</h4>
                    {!activeLessons.length ? (
                      <p className="text-sm text-mist">
                        {isTeacher
                          ? "No lessons yet — generate content for this chapter."
                          : "No lessons in this chapter yet."}
                      </p>
                    ) : (
                      activeLessons.map((lesson, idx) => {
                        const lessonKey = `${active.chapter}-${idx}`;
                        const open = expandedLessons.has(lessonKey);
                        const snippet = (lesson.overview || lesson.summary || "").slice(0, 120);
                        return (
                          <div key={lessonKey} className="rounded-2xl border border-line">
                            <button
                              type="button"
                              className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
                              onClick={() => toggleLesson(lessonKey)}
                            >
                              <div>
                                <p className="font-semibold text-paper">
                                  Lesson {lesson.lesson || idx + 1}: {lesson.title}
                                </p>
                                {snippet ? (
                                  <p className="mt-1 text-sm text-mist">
                                    {snippet}
                                    {(lesson.overview || lesson.summary || "").length > 120 ? "…" : ""}
                                  </p>
                                ) : null}
                                {!lessonHasNotes(lesson) ? (
                                  <p className="mt-1 text-xs text-mist">Notes not generated yet</p>
                                ) : null}
                              </div>
                              <span className="shrink-0 text-xs text-mist">{open ? "Hide" : "Show"}</span>
                            </button>
                            {open ? (
                              <LessonBody
                                lesson={lesson}
                                idx={idx}
                                chapterNumber={active.chapter}
                                classroomId={id}
                                isTeacher={isTeacher}
                                isGenerating={isGenerating}
                                expandedSections={expandedSections}
                                onToggleSection={toggleSection}
                                videoUrlDrafts={videoUrlDrafts}
                                setVideoUrlDrafts={setVideoUrlDrafts}
                                onRunJob={runJob}
                                setError={setError}
                                qc={qc}
                              />
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
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
