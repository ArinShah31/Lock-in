import type { FormEvent, ReactNode } from "react";
import { motion } from "framer-motion";

export function PageHeader({
  title,
  subtitle,
  action,
  serif = false,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Use the display-serif treatment for identity-level headings (e.g. a classroom name). Sparingly. */
  serif?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1
          className={`text-2xl md:text-3xl font-extrabold text-[#031635] tracking-tight ${
            serif ? "font-serif" : "font-display"
          }`}
        >
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-sm text-[#44474e] max-w-2xl">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`group relative rounded-xl border border-[#e1e3e4] bg-white p-5 shadow-[0_1px_2px_rgba(3,22,53,0.04),0_4px_16px_rgba(3,22,53,0.05)] transition-[box-shadow,border-color] duration-200 ease-out hover:shadow-[0_2px_4px_rgba(3,22,53,0.06),0_8px_28px_rgba(3,22,53,0.09)] ${className}`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-r from-[#031635]/40 via-[#4f46e5]/40 to-[#3f5d9b]/40 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
        style={{
          padding: 1,
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      />
      {children}
    </section>
  );
}

/**
 * A single animated indicator meant to be conditionally rendered inside whichever
 * tab/nav item is currently active. Position it with `absolute` from the caller;
 * framer-motion animates it between positions via the shared `layoutId`.
 */
export function SlidingIndicator({ layoutId, className = "" }: { layoutId: string; className?: string }) {
  return (
    <motion.span
      layoutId={layoutId}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className={className}
    />
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-[#44474e]">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-[#c5c6cf] bg-[#f8f9fa] px-3.5 py-2.5 text-sm text-[#191c1d] outline-none transition placeholder:text-[#75777f] focus:border-[#031635] focus:bg-white focus:ring-1 focus:ring-[#031635]";

export function PrimaryButton({
  children,
  type = "button",
  disabled,
  onClick,
}: {
  children: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-md bg-[#031635] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#1a2b4b] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  type = "button",
  disabled,
  onClick,
}: {
  children: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-md border border-[#3f5d9b] bg-transparent px-4 py-2.5 text-sm font-semibold text-[#3f5d9b] transition hover:bg-[#3f5d9b]/10 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-md border border-[#e1e3e4] bg-white px-4 py-2.5 text-sm font-medium text-[#44474e] transition hover:bg-[#f3f4f5] hover:text-[#191c1d] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function JobProgress({
  message,
  fallback = "Working…",
}: {
  message?: string | null;
  fallback?: string;
}) {
  const text = (message || "").trim() || fallback;
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  const current = match ? Number(match[1]) : 0;
  const total = match ? Number(match[2]) : 0;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null;

  return (
    <div>
      <p className="text-sm text-[#44474e]">{text}</p>
      {pct !== null ? (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e1e3e4]">
            <div className="h-full rounded-full bg-[#031635] transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-[11px] font-medium text-[#75777f]">{pct}%</p>
        </>
      ) : (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e1e3e4]">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-[#9bb0d4]" />
        </div>
      )}
    </div>
  );
}

export function ErrorText({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="mb-4 rounded-md border border-[#ba1a1a]/30 bg-[#ffdad6]/50 px-3.5 py-2.5 text-sm font-medium text-[#ba1a1a]">{message}</p>;
}

export function EmptyState({
  title,
  body,
  icon = "inbox",
  action,
}: {
  title: string;
  body: string;
  /** Material Symbols Outlined ligature name. Defaults to a generic "empty" icon. */
  icon?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-light text-accent">
        <span className="material-symbols-outlined" aria-hidden>
          {icon}
        </span>
      </span>
      <div>
        <p className="font-display text-lg font-semibold text-[#191c1d]">{title}</p>
        <p className="mt-1 text-sm text-[#44474e]">{body}</p>
      </div>
      {action ? (
        <PrimaryButton onClick={action.onClick}>{action.label}</PrimaryButton>
      ) : null}
    </div>
  );
}

export function FormGrid({
  onSubmit,
  children,
}: {
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
      {children}
    </form>
  );
}
