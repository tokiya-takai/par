// Mirror of the server's domain types. Everything is camelCase on the wire (the
// server serializes domain objects verbatim); the only snake_case lives inside
// the agent adapter's wire contract, which the UI never sees.

export type DiffSide = "old" | "new";
export type PullRequestState = "open" | "merged" | "closed";
export type PrStateFilter = "open" | "closed" | "merged" | "all";
export type EvidenceStrength = "sufficient" | "insufficient";

export const KNOWN_VERDICTS = ["aligned", "misaligned", "dry_violation", "needs_info"] as const;

export interface CodeAnchor {
  filePath: string;
  line: number | [number, number];
  side?: DiffSide;
}

export interface SourceAnchor {
  url: string;
  label: string;
}

export interface AgentMeta {
  adapter: string;
  model?: string;
  sessionId?: string;
}

export interface Answer {
  verdict?: string;
  reasoning: string;
  codeAnchors: CodeAnchor[];
  sourceAnchors: SourceAnchor[];
  agentMeta: AgentMeta;
}

export interface Comment {
  id: string;
  reviewTargetId: string;
  codeAnchor: CodeAnchor;
  question: string;
  referenceUrls: string[];
  threadId: string;
  answers: Answer[];
}

export interface Repository {
  id: string;
  name: string;
  localPath: string;
  remote: string;
  worktreeRoot: string;
}

export interface ReviewThread {
  id: string;
  body?: string;
  resolved: boolean;
}

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  url: string;
  state: PullRequestState;
  baseRef: string;
  headRef: string;
  reviewThreads?: ReviewThread[];
  ciStatus?: string;
}

export interface ReviewTarget {
  id: string;
  repositoryId: string;
  base: string;
  head: string;
  mergeBase?: string;
  pr?: PullRequest;
  worktreePath?: string;
}

export interface Capabilities {
  historyReplay: boolean;
  sessionContinuation: boolean;
  connectors: string[] | "unknown";
}

export interface AnsweredComment {
  comment: Comment;
  answer: Answer;
  evidence: EvidenceStrength;
}
