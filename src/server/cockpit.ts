import type { AgentAdapter } from "../adapter/index.js";
import { FakeAdapter } from "../adapter/index.js";
import { Core } from "../core/index.js";
import type { GhClient, RunningServer } from "./server.js";
import { startServer } from "./server.js";

export interface StartCockpitOptions {
  /** Agent adapter; defaults to the offline {@link FakeAdapter}. */
  adapter?: AgentAdapter;
  /** gh client override (defaults to the real one) — used in tests. */
  gh?: GhClient;
  /** Port to bind; 0 (the default) picks an ephemeral free port. */
  port?: number;
  /** Host to bind; defaults to loopback. */
  host?: string;
  /** Bearer token; auto-generated if omitted. */
  token?: string;
  /** Absolute path to the built UI (dist/ui); when set, it is served at `/`. */
  uiDir?: string;
}

export interface Cockpit extends RunningServer {
  /** The Core this cockpit owns. */
  core: Core;
}

/**
 * Compose a Core (with the default offline adapter) and the HTTP server, and
 * start listening. This is the whole runnable backend in one call; the CLI wraps
 * it with argument parsing and signal handling.
 *
 * `close()` stops the server (aborting in-flight requests) AND removes every
 * worktree the session opened — the full, owned shutdown.
 */
export async function startCockpit(options: StartCockpitOptions = {}): Promise<Cockpit> {
  const core = new Core({ adapter: options.adapter ?? new FakeAdapter() });
  const server = await startServer({
    core,
    gh: options.gh,
    port: options.port,
    host: options.host,
    token: options.token,
    uiDir: options.uiDir,
  });
  return {
    ...server,
    core,
    close: async () => {
      await server.close();
      await core.closeAll();
    },
  };
}
