import { useMemo } from "react";
import { GhostButton } from "./ui";

export type CalendarAssignmentItem = {
  id: number;
  title: string;
  due_at: string;
};

function formatDueDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function AssignmentsCalendar({
  items,
  onSelect,
  onClose,
  title = "Assignment calendar",
  subtitle = "Due dates for this classroom",
}: {
  items: CalendarAssignmentItem[];
  onSelect: (id: number) => void;
  onClose: () => void;
  title?: string;
  subtitle?: string;
}) {
  const sorted = useMemo(
    () => [...items].sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()),
    [items],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarAssignmentItem[]>();
    for (const a of sorted) {
      const key = formatDueDateShort(a.due_at);
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [sorted]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="rounded-2xl border border-[#e1e3e4] bg-white p-5 shadow-xs">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-bold text-[#031635]">{title}</h3>
          <p className="text-sm text-[#75777f]">{subtitle}</p>
        </div>
        <GhostButton onClick={onClose}>Close</GhostButton>
      </div>
      {!sorted.length ? (
        <p className="text-sm text-[#75777f]">No assignments to show.</p>
      ) : (
        <ul className="space-y-4">
          {grouped.map(([dateLabel, dayItems]) => {
            const dueDate = new Date(dayItems[0].due_at);
            dueDate.setHours(0, 0, 0, 0);
            const isOverdue = dueDate.getTime() < today.getTime();
            const isToday = dueDate.getTime() === today.getTime();

            return (
              <li key={dateLabel}>
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`material-symbols-outlined text-base ${
                      isOverdue ? "text-[#dc2626]" : isToday ? "text-[#6366f1]" : "text-[#75777f]"
                    }`}
                  >
                    event
                  </span>
                  <span
                    className={`text-sm font-semibold ${
                      isOverdue ? "text-[#dc2626]" : isToday ? "text-[#6366f1]" : "text-[#031635]"
                    }`}
                  >
                    {dateLabel}
                    {isToday ? " (Today)" : null}
                    {isOverdue ? " (Overdue)" : null}
                  </span>
                </div>
                <ul className="space-y-2 pl-6">
                  {dayItems.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(a.id)}
                        className="flex w-full items-center justify-between rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] px-3 py-2 text-left text-sm transition hover:border-[#6366f1]/40 hover:bg-white"
                      >
                        <span className="font-medium text-[#031635]">{a.title}</span>
                        <span className="text-xs text-[#75777f]">
                          {new Date(a.due_at).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
