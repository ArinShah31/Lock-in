import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { aiApi } from "../api";
import {
  STUDENT_AI_REFUSAL,
  isBlockedStudentQuestion,
} from "../lib/studentChatGuardrail";
import { BrandLogo } from "./BrandLogo";
import { CourseMarkdown } from "./CourseMarkdown";

type ChatMessage = {
  id: string;
  role: "bot" | "user";
  text: string;
  additionalExplanation?: string;
  blocked?: boolean;
};

function formatBotReply(res: {
  document_answer: string;
  additional_explanation?: string;
  used_document: boolean;
  blocked?: boolean;
}) {
  if (
    res.blocked ||
    (res.document_answer || "").trim() === STUDENT_AI_REFUSAL
  ) {
    return {
      documentAnswer: STUDENT_AI_REFUSAL,
      additionalExplanation: "",
      blocked: true,
    };
  }

  const doc = (res.document_answer || "").trim();
  const explanation = (res.additional_explanation || "").trim();

  if (!doc) {
    return {
      documentAnswer: res.used_document
        ? "I found related material, but could not form a clear answer. Try rephrasing your question."
        : "I could not find that in your classroom documents yet. Try asking about a topic from the uploaded PDFs.",
      additionalExplanation: "",
      blocked: false,
    };
  }

  return {
    documentAnswer: doc,
    additionalExplanation: explanation,
    blocked: false,
  };
}

export function CourseRagChatWidget({ classroomId }: { classroomId: number }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "bot",
      text: "Hi! Ask me anything from your classroom documents and syllabus. I’ll answer from what’s uploaded here.",
    },
  ]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text: question },
    ]);

    if (isBlockedStudentQuestion(question)) {
      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          role: "bot",
          text: STUDENT_AI_REFUSAL,
          blocked: true,
        },
      ]);
      return;
    }

    setPending(true);

    try {
      const res = await aiApi.chat({
        classroom_id: classroomId,
        question,
      });

      const formatted = formatBotReply(res);

      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          role: "bot",
          text: formatted.documentAnswer,
          additionalExplanation: formatted.additionalExplanation,
          blocked: formatted.blocked,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not reach the course assistant.";
      setError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: `b-err-${Date.now()}`,
          role: "bot",
          text: "Sorry — I couldn’t answer that just now. Check that documents are uploaded and try again.",
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

  // Portal to body so `fixed` isn't trapped by AppShell's animate-rise transform.
  return createPortal(
    <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex flex-col items-end gap-3">
      {open ? (
        <div className="pointer-events-auto flex h-[min(520px,70vh)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#d8dde3] bg-white shadow-[0_18px_50px_rgba(3,22,53,0.18)]">
          <header className="flex items-center justify-between bg-[#031635] px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <BrandLogo variant="dark" className="h-6 w-auto" />
              <div>
                <p className="text-sm font-semibold">Chat with course docs</p>
                <p className="text-[11px] text-white/70">
                  Answers from this classroom’s PDFs
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-white/90 transition hover:bg-white/10"
            >
              <span className="material-symbols-outlined text-[20px]">
                close
              </span>
            </button>
          </header>

          <div className="border-b border-[#eef1f4] px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eef4ff]">
                <BrandLogo variant="base" className="h-5 w-auto" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#191c1d]">
                  ASTRA Course Bot
                </p>
                <p className="text-[11px] text-[#75777f]">
                  Document-grounded help
                </p>
              </div>
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
                  {msg.role === "user" ? (
                    msg.text
                  ) : msg.blocked ? (
                    <p>{msg.text}</p>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#75777f]">
                          From your documents
                        </p>

                        <CourseMarkdown content={msg.text} />
                      </div>

                      {msg.additionalExplanation ? (
                        <div className="border-t border-[#e1e3e4] pt-3">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#031635]">
                            ASTRA Explanation
                          </p>

                          <CourseMarkdown content={msg.additionalExplanation} />
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {pending ? (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm text-[#75777f] shadow-sm ring-1 ring-[#e1e3e4]">
                  {/diagram|table|chart|figure|graph|flowchart|image|visual/i.test(
                    messages.filter((m) => m.role === "user").at(-1)?.text ?? "",
                  )
                    ? "Analyzing diagrams and tables in your documents…"
                    : "Searching classroom documents…"}
                </div>
              </div>
            ) : null}
            {error ? (
              <p className="px-1 text-xs text-[#a03a3a]">{error}</p>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={onSubmit}
            className="border-t border-[#e1e3e4] bg-white px-3 py-2.5"
          >
            <div className="flex items-center gap-1 rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-2 py-1.5 focus-within:border-[#031635] focus-within:bg-white">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type something to send…"
                disabled={pending}
                className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-[#191c1d] outline-none placeholder:text-[#75777f]"
              />
              <button
                type="submit"
                disabled={pending || !draft.trim()}
                aria-label="Send message"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#031635] transition hover:bg-[#eef4ff] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[20px]">
                  send
                </span>
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close course chat" : "Open course chat"}
        className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#031635] text-white shadow-[0_12px_28px_rgba(3,22,53,0.28)] transition hover:bg-[#1a2b4b] active:scale-[0.98]"
      >
        {open ? (
          <span className="material-symbols-outlined text-[26px]">close</span>
        ) : (
          <BrandLogo variant="white" className="h-7 w-auto" />
        )}
      </button>
    </div>,
    document.body,
  );
}
