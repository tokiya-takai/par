import type { FileData } from "react-diff-view";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { type OpenReviewTargetBody, parApi } from "../api";
import { type LineIndex, type ResolvedAnchor, parsePatch } from "../lib/patch";
import type {
  Capabilities,
  CodeAnchor,
  Comment,
  DiffSide,
  PrStateFilter,
  PullRequest,
  Repository,
  ReviewTarget,
} from "../types";

export interface PendingAnchor {
  filePath: string;
  line: number;
  side: DiffSide;
  changeKey: string;
}

export interface TargetView {
  target: ReviewTarget;
  files: FileData[];
  lineIndex: LineIndex;
  diffError: string | null;
  comments: Comment[];
  pendingAnchor: PendingAnchor | null;
  asking: boolean;
  selectedAnchor: ResolvedAnchor | null;
  openThreadId: string | null;
}

interface State {
  capabilities: Capabilities | null;
  repositories: Repository[];
  activeRepoId: string | null;
  pullRequests: PullRequest[];
  prFilter: PrStateFilter;
  target: TargetView | null;
  error: string | null;
  busy: boolean;
}

type Action =
  | { type: "SET_CAPABILITIES"; capabilities: Capabilities }
  | { type: "SET_REPOS"; repositories: Repository[] }
  | { type: "SET_ACTIVE_REPO"; id: string | null }
  | { type: "SET_PULL_REQUESTS"; pullRequests: PullRequest[] }
  | { type: "SET_PR_FILTER"; filter: PrStateFilter }
  | { type: "SET_TARGET"; target: TargetView | null }
  | { type: "APPEND_COMMENT"; comment: Comment }
  | { type: "OPEN_COMPOSER"; anchor: PendingAnchor }
  | { type: "CLOSE_COMPOSER" }
  | { type: "SET_ASKING"; asking: boolean }
  | { type: "SET_SELECTED_ANCHOR"; anchor: ResolvedAnchor | null }
  | { type: "SET_OPEN_THREAD"; threadId: string | null }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_BUSY"; busy: boolean };

const initialState: State = {
  capabilities: null,
  repositories: [],
  activeRepoId: null,
  pullRequests: [],
  prFilter: "open",
  target: null,
  error: null,
  busy: false,
};

function patchTarget(state: State, patch: Partial<TargetView>): State {
  if (!state.target) return state;
  return { ...state, target: { ...state.target, ...patch } };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_CAPABILITIES":
      return { ...state, capabilities: action.capabilities };
    case "SET_REPOS":
      return { ...state, repositories: action.repositories };
    case "SET_ACTIVE_REPO":
      return { ...state, activeRepoId: action.id, pullRequests: [], target: null };
    case "SET_PULL_REQUESTS":
      return { ...state, pullRequests: action.pullRequests };
    case "SET_PR_FILTER":
      return { ...state, prFilter: action.filter };
    case "SET_TARGET":
      return { ...state, target: action.target };
    case "APPEND_COMMENT":
      return patchTarget(state, {
        comments: [...(state.target?.comments ?? []), action.comment],
      });
    case "OPEN_COMPOSER":
      return patchTarget(state, { pendingAnchor: action.anchor });
    case "CLOSE_COMPOSER":
      return patchTarget(state, { pendingAnchor: null });
    case "SET_ASKING":
      return patchTarget(state, { asking: action.asking });
    case "SET_SELECTED_ANCHOR":
      return patchTarget(state, { selectedAnchor: action.anchor });
    case "SET_OPEN_THREAD":
      return patchTarget(state, { openThreadId: action.threadId });
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "SET_BUSY":
      return { ...state, busy: action.busy };
    default:
      return state;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface CockpitActions {
  refreshRepositories(): Promise<void>;
  registerRepository(repo: Repository): Promise<void>;
  selectRepo(id: string): Promise<void>;
  setPrFilter(filter: PrStateFilter): Promise<void>;
  openPullRequest(pr: PullRequest): Promise<void>;
  openLocalBranch(base: string, head: string): Promise<void>;
  openComposer(anchor: PendingAnchor): void;
  closeComposer(): void;
  ask(question: string, referenceUrls: string[]): Promise<void>;
  reply(threadId: string, question: string, referenceUrls: string[]): Promise<void>;
  jumpToAnchor(anchor: ResolvedAnchor): void;
  selectThread(threadId: string): void;
  clearError(): void;
}

interface CockpitContextValue {
  state: State;
  actions: CockpitActions;
}

const CockpitContext = createContext<CockpitContextValue | null>(null);

export function CockpitProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const askController = useRef<AbortController | null>(null);
  // Keep the latest target id available to async callbacks without re-creating them.
  const targetId = state.target?.target.id ?? null;
  const targetIdRef = useRef<string | null>(targetId);
  targetIdRef.current = targetId;

  const setError = useCallback((error: unknown) => {
    dispatch({ type: "SET_ERROR", error: message(error) });
  }, []);

  const loadPullRequests = useCallback(
    async (repoId: string, filter: PrStateFilter) => {
      try {
        const prs = await parApi.listPullRequests(repoId, { state: filter });
        dispatch({ type: "SET_PULL_REQUESTS", pullRequests: prs });
      } catch (err) {
        // A repo with no gh remote / offline still lists as empty rather than crashing.
        dispatch({ type: "SET_PULL_REQUESTS", pullRequests: [] });
        setError(err);
      }
    },
    [setError],
  );

  const loadTarget = useCallback(
    async (target: ReviewTarget) => {
      askController.current?.abort();
      // Open the target even if the diff can't be loaded/parsed (e.g. a PR too
      // large for `gh pr diff`, or an odd patch) — the header and Q&A stay usable
      // and the reason shows in the diff pane, instead of failing the whole open.
      let files: FileData[] = [];
      let index: LineIndex = new Map();
      let diffError: string | null = null;
      try {
        const parsed = parsePatch(await parApi.getDiff(target.id));
        files = parsed.files;
        index = parsed.index;
      } catch (err) {
        diffError = message(err);
      }
      let comments: Comment[] = [];
      try {
        comments = await parApi.listComments(target.id);
      } catch (err) {
        setError(err);
      }
      dispatch({
        type: "SET_TARGET",
        target: {
          target,
          files,
          lineIndex: index,
          diffError,
          comments,
          pendingAnchor: null,
          asking: false,
          selectedAnchor: null,
          openThreadId: comments.at(-1)?.threadId ?? null,
        },
      });
    },
    [setError],
  );

  const refreshRepositories = useCallback(async () => {
    try {
      dispatch({ type: "SET_REPOS", repositories: await parApi.listRepositories() });
    } catch (err) {
      setError(err);
    }
  }, [setError]);

  const registerRepository = useCallback(
    async (repo: Repository) => {
      try {
        await parApi.registerRepository(repo);
        await refreshRepositories();
      } catch (err) {
        setError(err);
      }
    },
    [refreshRepositories, setError],
  );

  const selectRepo = useCallback(
    async (id: string) => {
      dispatch({ type: "SET_ACTIVE_REPO", id });
      await loadPullRequests(id, state.prFilter);
    },
    [loadPullRequests, state.prFilter],
  );

  const setPrFilter = useCallback(
    async (filter: PrStateFilter) => {
      dispatch({ type: "SET_PR_FILTER", filter });
      if (state.activeRepoId) await loadPullRequests(state.activeRepoId, filter);
    },
    [loadPullRequests, state.activeRepoId],
  );

  const openTarget = useCallback(
    async (body: OpenReviewTargetBody) => {
      dispatch({ type: "SET_BUSY", busy: true });
      try {
        const target = await parApi.openReviewTarget(body);
        await loadTarget(target);
      } catch (err) {
        setError(err);
      } finally {
        dispatch({ type: "SET_BUSY", busy: false });
      }
    },
    [loadTarget, setError],
  );

  const openPullRequest = useCallback(
    async (pr: PullRequest) => {
      const repo = state.repositories.find((r) => r.id === state.activeRepoId);
      if (!repo) return;
      // Fetch the PR head into a local ref and check that out. GitHub exposes
      // refs/pull/<n>/head on the base repo, so this also works for fork PRs
      // (unlike using the bare head branch name, which isn't resolvable locally).
      const localRef = `refs/par/pr-${pr.number}`;
      await openTarget({
        repositoryId: repo.id,
        base: pr.baseRef,
        head: localRef,
        pr: {
          number: pr.number,
          state: pr.state,
          title: pr.title,
          author: pr.author,
          url: pr.url,
          baseRef: pr.baseRef,
          headRef: pr.headRef,
        },
        fetch: { remote: repo.remote, refspec: `refs/pull/${pr.number}/head:${localRef}` },
      });
    },
    [openTarget, state.repositories, state.activeRepoId],
  );

  const openLocalBranch = useCallback(
    async (base: string, head: string) => {
      if (!state.activeRepoId) return;
      await openTarget({ repositoryId: state.activeRepoId, base, head });
    },
    [openTarget, state.activeRepoId],
  );

  const openComposer = useCallback((anchor: PendingAnchor) => {
    dispatch({ type: "OPEN_COMPOSER", anchor });
  }, []);
  const closeComposer = useCallback(() => dispatch({ type: "CLOSE_COMPOSER" }), []);
  const clearError = useCallback(() => dispatch({ type: "SET_ERROR", error: null }), []);
  const selectThread = useCallback(
    (threadId: string) => dispatch({ type: "SET_OPEN_THREAD", threadId }),
    [],
  );

  const submitAsk = useCallback(
    async (codeAnchor: CodeAnchor, question: string, referenceUrls: string[], threadId?: string) => {
      const id = targetIdRef.current;
      if (!id) return;
      askController.current?.abort();
      const controller = new AbortController();
      askController.current = controller;
      dispatch({ type: "SET_ASKING", asking: true });
      try {
        const result = await parApi.ask(
          id,
          { codeAnchor, question, referenceUrls, threadId },
          controller.signal,
        );
        dispatch({ type: "APPEND_COMMENT", comment: result.comment });
        dispatch({ type: "SET_OPEN_THREAD", threadId: result.comment.threadId });
        dispatch({ type: "CLOSE_COMPOSER" });
      } catch (err) {
        if (!controller.signal.aborted) setError(err);
      } finally {
        if (askController.current === controller) {
          askController.current = null;
          dispatch({ type: "SET_ASKING", asking: false });
        }
      }
    },
    [setError],
  );

  const ask = useCallback(
    async (question: string, referenceUrls: string[]) => {
      const anchor = state.target?.pendingAnchor;
      if (!anchor) return;
      await submitAsk(
        { filePath: anchor.filePath, line: anchor.line, side: anchor.side },
        question,
        referenceUrls,
      );
    },
    [state.target?.pendingAnchor, submitAsk],
  );

  const reply = useCallback(
    async (threadId: string, question: string, referenceUrls: string[]) => {
      const origin = state.target?.comments.find((c) => c.threadId === threadId);
      if (!origin) return;
      await submitAsk(origin.codeAnchor, question, referenceUrls, threadId);
    },
    [state.target?.comments, submitAsk],
  );

  const jumpToAnchor = useCallback((anchor: ResolvedAnchor) => {
    dispatch({ type: "SET_SELECTED_ANCHOR", anchor });
  }, []);

  // Initial load: capabilities + repositories.
  useEffect(() => {
    void (async () => {
      try {
        dispatch({ type: "SET_CAPABILITIES", capabilities: await parApi.capabilities() });
      } catch {
        // capabilities are advisory; ignore a failure here.
      }
    })();
    void refreshRepositories();
  }, [refreshRepositories]);

  const actions = useMemo<CockpitActions>(
    () => ({
      refreshRepositories,
      registerRepository,
      selectRepo,
      setPrFilter,
      openPullRequest,
      openLocalBranch,
      openComposer,
      closeComposer,
      ask,
      reply,
      jumpToAnchor,
      selectThread,
      clearError,
    }),
    [
      refreshRepositories,
      registerRepository,
      selectRepo,
      setPrFilter,
      openPullRequest,
      openLocalBranch,
      openComposer,
      closeComposer,
      ask,
      reply,
      jumpToAnchor,
      selectThread,
      clearError,
    ],
  );

  const value = useMemo<CockpitContextValue>(() => ({ state, actions }), [state, actions]);

  return <CockpitContext.Provider value={value}>{children}</CockpitContext.Provider>;
}

export function useCockpit(): CockpitContextValue {
  const ctx = useContext(CockpitContext);
  if (!ctx) throw new Error("useCockpit must be used within a CockpitProvider");
  return ctx;
}
