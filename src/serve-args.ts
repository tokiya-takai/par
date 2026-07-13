/** Options for `par serve`, parsed from the CLI flags. */
export interface ServeOptions {
  port?: number;
  host?: string;
  token?: string;
}

const MAX_PORT = 65535;

/**
 * Validate and normalize `par serve` arguments. Throws an `Error` with a
 * user-facing message on invalid input (a malformed port, or unexpected extra
 * positional arguments) so the CLI can print it and exit non-zero rather than
 * dumping a stack trace or silently ignoring a typo.
 */
export function parseServeArgs(
  values: { port?: string; host?: string; token?: string },
  extraPositionals: string[],
): ServeOptions {
  if (extraPositionals.length > 0) {
    throw new Error(`unexpected argument(s): ${extraPositionals.join(" ")}`);
  }
  const options: ServeOptions = {};
  if (values.host !== undefined) options.host = values.host;
  if (values.token !== undefined) options.token = values.token;
  if (values.port !== undefined) {
    const raw = values.port.trim();
    const port = Number(raw);
    if (raw === "" || !Number.isInteger(port) || port < 0 || port > MAX_PORT) {
      throw new Error(
        `invalid --port: ${JSON.stringify(values.port)} (expected an integer 0-${MAX_PORT})`,
      );
    }
    options.port = port;
  }
  return options;
}
