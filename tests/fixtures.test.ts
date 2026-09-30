/**
 * Differential tests against go-amino: testdata/fixtures.json is produced by
 * gen/ (run `pnpm fixtures`), which encodes and decodes every value with the
 * Go implementation. Each Go code path must behave identically here.
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
  fromHex,
  toHex,
} from "../src";
import {
  newCodec,
  schemas,
} from "./schemas";

interface Case {
  type: keyof typeof schemas
  bin?: string
  binErr?: string
  json?: string
  jsonErr?: string
  binToBin?: string
  binToJson?: string
  binDecErr?: string
  jsonToBin?: string
  jsonToJson?: string
  jsonDecErr?: string
}

interface Decode {
  type: keyof typeof schemas
  bin?: string
  json?: string
  err?: string
  toBin?: string
  toJson?: string
}

const fixtures = JSON.parse(readFileSync(new URL("../testdata/fixtures.json", import.meta.url), "utf8")) as {
  cases: Case[]
  decodes: Decode[]
};

// strictUtf8: Go strings may hold invalid UTF-8, which a JS string cannot
// represent; such inputs are rejected instead of silently altered.
const cdc = newCodec({
  strictUtf8: true,
});

/** Inputs whose Go value holds invalid UTF-8 cannot round-trip through JS strings. */
const isLossy = (r: {
  ok: boolean
  err?: string
}) => !r.ok && /invalid UTF-8/.test(r.err ?? "");

function attempt<T>(f: () => T): {
  ok: true
  v: T
} | {
  ok: false
  err: string
} {
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

/** Checks re-encoding a decoded value against what Go produced (undefined = Go failed). */
function checkReencode(type: AminoType, value: unknown, wantBin: string | undefined, wantJson: string | undefined) {
  const bin = attempt(() => toHex(cdc.marshal(type, value as never)));
  if (wantBin === undefined) {
    expect(bin.ok, "Go failed to re-encode binary; TS should too").toBe(false);
  }
  else {
    expect(bin).toEqual({
      ok: true,
      v: wantBin,
    });
  }
  const json = attempt(() => cdc.marshalJSON(type, value as never));
  if (wantJson === undefined) {
    expect(json.ok, "Go failed to re-encode JSON; TS should too").toBe(false);
  }
  else {
    expect(json).toEqual({
      ok: true,
      v: wantJson,
    });
  }
}

function label(i: number, c: {
  type: string
  bin?: string
  json?: string
}) {
  const input = c.bin !== undefined ? `bin ${c.bin}` : `json ${c.json}`;
  return `#${i} ${c.type}: ${input.length > 80 ? input.slice(0, 80) + "…" : input}`;
}

describe("go-amino fixtures: encode/decode paths", () => {
  fixtures.cases.forEach((c, i) => {
    const type = schemas[c.type];
    it(label(i, c), () => {
      if (c.bin !== undefined) {
        const dec = attempt(() => cdc.unmarshal(type, fromHex(c.bin!)));
        if (isLossy(dec)) {
          // skip: not representable
        }
        else if (c.binDecErr !== undefined) {
          expect(dec.ok, `Go failed decoding binary (${c.binDecErr})`).toBe(false);
        }
        else {
          expect(dec.ok ? "" : dec.err).toBe("");
          if (dec.ok) checkReencode(type, dec.v, c.binToBin, c.binToJson);
        }
      }
      if (c.json !== undefined) {
        const dec = attempt(() => cdc.unmarshalJSON(type, c.json!));
        if (c.jsonDecErr !== undefined) {
          expect(dec.ok, `Go failed decoding JSON (${c.jsonDecErr})`).toBe(false);
        }
        else {
          expect(dec.ok ? "" : dec.err).toBe("");
          if (dec.ok) checkReencode(type, dec.v, c.jsonToBin, c.jsonToJson);
        }
      }
    });
  });
});

describe("go-amino fixtures: decoding arbitrary input", () => {
  fixtures.decodes.forEach((d, i) => {
    const type = schemas[d.type];
    it(label(i, d), () => {
      const dec = d.bin !== undefined
        ? attempt(() => cdc.unmarshal(type, fromHex(d.bin!)))
        : attempt(() => cdc.unmarshalJSON(type, d.json!));
      if (d.err !== undefined) {
        expect(dec.ok, `Go rejected this input (${d.err})`).toBe(false);
        return;
      }
      if (isLossy(dec)) return;
      expect(dec.ok ? "" : dec.err).toBe("");
      if (dec.ok) checkReencode(type, dec.v, d.toBin, d.toJson);
    });
  });
});
