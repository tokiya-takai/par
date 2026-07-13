/**
 * Minimal typed client for the par HTTP API. The bearer token arrives in the URL
 * fragment (`#token=…`) — a fragment is never sent to the server or written to
 * its logs — and is attached to every /api request.
 */
function readToken(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return new URLSearchParams(hash).get("token") ?? "";
}

const token = readToken();

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface Repository {
  id: string;
  name: string;
  localPath: string;
  remote: string;
  worktreeRoot: string;
}

export const parApi = {
  health: () => api<{ ok: boolean }>("/health"),
  listRepositories: () => api<Repository[]>("/repositories"),
  registerRepository: (repo: Repository) =>
    api<Repository>("/repositories", { method: "POST", body: JSON.stringify(repo) }),
};
