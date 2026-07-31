import { useState } from "react";
import type { Assessment } from "../../api/types";
import { Field, inputClass, PrimaryButton } from "../ui";

type Props = {
  assessment: Assessment | null;
  onSubmit?: (answers: string[]) => Promise<void> | void;
};

export function ShortAssessment({ assessment, onSubmit }: Props) {
  const prompts = assessment?.prompts?.length
    ? assessment.prompts
    : assessment
      ? [{ prompt: assessment.instructions }]
      : [];
  const [answers, setAnswers] = useState<string[]>(() => prompts.map(() => ""));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!assessment) {
    return <p className="text-sm text-mist">No assessment for this chapter yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-ink-soft/40 p-4">
        <p className="font-medium text-paper">{assessment.title}</p>
        <p className="mt-1 text-sm text-mist">{assessment.instructions}</p>
        <p className="mt-2 text-xs text-mist">Estimated {assessment.estimated_minutes} minutes</p>
        {assessment.rubric?.length ? (
          <p className="mt-2 text-xs text-mist">Rubric: {assessment.rubric.join(" · ")}</p>
        ) : null}
      </div>

      {prompts.map((item, index) => (
        <Field key={`${item.prompt}-${index}`} label={`Prompt ${index + 1}`}>
          <p className="mb-2 text-sm text-paper">{item.prompt}</p>
          <textarea
            className={inputClass}
            rows={3}
            value={answers[index] ?? ""}
            disabled={submitted}
            onChange={(e) =>
              setAnswers((prev) => {
                const next = [...prev];
                next[index] = e.target.value;
                return next;
              })
            }
          />
        </Field>
      ))}

      <PrimaryButton
        disabled={busy || submitted || answers.some((a) => !a.trim())}
        onClick={async () => {
          setBusy(true);
          try {
            await onSubmit?.(answers);
            setSubmitted(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {submitted ? "Submitted" : busy ? "Submitting…" : "Submit short test"}
      </PrimaryButton>
      {submitted ? (
        <p className="text-sm text-mist">Submitted. Your teacher can review this attempt.</p>
      ) : null}
    </div>
  );
}
