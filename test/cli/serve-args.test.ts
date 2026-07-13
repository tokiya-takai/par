import { describe, expect, it } from "vitest";
import { buildCockpitUrl, parseServeArgs } from "../../src/serve-args";

describe("parseServeArgs", () => {
  it("parses valid flags and defaults", () => {
    expect(parseServeArgs({ port: "3000", host: "127.0.0.1", token: "t" }, [])).toEqual({
      port: 3000,
      host: "127.0.0.1",
      token: "t",
    });
    expect(parseServeArgs({}, [])).toEqual({});
    expect(parseServeArgs({ port: "0" }, [])).toEqual({ port: 0 });
    expect(parseServeArgs({ port: "65535" }, [])).toEqual({ port: 65535 });
  });

  it("rejects an out-of-range, empty, or non-integer port", () => {
    for (const port of ["65536", "-1", "", "  ", "abc", "1.5", "1e5"]) {
      expect(() => parseServeArgs({ port }, [])).toThrow(/--port/);
    }
  });

  it("rejects unexpected extra positionals", () => {
    expect(() => parseServeArgs({}, ["oops"])).toThrow(/unexpected/);
    expect(() => parseServeArgs({ port: "3000" }, ["a", "b"])).toThrow(/unexpected/);
  });
});

describe("buildCockpitUrl", () => {
  it("round-trips tokens with URL-special chars through the fragment", () => {
    // Mirrors the UI's readToken: URLSearchParams over the hash after "#".
    for (const token of ["abc123def", "a+b", "a&b=c", "50%25off", "with space", "x/y?z"]) {
      const url = buildCockpitUrl("http://127.0.0.1:5000", token);
      const hash = new URL(url).hash.replace(/^#/, "");
      expect(new URLSearchParams(hash).get("token")).toBe(token);
    }
  });
});
