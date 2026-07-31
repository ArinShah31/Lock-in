import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { courseBuilderApi, subjectsApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import { MarkdownNotes } from "../components/course/MarkdownNotes";
import { EmptyState, ErrorText, GhostButton, PageHeader, Panel, PrimaryButton } from "../components/ui";

export function ChapterNotesPage() {
  const { subjectId: subjectIdParam, chapterNumber: chapterParam } = useParams();
  const subjectId = Number(subjectIdParam);
  const chapterNumber = Number(chapterParam);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const autoStarted = useRef(false);

  const subjects = useQuery({ queryKey: ["subjects"], queryFn: subjectsApi.list });
  const subject = subjects.data?.find((s) => s.id === subjectId) ?? null;
  const canEdit =
    !!subject &&
    (user?.role === "SUPER_ADMIN" || user?.role === "CLASS_TEACHER" || user?.id === subject.teacher_id);

  const notes = useQuery({
    queryKey: ["chapter-notes", subjectId, chapterNumber],
    queryFn: () => courseBuilderApi.getChapterNotes(subjectId, chapterNumber),
    enabled: Number.isFinite(subjectId) && Number.isFinite(chapterNumber),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "GENERATING" || activeJobId) return 2000;
      return false;
    },
  });

  const generationJob = useQuery({
    queryKey: ["course-builder-job", subjectId, activeJobId],
    queryFn: () => courseBuilderApi.getJob(subjectId, activeJobId!),
    enabled: canEdit && activeJobId != null,
    refetchInterval: activeJobId ? 2000 : false,
  });

  const generateNotes = useMutation({
    mutationFn: () => courseBuilderApi.generateChapterNotes(subjectId, chapterNumber),
    onSuccess: async (job) => {
      setActiveJobId(job.id);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["chapter-notes", subjectId, chapterNumber] });
    },
    onError: (err: Error) => setError(err.message),
  });

  useEffect(() => {
    const status = generationJob.data?.status;
    if (status === "COMPLETED" || status === "FAILED") {
      void qc.invalidateQueries({ queryKey: ["chapter-notes", subjectId, chapterNumber] });
      if (status === "COMPLETED") setActiveJobId(null);
      if (status === "FAILED") {
        setError(generationJob.data?.error_message || "Notes generation failed");
        setActiveJobId(null);
      }
    }
  }, [generationJob.data?.status, generationJob.data?.error_message, qc, subjectId, chapterNumber]);

  useEffect(() => {
    if (!canEdit || autoStarted.current || !notes.data) return;
    if (notes.data.status === "GENERATING" && notes.data.job_id) {
      setActiveJobId(notes.data.job_id);
      return;
    }
    if (notes.data.status === "MISSING") {
      autoStarted.current = true;
      generateNotes.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-start once when notes are missing
  }, [canEdit, notes.data?.status, notes.data?.job_id]);

  const data = notes.data;

  return (
    <div>
      <PageHeader
        title={data?.chapter_title ? `Chapter ${chapterNumber}: ${data.chapter_title}` : `Chapter ${chapterNumber} notes`}
        subtitle={subject ? `${subject.name} · self-study lesson notes` : "Self-study lesson notes"}
      />
      <div className="mb-4">
        <Link to="/course-builder" className="text-sm text-accent underline-offset-2 hover:underline">
          ← Back to Course Builder
        </Link>
      </div>
      <ErrorText message={error || (notes.isError ? (notes.error as Error).message : null)} />

      {notes.isLoading ? (
        <Panel>
          <EmptyState title="Loading notes" body="Fetching chapter lesson notes…" />
        </Panel>
      ) : null}

      {data?.is_locked_for_viewer ? (
        <Panel>
          <EmptyState
            title="Chapter locked"
            body="Your teacher has not unlocked this chapter yet."
          />
        </Panel>
      ) : null}

      {data && !data.is_locked_for_viewer && data.status === "GENERATING" ? (
        <Panel>
          <EmptyState
            title="Generating notes"
            body="AI is writing classroom-complete lesson notes for this chapter. This can take a minute."
          />
        </Panel>
      ) : null}

      {data && !data.is_locked_for_viewer && data.status === "MISSING" ? (
        <Panel>
          {canEdit ? (
            <div className="space-y-3">
              <EmptyState
                title="No notes yet"
                body="Generate AI lesson notes for every topic in this chapter."
              />
              <PrimaryButton disabled={generateNotes.isPending} onClick={() => generateNotes.mutate()}>
                {generateNotes.isPending ? "Starting…" : "Generate notes"}
              </PrimaryButton>
            </div>
          ) : (
            <EmptyState title="Notes not ready yet" body="Your teacher has not generated notes for this chapter." />
          )}
        </Panel>
      ) : null}

      {data && !data.is_locked_for_viewer && data.status === "FAILED" ? (
        <Panel>
          <div className="space-y-3">
            <EmptyState
              title="Notes generation failed"
              body={data.error_message || "Something went wrong while generating notes."}
            />
            {canEdit ? (
              <PrimaryButton disabled={generateNotes.isPending} onClick={() => generateNotes.mutate()}>
                Try again
              </PrimaryButton>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {data && !data.is_locked_for_viewer && data.status === "READY" ? (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <Panel>
            <p className="mb-3 text-xs uppercase tracking-[0.14em] text-mist">Lessons</p>
            <nav className="space-y-2">
              {data.lessons.map((lesson) => (
                <a
                  key={lesson.lesson}
                  href={`#lesson-${lesson.lesson}`}
                  className="block rounded-xl border border-line px-3 py-2 text-sm text-paper hover:border-accent/40"
                >
                  Lesson {lesson.lesson}: {lesson.title}
                </a>
              ))}
            </nav>
            {canEdit ? (
              <div className="mt-4">
                <GhostButton
                  onClick={() => {
                    autoStarted.current = true;
                    generateNotes.mutate();
                  }}
                >
                  {generateNotes.isPending ? "Starting…" : "Regenerate notes"}
                </GhostButton>
              </div>
            ) : null}
          </Panel>

          <div className="space-y-4">
            {data.intro ? (
              <Panel>
                <p className="text-sm text-mist">{data.intro}</p>
              </Panel>
            ) : null}
            {data.lessons.map((lesson) => (
              <Panel key={lesson.lesson}>
                <div id={`lesson-${lesson.lesson}`} className="scroll-mt-24 space-y-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-mist">Lesson {lesson.lesson}</p>
                    <h2 className="font-display text-2xl text-paper">{lesson.title}</h2>
                    <p className="mt-1 text-sm text-mist">{lesson.summary}</p>
                  </div>

                  {lesson.learning_outcomes.length ? (
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-mist">Learning outcomes</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist">
                        {lesson.learning_outcomes.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <MarkdownNotes markdown={lesson.notes_markdown} />

                  {lesson.key_terms.length ? (
                    <p className="text-sm text-mist">
                      <span className="text-paper">Key terms:</span> {lesson.key_terms.join(", ")}
                    </p>
                  ) : null}

                  {lesson.examples.length ? (
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-mist">Examples</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist">
                        {lesson.examples.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {lesson.practice_prompts.length ? (
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-mist">Practice</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-mist">
                        {lesson.practice_prompts.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </Panel>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
