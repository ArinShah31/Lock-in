/** Assignments due within this window trigger "due soon" reminders. */
export const DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;

/** How long past its deadline an unsubmitted assignment keeps showing as overdue. */
export const OVERDUE_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

export type DueState = "due_soon" | "overdue" | "later" | "old";

/** Where an assignment's due date sits relative to `now`. Invalid dates count as "later". */
export function dueState(dueIso: string, now = Date.now()): DueState {
  const due = new Date(dueIso).getTime();
  if (Number.isNaN(due)) return "later";
  const diff = due - now;
  if (diff < -OVERDUE_NOTICE_MS) return "old";
  if (diff < 0) return "overdue";
  if (diff <= DUE_SOON_WINDOW_MS) return "due_soon";
  return "later";
}

/** "45 minutes", "5 hours", "2 days" — a duration, always non-negative. */
export function formatDuration(ms: number): string {
  const mins = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** "in 5 hours" / "2 days ago". */
export function formatDueIn(dueIso: string, now = Date.now()): string {
  const diff = new Date(dueIso).getTime() - now;
  return diff < 0 ? `${formatDuration(diff)} ago` : `in ${formatDuration(diff)}`;
}
