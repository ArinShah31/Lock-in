import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { classroomsApi, practiceApi } from "../api";
import type {
  Classroom,
  MockExam,
  MockExamAttempt,
  MockExamQuestion,
  MockExamSection,
  PracticeAssessment,
  PracticeFlashcard,
  PracticeFlashcardDeck,
  PracticeAttempt,
  PracticeOverview,
  PracticeQuestion,
  PracticeQuiz,
  PracticeScenario,
} from "../api/types";
import {
  EmptyState,
  ErrorText,
  GhostButton,
  inputClass,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";
import { BloomBadge } from "../components/BloomBadge";

type PracticeSection = "quizzes" | "flashcards" | "scenarios" | "assessments";
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
    key: "scenarios",
    label: "Scenarios",
    description: "Apply classroom concepts to realistic case situations with guided MCQs.",
    icon: "psychology",
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
    description: "Mixed rounds and published mock exams across the classroom scope.",
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

function attemptCopy(score: number | null, kind: "quiz" | "scenario" | "assessment") {
  const label = kind === "quiz" ? "quiz" : kind === "scenario" ? "scenario" : "assessment";
  if (score == null) return `Your ${label} was submitted.`;
  if (score >= 75) return "Solid round. You can close this or retake to lock it in.";
  if (score >= 50) return "Decent start. Retake when you want a cleaner score.";
  return `Keep going. Retake this ${label} after a quick review.`;
}

function AttemptResultPanel({
  kind,
  title,
  score,
  onClose,
  onRetake,
}: {
  kind: "quiz" | "scenario" | "assessment";
  title: string;
  score: number | null;
  onClose: () => void;
  onRetake: () => void;
}) {
  const status = activityStatus(score);
  const heading =
    kind === "quiz" ? "Quiz submitted" : kind === "scenario" ? "Scenario submitted" : "Assessment submitted";
  const retakeLabel =
    kind === "quiz" ? "Retake quiz" : kind === "scenario" ? "Retake scenario" : "Retake assessment";

  return (
    <Panel className="space-y-5 border-[#d6e3ff] bg-[linear-gradient(135deg,#ffffff_0%,#f7fbff_100%)]">
      <div className="inline-flex items-center gap-2 rounded-full border border-[#d6e3ff] bg-[#eef4ff] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
        <span className="material-symbols-outlined text-[16px]">check_circle</span>
        {heading}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-display text-2xl font-extrabold text-[#031635]">{title}</h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#4b5563]">{attemptCopy(score, kind)}</p>
        </div>
        <div className="rounded-2xl border border-[#e1e3e4] bg-white px-5 py-4 text-center shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#75777f]">Score</p>
          <p className="mt-1 font-display text-4xl font-extrabold text-[#031635]">{formatScore(score)}</p>
          <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.className}`}>
            {status.label}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        <GhostButton onClick={onClose}>Back to list</GhostButton>
        <PrimaryButton onClick={onRetake}>{retakeLabel}</PrimaryButton>
      </div>
    </Panel>
  );
}

function questionSetKey(questions: PracticeQuestion[]) {
  return questions.map((question) => `${question.question}\0${(question.options ?? []).join("\0")}`).join("\n");
}

function looksLikeMarkup(text: string) {
  return /<\/?[a-z][\w:-]*[\s/>]/i.test(text) || /^[a-z][\w:-]*(?:\s[^<>]*)?>/i.test(text);
}

const VOID_TAGS = "img|br|hr|input|meta|link|area|base|col|embed|param|source|track|wbr";

function repairDroppedHtmlOpeners(text: string) {
  if (!text) return text;
  let current = text;
  for (let i = 0; i < 8; i += 1) {
    const paired = current.match(/(?<!<)([a-zA-Z][a-zA-Z0-9-]{0,24})((?:\s[^<>]*)?)>([\s\S]*?)<\/\1>/);
    if (paired && paired.index != null) {
      current =
        current.slice(0, paired.index) +
        `<${paired[1]}${paired[2] ?? ""}>${paired[3]}</${paired[1]}>` +
        current.slice(paired.index + paired[0].length);
      continue;
    }
    const voided = current.match(new RegExp(`(?<!<)(${VOID_TAGS})((?:\\s[^<>]*)?)>`, "i"));
    if (voided && voided.index != null) {
      current =
        current.slice(0, voided.index) +
        `<${voided[1]}${voided[2] ?? ""}>` +
        current.slice(voided.index + voided[0].length);
      continue;
    }
    break;
  }
  return current;
}

function PracticeOptionText({ text }: { text: string }) {
  const display = repairDroppedHtmlOpeners(text).replaceAll("<", "<\u200b");
  if (!looksLikeMarkup(text) && !looksLikeMarkup(display.replaceAll("\u200b", ""))) {
    return <span>{text}</span>;
  }
  return <code className="whitespace-pre-wrap break-words font-mono text-[13px] text-inherit">{display}</code>;
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
  const [selectedAnswers, setSelectedAnswers] = useState(() =>
    Array.from({ length: questions.length }, () => ""),
  );
  const questionsKey = questionSetKey(questions);
  const questionsKeyRef = useRef(questionsKey);

  useEffect(() => {
    if (questionsKeyRef.current === questionsKey) return;
    questionsKeyRef.current = questionsKey;
    setSelectedAnswers(Array.from({ length: questions.length }, () => ""));
  }, [questionsKey, questions.length]);

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
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#3f5d9b]">Question {index + 1}</p>
              <BloomBadge level={question.bloom_level} />
            </div>
            <p className="mt-3 font-display text-lg font-bold leading-8 text-[#031635]">
              <PracticeOptionText text={question.question} />
            </p>
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
                    <PracticeOptionText text={option} />
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
  emptyBody,
}: {
  decks: PracticeFlashcardDeck[];
  selectedDeckId: string;
  onSelectDeck: (deckId: string) => void;
  flippedIds: Set<string>;
  onToggleCard: (cardId: string) => void;
  onResetDeck: () => void;
  emptyBody?: string;
}) {
  if (!decks.length) {
    return (
      <EmptyState
        title="Flashcards will show up here"
        body={emptyBody ?? "Generate chapter assessments from classroom documents to unlock revision decks."}
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
                These decks are generated directly from your classroom documents.
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
  emptyBody,
}: {
  items: PracticeQuiz[];
  onOpen: (quiz: PracticeQuiz) => void;
  emptyBody?: string;
}) {
  if (!items.length) {
    return (
      <EmptyState
        title="Quizzes will appear here"
        body={
          emptyBody ??
          "Once classroom material is generated from uploaded documents, quick quizzes will light up here automatically."
        }
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

function ScenarioGrid({
  items,
  onOpen,
  emptyBody,
}: {
  items: PracticeScenario[];
  onOpen: (scenario: PracticeScenario) => void;
  emptyBody?: string;
}) {
  if (!items.length) {
    return (
      <EmptyState
        title="Scenarios will appear here"
        body={
          emptyBody ??
          "Once classroom material is generated, realistic case studies with five MCQs each will appear here automatically."
        }
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const status = activityStatus(item.latest_score);
        const preview =
          item.situation.length > 160 ? `${item.situation.slice(0, 160).trim()}…` : item.situation;
        return (
          <Panel key={item.id} className="flex h-full flex-col justify-between gap-4 p-0">
            <div className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
                    {item.chapter_title} · {item.question_count} questions
                  </p>
                  <h3 className="mt-2 font-display text-lg font-bold text-[#031635]">{item.title}</h3>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.className}`}>
                  {status.label}
                </span>
              </div>
              <p className="text-sm leading-6 text-[#44474e]">{preview}</p>
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
                <span>{item.latest_score == null ? "Start scenario" : "Retake scenario"}</span>
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function ScenarioRunner({
  scenario,
  buttonText,
  isSubmitting,
  onSubmit,
  onClose,
  lastScore,
}: {
  scenario: PracticeScenario;
  buttonText: string;
  isSubmitting: boolean;
  onSubmit: (answers: string[]) => Promise<void> | void;
  onClose: () => void;
  lastScore: number | null;
}) {
  return (
    <div className="space-y-5">
      <Panel className="space-y-4 border-[#d6e3ff] bg-[linear-gradient(135deg,#ffffff_0%,#f7fbff_100%)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#3f5d9b]">Case situation</p>
            <h3 className="mt-2 font-display text-2xl font-extrabold text-[#031635]">{scenario.title}</h3>
            <p className="mt-1 text-sm font-semibold text-[#5d6167]">{scenario.chapter_title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[#d6e3ff] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
              {scenario.question_count} questions
            </span>
            <span className="rounded-full border border-[#e1e3e4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#5d6167]">
              {formatScore(lastScore)}
            </span>
          </div>
        </div>
        <p className="text-sm leading-7 text-[#44474e]">{scenario.situation}</p>
      </Panel>

      <QuestionRunner
        title="Answer from the case"
        subtitle="Use the situation above to choose the best option for each question."
        questions={scenario.questions}
        buttonText={buttonText}
        isSubmitting={isSubmitting}
        onSubmit={onSubmit}
        onClose={onClose}
        lastScore={lastScore}
      />
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

function mockExamQuestionCount(exam: MockExam) {
  return (exam.paper?.sections ?? []).reduce((sum, section) => sum + (section.questions?.length ?? 0), 0);
}

function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function MockExamGrid({
  items,
  attemptsByExam,
  onOpen,
}: {
  items: MockExam[];
  attemptsByExam: Record<number, MockExamAttempt | undefined>;
  onOpen: (exam: MockExam) => void;
}) {
  if (!items.length) {
    return (
      <EmptyState
        title="No mock exams published yet"
        body="When your teacher publishes a mock exam from a previous-year paper pattern, it will appear here."
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((exam) => {
        const attempt = attemptsByExam[exam.id];
        const status =
          attempt == null
            ? { label: "Ready", className: "border-[#d6e3ff] bg-[#eef4ff] text-[#3f5d9b]" }
            : attempt.theory_status === "PENDING_REVIEW"
              ? { label: "Pending review", className: "border-[#ffe0b2] bg-[#fff4df] text-[#8a4f00]" }
              : { label: "Reviewed", className: "border-[#cfe9d5] bg-[#edf9ef] text-[#1f6a34]" };

        return (
          <Panel key={exam.id} className="flex h-full flex-col justify-between gap-4 border-[#c9d7ef] p-0">
            <div className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
                    Mock Exam · {exam.duration_minutes} mins
                  </p>
                  <h3 className="mt-2 font-display text-lg font-bold text-[#031635]">{exam.title}</h3>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.className}`}>
                  {status.label}
                </span>
              </div>
              <p className="text-sm leading-6 text-[#44474e]">
                Full paper built from your classroom syllabus and documents using the published exam pattern.
              </p>
            </div>
            <div className="space-y-3 border-t border-[#e1e3e4] px-5 py-4">
              <div className="flex items-center justify-between text-sm text-[#5d6167]">
                <span>
                  {mockExamQuestionCount(exam)} questions · {exam.total_marks} marks
                </span>
                <span className="font-semibold text-[#031635]">
                  {attempt?.total_score != null
                    ? `${attempt.total_score}/${exam.total_marks}`
                    : attempt
                      ? `MCQ ${attempt.mcq_score ?? 0}`
                      : "Not attempted"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpen(exam)}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[#031635] transition hover:text-[#3f5d9b]"
              >
                <span>{attempt ? "View result / retake" : "Start mock exam"}</span>
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function MockExamRunner({
  exam,
  onClose,
  onRetake,
  onSubmit,
  isSubmitting,
  result,
}: {
  exam: MockExam;
  onClose: () => void;
  onRetake: () => void;
  onSubmit: (answers: Record<string, string>) => Promise<void> | void;
  isSubmitting: boolean;
  result: MockExamAttempt | null;
}) {
  const sections = (exam.paper?.sections ?? []) as MockExamSection[];
  const questions = sections.flatMap((section) =>
    (section.questions ?? []).map((question) => ({
      ...question,
      section_title: question.section_title || section.title,
    })),
  ) as MockExamQuestion[];

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [secondsLeft, setSecondsLeft] = useState(exam.duration_minutes * 60);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(questions[0]?.id ?? null);
  const answersRef = useRef(answers);
  const submittedRef = useRef(false);
  const onSubmitRef = useRef(onSubmit);
  answersRef.current = answers;
  onSubmitRef.current = onSubmit;

  const answeredCount = Object.values(answers).filter((value) => value.trim()).length;
  const progress = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;

  useEffect(() => {
    setAnswers({});
    setSecondsLeft(exam.duration_minutes * 60);
    setConfirmSubmit(false);
    submittedRef.current = false;
    setActiveQuestionId(questions[0]?.id ?? null);
  }, [exam.id, exam.duration_minutes]);

  useEffect(() => {
    if (result) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          if (!submittedRef.current) {
            submittedRef.current = true;
            void onSubmitRef.current(answersRef.current);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [exam.id, result]);

  function scrollToQuestion(questionId: string) {
    setActiveQuestionId(questionId);
    const node = document.getElementById(`mock-question-${questionId}`);
    node?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-[#031635]/35 px-4 py-8 backdrop-blur-[2px]">
        <div className="mx-auto max-w-2xl rounded-2xl border border-[#e1e3e4] bg-white p-6 shadow-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d6e3ff] bg-[#eef4ff] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
            Mock exam submitted
          </div>
          <h3 className="mt-4 font-display text-2xl font-extrabold text-[#031635] sm:text-3xl">{exam.title}</h3>
          <p className="mt-2 text-sm text-[#44474e]">
            MCQs are scored now. Theory stays pending until your teacher reviews it.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">MCQ score</p>
              <p className="mt-2 font-display text-2xl font-extrabold text-[#031635]">{result.mcq_score ?? 0}</p>
            </div>
            <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Theory</p>
              <p className="mt-2 text-sm font-semibold text-[#031635]">
                {result.theory_status === "PENDING_REVIEW"
                  ? "Pending review"
                  : result.theory_score != null
                    ? String(result.theory_score)
                    : "Reviewed"}
              </p>
            </div>
            <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Total</p>
              <p className="mt-2 font-display text-2xl font-extrabold text-[#031635]">
                {result.total_score != null ? `${result.total_score}/${exam.total_marks}` : "Awaiting review"}
              </p>
            </div>
          </div>
          {result.feedback ? (
            <p className="mt-4 rounded-xl border border-[#d6e3ff] bg-[#f8fbff] px-4 py-3 text-sm leading-6 text-[#44474e]">
              Teacher feedback: {result.feedback}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <GhostButton onClick={onRetake}>Retake</GhostButton>
            <PrimaryButton onClick={onClose}>Back to Practice</PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f8f9fa]">
      <div className="sticky top-0 z-20 border-b border-[#e1e3e4] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">Mock exam in progress</p>
            <h3 className="truncate font-display text-lg font-extrabold text-[#031635] sm:text-xl">{exam.title}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[#d6e3ff] bg-[#eef4ff] px-3 py-1.5 text-xs font-semibold text-[#3f5d9b]">
              {answeredCount}/{questions.length} answered
            </span>
            <span
              className={`rounded-full border px-3 py-1.5 font-mono text-sm font-bold ${
                secondsLeft <= 60
                  ? "border-[#ffe0b2] bg-[#fff4df] text-[#8a4f00]"
                  : "border-[#e1e3e4] bg-[#f8f9fa] text-[#031635]"
              }`}
            >
              {formatCountdown(secondsLeft)}
            </span>
            <GhostButton onClick={onClose}>Exit</GhostButton>
            <PrimaryButton onClick={() => setConfirmSubmit(true)} disabled={isSubmitting}>
              {isSubmitting ? "Submitting…" : "Submit exam"}
            </PrimaryButton>
          </div>
        </div>
        <div className="h-1 w-full bg-[#eef2f6]">
          <div
            className="h-full bg-[#031635] transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-[88px] lg:self-start">
          <Panel className="space-y-3 p-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Paper map</p>
              <p className="mt-1 text-sm text-[#44474e]">
                {exam.total_marks} marks · {exam.duration_minutes} mins
              </p>
            </div>
            <div className="space-y-3">
              {sections.map((section) => (
                <div key={section.id} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#3f5d9b]">
                    {section.title || "Section"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(section.questions ?? []).map((question, index) => {
                      const answered = Boolean(answers[question.id]?.trim());
                      const active = activeQuestionId === question.id;
                      return (
                        <button
                          key={question.id || index}
                          type="button"
                          onClick={() => scrollToQuestion(question.id)}
                          className={`flex h-8 w-8 items-center justify-center rounded-md border text-xs font-bold transition ${
                            active
                              ? "border-[#031635] bg-[#031635] text-white"
                              : answered
                                ? "border-[#cfe9d5] bg-[#edf9ef] text-[#1f6a34]"
                                : "border-[#e1e3e4] bg-white text-[#5d6167] hover:border-[#9db2d1]"
                          }`}
                        >
                          {index + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </aside>

        <div className="space-y-5 pb-10">
          {exam.paper?.instructions ? (
            <Panel className="border-[#d6e3ff] bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_100%)]">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#3f5d9b]">Instructions</p>
              <p className="mt-2 text-sm leading-6 text-[#44474e]">{exam.paper.instructions}</p>
            </Panel>
          ) : null}

          {sections.map((section) => {
            const sectionQuestions = section.questions ?? [];
            const usesOrPairs =
              /or pair|q\d+\s+or\s+q\d+/i.test(section.instructions || "") && sectionQuestions.length >= 2;
            const groups: MockExamQuestion[][] = [];
            if (usesOrPairs) {
              for (let i = 0; i < sectionQuestions.length; i += 2) {
                groups.push(sectionQuestions.slice(i, i + 2));
              }
            } else {
              groups.push(...sectionQuestions.map((question) => [question]));
            }

            return (
              <Panel
                key={section.id}
                className="space-y-4 border-[#d6e3ff] bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_100%)]"
              >
                <div>
                  <h4 className="font-display text-xl font-extrabold text-[#031635]">{section.title}</h4>
                  {section.instructions ? (
                    <p className="mt-2 rounded-xl border border-[#dce7fa] bg-white px-4 py-3 text-sm leading-6 text-[#44474e]">
                      {section.instructions}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-4">
                  {groups.map((group, groupIndex) => (
                    <div
                      key={`${section.id}-group-${groupIndex}`}
                      className={
                        group.length > 1
                          ? "space-y-3 rounded-2xl border border-dashed border-[#c9d7ef] bg-white/70 p-3"
                          : "space-y-3"
                      }
                    >
                      {group.length > 1 ? (
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
                          Choice pair {groupIndex + 1} · answer either question
                        </p>
                      ) : null}
                      {group.map((question, indexInGroup) => {
                        const globalIndex =
                          sectionQuestions.findIndex((item) => item.id === question.id) + 1;
                        const isMcq = (question.question_type || "").toUpperCase() === "MCQ";
                        return (
                          <div key={question.id || `${groupIndex}-${indexInGroup}`}>
                            {group.length > 1 && indexInGroup === 1 ? (
                              <div className="my-2 flex items-center gap-3">
                                <div className="h-px flex-1 bg-[#e1e3e4]" />
                                <span className="rounded-full border border-[#e1e3e4] bg-[#f8f9fa] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#5d6167]">
                                  or
                                </span>
                                <div className="h-px flex-1 bg-[#e1e3e4]" />
                              </div>
                            ) : null}
                            <div
                              id={`mock-question-${question.id}`}
                              className="rounded-2xl border border-[#dfe4ea] bg-white px-5 py-5 shadow-sm"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-[#d6e3ff] bg-[#eef4ff] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
                                  Q{globalIndex}
                                </span>
                                <span className="rounded-full border border-[#e1e3e4] bg-[#f8f9fa] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5d6167]">
                                  {question.question_type}
                                </span>
                                <span className="rounded-full border border-[#e1e3e4] bg-[#f8f9fa] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5d6167]">
                                  {question.marks} marks
                                </span>
                              </div>
                              <p className="mt-3 whitespace-pre-wrap font-display text-lg font-bold leading-8 text-[#031635]">
                                {question.question}
                              </p>
                              {isMcq ? (
                                <div className="mt-4 grid gap-3 md:grid-cols-2">
                                  {(question.options ?? []).map((option) => {
                                    const checked = answers[question.id] === option;
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
                                          name={`mock-${question.id}`}
                                          checked={checked}
                                          onChange={() => {
                                            setActiveQuestionId(question.id);
                                            setAnswers((prev) => ({ ...prev, [question.id]: option }));
                                          }}
                                          className="mt-1 h-4 w-4 accent-[#031635]"
                                        />
                                        <PracticeOptionText text={option} />
                                      </label>
                                    );
                                  })}
                                </div>
                              ) : (
                                <textarea
                                  className={`${inputClass} mt-4 min-h-[140px]`}
                                  placeholder="Write your answer…"
                                  value={answers[question.id] ?? ""}
                                  onFocus={() => setActiveQuestionId(question.id)}
                                  onChange={(e) =>
                                    setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))
                                  }
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </Panel>
            );
          })}

          <div className="flex flex-wrap justify-end gap-3 border-t border-[#e1e3e4] pt-4">
            <GhostButton onClick={onClose}>Exit without submitting</GhostButton>
            <PrimaryButton onClick={() => setConfirmSubmit(true)} disabled={isSubmitting}>
              {isSubmitting ? "Submitting…" : "Submit exam"}
            </PrimaryButton>
          </div>
        </div>
      </div>

      {confirmSubmit ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#031635]/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-[#e1e3e4] bg-white p-5 shadow-xl">
            <h4 className="font-display text-xl font-extrabold text-[#031635]">Submit mock exam?</h4>
            <p className="mt-2 text-sm leading-6 text-[#44474e]">
              MCQs are scored immediately. Theory answers stay pending until your teacher reviews them.
              You have answered {answeredCount} of {questions.length} questions.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <GhostButton onClick={() => setConfirmSubmit(false)}>Keep editing</GhostButton>
              <PrimaryButton
                disabled={isSubmitting}
                onClick={() => {
                  setConfirmSubmit(false);
                  void onSubmit(answers);
                }}
              >
                Confirm submit
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PracticePage() {
  const { user, loading: authLoading } = useAuth();
  const [section, setSection] = useState<PracticeSection>("quizzes");
  const [assessmentSection, setAssessmentSection] = useState<AssessmentSection>("topic");
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [classroomId, setClassroomId] = useState<number | null>(null);
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [practice, setPractice] = useState<PracticeOverview | null>(null);
  const [mockExams, setMockExams] = useState<MockExam[]>([]);
  const [mockAttempts, setMockAttempts] = useState<Record<number, MockExamAttempt>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFlashcardDeckId, setSelectedFlashcardDeckId] = useState("");
  const [flippedFlashcards, setFlippedFlashcards] = useState<Set<string>>(new Set());
  const [activeQuizChapter, setActiveQuizChapter] = useState<number | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeAssessment, setActiveAssessment] = useState<{ kind: string; targetKey: string } | null>(null);
  const [activeMockExamId, setActiveMockExamId] = useState<number | null>(null);
  const [mockExamResult, setMockExamResult] = useState<MockExamAttempt | null>(null);
  const [attemptResult, setAttemptResult] = useState<{
    kind: "quiz" | "scenario" | "assessment";
    attempt: PracticeAttempt;
  } | null>(null);
  const runnerAnchorRef = useRef<HTMLDivElement | null>(null);
  const [submitState, setSubmitState] = useState<{
    kind: "quiz" | "scenario" | "assessment" | "mock";
    loading: boolean;
  } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (user?.role !== "STUDENT") {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadClassrooms() {
      setLoading(true);
      setError(null);
      try {
        const list = await classroomsApi.list();
        if (cancelled) return;
        setClassrooms(list);
        if (!list.length) {
          setClassroomId(null);
          setClassroom(null);
          setPractice(null);
          setMockExams([]);
          setMockAttempts({});
          setLoading(false);
          return;
        }

        const savedId = Number(localStorage.getItem("astra_practice_classroom_id") || "");
        const saved = list.find((item) => item.id === savedId) ?? null;

        // Prefer a remembered classroom; otherwise prefer one with published mock exams.
        let next = saved;
        if (!next) {
          const examLists = await Promise.all(
            list.map(async (item) => {
              try {
                const exams = await practiceApi.listMockExams(item.id);
                return { id: item.id, count: exams.length };
              } catch {
                return { id: item.id, count: 0 };
              }
            }),
          );
          const withMocks = examLists.find((item) => item.count > 0);
          next = list.find((item) => item.id === withMocks?.id) ?? list[0];
        }

        setClassroomId(next.id);
        localStorage.setItem("astra_practice_classroom_id", String(next.id));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load classrooms");
          setClassrooms([]);
          setClassroomId(null);
          setLoading(false);
        }
      }
    }

    void loadClassrooms();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, user?.role]);

  useEffect(() => {
    if (authLoading || user?.role !== "STUDENT" || classroomId == null) return;

    let cancelled = false;

    async function loadPractice() {
      setLoading(true);
      setError(null);
      setActiveQuizChapter(null);
      setActiveScenarioId(null);
      setActiveAssessment(null);
      setActiveMockExamId(null);
      setMockExamResult(null);
      setAttemptResult(null);
      try {
        const selected = classrooms.find((item) => item.id === classroomId) ?? null;
        const [overview, exams] = await Promise.all([
          practiceApi.get(classroomId),
          practiceApi.listMockExams(classroomId),
        ]);
        const attemptEntries = await Promise.all(
          exams.map(async (exam) => {
            try {
              const attempts = await practiceApi.listMockExamAttempts(classroomId, exam.id);
              return [exam.id, attempts[0]] as const;
            } catch {
              return [exam.id, undefined] as const;
            }
          }),
        );
        if (!cancelled) {
          setClassroom(selected);
          setPractice(overview);
          setMockExams(exams);
          setMockAttempts(
            Object.fromEntries(attemptEntries.filter((entry) => entry[1] != null)) as Record<number, MockExamAttempt>,
          );
          setSelectedFlashcardDeckId(overview.flashcard_decks[0]?.id ?? "");
          if (exams.length) {
            setSection("assessments");
            setAssessmentSection("subject");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load practice space");
          setPractice(null);
          setMockExams([]);
          setMockAttempts({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPractice();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.role, classroomId, classrooms]);

  useEffect(() => {
    if (practice?.generation_status !== "generating" || classroomId == null) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const overview = await practiceApi.get(classroomId);
          if (cancelled) return;
          setPractice(overview);
          if (!overview.flashcard_decks.some((deck) => deck.id === selectedFlashcardDeckId)) {
            setSelectedFlashcardDeckId(overview.flashcard_decks[0]?.id ?? "");
          }
        } catch {
          // Ignore transient polling errors; the user can refresh manually.
        }
      })();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [practice?.generation_status, classroomId, selectedFlashcardDeckId]);

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
  const activeScenario = useMemo(
    () => practice?.scenarios?.find((scenario) => scenario.id === activeScenarioId) ?? null,
    [practice?.scenarios, activeScenarioId],
  );
  const assessmentItems = assessmentSection === "topic" ? practice?.topic_assessments ?? [] : practice?.subject_assessments ?? [];
  const activeAssessmentItem = useMemo(
    () =>
      assessmentItems.find(
        (item) => item.assessment_kind === activeAssessment?.kind && item.target_key === activeAssessment?.targetKey,
      ) ?? null,
    [assessmentItems, activeAssessment],
  );

  useEffect(() => {
    if (activeQuizChapter == null && activeScenarioId == null && activeAssessment == null) return;
    const timer = window.setTimeout(() => {
      runnerAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activeQuizChapter, activeScenarioId, activeAssessment]);

  async function refreshPractice() {
    if (!classroom) return;
    const [overview, exams] = await Promise.all([
      practiceApi.get(classroom.id),
      practiceApi.listMockExams(classroom.id),
    ]);
    const attemptEntries = await Promise.all(
      exams.map(async (exam) => {
        try {
          const attempts = await practiceApi.listMockExamAttempts(classroom.id, exam.id);
          return [exam.id, attempts[0]] as const;
        } catch {
          return [exam.id, undefined] as const;
        }
      }),
    );
    setPractice(overview);
    setMockExams(exams);
    setMockAttempts(
      Object.fromEntries(attemptEntries.filter((entry) => entry[1] != null)) as Record<number, MockExamAttempt>,
    );
    if (!overview.flashcard_decks.some((deck) => deck.id === selectedFlashcardDeckId)) {
      setSelectedFlashcardDeckId(overview.flashcard_decks[0]?.id ?? "");
    }
  }

  const activeMockExam = useMemo(
    () => mockExams.find((exam) => exam.id === activeMockExamId) ?? null,
    [mockExams, activeMockExamId],
  );

  function handleClassroomChange(nextId: number) {
    setClassroomId(nextId);
    localStorage.setItem("astra_practice_classroom_id", String(nextId));
  }

  async function handleMockExamSubmit(answers: Record<string, string>) {
    if (!classroom || !activeMockExam) return;
    setSubmitState({ kind: "mock", loading: true });
    try {
      const attempt = await practiceApi.submitMockExam(classroom.id, activeMockExam.id, answers);
      setMockExamResult(attempt);
      setMockAttempts((prev) => ({ ...prev, [activeMockExam.id]: attempt }));
      await refreshPractice();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit mock exam");
    } finally {
      setSubmitState(null);
    }
  }

  async function handleQuizSubmit(selectedAnswers: string[]) {
    if (!classroom || !activeQuiz) return;
    setSubmitState({ kind: "quiz", loading: true });
    try {
      const attempt = await practiceApi.submitQuiz(classroom.id, activeQuiz.chapter_number, selectedAnswers);
      await refreshPractice();
      setActiveQuizChapter(activeQuiz.chapter_number);
      setAttemptResult({ kind: "quiz", attempt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit quiz");
    } finally {
      setSubmitState(null);
    }
  }

  async function handleScenarioSubmit(selectedAnswers: string[]) {
    if (!classroom || !activeScenario) return;
    setSubmitState({ kind: "scenario", loading: true });
    try {
      const attempt = await practiceApi.submitScenario(
        classroom.id,
        activeScenario.chapter_number,
        activeScenario.id,
        selectedAnswers,
      );
      await refreshPractice();
      setActiveScenarioId(activeScenario.id);
      setAttemptResult({ kind: "scenario", attempt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit scenario");
    } finally {
      setSubmitState(null);
    }
  }

  async function handleAssessmentSubmit(selectedAnswers: string[]) {
    if (!classroom || !activeAssessmentItem) return;
    setSubmitState({ kind: "assessment", loading: true });
    try {
      const attempt = await practiceApi.submitAssessment(
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
      setAttemptResult({ kind: "assessment", attempt });
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
  const practiceEmptyBody = practice?.generation_message ?? undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Practise"
        subtitle={`Generated from ${classroom.name} classroom documents so your revision stays within shared document context.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {classrooms.length > 1 ? (
              <label className="flex items-center gap-2 text-sm text-[#44474e]">
                <span className="whitespace-nowrap font-semibold">Classroom</span>
                <select
                  className="min-w-[200px] rounded-md border border-[#c5c6cf] bg-white px-3 py-2 text-sm text-[#191c1d] outline-none focus:border-[#031635] focus:ring-1 focus:ring-[#031635]"
                  value={classroom.id}
                  onChange={(event) => handleClassroomChange(Number(event.target.value))}
                >
                  {classrooms.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <SecondaryButton
              onClick={() => {
                if (mockExams.length) {
                  setSection("assessments");
                  setAssessmentSection("subject");
                } else if (practice?.quizzes.length) {
                  setSection("quizzes");
                  setActiveQuizChapter(practice.quizzes[0].chapter_number);
                } else if ((practice?.scenarios?.length ?? 0) > 0) {
                  setSection("scenarios");
                  setActiveScenarioId(practice?.scenarios?.[0]?.id ?? null);
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
          </div>
        }
      />

      <ErrorText message={error} />

      {practice?.generation_status === "generating" ? (
        <Panel className="border-[#bfd2f3] bg-[#eef4ff] px-4 py-3 text-sm text-[#3f5d9b]">
          {practice.generation_message ??
            "Practice content is being generated from your classroom material. Refresh in a moment."}
        </Panel>
      ) : null}

      {practice?.generation_status === "failed" && practice.generation_error ? (
        <Panel className="border-[#f2c9c9] bg-[#fff5f5] px-4 py-3 text-sm text-[#8b2f2f]">
          {practice.generation_error}
        </Panel>
      ) : null}

      <Panel className="overflow-hidden bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_55%,#eef4ff_100%)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d6e3ff] bg-white/80 px-3 py-1 text-xs font-semibold text-[#3f5d9b]">
              <span className="material-symbols-outlined text-sm">school</span>
              <span>{classroom.name} · Student revision workspace</span>
            </div>
            <h2 className="mt-4 font-display text-2xl font-extrabold text-[#031635]">Your daily practice lane</h2>
            <p className="mt-2 text-sm leading-6 text-[#44474e]">
              Classroom documents feed this space directly, so your revision, quizzes, flashcards, and assessment scope stay grounded in uploaded materials.
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#3f5d9b]">
              {practice?.source_document_count ?? 0} source documents connected
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-[#e1e3e4] bg-white/90 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Ready now</p>
              <p className="mt-2 font-display text-2xl font-extrabold text-[#031635]">{summary?.ready_quizzes ?? 0}</p>
            </div>
            <div className="rounded-xl border border-[#e1e3e4] bg-white/90 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Flash decks</p>
              <p className="mt-2 font-display text-2xl font-extrabold text-[#031635]">{summary?.flashcard_decks ?? 0}</p>
            </div>
            <div className="rounded-xl border border-[#e1e3e4] bg-white/90 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Scenarios</p>
              <p className="mt-2 font-display text-2xl font-extrabold text-[#031635]">{summary?.ready_scenarios ?? 0}</p>
            </div>
            <div className="rounded-xl border border-[#e1e3e4] bg-white/90 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#75777f]">Locked assessments</p>
              <p className="mt-2 font-display text-2xl font-extrabold text-[#031635]">{summary?.locked_assessments ?? 0}</p>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
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
                Topic assessments stay locked until your class teacher opens them. Subject assessments include mixed
                rounds and published mock exams for this classroom
                {mockExams.length ? ` (${mockExams.length} mock exam${mockExams.length === 1 ? "" : "s"} ready)` : ""}.
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
              emptyBody={practiceEmptyBody}
              onOpen={(quiz) => {
                setAttemptResult(null);
                setActiveQuizChapter(quiz.chapter_number);
                setActiveScenarioId(null);
                setActiveAssessment(null);
              }}
            />
          </AnimatedSwitchContent>
          {activeQuiz ? (
            <div ref={runnerAnchorRef} className="scroll-mt-24">
              {attemptResult?.kind === "quiz" ? (
                <AttemptResultPanel
                  kind="quiz"
                  title={activeQuiz.title}
                  score={attemptResult.attempt.score}
                  onClose={() => {
                    setActiveQuizChapter(null);
                    setAttemptResult(null);
                  }}
                  onRetake={() => setAttemptResult(null)}
                />
              ) : (
                <QuestionRunner
                  key={activeQuiz.chapter_number}
                  title={activeQuiz.title}
                  subtitle={activeQuiz.summary || `Generated from ${classroom.name} classroom material for focused recall.`}
                  questions={activeQuiz.questions}
                  buttonText="Submit quiz"
                  isSubmitting={submitState?.kind === "quiz" && submitState.loading}
                  onSubmit={handleQuizSubmit}
                  onClose={() => {
                    setActiveQuizChapter(null);
                    setAttemptResult(null);
                  }}
                  lastScore={
                    practice?.quizzes.find((item) => item.chapter_number === activeQuiz.chapter_number)?.latest_score ??
                    null
                  }
                />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {section === "scenarios" ? (
        <div className="space-y-6">
          <AnimatedSwitchContent motionKey="practice-scenarios">
            <ScenarioGrid
              items={practice?.scenarios ?? []}
              emptyBody={practiceEmptyBody}
              onOpen={(scenario) => {
                setAttemptResult(null);
                setActiveScenarioId(scenario.id);
                setActiveQuizChapter(null);
                setActiveAssessment(null);
              }}
            />
          </AnimatedSwitchContent>
          {activeScenario ? (
            <div ref={runnerAnchorRef} className="scroll-mt-24">
              {attemptResult?.kind === "scenario" ? (
                <AttemptResultPanel
                  kind="scenario"
                  title={activeScenario.title}
                  score={attemptResult.attempt.score}
                  onClose={() => {
                    setActiveScenarioId(null);
                    setAttemptResult(null);
                  }}
                  onRetake={() => setAttemptResult(null)}
                />
              ) : (
                <ScenarioRunner
                  key={activeScenario.id}
                  scenario={activeScenario}
                  buttonText="Submit scenario"
                  isSubmitting={submitState?.kind === "scenario" && submitState.loading}
                  onSubmit={handleScenarioSubmit}
                  onClose={() => {
                    setActiveScenarioId(null);
                    setAttemptResult(null);
                  }}
                  lastScore={
                    practice?.scenarios?.find((item) => item.id === activeScenario.id)?.latest_score ?? null
                  }
                />
              )}
            </div>
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
          emptyBody={practiceEmptyBody}
        />
      ) : null}

      {section === "assessments" ? (
        <div className="space-y-6">
          <AnimatedSwitchContent motionKey={`practice-assessments-${assessmentSection}`}>
            <div className="space-y-8">
              {assessmentSection === "subject" ? (
                <div className="space-y-3">
                  <div>
                    <h3 className="font-display text-lg font-bold text-[#031635]">Mock Exams</h3>
                    <p className="text-sm text-[#44474e]">
                      Published classroom mock papers with timed attempt, instant MCQ scoring, and teacher theory review.
                    </p>
                  </div>
                  <MockExamGrid
                    items={mockExams}
                    attemptsByExam={mockAttempts}
                    onOpen={(exam) => {
                      setActiveMockExamId(exam.id);
                      setMockExamResult(mockAttempts[exam.id] ?? null);
                      setActiveAssessment(null);
                      setActiveQuizChapter(null);
                    }}
                  />
                </div>
              ) : null}
              <AssessmentGrid
                items={assessmentItems}
                onOpen={(assessment) => {
                  setAttemptResult(null);
                  setActiveAssessment({
                    kind: assessment.assessment_kind,
                    targetKey: assessment.target_key,
                  });
                  setActiveQuizChapter(null);
                  setActiveMockExamId(null);
                  setMockExamResult(null);
                }}
              />
            </div>
          </AnimatedSwitchContent>
          {activeAssessmentItem && !activeAssessmentItem.is_locked ? (
            <div ref={runnerAnchorRef} className="scroll-mt-24">
              {attemptResult?.kind === "assessment" ? (
                <AttemptResultPanel
                  kind="assessment"
                  title={activeAssessmentItem.title}
                  score={attemptResult.attempt.score}
                  onClose={() => {
                    setActiveAssessment(null);
                    setAttemptResult(null);
                  }}
                  onRetake={() => setAttemptResult(null)}
                />
              ) : (
                <QuestionRunner
                  key={`${activeAssessmentItem.assessment_kind}-${activeAssessmentItem.target_key}`}
                  title={activeAssessmentItem.title}
                  subtitle={activeAssessmentItem.detail}
                  questions={activeAssessmentItem.questions}
                  buttonText="Submit assessment"
                  isSubmitting={submitState?.kind === "assessment" && submitState.loading}
                  onSubmit={handleAssessmentSubmit}
                  onClose={() => {
                    setActiveAssessment(null);
                    setAttemptResult(null);
                  }}
                  lastScore={activeAssessmentItem.latest_score}
                />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeMockExam ? (
        <MockExamRunner
          exam={activeMockExam}
          result={mockExamResult}
          isSubmitting={submitState?.kind === "mock" && submitState.loading}
          onSubmit={handleMockExamSubmit}
          onRetake={() => setMockExamResult(null)}
          onClose={() => {
            setActiveMockExamId(null);
            setMockExamResult(null);
          }}
        />
      ) : null}
    </div>
  );
}
