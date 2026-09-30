import {
  AminoError,
} from "./errors";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

/** Standard, padded base64 (Go `encoding/json` for `[]byte`). */
export function toBase64(bz: Uint8Array): string {
  let s = "";
  let i = 0;
  for (; i + 2 < bz.length; i += 3) {
    const n = (bz[i] << 16) | (bz[i + 1] << 8) | bz[i + 2];
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bz.length - i;
  if (rem === 1) {
    const n = bz[i] << 16;
    s += B64[n >> 18] + B64[(n >> 12) & 63] + "==";
  }
  else if (rem === 2) {
    const n = (bz[i] << 16) | (bz[i + 1] << 8);
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
  }
  return s;
}

/**
 * Decodes standard, padded base64 the way Go's `base64.StdEncoding` does:
 * padding is required, non-zero trailing bits are ignored, and `\r`/`\n`
 * are skipped.
 */
export function fromBase64(s: string): Uint8Array {
  s = s.replace(/[\r\n]/g, "");
  if (s.length % 4 !== 0) throw new AminoError("illegal base64 data: bad length");
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const last = i + 4 === s.length;
    const q = [0, 0, 0, 0];
    for (let j = 0; j < 4; j++) {
      const ch = s.charCodeAt(i + j);
      if (ch === 61 /* = */ && last && j >= 4 - pad) {
        q[j] = 0;
        continue;
      }
      const v = ch < 128 ? B64_INDEX[ch] : -1;
      if (v < 0) throw new AminoError(`illegal base64 data at input byte ${i + j}`);
      q[j] = v;
    }
    const n = (q[0] << 18) | (q[1] << 12) | (q[2] << 6) | q[3];
    out[o++] = n >> 16;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

export function toHex(bz: Uint8Array): string {
  let s = "";
  for (const b of bz) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(s: string): Uint8Array {
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) throw new AminoError("invalid hex string");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/** Checks a byte-typed value; `null`/`undefined` become empty bytes. */
export function asBytes(value: unknown, what: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value == null) return new Uint8Array(0);
  throw new AminoError(`expected Uint8Array for ${what}`);
}
