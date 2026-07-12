import { type ChildProcess, spawn } from "node:child_process";
import { type EnvLike, sanitizeEnv } from "./env.js";

/** Default per-stream capture cap. Beyond this, output is truncated and the child killed. */
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MiB

/** Node's maximum setTimeout delay; larger values silently become 1ms (immediate). */
const MAX_TIMER_MS = 2_147_483_647;

/** Captured text plus its running byte count, for enforcing the output cap. */
interface StreamCapture {
  text: string;
  bytes: number;
}

export interface SpawnCleanOptions {
  cwd?: string;
  /** Base environment to sanitize before passing to the child. Defaults to `process.env`. */
  env?: EnvLike;
  /** Kill the child (whole process group) after this many ms. 0 or omitted means no timeout. */
  timeoutMs?: number;
  /** Max bytes captured per stream before output is truncated and the child killed. */
  maxOutputBytes?: number;
  /**
   * Cancellation handle. When it fires, the child's process group is killed and
   * the promise rejects with the signal's reason. This is the intended way to
   * stop an in-flight agent run — e.g. a CLI should wire SIGINT to an
   * AbortController and pass its signal here, since a bare SIGINT does not run
   * `process` exit handlers and would otherwise leave a detached child alive.
   */
  signal?: AbortSignal;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  /** Terminating signal name (e.g. "SIGKILL"), or null. Plain string to avoid
   *  forcing @types/node on consumers of the published types. */
  signal: string | null;
  /** True when the child was killed by the configured timeout. */
  timedOut: boolean;
  /** True when either stream reached maxOutputBytes and capture was truncated. */
  truncated: boolean;
}

/**
 * Best-effort SIGKILL of the child's process group (the child is spawned
 * detached), so the agent's MCP/tool subprocesses are reaped with it. A
 * grandchild that starts its OWN session (setsid) escapes the group and is not
 * caught. Falls back to killing the child alone if the group signal fails.
 */
function killChildTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;

  const killChildOnly = () => {
    try {
      child.kill();
    } catch {
      // Already exited; nothing to kill.
    }
  };

  if (process.platform === "win32") {
    // No POSIX process groups on Windows; kill the tree by pid via taskkill.
    // Attach handlers so a spawn failure can't crash the parent with an
    // unhandled 'error' event, and fall back to killing the direct child if
    // taskkill fails to start or exits non-zero (e.g. access denied).
    try {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("error", killChildOnly);
      killer.on("close", (code) => {
        if (code !== 0) killChildOnly();
      });
    } catch {
      killChildOnly();
    }
    return;
  }

  try {
    process.kill(-pid, "SIGKILL"); // negative pid targets the whole group
  } catch {
    killChildOnly();
  }
}

function validateTimeoutMs(ms: number | undefined): void {
  if (ms === undefined) return;
  // Reject non-finite / negative / over-max: Node would otherwise coerce them to
  // a 1ms delay (immediate kill), which is never what the caller meant.
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_TIMER_MS) {
    throw new RangeError(`spawnClean: timeoutMs must be a finite number in [0, ${MAX_TIMER_MS}] ms, got ${ms}`);
  }
}

function validateMaxOutputBytes(bytes: number | undefined): void {
  if (bytes === undefined) return;
  // NaN/Infinity/<=0 would break the cap comparison and defeat the OOM guard.
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new RangeError(`spawnClean: maxOutputBytes must be a positive finite number, got ${bytes}`);
  }
}

/**
 * Spawn a command with a sanitized environment (see {@link sanitizeEnv}): the
 * credential-hijack vars are stripped so a spawned agent can't be forced onto
 * metered billing. stdin is not inherited; stdout/stderr are captured as UTF-8.
 * Output is capped ({@link SpawnCleanOptions.maxOutputBytes}) and the child runs
 * in its own process group so a timeout or abort can best-effort reap its
 * subprocess tree.
 *
 * The promise always settles exactly once: a timeout or truncation resolves
 * right after initiating the kill (rather than waiting for 'close', which could
 * hang if the kill fails or a grandchild holds the pipe open). It resolves with
 * the captured output and exit status, and rejects if the process fails to start
 * (e.g. command not found) or the abort signal fires.
 *
 * Throws a RangeError synchronously for an invalid `timeoutMs` or
 * `maxOutputBytes` (non-finite, out of range, or non-positive).
 */
export function spawnClean(
  command: string,
  args: string[] = [],
  options: SpawnCleanOptions = {},
): Promise<SpawnResult> {
  validateTimeoutMs(options.timeoutMs);
  validateMaxOutputBytes(options.maxOutputBytes);

  const env = sanitizeEnv(options.env ?? process.env);
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const { signal } = options;

  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    const out: StreamCapture = { text: "", bytes: 0 };
    const err: StreamCapture = { text: "", bytes: 0 };
    let timedOut = false;
    let truncated = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    // Kill the child if THIS process exits while it is still running, so an agent
    // subprocess can't outlive par and keep billing. Removed once settled.
    const onParentExit = () => killChildTree(child);
    process.once("exit", onParentExit);

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      process.removeListener("exit", onParentExit);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    };

    const snapshot = (code: number | null, sig: string | null): SpawnResult => ({
      stdout: out.text,
      stderr: err.text,
      code,
      signal: sig,
      timedOut,
      truncated,
    });

    // finish/fail settle the promise exactly once and always run cleanup, so no
    // path (including a kill that never completes) can leave it pending or double-settle.
    const finish = (result: SpawnResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    if (signal) {
      onAbort = () => {
        killChildTree(child);
        fail(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killChildTree(child);
        finish(snapshot(null, null));
      }, options.timeoutMs);
    }

    // Single boundary-checked collector for both streams: append a chunk only if
    // it fits under the per-stream cap, otherwise flag truncation and kill the
    // child. Reaching the cap exactly is a full state (never a silent drop), so
    // the next non-empty chunk correctly triggers the kill.
    const capture = (stream: StreamCapture, chunk: string) => {
      if (settled || truncated) return;
      const chunkBytes = Buffer.byteLength(chunk, "utf8");
      if (stream.bytes + chunkBytes <= maxOutputBytes) {
        stream.text += chunk;
        stream.bytes += chunkBytes;
        return;
      }
      truncated = true;
      killChildTree(child);
      finish(snapshot(null, null));
    };

    // setEncoding lets the stream's StringDecoder join multibyte characters that
    // straddle chunk boundaries, so the captured string is never corrupted.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => capture(out, chunk));
    child.stderr?.on("data", (chunk: string) => capture(err, chunk));

    child.on("error", (error) => {
      killChildTree(child);
      fail(error);
    });

    child.on("close", (code, sig) => {
      finish(snapshot(code, sig));
    });
  });
}
