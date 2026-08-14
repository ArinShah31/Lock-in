import { bloomBadgeClass, bloomDifficulty, bloomLabel } from "../lib/bloom";

export function BloomBadge({ level }: { level?: string | null }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${bloomBadgeClass(level)}`}
      title={`Bloom level: ${bloomLabel(level)} (${bloomDifficulty(level)} difficulty)`}
    >
      {bloomLabel(level)} · {bloomDifficulty(level)}
    </span>
  );
}
