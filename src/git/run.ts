import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Max bytes of git output captured before the call aborts. */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Thrown when a git invocation exits non-zero or fails to start. */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed${code === null ? "" : ` (exit ${code})`}: ${stderr.trim()}`);
    this.name = "GitError";
  }
}

export interface RunGitOptions {
  /** Working directory to run git in. */
  cwd: string;
  /** Kill git after this many ms. 0 or omitted means no timeout. */
  timeoutMs?: number;
}

/**
 * Run `git <args>` in `options.cwd`, returning captured stdout/stderr. Throws a
 * {@link GitError} (carrying the exit code and stderr) if git exits non-zero or
 * fails to start.
 */
export async function runGit(
  args: string[],
  options: RunGitOptions,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      encoding: "utf8",
    });
    return { stdout, stderr };
  } catch (error) {
    // execFile rejects with an Error carrying a numeric exit code (non-zero exit)
    // or a string errno like "ENOENT" (spawn failure), plus captured stderr.
    const e = error as { code?: number | string; stderr?: string; message?: string };
    const code = typeof e.code === "number" ? e.code : null;
    const stderr = typeof e.stderr === "string" ? e.stderr : (e.message ?? "");
    throw new GitError(args, code, stderr);
  }
}
