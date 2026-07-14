import { type FormEvent, useState } from "react";
import { useCockpit } from "../state/cockpit";
import type { PrStateFilter, Repository } from "../types";

const EMPTY_REPO: Repository = { id: "", name: "", localPath: "", remote: "origin", worktreeRoot: "" };
const FILTERS: PrStateFilter[] = ["open", "closed", "merged", "all"];

function AddRepositoryForm({ onDone }: { onDone: () => void }) {
  const { actions } = useCockpit();
  const [form, setForm] = useState<Repository>(EMPTY_REPO);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await actions.registerRepository(form);
    setForm(EMPTY_REPO);
    onDone();
  };

  const field = (key: keyof Repository, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
    </label>
  );

  return (
    <form className="add-repo" onSubmit={submit}>
      {field("id", "id")}
      {field("name", "name")}
      {field("localPath", "local path")}
      {field("remote", "remote")}
      {field("worktreeRoot", "worktree root")}
      <div className="composer-actions">
        <button type="submit">Register</button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RepositorySection() {
  const { state, actions } = useCockpit();
  const [adding, setAdding] = useState(false);

  return (
    <section className="left-section">
      <div className="section-title">Repositories</div>
      {state.repositories.length === 0 && (
        <p className="muted small">Add a repository to start reviewing.</p>
      )}
      <ul className="row-list">
        {state.repositories.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={`row${state.activeRepoId === r.id ? " active" : ""}`}
              onClick={() => void actions.selectRepo(r.id)}
            >
              {r.name}
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <AddRepositoryForm onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="link-btn" onClick={() => setAdding(true)}>
          + Add repository
        </button>
      )}
    </section>
  );
}

function PullRequestSection() {
  const { state, actions } = useCockpit();

  return (
    <section className="left-section">
      <div className="section-title">Pull requests</div>
      <div className="pr-filter">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`chip${state.prFilter === f ? " active" : ""}`}
            onClick={() => void actions.setPrFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      {state.pullRequests.length === 0 ? (
        <p className="muted small">No pull requests.</p>
      ) : (
        <ul className="row-list">
          {state.pullRequests.map((pr) => (
            <li key={pr.number}>
              <button
                type="button"
                className={`row${state.target?.target.pr?.number === pr.number ? " active" : ""}`}
                onClick={() => void actions.openPullRequest(pr)}
              >
                <span className="pr-num">#{pr.number}</span> {pr.title}
                <span className="muted small"> · {pr.state}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LocalBranchSection() {
  const { actions } = useCockpit();
  const [base, setBase] = useState("main");
  const [head, setHead] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (head.trim()) void actions.openLocalBranch(base.trim(), head.trim());
  };

  return (
    <section className="left-section">
      <div className="section-title muted">Review a local branch</div>
      <form onSubmit={submit} className="local-form">
        <label className="field">
          <span>compare from (base)</span>
          <input value={base} onChange={(e) => setBase(e.target.value)} />
        </label>
        <label className="field">
          <span>compare to (head)</span>
          <input
            value={head}
            onChange={(e) => setHead(e.target.value)}
            placeholder="branch or commit"
          />
        </label>
        <button type="submit" disabled={!head.trim()}>
          Open diff
        </button>
      </form>
    </section>
  );
}

export function LeftPane() {
  const { state } = useCockpit();
  return (
    <div className="pane left">
      <header className="pane-header">par</header>
      <RepositorySection />
      {state.activeRepoId && <PullRequestSection />}
      {state.activeRepoId && <LocalBranchSection />}
    </div>
  );
}
