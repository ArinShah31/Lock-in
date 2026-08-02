import { useMemo, useState } from "react";
import type { QuizQuestion } from "../../api/types";
import { PrimaryButton } from "../ui";

type Props = {
  questions: QuizQuestion[];
  onSubmit?: (selectedAnswers: string[]) => Promise<void> | void;
};

export function McqQuiz({ questions, onSubmit }: Props) {
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const score = useMemo(() => {
    if (!checked) return null;
    const correct = questions.filter((q, i) => selected[i] === q.correct_answer).length;
    return { correct, total: questions.length };
  }, [checked, questions, selected]);

  if (!questions.length) {
    return <p className="text-sm text-mist">No quiz questions for this chapter yet.</p>;
  }

  return (
    <div className="space-y-5">
      {questions.map((question, index) => {
        const choice = selected[index];
        return (
          <div key={`${question.question}-${index}`} className="rounded-2xl border border-line bg-ink-soft/40 p-5">
            <p className="font-medium leading-relaxed text-paper">
              Q{index + 1}. {question.question}
            </p>
            <div className="mt-4 space-y-2.5">
              {question.options.map((option) => {
                const isSelected = choice === option;
                const isCorrect = checked && option === question.correct_answer;
                const isWrong = checked && isSelected && option !== question.correct_answer;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={checked}
                    onClick={() => setSelected((prev) => ({ ...prev, [index]: option }))}
                    className={`block w-full rounded-xl border px-3.5 py-2.5 text-left text-sm leading-relaxed ${
                      isCorrect
                        ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-100"
                        : isWrong
                          ? "border-red-400/50 bg-red-500/10 text-red-100"
                          : isSelected
                            ? "border-accent/50 bg-accent/10 text-paper"
                            : "border-line text-mist hover:border-accent/30"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            {checked ? <p className="mt-3 text-sm leading-relaxed text-mist">{question.explanation}</p> : null}
          </div>
        );
      })}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line/60 bg-panel/90 py-4 backdrop-blur">
        <PrimaryButton
          disabled={busy || Object.keys(selected).length < questions.length}
          onClick={async () => {
            setChecked(true);
            if (!onSubmit) return;
            setBusy(true);
            try {
              const answers = questions.map((_, i) => selected[i] ?? "");
              await onSubmit(answers);
            } finally {
              setBusy(false);
            }
          }}
        >
          {checked ? "Checked" : busy ? "Submitting…" : "Check answers"}
        </PrimaryButton>
        {score ? (
          <p className="text-sm text-mist">
            Score: {score.correct}/{score.total}
          </p>
        ) : (
          <p className="text-sm text-mist">
            Answered {Object.keys(selected).length}/{questions.length}
          </p>
        )}
      </div>
    </div>
  );
}
