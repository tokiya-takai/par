import { describe, expect, it } from "vitest";
import {
  type PullRequestStateFilter,
  getPullRequestDiff,
  listPullRequests,
  mapPullRequest,
  parsePullRequestListJson,
} from "../../src/gh/pr";

const rawPr = {
  number: 42,
  title: "Add thing",
  author: { login: "octocat" },
  url: "https://github.com/o/r/pull/42",
  state: "OPEN",
  headRefName: "feature/x",
  baseRefName: "main",
};

describe("mapPullRequest", () => {
  it("maps gh JSON to the domain PullRequest (reviewThreads left absent)", () => {
    const pr = mapPullRequest(rawPr);
    expect(pr).toEqual({
      number: 42,
      title: "Add thing",
      author: "octocat",
      url: "https://github.com/o/r/pull/42",
      state: "open",
      baseRef: "main",
      headRef: "feature/x",
    });
    expect(pr.reviewThreads).toBeUndefined(); // "not fetched", not "zero threads"
  });

  it("lower-cases MERGED/CLOSED and tolerates a null author", () => {
    expect(mapPullRequest({ ...rawPr, state: "MERGED" }).state).toBe("merged");
    expect(mapPullRequest({ ...rawPr, state: "CLOSED" }).state).toBe("closed");
    expect(mapPullRequest({ ...rawPr, author: null }).author).toBe("");
  });

  it("throws on an unexpected PR state rather than mislabeling it", () => {
    expect(() => mapPullRequest({ ...rawPr, state: "DRAFT" })).toThrow(RangeError);
  });
});

describe("parsePullRequestListJson", () => {
  it("parses a JSON array of PRs", () => {
    const prs = parsePullRequestListJson(JSON.stringify([rawPr]));
    expect(prs).toHaveLength(1);
    expect(prs[0]?.number).toBe(42);
  });

  it("returns an empty list for gh's empty-array output", () => {
    expect(parsePullRequestListJson("[]")).toEqual([]);
  });

  it("throws a clear error on unparseable output", () => {
    expect(() => parsePullRequestListJson("")).toThrow(/unparseable JSON/);
    expect(() => parsePullRequestListJson("not json")).toThrow(/unparseable JSON/);
  });

  it("throws when the output is JSON but not an array", () => {
    expect(() => parsePullRequestListJson('{"message":"bad"}')).toThrow(/expected a JSON array/);
  });

  it("throws a clear error on a null or shape-broken array element", () => {
    expect(() => parsePullRequestListJson("[null]")).toThrow(/is not an object/);
    expect(() => parsePullRequestListJson(JSON.stringify([{ ...rawPr, number: "42" }]))).toThrow(
      /"number" must be a number/,
    );
    expect(() => parsePullRequestListJson(JSON.stringify([{ ...rawPr, headRefName: 7 }]))).toThrow(
      /"headRefName" must be a string/,
    );
    expect(() => parsePullRequestListJson(JSON.stringify([{ ...rawPr, author: "octocat" }]))).toThrow(
      /"author"/,
    );
  });
});

describe("input validation (before any gh call)", () => {
  it("getPullRequestDiff rejects a non-positive-integer PR number", async () => {
    await expect(getPullRequestDiff("/repo", 0)).rejects.toThrow(RangeError);
    await expect(getPullRequestDiff("/repo", -1)).rejects.toThrow(RangeError);
    await expect(getPullRequestDiff("/repo", 1.5)).rejects.toThrow(RangeError);
  });

  it("listPullRequests rejects a bad limit or state filter", async () => {
    await expect(listPullRequests({ repoPath: "/repo", limit: 0 })).rejects.toThrow(RangeError);
    await expect(listPullRequests({ repoPath: "/repo", limit: 2.5 })).rejects.toThrow(RangeError);
    await expect(
      listPullRequests({ repoPath: "/repo", state: "bogus" as unknown as PullRequestStateFilter }),
    ).rejects.toThrow(RangeError);
  });
});
