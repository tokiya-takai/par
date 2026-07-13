#!/usr/bin/env node
import { parseArgs } from "node:util";
import { startCockpit } from "./index.js";
import { type ServeOptions, parseServeArgs } from "./serve-args.js";

/** How long to wait for a graceful shutdown before forcing exit. */
const SHUTDOWN_GRACE_MS = 10_000;

function printUsage(): void {
  console.log("Usage: par serve [--port <n>] [--host <host>] [--token <token>]");
  console.log("");
  console.log("Starts the local review cockpit HTTP server (offline stub adapter).");
}

async function serve(options: ServeOptions): Promise<void> {
  const cockpit = await startCockpit(options);
  console.log(`par cockpit listening on ${cockpit.url}`);
  console.log(`token: ${cockpit.token}`);
  console.log("using the offline stub adapter (no real agent yet). Press Ctrl+C to stop.");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down and cleaning up worktrees…`);
    // Backstop: an adapter that ignores its abort signal could keep an ask (and
    // thus close()) running indefinitely. Force exit after a grace period.
    const force = setTimeout(() => {
      console.error(`shutdown did not finish within ${SHUTDOWN_GRACE_MS}ms — forcing exit.`);
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    try {
      await cockpit.close();
      clearTimeout(force);
      process.exit(0);
    } catch (err) {
      clearTimeout(force);
      console.error("error during shutdown:", err);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      token: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  const command = positionals[0];
  if (values.help || command === undefined) {
    printUsage();
    return;
  }
  if (command !== "serve") {
    console.error(`unknown command: ${command}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  let options: ServeOptions;
  try {
    options = parseServeArgs(values, positionals.slice(1));
  } catch (err) {
    console.error((err as Error).message);
    printUsage();
    process.exitCode = 1;
    return;
  }
  await serve(options);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
