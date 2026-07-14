import { describe, expect, it } from "vitest";
import { evidenceStrength } from "../ui/src/lib/evidence";
import { highlightHunks, languageForPath } from "../ui/src/lib/highlight";
import { parsePatch, resolveAnchor } from "../ui/src/lib/patch";
import type { Answer } from "../ui/src/types";

const PATCH = [
  "diff --git a/a.ts b/a.ts",
  "index 1111111..2222222 100644",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " const d = 5;",
  "",
].join("\n");

describe("parsePatch / resolveAnchor", () => {
  it("resolves a line to a file-qualified anchor id (unique across files)", () => {
    const { files, index } = parsePatch(PATCH);
    expect(files).toHaveLength(1);
    const resolved = resolveAnchor(index, "a.ts", 2);
    expect(resolved?.domId).toMatch(/^a\.ts::/); // path-qualified, not a bare change key
    // a line outside the diff, and an unknown file, do not resolve
    expect(resolveAnchor(index, "a.ts", 999)).toBeUndefined();
    expect(resolveAnchor(index, "nope.ts", 1)).toBeUndefined();
  });

  it("honors the requested side (old vs new resolve to different rows)", () => {
    const { index } = parsePatch(PATCH);
    // old line 2 is the deleted "const b = 2;"; new line 2 is the inserted "const b = 3;".
    const oldSide = resolveAnchor(index, "a.ts", 2, "old");
    const newSide = resolveAnchor(index, "a.ts", 2, "new");
    expect(oldSide?.changeKey).toBeTruthy();
    expect(newSide?.changeKey).toBeTruthy();
    expect(oldSide?.changeKey).not.toBe(newSide?.changeKey);
  });

  it("returns no files for an empty (no-change) patch", () => {
    expect(parsePatch("").files).toHaveLength(0);
  });

  it("tolerates a git format-patch envelope + diffstat (does not throw, still parses)", () => {
    const formatPatch = [
      "From 0000000000000000000000000000000000000000 Mon Sep 17 00:00:00 2001",
      "From: Alice <a@example.com>",
      "Subject: [PATCH] change b",
      "",
      "---",
      " a.ts | 3 ++-", // diffstat line — leading space crashes a naive parser
      " 1 file changed, 2 insertions(+), 1 deletion(-)",
      "",
      PATCH,
      "-- ",
      "2.39.0",
      "",
    ].join("\n");
    expect(parsePatch(formatPatch).files).toHaveLength(1);
  });
});

describe("syntax highlighting", () => {
  it("maps paths to refractor languages, or null when unsupported", () => {
    expect(languageForPath("src/a.ts")).toBe("typescript");
    expect(languageForPath("b.tsx")).toBe("tsx");
    expect(languageForPath("s.py")).toBe("python");
    expect(languageForPath("Dockerfile")).toBe("docker");
    expect(languageForPath("README")).toBeNull();
    expect(languageForPath("data.xyz")).toBeNull();
  });

  it("tokenizes a supported file, and no-ops for unsupported / none", () => {
    const hunks = parsePatch(PATCH).files[0]?.hunks ?? [];
    const tokens = highlightHunks(hunks, "typescript");
    expect(tokens?.new).toBeTruthy();
    expect(tokens?.old).toBeTruthy();
    expect(highlightHunks(hunks, null)).toBeUndefined();
  });
});

describe("evidenceStrength", () => {
  const base: Answer = {
    reasoning: "x",
    codeAnchors: [],
    sourceAnchors: [],
    agentMeta: { adapter: "fake" },
  };
  const withCode: Answer = { ...base, codeAnchors: [{ filePath: "a.ts", line: 1 }] };

  it("requires code always, and a source only when references were requested", () => {
    expect(evidenceStrength(0, base)).toBe("insufficient"); // no code
    expect(evidenceStrength(0, withCode)).toBe("sufficient"); // pure-code question
    expect(evidenceStrength(1, withCode)).toBe("insufficient"); // ref requested, no source
    expect(
      evidenceStrength(1, { ...withCode, sourceAnchors: [{ url: "u", label: "l" }] }),
    ).toBe("sufficient");
  });
});
