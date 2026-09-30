/**
 * Bech32, as tm2 uses it (github.com/btcsuite/btcd/btcutil/bech32 via
 * tm2/pkg/bech32): no length limit, all-upper or all-lower case, and either
 * a bech32 or a bech32m checksum accepted when decoding.
 */

import {
  AminoError,
} from "../errors";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function polymod(hrp: string, data: ArrayLike<number>): number {
  let chk = 1;
  const step = (v: number) => {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i];
  };
  for (let i = 0; i < hrp.length; i++) step(hrp.charCodeAt(i) >> 5);
  step(0);
  for (let i = 0; i < hrp.length; i++) step(hrp.charCodeAt(i) & 31);
  for (let i = 0; i < data.length; i++) step(data[i]);
  return chk >>> 0;
}

/** Go `bech32.ConvertBits`. */
function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    acc = ((acc << from) | data[i]) & 0xffff;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (pad && bits > 0) {
    out.push((acc << (to - bits)) & max);
  }
  else if (bits > 0 && (bits > 4 || ((acc << (to - bits)) & max) !== 0)) {
    throw new AminoError("decoding bech32 failed: invalid incomplete group");
  }
  return out;
}

/** Encodes bytes with a human-readable prefix (Go `bech32.Encode`). */
export function bech32Encode(hrp: string, bytes: Uint8Array): string {
  hrp = hrp.toLowerCase();
  const data = convertBits(bytes, 8, 5, true);
  const mod = polymod(hrp, [...data, 0, 0, 0, 0, 0, 0]) ^ BECH32_CONST;
  let s = `${hrp}1`;
  for (const d of data) s += CHARSET[d];
  for (let i = 0; i < 6; i++) s += CHARSET[(mod >>> (5 * (5 - i))) & 31];
  return s;
}

/** Decodes to the prefix and bytes (Go `bech32.DecodeAndConvert`). */
export function bech32Decode(bech: string): {
  prefix: string
  bytes: Uint8Array
} {
  const fail = (why: string): never => {
    throw new AminoError(`decoding bech32 failed: ${why}`);
  };
  if (bech.length < 8) fail(`invalid bech32 string length ${bech.length}`);
  let lower = false;
  let upper = false;
  for (let i = 0; i < bech.length; i++) {
    const c = bech.charCodeAt(i);
    if (c < 33 || c > 126) fail(`invalid character in string: '${bech[i]}'`);
    lower ||= c >= 97 && c <= 122;
    upper ||= c >= 65 && c <= 90;
    if (lower && upper) fail("string not all lowercase or all uppercase");
  }
  bech = bech.toLowerCase();
  const one = bech.lastIndexOf("1");
  if (one < 1 || one + 7 > bech.length) fail(`invalid separator index ${one}`);
  const prefix = bech.slice(0, one);
  const data: number[] = [];
  for (const c of bech.slice(one + 1)) {
    const d = CHARSET.indexOf(c);
    if (d < 0) fail(`invalid character not part of charset: ${c.charCodeAt(0)}`);
    data.push(d);
  }
  const mod = polymod(prefix, data);
  if (mod !== BECH32_CONST && mod !== BECH32M_CONST) fail("invalid checksum");
  return {
    prefix,
    bytes: Uint8Array.from(convertBits(data.slice(0, -6), 5, 8, false)),
  };
}
