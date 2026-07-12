import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { runGit } from "./run.js";

/** Thrown when acquireWorktree would reuse a worktree that has uncommitted or untracked changes. */
export class DirtyWorktreeError extends Error {
  constructor(
    readonly path: string,
    readonly status: string,
  ) {
    super(`refusing to reuse a dirty worktree at ${path}:\n${status}`);
    this.name = "DirtyWorktreeError";
  }
}

/**
 * Per-repoPath in-process serialization. `git worktree add`, `fetch`, and
 * `prune` mutate the shared repo, so concurrent same-repo calls collide on git's
 * `index.lock` / worktree admin. Chaining operations by repoPath makes them run
 * one at a time (different repos still run concurrently). This coordinates only
 * within THIS process — a second par/git process on the same repo is not covered.
 */
const repoLocks = new Map<string, Promise<unknown>>();

function withRepoLock<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
  const prior = repoLocks.get(repoPath) ?? Promise.resolve();
  const result = prior.then(operation, operation);
  // Tail never rejects, so a failed operation doesn't wedge the queue.
  repoLocks.set(
    repoPath,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

export interface WorktreeInfo {
  /** Absolute path, with symlinks resolved (as git reports it). */
  path: string;
  /** Checked-out commit SHA, or "" if none. */
  head: string;
  /** Attached branch ref, or null when detached. */
  branch: string | null;
}

/**
 * Parse the NUL-separated output of `git worktree list --porcelain -z`. The `-z`
 * form is used (not plain `--porcelain`) so a worktree path containing a newline
 * is parsed correctly instead of splitting the record.
 */
export function parseWorktreePorcelain(porcelainZ: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;
  const flush = () => {
    if (current) worktrees.push(current);
    current = null;
  };

  for (const token of porcelainZ.split("\0")) {
    if (token === "") {
      flush(); // empty token = blank record separator between entries
    } else if (token.startsWith("worktree ")) {
      flush();
      current = { path: token.slice("worktree ".length), head: "", branch: null };
    } else if (current && token.startsWith("HEAD ")) {
      current.head = token.slice("HEAD ".length);
    } else if (current && token.startsWith("branch ")) {
      current.branch = token.slice("branch ".length);
    }
    // "detached", "bare", "locked", "prunable" tokens leave branch null / ignored.
  }
  flush();
  return worktrees;
}

/** All worktrees registered for the repository at `repoPath`. */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const { stdout } = await runGit(["worktree", "list", "--porcelain", "-z"], { cwd: repoPath });
  return parseWorktreePorcelain(stdout);
}

export interface AcquireWorktreeOptions {
  /** The main repository working tree. */
  repoPath: string;
  /** Parent directory that holds this repo's worktrees. */
  worktreeRoot: string;
  /** Stable directory name for this worktree (e.g. "repo-123-ab12cd3"). */
  key: string;
  /** The ref or commit to check out (detached). */
  ref: string;
  /** Optional fetch to run before adding — e.g. a PR head. */
  fetch?: { remote: string; refspec: string };
}

/**
 * A worktree key must be a single, literal path segment: no path separators and
 * no control characters. Rejecting newlines also keeps `git worktree list`
 * parsing unambiguous even though we read it with `-z`.
 */
function assertSafeKey(key: string): void {
  const hasControlChar = [...key].some((ch) => ch.charCodeAt(0) < 0x20);
  if (
    key.length === 0 ||
    key === "." ||
    key === ".." ||
    key.includes("/") ||
    key.includes("\\") ||
    hasControlChar
  ) {
    throw new Error(`invalid worktree key: ${JSON.stringify(key)} (must be a single path segment)`);
  }
}

/**
 * Reject a value that git would parse as an option. Refs/remotes/refspecs derive
 * from PR metadata; a value like `--upload-pack=<cmd>` is a git option-injection
 * (command execution). The `--` separators below are belt-and-suspenders on top.
 */
function assertNotOption(value: string, label: string): void {
  if (value.startsWith("-")) {
    throw new Error(`invalid ${label}: ${JSON.stringify(value)} must not begin with "-"`);
  }
}

/**
 * Ensure a detached worktree for `ref` exists at `<worktreeRoot>/<key>`, keyed so
 * repeated calls reuse the directory. The worktree is (re-)pointed at `ref` on
 * every call — fetching first when `fetch` is given — so a PR that gained commits
 * is not served stale. Reuse refuses a worktree with uncommitted or untracked
 * changes (throws {@link DirtyWorktreeError}); review worktrees are expected to
 * stay clean and par never discards work. Detached checkout is intentional:
 * review worktrees track a commit, not a local branch.
 *
 * Concurrent calls for the same `repoPath` are serialized in-process (see
 * {@link withRepoLock}), so same-key races don't collide on git's index.lock;
 * concurrency across separate processes is not coordinated.
 *
 * `repoPath` must be a trusted clone: git honors its local config and hooks
 * (e.g. post-checkout). PR content lands only inside the worktree, never in
 * `repoPath/.git`, under the expected single-operator model.
 */
export async function acquireWorktree(options: AcquireWorktreeOptions): Promise<WorktreeInfo> {
  // Validate before entering the lock queue so bad input fails fast.
  assertSafeKey(options.key);
  assertNotOption(options.ref, "ref");
  if (options.fetch) {
    assertNotOption(options.fetch.remote, "fetch.remote");
    assertNotOption(options.fetch.refspec, "fetch.refspec");
  }
  return withRepoLock(options.repoPath, () => acquireWorktreeInRepo(options));
}

async function acquireWorktreeInRepo(options: AcquireWorktreeOptions): Promise<WorktreeInfo> {
  await mkdir(options.worktreeRoot, { recursive: true });
  // Resolve symlinks in the root so the target matches git's (real) paths — e.g.
  // on macOS /var -> /private/var — otherwise the reuse check would never match.
  const targetPath = join(await realpath(options.worktreeRoot), options.key);

  // Drop administrative entries for worktrees whose dirs were removed out of band,
  // so the reuse check is accurate and a deleted dir is transparently recreated.
  await pruneWorktrees(options.repoPath);

  if (options.fetch) {
    await runGit(["fetch", "--", options.fetch.remote, options.fetch.refspec], { cwd: options.repoPath });
  }

  const existing = (await listWorktrees(options.repoPath)).find((w) => w.path === targetPath);
  if (existing) {
    // `git checkout` keeps untracked files and non-conflicting local edits, so it
    // is NOT a reliable dirty guard — check explicitly and refuse to reuse.
    const { stdout: status } = await runGit(["status", "--porcelain"], { cwd: existing.path });
    if (status.trim() !== "") {
      throw new DirtyWorktreeError(existing.path, status.trim());
    }
    await runGit(["checkout", "--detach", options.ref], { cwd: existing.path });
  } else {
    await runGit(["worktree", "add", "--detach", "--", targetPath, options.ref], { cwd: options.repoPath });
  }

  const result = (await listWorktrees(options.repoPath)).find((w) => w.path === targetPath);
  if (!result) {
    throw new Error(`git worktree is ready but no worktree was found at ${targetPath}`);
  }
  return result;
}

export interface RemoveWorktreeOptions {
  /**
   * Remove even if the worktree has uncommitted or untracked changes
   * (`git worktree remove --force`). A LOCKED worktree is still refused — git
   * requires a double force to remove one, which this deliberately does not do;
   * unlock it first.
   */
  force?: boolean;
}

/** Remove a worktree via `git worktree remove` (serialized per repoPath). */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  options: RemoveWorktreeOptions = {},
): Promise<void> {
  await withRepoLock(repoPath, async () => {
    const args = ["worktree", "remove"];
    if (options.force) args.push("--force");
    args.push("--", worktreePath);
    await runGit(args, { cwd: repoPath });
  });
}

/** Prune administrative entries for worktrees whose directories were removed. */
export async function pruneWorktrees(repoPath: string): Promise<void> {
  await runGit(["worktree", "prune"], { cwd: repoPath });
}
