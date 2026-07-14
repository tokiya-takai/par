import { useState } from "react";
import { useCockpit } from "../state/cockpit";
import type { Comment } from "../types";
import { AnswerCard } from "./AnswerCard";
import { Composer } from "./Composer";

function groupThreads(comments: Comment[]): { threadId: string; comments: Comment[] }[] {
  const order: string[] = [];
  const groups = new Map<string, Comment[]>();
  for (const c of comments) {
    const existing = groups.get(c.threadId);
    if (existing) {
      existing.push(c);
    } else {
      groups.set(c.threadId, [c]);
      order.push(c.threadId);
    }
  }
  return order.map((threadId) => ({ threadId, comments: groups.get(threadId) ?? [] }));
}

function anchorLabel(comment: Comment | undefined): string {
  if (!comment) return "";
  const { filePath, line } = comment.codeAnchor;
  return `${filePath}:${Array.isArray(line) ? line.join("-") : line}`;
}

function Thread({ threadId, comments }: { threadId: string; comments: Comment[] }) {
  const { state, actions } = useCockpit();
  const [replying, setReplying] = useState(false);

  return (
    <section className="thread">
      <div className="thread-anchor muted small">{anchorLabel(comments[0])}</div>
      {comments.map((c) => (
        <div key={c.id} className="turn">
          <div className="question">{c.question}</div>
          <AnswerCard comment={c} />
        </div>
      ))}
      {replying ? (
        <Composer
          submitting={state.target?.asking ?? false}
          submitLabel="Reply"
          onSubmit={(q, urls) => {
            void actions.reply(threadId, q, urls);
            setReplying(false);
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <button type="button" className="reply-btn" onClick={() => setReplying(true)}>
          Reply
        </button>
      )}
    </section>
  );
}

export function RightPane() {
  const { state } = useCockpit();
  const target = state.target;

  if (!target) {
    return (
      <div className="pane right empty">
        <p className="muted">Answers appear here.</p>
      </div>
    );
  }

  const threads = groupThreads(target.comments);

  return (
    <div className="pane right">
      <header className="pane-header">Q&amp;A</header>
      {threads.length === 0 ? (
        <p className="muted small">Click a line in the diff to ask a question.</p>
      ) : (
        threads.map((t) => <Thread key={t.threadId} threadId={t.threadId} comments={t.comments} />)
      )}
    </div>
  );
}
