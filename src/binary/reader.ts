/**
 * Primitive decoders. Each takes the remaining input and returns the decoded
 * value with the number of bytes consumed, like the Go `amino.Decode*`
 * functions, and fails in the same situations they do.
 */

import {
  AminoError,
} from "../errors";
import type {
  Typ3,
} from "./writer";

export type Decoded<T> = [value: T, n: number];

/** Go `binary.Uvarint` semantics, as a bigint. */
export function decodeUvarint64(bz: Uint8Array): Decoded<bigint> {
  let lo = 0; // first 49 bits, accumulated as a number
  let x = 0n;
  let s = 0;
  for (let i = 0; i < bz.length; i++) {
    if (i === 10) {
      throw new AminoError("EOF decoding uvarint"); // overflow
    }
    const b = bz[i];
    if (b < 0x80) {
      if (i === 9 && b > 1) {
        throw new AminoError("EOF decoding uvarint"); // overflow
      }
      if (i < 7) return [BigInt(lo + b * 2 ** s), i + 1];
      return [x | (BigInt(b) << BigInt(s)), i + 1];
    }
    if (i < 7) {
      lo += (b & 0x7f) * 2 ** s;
      if (i === 6) x = BigInt(lo);
    }
    else {
      x |= BigInt(b & 0x7f) << BigInt(s);
    }
    s += 7;
  }
  throw new AminoError("buffer too small");
}

/** Unsigned varint that must fit in a JS safe integer (lengths, keys, small ints). */
export function decodeUvarint(bz: Uint8Array): Decoded<number> {
  // Fast path for the common 1-4 byte case.
  let v = 0;
  for (let i = 0; i < 4 && i < bz.length; i++) {
    const b = bz[i];
    v += (b & 0x7f) * 2 ** (7 * i);
    if (b < 0x80) return [v, i + 1];
  }
  const [u, n] = decodeUvarint64(bz);
  return [u > BigInt(Number.MAX_SAFE_INTEGER) ? Infinity : Number(u), n];
}

/** Zigzag varint (Go `binary.Varint`). */
export function decodeVarint64(bz: Uint8Array): Decoded<bigint> {
  const [u, n] = decodeUvarint64(bz);
  return [(u >> 1n) ^ -(u & 1n), n];
}

/** Plain (two's complement) varint, as protobuf `int64`. */
export function decodePlainVarint64(bz: Uint8Array): Decoded<bigint> {
  const [u, n] = decodeUvarint64(bz);
  return [BigInt.asIntN(64, u), n];
}

function need(bz: Uint8Array, size: number, what: string) {
  if (bz.length < size) throw new AminoError(`EOF decoding ${what}`);
}

export function decodeFixed32(bz: Uint8Array): Decoded<number> {
  need(bz, 4, "uint32");
  return [(bz[0] | (bz[1] << 8) | (bz[2] << 16) | (bz[3] << 24)) >>> 0, 4];
}

export function decodeFixed64(bz: Uint8Array): Decoded<bigint> {
  need(bz, 8, "uint64");
  const lo = decodeFixed32(bz)[0];
  const hi = decodeFixed32(bz.subarray(4))[0];
  return [(BigInt(hi) << 32n) | BigInt(lo), 8];
}

export function decodeFloat32(bz: Uint8Array): Decoded<number> {
  need(bz, 4, "float32");
  return [new DataView(bz.buffer, bz.byteOffset, 4).getFloat32(0, true), 4];
}

export function decodeFloat64(bz: Uint8Array): Decoded<number> {
  need(bz, 8, "float64");
  return [new DataView(bz.buffer, bz.byteOffset, 8).getFloat64(0, true), 8];
}

export function decodeByte(bz: Uint8Array): Decoded<number> {
  need(bz, 1, "byte");
  return [bz[0], 1];
}

export function decodeBool(bz: Uint8Array): Decoded<boolean> {
  need(bz, 1, "bool");
  if (bz[0] > 1) throw new AminoError("invalid bool");
  return [bz[0] === 1, 1];
}

/** Length-prefixed bytes; the result is a copy. */
export function decodeByteSlice(bz: Uint8Array): Decoded<Uint8Array> {
  const [view, n] = decodeByteSliceView(bz);
  return [view.slice(), n];
}

/** Length-prefixed bytes, without copying. */
export function decodeByteSliceView(bz: Uint8Array): Decoded<Uint8Array> {
  const [count, n] = decodeUvarint(bz);
  if (count > bz.length - n) {
    throw new AminoError(`insufficient bytes decoding []byte of length ${count}: have ${bz.length - n}`);
  }
  return [bz.subarray(n, n + count), n + count];
}

/** Field key. Field number 0 is reserved and rejected, as in Go. */
export function decodeFieldKey(bz: Uint8Array): [num: number, typ: Typ3, n: number] {
  const [v, n] = decodeUvarint(bz); // Infinity when beyond 2^53, rejected below
  const typ = (v % 8) as Typ3;
  const num = Math.floor(v / 8);
  if (num === 0) throw new AminoError("invalid field num 0 (reserved)");
  if (num > 2 ** 29 - 1) throw new AminoError(`invalid field num ${num}`);
  return [num, typ, n];
}
