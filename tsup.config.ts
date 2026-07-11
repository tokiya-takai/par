import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  target: "node20",
  // Declarations are emitted by `tsc -p tsconfig.build.json` (see build script),
  // not by tsup's rollup-plugin-dts, which is unstable on this toolchain.
  dts: false,
  clean: true,
  sourcemap: true,
});
