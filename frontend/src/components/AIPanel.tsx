import { useState } from "react";
import { useParams } from "react-router-dom";
import { aiApi } from "../api";
import ReactMarkdown from "react-markdown";

export function AIPanel() {
  const { classroomId } = useParams();

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");

  async function askAI() {
    if (!question.trim() || !classroomId) return;

    try {
      setLoading(true);

      const response = await aiApi.chat({
        classroom_id: Number(classroomId),
        question,
      });

      let text = response.document_answer;

      if (response.additional_explanation) {
        text += "\n\n" + response.additional_explanation;
      }

      setAnswer(text);
    } catch (err) {
      console.error(err);
      setAnswer("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-4 text-lg font-bold">🤖 ASTRA AI</h2>

      <div className="flex-1 overflow-y-auto rounded-lg border border-line p-3 whitespace-pre-wrap">
        {loading ? (
          <p>Thinking...</p>
        ) : answer ? (
          <div className="prose prose-sm max-w-none whitespace-pre-wrap">
            <ReactMarkdown>{answer}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-mist">
            Ask anything about the documents uploaded in this classroom.
          </p>
        )}
      </div>

      <textarea
        className="mt-4 w-full rounded-lg border border-line bg-background p-3 outline-none"
        rows={3}
        placeholder="Ask a question..."
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />

      <button
        onClick={askAI}
        disabled={loading}
        className="mt-3 w-full rounded-lg bg-accent py-2 font-semibold text-black"
      >
        {loading ? "Thinking..." : "Send"}
      </button>
    </div>
  );
}
