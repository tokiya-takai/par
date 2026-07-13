import { randomUUID } from "node:crypto";
import type { AgentAdapter, Capabilities, ThreadTurn } from "../adapter/index.js";
import {
  type Answer,
  type CodeAnchor,
  type Comment,
  type EvidenceStrength,
  type PullRequest,
  type Repository,
  type ReviewTarget,
  evidenceStrengthForComment,
} from "../domain/index.js";
import { acquireWorktree, listWorktrees, removeWorktree } from "../git/index.js";

export interface CoreOptions {
  /** Adapter used to answer questions (FakeAdapter now; the real `claude` adapter later). */
  adapter: AgentAdapter;
}

export interface OpenReviewTargetInput {
  repositoryId: string;
  /** Comparison base (e.g. "origin/main"). */
  base: string;
  /** The ref/commit to check out for review (a PR head or a local branch tip). */
  head: string;
  /** Optional PR metadata (resolved elsewhere, e.g. the gh client). */
  pr?: PullRequest;
  /** Optional fetch to run before acquiring the worktree — e.g. a PR head. */
  fetch?: { remote: string; refspec: string };
  /** Per-git-op timeout (ms) for the acquire; 0 disables (raise for a slow fetch). */
  timeoutMs?: number;
}

export interface AskInput {
  reviewTargetId: string;
  codeAnchor: CodeAnchor;
  question: string;
  referenceUrls?: string[];
  /** Continue an existing thread on this target; omit to start a new one. */
  threadId?: string;
  /** Optional cancellation, forwarded to the adapter (e.g. the caller disconnects). */
  signal?: AbortSignal;
}

export interface AnsweredComment {
  comment: Comment;
  answer: Answer;
  /** Whether the answer clears the two-sided-anchor bar (drives the UI "根拠不足" badge). */
  evidence: EvidenceStrength;
}

/**
 * The thin orchestrator: it holds which repos/targets exist, routes a question
 * at a code position to the target's worktree agent, and stores the anchored
 * answer. Intelligence lives in the agent; this is just the wiring.
 *
 * State is in-memory for now (a persistent store is a later increment). Pure
 * logic — no server; a transport/UI layer wraps this next. `ask` and
 * `closeReviewTarget` are serialized per review target so overlapping calls
 * can't lose thread history or leave orphaned state.
 */
export class Core {
  private readonly repos = new Map<string, Repository>();
  private readonly targets = new Map<string, ReviewTarget>();
  private readonly comments = new Map<string, Comment>();
  private readonly targetLocks = new Map<string, Promise<unknown>>();
  private readonly adapter: AgentAdapter;

  constructor(options: CoreOptions) {
    this.adapter = options.adapter;
  }

  registerRepository(repo: Repository): void {
    this.repos.set(repo.id, repo);
  }

  listRepositories(): Repository[] {
    return [...this.repos.values()];
  }

  getRepository(repositoryId: string): Repository | undefined {
    return this.repos.get(repositoryId);
  }

  /** The adapter's self-declared capabilities, for UI feature-gating. */
  capabilities(): Capabilities {
    return this.adapter.capabilities();
  }

  /** Acquire (or reuse) the worktree for `head` and create a review target for it. */
  async openReviewTarget(input: OpenReviewTargetInput): Promise<ReviewTarget> {
    const repo = this.repos.get(input.repositoryId);
    if (!repo) {
      throw new Error(`unknown repository: ${input.repositoryId}`);
    }

    const id = randomUUID();
    const worktree = await acquireWorktree({
      repoPath: repo.localPath,
      worktreeRoot: repo.worktreeRoot,
      key: `rt-${id}`,
      ref: input.head,
      fetch: input.fetch,
      timeoutMs: input.timeoutMs,
    });

    const target: ReviewTarget = {
      id,
      repositoryId: repo.id,
      base: input.base,
      head: input.head,
      pr: input.pr,
      worktreePath: worktree.path,
    };
    this.targets.set(id, target);
    return target;
  }

  getReviewTarget(reviewTargetId: string): ReviewTarget | undefined {
    return this.targets.get(reviewTargetId);
  }

  /**
   * Ask a question at a code position on a review target. Invokes the adapter in
   * the target's worktree (with the thread's prior turns for context), stores the
   * answer as a Comment, and returns it with its evidence strength. Serialized
   * per target, so a concurrent ask sees the prior turn and a concurrent close
   * cannot orphan the stored comment.
   */
  ask(input: AskInput): Promise<AnsweredComment> {
    return this.withTargetLock(input.reviewTargetId, () => this.performAsk(input));
  }

  private async performAsk(input: AskInput): Promise<AnsweredComment> {
    const target = this.targets.get(input.reviewTargetId);
    if (!target) {
      throw new Error(`unknown review target: ${input.reviewTargetId}`);
    }
    if (target.worktreePath === undefined) {
      throw new Error(`no worktree for review target: ${input.reviewTargetId}`);
    }
    if (input.threadId !== undefined && !this.threadExists(input.reviewTargetId, input.threadId)) {
      throw new Error(`unknown thread on target ${input.reviewTargetId}: ${input.threadId}`);
    }

    // Drop blank entries so an empty URL doesn't read as "a reference was requested".
    const referenceUrls = (input.referenceUrls ?? []).filter((url) => url.trim() !== "");
    const threadId = input.threadId ?? randomUUID();
    const threadHistory = this.buildThreadHistory(input.reviewTargetId, threadId);

    const answer = await this.adapter.invoke({
      worktreePath: target.worktreePath,
      question: input.question,
      codeAnchor: input.codeAnchor,
      referenceUrls,
      threadHistory,
      signal: input.signal,
    });

    const comment: Comment = {
      id: randomUUID(),
      reviewTargetId: input.reviewTargetId,
      codeAnchor: input.codeAnchor,
      question: input.question,
      referenceUrls,
      threadId,
      answers: [answer],
    };
    this.comments.set(comment.id, comment);

    return { comment, answer, evidence: evidenceStrengthForComment(comment, answer) };
  }

  /** All comments on a review target, in creation order. */
  commentsForTarget(reviewTargetId: string): Comment[] {
    return [...this.comments.values()].filter((c) => c.reviewTargetId === reviewTargetId);
  }

  /**
   * Remove a target's worktree and drop its state. Serialized per target. If the
   * worktree removal fails and the worktree is still registered (e.g. dirty or
   * locked), the target is KEPT and the error is thrown so the caller can retry —
   * state is dropped only on a real removal or when the worktree is already gone.
   */
  closeReviewTarget(reviewTargetId: string): Promise<void> {
    return this.withTargetLock(reviewTargetId, () => this.performClose(reviewTargetId));
  }

  private async performClose(reviewTargetId: string): Promise<void> {
    const target = this.targets.get(reviewTargetId);
    if (!target) return;

    const repo = this.repos.get(target.repositoryId);
    if (repo && target.worktreePath !== undefined) {
      try {
        await removeWorktree(repo.localPath, target.worktreePath);
      } catch (error) {
        // Only proceed to drop state if the worktree is actually gone; otherwise
        // keep the target so the caller can retry (a dirty/locked tree still exists).
        if (await this.worktreeStillRegistered(repo.localPath, target.worktreePath)) {
          throw error;
        }
      }
    }

    this.targets.delete(reviewTargetId);
    for (const [id, comment] of this.comments) {
      if (comment.reviewTargetId === reviewTargetId) this.comments.delete(id);
    }
  }

  /** Close every open target (e.g. on shutdown); rejects if any close fails. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.targets.keys()].map((id) => this.closeReviewTarget(id)));
  }

  private async worktreeStillRegistered(repoPath: string, worktreePath: string): Promise<boolean> {
    try {
      return (await listWorktrees(repoPath)).some((w) => w.path === worktreePath);
    } catch {
      return true; // can't confirm removal — assume it's still there (keep state)
    }
  }

  /** Serialize operations on one review target through a per-target promise chain. */
  private withTargetLock<T>(reviewTargetId: string, op: () => Promise<T>): Promise<T> {
    const prior = this.targetLocks.get(reviewTargetId) ?? Promise.resolve();
    const result = prior.then(op, op);
    this.targetLocks.set(
      reviewTargetId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  private threadExists(reviewTargetId: string, threadId: string): boolean {
    return [...this.comments.values()].some(
      (c) => c.reviewTargetId === reviewTargetId && c.threadId === threadId,
    );
  }

  private buildThreadHistory(reviewTargetId: string, threadId: string): ThreadTurn[] {
    return [...this.comments.values()]
      .filter((c) => c.reviewTargetId === reviewTargetId && c.threadId === threadId)
      .map((c) => ({ question: c.question, answer: c.answers.at(-1) }));
  }
}
