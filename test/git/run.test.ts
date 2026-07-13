import { describe, expect, it } from "vitest";
import { GitError } from "../../src/git/run";

describe("GitError", () => {
  it("exposes the failure reason", () => {
    const err = new GitError(["status"], 1, "boom");
    expect(err.reason).toBe("boom");
  });
});
