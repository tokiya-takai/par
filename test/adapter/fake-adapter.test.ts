import { describe, expect, it } from "vitest";
import { FakeAdapter } from "../../src/adapter/fake-adapter";
import { evidenceStrength, evidenceStrengthForComment } from "../../src/domain/types";
import type { Answer, Comment } from "../../src/domain/types";
import type { InvokeInput } from "../../src/adapter/types";

const baseInput: InvokeInput = {
  worktreePath: "/tmp/par-worktrees/repo-123",
  question: "Is this type consistent with the design doc?",
  codeAnchor: { filePath: "src/foo.ts", line: 42, side: "new" },
  referenceUrls: ["https://www.notion.so/design#block"],
  threadHistory: [],
};

describe("FakeAdapter", () => {
  it("grounds a two-sided answer in the given references", async () => {
    const answer = await new FakeAdapter().invoke(baseInput);

    expect(answer.codeAnchors[0]?.filePath).toBe("src/foo.ts");
    expect(answer.sourceAnchors[0]?.url).toBe("https://www.notion.so/design#block");
    expect(answer.agentMeta.adapter).toBe("fake");
    expect(answer.verdict).toBe("aligned");
  });

  it("returns no source anchors when no reference was provided", async () => {
    const answer = await new FakeAdapter().invoke({ ...baseInput, referenceUrls: [] });
    expect(answer.sourceAnchors).toHaveLength(0);
  });

  it("simulates an ungrounded answer (drops the source side even with a reference)", async () => {
    const answer = await new FakeAdapter({ grounded: false }).invoke(baseInput);
    expect(answer.sourceAnchors).toHaveLength(0);
    expect(answer.verdict).toBe("needs_info");
  });

  it("preserves the question's line range in the evidence anchor", async () => {
    const answer = await new FakeAdapter().invoke({
      ...baseInput,
      codeAnchor: { filePath: "src/bar.ts", line: [10, 20], side: "new" },
    });
    expect(answer.codeAnchors[0]?.line).toEqual([10, 20]);
  });

  it("drops `side` on evidence anchors (only question anchors carry side)", async () => {
    const answer = await new FakeAdapter().invoke(baseInput);
    expect(answer.codeAnchors[0]?.side).toBeUndefined();
  });

  it("reflects the thread turn in its reasoning (history replay is real, not just a flag)", async () => {
    const answer = await new FakeAdapter().invoke({
      ...baseInput,
      threadHistory: [{ question: "earlier question" }],
    });
    expect(answer.reasoning).toContain("turn 2");
  });

  it("round-trips sessionId into agentMeta", async () => {
    const answer = await new FakeAdapter().invoke({ ...baseInput, sessionId: "s-1" });
    expect(answer.agentMeta.sessionId).toBe("s-1");
  });

  it("declares its threading capabilities honestly", () => {
    const caps = new FakeAdapter().capabilities();
    expect(caps.historyReplay).toBe(true);
    expect(caps.sessionContinuation).toBe(false);
  });
});

describe("evidenceStrength", () => {
  const twoSided: Answer = {
    reasoning: "checked against the design doc",
    codeAnchors: [{ filePath: "src/a.ts", line: 1 }],
    sourceAnchors: [{ url: "https://notion/x", label: "design" }],
    agentMeta: { adapter: "fake" },
  };
  const codeOnly: Answer = { ...twoSided, sourceAnchors: [] };

  it("is sufficient when both sides are present and a reference was requested", () => {
    expect(evidenceStrength(twoSided, { referencesRequested: true })).toBe("sufficient");
  });

  it("is insufficient when a reference was requested but the source side is missing", () => {
    expect(evidenceStrength(codeOnly, { referencesRequested: true })).toBe("insufficient");
  });

  it("is sufficient for a pure-code answer when no reference was requested", () => {
    expect(evidenceStrength(codeOnly, { referencesRequested: false })).toBe("sufficient");
  });

  it("always requires code anchors", () => {
    const noCode: Answer = { ...codeOnly, codeAnchors: [] };
    expect(evidenceStrength(noCode, { referencesRequested: false })).toBe("insufficient");
  });
});

describe("evidenceStrengthForComment", () => {
  const answer: Answer = {
    reasoning: "code-vs-code DRY check",
    codeAnchors: [{ filePath: "src/a.ts", line: 1 }],
    sourceAnchors: [],
    agentMeta: { adapter: "fake" },
  };
  const makeComment = (referenceUrls: string[]): Comment => ({
    id: "c1",
    reviewTargetId: "rt1",
    codeAnchor: { filePath: "src/a.ts", line: 1, side: "new" },
    question: "q",
    referenceUrls,
    threadId: "t1",
    answers: [],
  });

  it("requires both sides when the comment carried reference URLs", () => {
    expect(evidenceStrengthForComment(makeComment(["https://notion/x"]), answer)).toBe("insufficient");
  });

  it("accepts code-only evidence when the comment had no reference URLs", () => {
    expect(evidenceStrengthForComment(makeComment([]), answer)).toBe("sufficient");
  });
});
