import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useStudentNotifications } from "../hooks/useStudentNotifications";
import { useTeacherNotifications } from "../hooks/useTeacherNotifications";

type BellItem = {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  to: string;
};

function kindIcon(kind: string) {
  switch (kind) {
    case "join_request":
    case "join_pending":
      return "person_add";
    case "join_approved":
      return "check_circle";
    case "join_rejected":
      return "cancel";
    case "new_assignment":
      return "assignment_add";
    case "graded":
      return "grading";
    case "ungraded":
      return "assignment";
    default:
      return "notifications";
  }
}

export function NotificationBell({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isStudent = user?.role === "STUDENT";
  const teacher = useTeacherNotifications();
  const student = useStudentNotifications();

  const enabled = isStudent ? student.enabled : teacher.enabled;
  const items: BellItem[] = isStudent ? student.items : teacher.items;
  const count = isStudent ? student.count : teacher.count;
  const loading = isStudent ? student.loading : teacher.loading;
  const emptyForRole = !enabled;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onSelect(item: BellItem) {
    setOpen(false);
    navigate(item.to);
  }

  const buttonClass = compact
    ? "relative flex size-9 items-center justify-center rounded-full text-[#44474e] transition hover:bg-[#f3f4f5] hover:text-[#031635]"
    : "relative flex size-9 items-center justify-center rounded-full border border-[#e1e3e4] bg-[#f8f9fa] text-[#44474e] transition hover:bg-white hover:text-[#031635]";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title={count ? `${count} notification${count === 1 ? "" : "s"}` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={buttonClass}
      >
        <span className="material-symbols-outlined text-xl">notifications</span>
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ba1a1a] px-1 text-[10px] font-bold leading-none text-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[#e1e3e4] bg-white shadow-[0_12px_40px_rgba(3,22,53,0.14)]"
        >
          <div className="flex items-center justify-between border-b border-[#eef1f4] px-3.5 py-2.5">
            <p className="text-sm font-semibold text-[#031635]">Notifications</p>
            {loading ? <span className="text-[11px] text-[#75777f]">Updating…</span> : null}
          </div>

          {emptyForRole ? (
            <p className="px-3.5 py-6 text-center text-sm text-[#75777f]">
              No classroom alerts for your role.
            </p>
          ) : items.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-sm text-[#75777f]">You&apos;re all caught up</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-[#f3f4f5]"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e8edf5] text-[#031635]">
                      <span className="material-symbols-outlined text-[18px]">{kindIcon(item.kind)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[#191c1d]">{item.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-[#75777f]">{item.subtitle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
