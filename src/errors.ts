/** Raised for every schema, encoding and decoding failure. */
export class AminoError extends Error {
  constructor(message: string, options?: {
    cause?: unknown
  }) {
    super(message);
    this.name = "AminoError";
    if (options && "cause" in options) {
      (this as {
        cause?: unknown
      }).cause = options.cause;
    }
  }
}

/** Prefixes an error's message with context, keeping it as the cause. */
export function wrap(e: unknown, context: string): AminoError {
  const msg = e instanceof Error ? e.message : String(e);
  return new AminoError(`${context}: ${msg}`, {
    cause: e,
  });
}
