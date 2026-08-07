import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api, type ExamQuestion, type Session } from "../api";
import { useProctor } from "../components/useProctor";

const monacoLang: Record<string, string> = {
  python: "python",
  java: "java",
  cpp: "cpp",
  html: "html",
  css: "css",
  javascript: "javascript",
};

export function ExamPage() {
  const { sessionId } = useParams();
  const sid = Number(sessionId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeOrder, setActiveOrder] = useState(1);
  const [codes, setCodes] = useState<Record<number, string>>({});
  const [warn, setWarn] = useState<string | null>(null);
  const pasteTimes = useRef<number[]>([]);

  const session = useQuery({
    queryKey: ["session", sid],
    queryFn: () => api<Session>(`/student/sessions/${sid}`),
    refetchInterval: 15000,
  });
  const questions = useQuery({
    queryKey: ["exam-questions", sid],
    queryFn: () => api<ExamQuestion[]>(`/student/sessions/${sid}/questions`),
  });

  useEffect(() => {
    if (!questions.data) return;
    setCodes((prev) => {
      const next = { ...prev };
      for (const q of questions.data) {
        if (next[q.question_id] == null) next[q.question_id] = q.draft_code ?? q.starter_code ?? "";
      }
      return next;
    });
  }, [questions.data]);

  const saveDraft = useMutation({
    mutationFn: (payload: { question_id: number; code: string }) =>
      api(`/student/sessions/${sid}/draft`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["exam-questions", sid] });
      await qc.invalidateQueries({ queryKey: ["session", sid] });
    },
  });

  const submit = useMutation({
    mutationFn: () => api(`/student/sessions/${sid}/submit`, { method: "POST" }),
    onSuccess: () => navigate(`/submitted/${sid}`),
  });

  const report = useCallback(
    async (event_type: string, detail?: string, duration_seconds?: number) => {
      const res = await api<Session>(`/student/sessions/${sid}/event`, {
        method: "POST",
        body: JSON.stringify({ event_type, detail, duration_seconds }),
      });
      if (res.warning) setWarn(res.warning);
      if (res.status === "BLOCKED" || res.status === "SUBMITTED" || res.status === "EXPIRED") {
        navigate(`/submitted/${sid}`);
      }
      await qc.invalidateQueries({ queryKey: ["session", sid] });
    },
    [navigate, qc, sid],
  );

  useProctor({
    enabled: session.data?.status === "IN_PROGRESS",
    onEvent: report,
    onPaste: () => {
      const now = Date.now();
      pasteTimes.current = [...pasteTimes.current.filter((t) => now - t < 10000), now];
      if (pasteTimes.current.length >= 4) void report("paste_storm", "multiple pastes");
      else void report("paste");
    },
  });

  const active = questions.data?.find((q) => q.order_index === activeOrder);
  const remaining = session.data?.remaining_seconds ?? 0;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  if (session.isLoading || questions.isLoading) {
    return <div className="p-8 text-[#44474e]">Loading exam…</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-[#f8f9fa]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1e3e4] bg-white px-4 py-3">
        <div className="text-sm text-[#44474e]">
          Timer{" "}
          <span className="rounded-md border border-[#d6e3ff] bg-[#eef4ff] px-2 py-1 font-mono font-bold text-[#031635]">
            {mm}:{ss}
          </span>{" "}
          · Violations {session.data?.violation_score?.toFixed(1) ?? 0}/5
        </div>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3].map((order) => {
            const q = questions.data?.find((item) => item.order_index === order);
            const locked = !q?.unlocked;
            return (
              <button
                key={order}
                disabled={locked}
                onClick={() => setActiveOrder(order)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                  activeOrder === order
                    ? "bg-[#031635] text-white"
                    : locked
                      ? "cursor-not-allowed bg-[#f1f3f5] text-[#a0a4ab]"
                      : "border border-[#e1e3e4] bg-white text-[#031635] hover:border-[#031635]"
                }`}
              >
                Q{order} {q?.difficulty}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md border border-[#c5c6cf] bg-white px-3 py-1.5 text-sm font-semibold text-[#031635] transition hover:border-[#031635]"
            onClick={() => {
              if (!active) return;
              saveDraft.mutate({ question_id: active.question_id, code: codes[active.question_id] || "" });
            }}
          >
            Save & unlock next
          </button>
          <button
            className="rounded-md bg-[#031635] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[#1a2b4b]"
            onClick={() => {
              if (!active) return;
              saveDraft.mutate(
                { question_id: active.question_id, code: codes[active.question_id] || "" },
                { onSuccess: () => submit.mutate() },
              );
            }}
          >
            Final submit
          </button>
        </div>
      </header>
      {warn ? (
        <div className="border-b border-[#ffe0b2] bg-[#fff4df] px-4 py-2 text-sm text-[#8a4f00]">{warn}</div>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="overflow-auto border-r border-[#e1e3e4] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#3f5d9b]">Question prompt</p>
          <h2 className="mt-2 text-xl font-extrabold text-[#031635]">{active?.title}</h2>
          <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-7 text-[#44474e]">
            {active?.prompt_markdown}
          </pre>
        </section>
        <section className="min-h-0 overflow-hidden border-t border-[#e1e3e4] lg:border-t-0">
          {active ? (
            <Editor
              height="100%"
              theme="vs-dark"
              language={monacoLang[active.language] || "plaintext"}
              value={codes[active.question_id] || ""}
              onChange={(v) => setCodes((c) => ({ ...c, [active.question_id]: v || "" }))}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                automaticLayout: true,
                contextmenu: false,
                copyWithSyntaxHighlighting: false,
              }}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
