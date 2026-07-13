import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDiff } from "../../src/git/index";
import { runGit } from "../../src/git/run";

const ESC = String.fromCharCode(27); // ANSI escape (0x1b)

describe("getDiff", () => {
  let root: string;
  let repo: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "par-diff-"));
    repo = join(root, "r");
    await mkdir(repo, { recursive: true });
    await runGit(["init", "-b", "main"], { cwd: repo });
    // Force color on: getDiff must still emit a plain (ANSI-free) patch.
    await runGit(["config", "color.ui", "always"], { cwd: repo });
    await writeFile(join(repo, "a.ts"), "const x = 1;\n");
    await runGit(["add", "."], { cwd: repo });
    await runGit(["-c", "user.email=t@e.x", "-c", "user.name=T", "commit", "-m", "init"], {
      cwd: repo,
    });
    await runGit(["checkout", "-b", "feature"], { cwd: repo });
    await writeFile(join(repo, "a.ts"), "const x = 2;\n");
    await runGit(["add", "."], { cwd: repo });
    await runGit(["-c", "user.email=t@e.x", "-c", "user.name=T", "commit", "-m", "change"], {
      cwd: repo,
    });
    await runGit(["checkout", "main"], { cwd: repo });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns the patch head introduces over base", async () => {
    const patch = await getDiff(repo, "main", "feature");
    expect(patch).toContain("a.ts");
    expect(patch).toContain("+const x = 2;");
  });

  it("emits no ANSI color even when the repo forces color.ui=always", async () => {
    const patch = await getDiff(repo, "main", "feature");
    // A color.ui=always repo would otherwise inject ANSI escapes even on a pipe.
    expect(patch.includes(ESC)).toBe(false);
  });

  it("returns an empty patch for identical refs", async () => {
    expect((await getDiff(repo, "main", "main")).trim()).toBe("");
  });

  it("rejects dash-leading refs (option injection)", async () => {
    await expect(getDiff(repo, "-x", "main")).rejects.toThrow(/invalid/);
    await expect(getDiff(repo, "main", "--output=x")).rejects.toThrow(/invalid/);
    await expect(getDiff(repo, "", "main")).rejects.toThrow(/invalid/);
  });
});
