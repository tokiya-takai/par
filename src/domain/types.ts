/**
 * par domain model.
 *
 * Wire note: the agent's JSON contract uses snake_case (`code_anchors`, key
 * `file`). These internal types are camelCase; the translation happens only at
 * the agent-adapter boundary, not here.
 */

/** Which side of a diff an anchor refers to. */
export type DiffSide = "old" | "new";

/**
 * A location in code. Used both for a question's target and for answer
 * evidence. `side` is only meaningful for in-diff placement (the question
 * anchor); answer evidence anchors omit it.
 */
export interface CodeAnchor {
  filePath: string;
  /** A single line, or an inclusive [start, end] range. */
  line: number | [number, number];
  side?: DiffSide;
}

/** A location in an external reference, e.g. a Notion block URL. */
export interface SourceAnchor {
  url: string;
  label: string;
}

/** A registered local repository. */
export interface Repository {
  id: string;
  name: string;
  localPath: string;
  remote: string;
  worktreeRoot: string;
}

export type PullRequestState = "open" | "merged" | "closed";

/** A review thread imported from the PR. Minimal for now. */
export interface ReviewThread {
  id: string;
  body?: string;
  resolved: boolean;
}

/** PR metadata — an optional property of a ReviewTarget. */
export interface PullRequest {
  number: number;
  title: string;
  author: string;
  url: string;
  state: PullRequestState;
  baseRef: string;
  headRef: string;
  /** Absent = not fetched yet; `[]` = fetched, none. (Import needs the GraphQL API.) */
  reviewThreads?: ReviewThread[];
  ciStatus?: string;
}

/**
 * The central concept: what to review = diff(base..head) + optional PR metadata.
 * A PR is not a branch: PR mode is primary and carries metadata; local-branch
 * mode is the degenerate case where `pr` is absent.
 */
export interface ReviewTarget {
  id: string;
  repositoryId: string;
  base: string;
  head: string;
  mergeBase?: string;
  pr?: PullRequest;
  worktreeId?: string;
}

/** An isolated checkout of a PR head; the agent's cwd. */
export interface Worktree {
  id: string;
  repositoryId: string;
  path: string;
  ref: string;
  reviewTargetId: string;
  /** ISO-8601 timestamp, used for LRU GC. */
  lastUsedAt: string;
}

/**
 * The well-known verdict labels. Single source of truth for both the type and
 * the runtime guard, so they can't drift. NOT exhaustive and NOT the field
 * type: `Answer.verdict` is an open free-form string — material for the human
 * to judge, not something to switch on.
 */
export const KNOWN_VERDICTS = ["aligned", "misaligned", "dry_violation", "needs_info"] as const;
export type KnownVerdict = (typeof KNOWN_VERDICTS)[number];

/** Runtime guard: is `verdict` one of the well-known labels? */
export function isKnownVerdict(verdict: string | undefined): verdict is KnownVerdict {
  return verdict !== undefined && (KNOWN_VERDICTS as readonly string[]).includes(verdict);
}

/** Which adapter/model/session produced an answer. */
export interface AgentMeta {
  adapter: string;
  model?: string;
  sessionId?: string;
}

/**
 * An agent answer. Must carry both-sided evidence to be trusted: `codeAnchors`
 * (the code backing the claim) and `sourceAnchors` (the reference it was
 * checked against).
 */
export interface Answer {
  /** Open free-form label; see {@link KnownVerdict} for the common values. */
  verdict?: string;
  reasoning: string;
  codeAnchors: CodeAnchor[];
  sourceAnchors: SourceAnchor[];
  agentMeta: AgentMeta;
}

/** The one comment primitive: a code position + a question + references. */
export interface Comment {
  id: string;
  reviewTargetId: string;
  codeAnchor: CodeAnchor;
  question: string;
  referenceUrls: string[];
  threadId: string;
  answers: Answer[];
}

export type EvidenceStrength = "sufficient" | "insufficient";

export interface EvidenceStrengthOptions {
  /**
   * Whether the question expected an external reference (i.e. its Comment
   * carried `referenceUrls`). true → both anchor sides required (the answer must
   * cite both the code and the reference it was checked against). false → a
   * pure-code question (e.g. type consistency, DRY, tracing an internal call)
   * is sufficient with code anchors alone, since it has no external source.
   *
   * Required, not optional: this is the central rubber-stamp guardrail, so the
   * caller must state intent rather than fall back to a silent default. Prefer
   * {@link evidenceStrengthForComment}, which derives it from the Comment.
   */
  referencesRequested: boolean;
}

/**
 * Mechanical two-sided-anchor check. An answer judged "insufficient" is shown
 * weakly ("根拠不足") in the UI — product policy that stops the tool becoming a
 * rubber stamp, not a UI convenience.
 */
export function evidenceStrength(
  answer: Answer,
  opts: EvidenceStrengthOptions,
): EvidenceStrength {
  const hasCode = answer.codeAnchors.length > 0;
  const hasSource = answer.sourceAnchors.length > 0;
  const sufficient = hasCode && (opts.referencesRequested ? hasSource : true);
  return sufficient ? "sufficient" : "insufficient";
}

/**
 * Evidence strength for one of a comment's answers, deriving the
 * "was a reference expected?" signal from the comment itself so call sites
 * can't forget it. This is the API the UI badge should use.
 */
export function evidenceStrengthForComment(comment: Comment, answer: Answer): EvidenceStrength {
  return evidenceStrength(answer, { referencesRequested: comment.referenceUrls.length > 0 });
}
