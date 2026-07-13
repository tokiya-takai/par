import { ExecError, execCapture } from "../exec.js";

/** Generous default — most git ops are local/fast, but `git fetch` is network-bound. */
const DEFAULT_GIT_TIMEOUT_MS = 120_000;

/** Thrown when a git invocation exits non-zero, is missing, or times out. */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number | null,
    /** Readable failure reason (git's stderr, or a derived message for start/timeout failures). */
    readonly reason: string,
  ) {
    super(`git ${args.join(" ")} failed${code === null ? "" : ` (exit ${code})`}: ${reason.trim()}`);
    this.name = "GitError";
  }
}

export interface RunGitOptions {
  /** Working directory to run git in. */
  cwd: string;
  /** Kill git after this many ms. 0 disables the timeout; omitted uses the default. */
  timeoutMs?: number;
}

/**
 * Run `git <args>` in `options.cwd`, returning captured stdout/stderr. Throws a
 * {@link GitError} (carrying the exit code and a readable reason) if git exits
 * non-zero, fails to start, or times out. Wraps the shared {@link execCapture}.
 */
export async function runGit(
  args: string[],
  options: RunGitOptions,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execCapture("git", args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs === 0 ? 0 : (options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof ExecError) {
      throw new GitError(error.args, error.code, error.reason);
    }
    throw error;
  }
}
