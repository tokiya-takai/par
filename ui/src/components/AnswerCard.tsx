import { evidenceForComment } from "../lib/evidence";
import { resolveAnchor } from "../lib/patch";
import { useCockpit } from "../state/cockpit";
import type { Comment } from "../types";

function lineLabel(line: number | [number, number]): string {
  return Array.isArray(line) ? `${line[0]}-${line[1]}` : String(line);
}

/** Only http(s) links are safe to render as an anchor — block javascript:/data: etc. */
function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function AnswerCard({ comment }: { comment: Comment }) {
  const { state, actions } = useCockpit();
  const answer = comment.answers.at(-1);
  if (!answer) return null;

  const target = state.target;
  const insufficient = evidenceForComment(comment, answer) === "insufficient";

  return (
    <div className={`answer-card${insufficient ? " insufficient" : ""}`}>
      <div className="answer-finding">
        <div className="answer-label">Agent's finding</div>
        {answer.verdict && <span className="verdict">{answer.verdict}</span>}
        <p>{answer.reasoning}</p>
      </div>

      {answer.codeAnchors.length > 0 && (
        <div className="anchor-row">
          {answer.codeAnchors.map((a, i) => {
            // Answer anchors are often side-less; fall back to the question's side.
            const side = a.side ?? comment.codeAnchor.side;
            const resolved = target
              ? resolveAnchor(target.lineIndex, a.filePath, a.line, side)
              : undefined;
            const text = `${a.filePath}:${lineLabel(a.line)}`;
            return resolved ? (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: anchors are a static per-answer list
                key={i}
                type="button"
                className="chip code"
                onClick={() => actions.jumpToAnchor(resolved)}
              >
                {text}
              </button>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: anchors are a static per-answer list
              <span key={i} className="chip code muted" title="In code outside this diff">
                {text}
              </span>
            );
          })}
        </div>
      )}

      {answer.sourceAnchors.length > 0 && (
        <div className="anchor-row">
          {answer.sourceAnchors.map((s, i) => {
            const href = safeHttpUrl(s.url);
            return href ? (
              <a
                // biome-ignore lint/suspicious/noArrayIndexKey: anchors are a static per-answer list
                key={i}
                className="chip source"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.label}
              </a>
            ) : (
              // Non-http(s) URL: show the label but don't make it a clickable link.
              // biome-ignore lint/suspicious/noArrayIndexKey: anchors are a static per-answer list
              <span key={i} className="chip source muted" title={s.url}>
                {s.label}
              </span>
            );
          })}
        </div>
      )}

      {insufficient && (
        <div
          className="evidence-badge"
          title="This answer doesn't point to both the code and the reference it was checked against."
        >
          Insufficient evidence — not enough to verify
        </div>
      )}

      {answer.verdict === "needs_info" && (
        <div className="needs-info">Needs more info — add a detail or a reference and reply.</div>
      )}
    </div>
  );
}
