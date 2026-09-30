import {
  AminoError,
} from "./errors";

/**
 * UTF-8 helpers that do not depend on `TextEncoder`/`TextDecoder` being
 * present, so the library runs unchanged in every JS runtime.
 */

/** Encodes a string as UTF-8. Lone surrogates become U+FFFD, like `TextEncoder`. */
// Native codecs when the runtime has them (every browser and Node >= 11);
// the portable implementations below behave identically.
const g = globalThis as {
  TextEncoder?: new () => {
    encode(s: string): Uint8Array
  }
  TextDecoder?: new (label: string, opts: {
    fatal: boolean
  }) => {
    decode(bz: Uint8Array): string
  }
};
const nativeEncoder = g.TextEncoder ? new g.TextEncoder() : undefined;
const nativeDecoder = g.TextDecoder
  ? new g.TextDecoder("utf-8", {
    fatal: false,
  })
  : undefined;
const nativeStrictDecoder = g.TextDecoder
  ? new g.TextDecoder("utf-8", {
    fatal: true,
  })
  : undefined;

export function utf8Encode(s: string): Uint8Array {
  if (nativeEncoder) return nativeEncoder.encode(s);
  return utf8EncodePortable(s);
}

export function utf8EncodePortable(s: string): Uint8Array {
  // ASCII fast path.
  let ascii = true;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
      else {
        c = 0xfffd;
      }
    }
    else if (c >= 0xdc00 && c <= 0xdfff) {
      c = 0xfffd;
    }
    if (c < 0x80) {
      out.push(c);
    }
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    }
    else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

/**
 * Decodes UTF-8. Go strings may hold arbitrary bytes, but JS strings cannot;
 * with `fatal` set, invalid UTF-8 throws instead of becoming U+FFFD.
 * Invalid sequences are replaced one maximal subpart at a time, as the
 * WHATWG decoder and Go's `strings.ToValidUTF8`-style iteration do.
 */
export function utf8Decode(bz: Uint8Array, fatal = false): string {
  const native = fatal ? nativeStrictDecoder : nativeDecoder;
  if (native) {
    try {
      return native.decode(bz);
    }
    catch {
      throw new AminoError("invalid UTF-8");
    }
  }
  return utf8DecodePortable(bz, fatal);
}

export function utf8DecodePortable(bz: Uint8Array, fatal = false): string {
  let s = "";
  let chunk: number[] = [];
  const flush = () => {
    s += String.fromCharCode(...chunk);
    chunk = [];
  };
  const bad = () => {
    if (fatal) throw new AminoError("invalid UTF-8");
    chunk.push(0xfffd);
  };
  let i = 0;
  while (i < bz.length) {
    if (chunk.length > 4096) flush();
    const b0 = bz[i];
    if (b0 < 0x80) {
      chunk.push(b0);
      i++;
      continue;
    }
    let need: number;
    let cp: number;
    let lo = 0x80;
    let hi = 0xbf;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      need = 1;
      cp = b0 & 0x1f;
    }
    else if (b0 >= 0xe0 && b0 <= 0xef) {
      need = 2;
      cp = b0 & 0x0f;
      if (b0 === 0xe0) lo = 0xa0;
      if (b0 === 0xed) hi = 0x9f;
    }
    else if (b0 >= 0xf0 && b0 <= 0xf4) {
      need = 3;
      cp = b0 & 0x07;
      if (b0 === 0xf0) lo = 0x90;
      if (b0 === 0xf4) hi = 0x8f;
    }
    else {
      bad();
      i++;
      continue;
    }
    let j = 1;
    for (; j <= need; j++) {
      const b = i + j < bz.length ? bz[i + j] : -1;
      if (b < lo || b > hi) break;
      lo = 0x80;
      hi = 0xbf;
      cp = (cp << 6) | (b & 0x3f);
    }
    if (j <= need) {
      bad();
      i += j;
      continue;
    }
    i += need + 1;
    if (cp >= 0x10000) {
      cp -= 0x10000;
      chunk.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
    else {
      chunk.push(cp);
    }
  }
  flush();
  return s;
}
