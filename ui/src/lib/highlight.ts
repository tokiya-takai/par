import refractor from "refractor";
import { type HunkData, type HunkTokens, tokenize } from "react-diff-view";

// Extension → refractor (Prism) language. Only languages the bundled refractor
// supports; anything else falls through to plain (unhighlighted) text.
const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
};

/** Refractor language for a path, or null when we shouldn't try to highlight it. */
export function languageForPath(path: string): string | null {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (base === "dockerfile") return "docker";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  return EXTENSION_LANGUAGE[base.slice(dot + 1)] ?? null;
}

// Don't tokenize enormous files on the main thread.
const MAX_HIGHLIGHT_CHANGES = 4000;

/**
 * Syntax-highlight a file's hunks. Returns undefined (→ plain text) when the
 * language is unsupported, the file is too large, or refractor lacks the grammar.
 */
export function highlightHunks(
  hunks: HunkData[],
  language: string | null,
): HunkTokens | undefined {
  if (!language) return undefined;
  const changeCount = hunks.reduce((n, h) => n + h.changes.length, 0);
  if (changeCount > MAX_HIGHLIGHT_CHANGES) return undefined;
  try {
    return tokenize(hunks, { highlight: true, refractor, language });
  } catch {
    return undefined;
  }
}
