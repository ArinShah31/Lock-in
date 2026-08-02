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
  return (
    <div className="rounded-3xl border border-line bg-[radial-gradient(circle_at_15%_0%,rgba(62,207,191,0.14),transparent_40%),linear-gradient(180deg,#0b1726,#102033_50%,#0a1420)] p-5 md:p-7">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-mist">Learning path</p>
          <p className="mt-1 font-display text-xl text-paper">Chapter map</p>
        </div>
        <p className="rounded-full border border-line/80 bg-ink/40 px-3 py-1 text-xs text-mist">
          Current chapter {currentChapter}
        </p>
      </div>

      <ol className="relative space-y-6 md:space-y-8">
        <div
          aria-hidden
          className="absolute bottom-4 left-[19px] top-4 w-px bg-gradient-to-b from-accent/70 via-line to-line/40 md:left-[23px]"
        />

        {chapters.map((chapter) => {
          const locked = chapter.is_locked_for_viewer || !chapter.is_unlocked;
          const active = selectedChapter === chapter.chapter || chapter.is_current;

          return (
            <li key={chapter.chapter} className="relative flex gap-4 md:gap-5">
              <div
                className={`relative z-10 mt-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold md:h-12 md:w-12 ${
                  locked
                    ? "border-line bg-ink text-mist"
                    : chapter.is_current
                      ? "border-accent bg-accent text-ink"
                      : active
                        ? "border-accent bg-accent/20 text-paper"
                        : "border-accent/50 bg-ink-soft text-paper"
                }`}
              >
                {locked ? "🔒" : chapter.chapter}
              </div>

              <div
                className={`min-w-0 flex-1 rounded-2xl border px-4 py-4 transition md:px-5 md:py-5 ${
                  active
                    ? "border-accent/60 bg-accent/10 shadow-[0_0_28px_rgba(62,207,191,0.12)]"
                    : locked
                      ? "border-line/50 bg-ink-soft/30 opacity-75"
                      : "border-line bg-panel/70 hover:border-accent/35"
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
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 pr-2">
                      <p className="text-xs uppercase tracking-[0.14em] text-mist">
                        Chapter {chapter.chapter}
                      </p>
                      <p className="mt-2 font-display text-lg leading-snug text-paper md:text-xl">
                        {chapter.title}
                      </p>
                      <p className="mt-2 text-sm text-mist">{chapter.timeline || "Timeline TBD"}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[10px] uppercase tracking-wide text-mist">
                      {locked ? "Locked" : chapter.is_current ? "Current" : "Open"}
                    </span>
                  </div>
                </button>

                {!chapter.is_locked_for_viewer && onOpenNotes ? (
                  <div className="mt-4 border-t border-line/60 pt-4">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenNotes(chapter.chapter);
                      }}
                      className="rounded-xl border border-accent/40 px-3 py-2 text-sm text-accent transition hover:bg-accent/10"
                    >
                      Open notes
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
