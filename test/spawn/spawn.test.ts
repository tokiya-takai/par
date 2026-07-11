import { describe, expect, it } from "vitest";
import { spawnClean } from "../../src/spawn/spawn";

// Spawn the current Node binary so the tests are self-contained and cross-platform.
const NODE = process.execPath;

describe("spawnClean", () => {
  it("captures stdout and a zero exit code", async () => {
    const result = await spawnClean(NODE, ["-e", "process.stdout.write('hello')"]);
    expect(result.stdout).toBe("hello");
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it("does not leak an API key into the child, even when the parent has one set", async () => {
    const result = await spawnClean(
      NODE,
      ["-e", "process.stdout.write(process.env.ANTHROPIC_API_KEY ?? 'CLEAN')"],
      { env: { ...process.env, ANTHROPIC_API_KEY: "sk-should-not-leak" } },
    );
    expect(result.stdout).toBe("CLEAN");
  });

  it("does not leak a provider toggle (CLAUDE_CODE_USE_BEDROCK) into the child", async () => {
    const result = await spawnClean(
      NODE,
      ["-e", "process.stdout.write(process.env.CLAUDE_CODE_USE_BEDROCK ?? 'CLEAN')"],
      { env: { ...process.env, CLAUDE_CODE_USE_BEDROCK: "1" } },
    );
    expect(result.stdout).toBe("CLEAN");
  });

  it("preserves multibyte (CJK + emoji) output across chunk boundaries", async () => {
    const expected = `${"あ".repeat(100_000)}🎉`;
    const result = await spawnClean(NODE, [
      "-e",
      "process.stdout.write('あ'.repeat(100000) + '🎉')",
    ]);
    expect(result.stdout).toBe(expected);
    expect(result.stdout).not.toContain("�");
  });

  it("captures stderr and a non-zero exit code", async () => {
    const result = await spawnClean(NODE, [
      "-e",
      "process.stderr.write('boom'); process.exit(3)",
    ]);
    expect(result.stderr).toBe("boom");
    expect(result.code).toBe(3);
  });

  it("truncates output and kills the child when it exceeds maxOutputBytes", async () => {
    const result = await spawnClean(
      NODE,
      ["-e", "setInterval(() => process.stdout.write('x'.repeat(100000)), 1)"],
      { maxOutputBytes: 50_000, timeoutMs: 5_000 },
    );
    expect(result.truncated).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it("truncates and kills when output first reaches the cap exactly, then more arrives", async () => {
    // First write fills exactly to the cap; a later write exceeds it. The child
    // stays alive (setInterval), so a passing result proves the boundary kill
    // fired rather than the timeout safety net.
    const result = await spawnClean(
      NODE,
      [
        "-e",
        "process.stdout.write('x'.repeat(1000)); setTimeout(() => process.stdout.write('y'), 50); setInterval(() => {}, 1000);",
      ],
      { maxOutputBytes: 1000, timeoutMs: 5_000 },
    );
    expect(result.truncated).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it("marks a result as timed out when the child exceeds the timeout", async () => {
    const result = await spawnClean(NODE, ["-e", "setTimeout(() => {}, 10000)"], {
      timeoutMs: 100,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
  });

  it("kills the child and rejects when the abort signal fires", async () => {
    const controller = new AbortController();
    const promise = spawnClean(NODE, ["-e", "setTimeout(() => {}, 10000)"], {
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toBeDefined();
  });

  it("rejects immediately when given an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      spawnClean(NODE, ["-e", "process.exit(0)"], { signal: controller.signal }),
    ).rejects.toBeDefined();
  });

  it("rejects when the command does not exist", async () => {
    await expect(spawnClean("par-no-such-command-xyz", [])).rejects.toBeDefined();
  });

  it("throws RangeError on a non-finite or out-of-range timeoutMs", () => {
    expect(() => spawnClean(NODE, [], { timeoutMs: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => spawnClean(NODE, [], { timeoutMs: Number.NaN })).toThrow(RangeError);
    expect(() => spawnClean(NODE, [], { timeoutMs: -1 })).toThrow(RangeError);
    expect(() => spawnClean(NODE, [], { timeoutMs: 2_147_483_648 })).toThrow(RangeError);
  });

  it("throws RangeError on a non-positive or non-finite maxOutputBytes", () => {
    expect(() => spawnClean(NODE, [], { maxOutputBytes: Number.NaN })).toThrow(RangeError);
    expect(() => spawnClean(NODE, [], { maxOutputBytes: 0 })).toThrow(RangeError);
    expect(() => spawnClean(NODE, [], { maxOutputBytes: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});
