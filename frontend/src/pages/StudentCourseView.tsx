import { useEffect, useMemo, useState } from "react";
import type { ClassroomCourse, CourseChapter, CourseLesson } from "../api/types";
import { CourseMarkdown } from "../components/CourseMarkdown";
import { CourseRagChatWidget } from "../components/CourseRagChatWidget";
import { EmptyState, GhostButton, PrimaryButton } from "../components/ui";

type ProgressState = {
  completedLessonKeys: string[];
  lastLessonKey: string | null;
};

function progressKey(classroomId: number, userId: number) {
  return `astra-course-progress:${classroomId}:${userId}`;
}

function loadProgress(classroomId: number, userId: number): ProgressState {
  try {
    const raw = localStorage.getItem(progressKey(classroomId, userId));
    if (!raw) return { completedLessonKeys: [], lastLessonKey: null };
    const parsed = JSON.parse(raw) as ProgressState;
    return {
      completedLessonKeys: Array.isArray(parsed.completedLessonKeys) ? parsed.completedLessonKeys : [],
      lastLessonKey: typeof parsed.lastLessonKey === "string" ? parsed.lastLessonKey : null,
    };
  } catch {
    return { completedLessonKeys: [], lastLessonKey: null };
  }
}

function saveProgress(classroomId: number, userId: number, state: ProgressState) {
  localStorage.setItem(progressKey(classroomId, userId), JSON.stringify(state));
}

function lessonKey(chapter: number, lessonIndex: number) {
  return `${chapter}-${lessonIndex}`;
}

function chapterLessons(ch: CourseChapter): CourseLesson[] {
  return ch.lessons?.length ? ch.lessons : ch.subtopics || [];
}

function lessonHasNotes(lesson: CourseLesson): boolean {
  if (lesson.sections?.some((s) => !!s.content_markdown?.trim())) return true;
  return !!lesson.notes_markdown?.trim();
}

type StudentChapterBadge = "Ready" | "Coming soon" | "Locked";

function studentChapterBadge(ch: CourseChapter): StudentChapterBadge {
  if (ch.is_locked_for_viewer) return "Locked";
  const lessons = chapterLessons(ch);
  if (!lessons.length || !lessons.some(lessonHasNotes)) return "Coming soon";
  return "Ready";
}

function badgeClass(badge: StudentChapterBadge): string {
  if (badge === "Ready") return "border-accent/40 text-accent";
  if (badge === "Locked") return "border-line text-mist";
  return "border-line text-mist";
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

function StudentLessonReader({
  lesson,
  chapterNumber,
  lessonIndex,
  completed,
  onMarkComplete,
  onBack,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  lesson: CourseLesson;
  chapterNumber: number;
  lessonIndex: number;
  completed: boolean;
  onMarkComplete: () => void;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const objectives = lesson.learning_objectives?.length
    ? lesson.learning_objectives
    : lesson.learning_outcomes || [];

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#f8f9fa]/95 px-1 py-3 backdrop-blur-sm">
        <button type="button" onClick={onBack} className="text-sm text-accent hover:underline">
          ← Back to chapter
        </button>
        <p className="text-xs text-mist">
          Chapter {chapterNumber} · Lesson {lesson.lesson || lessonIndex + 1}
        </p>
        <GhostButton onClick={onMarkComplete}>{completed ? "Completed" : "Mark complete"}</GhostButton>
      </div>

      <h3 className="font-display text-2xl text-paper md:text-3xl">{lesson.title}</h3>

      {lesson.youtube_video_id ? (
        <div className="space-y-2">
          <YouTubeEmbed videoId={lesson.youtube_video_id} title={lesson.youtube_title} />
          {lesson.youtube_title ? <p className="text-xs text-mist">{lesson.youtube_title}</p> : null}
        </div>
      ) : null}

      {lesson.overview ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Overview</p>
          <p className="academic-text mt-2 text-base leading-relaxed text-paper/90">{lesson.overview}</p>
        </div>
      ) : null}

      {objectives.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Learning objectives</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-mist">
            {objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {lesson.prerequisites?.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Prerequisites</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mist">
            {lesson.prerequisites.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.sections?.length ? (
        <div className="space-y-8">
          {lesson.sections.map((section, sIdx) => (
            <section key={`${section.title}-${sIdx}`} className="space-y-3">
              <h4 className="font-display text-lg text-paper">
                {sIdx + 1}. {section.title}
              </h4>
              {section.content_markdown ? <CourseMarkdown content={section.content_markdown} /> : null}
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
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      ) : lesson.notes_markdown ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-mist">Study notes</p>
          <CourseMarkdown
            content={lesson.notes_markdown}
            className="rounded-xl border border-line bg-panel-low p-4"
          />
        </div>
      ) : null}

      {lesson.examples?.length ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Examples</p>
          {lesson.examples.map((ex, exIdx) => (
            <div key={`${ex.title}-${exIdx}`} className="rounded-xl border border-line p-3">
              <p className="font-medium text-paper">{ex.title || "Example"}</p>
              {ex.context ? <p className="mt-1 text-sm text-mist">{ex.context}</p> : null}
              {ex.content_markdown ? (
                <CourseMarkdown content={ex.content_markdown} className="mt-2 text-sm" />
              ) : null}
              {ex.takeaway ? <p className="mt-2 text-sm text-accent">Takeaway: {ex.takeaway}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {lesson.real_world_applications?.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Real-world applications</p>
          <ul className="mt-2 space-y-2">
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
          <dl className="mt-2 space-y-2">
            {lesson.key_terms.map((kt, ktIdx) => (
              <div key={`${kt.term}-${ktIdx}`} className="text-sm">
                <dt className="font-medium text-paper">{kt.term}</dt>
                {kt.definition ? <dd className="text-mist">{kt.definition}</dd> : null}
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {lesson.summary ? (
        <div className="rounded-xl border border-line bg-panel-low px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Summary</p>
          <p className="academic-text mt-2 text-sm leading-relaxed text-paper">{lesson.summary}</p>
        </div>
      ) : null}

      {lesson.references?.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">References</p>
          <ul className="mt-2 space-y-1 text-sm">
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
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <GhostButton disabled={!hasPrev} onClick={onPrev}>
          Previous lesson
        </GhostButton>
        <PrimaryButton disabled={!hasNext} onClick={onNext}>
          Next lesson
        </PrimaryButton>
      </div>
    </div>
  );
}

export function StudentCourseView({
  course,
  classroomId,
  userId,
}: {
  course: ClassroomCourse;
  classroomId: number;
  userId: number;
}) {
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [focusLessonIndex, setFocusLessonIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState<ProgressState>(() => loadProgress(classroomId, userId));

  useEffect(() => {
    setProgress(loadProgress(classroomId, userId));
  }, [classroomId, userId]);

  useEffect(() => {
    if (!course.chapters.length) {
      setSelectedChapter(null);
      return;
    }
    setSelectedChapter((prev) => {
      if (prev != null && course.chapters.some((c) => c.chapter === prev)) return prev;
      const unlocked = course.chapters.find((c) => !c.is_locked_for_viewer);
      return unlocked?.chapter ?? course.chapters[0].chapter;
    });
  }, [course.chapters]);

  useEffect(() => {
    setFocusLessonIndex(null);
  }, [selectedChapter]);

  const completedSet = useMemo(() => new Set(progress.completedLessonKeys), [progress.completedLessonKeys]);

  const active: CourseChapter | null = useMemo(() => {
    if (selectedChapter == null) return null;
    return course.chapters.find((c) => c.chapter === selectedChapter) ?? null;
  }, [course.chapters, selectedChapter]);

  const activeLessons = active ? chapterLessons(active) : [];
  const focusLesson =
    focusLessonIndex != null && activeLessons[focusLessonIndex] ? activeLessons[focusLessonIndex] : null;

  const resumeTarget = useMemo(() => {
    if (!progress.lastLessonKey) return null;
    const [chStr, idxStr] = progress.lastLessonKey.split("-");
    const chapter = Number(chStr);
    const lessonIndex = Number(idxStr);
    if (Number.isNaN(chapter) || Number.isNaN(lessonIndex)) return null;
    const ch = course.chapters.find((c) => c.chapter === chapter);
    if (!ch || ch.is_locked_for_viewer) return null;
    const lessons = chapterLessons(ch);
    const lesson = lessons[lessonIndex];
    if (!lesson) return null;
    return { chapter, lessonIndex, lesson };
  }, [course.chapters, progress.lastLessonKey]);

  function updateProgress(next: ProgressState) {
    setProgress(next);
    saveProgress(classroomId, userId, next);
  }

  function openLesson(chapter: number, lessonIndex: number) {
    setSelectedChapter(chapter);
    setFocusLessonIndex(lessonIndex);
    updateProgress({
      ...progress,
      lastLessonKey: lessonKey(chapter, lessonIndex),
    });
  }

  function markComplete(chapter: number, lessonIndex: number) {
    const key = lessonKey(chapter, lessonIndex);
    if (completedSet.has(key)) return;
    updateProgress({
      completedLessonKeys: [...progress.completedLessonKeys, key],
      lastLessonKey: key,
    });
  }

  function chapterDoneCount(ch: CourseChapter) {
    const lessons = chapterLessons(ch);
    return lessons.filter((_, i) => completedSet.has(lessonKey(ch.chapter, i))).length;
  }

  function navigateLesson(delta: number) {
    if (!active || focusLessonIndex == null) return;
    const nextIdx = focusLessonIndex + delta;
    if (nextIdx >= 0 && nextIdx < activeLessons.length) {
      openLesson(active.chapter, nextIdx);
      return;
    }
    const chapterOrder = course.chapters.map((c) => c.chapter);
    const pos = chapterOrder.indexOf(active.chapter);
    if (delta > 0) {
      for (let i = pos + 1; i < course.chapters.length; i++) {
        const ch = course.chapters[i];
        if (ch.is_locked_for_viewer) continue;
        const lessons = chapterLessons(ch);
        if (lessons.length) {
          openLesson(ch.chapter, 0);
          return;
        }
      }
    } else {
      for (let i = pos - 1; i >= 0; i--) {
        const ch = course.chapters[i];
        if (ch.is_locked_for_viewer) continue;
        const lessons = chapterLessons(ch);
        if (lessons.length) {
          openLesson(ch.chapter, lessons.length - 1);
          return;
        }
      }
    }
  }

  const hasPrevLesson = useMemo(() => {
    if (!active || focusLessonIndex == null) return false;
    if (focusLessonIndex > 0) return true;
    const pos = course.chapters.findIndex((c) => c.chapter === active.chapter);
    for (let i = pos - 1; i >= 0; i--) {
      const ch = course.chapters[i];
      if (!ch.is_locked_for_viewer && chapterLessons(ch).length) return true;
    }
    return false;
  }, [active, course.chapters, focusLessonIndex]);

  const hasNextLesson = useMemo(() => {
    if (!active || focusLessonIndex == null) return false;
    if (focusLessonIndex < activeLessons.length - 1) return true;
    const pos = course.chapters.findIndex((c) => c.chapter === active.chapter);
    for (let i = pos + 1; i < course.chapters.length; i++) {
      const ch = course.chapters[i];
      if (!ch.is_locked_for_viewer && chapterLessons(ch).length) return true;
    }
    return false;
  }, [active, activeLessons.length, course.chapters, focusLessonIndex]);

  if (!course.chapters.length) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="font-display text-xl text-paper">Course</h2>
          <p className="text-sm text-mist">Follow the published learning path for this classroom.</p>
        </div>
        <EmptyState
          title="Course not ready"
          body="Your teacher has not published a course for this classroom yet."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-paper">Course</h2>
        <p className="text-sm text-mist">Continue your learning path for this classroom.</p>
      </div>

      {resumeTarget && focusLessonIndex == null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3">
          <p className="text-sm text-paper">
            Continue where you left off · Lesson {resumeTarget.lesson.lesson || resumeTarget.lessonIndex + 1}:{" "}
            {resumeTarget.lesson.title}
          </p>
          <PrimaryButton onClick={() => openLesson(resumeTarget.chapter, resumeTarget.lessonIndex)}>
            Resume
          </PrimaryButton>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <div className={`space-y-2 ${focusLesson ? "opacity-60" : ""}`}>
          <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-mist">Chapters</h4>
          {course.chapters.map((ch) => {
            const badge = studentChapterBadge(ch);
            const lessons = chapterLessons(ch);
            const done = chapterDoneCount(ch);
            const selected = selectedChapter === ch.chapter;
            return (
              <button
                key={ch.chapter}
                type="button"
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                  selected ? "border-accent/50 bg-accent/10 text-paper" : "border-line text-mist hover:text-paper"
                }`}
                onClick={() => {
                  setSelectedChapter(ch.chapter);
                  setFocusLessonIndex(null);
                }}
              >
                <span className="font-medium">
                  {ch.chapter}. {ch.title}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${badgeClass(badge)}`}>{badge}</span>
                  {lessons.length && badge !== "Locked" ? (
                    <span className="text-[10px] text-mist">
                      {done}/{lessons.length} done
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="min-w-0">
          {!active ? (
            <EmptyState title="Select a chapter" body="Choose a chapter from the list." />
          ) : active.is_locked_for_viewer ? (
            <EmptyState
              title="Chapter locked"
              body="This chapter unlocks when your teacher opens it. Keep going on earlier chapters."
            />
          ) : focusLesson && focusLessonIndex != null ? (
            <StudentLessonReader
              lesson={focusLesson}
              chapterNumber={active.chapter}
              lessonIndex={focusLessonIndex}
              completed={completedSet.has(lessonKey(active.chapter, focusLessonIndex))}
              onMarkComplete={() => markComplete(active.chapter, focusLessonIndex)}
              onBack={() => setFocusLessonIndex(null)}
              onPrev={() => navigateLesson(-1)}
              onNext={() => navigateLesson(1)}
              hasPrev={hasPrevLesson}
              hasNext={hasNextLesson}
            />
          ) : (
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="font-display text-2xl text-paper">{active.title}</h3>
                {active.summary ? <p className="text-sm leading-relaxed text-mist">{active.summary}</p> : null}
                {active.objectives?.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Learning objectives</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mist">
                      {active.objectives.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {activeLessons.length ? (
                  <p className="text-xs text-mist">
                    Chapter progress {Math.round((chapterDoneCount(active) / activeLessons.length) * 100)}%
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-mist">Lessons</h4>
                {!activeLessons.length ? (
                  <p className="text-sm text-mist">No lessons in this chapter yet.</p>
                ) : (
                  activeLessons.map((lesson, idx) => {
                    const key = lessonKey(active.chapter, idx);
                    const done = completedSet.has(key);
                    const isResume = progress.lastLessonKey === key && !done;
                    const snippet = (lesson.overview || lesson.summary || "").slice(0, 110);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => openLesson(active.chapter, idx)}
                        className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition hover:border-accent/40 ${
                          isResume ? "border-accent/40 bg-accent/5" : "border-line"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                            done ? "bg-accent text-white" : "bg-panel-low text-mist"
                          }`}
                        >
                          {done ? "✓" : lesson.lesson || idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-paper">{lesson.title}</p>
                          {snippet ? (
                            <p className="mt-1 text-sm text-mist">
                              {snippet}
                              {(lesson.overview || lesson.summary || "").length > 110 ? "…" : ""}
                            </p>
                          ) : null}
                          <p className="mt-1 text-xs text-accent">
                            {done ? "Completed" : isResume ? "In progress · Open" : "Start"}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <CourseRagChatWidget classroomId={classroomId} />
    </div>
  );
}
