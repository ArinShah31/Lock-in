import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { classroomsApi, practiceApi } from "../api";
import type {
  Classroom,
  PracticeAssessment,
  PracticeFlashcard,
  PracticeFlashcardDeck,
  PracticeOverview,
  PracticeQuestion,
  PracticeQuiz,
} from "../api/types";
import {
  EmptyState,
  ErrorText,
  GhostButton,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";

type PracticeSection = "quizzes" | "flashcards" | "assessments";
type AssessmentSection = "topic" | "subject";

type PracticeSectionOption = {
  key: PracticeSection;
  label: string;
  description: string;
  icon: string;
};

type AssessmentSectionOption = {
  key: AssessmentSection;
  label: string;
  description: string;
  icon: string;
};

const practiceSections: PracticeSectionOption[] = [
  {
    key: "quizzes",
    label: "Quizzes",
    description: "Quick concept checks generated from your classroom material.",
    icon: "quiz",
  },
  {
    key: "flashcards",
    label: "FlashCards",
    description: "Fast recall decks for revision right before practice or class.",
    icon: "style",
  },
  {
    key: "assessments",
    label: "Assessments",
    description: "Timed topic-wise and subject-wise evaluation once unlocked.",
    icon: "assignment",
  },
];

const assessmentSections: AssessmentSectionOption[] = [
  {
    key: "topic",
    label: "Topic Wise Assessments",
    description: "Focused checks around one chapter or concept band.",
    icon: "target",
  },
  {
    key: "subject",
    label: "Subject Wise Assessments",
    description: "Longer mixed rounds across the whole classroom scope.",
    icon: "library_books",
  },
];

function sectionButtonClass(active: boolean) {
  return [
    "group relative flex h-full w-full flex-col items-start gap-2 overflow-hidden rounded-2xl border px-4 py-4 text-left transition-all duration-200",
    active
      ? "border-[#031635] bg-[linear-gradient(135deg,#031635_0%,#0d2a57_100%)] text-white shadow-lg shadow-[#031635]/15"
      : "border-[#d8dde3] bg-white text-[#44474e] hover:-translate-y-0.5 hover:border-[#9db2d1] hover:bg-[#f8fbff] hover:shadow-md",
  ].join(" ");
}

function subsectionButtonClass(active: boolean) {
  return [
    "relative z-10 flex min-h-[90px] w-full flex-col items-start justify-center gap-1 rounded-[1rem] px-4 py-3 text-left transition-colors duration-300",
    active ? "text-white" : "text-[#4b5563] hover:text-[#031635]",
  ].join(" ");
}

function AnimatedSwitchContent({
  motionKey,
  children,
}: {
  motionKey: string;
  children: ReactNode;
}) {
  return <AnimatedSwitchContentInner key={motionKey}>{children}</AnimatedSwitchContentInner>;
}

function AnimatedSwitchContentInner({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translate3d(0, 0, 0) scale(1)" : "translate3d(0, 12px, 0) scale(0.985)",
        transition:
          "opacity 240ms cubic-bezier(0.22, 1, 0.36, 1), transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: "transform, opacity",
      }}
    >
      {children}
    </div>
  );
}

function formatScore(score: number | null | undefined) {
  if (score == null) return "Not attempted";
  return `${Math.round(score)}%`;
}

function formatAttemptLabel(timestamp: string | null) {
  if (!timestamp) return "No attempt yet";
  const date = new Date(timestamp);
  return `Last attempted ${date.toLocaleDateString()}`;
}

function activityStatus(score: number | null) {
  if (score == null) return { label: "Ready", className: "border-[#d6e3ff] bg-[#eef4ff] text-[#3f5d9b]" };
  if (score >= 75) return { label: "Strong", className: "border-[#cfe9d5] bg-[#edf9ef] text-[#1f6a34]" };
  return { label: "Retry", className: "border-[#ffe0b2] bg-[#fff4df] text-[#8a4f00]" };
}

function QuestionRunner({
  title,
  subtitle,
  questions,
  buttonText,
  isSubmitting,
  onSubmit,
  onClose,
  lastScore,
}: {
  title: string;
  subtitle: string;
  questions: PracticeQuestion[];
  buttonText: string;
  isSubmitting: boolean;
  onSubmit: (answers: string[]) => Promise<void> | void;
  onClose: () => void;
  lastScore: number | null;
}) {
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([]);

  useEffect(() => {
    setSelectedAnswers(Array.from({ length: questions.length }, () => ""));
  }, [questions]);

  return (
    <Panel className="space-y-5 border-[#d6e3ff] bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_100%)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="font-display text-2xl font-extrabold text-[#031635]">{title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#4b5563]">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[#d6e3ff] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
            {questions.length} questions
          </span>
          <span className="rounded-full border border-[#e1e3e4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#5d6167]">
            {formatScore(lastScore)}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {questions.map((question, index) => (
          <div key={`${question.question}-${index}`} className="rounded-2xl border border-[#dfe4ea] bg-white px-5 py-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#3f5d9b]">Question {index + 1}</p>
            <p className="mt-3 font-display text-lg font-bold leading-8 text-[#031635]">{question.question}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {question.options.map((option) => {
                const checked = selectedAnswers[index] === option;
                return (
                  <label
                    key={option}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition ${
                      checked
                        ? "border-[#031635] bg-[#eef4ff] text-[#031635]"
                        : "border-[#d8dde3] bg-[#fafbfc] text-[#4b5563] hover:border-[#9db2d1] hover:bg-white"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`practice-question-${index}`}
                      value={option}
                      checked={checked}
                      onChange={() =>
                        setSelectedAnswers((prev) => {
                          const next = [...prev];
                          next[index] = option;
                          return next;
                        })
                      }
                      className="mt-1 h-4 w-4 accent-[#031635]"
                    />
                    <span>{option}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap justify-end gap-3">
        <GhostButton onClick={onClose}>Close</GhostButton>
        <PrimaryButton
          onClick={() => void onSubmit(selectedAnswers)}
          disabled={isSubmitting || selectedAnswers.some((answer) => !answer)}
        >
          {isSubmitting ? "Submitting..." : buttonText}
        </PrimaryButton>
      </div>
    </Panel>
  );
}

const FlashcardFlipCard = memo(function FlashcardFlipCard({
  card,
  flipped,
  onToggle,
}: {
  card: PracticeFlashcard;
  flipped: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={flipped}
      onClick={onToggle}
      className="group h-[280px] w-full rounded-[1.6rem] text-left [perspective:1400px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3f5d9b] focus-visible:ring-offset-2"
    >
      <div
        className="relative h-full w-full rounded-[1.6rem]"
        style={{
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 520ms cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}
      >
        <div
          className="absolute inset-0 flex h-full flex-col overflow-hidden rounded-[1.6rem] border border-[#d8dde3] bg-[linear-gradient(145deg,#ffffff_0%,#f8fbff_100%)] p-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]"
          style={{ backfaceVisibility: "hidden" }}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="rounded-full border border-[#dce7fa] bg-[#eef4ff] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
              Question
            </span>
            <span className="material-symbols-outlined text-[#7f8ba1] transition group-hover:text-[#031635]">
              touch_app
            </span>
          </div>
          <div className="mt-5 flex-1">
            <p className="font-display text-[1.35rem] font-bold leading-8 text-[#031635]">{card.question}</p>
            <p className="mt-4 text-sm leading-6 text-[#5d6167]">{card.cue}</p>
          </div>
          <div className="flex items-center justify-between border-t border-[#e6ebf2] pt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">Tap to reveal</span>
            <span className="material-symbols-outlined text-[#3f5d9b]">rotate_right</span>
          </div>
        </div>

        <div
          className="absolute inset-0 flex h-full flex-col overflow-hidden rounded-[1.6rem] border border-[#102d59] bg-[linear-gradient(145deg,#031635_0%,#103566_100%)] p-5 text-white shadow-[0_22px_60px_rgba(3,22,53,0.24)]"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/85">
              Answer
            </span>
            <span className="material-symbols-outlined text-white/70">lightbulb</span>
          </div>
          <div className="mt-5 flex-1">
            <p className="text-base leading-7 text-white/92">{card.answer}</p>
          </div>
          <div className="flex items-center justify-between border-t border-white/10 pt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">Tap to hide</span>
            <span className="material-symbols-outlined text-white/70">rotate_left</span>
          </div>
        </div>
      </div>
    </button>
  );
});

function FlashcardsExperience({
  decks,
  selectedDeckId,
  onSelectDeck,
  flippedIds,
  onToggleCard,
  onResetDeck,
}: {
  decks: PracticeFlashcardDeck[];
  selectedDeckId: string;
  onSelectDeck: (deckId: string) => void;
  flippedIds: Set<string>;
  onToggleCard: (cardId: string) => void;
  onResetDeck: () => void;
}) {
  if (!decks.length) {
    return (
      <EmptyState
        title="Flashcards will show up here"
        body="Generate chapter assessments from classroom documents and syllabus to unlock revision decks."
      />
    );
  }

  const deck = decks.find((item) => item.id === selectedDeckId) ?? decks[0];
  const revealedCount = deck.cards.filter((card) => flippedIds.has(card.id)).length;
  const remainingCount = deck.cards.length - revealedCount;
  const progress = deck.cards.length ? Math.round((revealedCount / deck.cards.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Panel className="space-y-5 bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#dce7fa] bg-[#eef4ff] px-3 py-1 text-xs font-semibold text-[#3f5d9b]">
              <span className="material-symbols-outlined text-sm">style</span>
              <span>Flashcard revision mode</span>
            </div>
            <h3 className="mt-4 font-display text-2xl font-extrabold text-[#031635]">{deck.title}</h3>
            <p className="mt-2 text-sm leading-6 text-[#4b5563]">{deck.summary}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-2xl border border-[#e1e3e4] bg-white px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Classroom</p>
              <p className="mt-2 font-semibold text-[#031635]">{deck.subject}</p>
            </div>
            <div className="rounded-2xl border border-[#e1e3e4] bg-white px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Estimated time</p>
              <p className="mt-2 font-semibold text-[#031635]">{deck.estimated_time}</p>
            </div>
            <div className="rounded-2xl border border-[#e1e3e4] bg-white px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Progress</p>
              <p className="mt-2 font-semibold text-[#031635]">
                {revealedCount}/{deck.cards.length} revealed
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-[#dce7fa] bg-[#f7fbff] px-4 py-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#3f5d9b]">Study guidance</p>
            <p className="mt-2 text-sm leading-6 text-[#4b5563]">{deck.focus}</p>
            <p className="mt-3 text-sm leading-6 text-[#031635]">{deck.mastery_hint}</p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Deck progress</span>
              <span className="text-sm font-semibold text-[#031635]">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#e9eef4]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#3f5d9b_0%,#031635_100%)] transition-[width] duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-[#5d6167]">
              <span>{remainingCount} hidden</span>
              <button
                type="button"
                onClick={onResetDeck}
                className="font-semibold text-[#3f5d9b] transition hover:text-[#031635]"
              >
                Reset deck
              </button>
            </div>
          </div>
        </Panel>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-bold text-[#031635]">Choose a revision deck</h3>
              <p className="text-sm text-[#4b5563]">
                These decks are generated directly from your classroom documents and syllabus scope.
              </p>
            </div>
            <span className="rounded-full border border-[#dce7fa] bg-[#f6f9ff] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
              Tap card to flip
            </span>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {decks.map((item) => {
              const active = item.id === deck.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectDeck(item.id)}
                  className={`rounded-2xl border p-4 text-left transition-all ${
                    active
                      ? "border-[#031635] bg-[linear-gradient(135deg,#031635_0%,#103566_100%)] text-white shadow-lg shadow-[#031635]/15"
                      : "border-[#d8dde3] bg-white text-[#031635] hover:-translate-y-0.5 hover:border-[#9db2d1] hover:bg-[#f8fbff] hover:shadow-md"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-[0.14em] ${active ? "text-white/70" : "text-[#3f5d9b]"}`}>
                        {item.subject}
                      </p>
                      <h4 className="mt-2 font-display text-lg font-bold">{item.title}</h4>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        active ? "bg-white/10 text-white/85" : "bg-[#eef4ff] text-[#3f5d9b]"
                      }`}
                    >
                      {item.cards.length} cards
                    </span>
                  </div>
                  <p className={`mt-3 text-sm leading-6 ${active ? "text-white/78" : "text-[#5d6167]"}`}>
                    {item.summary}
                  </p>
                </button>
              );
            })}
          </div>

          <AnimatedSwitchContent motionKey={`flashcards-${deck.id}`}>
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {deck.cards.map((card) => (
                <FlashcardFlipCard
                  key={card.id}
                  card={card}
                  flipped={flippedIds.has(card.id)}
                  onToggle={() => onToggleCard(card.id)}
                />
              ))}
            </div>
          </AnimatedSwitchContent>
        </div>
      </div>
    </div>
  );
}

function QuizGrid({
  items,
  onOpen,
}: {
  items: PracticeQuiz[];
  onOpen: (quiz: PracticeQuiz) => void;
}) {
  if (!items.length) {
    return (
      <EmptyState
        title="Quizzes will appear here"
        body="Once classroom material is generated from syllabus and uploaded documents, quick quizzes will light up here automatically."
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const status = activityStatus(item.latest_score);
        return (
          <Panel key={item.chapter_number} className="flex h-full flex-col justify-between gap-4 p-0">
            <div className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
                    {item.topic_label} · {item.question_count} questions
                  </p>
                  <h3 className="mt-2 font-display text-lg font-bold text-[#031635]">{item.title}</h3>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.className}`}>
                  {status.label}
                </span>
              </div>
              <p className="text-sm leading-6 text-[#44474e]">{item.summary || "Practice this chapter with a quick AI-generated recall round."}</p>
            </div>

            <div className="space-y-3 border-t border-[#e1e3e4] px-5 py-4">
              <div className="flex items-center justify-between text-sm text-[#5d6167]">
                <span>{formatAttemptLabel(item.latest_attempted_at)}</span>
                <span className="font-semibold text-[#031635]">{formatScore(item.latest_score)}</span>
              </div>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[#031635] transition hover:text-[#3f5d9b]"
              >
                <span>{item.latest_score == null ? "Start quiz" : "Retake quiz"}</span>
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function AssessmentGrid({
  items,
  onOpen,
}: {
  items: PracticeAssessment[];
  onOpen: (assessment: PracticeAssessment) => void;
}) {
  if (!items.length) {
    return (
      <EmptyState
        title="Assessments are waiting on generation"
        body="Assessments will appear once classroom practice material has been generated from your source documents."
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const status = item.is_locked
          ? { label: "Locked", className: "border-[#f1d1d1] bg-[#fff2f1] text-[#a03a3a]" }
          : activityStatus(item.latest_score);

        return (
          <Panel key={`${item.assessment_kind}-${item.target_key}`} className="flex h-full flex-col justify-between gap-4 p-0">
            <div className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
                    {item.meta} · {item.duration_minutes} mins
                  </p>
                  <h3 className="mt-2 font-display text-lg font-bold text-[#031635]">{item.title}</h3>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.className}`}>
                  {status.label}
                </span>
              </div>
              <p className="text-sm leading-6 text-[#44474e]">{item.detail}</p>
            </div>

            <div className="space-y-3 border-t border-[#e1e3e4] px-5 py-4">
              <div className="flex items-center justify-between text-sm text-[#5d6167]">
                <span>{item.question_count} questions</span>
                <span className="font-semibold text-[#031635]">{formatScore(item.latest_score)}</span>
              </div>
              <button
                type="button"
                disabled={item.is_locked}
                onClick={() => onOpen(item)}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[#031635] transition hover:text-[#3f5d9b] disabled:cursor-not-allowed disabled:text-[#8b8d96]"
              >
                <span>{item.is_locked ? "Locked by class teacher" : item.latest_score == null ? "Start assessment" : "Retake assessment"}</span>
                <span className="material-symbols-outlined text-base">
                  {item.is_locked ? "lock" : "arrow_forward"}
                </span>
              </button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

export function PracticePage() {
  const { user, loading: authLoading } = useAuth();
  const [section, setSection] = useState<PracticeSection>("quizzes");
  const [assessmentSection, setAssessmentSection] = useState<AssessmentSection>("topic");
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [practice, setPractice] = useState<PracticeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFlashcardDeckId, setSelectedFlashcardDeckId] = useState("");
  const [flippedFlashcards, setFlippedFlashcards] = useState<Set<string>>(new Set());
  const [activeQuizChapter, setActiveQuizChapter] = useState<number | null>(null);
  const [activeAssessment, setActiveAssessment] = useState<{ kind: string; targetKey: string } | null>(null);
  const [submitState, setSubmitState] = useState<{ kind: "quiz" | "assessment"; loading: boolean } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (user?.role !== "STUDENT") {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const classrooms = await classroomsApi.list();
        const firstClassroom = classrooms[0] ?? null;
        if (!firstClassroom) {
          if (!cancelled) {
            setClassroom(null);
            setPractice(null);
          }
          return;
        }

        const overview = await practiceApi.get(firstClassroom.id);
        if (!cancelled) {
          setClassroom(firstClassroom);
          setPractice(overview);
          setSelectedFlashcardDeckId(overview.flashcard_decks[0]?.id ?? "");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load practice space");
          setClassroom(null);
          setPractice(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, user?.role]);

  useEffect(() => {
    setFlippedFlashcards(new Set());
  }, [selectedFlashcardDeckId]);

  const activeFlashcardDeck = useMemo(
    () => practice?.flashcard_decks.find((deck) => deck.id === selectedFlashcardDeckId) ?? practice?.flashcard_decks[0] ?? null,
    [practice?.flashcard_decks, selectedFlashcardDeckId],
  );
  const activeQuiz = useMemo(
    () => practice?.quizzes.find((quiz) => quiz.chapter_number === activeQuizChapter) ?? null,
    [practice?.quizzes, activeQuizChapter],
  );
  const assessmentItems = assessmentSection === "topic" ? practice?.topic_assessments ?? [] : practice?.subject_assessments ?? [];
  const activeAssessmentItem = useMemo(
    () =>
      assessmentItems.find(
        (item) => item.assessment_kind === activeAssessment?.kind && item.target_key === activeAssessment?.targetKey,
      ) ?? null,
    [assessmentItems, activeAssessment],
  );

  async function refreshPractice() {
    if (!classroom) return;
    const overview = await practiceApi.get(classroom.id);
    setPractice(overview);
    if (!overview.flashcard_decks.some((deck) => deck.id === selectedFlashcardDeckId)) {
      setSelectedFlashcardDeckId(overview.flashcard_decks[0]?.id ?? "");
    }
  }

  async function handleQuizSubmit(selectedAnswers: string[]) {
    if (!classroom || !activeQuiz) return;
    setSubmitState({ kind: "quiz", loading: true });
    try {
      await practiceApi.submitQuiz(classroom.id, activeQuiz.chapter_number, selectedAnswers);
      await refreshPractice();
      setActiveQuizChapter(activeQuiz.chapter_number);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit quiz");
    } finally {
      setSubmitState(null);
    }
  }

  async function handleAssessmentSubmit(selectedAnswers: string[]) {
    if (!classroom || !activeAssessmentItem) return;
    setSubmitState({ kind: "assessment", loading: true });
    try {
      await practiceApi.submitAssessment(
        classroom.id,
        activeAssessmentItem.assessment_kind,
        activeAssessmentItem.target_key,
        selectedAnswers,
      );
      await refreshPractice();
      setActiveAssessment({
        kind: activeAssessmentItem.assessment_kind,
        targetKey: activeAssessmentItem.target_key,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit assessment");
    } finally {
      setSubmitState(null);
    }
  }

  if (user?.role !== "STUDENT") {
    return <Navigate to="/" replace />;
  }

  if (authLoading || loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Practise" subtitle="Loading your classroom practice space..." />
        <Panel className="space-y-3">
          <div className="h-5 w-48 animate-pulse rounded bg-[#e9eef4]" />
          <div className="h-4 w-full animate-pulse rounded bg-[#eef2f6]" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-[#eef2f6]" />
        </Panel>
      </div>
    );
  }

  if (error && !classroom) {
    return (
      <div className="space-y-6">
        <PageHeader title="Practise" subtitle="This space becomes available after you join a classroom." />
        <EmptyState title="Could not load practice" body={error} />
      </div>
    );
  }

  if (!classroom) {
    return (
      <div className="space-y-6">
        <PageHeader title="Practise" subtitle="This space becomes available after you join a classroom." />
        <EmptyState
          title="No classroom found yet"
          body="Join your classroom first. Once you are enrolled, quizzes, flashcards, and assessments will appear here automatically."
        />
      </div>
    );
  }

  const summary = practice?.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Practise"
        subtitle={`Generated from ${classroom.name} classroom material so your revision stays within syllabus and shared document context.`}
        action={
          <SecondaryButton
            onClick={() => {
              if (practice?.quizzes.length) {
                setSection("quizzes");
                setActiveQuizChapter(practice.quizzes[0].chapter_number);
              } else if (practice?.flashcard_decks.length) {
                setSection("flashcards");
                setSelectedFlashcardDeckId(practice.flashcard_decks[0].id);
              } else {
                setSection("assessments");
              }
            }}
          >
            Continue latest
          </SecondaryButton>
        }
      />

      <ErrorText message={error} />

      <Panel className="overflow-hidden bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_55%,#eef4ff_100%)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d6e3ff] bg-white/80 px-3 py-1 text-xs font-semibold text-[#3f5d9b]">
              <span className="material-symbols-outlined text-sm">school</span>
              <span>{classroom.name} · Student revision workspace</span>
            </div>
            <h2 className="mt-4 font-display text-2xl font-extrabold text-[#031635]">Your daily practice lane</h2>
            <p className="mt-2 text-sm leading-6 text-[#44474e]">
              Classroom documents and syllabus feed this space directly, so your revision, quizzes, flashcards, and assessment scope stay grounded in what was actually taught.
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
              {practice?.source_document_count ?? 0} source documents connected
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[#e1e3e4] bg-white/90 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Ready now</p>
              <p className="mt-2 font-display text-2xl font-extrabold text-[#031635]">{summary?.ready_quizzes ?? 0}</p>
            </div>
            <div className="rounded-xl border border-[#e1e3e4] bg-white/90 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Flash decks</p>
              <p className="mt-2 font-display text-2xl font-extrabold text-[#031635]">{summary?.flashcard_decks ?? 0}</p>
            </div>
            <div className="rounded-xl border border-[#e1e3e4] bg-white/90 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Locked assessments</p>
              <p className="mt-2 font-display text-2xl font-extrabold text-[#031635]">{summary?.locked_assessments ?? 0}</p>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-3">
        {practiceSections.map((item) => {
          const active = section === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={sectionButtonClass(active)}
              onClick={() => setSection(item.key)}
            >
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-2xl border transition ${
                  active
                    ? "border-white/15 bg-white/10 text-white"
                    : "border-[#d6e3ff] bg-[#eef4ff] text-[#3f5d9b] group-hover:border-[#bfd2f3] group-hover:bg-white"
                }`}
              >
                <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg font-bold">{item.label}</span>
                  {active ? (
                    <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/90">
                      Active
                    </span>
                  ) : null}
                </div>
                <p className={`text-sm leading-5 ${active ? "text-white/80" : "text-[#5d6167]"}`}>
                  {item.description}
                </p>
              </div>

              <div className="mt-auto flex w-full justify-end pt-1">
                <span
                  className={`material-symbols-outlined text-base transition-transform ${
                    active ? "translate-x-0 text-white" : "text-[#3f5d9b] group-hover:translate-x-0.5"
                  }`}
                >
                  arrow_forward
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {section === "assessments" ? (
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-bold text-[#031635]">Assessment tracks</h3>
              <p className="text-sm text-[#44474e]">
                Topic assessments stay locked until your class teacher opens them. Subject assessments follow the same classroom-wide release model.
              </p>
            </div>
            <div className="w-full lg:max-w-[720px]">
              <div className="relative grid grid-cols-1 rounded-[1.35rem] border border-[#d9dee5] bg-[linear-gradient(180deg,#f8f9fb_0%,#f2f5f9_100%)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] sm:grid-cols-2">
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-1.5 top-1.5 bottom-1.5 rounded-[1rem] bg-[linear-gradient(135deg,#031635_0%,#12386f_100%)] shadow-[0_12px_28px_rgba(3,22,53,0.18)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:w-[calc(50%-0.375rem)] ${
                    assessmentSection === "topic" ? "translate-x-0" : "translate-x-0 sm:translate-x-[calc(100%+0.375rem)]"
                  }`}
                />
                {assessmentSections.map((item) => {
                  const active = assessmentSection === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={subsectionButtonClass(active)}
                      onClick={() => setAssessmentSection(item.key)}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`material-symbols-outlined text-[19px] transition-colors ${
                            active ? "text-white" : "text-[#3f5d9b]"
                          }`}
                        >
                          {item.icon}
                        </span>
                        <span className="text-sm font-semibold sm:text-[15px]">{item.label}</span>
                      </div>
                      <p className={`text-xs leading-5 sm:text-[13px] ${active ? "text-white/78" : "text-[#667085]"}`}>
                        {item.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Panel>
      ) : null}

      {section === "quizzes" ? (
        <div className="space-y-6">
          <AnimatedSwitchContent motionKey="practice-quizzes">
            <QuizGrid
              items={practice?.quizzes ?? []}
              onOpen={(quiz) => {
                setActiveQuizChapter(quiz.chapter_number);
                setActiveAssessment(null);
              }}
            />
          </AnimatedSwitchContent>
          {activeQuiz ? (
            <QuestionRunner
              title={activeQuiz.title}
              subtitle={activeQuiz.summary || `Generated from ${classroom.name} classroom material for focused recall.`}
              questions={activeQuiz.questions}
              buttonText="Submit quiz"
              isSubmitting={submitState?.kind === "quiz" && submitState.loading}
              onSubmit={handleQuizSubmit}
              onClose={() => setActiveQuizChapter(null)}
              lastScore={practice?.quizzes.find((item) => item.chapter_number === activeQuiz.chapter_number)?.latest_score ?? null}
            />
          ) : null}
        </div>
      ) : null}

      {section === "flashcards" ? (
        <FlashcardsExperience
          decks={practice?.flashcard_decks ?? []}
          selectedDeckId={activeFlashcardDeck?.id ?? selectedFlashcardDeckId}
          onSelectDeck={setSelectedFlashcardDeckId}
          flippedIds={flippedFlashcards}
          onToggleCard={(cardId) =>
            setFlippedFlashcards((prev) => {
              const next = new Set(prev);
              if (next.has(cardId)) next.delete(cardId);
              else next.add(cardId);
              return next;
            })
          }
          onResetDeck={() => setFlippedFlashcards(new Set())}
        />
      ) : null}

      {section === "assessments" ? (
        <div className="space-y-6">
          <AnimatedSwitchContent motionKey={`practice-assessments-${assessmentSection}`}>
            <AssessmentGrid
              items={assessmentItems}
              onOpen={(assessment) => {
                setActiveAssessment({
                  kind: assessment.assessment_kind,
                  targetKey: assessment.target_key,
                });
                setActiveQuizChapter(null);
              }}
            />
          </AnimatedSwitchContent>
          {activeAssessmentItem && !activeAssessmentItem.is_locked ? (
            <QuestionRunner
              title={activeAssessmentItem.title}
              subtitle={activeAssessmentItem.detail}
              questions={activeAssessmentItem.questions}
              buttonText="Submit assessment"
              isSubmitting={submitState?.kind === "assessment" && submitState.loading}
              onSubmit={handleAssessmentSubmit}
              onClose={() => setActiveAssessment(null)}
              lastScore={activeAssessmentItem.latest_score}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
