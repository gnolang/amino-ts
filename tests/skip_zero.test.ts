/** The `skipZero` field option, go-amino's `amino:"skip_zero"` (gnolang/gno#6399). */
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  fromHex,
  t,
  toHex,
} from "../src";
import {
  newCodec,
  SkipZero,
} from "./schemas";

describe("skipZero", () => {
  it("is refused where a missing field would not decode to the zero value", () => {
    expect(() => t.struct("A", {
      a: t.field(t.string, {
        skipZero: true,
        writeEmpty: true,
      }),
    })).toThrow(/mutually exclusive/);
    expect(() => t.struct("B", {
      when: t.field(t.time, {
        skipZero: true,
      }),
    })).toThrow(/time field/);
    expect(() => t.struct("C", {
      p: t.field(t.pointer(t.int64), {
        skipZero: true,
      }),
    })).toThrow(/pointer to int64/);
    const noZero = t.repr(t.string, (s: string) => s, s => s, {
      name: "NoZero",
      goKind: "scalar",
    });
    expect(() => t.struct("D", {
      r: t.field(noZero, {
        skipZero: true,
      }),
    })).toThrow(/requires its isZero/);
  });

  it("leaves a zero value out of binary and JSON, and reads it back", () => {
    const cdc = newCodec();
    const zero = {
      Addr: new Uint8Array(4),
      Arr: [0n, 0n],
      Small: {
        A: 0,
        B: "",
        C: null,
      },
      Name: "",
      PlainAddr: new Uint8Array(4),
      PlainArr: [0n, 0n],
    };
    const bz = cdc.marshal(SkipZero, zero);
    // Only the untagged controls are written: field 5, the zero FullAddr as
    // its 8-character repr, and field 6, two zero varints.
    expect(toHex(bz)).toBe("2a08" + "3030303030303030" + "32020000");
    expect(cdc.unmarshal(SkipZero, bz)).toEqual(zero);

    const js = cdc.marshalJSON(SkipZero, zero);
    expect(Object.keys(JSON.parse(js))).toEqual(["PlainAddr", "PlainArr"]);
    expect(cdc.unmarshalJSON(SkipZero, js)).toEqual(zero);
  });

  it("still reads a zero value that an encoder without the tag wrote out", () => {
    const cdc = newCodec();
    const written = fromHex("0a08" + "3030303030303030" + "2a08" + "3030303030303030" + "32020000");
    const got = cdc.unmarshal(SkipZero, written);
    expect(got.Addr).toEqual(new Uint8Array(4));
    expect(toHex(cdc.marshal(SkipZero, got))).toBe("2a08" + "3030303030303030" + "32020000");
  });
});
