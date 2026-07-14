import { type FormEvent, useState } from "react";

export function Composer({
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  submitting: boolean;
  submitLabel: string;
  onSubmit: (question: string, referenceUrls: string[]) => void;
  onCancel?: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [refs, setRefs] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    const urls = refs
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    onSubmit(q, urls);
    setQuestion("");
    setRefs("");
  };

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask about this code…"
        rows={2}
      />
      <input
        value={refs}
        onChange={(e) => setRefs(e.target.value)}
        placeholder="Reference URLs (optional, space-separated)"
      />
      <div className="composer-actions">
        <button type="submit" disabled={submitting || !question.trim()}>
          {submitting ? "Thinking…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
