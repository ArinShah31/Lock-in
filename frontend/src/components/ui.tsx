import type { FormEvent, ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-extrabold text-[#031635] tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[#44474e] max-w-2xl">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-xl border border-[#e1e3e4] bg-white p-5 shadow-xs transition-shadow hover:shadow-md ${className}`}
    >
      {children}
    </section>
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
      className="inline-flex items-center justify-center rounded-md bg-[#031635] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#1a2b4b] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
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
      className="inline-flex items-center justify-center rounded-md border border-[#3f5d9b] bg-transparent px-4 py-2.5 text-sm font-semibold text-[#3f5d9b] transition hover:bg-[#3f5d9b]/10 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
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
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-md border border-[#e1e3e4] bg-white px-4 py-2.5 text-sm font-medium text-[#44474e] transition hover:bg-[#f3f4f5] hover:text-[#191c1d] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function ErrorText({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="mb-4 rounded-md border border-[#ba1a1a]/30 bg-[#ffdad6]/50 px-3.5 py-2.5 text-sm font-medium text-[#ba1a1a]">{message}</p>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#c5c6cf] bg-[#f8f9fa] px-4 py-10 text-center">
      <p className="font-display text-lg font-semibold text-[#191c1d]">{title}</p>
      <p className="mt-1 text-sm text-[#44474e]">{body}</p>
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
