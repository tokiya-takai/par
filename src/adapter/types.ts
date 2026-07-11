import type { Answer, CodeAnchor } from "../domain/types";

/** One turn of a multi-turn discussion. */
export interface ThreadTurn {
  question: string;
  answer?: Answer;
}

/** Input to a single agent invocation. */
export interface InvokeInput {
  /** The agent's cwd — where file read/grep is grounded. */
  worktreePath: string;
  question: string;
  codeAnchor: CodeAnchor;
  /** References the agent resolves with its own connectors. */
  referenceUrls: string[];
  /** Prior turns, for history-replay threading. */
  threadHistory: ThreadTurn[];
  /** Optional handle for session-continuation threading (e.g. `claude --resume`). */
  sessionId?: string;
}

/** An adapter's self-declared capabilities, for UI feature-gating. */
export interface Capabilities {
  /** Multi-turn by replaying threadHistory into each invoke (stateless). */
  historyReplay: boolean;
  /** Multi-turn via a native resumable session, e.g. `claude --resume`. */
  sessionContinuation: boolean;
  connectors: string[] | "unknown";
}

/**
 * The single seam that isolates agent invocation. Core depends only on this
 * interface, never on any concrete agent's specifics, so swapping the default
 * (a local `claude` agent) for another implementation is one line.
 *
 * `invoke` is Promise-based; a future push-model adapter (Core acting as an MCP
 * server) can resolve the promise when the answer arrives, so Core needs no rework.
 */
export interface AgentAdapter {
  readonly name: string;
  invoke(input: InvokeInput): Promise<Answer>;
  capabilities(): Capabilities;
}
