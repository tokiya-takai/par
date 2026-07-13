import { describe, expect, it } from "vitest";
import { ExecError, execCapture } from "../src/exec";

const NODE = process.execPath;
const CWD = process.cwd();

describe("execCapture", () => {
  it("captures stdout on success", async () => {
    const { stdout } = await execCapture(NODE, ["-e", "process.stdout.write('hi')"], { cwd: CWD });
    expect(stdout).toBe("hi");
  });

  it("throws ExecError with the exit code on a non-zero exit", async () => {
    await expect(
      execCapture(NODE, ["-e", "process.stderr.write('boom'); process.exit(2)"], { cwd: CWD }),
    ).rejects.toMatchObject({ name: "ExecError", code: 2 });
  });

  it("throws ExecError with a 'not found' reason for a missing binary", async () => {
    await expect(execCapture("par-no-such-bin-xyz", [], { cwd: CWD })).rejects.toThrow(/not found on PATH/);
  });

  it("does not blame PATH when the working directory is the problem", async () => {
    // A real binary in a non-existent cwd also ENOENTs — the message must not
    // claim the command is missing.
    await expect(
      execCapture(NODE, ["-e", ""], { cwd: "/no/such/dir/par-xyz" }),
    ).rejects.toThrow(/working directory does not exist/);
  });

  it("throws ExecError (timeout) when the command exceeds the timeout", async () => {
    await expect(
      execCapture(NODE, ["-e", "setTimeout(() => {}, 10000)"], { cwd: CWD, timeoutMs: 100 }),
    ).rejects.toThrow(/timed out or was killed/);
  });

  it("passes the provided env to the child", async () => {
    const { stdout } = await execCapture(
      NODE,
      ["-e", "process.stdout.write(process.env.PAR_MARKER ?? 'MISSING')"],
      { cwd: CWD, env: { ...process.env, PAR_MARKER: "present" } },
    );
    expect(stdout).toBe("present");
  });

  it("exposes command/args/reason on the error", async () => {
    const err = await execCapture("par-no-such-bin-xyz", ["a", "b"], { cwd: CWD }).catch((e) => e);
    expect(err).toBeInstanceOf(ExecError);
    expect(err.command).toBe("par-no-such-bin-xyz");
    expect(err.args).toEqual(["a", "b"]);
    expect(err.reason).toMatch(/not found on PATH/);
  });
});
