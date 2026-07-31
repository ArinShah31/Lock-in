import type { LearningChapter } from "../../api/types";

type Props = {
  chapters: LearningChapter[];
  currentChapter: number;
  selectedChapter: number | null;
  onSelect: (chapter: number) => void;
  onOpenNotes?: (chapter: number) => void;
};

export function InteractiveRoadmap({
  chapters,
  currentChapter,
  selectedChapter,
  onSelect,
  onOpenNotes,
}: Props) {
  const focusIndex = Math.max(
    0,
    chapters.findIndex((c) => c.chapter === (selectedChapter ?? currentChapter)),
  );
  const offsetY = Math.max(0, focusIndex * 140 - 80);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-[radial-gradient(circle_at_20%_10%,rgba(62,207,191,0.18),transparent_35%),linear-gradient(180deg,#0b1726,#102033_45%,#0a1420)]">
      <div className="px-4 pt-4 text-sm text-mist">
        Learning path · current chapter {currentChapter}
      </div>
      <div className="relative h-[520px] overflow-hidden">
        <div
          className="absolute inset-x-0 transition-transform duration-500 ease-out"
          style={{ transform: `translateY(${-offsetY}px)` }}
        >
          <svg className="absolute left-1/2 top-8 h-[calc(100%+80px)] w-24 -translate-x-1/2" viewBox="0 0 96 900" fill="none">
            <path
              d="M48 0 C 10 80, 86 140, 48 220 C 10 300, 86 360, 48 440 C 10 520, 86 580, 48 660 C 10 740, 86 800, 48 900"
              stroke="rgba(148,163,184,0.45)"
              strokeWidth="18"
              strokeLinecap="round"
            />
            <path
              d="M48 0 C 10 80, 86 140, 48 220 C 10 300, 86 360, 48 440 C 10 520, 86 580, 48 660 C 10 740, 86 800, 48 900"
              stroke="rgba(62,207,191,0.85)"
              strokeWidth="3"
              strokeDasharray="10 12"
              strokeLinecap="round"
            />
          </svg>

          <div className="relative z-10 space-y-8 px-4 py-8">
            {chapters.map((chapter, index) => {
              const side = index % 2 === 0 ? "left" : "right";
              const locked = chapter.is_locked_for_viewer || !chapter.is_unlocked;
              const active = selectedChapter === chapter.chapter || chapter.is_current;
              return (
                <div key={chapter.chapter} className="relative flex min-h-[120px] items-center justify-center">
                  <div
                    className={`absolute ${side === "left" ? "left-2 md:left-8" : "right-2 md:right-8"} w-[min(100%,260px)] rounded-2xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-accent/60 bg-accent/15 shadow-[0_0_30px_rgba(62,207,191,0.2)]"
                        : locked
                          ? "border-line/60 bg-ink-soft/50 opacity-70"
                          : "border-line bg-panel/80 hover:border-accent/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (chapter.is_locked_for_viewer) return;
                        onSelect(chapter.chapter);
                      }}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-mist">Chapter {chapter.chapter}</p>
                          <p className="mt-1 font-display text-lg text-paper">{chapter.title}</p>
                          <p className="mt-1 text-xs text-mist">{chapter.timeline || "Timeline TBD"}</p>
                        </div>
                        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-mist">
                          {locked ? "Locked" : chapter.is_current ? "Current" : "Open"}
                        </span>
                      </div>
                    </button>
                    {!chapter.is_locked_for_viewer && onOpenNotes ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenNotes(chapter.chapter);
                        }}
                        className="mt-2 rounded-lg border border-accent/40 px-2 py-1 text-xs text-accent hover:bg-accent/10"
                      >
                        Open notes
                      </button>
                    ) : null}
                  </div>
                  <div
                    className={`z-20 flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold ${
                      locked
                        ? "border-line bg-ink text-mist"
                        : chapter.is_current
                          ? "border-accent bg-accent text-ink"
                          : "border-accent/50 bg-ink-soft text-paper"
                    }`}
                  >
                    {locked ? "🔒" : chapter.chapter}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
