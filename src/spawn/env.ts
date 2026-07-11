/**
 * Environment that would hijack a spawned agent (e.g. `claude`) away from the
 * operator's logged-in SUBSCRIPTION and onto metered/per-token billing or a
 * different credential — the hazard this harness defends against.
 *
 * {@link SENSITIVE_ENV_KEYS} enumerates the credential / provider-selection vars
 * stripped from the child: the API key and tokens, custom headers, the OAuth
 * token, the non-subscription platform credentials, and the explicit
 * cloud-provider toggles (Bedrock / Vertex / Foundry / Mantle). These are listed
 * by EXACT name — not by a `CLAUDE_CODE_USE_*` prefix, because that namespace
 * also holds legitimate feature toggles (e.g. CLAUDE_CODE_USE_NATIVE_FILE_SEARCH,
 * CLAUDE_CODE_USE_POWERSHELL_TOOL) that must pass through. Re-audit the list
 * against the Claude Code env-var docs on each major CLI upgrade.
 *
 * A denylist (strip these) is used rather than an allowlist (pass only a few):
 * the agent still needs a broad, open-ended environment — PATH, HOME, TERM,
 * LANG, proxies, and arbitrary project tooling in the worktree — to run and to
 * authenticate via its subscription (read through HOME).
 *
 * Scope: this closes the shell-`export` path (where the inherited-API-key
 * incident lives). It does NOT rewrite settings the agent reads from disk via
 * HOME (the login wizard can persist a provider toggle into its config file);
 * sanitizing that is separate, larger scope.
 *
 * Deliberately NOT stripped: raw cloud credentials / region / project vars
 * (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`, `*_PROJECT_ID`, …). They are inert
 * to the agent once the provider toggles are gone, and legitimate worktree
 * tooling (aws, gcloud, terraform) needs them.
 */
export const SENSITIVE_ENV_KEYS = [
  // Credentials / auth tokens.
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_OAUTH_TOKEN",
  // Non-subscription platform credentials (AWS / Microsoft Foundry).
  "ANTHROPIC_AWS_API_KEY",
  "ANTHROPIC_AWS_WORKSPACE_ID",
  "ANTHROPIC_WORKSPACE_ID",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
  // Cloud-provider toggles — highest-precedence billing/auth override.
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_MANTLE",
] as const;

export type SensitiveEnvKey = (typeof SENSITIVE_ENV_KEYS)[number];

/**
 * Keys that can redirect the agent's config/credentials but are NOT stripped:
 * each is also the legitimate way an operator points `claude` at their
 * subscription login, so removing it could break auth. They are surfaced by
 * {@link detectWarnOnlyEnv} so the operator can confirm the value is intentional
 * (a wrong one would select a different profile/account). Stripping general
 * operator secrets (GH_TOKEN, cloud creds, SSH_AUTH_SOCK, …) is deliberately out
 * of scope: the agent is the operator's own trusted Claude Code and runs with the
 * same environment it would have interactively — par guards against billing /
 * account HIJACK, not against a trusted agent seeing the operator's own secrets.
 */
export const WARN_ONLY_ENV_KEYS = ["CLAUDE_CONFIG_DIR"] as const;
export type WarnOnlyEnvKey = (typeof WARN_ONLY_ENV_KEYS)[number];

/** A process environment. A key mapped to `undefined` is treated as absent. */
export type EnvLike = Record<string, string | undefined>;

function isSensitiveKey(key: string): boolean {
  // Match case-insensitively: Windows env-var names are case-insensitive, so a
  // differently-cased `anthropic_api_key` would otherwise pass through and be
  // resolved by the child as ANTHROPIC_API_KEY. On POSIX this only ever
  // over-strips credential-shaped names, which is safe. (SENSITIVE_ENV_KEYS is
  // uppercase; toUpperCase is locale-independent.)
  return (SENSITIVE_ENV_KEYS as readonly string[]).includes(key.toUpperCase());
}

function isWarnOnlyKey(key: string): boolean {
  return (WARN_ONLY_ENV_KEYS as readonly string[]).includes(key.toUpperCase());
}

/** Present, non-empty keys of `env` matching `predicate`, sorted. */
function presentMatching(env: EnvLike, predicate: (key: string) => boolean): string[] {
  return Object.keys(env)
    .filter((key) => {
      const value = env[key];
      return value !== undefined && value !== "" && predicate(key);
    })
    .sort();
}

/**
 * Return a copy of `env` with the sensitive keys and prefixes removed. The agent
 * then authenticates via its own logged-in session — never an inherited API key
 * or an inherited cloud-provider toggle. Warn-only keys ({@link WARN_ONLY_ENV_KEYS})
 * are intentionally preserved.
 */
export function sanitizeEnv(env: EnvLike): EnvLike {
  const clean: EnvLike = {};
  for (const [key, value] of Object.entries(env)) {
    if (!isSensitiveKey(key)) clean[key] = value;
  }
  return clean;
}

/**
 * The sensitive keys actually present (non-empty) in `env`, sorted — the keys
 * {@link sanitizeEnv} removes. Call before spawning to tell the operator their
 * shell was contaminated (the child is protected regardless).
 */
export function detectSensitiveEnv(env: EnvLike): string[] {
  return presentMatching(env, isSensitiveKey);
}

/**
 * Present, non-empty {@link WARN_ONLY_ENV_KEYS} in `env`, sorted. These are NOT
 * stripped; surface them so the operator can confirm the value points at their
 * intended subscription login rather than a different profile/account.
 */
export function detectWarnOnlyEnv(env: EnvLike): string[] {
  return presentMatching(env, isWarnOnlyKey);
}
