import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeAdapter } from "../../src/adapter/index";
import { Core } from "../../src/core/index";
import type { PullRequest, Repository } from "../../src/domain/index";
import { listWorktrees } from "../../src/git/index";
import { runGit } from "../../src/git/run";
import {
  type GhClient,
  type RunningServer,
  createServer,
  formatBaseUrl,
  isLoopbackHost,
  startCockpit,
  startServer,
} from "../../src/server/index";

const fakePr: PullRequest = {
  number: 1,
  title: "First",
  author: "alice",
  url: "https://example.test/pr/1",
  state: "open",
  baseRef: "main",
  headRef: "feature/x",
};

type TargetJson = { id: string; worktreePath?: string };
type AnsweredJson = { evidence: string; answer: { codeAnchors: unknown[] } };

const fakeGh: GhClient = {
  async listPullRequests() {
    return [fakePr];
  },
  async getPullRequestDiff() {
    return "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
  },
};

describe("HTTP server (Hono transport)", () => {
  let root: string;
  let repo: Repository;
  const servers: RunningServer[] = [];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "par-server-"));
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

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) await server.close();
    }
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function boot(): Promise<RunningServer> {
    const core = new Core({ adapter: new FakeAdapter() });
    const server = await startServer({ core, gh: fakeGh });
    servers.push(server);
    return server;
  }

  function auth(server: RunningServer, extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${server.token}`,
      "content-type": "application/json",
      ...extra,
    };
  }

  async function registerRepo(server: RunningServer): Promise<void> {
    const res = await fetch(`${server.url}/api/repositories`, {
      method: "POST",
      headers: auth(server),
      body: JSON.stringify(repo),
    });
    expect(res.status).toBe(201);
  }

  it("serves health without a token", async () => {
    const server = await boot();
    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects API calls with no or a wrong token", async () => {
    const server = await boot();
    expect((await fetch(`${server.url}/api/repositories`)).status).toBe(401);
    const wrong = await fetch(`${server.url}/api/repositories`, {
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.status).toBe(401);
  });

  it("registers and lists repositories, and reports capabilities", async () => {
    const server = await boot();
    await registerRepo(server);

    const list = await fetch(`${server.url}/api/repositories`, { headers: auth(server) });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([repo]);

    const caps = await fetch(`${server.url}/api/capabilities`, { headers: auth(server) });
    expect(await caps.json()).toEqual({
      historyReplay: true,
      sessionContinuation: false,
      connectors: "unknown",
    });
  });

  it("400s a malformed repository body", async () => {
    const server = await boot();
    const res = await fetch(`${server.url}/api/repositories`, {
      method: "POST",
      headers: auth(server),
      body: JSON.stringify({ id: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("lists pull requests via the injected gh client (404 for unknown repo)", async () => {
    const server = await boot();
    await registerRepo(server);

    const ok = await fetch(`${server.url}/api/repositories/repo-1/pull-requests`, {
      headers: auth(server),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([fakePr]);

    const missing = await fetch(`${server.url}/api/repositories/nope/pull-requests`, {
      headers: auth(server),
    });
    expect(missing.status).toBe(404);
  });

  it("opens a review target, reads it back, and serves its diff", async () => {
    const server = await boot();
    await registerRepo(server);

    const openRes = await fetch(`${server.url}/api/review-targets`, {
      method: "POST",
      headers: auth(server),
      body: JSON.stringify({ repositoryId: "repo-1", base: "main", head: "main", pr: fakePr }),
    });
    expect(openRes.status).toBe(201);
    const target = (await openRes.json()) as TargetJson;
    expect(target.worktreePath).toContain("rt-");

    const getRes = await fetch(`${server.url}/api/review-targets/${target.id}`, {
      headers: auth(server),
    });
    expect(getRes.status).toBe(200);

    const diffRes = await fetch(`${server.url}/api/review-targets/${target.id}/diff`, {
      headers: auth(server),
    });
    expect(diffRes.status).toBe(200);
    expect(await diffRes.text()).toContain("diff --git");
  });

  it("serves a local-branch diff for a non-PR review target", async () => {
    // A dedicated repo with a divergent branch (no PR involved).
    const repo2 = join(root, "repo2");
    await mkdir(repo2, { recursive: true });
    await runGit(["init", "-b", "main"], { cwd: repo2 });
    await writeFile(join(repo2, "f.ts"), "export const v = 1;\n");
    await runGit(["add", "."], { cwd: repo2 });
    await runGit(["-c", "user.email=t@e.x", "-c", "user.name=T", "commit", "-m", "init"], {
      cwd: repo2,
    });
    await runGit(["checkout", "-b", "feature"], { cwd: repo2 });
    await writeFile(join(repo2, "f.ts"), "export const v = 2;\n");
    await runGit(["add", "."], { cwd: repo2 });
    await runGit(["-c", "user.email=t@e.x", "-c", "user.name=T", "commit", "-m", "change"], {
      cwd: repo2,
    });
    await runGit(["checkout", "main"], { cwd: repo2 });

    const server = await boot();
    await fetch(`${server.url}/api/repositories`, {
      method: "POST",
      headers: auth(server),
      body: JSON.stringify({
        id: "repo2",
        name: "repo2",
        localPath: repo2,
        remote: "origin",
        worktreeRoot: join(root, "wts2"),
      }),
    });
    const target = (await (
      await fetch(`${server.url}/api/review-targets`, {
        method: "POST",
        headers: auth(server),
        body: JSON.stringify({ repositoryId: "repo2", base: "main", head: "feature" }),
      })
    ).json()) as TargetJson;

    const diffRes = await fetch(`${server.url}/api/review-targets/${target.id}/diff`, {
      headers: auth(server),
    });
    expect(diffRes.status).toBe(200);
    const patch = await diffRes.text();
    expect(patch).toContain("f.ts");
    expect(patch).toContain("+export const v = 2;");
  });

  it("answers a question, lists the comment, and errors on bad input", async () => {
    const server = await boot();
    await registerRepo(server);
    const target = (await (
      await fetch(`${server.url}/api/review-targets`, {
        method: "POST",
        headers: auth(server),
        body: JSON.stringify({ repositoryId: "repo-1", base: "main", head: "main" }),
      })
    ).json()) as TargetJson;

    const askRes = await fetch(`${server.url}/api/review-targets/${target.id}/ask`, {
      method: "POST",
      headers: auth(server),
      body: JSON.stringify({
        codeAnchor: { filePath: "a.ts", line: 1, side: "new" },
        question: "aligned?",
        referenceUrls: ["https://ref"],
      }),
    });
    expect(askRes.status).toBe(200);
    const answered = (await askRes.json()) as AnsweredJson;
    expect(answered.evidence).toBe("sufficient");
    expect(answered.answer.codeAnchors.length).toBeGreaterThan(0);

    const comments = await (
      await fetch(`${server.url}/api/review-targets/${target.id}/comments`, { headers: auth(server) })
    ).json();
    expect(comments).toHaveLength(1);

    // Unknown target → 404; missing question → 400.
    expect(
      (
        await fetch(`${server.url}/api/review-targets/nope/ask`, {
          method: "POST",
          headers: auth(server),
          body: JSON.stringify({ codeAnchor: { filePath: "a.ts", line: 1 }, question: "?" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${server.url}/api/review-targets/${target.id}/ask`, {
          method: "POST",
          headers: auth(server),
          body: JSON.stringify({ codeAnchor: { filePath: "a.ts", line: 1 } }),
        })
      ).status,
    ).toBe(400);
  });

  it("closes a review target (204, then 404)", async () => {
    const server = await boot();
    await registerRepo(server);
    const target = (await (
      await fetch(`${server.url}/api/review-targets`, {
        method: "POST",
        headers: auth(server),
        body: JSON.stringify({ repositoryId: "repo-1", base: "main", head: "main" }),
      })
    ).json()) as TargetJson;

    const del = await fetch(`${server.url}/api/review-targets/${target.id}`, {
      method: "DELETE",
      headers: auth(server),
    });
    expect(del.status).toBe(204);

    const get = await fetch(`${server.url}/api/review-targets/${target.id}`, {
      headers: auth(server),
    });
    expect(get.status).toBe(404);
  });

  it("refuses an explicit empty token (auth footgun)", () => {
    const core = new Core({ adapter: new FakeAdapter() });
    expect(() => createServer({ core, token: "" })).toThrow();
    expect(() => createServer({ core, token: "   " })).toThrow();
  });

  it("400s a malformed JSON body instead of 500", async () => {
    const server = await boot();
    const res = await fetch(`${server.url}/api/repositories`, {
      method: "POST",
      headers: auth(server),
      body: "{ not valid json",
    });
    expect(res.status).toBe(400);
  });

  it("treats an empty ?limit=/?state= as unset rather than invalid", async () => {
    const server = await boot();
    await registerRepo(server);
    const res = await fetch(`${server.url}/api/repositories/repo-1/pull-requests?state=&limit=`, {
      headers: auth(server),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([fakePr]);
  });

  it("404s comments for an unknown target (not an empty list)", async () => {
    const server = await boot();
    const res = await fetch(`${server.url}/api/review-targets/nope/comments`, {
      headers: auth(server),
    });
    expect(res.status).toBe(404);
  });

  it("rejects instead of hanging when the port is already in use", async () => {
    const first = await boot();
    const second = new Core({ adapter: new FakeAdapter() });
    await expect(
      startServer({ core: second, gh: fakeGh, port: first.port }),
    ).rejects.toBeDefined();
  });

  it("maps an unknown threadId to 400 (typed Core error)", async () => {
    const server = await boot();
    await registerRepo(server);
    const target = (await (
      await fetch(`${server.url}/api/review-targets`, {
        method: "POST",
        headers: auth(server),
        body: JSON.stringify({ repositoryId: "repo-1", base: "main", head: "main" }),
      })
    ).json()) as TargetJson;

    const res = await fetch(`${server.url}/api/review-targets/${target.id}/ask`, {
      method: "POST",
      headers: auth(server),
      body: JSON.stringify({
        codeAnchor: { filePath: "a.ts", line: 1 },
        question: "?",
        threadId: "does-not-exist",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("startCockpit serves and removes worktrees on close", async () => {
    const cockpit = await startCockpit({ gh: fakeGh });
    cockpit.core.registerRepository(repo);
    expect((await fetch(`${cockpit.url}/api/health`)).status).toBe(200);

    const target = await cockpit.core.openReviewTarget({
      repositoryId: "repo-1",
      base: "main",
      head: "main",
    });
    const path = target.worktreePath as string;
    expect((await listWorktrees(repo.localPath)).some((w) => w.path === path)).toBe(true);

    await cockpit.close();
    expect((await listWorktrees(repo.localPath)).some((w) => w.path === path)).toBe(false);
  });

  it("formatBaseUrl brackets bare IPv6 hosts", () => {
    expect(formatBaseUrl("127.0.0.1", 3000)).toBe("http://127.0.0.1:3000");
    expect(formatBaseUrl("localhost", 8080)).toBe("http://localhost:8080");
    expect(formatBaseUrl("::1", 3000)).toBe("http://[::1]:3000");
    expect(formatBaseUrl("[::1]", 9)).toBe("http://[::1]:9");
  });

  it("isLoopbackHost accepts only loopback hosts/origins", () => {
    for (const value of [
      "127.0.0.1",
      "127.0.0.1:3000",
      "localhost",
      "localhost:8080",
      "[::1]",
      "[::1]:9",
      "http://127.0.0.1:5000",
    ]) {
      expect(isLoopbackHost(value)).toBe(true);
    }
    for (const value of [
      "evil.com",
      "evil.com:80",
      "http://evil.com",
      "10.0.0.5",
      "192.168.1.1:3000",
      "0.0.0.0",
      undefined,
      "",
    ]) {
      expect(isLoopbackHost(value)).toBe(false);
    }
  });
});
