import {
  type ChangeEventArgs,
  Diff,
  type FileData,
  Hunk,
  getChangeKey,
} from "react-diff-view";
import { type ReactNode, useMemo } from "react";
import { highlightHunks, languageForPath } from "../lib/highlight";
import { anchorDomId, anchorOfChange } from "../lib/patch";
import { useCockpit } from "../state/cockpit";
import { Composer } from "./Composer";

const DEV_NULL = "/dev/null";
const STATUS_LABEL: Record<FileData["type"], string | null> = {
  add: "added",
  delete: "deleted",
  modify: null,
  rename: "renamed",
  copy: "copied",
};

/** A readable header: the file's path (no `/dev/null` for add/delete) + a status tag. */
function fileHeader(file: FileData): { path: string; status: string | null } {
  let path: string;
  if (file.oldPath === DEV_NULL) path = file.newPath; // added
  else if (file.newPath === DEV_NULL) path = file.oldPath; // deleted
  else if (file.oldPath !== file.newPath) path = `${file.oldPath} → ${file.newPath}`; // renamed
  else path = file.newPath; // modified
  return { path, status: STATUS_LABEL[file.type] };
}

export function DiffFile({ file }: { file: FileData }) {
  const { state, actions } = useCockpit();
  const target = state.target;

  const onClick = ({ change, side }: ChangeEventArgs) => {
    if (!change) return;
    const resolvedSide = side ?? (change.type === "delete" ? "old" : "new");
    const anchor = anchorOfChange(file, change, resolvedSide);
    if (anchor) actions.openComposer(anchor);
  };

  const widgets: Record<string, ReactNode> = {};
  const pending = target?.pendingAnchor;
  if (pending && (pending.filePath === file.newPath || pending.filePath === file.oldPath)) {
    widgets[pending.changeKey] = (
      <div className="inline-composer">
        <div className="inline-composer-label">
          Ask about {pending.filePath}:{pending.line}
        </div>
        <Composer
          submitting={target?.asking ?? false}
          submitLabel="Ask"
          onSubmit={(q, urls) => void actions.ask(q, urls)}
          onCancel={actions.closeComposer}
        />
      </div>
    );
  }

  const tokens = useMemo(
    () => highlightHunks(file.hunks, languageForPath(file.newPath)),
    [file.hunks, file.newPath],
  );

  const { path, status } = fileHeader(file);
  // Only highlight when the selected answer anchor belongs to THIS file — the
  // change key alone is file-relative and would otherwise bleed across files.
  const selected = target?.selectedAnchor;
  const selectedChanges = selected && selected.filePath === file.newPath ? [selected.changeKey] : [];

  return (
    <section className="diff-file">
      <header className="diff-file-header">
        <span className="diff-file-path">{path}</span>
        {status && <span className="file-status">{status}</span>}
      </header>
      <Diff
        diffType={file.type}
        hunks={file.hunks}
        viewType="unified"
        widgets={widgets}
        tokens={tokens}
        selectedChanges={selectedChanges}
        generateAnchorID={(c) => anchorDomId(file.newPath, getChangeKey(c))}
        gutterEvents={{ onClick }}
        codeEvents={{ onClick }}
      >
        {(hunks) => hunks.map((h) => <Hunk key={h.content} hunk={h} />)}
      </Diff>
    </section>
  );
}
