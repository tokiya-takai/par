import { useEffect } from "react";
import { useCockpit } from "../state/cockpit";
import { DiffFile } from "./DiffFile";
import { ErrorBoundary } from "./ErrorBoundary";

export function CenterPane() {
  const { state } = useCockpit();
  const target = state.target;
  const selectedDomId = target?.selectedAnchor?.domId ?? null;

  useEffect(() => {
    if (!selectedDomId) return;
    document.getElementById(selectedDomId)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedDomId]);

  if (!target) {
    return (
      <div className="pane center empty">
        <p className="muted">Open a pull request or a local branch to see its diff.</p>
      </div>
    );
  }

  const { target: rt, files } = target;
  const headerLabel = rt.pr ? `#${rt.pr.number} ${rt.pr.title}` : `${rt.base} → ${rt.head}`;
  const sub = rt.pr ? `${rt.pr.author} · ${rt.pr.state} · ${rt.base} → ${rt.head}` : "local branch";

  return (
    <div className="pane center">
      <header className="target-header">
        <div className="target-title">{headerLabel}</div>
        <div className="muted small">{sub}</div>
      </header>
      <div className="diff-scroll">
        {target.diffError ? (
          <p className="error">Diff unavailable: {target.diffError}</p>
        ) : files.length === 0 ? (
          <p className="muted">No changes in this diff.</p>
        ) : (
          files.map((f) => {
            const key = `${f.oldPath}→${f.newPath}`;
            return (
              <ErrorBoundary
                key={key}
                fallback={(e) => (
                  <section className="diff-file">
                    <header className="diff-file-header">{f.newPath || f.oldPath}</header>
                    <p className="error">Couldn't render this file: {e.message}</p>
                  </section>
                )}
              >
                <DiffFile file={f} />
              </ErrorBoundary>
            );
          })
        )}
      </div>
    </div>
  );
}
