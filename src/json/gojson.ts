/**
 * The pieces of Go's `encoding/json` that amino JSON relies on: a strict
 * parser (RFC 8259, as Go accepts it) that keeps number literals verbatim
 * and reports duplicate keys, Go's string escaping, and Go's float format.
 */

import {
  AminoError,
} from "../errors";

interface JsonNull {
  t: "null"
}
interface JsonBool {
  t: "bool"
  v: boolean
}
interface JsonNum {
  t: "num"
  raw: string
}
interface JsonStr {
  t: "str"
  v: string
  raw: string
}
interface JsonArr {
  t: "arr"
  items: JsonNode[]
}
interface JsonObj {
  t: "obj"
  entries: [key: string, value: JsonNode][]
}

export type JsonNode = JsonNull | JsonBool | JsonNum | JsonStr | JsonArr | JsonObj;

const UNESCAPE: Record<string, string> = {
  "\"": "\"",
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

// Go's short escapes for control characters; the others use \u00XX.
const SHORT_ESCAPES: Record<number, string> = {
  0x08: "\\b",
  0x0c: "\\f",
  0x0a: "\\n",
  0x0d: "\\r",
  0x09: "\\t",
};

const NUMBER = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;

const MAX_DEPTH = 10000; // Go's encoding/json nesting limit.

/**
 * Parses one JSON value; surrounding whitespace is allowed. Trailing data is
 * an error unless `allowTrailing` is set, in which case parsing stops after
 * the first value, like Go's streaming `json.Decoder`.
 */
export function parseJson(src: string, allowTrailing = false): JsonNode {
  let i = 0;
  const fail = (msg: string): never => {
    throw new AminoError(`invalid JSON at offset ${i}: ${msg}`);
  };
  const ws = () => {
    for (;;) {
      const c = src.charCodeAt(i);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) i++;
      else return;
    }
  };
  const lit = (word: string) => {
    if (src.startsWith(word, i)) {
      i += word.length;
      return;
    }
    fail(`invalid character ${JSON.stringify(src[i] ?? "EOF")}`);
  };
  const str = (): {
    v: string
    raw: string
  } => {
    const start = i;
    i++; // opening quote
    let out = "";
    let run = i;
    for (;;) {
      if (i >= src.length) fail("unexpected end of string");
      const c = src.charCodeAt(i);
      if (c === 0x22) {
        out += src.slice(run, i);
        i++;
        return {
          v: out,
          raw: src.slice(start, i),
        };
      }
      if (c < 0x20) fail("invalid control character in string");
      if (c === 0x5c) {
        out += src.slice(run, i);
        const e = src[i + 1];
        i += 2;
        if (e !== undefined && Object.prototype.hasOwnProperty.call(UNESCAPE, e)) {
          out += UNESCAPE[e];
          run = i;
          continue;
        }
        switch (e) {
          case "u": {
            const hex4 = (at: number) => {
              const h = src.slice(at, at + 4);
              return /^[0-9a-fA-F]{4}$/.test(h) ? parseInt(h, 16) : -1;
            };
            const c1 = hex4(i);
            if (c1 < 0) fail("invalid \\u escape");
            i += 4;
            if (c1 >= 0xd800 && c1 <= 0xdbff && src.startsWith("\\u", i)) {
              const c2 = hex4(i + 2);
              if (c2 >= 0xdc00 && c2 <= 0xdfff) {
                out += String.fromCharCode(c1, c2);
                i += 6;
                break;
              }
            }
            // Like Go, an unpaired surrogate becomes U+FFFD.
            out += c1 >= 0xd800 && c1 <= 0xdfff ? "\ufffd" : String.fromCharCode(c1);
            break;
          }
          default:
            fail("invalid escape");
        }
        run = i;
        continue;
      }
      i++;
    }
  };
  const num = (): string => {
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(src);
    if (!m) fail(`invalid character ${JSON.stringify(src[i] ?? "EOF")}`);
    i += m![0].length;
    return m![0];
  };
  const value = (depth: number): JsonNode => {
    if (depth > MAX_DEPTH) fail("exceeded max depth");
    ws();
    const c = src[i];
    switch (c) {
      case "{": {
        i++;
        const entries: [string, JsonNode][] = [];
        ws();
        if (src[i] === "}") {
          i++;
          return {
            t: "obj",
            entries,
          };
        }
        for (;;) {
          ws();
          if (src[i] !== "\"") fail("expected string key");
          const k = str().v;
          ws();
          if (src[i] !== ":") fail("expected ':'");
          i++;
          entries.push([k, value(depth + 1)]);
          ws();
          if (src[i] === ",") {
            i++;
            continue;
          }
          if (src[i] === "}") {
            i++;
            return {
              t: "obj",
              entries,
            };
          }
          fail("expected ',' or '}'");
        }
      }
      // falls through (unreachable)
      case "[": {
        i++;
        const items: JsonNode[] = [];
        ws();
        if (src[i] === "]") {
          i++;
          return {
            t: "arr",
            items,
          };
        }
        for (;;) {
          items.push(value(depth + 1));
          ws();
          if (src[i] === ",") {
            i++;
            continue;
          }
          if (src[i] === "]") {
            i++;
            return {
              t: "arr",
              items,
            };
          }
          fail("expected ',' or ']'");
        }
      }
      // falls through (unreachable)
      case "\"":
        return {
          t: "str",
          ...str(),
        };
      case "t":
        lit("true");
        return {
          t: "bool",
          v: true,
        };
      case "f":
        lit("false");
        return {
          t: "bool",
          v: false,
        };
      case "n":
        lit("null");
        return {
          t: "null",
        };
      default:
        return {
          t: "num",
          raw: num(),
        };
    }
  };
  const v = value(0);
  if (allowTrailing) return v;
  ws();
  if (i < src.length) fail("invalid character after top-level value");
  return v;
}

/** Object entries as a map, rejecting duplicate keys (amino's `unmarshalJSONObjectNoDuplicates`). */
export function objectMap(node: JsonNode & {
  t: "obj"
}): Map<string, JsonNode> {
  const m = new Map<string, JsonNode>();
  for (const [k, v] of node.entries) {
    if (m.has(k)) throw new AminoError(`duplicate JSON key ${JSON.stringify(k)}`);
    m.set(k, v);
  }
  return m;
}

const HEX = "0123456789abcdef";

/**
 * Go `encoding/json` string encoding: HTML-safe (`<`, `>`, `&` escaped),
 * U+2028/U+2029 escaped, and ill-formed UTF-16 replaced with U+FFFD.
 */
export function quote(s: string): string {
  let out = "\"";
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let esc: string | undefined;
    if (c < 0x20) {
      esc = SHORT_ESCAPES[c] ?? `\\u00${HEX[c >> 4]}${HEX[c & 15]}`;
    }
    else if (c === 0x22) esc = "\\\"";
    else if (c === 0x5c) esc = "\\\\";
    else if (c === 0x3c) esc = "\\u003c";
    else if (c === 0x3e) esc = "\\u003e";
    else if (c === 0x26) esc = "\\u0026";
    else if (c === 0x2028) esc = "\\u2028";
    else if (c === 0x2029) esc = "\\u2029";
    else if (c >= 0xd800 && c <= 0xdfff) {
      const d = s.charCodeAt(i + 1);
      if (c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) {
        i++;
        continue;
      }
      esc = "\\ufffd";
    }
    if (esc !== undefined) {
      out += s.slice(run, i) + esc;
      run = i + 1;
    }
  }
  return out + s.slice(run) + "\"";
}

/** Go `encoding/json` float formatting (ES number syntax, `-0` kept). */
export function formatFloat(f: number, bits: 32 | 64): string {
  if (!Number.isFinite(f)) throw new AminoError(`json: unsupported value: ${f}`);
  if (Object.is(f, -0)) return "-0";
  if (bits === 64) return String(f);
  // Shortest decimal that round-trips through float32.
  f = Math.fround(f);
  for (let p = 1; p <= 9; p++) {
    const d = Number(f.toPrecision(p));
    if (Math.fround(d) === f) return String(d);
  }
  return String(f);
}

/** Converts parsed JSON back to text as Go's `json.Marshal(any)` would: keys sorted, floats reformatted. */
export function stringifySorted(node: JsonNode): string {
  switch (node.t) {
    case "null":
      return "null";
    case "bool":
      return node.v ? "true" : "false";
    case "num": {
      const f = Number(node.raw);
      if (!Number.isFinite(f)) throw new AminoError(`json: cannot unmarshal number ${node.raw} into float64`);
      return formatFloat(f, 64);
    }
    case "str":
      return quote(node.v);
    case "arr":
      return `[${node.items.map(stringifySorted).join(",")}]`;
    case "obj": {
      // Go's map keeps the last duplicate; sort by UTF-8 byte order.
      const m = new Map<string, JsonNode>();
      for (const [k, v] of node.entries) m.set(k, v);
      const keys = [...m.keys()].sort(compareUtf8);
      return `{${keys.map(k => `${quote(k)}:${stringifySorted(m.get(k)!)}`).join(",")}}`;
    }
  }
}

/** Orders strings by their UTF-8 bytes (Go's string order), not UTF-16 units. */
export function compareUtf8(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    // Surrogates (astral code points) sort after U+E000..U+FFFF in UTF-8.
    const sx = x >= 0xd800 && x <= 0xdfff ? x + 0x2000 : x >= 0xe000 ? x - 0x800 : x;
    const sy = y >= 0xd800 && y <= 0xdfff ? y + 0x2000 : y >= 0xe000 ? y - 0x800 : y;
    return sx - sy;
  }
  return a.length - b.length;
}

/**
 * Canonicalizes JSON like tm2's `std.MustSortJSON`: object keys sorted,
 * whitespace removed, strings and numbers re-encoded the way Go's
 * `json.Marshal(any)` does. Use it on amino JSON to build sign bytes.
 */
export function sortJSON(json: string): string {
  return stringifySorted(parseJson(json));
}
