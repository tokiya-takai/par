import { describe, expect, it } from "vitest";
import { ghChildEnv } from "../../src/gh/run";

describe("ghChildEnv", () => {
  it("strips the repo/color/TTY override vars (case-insensitively) and keeps the rest", () => {
    const env = ghChildEnv({
      PATH: "/usr/bin",
      GH_REPO: "owner/other",
      gh_repo: "owner/lower",
      CLICOLOR_FORCE: "1",
      GH_FORCE_TTY: "100%",
      GH_HOST: "ghe.example.com",
      GH_TOKEN: "tok",
    });

    for (const key of ["GH_REPO", "gh_repo", "CLICOLOR_FORCE", "GH_FORCE_TTY"]) {
      expect(key in env).toBe(false);
    }
    // Unrelated / Enterprise / auth vars are kept.
    expect(env.PATH).toBe("/usr/bin");
    expect(env.GH_HOST).toBe("ghe.example.com");
    expect(env.GH_TOKEN).toBe("tok");
  });

  it("does not mutate the input env", () => {
    const input = { GH_REPO: "owner/other" };
    ghChildEnv(input);
    expect(input.GH_REPO).toBe("owner/other");
  });
});
