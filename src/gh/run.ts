import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Max bytes of gh output captured before the call aborts. */
const MAX_GH_OUTPUT_BYTES = 64 * 1024 * 1024;

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

/** Thrown when a `gh` invocation exits non-zero or fails to start. */
export class GhError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number | null,
    /** The failure reason: gh's stderr, or a derived message when gh failed to
     *  start / timed out / exceeded the output cap (those set stderr to ""). */
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
 * non-zero, fails to start, or times out. Uses array args (no shell), so values
 * are never interpolated.
 *
 * Requires gh with `pr list --json` / `pr diff --patch` (gh >= 2.x) and its own
 * auth (`gh auth login`), independent of any AI subscription.
 */
export async function runGh(
  args: string[],
  options: RunGhOptions,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("gh", args, {
      cwd: options.cwd,
      env: ghChildEnv(process.env) as NodeJS.ProcessEnv,
      timeout: options.timeoutMs === 0 ? undefined : (options.timeoutMs ?? DEFAULT_GH_TIMEOUT_MS),
      maxBuffer: MAX_GH_OUTPUT_BYTES,
      encoding: "utf8",
    });
    return { stdout, stderr };
  } catch (error) {
    const e = error as {
      code?: number | string;
      stderr?: string;
      message?: string;
      killed?: boolean;
      signal?: string;
    };
    const code = typeof e.code === "number" ? e.code : null;
    // Start/timeout/output-cap failures leave stderr === "" and put the real text
    // only in message, so prefer a non-blank stderr, else fall back to message.
    let reason = typeof e.stderr === "string" && e.stderr.trim() !== "" ? e.stderr : (e.message ?? "");
    if (e.code === "ENOENT") {
      reason = "GitHub CLI (gh) not found on PATH — install it and run `gh auth login`";
    } else if (e.killed || e.signal === "SIGTERM") {
      reason = `gh timed out or was killed (${reason})`;
    } else if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      reason = `gh output exceeded the capture limit (${reason})`;
    }
    throw new GhError(args, code, reason);
  }
}
