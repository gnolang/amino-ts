/**
 * The tm2 and gno.land types that implement MarshalAmino. Each converts to and
 * from its string form exactly as the Go methods do, including the same
 * validation, so decoding accepts and rejects the same input as a gno node.
 */

import {
  fromHex,
  toHex,
} from "../bytes";
import {
  AminoError,
} from "../errors";
import {
  INT64_MAX,
  INT64_MIN,
} from "../numbers";
import {
  t,
} from "../types";
import {
  utf8Encode,
} from "../utf8";
import {
  bech32Decode,
  bech32Encode,
} from "./bech32";

// ----------------------------------------
// Go strconv / strings helpers

// unicode.IsSpace: ASCII whitespace, U+0085, U+00A0, and categories Zs/Zl/Zp.
const GO_SPACE = "[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const TRIM_RE = new RegExp(`^${GO_SPACE}+|${GO_SPACE}+$`, "g");

/** Go `strings.TrimSpace`. */
export const goTrimSpace = (s: string) => s.replace(TRIM_RE, "");

const UINT64_MAX = 2n ** 64n - 1n;

/** Go `strconv.ParseInt(s, 10, 64)`. */
export function parseInt64(s: string): bigint {
  if (!/^[+-]?\d+$/.test(s)) throw new AminoError(`strconv.ParseInt: parsing ${JSON.stringify(s)}: invalid syntax`);
  const v = BigInt(s.replace(/^\+/, ""));
  if (v < INT64_MIN || v > INT64_MAX) throw new AminoError(`strconv.ParseInt: parsing ${JSON.stringify(s)}: value out of range`);
  return v;
}

/** Go `strconv.ParseUint(s, 10, 64)`. */
export function parseUint64(s: string): bigint {
  if (!/^\d+$/.test(s)) throw new AminoError(`strconv.ParseUint: parsing ${JSON.stringify(s)}: invalid syntax`);
  const v = BigInt(s);
  if (v > UINT64_MAX) throw new AminoError(`strconv.ParseUint: parsing ${JSON.stringify(s)}: value out of range`);
  return v;
}

const BOOLS: Record<string, boolean> = {
  1: true,
  t: true,
  T: true,
  TRUE: true,
  true: true,
  True: true,
  0: false,
  f: false,
  F: false,
  FALSE: false,
  false: false,
  False: false,
};

// ----------------------------------------
// crypto.Address

/** The bech32 prefix of gno.land addresses (`crypto.Bech32AddrPrefix`). */
export const ADDRESS_PREFIX = "g";
export const ADDRESS_SIZE = 20;

/** `crypto.AddressToBech32`. */
export function addressToBech32(addr: Uint8Array): string {
  return bech32Encode(ADDRESS_PREFIX, addr);
}

/** `crypto.AddressFromBech32`: fails on an empty string. */
export function addressFromBech32(s: string): Uint8Array {
  if (s.length === 0) throw new AminoError("decoding Bech32 failed: must provide a valid bech32 string");
  const {
    prefix, bytes,
  } = bech32Decode(s);
  if (prefix !== ADDRESS_PREFIX) throw new AminoError(`invalid Bech32 prefix; expected ${ADDRESS_PREFIX}, got ${prefix}`);
  if (bytes.length !== ADDRESS_SIZE) {
    throw new AminoError(`unexpected address byte length. expected ${ADDRESS_SIZE}, got ${bytes.length}`);
  }
  return bytes;
}

/** `crypto.Address`: `[20]byte`, encoded as a bech32 string. An empty string decodes to the zero address. */
export const Address = t.repr(
  t.string,
  (addr: Uint8Array) => addressToBech32(addr),
  s => (s === "" ? new Uint8Array(ADDRESS_SIZE) : addressFromBech32(s)),
  {
    name: "crypto.Address",
    goKind: "array",
    isZero: a => a.every(b => b === 0),
    zero: () => new Uint8Array(ADDRESS_SIZE),
  },
);

// ----------------------------------------
// std.Coin, std.Coins

export interface CoinValue {
  denom: string
  amount: bigint
}

const PKG_PATH_LIMIT = 256;
const MAX_BASE_DENOM_LENGTH = 16;
/** `std.MaxDenomLength`. */
export const MAX_DENOM_LENGTH = 1 + PKG_PATH_LIMIT + 1 + MAX_BASE_DENOM_LENGTH;
/** `std.MaxCoinsCount`. */
export const MAX_COINS_COUNT = 256;

const DENOM_RE = /^[a-z/][a-z0-9_.:/-]{2,}$/;
const COIN_RE = /^([0-9]+)[\t\n\v\f\r ]*([a-z/][a-z0-9_.:/-]{2,})$/;

/** `std.ValidateDenom`. */
export function validateDenom(denom: string) {
  if (denom.length > MAX_DENOM_LENGTH) throw new AminoError(`denom length ${denom.length} exceeds limit ${MAX_DENOM_LENGTH}`);
  if (!DENOM_RE.test(denom)) throw new AminoError(`invalid denom: ${denom}`);
}

/** `Coin.String`: `<amount><denom>`, or `""` for a zero amount. */
export function formatCoin(c: CoinValue): string {
  return c.amount === 0n ? "" : `${c.amount}${c.denom}`;
}

/** `std.ParseCoin`. */
export function parseCoin(s: string): CoinValue {
  s = goTrimSpace(s);
  const size = utf8Encode(s).length;
  if (size > MAX_DENOM_LENGTH + 20) throw new AminoError(`invalid coin expression: ${size} bytes exceeds the limit`);
  const m = COIN_RE.exec(s);
  if (!m) throw new AminoError(`invalid coin expression: ${s}`);
  const amount = BigInt(m[1]);
  if (amount > INT64_MAX) throw new AminoError(`failed to parse coin amount: ${m[1]}`);
  validateDenom(m[2]);
  return {
    denom: m[2],
    amount,
  };
}

/** `Coins.String`. */
export function formatCoins(coins: readonly CoinValue[]): string {
  return coins.map(formatCoin).join(",");
}

/** `std.ParseCoins`: comma separated, then sorted and validated (positive, no duplicates). */
export function parseCoins(s: string): CoinValue[] {
  s = goTrimSpace(s);
  if (s.length === 0) return [];
  const parts = s.split(",");
  if (parts.length > MAX_COINS_COUNT) throw new AminoError(`coin count exceeds the limit ${MAX_COINS_COUNT}`);
  const coins = parts.map(parseCoin).sort((a, b) => (a.denom < b.denom ? -1 : a.denom > b.denom ? 1 : 0));
  coins.forEach((c, i) => {
    if (c.amount <= 0n) throw new AminoError(`parseCoins: invalid coins: non-positive coin amount: ${c.amount}`);
    if (i > 0 && coins[i - 1].denom === c.denom) throw new AminoError(`parseCoins: invalid coins: duplicate denom: ${c.denom}`);
  });
  return coins;
}

/** `std.Coin`: a struct encoded as `"<amount><denom>"`. */
export const Coin = t.repr(
  t.string,
  formatCoin,
  s => (s === ""
    ? {
      denom: "",
      amount: 0n,
    }
    : parseCoin(s)),
  {
    name: "std.Coin",
    isZero: c => c.denom === "" && c.amount === 0n,
    zero: () => ({
      denom: "",
      amount: 0n,
    }),
  },
);

/** `std.Coins`: a list encoded as `"<coin>,<coin>"`. The empty list is `[]`. */
export const Coins = t.repr(t.string, (cs: CoinValue[]) => formatCoins(cs ?? []), parseCoins, {
  name: "std.Coins",
  goKind: "scalar",
  isZero: cs => !cs || cs.length === 0,
  zero: () => [],
});

// ----------------------------------------
// params.Param

export type ParamValue
  = | {
    key: string
    type: "string"
    value: string
  }
  | {
    key: string
    type: "int64" | "uint64"
    value: bigint
  }
  | {
    key: string
    type: "bool"
    value: boolean
  }
  | {
    key: string
    type: "bytes"
    value: Uint8Array
  }
  | {
    key: string
    type: "strings"
    value: string[]
  };

/** `Param.String`: `<key>.<type>=<value>`. */
export function formatParam(p: ParamValue): string {
  const k = `${p.key}.${p.type}`;
  switch (p.type) {
    case "string":
    case "int64":
    case "uint64":
      return `${k}=${p.value}`;
    case "bool":
      return `${k}=${p.value ? "true" : "false"}`;
    case "bytes":
      return `${k}=${toHex(p.value)}`;
    case "strings":
      return `${k}=${p.value.join(",")}`;
    default:
      throw new AminoError(`invalid param type:${(p as {
        type: string
      }).type}`);
  }
}

/** `Param.Parse`. */
export function parseParam(entry: string): ParamValue {
  const trimmed = goTrimSpace(entry);
  const eq = trimmed.indexOf("=");
  if (eq < 0) throw new AminoError(`malformed entry: ${JSON.stringify(entry)}`);
  const keyWithType = trimmed.slice(0, eq);
  const raw = trimmed.slice(eq + 1);
  const type = keyWithType.slice(keyWithType.lastIndexOf(".") + 1);
  const key = keyWithType.endsWith(`.${type}`) ? keyWithType.slice(0, -type.length - 1) : keyWithType;
  switch (type) {
    case "string":
      return {
        key,
        type,
        value: raw,
      };
    case "int64":
      return {
        key,
        type,
        value: parseInt64(raw),
      };
    case "uint64":
      return {
        key,
        type,
        value: parseUint64(raw),
      };
    case "bool":
      if (!(raw in BOOLS)) throw new AminoError(`strconv.ParseBool: parsing ${JSON.stringify(raw)}: invalid syntax`);
      return {
        key,
        type,
        value: BOOLS[raw],
      };
    case "bytes":
      return {
        key,
        type,
        value: fromHex(raw),
      };
    case "strings":
      return {
        key,
        type,
        value: raw.split(","),
      };
    default:
      throw new AminoError(`unsupported param type: ${type} (${entry})`);
  }
}

/** `params.Param`: encoded as `"<key>.<type>=<value>"`. */
export const Param = t.repr(t.string, formatParam, parseParam, {
  name: "params.Param",
  // Go's zero Param has no type, so it cannot be encoded (Go panics).
  zero: () => ({
    key: "",
    type: "",
    value: null,
  }) as unknown as ParamValue,
});

// ----------------------------------------
// gnoland.Balance

export interface VestingScheduleValue {
  originalVesting: CoinValue[]
  startTime: bigint
  endTime: bigint
  /** `""` (linear) or `"delayed"`. */
  type: string
}

export interface BalanceValue {
  address: Uint8Array
  amount: CoinValue[]
  vesting: VestingScheduleValue | null
}

/** `Balance.String`: `<address>=<coins>[;vesting=<coins>,<start>,<end>[;type=delayed]]`. */
export function formatBalance(b: BalanceValue): string {
  let s = `${addressToBech32(b.address)}=${formatCoins(b.amount)}`;
  const v = b.vesting;
  if (v && v.originalVesting.some(c => c.amount !== 0n)) {
    s += `;vesting=${formatCoins(v.originalVesting)},${v.startTime},${v.endTime}`;
    if (v.type === "delayed") s += ";type=delayed";
  }
  return s;
}

/** `Balance.Parse`. */
export function parseBalance(entry: string): BalanceValue {
  const all = goTrimSpace(entry).split(";");
  const parts = all.length > 3 ? [...all.slice(0, 2), all.slice(2).join(";")] : all;
  const eq = parts[0].indexOf("=");
  if (eq < 0) throw new AminoError(`malformed entry: ${JSON.stringify(entry)}`);
  const address = addressFromBech32(parts[0].slice(0, eq));
  const amount = parseCoins(parts[0].slice(eq + 1));
  let vesting: VestingScheduleValue | null = null;
  if (parts.length >= 2) {
    if (!parts[1].startsWith("vesting=")) throw new AminoError(`malformed vesting option: ${JSON.stringify(parts[1])}`);
    const fields = parts[1].slice("vesting=".length).split(",");
    if (fields.length < 3) throw new AminoError(`malformed vesting schedule: ${JSON.stringify(parts[1])}`);
    vesting = {
      originalVesting: parseCoins(fields.slice(0, -2).join(",")),
      startTime: parseInt64(fields[fields.length - 2]),
      endTime: parseInt64(fields[fields.length - 1]),
      type: "",
    };
    if (parts.length === 3) {
      if (parts[2] !== "type=delayed") throw new AminoError(`unknown vesting type: ${JSON.stringify(parts[2])}`);
      vesting.type = "delayed";
    }
  }
  return {
    address,
    amount,
    vesting,
  };
}

/** `gnoland.Balance`: a genesis balance entry, encoded as a string. */
export const Balance = t.repr(t.string, formatBalance, parseBalance, {
  name: "gnoland.Balance",
  isZero: b => b.address.every(x => x === 0) && b.amount.length === 0 && b.vesting === null,
  zero: () => ({
    address: new Uint8Array(ADDRESS_SIZE),
    amount: [],
    vesting: null,
  }),
});
