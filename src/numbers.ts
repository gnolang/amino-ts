import {
  AminoError,
} from "./errors";

export const INT64_MIN = -(2n ** 63n);
export const INT64_MAX = 2n ** 63n - 1n;

const RANGES: Record<string, [bigint, bigint]> = {
  int8: [-(2n ** 7n), 2n ** 7n - 1n],
  int16: [-(2n ** 15n), 2n ** 15n - 1n],
  int32: [-(2n ** 31n), 2n ** 31n - 1n],
  int64: [INT64_MIN, INT64_MAX],
  int: [INT64_MIN, INT64_MAX],
  duration: [INT64_MIN, INT64_MAX],
  uint8: [0n, 2n ** 8n - 1n],
  uint16: [0n, 2n ** 16n - 1n],
  uint32: [0n, 2n ** 32n - 1n],
  uint64: [0n, 2n ** 64n - 1n],
  uint: [0n, 2n ** 64n - 1n],
};

/** A JSON integer literal (no fraction, exponent, sign or leading zeros). */
export const INT_RE = /^-?(0|[1-9]\d*)$/;

/**
 * Normalizes an integer input (bigint, safe-integer number or decimal string)
 * to a bigint, checking it fits the Go type. `null`/`undefined` mean zero.
 */
export function toBigInt(value: unknown, kind: string): bigint {
  let v: bigint;
  if (typeof value === "bigint") {
    v = value;
  }
  else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new AminoError(`${kind}: ${value} is not a safe integer; pass a bigint`);
    }
    v = BigInt(value);
  }
  else if (typeof value === "string" && INT_RE.test(value)) {
    v = BigInt(value);
  }
  else if (value == null) {
    v = 0n;
  }
  else {
    throw new AminoError(`${kind}: expected an integer, got ${typeof value} ${String(value)}`);
  }
  const range = RANGES[kind];
  if (range && (v < range[0] || v > range[1])) {
    throw new AminoError(`${kind}: value ${v} out of range`);
  }
  return v;
}

/** Like `toBigInt`, for types that are at most 32 bits wide. */
export function toInt(value: unknown, kind: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    const range = RANGES[kind];
    if (value < Number(range[0]) || value > Number(range[1])) {
      throw new AminoError(`${kind}: value ${value} out of range`);
    }
    return value;
  }
  return Number(toBigInt(value, kind));
}

/** Whether a value is in range for the Go type (used by decoders). */
export function inRange(v: bigint, kind: string): boolean {
  const range = RANGES[kind];
  return v >= range[0] && v <= range[1];
}
