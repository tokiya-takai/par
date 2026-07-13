import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { type Repository, parApi } from "./api";

const EMPTY: Repository = { id: "", name: "", localPath: "", remote: "origin", worktreeRoot: "" };

export function App() {
  const [health, setHealth] = useState("checking…");
  const [repos, setRepos] = useState<Repository[]>([]);
  const [form, setForm] = useState<Repository>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    parApi
      .listRepositories()
      .then(setRepos)
      .catch((e: unknown) => setError(String(e)));

  useEffect(() => {
    parApi
      .health()
      .then((h) => setHealth(h.ok ? "ok" : "not ok"))
      .catch((e: unknown) => setHealth(`error: ${String(e)}`));
    void refresh();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await parApi.registerRepository(form);
      setForm(EMPTY);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const field = (key: keyof Repository, label: string) => (
    <label>
      {label}
      <input
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </label>
  );

  return (
    <main>
      <h1>par</h1>
      <p>
        server: <strong>{health}</strong>
      </p>
      {error && <p className="error">{error}</p>}

      <h2>repositories</h2>
      {repos.length === 0 ? (
        <p className="muted">none registered yet</p>
      ) : (
        <ul>
          {repos.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong> — <code>{r.localPath}</code>
            </li>
          ))}
        </ul>
      )}

      <h2>register a repository</h2>
      <form onSubmit={submit} className="repo-form">
        {field("id", "id")}
        {field("name", "name")}
        {field("localPath", "local path")}
        {field("remote", "remote")}
        {field("worktreeRoot", "worktree root")}
        <button type="submit">register</button>
      </form>
    </main>
  );
}
