import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitError, runGit } from "../../src/git/run";
import {
  DirtyWorktreeError,
  acquireWorktree,
  listWorktrees,
  parseWorktreePorcelain,
  removeWorktree,
} from "../../src/git/worktree";

describe("parseWorktreePorcelain", () => {
  it("parses attached and detached worktrees (NUL-separated)", () => {
    const out = [
      "worktree /repo",
      `HEAD ${"1".repeat(40)}`,
      "branch refs/heads/main",
      "",
      "worktree /repo/.wts/wt-1",
      `HEAD ${"2".repeat(40)}`,
      "detached",
      "",
    ].join("\0");

    const wts = parseWorktreePorcelain(out);
    expect(wts).toHaveLength(2);
    expect(wts[0]).toEqual({ path: "/repo", head: "1".repeat(40), branch: "refs/heads/main" });
    expect(wts[1]).toEqual({ path: "/repo/.wts/wt-1", head: "2".repeat(40), branch: null });
  });

  it("preserves a path that contains a newline", () => {
    const out = ["worktree /repo/wt\nnl", `HEAD ${"3".repeat(40)}`, "detached", ""].join("\0");
    const wts = parseWorktreePorcelain(out);
    expect(wts).toHaveLength(1);
    expect(wts[0]?.path).toBe("/repo/wt\nnl");
    expect(wts[0]?.branch).toBeNull();
  });

  it("returns an empty list for empty input", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
  });
});

describe("worktree manager (integration, real git)", () => {
  let root: string;
  let repoPath: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "par-wt-"));
    repoPath = join(root, "repo");
    await mkdir(repoPath, { recursive: true });
    await runGit(["init", "-b", "main"], { cwd: repoPath });
    await writeFile(join(repoPath, "a.txt"), "hello\n");
    await runGit(["add", "."], { cwd: repoPath });
    await runGit(
      ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "init"],
      { cwd: repoPath },
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("acquires a detached worktree, lists it, and reuses it idempotently", async () => {
    const opts = { repoPath, worktreeRoot: join(root, "wts"), key: "wt-1", ref: "main" };

    const first = await acquireWorktree(opts);
    expect(first.path.endsWith("wt-1")).toBe(true);
    expect(first.branch).toBeNull(); // detached
    expect((await listWorktrees(repoPath)).some((w) => w.path === first.path)).toBe(true);

    const second = await acquireWorktree(opts);
    expect(second.path).toBe(first.path); // reused, not re-added
  });

  it("serializes concurrent same-key acquires (no TOCTOU race)", async () => {
    const opts = { repoPath, worktreeRoot: join(root, "wts"), key: "wt-race", ref: "main" };
    const [a, b] = await Promise.all([acquireWorktree(opts), acquireWorktree(opts)]);
    expect(a.path).toBe(b.path);
    expect((await listWorktrees(repoPath)).filter((w) => w.path === a.path)).toHaveLength(1);
  });

  it("removes a worktree", async () => {
    const opts = { repoPath, worktreeRoot: join(root, "wts"), key: "wt-2", ref: "main" };
    const wt = await acquireWorktree(opts);

    await removeWorktree(repoPath, wt.path);
    expect((await listWorktrees(repoPath)).some((w) => w.path === wt.path)).toBe(false);
  });

  it("refuses to force-remove a locked worktree (single --force only)", async () => {
    const opts = { repoPath, worktreeRoot: join(root, "wts"), key: "wt-locked", ref: "main" };
    const wt = await acquireWorktree(opts);
    await runGit(["worktree", "lock", wt.path], { cwd: repoPath });
    try {
      await expect(removeWorktree(repoPath, wt.path, { force: true })).rejects.toThrow(GitError);
    } finally {
      await runGit(["worktree", "unlock", wt.path], { cwd: repoPath });
    }
  });

  it("refreshes a reused worktree to the ref's new head", async () => {
    const opts = { repoPath, worktreeRoot: join(root, "wts"), key: "wt-3", ref: "main" };
    const first = await acquireWorktree(opts);

    await writeFile(join(repoPath, "b.txt"), "more\n");
    await runGit(["add", "."], { cwd: repoPath });
    await runGit(
      ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "second"],
      { cwd: repoPath },
    );
    const newHead = (await runGit(["rev-parse", "HEAD"], { cwd: repoPath })).stdout.trim();

    const refreshed = await acquireWorktree(opts);
    expect(refreshed.path).toBe(first.path);
    expect(refreshed.head).toBe(newHead);
    expect(refreshed.head).not.toBe(first.head);
  });

  it("refuses to reuse a dirty worktree (modified tracked or untracked files)", async () => {
    const opts = { repoPath, worktreeRoot: join(root, "wts"), key: "wt-dirty", ref: "main" };
    const wt = await acquireWorktree(opts);

    await writeFile(join(wt.path, "a.txt"), "locally changed\n"); // modified tracked
    await writeFile(join(wt.path, "untracked.txt"), "stray\n"); // untracked

    await expect(acquireWorktree(opts)).rejects.toThrow(DirtyWorktreeError);
  });

  it("rejects an unsafe key (path traversal / non-segment)", async () => {
    const base = { repoPath, worktreeRoot: join(root, "wts"), ref: "main" };
    await expect(acquireWorktree({ ...base, key: "../evil" })).rejects.toThrow(/invalid worktree key/);
    await expect(acquireWorktree({ ...base, key: "" })).rejects.toThrow(/invalid worktree key/);
    await expect(acquireWorktree({ ...base, key: "a/b" })).rejects.toThrow(/invalid worktree key/);
    await expect(acquireWorktree({ ...base, key: "a\nb" })).rejects.toThrow(/invalid worktree key/);
  });

  it("rejects an option-injecting ref / remote / refspec", async () => {
    const base = { repoPath, worktreeRoot: join(root, "wts"), key: "wt-inj" };
    await expect(
      acquireWorktree({ ...base, ref: "--upload-pack=touch /tmp/pwned" }),
    ).rejects.toThrow(/must not begin/);
    await expect(
      acquireWorktree({ ...base, ref: "main", fetch: { remote: "-x", refspec: "main" } }),
    ).rejects.toThrow(/must not begin/);
  });
});
