import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { aiApi, classroomsApi } from "../api";
import { ApiError } from "../api/client";
import type { Classroom } from "../api/types";
import { BrandLogo } from "./BrandLogo";
import { CourseMarkdown } from "./CourseMarkdown";

const STARTER_PROMPTS = [
  "Summarize my classroom activity",
  "What needs my attention?",
  "Which topics are students struggling with?",
  "Summarize my course materials",
  "Which assignments need review?",
];

type ChatMessage = {
  id: string;
  role: "bot" | "user";
  text: string;
  blocked?: boolean;
};

type TeacherAiChatWidgetProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function TeacherAiChatWidget({
  open: controlledOpen,
  onOpenChange,
}: TeacherAiChatWidgetProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => {
    if (onOpenChange) onOpenChange(value);
    else setInternalOpen(value);
  };

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | number>("all");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "bot",
      text: "Hi! I can help with your classrooms, assignments, student activity, and course materials. Choose a scope and ask a question.",
    },
  ]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const classrooms = useQuery({
    queryKey: ["classrooms"],
    queryFn: classroomsApi.list,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    inputRef.current?.focus();
  }, [open, messages, pending]);

  async function sendMessage(text: string) {
    const question = text.trim();
    if (!question || pending) return;

    setError(null);
    setDraft("");
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: question }]);
    setPending(true);

    try {
      const res = await aiApi.teacherChat({
        question,
        classroom_id: scope === "all" ? null : scope,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          role: "bot",
          text: res.answer,
          blocked: res.blocked,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not reach Teacher AI.";
      setError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: `b-err-${Date.now()}`,
          role: "bot",
          text: message.includes("timed out")
            ? "That took too long. Teacher AI may still be loading classroom data — try a shorter question or pick one classroom in the scope selector."
            : message.includes("backend")
              ? message
              : "Sorry — I couldn't answer that just now. Please try again.",
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(draft);
  }

  const classroomList = (classrooms.data ?? []) as Classroom[];

  return createPortal(
    <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex flex-col items-end gap-3">
      {open ? (
        <div className="pointer-events-auto flex h-[min(560px,72vh)] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#d8dde3] bg-white shadow-[0_18px_50px_rgba(3,22,53,0.18)]">
          <header className="flex items-center justify-between bg-[#031635] px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <BrandLogo variant="dark" className="h-6 w-auto" />
              <div>
                <p className="text-sm font-semibold">ASTRA Teacher AI</p>
                <p className="text-[11px] text-white/70">Insights and assistance for your classrooms</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-white/90 transition hover:bg-white/10"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </header>

          <div className="border-b border-[#eef1f4] px-4 py-3">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#75777f]">
              Classroom scope
            </label>
            <select
              value={scope === "all" ? "all" : String(scope)}
              onChange={(e) => {
                const value = e.target.value;
                setScope(value === "all" ? "all" : Number(value));
              }}
              className="w-full rounded-lg border border-[#e1e3e4] bg-[#f8f9fa] px-3 py-2 text-sm text-[#031635] outline-none focus:border-[#031635]"
            >
              <option value="all">All authorized classrooms</option>
              {classroomList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void sendMessage(prompt)}
                  disabled={pending}
                  className="rounded-full border border-[#e1e3e4] bg-white px-2.5 py-1 text-[11px] font-medium text-[#3f5d9b] transition hover:border-[#031635] hover:text-[#031635] disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-[#f8f9fa] px-3 py-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${
                    msg.role === "user"
                      ? "rounded-br-md bg-[#d6e3ff] text-[#031635]"
                      : "rounded-bl-md bg-white text-[#2e3132] shadow-sm ring-1 ring-[#e1e3e4]"
                  }`}
                >
                  {msg.role === "user" ? msg.text : <CourseMarkdown content={msg.text} />}
                </div>
              </div>
            ))}
            {pending ? (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm text-[#75777f] shadow-sm ring-1 ring-[#e1e3e4]">
                  Gathering classroom data…
                </div>
              </div>
            ) : null}
            {error ? <p className="px-1 text-xs text-[#a03a3a]">{error}</p> : null}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={onSubmit} className="border-t border-[#e1e3e4] bg-white px-3 py-2.5">
            <div className="flex items-center gap-1 rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-2 py-1.5 focus-within:border-[#031635] focus-within:bg-white">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask about your classrooms…"
                disabled={pending}
                className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-[#191c1d] outline-none placeholder:text-[#75777f]"
              />
              <button
                type="submit"
                disabled={pending || !draft.trim()}
                aria-label="Send message"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#031635] transition hover:bg-[#eef4ff] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[20px]">send</span>
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {controlledOpen === undefined ? (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close Teacher AI" : "Open Teacher AI"}
          className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#031635] text-white shadow-[0_12px_28px_rgba(3,22,53,0.28)] transition hover:bg-[#1a2b4b] active:scale-[0.98]"
        >
          {open ? (
            <span className="material-symbols-outlined text-[26px]">close</span>
          ) : (
            <span className="material-symbols-outlined text-[26px]">auto_awesome</span>
          )}
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
