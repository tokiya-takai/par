import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeAdapter } from "../../src/adapter/index";
import { Core } from "../../src/core/index";
import type { Repository } from "../../src/domain/index";
import { listWorktrees } from "../../src/git/index";
import { runGit } from "../../src/git/run";

describe("Core (end-to-end through FakeAdapter + real git worktree)", () => {
  let root: string;
  let repo: Repository;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "par-core-"));
    const repoPath = join(root, "repo");
    await mkdir(repoPath, { recursive: true });
    await runGit(["init", "-b", "main"], { cwd: repoPath });
    await writeFile(join(repoPath, "a.ts"), "export const x = 1;\n");
    await runGit(["add", "."], { cwd: repoPath });
    await runGit(
      ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "init"],
      { cwd: repoPath },
    );
    repo = {
      id: "repo-1",
      name: "repo",
      localPath: repoPath,
      remote: "origin",
      worktreeRoot: join(root, "wts"),
    };
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("registers a repo, opens a target (worktree), and answers a question with two-sided anchors", async () => {
    const core = new Core({ adapter: new FakeAdapter() });
    core.registerRepository(repo);
    expect(core.listRepositories()).toHaveLength(1);

    const target = await core.openReviewTarget({ repositoryId: "repo-1", base: "main", head: "main" });
    expect(target.worktreePath).toContain("rt-");

    const { answer, evidence, comment } = await core.ask({
      reviewTargetId: target.id,
      codeAnchor: { filePath: "a.ts", line: 1, side: "new" },
      question: "Is this consistent with the design doc?",
      referenceUrls: ["https://www.notion.so/design#block"],
    });

    expect(answer.codeAnchors.length).toBeGreaterThan(0);
    expect(answer.sourceAnchors.length).toBeGreaterThan(0);
    expect(evidence).toBe("sufficient");
    expect(core.commentsForTarget(target.id)).toContainEqual(comment);
  });

  it("carries thread history across turns (history replay)", async () => {
    const core = new Core({ adapter: new FakeAdapter() });
    core.registerRepository(repo);
    const target = await core.openReviewTarget({ repositoryId: "repo-1", base: "main", head: "main" });

    const first = await core.ask({
      reviewTargetId: target.id,
      codeAnchor: { filePath: "a.ts", line: 1, side: "new" },
      question: "first?",
      referenceUrls: ["https://ref"],
    });
    const second = await core.ask({
      reviewTargetId: target.id,
      codeAnchor: { filePath: "a.ts", line: 1, side: "new" },
      question: "follow-up?",
      referenceUrls: ["https://ref"],
      threadId: first.comment.threadId,
    });

    expect(second.comment.threadId).toBe(first.comment.threadId);
    expect(second.answer.reasoning).toContain("turn 2"); // FakeAdapter reflects prior turns
  });

  it("treats a pure-code question (no reference) as sufficient with code anchors alone", async () => {
    const core = new Core({ adapter: new FakeAdapter() });
    core.registerRepository(repo);
    const target = await core.openReviewTarget({ repositoryId: "repo-1", base: "main", head: "main" });

    const { evidence } = await core.ask({
      reviewTargetId: target.id,
      codeAnchor: { filePath: "a.ts", line: 1, side: "new" },
      question: "Is this DRY?",
    });
    expect(evidence).toBe("sufficient"); // referencesRequested=false → code anchors suffice
  });

  it("rejects ask/open on unknown ids and an unknown threadId", async () => {
    const core = new Core({ adapter: new FakeAdapter() });
    await expect(
      core.openReviewTarget({ repositoryId: "nope", base: "main", head: "main" }),
    ).rejects.toThrow(/unknown repository/);
    await expect(
      core.ask({ reviewTargetId: "nope", codeAnchor: { filePath: "a.ts", line: 1 }, question: "?" }),
    ).rejects.toThrow(/unknown review target/);

    core.registerRepository(repo);
    const target = await core.openReviewTarget({ repositoryId: "repo-1", base: "main", head: "main" });
    await expect(
      core.ask({
        reviewTargetId: target.id,
        codeAnchor: { filePath: "a.ts", line: 1 },
        question: "?",
        threadId: "does-not-exist",
      }),
    ).rejects.toThrow(/unknown thread/);
  });

  it("closeReviewTarget removes the worktree and drops the target", async () => {
    const core = new Core({ adapter: new FakeAdapter() });
    core.registerRepository(repo);
    const target = await core.openReviewTarget({ repositoryId: "repo-1", base: "main", head: "main" });
    const path = target.worktreePath as string;
    expect((await listWorktrees(repo.localPath)).some((w) => w.path === path)).toBe(true);

    await core.closeReviewTarget(target.id);
    expect((await listWorktrees(repo.localPath)).some((w) => w.path === path)).toBe(false);
    expect(core.getReviewTarget(target.id)).toBeUndefined();
    // Idempotent.
    await core.closeReviewTarget(target.id);
  });

  it("keeps the target (and throws) when the worktree can't be removed", async () => {
    const core = new Core({ adapter: new FakeAdapter() });
    core.registerRepository(repo);
    const target = await core.openReviewTarget({ repositoryId: "repo-1", base: "main", head: "main" });
    const path = target.worktreePath as string;
    // Dirty the worktree so `git worktree remove` (non-force) refuses.
    await writeFile(join(path, "a.ts"), "export const x = 2; // modified\n");

    await expect(core.closeReviewTarget(target.id)).rejects.toBeDefined();
    // Removal failed → state retained so the caller can retry; no silent loss.
    expect(core.getReviewTarget(target.id)).toBeDefined();
    expect((await listWorktrees(repo.localPath)).some((w) => w.path === path)).toBe(true);
  });

  it("serializes concurrent asks on one thread (no lost history)", async () => {
    const core = new Core({ adapter: new FakeAdapter() });
    core.registerRepository(repo);
    const target = await core.openReviewTarget({ repositoryId: "repo-1", base: "main", head: "main" });
    const anchor = { filePath: "a.ts", line: 1, side: "new" as const };

    const first = await core.ask({ reviewTargetId: target.id, codeAnchor: anchor, question: "q1" });
    const threadId = first.comment.threadId;

    // Fire two follow-ups on the same thread at once. Serialized, the second must
    // observe the first's turn — never both "turn 2".
    const [a, b] = await Promise.all([
      core.ask({ reviewTargetId: target.id, codeAnchor: anchor, question: "q2", threadId }),
      core.ask({ reviewTargetId: target.id, codeAnchor: anchor, question: "q3", threadId }),
    ]);
    const reasonings = [a.answer.reasoning, b.answer.reasoning];
    expect(reasonings.some((r) => r.includes("turn 2"))).toBe(true);
    expect(reasonings.some((r) => r.includes("turn 3"))).toBe(true);
    expect(core.commentsForTarget(target.id)).toHaveLength(3);
  });

  it("does not orphan a comment when close races an in-flight ask", async () => {
    const core = new Core({ adapter: new FakeAdapter() });
    core.registerRepository(repo);
    const target = await core.openReviewTarget({ repositoryId: "repo-1", base: "main", head: "main" });

    // Whichever wins the target lock, we must never end with a comment whose
    // target is gone.
    await Promise.all([
      core
        .ask({ reviewTargetId: target.id, codeAnchor: { filePath: "a.ts", line: 1 }, question: "q" })
        .catch(() => undefined),
      core.closeReviewTarget(target.id),
    ]);

    expect(core.getReviewTarget(target.id)).toBeUndefined();
    expect(core.commentsForTarget(target.id)).toHaveLength(0);
  });
});
