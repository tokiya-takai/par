/** Semantic kind of a {@link CoreError}; a transport maps it to its own status. */
export type CoreErrorKind = "not_found" | "invalid_request" | "conflict";

/**
 * A domain error raised by Core. It carries a transport-agnostic `kind` (not an
 * HTTP status) so Core stays free of transport concerns — the HTTP layer maps
 * `kind` to a status, a CLI could map it to an exit code, etc.
 */
export class CoreError extends Error {
  constructor(
    readonly kind: CoreErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "CoreError";
  }
}
