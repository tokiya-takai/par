import type { PullRequest, PullRequestState } from "../domain/types.js";
import { runGh } from "./run.js";

/** Raw shape of one element of `gh pr list --json <PR_JSON_FIELDS>`. */
export interface GhPullRequestJson {
  number: number;
  title: string;
  author: { login: string } | null;
  url: string;
  /** gh emits upper-case: "OPEN" | "MERGED" | "CLOSED". */
  state: string;
  headRefName: string;
  baseRefName: string;
}

/** The `--json` field set requested from `gh pr list` (must match GhPullRequestJson). */
const PR_JSON_FIELDS = "number,title,author,url,state,headRefName,baseRefName";

function normalizePrState(state: string): PullRequestState {
  const lower = state.toLowerCase();
  if (lower === "open" || lower === "merged" || lower === "closed") return lower;
  // Fail loud rather than mislabel — PR state is load-bearing in a review cockpit.
  throw new RangeError(`unexpected gh PR state: ${JSON.stringify(state)}`);
}

/** Map one `gh` PR JSON object to the domain {@link PullRequest}. */
export function mapPullRequest(raw: GhPullRequestJson): PullRequest {
  return {
    number: raw.number,
    title: raw.title,
    author: raw.author?.login ?? "", // "" = author unavailable (e.g. deleted account)
    url: raw.url,
    state: normalizePrState(raw.state),
    baseRef: raw.baseRefName,
    headRef: raw.headRefName,
    // reviewThreads and ciStatus are intentionally left ABSENT (not []/""): the
    // unresolved-thread import and CI status need the GraphQL API (a later
    // increment). Absent means "not fetched", not "none".
  };
}

/**
 * Validate one raw `gh pr list` element before mapping, so a null/malformed item
 * becomes a clear error rather than a downstream TypeError or a broken PullRequest.
 */
function assertGhPullRequest(value: unknown, index: number): asserts value is GhPullRequestJson {
  const at = `gh pr list item ${index}`;
  if (typeof value !== "object" || value === null) {
    throw new Error(`${at} is not an object`);
  }
  const v = value as Record<string, unknown>;
  if (typeof v.number !== "number") {
    throw new Error(`${at}: "number" must be a number`);
  }
  for (const field of ["title", "url", "state", "headRefName", "baseRefName"] as const) {
    if (typeof v[field] !== "string") {
      throw new Error(`${at}: "${field}" must be a string`);
    }
  }
  const author = v.author;
  const authorOk =
    author === null ||
    (typeof author === "object" && typeof (author as Record<string, unknown>).login === "string");
  if (!authorOk) {
    throw new Error(`${at}: "author" must be {login:string} or null`);
  }
}

/** Parse `gh pr list --json` stdout into domain PRs, failing clearly on bad output. */
export function parsePullRequestListJson(stdout: string): PullRequest[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    throw new Error(
      `gh pr list returned unparseable JSON (${(e as Error).message}); output starts: ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`gh pr list expected a JSON array, got ${typeof parsed}`);
  }
  return parsed.map((item, index) => {
    assertGhPullRequest(item, index);
    return mapPullRequest(item);
  });
}

export type PullRequestStateFilter = "open" | "closed" | "merged" | "all";
const ALLOWED_STATE_FILTERS: readonly PullRequestStateFilter[] = ["open", "closed", "merged", "all"];

export interface ListPullRequestsOptions {
  /** A local clone whose remote gh resolves the repo from. */
  repoPath: string;
  /** Filter by state (default: gh's default, open). */
  state?: PullRequestStateFilter;
  /** Max PRs to return. */
  limit?: number;
  /** gh timeout override (ms). 0 disables; omitted uses runGh's default. */
  timeoutMs?: number;
}

/** List a repository's pull requests via `gh pr list --json`. */
export async function listPullRequests(options: ListPullRequestsOptions): Promise<PullRequest[]> {
  const args = ["pr", "list", "--json", PR_JSON_FIELDS];
  if (options.state !== undefined) {
    if (!ALLOWED_STATE_FILTERS.includes(options.state)) {
      throw new RangeError(`invalid PR state filter: ${JSON.stringify(options.state)}`);
    }
    args.push("--state", options.state);
  }
  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit <= 0) {
      throw new RangeError(`invalid limit: ${options.limit} (must be a positive integer)`);
    }
    args.push("--limit", String(options.limit));
  }

  const { stdout } = await runGh(args, { cwd: options.repoPath, timeoutMs: options.timeoutMs });
  return parsePullRequestListJson(stdout);
}

export interface GetPullRequestDiffOptions {
  /** gh timeout override (ms). 0 disables; omitted uses runGh's default. */
  timeoutMs?: number;
}

/** Fetch a pull request's diff as a git patch via `gh pr diff <n> --patch`. */
export async function getPullRequestDiff(
  repoPath: string,
  prNumber: number,
  options: GetPullRequestDiffOptions = {},
): Promise<string> {
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new RangeError(`invalid PR number: ${prNumber} (must be a positive integer)`);
  }
  // --color=never: gh's diff color defaults to auto and CLICOLOR_FORCE/GH_FORCE_TTY
  // can force ANSI even on a pipe; a patch must stay plain text. (Those env vars
  // are also stripped in runGh's child env as defense-in-depth.)
  const { stdout } = await runGh(["pr", "diff", String(prNumber), "--patch", "--color=never"], {
    cwd: repoPath,
    timeoutMs: options.timeoutMs,
  });
  return stdout;
}
