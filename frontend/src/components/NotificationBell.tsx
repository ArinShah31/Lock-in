import { useEffect, useMemo, useRef, useState } from "react";
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
    case "announcement":
      return "campaign";
    default:
      return "notifications";
  }
}

function seenStorageKey(userId: number) {
  return `astra-notifications-seen:${userId}`;
}

function loadSeenIds(userId: number): Set<string> {
  try {
    const raw = localStorage.getItem(seenStorageKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function saveSeenIds(userId: number, ids: Set<string>) {
  try {
    localStorage.setItem(seenStorageKey(userId), JSON.stringify([...ids]));
  } catch {
    /* ignore quota / private mode */
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
  const loading = isStudent ? student.loading : teacher.loading;
  const emptyForRole = !enabled;

  const [open, setOpen] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(() =>
    user?.id ? loadSeenIds(user.id) : new Set(),
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSeenIds(user?.id ? loadSeenIds(user.id) : new Set());
  }, [user?.id]);

  const unreadCount = useMemo(() => {
    if (!items.length) return 0;
    return items.reduce((n, item) => n + (seenIds.has(item.id) ? 0 : 1), 0);
  }, [items, seenIds]);

  function markItemsSeen(ids: string[]) {
    if (!user?.id || !ids.length) return;
    setSeenIds((prev) => {
      const live = new Set(items.map((item) => item.id));
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
      }
      for (const id of ids) next.add(id);
      saveSeenIds(user.id, next);
      return next;
    });
  }

  function toggleOpen() {
    setOpen((wasOpen) => {
      const willOpen = !wasOpen;
      if (willOpen || wasOpen) {
        // Opening or closing after viewing → clear the red badge.
        markItemsSeen(items.map((item) => item.id));
      }
      return willOpen;
    });
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        markItemsSeen(items.map((item) => item.id));
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        markItemsSeen(items.map((item) => item.id));
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, items, user?.id]);

  function onSelect(item: BellItem) {
    markItemsSeen([item.id]);
    if (!item.to) {
      return;
    }
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
        title={
          unreadCount
            ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
            : "Notifications"
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggleOpen}
        className={buttonClass}
      >
        <span className="material-symbols-outlined text-xl">notifications</span>
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ba1a1a] px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
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
              {items.map((item) => {
                const unread = !seenIds.has(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-[#f3f4f5] ${
                        unread ? "bg-[#f8fbff]" : ""
                      }`}
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e8edf5] text-[#031635]">
                        <span className="material-symbols-outlined text-[18px]">{kindIcon(item.kind)}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="block text-sm font-medium text-[#191c1d]">{item.title}</span>
                          {unread ? (
                            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#ba1a1a]" aria-hidden />
                          ) : null}
                        </span>
                        <span
                          className={`mt-0.5 block text-xs text-[#75777f] ${
                            item.kind === "announcement"
                              ? "whitespace-pre-wrap line-clamp-6"
                              : "truncate"
                          }`}
                        >
                          {item.subtitle}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
