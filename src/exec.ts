import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Max bytes of output captured before the call aborts. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Thrown when a spawned command exits non-zero, is missing, times out, or overflows. */
export class ExecError extends Error {
  constructor(
    readonly command: string,
    readonly args: readonly string[],
    readonly code: number | null,
    /** Readable reason: stderr, or a derived message for start/timeout/cap failures. */
    readonly reason: string,
  ) {
    super(
      `${command} ${args.join(" ")} failed${code === null ? "" : ` (exit ${code})`}: ${reason.trim()}`,
    );
    this.name = "ExecError";
  }
}

export interface ExecCaptureOptions {
  /** Working directory to run the command in. */
  cwd: string;
  /** Kill the command after this many ms. 0 or omitted means no timeout. */
  timeoutMs?: number;
  /** Child environment (defaults to the parent's `process.env`). */
  env?: Record<string, string | undefined>;
  /** Per-invocation output cap; defaults to 64 MiB. */
  maxOutputBytes?: number;
}

/**
 * Run `command` with array args (no shell) and capture stdout/stderr as UTF-8.
 * Throws {@link ExecError} with a readable `reason` on non-zero exit, a missing
 * binary (ENOENT), a timeout, or an output-cap breach — the cases where Node's
 * native error leaves stderr empty and puts the text only in `message`.
 *
 * Shared by the git and gh runners so this robustness lives in one place.
 */
export async function execCapture(
  command: string,
  args: string[],
  options: ExecCaptureOptions,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs === 0 ? undefined : options.timeoutMs,
      maxBuffer: options.maxOutputBytes ?? MAX_OUTPUT_BYTES,
      encoding: "utf8",
      env: options.env as NodeJS.ProcessEnv | undefined,
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
    // Start/timeout/cap failures leave stderr === "" and put the real text only
    // in message, so prefer a non-blank stderr, else fall back to message.
    let reason = typeof e.stderr === "string" && e.stderr.trim() !== "" ? e.stderr : (e.message ?? "");
    if (e.code === "ENOENT") {
      // ENOENT covers both a missing binary and a missing cwd — don't blame PATH alone.
      reason = `could not start "${command}" — not found on PATH, or the working directory does not exist (${options.cwd})`;
    } else if (e.killed || e.signal === "SIGTERM") {
      reason = `${command} timed out or was killed (${reason})`;
    } else if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      reason = `${command} output exceeded the capture limit (${reason})`;
    }
    throw new ExecError(command, args, code, reason);
  }
}
