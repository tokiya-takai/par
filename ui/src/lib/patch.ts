import {
  type ChangeData,
  type FileData,
  computeNewLineNumber,
  computeOldLineNumber,
  getChangeKey,
  parseDiff,
} from "react-diff-view";
import type { DiffSide } from "../types";

/** Per-file map from a (side, line) to the diff row's change key. */
export interface FileLineIndex {
  /** Canonical (new) path — used to build the file-qualified DOM anchor id. */
  filePath: string;
  new: Map<number, string>;
  old: Map<number, string>;
}
export type LineIndex = Map<string /* filePath */, FileLineIndex>;

/** A resolved answer anchor: a change to highlight and the DOM row to scroll to. */
export interface ResolvedAnchor {
  filePath: string;
  /** react-diff-view's file-relative change key — matches `selectedChanges`. */
  changeKey: string;
  /** File-qualified DOM id — unique across files, matches `generateAnchorID`. */
  domId: string;
}

/**
 * File-qualify a change key. `getChangeKey` is file-relative (e.g. "I5"), so DOM
 * ids and scroll targets must include the path to stay unique across files.
 */
export function anchorDomId(filePath: string, changeKey: string): string {
  return `${filePath}::${changeKey}`;
}

function validLine(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/**
 * Drop any leading envelope before the first `diff --git`. A git format-patch /
 * `gh pr diff --patch` output prepends an email header + a diffstat whose
 * leading-space lines crash the unified-diff parser; keep only the diff body.
 */
function stripEnvelope(text: string): string {
  if (text.startsWith("diff --git ")) return text;
  const idx = text.indexOf("\ndiff --git ");
  return idx >= 0 ? text.slice(idx + 1) : text;
}

/** Parse a unified patch into files plus a (file, side, line) → change-key index. */
export function parsePatch(text: string): { files: FileData[]; index: LineIndex } {
  // parseDiff("") yields a single hunkless file; drop hunkless files so an empty
  // (no-change) diff is truly empty and renders the "no changes" state. (Pure
  // renames with no content change also drop — acceptable for now.) Guard the
  // shapes defensively: real-world patches (binary, mode-only, submodule, huge)
  // can yield files/hunks without a usable changes array — skip rather than crash.
  const files = parseDiff(stripEnvelope(text)).filter(
    (file) => Array.isArray(file.hunks) && file.hunks.length > 0,
  );
  const index: LineIndex = new Map();
  for (const file of files) {
    const per: FileLineIndex = { filePath: file.newPath, new: new Map(), old: new Map() };
    for (const hunk of file.hunks) {
      if (!hunk || !Array.isArray(hunk.changes)) continue;
      for (const change of hunk.changes) {
        const key = getChangeKey(change);
        const n = computeNewLineNumber(change);
        if (validLine(n)) per.new.set(n, key);
        const o = computeOldLineNumber(change);
        if (validLine(o)) per.old.set(o, key);
      }
    }
    index.set(file.newPath, per);
    if (file.oldPath !== file.newPath) index.set(file.oldPath, per);
  }
  return { files, index };
}

/**
 * Resolve a code anchor to a diff row. Prefers the given side (the question's,
 * since answer anchors are often side-less), falling back to the other side.
 */
export function resolveAnchor(
  index: LineIndex,
  filePath: string,
  line: number | [number, number],
  side?: DiffSide,
): ResolvedAnchor | undefined {
  const per = index.get(filePath);
  if (!per) return undefined;
  const target = Array.isArray(line) ? line[0] : line;
  const preferred: DiffSide = side ?? "new";
  const other: DiffSide = preferred === "new" ? "old" : "new";
  const changeKey = per[preferred].get(target) ?? per[other].get(target);
  if (changeKey === undefined) return undefined;
  return { filePath: per.filePath, changeKey, domId: anchorDomId(per.filePath, changeKey) };
}

/** Derive the anchor of a clicked diff row. */
export function anchorOfChange(
  file: FileData,
  change: ChangeData,
  side: DiffSide,
): { filePath: string; line: number; side: DiffSide; changeKey: string } | undefined {
  const line = side === "old" ? computeOldLineNumber(change) : computeNewLineNumber(change);
  if (!validLine(line)) return undefined;
  const filePath = side === "old" ? file.oldPath : file.newPath;
  return { filePath, line, side, changeKey: getChangeKey(change) };
}
