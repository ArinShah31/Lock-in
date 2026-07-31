import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { courseBuilderApi, subjectsApi } from "../api";
import type { LearningChapter } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { FlipFlashcards } from "../components/course/FlipFlashcards";
import { InteractiveRoadmap } from "../components/course/InteractiveRoadmap";
import { McqQuiz } from "../components/course/McqQuiz";
import { ShortAssessment } from "../components/course/ShortAssessment";
import {
  EmptyState,
  ErrorText,
  Field,
  GhostButton,
  inputClass,
  PageHeader,
  Panel,
  PrimaryButton,
} from "../components/ui";

type ChapterTab = "info" | "flashcards" | "quiz" | "assessment";

export function CourseBuilderPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [chapterTab, setChapterTab] = useState<ChapterTab>("info");
  const [error, setError] = useState<string | null>(null);
  const [syllabusFile, setSyllabusFile] = useState<File | null>(null);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  const subjects = useQuery({ queryKey: ["subjects"], queryFn: subjectsApi.list });
  const learningPath = useQuery({
    queryKey: ["learning-path", selectedId],
    queryFn: () => courseBuilderApi.getLearningPath(selectedId!),
    enabled: selectedId != null,
    refetchInterval: activeJobId ? 2500 : false,
  });
  const generationJob = useQuery({
    queryKey: ["course-builder-job", selectedId, activeJobId],
    queryFn: () => courseBuilderApi.getJob(selectedId!, activeJobId!),
    enabled: selectedId != null && activeJobId != null,
    refetchInterval: activeJobId ? 2000 : false,
  });

  useEffect(() => {
    const status = generationJob.data?.status;
    if (status === "COMPLETED" || status === "FAILED") {
      void qc.invalidateQueries({ queryKey: ["learning-path", selectedId] });
      void qc.invalidateQueries({ queryKey: ["course-builder-artifacts", selectedId] });
      if (status === "COMPLETED") setActiveJobId(null);
    }
  }, [generationJob.data?.status, qc, selectedId]);

  useEffect(() => {
    if (!learningPath.data?.chapters.length) {
      setSelectedChapter(null);
      return;
    }
    setSelectedChapter((prev) => {
      const stillValid = learningPath.data!.chapters.find(
        (c) => c.chapter === prev && !c.is_locked_for_viewer,
      );
      if (stillValid) return prev;
      const preferred =
        learningPath.data!.chapters.find((c) => c.is_current && !c.is_locked_for_viewer) ??
        learningPath.data!.chapters.find((c) => !c.is_locked_for_viewer);
      return preferred?.chapter ?? null;
    });
  }, [learningPath.data]);

  const selected = subjects.data?.find((s) => s.id === selectedId) ?? null;
  const canEdit =
    !!selected &&
    (user?.role === "SUPER_ADMIN" || user?.role === "CLASS_TEACHER" || user?.id === selected.teacher_id);

  const activeChapter: LearningChapter | null = useMemo(() => {
    if (!learningPath.data || selectedChapter == null) return null;
    return learningPath.data.chapters.find((c) => c.chapter === selectedChapter) ?? null;
  }, [learningPath.data, selectedChapter]);

  const uploadSyllabus = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => courseBuilderApi.uploadSyllabus(id, file),
    onSuccess: async () => {
      setSyllabusFile(null);
      await qc.invalidateQueries({ queryKey: ["subjects"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const generateCourse = useMutation({
    mutationFn: ({ id }: { id: number }) => courseBuilderApi.generate(id, ["LEARNING_PATH"]),
    onSuccess: async (job) => {
      setActiveJobId(job.id);
      await qc.invalidateQueries({ queryKey: ["learning-path", selectedId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const publishPath = useMutation({
    mutationFn: async () => {
      if (!learningPath.data?.artifact_id) throw new Error("Generate a learning path first");
      return courseBuilderApi.updateArtifact(learningPath.data.artifact_id, {
        is_published: !learningPath.data.is_published,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["learning-path", selectedId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const setLock = useMutation({
    mutationFn: ({ chapter, is_unlocked }: { chapter: number; is_unlocked: boolean }) =>
      courseBuilderApi.setChapterLock(selectedId!, chapter, is_unlocked),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["learning-path", selectedId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div>
      <PageHeader
        title="AI Course Builder"
        subtitle="Generate a chapter path, publish it, then unlock chapters as students progress."
      />
      <ErrorText message={error} />

      <div className="grid gap-6 xl:grid-cols-[260px_1.1fr_1fr]">
        <Panel>
          <h2 className="mb-3 font-display text-xl text-paper">Subjects</h2>
          {!subjects.data?.length ? (
            <EmptyState title="No subjects" body="Create or get assigned a subject first." />
          ) : (
            <div className="space-y-2">
              {subjects.data.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(s.id);
                    setActiveJobId(null);
                    setError(null);
                    setChapterTab("info");
                  }}
                  className={`w-full rounded-2xl border px-3 py-3 text-left ${
                    selectedId === s.id ? "border-accent/50 bg-accent/5" : "border-line bg-ink-soft/40"
                  }`}
                >
                  <p className="font-semibold text-paper">{s.name}</p>
                  <p className="text-xs text-mist">
                    {s.code} · {s.is_published ? "Published subject" : "Draft subject"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          {!selected ? (
            <Panel>
              <EmptyState title="Select a subject" body="Choose a subject to open the interactive learning map." />
            </Panel>
          ) : (
            <>
              {canEdit ? (
                <Panel>
                  <h3 className="font-display text-lg text-paper">1. Generate & publish</h3>
                  <p className="mt-1 text-sm text-mist">
                    Upload a syllabus, generate chapter drafts, then publish so students can see the map.
                  </p>
                  <div className="mt-4 grid gap-3">
                    <Field label="Upload syllabus file">
                      <input
                        className={inputClass}
                        type="file"
                        accept=".txt,.md,.pdf"
                        onChange={(e) => setSyllabusFile(e.target.files?.[0] ?? null)}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <PrimaryButton
                        disabled={!syllabusFile || uploadSyllabus.isPending}
                        onClick={() => {
                          if (!syllabusFile) return;
                          setError(null);
                          uploadSyllabus.mutate({ id: selected.id, file: syllabusFile });
                        }}
                      >
                        {uploadSyllabus.isPending ? "Uploading…" : "Upload syllabus"}
                      </PrimaryButton>
                      <GhostButton
                        onClick={() => {
                          setError(null);
                          generateCourse.mutate({ id: selected.id });
                        }}
                      >
                        {generateCourse.isPending ? "Starting…" : "Generate AI drafts"}
                      </GhostButton>
                      {learningPath.data?.artifact_id ? (
                        <GhostButton
                          onClick={() => {
                            setError(null);
                            publishPath.mutate();
                          }}
                        >
                          {learningPath.data.is_published ? "Unpublish path" : "Publish path"}
                        </GhostButton>
                      ) : null}
                    </div>
                    <p className="rounded-xl border border-line bg-ink/40 px-3 py-2 text-sm text-mist">
                      Real drafts need a Gemini API key in <code className="text-foam">backend/.env</code> as{" "}
                      <code className="text-foam">GEMINI_API_KEY</code>. Without it, generation is blocked (no more
                      hardcoded mock chapters). Get a free key at{" "}
                      <a
                        className="underline text-foam"
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Google AI Studio
                      </a>
                      , then restart the backend.
                    </p>
                    {activeJobId || generationJob.data?.status === "FAILED" ? (
                      <p className="rounded-xl border border-line px-3 py-2 text-sm text-mist">
                        Job status: {generationJob.data?.status ?? "PENDING"}
                        {generationJob.data?.error_message ? ` — ${generationJob.data.error_message}` : ""}
                      </p>
                    ) : null}
                  </div>
                </Panel>
              ) : null}

              {!learningPath.data?.chapters.length ? (
                <Panel>
                  <EmptyState
                    title="No learning path yet"
                    body={
                      canEdit
                        ? "Generate AI drafts to create the interactive chapter map."
                        : "Your teacher has not published a learning path yet."
                    }
                  />
                </Panel>
              ) : (
                <InteractiveRoadmap
                  chapters={learningPath.data.chapters}
                  currentChapter={learningPath.data.current_chapter}
                  selectedChapter={selectedChapter}
                  onSelect={(chapter) => {
                    setSelectedChapter(chapter);
                    setChapterTab("info");
                  }}
                  onOpenNotes={(chapter) => {
                    if (selectedId == null) return;
                    navigate(`/course-builder/subjects/${selectedId}/chapters/${chapter}/notes`);
                  }}
                />
              )}
            </>
          )}
        </div>

        <Panel>
          {!activeChapter ? (
            <EmptyState title="Select a chapter" body="Tap an unlocked milestone on the map." />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-mist">Chapter {activeChapter.chapter}</p>
                  <h2 className="font-display text-2xl text-paper">{activeChapter.title}</h2>
                  <p className="mt-1 text-sm text-mist">{activeChapter.timeline}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!activeChapter.is_locked_for_viewer && selectedId != null ? (
                    <PrimaryButton
                      onClick={() =>
                        navigate(
                          `/course-builder/subjects/${selectedId}/chapters/${activeChapter.chapter}/notes`,
                        )
                      }
                    >
                      Open notes
                    </PrimaryButton>
                  ) : null}
                  {canEdit ? (
                    <GhostButton
                      onClick={() =>
                        setLock.mutate({
                          chapter: activeChapter.chapter,
                          is_unlocked: !activeChapter.is_unlocked,
                        })
                      }
                    >
                      {activeChapter.is_unlocked ? "Lock chapter" : "Unlock chapter"}
                    </GhostButton>
                  ) : null}
                </div>
              </div>

              {activeChapter.is_locked_for_viewer ? (
                <EmptyState
                  title="Chapter locked"
                  body="Your teacher has not unlocked this chapter yet. Complete earlier chapters and wait for unlock."
                />
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["info", "Info"],
                        ["flashcards", "Flashcards"],
                        ["quiz", "Quiz"],
                        ["assessment", "Assessment"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setChapterTab(id)}
                        className={`rounded-full px-3 py-1.5 text-sm ${
                          chapterTab === id ? "bg-accent text-ink" : "border border-line text-mist"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {chapterTab === "info" ? (
                    <div className="space-y-3 text-sm">
                      <p className="text-paper">{activeChapter.summary}</p>
                      {activeChapter.objectives.length ? (
                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-mist">Objectives</p>
                          <ul className="mt-1 list-disc space-y-1 pl-5 text-mist">
                            {activeChapter.objectives.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {activeChapter.topics.length ? (
                        <p className="text-mist">
                          <span className="text-paper">Topics:</span> {activeChapter.topics.join(", ")}
                        </p>
                      ) : null}
                      {activeChapter.activities.length ? (
                        <p className="text-mist">
                          <span className="text-paper">Activities:</span> {activeChapter.activities.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {chapterTab === "flashcards" ? <FlipFlashcards cards={activeChapter.flashcards} /> : null}

                  {chapterTab === "quiz" ? (
                    <McqQuiz
                      questions={activeChapter.quiz}
                      onSubmit={async (selected_answers) => {
                        await courseBuilderApi.submitQuizAttempt(selectedId!, activeChapter.chapter, selected_answers);
                      }}
                    />
                  ) : null}

                  {chapterTab === "assessment" ? (
                    <ShortAssessment
                      assessment={activeChapter.assessment}
                      onSubmit={async (answers) => {
                        await courseBuilderApi.submitAssessmentAttempt(selectedId!, activeChapter.chapter, answers);
                      }}
                    />
                  ) : null}
                </>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
