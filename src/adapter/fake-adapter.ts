import type { Answer, CodeAnchor, SourceAnchor } from "../domain/types.js";
import type { AgentAdapter, Capabilities, InvokeInput } from "./types.js";

export interface FakeAdapterOptions {
  /**
   * When false, the answer carries NO source anchors even if the question
   * supplied reference URLs — simulating a confident-but-ungrounded agent
   * answer, which the UI must weaken as "根拠不足". Defaults to true: the fake
   * grounds its answer in the references it was given.
   */
  grounded?: boolean;
}

function formatLine(line: CodeAnchor["line"]): string {
  return Array.isArray(line) ? `${line[0]}-${line[1]}` : `${line}`;
}

/**
 * Offline adapter. Returns a deterministic Answer so the whole Core→UI dataflow
 * runs end-to-end without invoking any real agent (no external process, no
 * billing, no connectors). Swapping this for the real agent adapter is the
 * single seam on {@link AgentAdapter}.
 *
 * Fidelity: it never fabricates evidence. Source anchors mirror exactly the
 * reference URLs it was given (none → none) and the code anchor preserves the
 * question's line/range — the real agent likewise returns only what it produced.
 */
export class FakeAdapter implements AgentAdapter {
  readonly name = "fake";

  constructor(private readonly options: FakeAdapterOptions = {}) {}

  capabilities(): Capabilities {
    // Honest: the fake consumes threadHistory (history replay) but keeps no
    // real resumable session, so it does not do session continuation.
    return { historyReplay: true, sessionContinuation: false, connectors: "unknown" };
  }

  async invoke(input: InvokeInput): Promise<Answer> {
    const grounded = this.options.grounded ?? true;
    const { filePath, line } = input.codeAnchor;
    const turn = input.threadHistory.length + 1;

    const sourceAnchors: SourceAnchor[] = grounded
      ? input.referenceUrls.map((url, i) => ({ url, label: `reference ${i + 1}` }))
      : [];

    return {
      verdict: grounded ? "aligned" : "needs_info",
      reasoning: `(fake) turn ${turn}: considered "${input.question}" against ${filePath}:${formatLine(line)} in ${input.worktreePath}.`,
      codeAnchors: [{ filePath, line }],
      sourceAnchors,
      agentMeta: { adapter: this.name, sessionId: input.sessionId },
    };
  }
}
