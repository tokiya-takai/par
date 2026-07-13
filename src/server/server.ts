import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { relative } from "node:path";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { CoreError } from "../core/index.js";
import type { Core } from "../core/index.js";
import { getPullRequestDiff, listPullRequests } from "../gh/index.js";
import { getDiff } from "../git/index.js";
import type { PullRequestStateFilter } from "../gh/index.js";
import {
  HttpError,
  assertAskBody,
  assertOpenReviewTargetInput,
  assertRepository,
} from "./validate.js";

/** The subset of the gh client the server calls. Injectable so tests can stub it. */
export interface GhClient {
  listPullRequests: typeof listPullRequests;
  getPullRequestDiff: typeof getPullRequestDiff;
}

const DEFAULT_GH: GhClient = { listPullRequests, getPullRequestDiff };

export interface CreateServerOptions {
  core: Core;
  /** Bearer token required on every `/api` route except `/api/health`. Random if omitted. */
  token?: string;
  /** gh client override (defaults to the real one) — used in tests. */
  gh?: GhClient;
  /** Absolute path to the built UI (dist/ui); when set, it is served at `/`. */
  uiDir?: string;
}

export interface ParServer {
  app: Hono;
  /** The bearer token the API requires (generated if none was supplied). */
  token: string;
}

const encoder = new TextEncoder();

/** Constant-time token comparison (length is not secret — tokens are fixed-length). */
function tokensMatch(a: string, b: string): boolean {
  // Fail closed on an empty operand: an empty token must never authorize anything.
  if (a.length === 0 || b.length === 0) return false;
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
}

/**
 * Whether a Host/Origin header value points at loopback. Used to reject
 * cross-origin (CSRF) and DNS-rebinding requests before they reach a handler
 * that can spawn code-executing agents.
 */
/** Format a base URL, bracketing a bare IPv6 host (e.g. `::1` → `http://[::1]:port`). */
export function formatBaseUrl(host: string, port: number): string {
  const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${bracketed}:${port}`;
}

export function isLoopbackHost(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  let hostname: string;
  try {
    hostname = new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return false;
  }
  const normalized = hostname.replace(/^\[/, "").replace(/\]$/, "");
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

/**
 * Build the HTTP API around a {@link Core}. Pure Hono app (no port bound) so it
 * can be tested via `app.fetch`; {@link startServer} binds it to a port.
 */
export function createServer(options: CreateServerOptions): ParServer {
  const { core } = options;
  const gh = options.gh ?? DEFAULT_GH;
  // An explicit empty token is a footgun (e.g. an unset env var) that would leave
  // the API open — reject it. Omit `token` to auto-generate one instead.
  if (options.token !== undefined && options.token.trim() === "") {
    throw new Error("createServer: token must be non-empty (omit it to auto-generate one)");
  }
  const token = options.token ?? randomBytes(32).toString("hex");
  const app = new Hono();

  // Liveness — deliberately unauthenticated; reveals nothing. Registered before
  // the guard so it responds without a token.
  app.get("/api/health", (c) => c.json({ ok: true }));

  // Guard every other /api route. The server can spawn code-executing agents, so
  // it must not be driveable by other local processes, cross-site pages (CSRF),
  // or DNS-rebinding: require a loopback Host/Origin and a matching bearer token.
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health") return next();
    if (!isLoopbackHost(c.req.header("host"))) {
      return c.json({ error: "forbidden: non-loopback host" }, 403);
    }
    const origin = c.req.header("origin");
    if (origin !== undefined && !isLoopbackHost(origin)) {
      return c.json({ error: "forbidden: cross-origin request" }, 403);
    }
    const provided = bearerToken(c.req.header("authorization")) ?? c.req.header("x-par-token");
    if (provided === undefined || !tokensMatch(provided, token)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  });

  app.get("/api/capabilities", (c) => c.json(core.capabilities()));

  app.get("/api/repositories", (c) => c.json(core.listRepositories()));

  app.post("/api/repositories", async (c) => {
    const repo = assertRepository(await c.req.json());
    core.registerRepository(repo);
    return c.json(repo, 201);
  });

  app.get("/api/repositories/:id/pull-requests", async (c) => {
    const id = c.req.param("id");
    const repo = core.getRepository(id);
    if (!repo) throw new HttpError(404, `unknown repository: ${id}`);
    // Empty query strings (`?state=&limit=`) mean "unset", not an invalid value.
    const stateQuery = c.req.query("state");
    const limitQuery = c.req.query("limit");
    const prs = await gh.listPullRequests({
      repoPath: repo.localPath,
      state: stateQuery ? (stateQuery as PullRequestStateFilter) : undefined,
      limit: limitQuery ? Number(limitQuery) : undefined,
    });
    return c.json(prs);
  });

  app.post("/api/review-targets", async (c) => {
    const target = await core.openReviewTarget(assertOpenReviewTargetInput(await c.req.json()));
    return c.json(target, 201);
  });

  app.get("/api/review-targets/:id", (c) => {
    const id = c.req.param("id");
    const target = core.getReviewTarget(id);
    if (!target) throw new HttpError(404, `unknown review target: ${id}`);
    return c.json(target);
  });

  app.get("/api/review-targets/:id/diff", async (c) => {
    const id = c.req.param("id");
    const target = core.getReviewTarget(id);
    if (!target) throw new HttpError(404, `unknown review target: ${id}`);
    const repo = core.getRepository(target.repositoryId);
    if (!repo) throw new HttpError(404, `unknown repository: ${target.repositoryId}`);
    // PR targets use the PR diff; a local-branch target diffs its refs directly.
    const patch = target.pr
      ? await gh.getPullRequestDiff(repo.localPath, target.pr.number)
      : await getDiff(repo.localPath, target.base, target.head);
    return c.text(patch);
  });

  app.get("/api/review-targets/:id/comments", (c) => {
    const id = c.req.param("id");
    // 404 (not an empty list) for an unknown target, so callers can tell
    // "no comments yet" apart from "no such target" — like the other GETs.
    if (!core.getReviewTarget(id)) throw new HttpError(404, `unknown review target: ${id}`);
    return c.json(core.commentsForTarget(id));
  });

  app.post("/api/review-targets/:id/ask", async (c) => {
    const body = assertAskBody(await c.req.json());
    const result = await core.ask({
      reviewTargetId: c.req.param("id"),
      codeAnchor: body.codeAnchor,
      question: body.question,
      referenceUrls: body.referenceUrls,
      threadId: body.threadId,
      // Fires when the client disconnects → the adapter cancels the agent.
      signal: c.req.raw.signal,
    });
    return c.json(result);
  });

  app.delete("/api/review-targets/:id", async (c) => {
    await core.closeReviewTarget(c.req.param("id"));
    return c.body(null, 204);
  });

  // Serve the built UI (if provided) at `/`, after the API routes so it never
  // shadows them. serveStatic's root is resolved relative to cwd, so translate
  // the absolute uiDir. Static assets are unauthenticated (they hold no secrets);
  // the token to reach /api arrives via the page URL fragment.
  if (options.uiDir !== undefined) {
    const root = relative(process.cwd(), options.uiDir) || ".";
    app.use("/*", serveStatic({ root }));
  }

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    if (err instanceof CoreError) {
      const status = err.kind === "not_found" ? 404 : err.kind === "conflict" ? 409 : 400;
      return c.json({ error: err.message }, status as ContentfulStatusCode);
    }
    // A bad/empty request body surfaces as a JSON parse error — a 400, not a 500.
    if (err instanceof SyntaxError) return c.json({ error: "invalid JSON body" }, 400);
    // gh/git layers reject invalid arguments (bad PR number, state, limit) with a RangeError.
    if (err instanceof RangeError) return c.json({ error: err.message }, 400);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  });

  return { app, token };
}

export interface StartServerOptions extends CreateServerOptions {
  /** Port to bind; 0 (the default) picks an ephemeral free port. */
  port?: number;
  /** Host to bind; defaults to loopback (127.0.0.1). */
  host?: string;
}

export interface RunningServer {
  /** Base URL, e.g. `http://127.0.0.1:53211`. */
  url: string;
  port: number;
  token: string;
  /** Stop listening. */
  close(): Promise<void>;
}

/** Create the API and bind it to a (by default loopback, ephemeral) port. */
export function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { app, token } = createServer(options);
  const host = options.host ?? "127.0.0.1";
  return new Promise<RunningServer>((resolve, reject) => {
    // Reject on a bind failure (EADDRINUSE/EACCES) instead of hanging forever and
    // letting the unhandled 'error' crash the process. Detach once we're listening.
    const onError = (err: Error): void => reject(err);
    const server = serve({ fetch: app.fetch, hostname: host, port: options.port ?? 0 }, (info) => {
      server.off("error", onError);
      resolve({
        url: formatBaseUrl(host, info.port),
        port: info.port,
        token,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
            // Destroy in-flight connections so each request's `signal` fires.
            // Prompt cancellation still depends on the adapter honoring that
            // signal; one that ignores it runs the ask to completion, so a caller
            // needing bounded shutdown must impose its own timeout (the CLI does).
            if ("closeAllConnections" in server) server.closeAllConnections();
          }),
      });
    });
    server.once("error", onError);
  });
}
