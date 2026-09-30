/**
 * Schemas for the gno.land transaction types, as a realistic user of the
 * library would write them. Mirrors tm2/pkg/std, tm2/pkg/sdk/bank and
 * gno.land/pkg/sdk/vm.
 */

import {
  AminoError,
  Codec,
  t,
} from "../src";

// ----------------------------------------
// bech32 (BIP-173), enough for addresses.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

const hrpExpand = (hrp: string) => [...[...hrp].map(c => c.charCodeAt(0) >> 5), 0, ...[...hrp].map(c => c.charCodeAt(0) & 31)];

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const v of Array.from(data)) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & maxv);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & maxv))) throw new AminoError("bech32: invalid padding");
  return out;
}

export function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const data = convertBits(bytes, 8, 5, true);
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({
    length: 6,
  }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map(d => CHARSET[d]).join("")}`;
}

export function bech32Decode(s: string): {
  hrp: string
  bytes: Uint8Array
} {
  const pos = s.lastIndexOf("1");
  if (pos < 1 || s !== s.toLowerCase()) throw new AminoError(`bech32: invalid string ${JSON.stringify(s)}`);
  const hrp = s.slice(0, pos);
  const data = [...s.slice(pos + 1)].map((c) => {
    const d = CHARSET.indexOf(c);
    if (d < 0) throw new AminoError("bech32: invalid character");
    return d;
  });
  if (data.length < 6 || polymod([...hrpExpand(hrp), ...data]) !== 1) throw new AminoError("bech32: invalid checksum");
  return {
    hrp,
    bytes: Uint8Array.from(convertBits(data.slice(0, -6), 5, 8, false)),
  };
}

// ----------------------------------------
// std

export const Address = t.repr(
  t.string,
  (addr: Uint8Array) => bech32Encode("g", addr),
  (s) => {
    if (s === "") return new Uint8Array(20);
    const {
      hrp, bytes,
    } = bech32Decode(s);
    if (hrp !== "g" || bytes.length !== 20) throw new AminoError(`invalid address ${s}`);
    return bytes;
  },
  {
    name: "crypto.Address",
    goKind: "array",
    isZero: a => a.every(b => b === 0),
  },
);

export interface CoinValue {
  denom: string
  amount: bigint
}

const coinString = (c: CoinValue) => (c.amount === 0n ? "" : `${c.amount}${c.denom}`);

function parseCoin(s: string): CoinValue {
  const m = /^([0-9]+)([a-z/:._-][a-z0-9/:._-]*)$/.exec(s.trim());
  if (!m) throw new AminoError(`invalid coin expression: ${s}`);
  return {
    denom: m[2],
    amount: BigInt(m[1]),
  };
}

export const Coin = t.repr(t.string, coinString, s => (s === ""
  ? {
    denom: "",
    amount: 0n,
  }
  : parseCoin(s)), {
  name: "std.Coin",
  isZero: c => c.amount === 0n && c.denom === "",
});

export const Coins = t.repr(
  t.string,
  (cs: CoinValue[]) => cs.map(coinString).join(","),
  s => (s === "" ? [] : s.split(",").map(parseCoin)),
  {
    name: "std.Coins",
    goKind: "scalar",
    isZero: cs => cs.length === 0,
    zero: () => [],
  },
);

export const PubKeySecp256k1 = t.byteArray(33);

export const Fee = t.struct("std.Fee", {
  gasWanted: t.field(t.int64, {
    json: "gas_wanted",
  }),
  gasFee: t.field(Coin, {
    json: "gas_fee",
  }),
});

export const Signature = t.struct("std.Signature", {
  pubKey: t.field(t.interface("crypto.PubKey"), {
    json: "pub_key",
  }),
  signature: t.bytes,
  sessionAddr: t.field(Address, {
    json: "session_addr",
    omitEmpty: true,
  }),
});

const Msg = t.interface("std.Msg");

export const Tx = t.struct("std.Tx", {
  msgs: t.field(t.slice(Msg), {
    json: "msg",
  }),
  fee: Fee,
  signatures: t.slice(Signature),
  memo: t.string,
});

export const SignDoc = t.struct("std.SignDoc", {
  chainId: t.field(t.string, {
    json: "chain_id",
  }),
  accountNumber: t.field(t.uint64, {
    json: "account_number",
  }),
  sequence: t.uint64,
  fee: Fee,
  msgs: t.slice(Msg),
  memo: t.string,
});

/** The Ledger-compatible sign doc (std.signDocPayload). */
export const SignDocPayload = t.struct("std.signDocPayload", {
  chainId: t.field(t.string, {
    json: "chain_id",
  }),
  accountNumber: t.field(t.uint64, {
    json: "account_number",
  }),
  sequence: t.uint64,
  fee: t.struct("std.signDocFee", {
    amount: t.slice(t.struct("std.signDocCoin", {
      denom: t.string,
      amount: t.string,
    })),
    gas: t.string,
  }),
  msgs: t.slice(Msg),
  memo: t.string,
});

export const MemFile = t.struct("std.MemFile", {
  name: t.string,
  body: t.string,
});

export const MemPackage = t.struct("std.MemPackage", {
  name: t.string,
  path: t.string,
  files: t.slice(t.pointer(MemFile)),
  type: t.field(t.interface(), {
    omitEmpty: true,
  }),
  info: t.field(t.interface(), {
    omitEmpty: true,
  }),
});

// ----------------------------------------
// messages

export const MsgSend = t.struct("bank.MsgSend", {
  fromAddress: t.field(Address, {
    json: "from_address",
  }),
  toAddress: t.field(Address, {
    json: "to_address",
  }),
  amount: Coins,
});

export const MsgCall = t.struct("vm.MsgCall", {
  caller: Address,
  send: Coins,
  maxDeposit: t.field(Coins, {
    json: "max_deposit",
  }),
  pkgPath: t.field(t.string, {
    json: "pkg_path",
  }),
  func: t.string,
  args: t.field(t.slice(t.string), {
    omitEmpty: true,
  }),
});

export const MsgAddPackage = t.struct("vm.MsgAddPackage", {
  creator: Address,
  package: t.pointer(MemPackage),
  send: Coins,
  maxDeposit: t.field(Coins, {
    json: "max_deposit",
  }),
});

export const MsgRun = t.struct("vm.MsgRun", {
  caller: Address,
  send: Coins,
  maxDeposit: t.field(Coins, {
    json: "max_deposit",
  }),
  package: t.pointer(MemPackage),
});

export function gnoCodec(): Codec {
  return new Codec()
    .register("/tm.PubKeySecp256k1", PubKeySecp256k1)
    .registerPackage("std", {
      Tx,
      Fee,
      Signature,
      MemFile,
      MemPackage,
    })
    .register("/bank.MsgSend", MsgSend)
    .register("/vm.m_call", MsgCall)
    .register("/vm.m_run", MsgRun)
    .register("/vm.m_addpkg", MsgAddPackage);
}
