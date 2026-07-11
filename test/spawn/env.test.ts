import { describe, expect, it } from "vitest";
import {
  SENSITIVE_ENV_KEYS,
  detectSensitiveEnv,
  detectWarnOnlyEnv,
  sanitizeEnv,
} from "../../src/spawn/env";

describe("sanitizeEnv", () => {
  it("strips every explicit sensitive key", () => {
    const clean = sanitizeEnv({
      PATH: "/usr/bin",
      HOME: "/home/x",
      ANTHROPIC_API_KEY: "sk-secret",
      ANTHROPIC_AUTH_TOKEN: "tok",
      ANTHROPIC_BASE_URL: "https://example",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth",
      ANTHROPIC_CUSTOM_HEADERS: "x-api-key: leak",
    });

    expect(clean.PATH).toBe("/usr/bin");
    expect(clean.HOME).toBe("/home/x");
    for (const key of SENSITIVE_ENV_KEYS) {
      expect(key in clean).toBe(false);
    }
  });

  it("strips the enumerated cloud-provider toggles but keeps feature toggles", () => {
    const clean = sanitizeEnv({
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      CLAUDE_CODE_USE_FOUNDRY: "1",
      CLAUDE_CODE_USE_MANTLE: "1",
      CLAUDE_CODE_USE_NATIVE_FILE_SEARCH: "1",
      CLAUDE_CODE_USE_POWERSHELL_TOOL: "1",
      PATH: "/usr/bin",
    });

    expect("CLAUDE_CODE_USE_BEDROCK" in clean).toBe(false);
    expect("CLAUDE_CODE_USE_VERTEX" in clean).toBe(false);
    expect("CLAUDE_CODE_USE_FOUNDRY" in clean).toBe(false);
    expect("CLAUDE_CODE_USE_MANTLE" in clean).toBe(false);
    // Feature toggles are not provider selectors and must pass through.
    expect(clean.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH).toBe("1");
    expect(clean.CLAUDE_CODE_USE_POWERSHELL_TOOL).toBe("1");
    expect(clean.PATH).toBe("/usr/bin");
  });

  it("keeps raw cloud credentials (legitimate worktree tooling needs them)", () => {
    const clean = sanitizeEnv({
      AWS_ACCESS_KEY_ID: "x",
      AWS_REGION: "us-east-1",
      GOOGLE_APPLICATION_CREDENTIALS: "/creds.json",
    });

    expect(clean.AWS_ACCESS_KEY_ID).toBe("x");
    expect(clean.AWS_REGION).toBe("us-east-1");
    expect(clean.GOOGLE_APPLICATION_CREDENTIALS).toBe("/creds.json");
  });

  it("matches case-insensitively (Windows env names are case-insensitive)", () => {
    const clean = sanitizeEnv({
      anthropic_api_key: "sk",
      Anthropic_Auth_Token: "tok",
      claude_code_use_bedrock: "1",
      PATH: "/usr/bin",
    });

    expect("anthropic_api_key" in clean).toBe(false);
    expect("Anthropic_Auth_Token" in clean).toBe(false);
    expect("claude_code_use_bedrock" in clean).toBe(false);
    expect(clean.PATH).toBe("/usr/bin");
  });

  it("keeps CLAUDE_CONFIG_DIR (warn-only, not stripped — can be a legit login path)", () => {
    const clean = sanitizeEnv({ CLAUDE_CONFIG_DIR: "/custom", PATH: "/usr/bin" });
    expect(clean.CLAUDE_CONFIG_DIR).toBe("/custom");
  });

  it("does not mutate its input", () => {
    const input = { ANTHROPIC_API_KEY: "sk" };
    sanitizeEnv(input);
    expect(input.ANTHROPIC_API_KEY).toBe("sk");
  });
});

describe("detectWarnOnlyEnv", () => {
  it("reports CLAUDE_CONFIG_DIR when present (case-insensitive), sorted", () => {
    expect(detectWarnOnlyEnv({ CLAUDE_CONFIG_DIR: "/x", PATH: "/" })).toEqual(["CLAUDE_CONFIG_DIR"]);
    expect(detectWarnOnlyEnv({ claude_config_dir: "/x" })).toEqual(["claude_config_dir"]);
  });

  it("returns empty when absent or empty, and never lists a stripped key", () => {
    expect(detectWarnOnlyEnv({ PATH: "/" })).toEqual([]);
    expect(detectWarnOnlyEnv({ CLAUDE_CONFIG_DIR: "" })).toEqual([]);
    expect(detectWarnOnlyEnv({ ANTHROPIC_API_KEY: "x" })).toEqual([]);
  });
});

describe("detectSensitiveEnv", () => {
  it("reports present sensitive keys, sorted", () => {
    expect(
      detectSensitiveEnv({ CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_API_KEY: "x", PATH: "/" }),
    ).toEqual(["ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK"]);
  });

  it("ignores empty-string and absent keys", () => {
    expect(detectSensitiveEnv({ ANTHROPIC_API_KEY: "", FOO: "bar" })).toEqual([]);
  });

  it("detects sensitive keys regardless of case", () => {
    expect(detectSensitiveEnv({ anthropic_api_key: "x", FOO: "bar" })).toEqual(["anthropic_api_key"]);
  });
});
