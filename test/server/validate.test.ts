import { describe, expect, it } from "vitest";
import {
  HttpError,
  assertAskBody,
  assertCodeAnchor,
  assertOpenReviewTargetInput,
  assertRepository,
} from "../../src/server/index";

describe("request validators", () => {
  it("accepts a single line and an ascending range", () => {
    expect(assertCodeAnchor({ filePath: "a.ts", line: 3 })).toEqual({ filePath: "a.ts", line: 3 });
    expect(assertCodeAnchor({ filePath: "a.ts", line: [2, 5], side: "new" })).toEqual({
      filePath: "a.ts",
      line: [2, 5],
      side: "new",
    });
  });

  it("rejects bad code anchors (non-positive, descending, bad side, wrong type)", () => {
    for (const bad of [
      { filePath: "a.ts", line: 0 },
      { filePath: "a.ts", line: -1 },
      { filePath: "a.ts", line: [5, 2] }, // descending
      { filePath: "a.ts", line: [1] }, // wrong arity
      { filePath: "a.ts", line: 1.5 }, // non-integer
      { filePath: "a.ts", line: 1, side: "left" }, // bad side
      { filePath: "", line: 1 }, // empty path
      { line: 1 }, // missing path
    ]) {
      expect(() => assertCodeAnchor(bad)).toThrow(HttpError);
    }
  });

  it("validates repository and ask bodies", () => {
    expect(() => assertRepository({ id: "x" })).toThrow(HttpError);
    expect(
      assertRepository({
        id: "r",
        name: "r",
        localPath: "/p",
        remote: "origin",
        worktreeRoot: "/w",
      }),
    ).toMatchObject({ id: "r" });

    expect(() => assertAskBody({ question: "no anchor" })).toThrow(HttpError);
    const body = assertAskBody({
      codeAnchor: { filePath: "a.ts", line: 1 },
      question: "why?",
      referenceUrls: ["https://ref"],
    });
    expect(body.question).toBe("why?");
    expect(body.referenceUrls).toEqual(["https://ref"]);
  });

  it("validates open-review-target input incl. optional pr/fetch/timeout", () => {
    expect(() => assertOpenReviewTargetInput({ base: "main", head: "x" })).toThrow(HttpError);
    const input = assertOpenReviewTargetInput({
      repositoryId: "r",
      base: "main",
      head: "feature/x",
      pr: { number: 7, state: "open", title: "t", url: "u", baseRef: "main", headRef: "x" },
      fetch: { remote: "origin", refspec: "pull/7/head" },
      timeoutMs: 1000,
    });
    expect(input.pr?.number).toBe(7);
    expect(input.fetch?.refspec).toBe("pull/7/head");
    expect(() =>
      assertOpenReviewTargetInput({ repositoryId: "r", base: "main", head: "x", pr: { number: 0 } }),
    ).toThrow(HttpError);
  });
});
