import { ExecError, execCapture } from "../exec.js";

/** Default timeout — gh is network-bound, so an unbounded call could hang par. */
const DEFAULT_GH_TIMEOUT_MS = 30_000;

type EnvLike = Record<string, string | undefined>;

/**
 * Env vars removed from gh's child environment (compared case-insensitively for
 * Windows):
 *  - `GH_REPO` — would target a different repository than the clone at `cwd`.
 *  - `CLICOLOR_FORCE` / `GH_FORCE_TTY` — force color / TTY behavior (ANSI codes,
 *    a pager) even on captured/piped output, corrupting the returned patch.
 * Other gh vars (`GH_HOST` for Enterprise, auth tokens) are intentionally kept.
 */
const STRIPPED_GH_ENV_KEYS = new Set(["GH_REPO", "CLICOLOR_FORCE", "GH_FORCE_TTY"]);

/** The child environment for gh, with the repository/color/TTY overrides removed. */
export function ghChildEnv(baseEnv: EnvLike): EnvLike {
  const env: EnvLike = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (STRIPPED_GH_ENV_KEYS.has(key.toUpperCase())) continue;
    env[key] = value;
  }
  return env;
}

/** Thrown when a `gh` invocation exits non-zero, is missing, or times out. */
export class GhError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number | null,
    /** Readable failure reason (gh's stderr, or a derived message for start/timeout failures). */
    readonly reason: string,
  ) {
    super(`gh ${args.join(" ")} failed${code === null ? "" : ` (exit ${code})`}: ${reason.trim()}`);
    this.name = "GhError";
  }
}

export interface RunGhOptions {
  /** Working directory — a local clone whose remote gh resolves the repo from. */
  cwd: string;
  /** Kill gh after this many ms. 0 disables the timeout; omitted uses the 30s default. */
  timeoutMs?: number;
}

/**
 * Run `gh <args>` in `options.cwd`, returning captured stdout/stderr. Throws a
 * {@link GhError} (carrying the exit code and a readable reason) if gh exits
 * non-zero, fails to start, or times out. Wraps the shared {@link execCapture}
 * and strips the repository/color/TTY overrides from the child env.
 *
 * Requires gh with `pr list --json` / `pr diff --patch` (gh >= 2.x) and its own
 * auth (`gh auth login`), independent of any AI subscription.
 */
export async function runGh(
  args: string[],
  options: RunGhOptions,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execCapture("gh", args, {
      cwd: options.cwd,
      env: ghChildEnv(process.env),
      timeoutMs: options.timeoutMs === 0 ? 0 : (options.timeoutMs ?? DEFAULT_GH_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof ExecError) {
      throw new GhError(error.args, error.code, error.reason);
    }
    throw error;
  }
}
