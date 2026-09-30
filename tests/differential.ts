/**
 * Differential testing against go-amino. Fixture files are produced by gen/
 * (`pnpm fixtures`), which encodes and decodes every value with the Go
 * implementation and records each outcome; every Go code path must behave
 * identically here.
 */

import {
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  type AminoType,
  type Codec,
  fromHex,
  toHex,
} from "../src";

/** One value, through every encode/decode path. Absent outputs mean Go failed. */
interface Case {
  type: string
  bin?: string
  binDecErr?: string
  binToBin?: string
  binToJson?: string
  json?: string
  jsonDecErr?: string
  jsonToBin?: string
  jsonToJson?: string
}

/** Arbitrary (often corrupted) input and what Go made of it. */
interface Decode {
  type: string
  bin?: string
  json?: string
  err?: string
  toBin?: string
  toJson?: string
}

type Result<T> = {
  ok: true
  v: T
} | {
  ok: false
  err: string
};

function attempt<T>(f: () => T): Result<T> {
  try {
    return {
      ok: true,
      v: f(),
    };
  }
  catch (e) {
    return {
      ok: false,
      err: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Go strings may hold invalid UTF-8, which a JS string cannot represent. The
 * codec must run with `strictUtf8`, so such inputs fail with this message and
 * are skipped rather than compared.
 */
const isLossy = (r: Result<unknown>) => !r.ok && /invalid UTF-8/.test(r.err);

function label(i: number, c: {
  type: string
  bin?: string
  json?: string
}) {
  const input = c.bin !== undefined ? `bin ${c.bin}` : `json ${c.json}`;
  return `#${i} ${c.type}: ${input.length > 80 ? input.slice(0, 80) + "…" : input}`;
}

/** Decodes `input`, then checks the outcome and both re-encodings against Go's. */
function check(cdc: Codec, type: AminoType, format: "bin" | "json", input: string,
  goErr: string | undefined, wantBin: string | undefined, wantJson: string | undefined) {
  const dec = format === "bin"
    ? attempt(() => cdc.unmarshal(type, fromHex(input)))
    : attempt(() => cdc.unmarshalJSON(type, input));
  if (isLossy(dec)) return;
  if (goErr !== undefined) {
    expect(dec.ok, `Go rejected this input (${goErr})`).toBe(false);
    return;
  }
  expect(dec.ok ? "" : dec.err).toBe("");
  if (!dec.ok) return;
  const reencodings: [string, string | undefined, () => string][] = [["binary", wantBin, () => toHex(cdc.marshal(type, dec.v as never))], ["JSON", wantJson, () => cdc.marshalJSON(type, dec.v as never)]];
  for (const [what, want, encode] of reencodings) {
    const got = attempt(encode);
    if (want === undefined) {
      expect(got.ok, `Go failed to re-encode ${what}; TS should too`).toBe(false);
    }
    else {
      expect(got).toEqual({
        ok: true,
        v: want,
      });
    }
  }
}

/** Registers a test per fixture in `file` (relative to testdata/). */
export function runFixtures(file: string, cdc: Codec, typeOf: (name: string) => AminoType) {
  const fixtures = JSON.parse(readFileSync(new URL(`../testdata/${file}`, import.meta.url), "utf8")) as {
    cases: Case[]
    decodes: Decode[]
  };

  describe(`${file}: encode/decode paths`, () => {
    fixtures.cases.forEach((c, i) => {
      it(label(i, c), () => {
        const type = typeOf(c.type);
        if (c.bin !== undefined) check(cdc, type, "bin", c.bin, c.binDecErr, c.binToBin, c.binToJson);
        if (c.json !== undefined) check(cdc, type, "json", c.json, c.jsonDecErr, c.jsonToBin, c.jsonToJson);
      });
    });
  });

  describe(`${file}: decoding arbitrary input`, () => {
    fixtures.decodes.forEach((d, i) => {
      it(label(i, d), () => {
        const type = typeOf(d.type);
        if (d.bin !== undefined) check(cdc, type, "bin", d.bin, d.err, d.toBin, d.toJson);
        else check(cdc, type, "json", d.json!, d.err, d.toBin, d.toJson);
      });
    });
  });
}
