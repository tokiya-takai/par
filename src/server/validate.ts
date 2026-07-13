import type { AskInput, OpenReviewTargetInput } from "../core/index.js";
import type { CodeAnchor, PullRequest, Repository } from "../domain/index.js";

/** An error carrying an HTTP status; the server maps it to a JSON error response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function bad(message: string): never {
  throw new HttpError(400, message);
}

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    bad(`${what} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function reqString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v === "") bad(`"${key}" must be a non-empty string`);
  return v as string;
}

function optString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") bad(`"${key}" must be a string`);
  return v;
}

function optStringArray(o: Record<string, unknown>, key: string): string[] | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    bad(`"${key}" must be an array of strings`);
  }
  return v as string[];
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** Validate a Repository registration body. */
export function assertRepository(value: unknown): Repository {
  const o = asObject(value, "repository");
  return {
    id: reqString(o, "id"),
    name: reqString(o, "name"),
    localPath: reqString(o, "localPath"),
    remote: reqString(o, "remote"),
    worktreeRoot: reqString(o, "worktreeRoot"),
  };
}

/** Validate a CodeAnchor (a question's target, or answer evidence). */
export function assertCodeAnchor(value: unknown): CodeAnchor {
  const o = asObject(value, "codeAnchor");
  const filePath = reqString(o, "filePath");
  const rawLine = o.line;
  let line: number | [number, number];
  if (isPositiveInt(rawLine)) {
    line = rawLine;
  } else if (Array.isArray(rawLine) && rawLine.length === 2) {
    const [start, end] = rawLine;
    if (!isPositiveInt(start) || !isPositiveInt(end)) {
      bad('"line" must be a positive integer or a [start, end] pair of them');
    }
    if (start > end) bad('"line" range start must be <= end');
    line = [start, end];
  } else {
    bad('"line" must be a positive integer or a [start, end] pair of them');
  }
  const anchor: CodeAnchor = { filePath, line };
  if (o.side !== undefined) {
    if (o.side !== "old" && o.side !== "new") bad('"side" must be "old" or "new"');
    anchor.side = o.side;
  }
  return anchor;
}

function assertPullRequest(value: unknown): PullRequest {
  const o = asObject(value, "pr");
  if (!isPositiveInt(o.number)) bad('"pr.number" must be a positive integer');
  const state = o.state;
  if (state !== "open" && state !== "merged" && state !== "closed") {
    bad('"pr.state" must be "open", "merged", or "closed"');
  }
  return {
    number: o.number,
    state,
    title: optString(o, "title") ?? "",
    author: optString(o, "author") ?? "",
    url: optString(o, "url") ?? "",
    baseRef: optString(o, "baseRef") ?? "",
    headRef: optString(o, "headRef") ?? "",
  };
}

/** Validate a body for opening a review target. */
export function assertOpenReviewTargetInput(value: unknown): OpenReviewTargetInput {
  const o = asObject(value, "review target");
  const input: OpenReviewTargetInput = {
    repositoryId: reqString(o, "repositoryId"),
    base: reqString(o, "base"),
    head: reqString(o, "head"),
  };
  if (o.pr !== undefined) input.pr = assertPullRequest(o.pr);
  if (o.fetch !== undefined) {
    const f = asObject(o.fetch, "fetch");
    input.fetch = { remote: reqString(f, "remote"), refspec: reqString(f, "refspec") };
  }
  if (o.timeoutMs !== undefined) {
    if (typeof o.timeoutMs !== "number" || !Number.isFinite(o.timeoutMs) || o.timeoutMs < 0) {
      bad('"timeoutMs" must be a non-negative number');
    }
    input.timeoutMs = o.timeoutMs;
  }
  return input;
}

/** The fields of an ask taken from the request body (id comes from the path). */
export type AskBody = Pick<AskInput, "codeAnchor" | "question" | "referenceUrls" | "threadId">;

/** Validate an ask body. */
export function assertAskBody(value: unknown): AskBody {
  const o = asObject(value, "ask");
  const body: AskBody = {
    codeAnchor: assertCodeAnchor(o.codeAnchor),
    question: reqString(o, "question"),
  };
  const referenceUrls = optStringArray(o, "referenceUrls");
  if (referenceUrls !== undefined) body.referenceUrls = referenceUrls;
  const threadId = optString(o, "threadId");
  if (threadId !== undefined) body.threadId = threadId;
  return body;
}
