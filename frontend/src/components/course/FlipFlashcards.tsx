import { useState } from "react";
import type { Flashcard } from "../../api/types";

export function FlipFlashcards({ cards }: { cards: Flashcard[] }) {
  if (!cards.length) {
    return <p className="text-sm text-mist">No flashcards for this chapter yet.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map((card, index) => (
        <FlipCard key={`${card.question}-${index}`} card={card} />
      ))}
    </div>
  );
}

function FlipCard({ card }: { card: Flashcard }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setFlipped((v) => !v)}
      className="flex min-h-[180px] flex-col rounded-2xl border border-line bg-ink-soft/50 p-5 text-left transition hover:border-accent/40"
    >
      <p className="text-[10px] uppercase tracking-[0.14em] text-mist">
        {flipped ? "Answer" : "Question"} · tap to flip
      </p>
      <p className="mt-4 flex-1 text-base leading-relaxed text-paper">
        {flipped ? card.answer : card.question}
      </p>
      <p className="mt-4 text-xs text-mist">{card.topic}</p>
    </button>
  );
}
