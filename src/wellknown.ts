/**
 * `time.Time` and `time.Duration`: validation, and the exact JSON text Go
 * produces and accepts for them.
 */

import {
  AminoError,
} from "./errors";
import {
  INT64_MAX,
  INT64_MIN,
} from "./numbers";

/**
 * A `time.Time`, kept at nanosecond precision because a JS `Date` only holds
 * milliseconds. Use `Timestamp.fromDate` / `Timestamp.toDate` to convert.
 */
export interface Timestamp {
  /** Seconds since the Unix epoch, UTC. */
  seconds: bigint
  /** Nanoseconds within the second, in [0, 999999999]. */
  nanos: number
}

// See google/protobuf/timestamp.proto and duration.proto.
const MIN_TIME_SECONDS = -62135596800n; // 0001-01-01
const MAX_TIME_SECONDS = 253402300800n; // 10000-01-01, exclusive
const MAX_DURATION_SECONDS = 315576000000n;

export function checkTime(s: bigint, ns: number) {
  if (s < MIN_TIME_SECONDS || s >= MAX_TIME_SECONDS) {
    throw new AminoError(`invalid time: seconds have to be >= ${MIN_TIME_SECONDS} and < ${MAX_TIME_SECONDS}, got: ${s}`);
  }
  if (!Number.isInteger(ns) || ns < 0 || ns > 999999999) {
    throw new AminoError(`invalid time: nanoseconds have to be >= 0 and <= 999999999, got: ${ns}`);
  }
}

export function checkDuration(s: bigint, ns: number) {
  if ((s > 0n && ns < 0) || (s < 0n && ns > 0)) {
    throw new AminoError(`invalid duration: signs of seconds and nanos do not match: ${s} and ${ns}`);
  }
  if (s < -MAX_DURATION_SECONDS || s > MAX_DURATION_SECONDS) {
    throw new AminoError(`invalid duration: seconds have to be >= ${-MAX_DURATION_SECONDS} and < ${MAX_DURATION_SECONDS}, got: ${s}`);
  }
  if (ns < -999999999 || ns > 999999999) {
    throw new AminoError(`invalid duration: ns out of range [-999999999, 999999999], got: ${ns}`);
  }
}

/** Go's `time.Duration` range check on top of the protobuf one (`validateDurationValueGo`). */
export function durationFromParts(s: bigint, ns: number): bigint {
  checkDuration(s, ns);
  if (s < INT64_MIN / 1000000000n || s > INT64_MAX / 1000000000n) {
    throw new AminoError(`invalid duration: duration seconds exceeds bounds for Go's time.Duration type: ${s}`);
  }
  const d = BigInt.asIntN(64, s * 1000000000n + BigInt(ns));
  if ((d > 0n && s < 0n) || (d < 0n && s > 0n)) {
    throw new AminoError(`invalid duration: duration seconds+nanoseconds exceeds bounds for Go's time.Duration type: ${s} and ${ns}`);
  }
  return d;
}

/** Splits nanoseconds into seconds and nanos with the same sign, as Go does. */
export function durationParts(d: bigint): [s: bigint, ns: number] {
  return [d / 1000000000n, Number(d % 1000000000n)];
}

export function toTimestamp(value: unknown): Timestamp {
  if (value == null) return {
    seconds: 0n,
    nanos: 0,
  };
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === "object" && "seconds" in value) {
    const v = value as {
      seconds: bigint | number
      nanos?: number
    };
    if (typeof v.seconds === "number" && !Number.isSafeInteger(v.seconds)) {
      throw new AminoError(`invalid time: seconds ${v.seconds} is not an integer`);
    }
    return {
      seconds: BigInt(v.seconds),
      nanos: v.nanos ?? 0,
    };
  }
  throw new AminoError("expected a Timestamp ({ seconds, nanos }) or a Date");
}

// ----------------------------------------
// Calendar (proleptic Gregorian, UTC)

function civilFromDays(z: number): [y: number, m: number, d: number] {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [m <= 2 ? y + 1 : y, m, d];
}

function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function daysIn(month: number, year: number): number {
  if (month === 2) {
    return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** Trims 9 fractional digits to 0, 3, 6 or 9 digits, like amino's JSON encoders. */
function trimFraction(x: string): string {
  if (x.endsWith("000")) x = x.slice(0, -3);
  if (x.endsWith("000")) x = x.slice(0, -3);
  if (x.endsWith(".000")) x = x.slice(0, -4);
  return x;
}

/** Go `EncodeJSONTimeValue` (without the quotes). */
export function formatTime(ts: Timestamp): string {
  checkTime(ts.seconds, ts.nanos);
  const secs = Number(ts.seconds);
  const days = Math.floor(secs / 86400);
  const rem = secs - days * 86400;
  const [y, m, d] = civilFromDays(days);
  const x = `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}T${pad(Math.floor(rem / 3600), 2)}:`
    + `${pad(Math.floor(rem / 60) % 60, 2)}:${pad(rem % 60, 2)}.${pad(ts.nanos, 9)}`;
  return `${trimFraction(x)}Z`;
}

/** Go `time.Parse(time.RFC3339Nano, s)`. Years 0000-9999, any UTC offset. */
export function parseTime(s: string): Timestamp {
  const bad = () => new AminoError(`bad time: cannot parse ${JSON.stringify(s)} as RFC 3339`);
  const num = (a: number, b: number, min: number, max: number) => {
    const part = s.slice(a, b);
    if (!/^\d+$/.test(part)) throw bad();
    const v = Number(part);
    if (v < min || v > max) throw bad();
    return v;
  };
  if (s.length < 20) throw bad();
  if (s[4] !== "-" || s[7] !== "-" || s[10] !== "T" || s[13] !== ":" || s[16] !== ":") throw bad();
  const year = num(0, 4, 0, 9999);
  const month = num(5, 7, 1, 12);
  const day = num(8, 10, 1, daysIn(month, year));
  const hour = num(11, 13, 0, 23);
  const min = num(14, 16, 0, 59);
  const sec = num(17, 19, 0, 59);
  let rest = s.slice(19);
  let nanos = 0;
  if (rest.length >= 2 && (rest[0] === "." || rest[0] === ",") && /\d/.test(rest[1])) {
    let n = 1;
    while (n < rest.length && /\d/.test(rest[n])) n++;
    // Go uses at most 9 digits; the rest are truncated.
    nanos = Number(rest.slice(1, Math.min(n, 10)).padEnd(9, "0"));
    rest = rest.slice(n);
  }
  let offset = 0;
  if (rest !== "Z") {
    if (rest.length !== 6 || (rest[0] !== "+" && rest[0] !== "-") || rest[3] !== ":") throw bad();
    const oh = Number(rest.slice(1, 3));
    const om = Number(rest.slice(4, 6));
    if (!/^\d\d$/.test(rest.slice(1, 3)) || !/^\d\d$/.test(rest.slice(4, 6)) || oh > 23 || om > 59) throw bad();
    offset = (oh * 60 + om) * 60 * (rest[0] === "-" ? -1 : 1);
  }
  const days = daysFromCivil(year, month, day);
  const seconds = BigInt(days) * 86400n + BigInt(hour * 3600 + min * 60 + sec - offset);
  return {
    seconds,
    nanos,
  };
}

/** Go `EncodeJSONDurationValue` (without the quotes). */
export function formatDuration(d: bigint): string {
  let [s, ns] = durationParts(d);
  checkDuration(s, ns);
  let sign = "";
  if (s < 0n) {
    s = -s;
    sign = "-";
  }
  if (ns < 0) {
    ns = -ns;
    sign = "-";
  }
  return `${trimFraction(`${sign}${s}.${pad(ns, 9)}`)}s`;
}

const UNITS: Record<string, bigint> = {
  ns: 1n,
  us: 1000n,
  µs: 1000n, // U+00B5 micro sign
  μs: 1000n, // U+03BC Greek small letter mu
  ms: 1000000n,
  s: 1000000000n,
  m: 60n * 1000000000n,
  h: 3600n * 1000000000n,
};

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/** Go `time.ParseDuration`. */
export function parseDuration(orig: string): bigint {
  const invalid = () => new AminoError(`bad time: time: invalid duration ${JSON.stringify(orig)}`);
  const LIMIT = 1n << 63n;
  let s = orig;
  let neg = false;
  if (s !== "" && (s[0] === "-" || s[0] === "+")) {
    neg = s[0] === "-";
    s = s.slice(1);
  }
  if (s === "0") return 0n;
  if (s === "") throw invalid();
  let d = 0n;
  while (s !== "") {
    if (!(s[0] === "." || isDigit(s[0]))) throw invalid();
    // Leading integer.
    let v = 0n;
    let i = 0;
    for (; i < s.length && isDigit(s[i]); i++) {
      if (v > LIMIT / 10n) throw invalid();
      v = v * 10n + BigInt(s.charCodeAt(i) - 48);
      if (v > LIMIT) throw invalid();
    }
    const pre = i > 0;
    s = s.slice(i);
    // Fraction.
    let f = 0n;
    let scale = 1;
    let post = false;
    if (s !== "" && s[0] === ".") {
      s = s.slice(1);
      let j = 0;
      let overflow = false;
      for (; j < s.length && isDigit(s[j]); j++) {
        if (overflow) continue;
        if (f > (LIMIT - 1n) / 10n) {
          overflow = true;
          continue;
        }
        const y = f * 10n + BigInt(s.charCodeAt(j) - 48);
        if (y > LIMIT) {
          overflow = true;
          continue;
        }
        f = y;
        scale *= 10;
      }
      post = j > 0;
      s = s.slice(j);
    }
    if (!pre && !post) throw invalid();
    // Unit.
    let k = 0;
    while (k < s.length && s[k] !== "." && !isDigit(s[k])) k++;
    if (k === 0) throw new AminoError(`bad time: time: missing unit in duration ${JSON.stringify(orig)}`);
    const u = s.slice(0, k);
    s = s.slice(k);
    const unit = UNITS[u];
    if (unit === undefined) {
      throw new AminoError(`bad time: time: unknown unit ${JSON.stringify(u)} in duration ${JSON.stringify(orig)}`);
    }
    if (v > LIMIT / unit) throw invalid();
    v *= unit;
    if (f > 0n) {
      // Go computes the fraction in float64; do the same for identical rounding.
      v += BigInt(Math.trunc(Number(f) * (Number(unit) / scale)));
      if (v > LIMIT) throw invalid();
    }
    d += v;
    if (d > LIMIT) throw invalid();
  }
  if (neg) return BigInt.asIntN(64, -d);
  if (d > LIMIT - 1n) throw invalid();
  return d;
}

/** Helpers for `time.Time` values. */
export const Timestamp = {
  /** Converts a `Date` (millisecond precision). */
  fromDate(date: Date): Timestamp {
    const ms = date.getTime();
    if (!Number.isFinite(ms)) throw new AminoError("invalid Date");
    const seconds = Math.floor(ms / 1000);
    return {
      seconds: BigInt(seconds),
      nanos: (ms - seconds * 1000) * 1000000,
    };
  },
  /** Converts to a `Date`, truncating to milliseconds. */
  toDate(ts: Timestamp): Date {
    return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1000000));
  },
  /** Parses RFC 3339 text, like Go `time.Parse(time.RFC3339Nano, s)`. */
  parse: parseTime,
  /** Formats as amino JSON does (RFC 3339, UTC, 0/3/6/9 fractional digits). */
  format: formatTime,
};

/** Helpers for `time.Duration` values (bigint nanoseconds). */
export const Duration = {
  /** Go `time.ParseDuration`, e.g. `"1h2m3.5s"`. */
  parse: parseDuration,
  /** Formats as amino JSON does, e.g. `"3723.500s"`. */
  format: formatDuration,
};
