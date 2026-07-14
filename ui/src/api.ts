import type {
  AnsweredComment,
  Capabilities,
  CodeAnchor,
  Comment,
  PrStateFilter,
  PullRequest,
  PullRequestState,
  Repository,
  ReviewTarget,
} from "./types";

/**
 * Minimal typed client for the par HTTP API. The bearer token arrives in the URL
 * fragment (`#token=…`) — a fragment never reaches the server or its logs — and
 * is attached to every /api request.
 */
function readToken(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return new URLSearchParams(hash).get("token") ?? "";
}

const token = readToken();

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
}

async function fail(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? `HTTP ${res.status}`);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: authHeaders({ "content-type": "application/json" }),
  });
  if (!res.ok) return fail(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

async function apiText(path: string): Promise<string> {
  const res = await fetch(`/api${path}`, { headers: authHeaders() });
  if (!res.ok) return fail(res);
  return res.text();
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export interface OpenReviewTargetBody {
  repositoryId: string;
  base: string;
  head: string;
  pr?: {
    number: number;
    state: PullRequestState;
    title?: string;
    author?: string;
    url?: string;
    baseRef?: string;
    headRef?: string;
  };
  fetch?: { remote: string; refspec: string };
  timeoutMs?: number;
}

export interface AskBody {
  codeAnchor: CodeAnchor;
  question: string;
  referenceUrls?: string[];
  threadId?: string;
}

const enc = encodeURIComponent;

export const parApi = {
  health: () => api<{ ok: boolean }>("/health"),
  capabilities: () => api<Capabilities>("/capabilities"),

  listRepositories: () => api<Repository[]>("/repositories"),
  registerRepository: (repo: Repository) =>
    api<Repository>("/repositories", { method: "POST", body: JSON.stringify(repo) }),

  listPullRequests: (repoId: string, q: { state?: PrStateFilter; limit?: number } = {}) =>
    api<PullRequest[]>(`/repositories/${enc(repoId)}/pull-requests${query(q)}`),

  openReviewTarget: (body: OpenReviewTargetBody) =>
    api<ReviewTarget>("/review-targets", { method: "POST", body: JSON.stringify(body) }),
  getReviewTarget: (id: string) => api<ReviewTarget>(`/review-targets/${enc(id)}`),
  getDiff: (id: string) => apiText(`/review-targets/${enc(id)}/diff`),
  listComments: (id: string) => api<Comment[]>(`/review-targets/${enc(id)}/comments`),
  ask: (id: string, body: AskBody, signal?: AbortSignal) =>
    api<AnsweredComment>(`/review-targets/${enc(id)}/ask`, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  closeReviewTarget: (id: string) =>
    api<void>(`/review-targets/${enc(id)}`, { method: "DELETE" }),
};
