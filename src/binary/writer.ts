import {
  AminoError,
} from "../errors";

/** Wire type of a field (protobuf "wire type", Amino "typ3"). */
export const Typ3 = {
  Varint: 0,
  Byte8: 1,
  ByteLength: 2,
  Byte4: 5,
} as const;
export type Typ3 = typeof Typ3[keyof typeof Typ3];

export const typ3Name = (typ: number): string => ({
  0: "Varint",
  1: "8Byte",
  2: "ByteLength",
  5: "4Byte",
} as Record<number, string>)[typ] ?? `<invalid typ3 ${typ}>`;

const U64_MASK = (1n << 64n) - 1n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Growable byte buffer with the Amino/protobuf primitive encoders. */
export class Writer {
  private buf: Uint8Array;
  private pos = 0;

  constructor(capacity = 64) {
    this.buf = new Uint8Array(capacity);
  }

  get length(): number {
    return this.pos;
  }

  /** The written bytes (a view; copy before reusing the writer). */
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.pos);
  }

  /** Drops everything written after `length`. */
  truncate(length: number) {
    this.pos = length;
  }

  lastByte(): number {
    return this.buf[this.pos - 1];
  }

  private grow(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  byte(b: number) {
    this.grow(1);
    this.buf[this.pos++] = b;
  }

  raw(bz: Uint8Array) {
    this.grow(bz.length);
    this.buf.set(bz, this.pos);
    this.pos += bz.length;
  }

  /** Unsigned varint of a non-negative safe integer. */
  uvarint(n: number) {
    this.grow(10);
    while (n >= 0x80) {
      this.buf[this.pos++] = (n % 0x80) | 0x80;
      n = Math.floor(n / 0x80);
    }
    this.buf[this.pos++] = n;
  }

  /** Unsigned varint of a value taken modulo 2^64. */
  uvarint64(v: bigint) {
    v &= U64_MASK;
    if (v <= MAX_SAFE) {
      this.uvarint(Number(v));
      return;
    }
    this.grow(10);
    while (v >= 0x80n) {
      this.buf[this.pos++] = Number(v & 0x7fn) | 0x80;
      v >>= 7n;
    }
    this.buf[this.pos++] = Number(v);
  }

  /** Zigzag varint (Go `binary.PutVarint`, protobuf `sint64`). */
  varint64(v: bigint) {
    this.uvarint64((v << 1n) ^ (v >> 63n));
  }

  /** Zigzag varint of a safe integer. */
  varint(n: number) {
    if (n >= 0) {
      if (n <= Number.MAX_SAFE_INTEGER / 2) {
        this.uvarint(n * 2);
        return;
      }
    }
    else if (n >= -Number.MAX_SAFE_INTEGER / 2) {
      this.uvarint(-n * 2 - 1);
      return;
    }
    this.varint64(BigInt(n));
  }

  fixed32(n: number) {
    this.grow(4);
    const u = n >>> 0;
    this.buf[this.pos++] = u & 0xff;
    this.buf[this.pos++] = (u >>> 8) & 0xff;
    this.buf[this.pos++] = (u >>> 16) & 0xff;
    this.buf[this.pos++] = (u >>> 24) & 0xff;
  }

  fixed64(v: bigint) {
    v &= U64_MASK;
    this.fixed32(Number(v & 0xffffffffn));
    this.fixed32(Number(v >> 32n));
  }

  float32(f: number) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, f, true);
    this.raw(new Uint8Array(dv.buffer));
  }

  float64(f: number) {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, f, true);
    this.raw(new Uint8Array(dv.buffer));
  }

  /** Length-prefixed bytes. */
  byteSlice(bz: Uint8Array) {
    this.uvarint(bz.length);
    this.raw(bz);
  }

  /** Field key: `fieldNum << 3 | typ3`. */
  fieldKey(num: number, typ: Typ3) {
    if (num < 0 || num > 2 ** 29 - 1) throw new AminoError(`invalid field number ${num}`);
    this.uvarint(num * 8 + typ);
  }
}
