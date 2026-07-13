import { runGit } from "./run.js";

export interface GetDiffOptions {
  /** git timeout override (ms). 0 disables; omitted uses runGit's default. */
  timeoutMs?: number;
}

function assertSafeRef(ref: string, label: string): void {
  // A ref that is empty or starts with "-" could be parsed as a git option
  // rather than a revision — reject it (args are spawned without a shell, so a
  // ref with spaces/metacharacters is otherwise just an invalid revision).
  if (ref === "" || ref.startsWith("-")) {
    throw new Error(`invalid ${label} ref: ${JSON.stringify(ref)}`);
  }
}

/**
 * The diff a review shows: what `head` introduces relative to `base`, using
 * three-dot (merge-base) semantics to match a PR diff. Returns a unified patch,
 * so a non-PR (local-branch) review target renders the same way a PR does.
 */
export async function getDiff(
  repoPath: string,
  base: string,
  head: string,
  options: GetDiffOptions = {},
): Promise<string> {
  assertSafeRef(base, "base");
  assertSafeRef(head, "head");
  // --no-color: a repo/global `color.ui=always` (or `color.diff=always`) would
  // otherwise inject ANSI escapes even on a pipe, breaking the unified-diff parser.
  const { stdout } = await runGit(["diff", "--no-color", `${base}...${head}`, "--"], {
    cwd: repoPath,
    timeoutMs: options.timeoutMs,
  });
  return stdout;
}
