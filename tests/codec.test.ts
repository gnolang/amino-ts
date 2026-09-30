import {
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

import {
  AminoError,
  type AminoType,
  type AnyValue,
  Codec,
  Duration,
  fromBase64,
  fromHex,
  type Infer,
  sortJSON,
  t,
  Timestamp,
  toBase64,
  toHex,
} from "../src";
import {
  utf8Decode,
  utf8DecodePortable,
  utf8EncodePortable,
} from "../src/utf8";

const cdc = new Codec();
const hex = (type: AminoType, v: unknown) => toHex(cdc.marshal(type, v as never));

describe("primitives", () => {
  it("encodes signed ints as zigzag varints inside an implicit struct", () => {
    expect(hex(t.int64, 0n)).toBe("");
    expect(hex(t.int64, 1n)).toBe("0802");
    expect(hex(t.int64, -1n)).toBe("0801");
    expect(hex(t.int64, -(2n ** 63n))).toBe("08ffffffffffffffffff01");
    expect(hex(t.int32, 2 ** 31 - 1)).toBe("08feffffff0f");
    expect(hex(t.int8, -128)).toBe("08ff01");
  });

  it("encodes unsigned ints as plain varints", () => {
    expect(hex(t.uint64, 2n ** 64n - 1n)).toBe("08ffffffffffffffffff01");
    expect(hex(t.uint8, 255)).toBe("08ff01");
    expect(hex(t.uint32, 300)).toBe("08ac02");
  });

  it("accepts numbers and decimal strings for 64-bit ints, and checks ranges", () => {
    expect(hex(t.int64, 5 as never)).toBe("080a");
    expect(hex(t.int64, "-3" as never)).toBe("0805");
    expect(() => hex(t.int64, 2 ** 53)).toThrow(AminoError);
    expect(() => hex(t.uint64, -1n)).toThrow(/out of range/);
    expect(() => hex(t.int8, 128)).toThrow(/out of range/);
    expect(() => hex(t.int32, 1.5)).toThrow(AminoError);
  });

  it("round-trips strings, bytes and bools", () => {
    const s = "héllo 🚀";
    expect(cdc.unmarshal(t.string, cdc.marshal(t.string, s))).toBe(s);
    expect(cdc.unmarshal(t.bytes, cdc.marshal(t.bytes, Uint8Array.of(1, 2)))).toEqual(Uint8Array.of(1, 2));
    expect(cdc.unmarshal(t.bytes, cdc.marshal(t.bytes, new Uint8Array()))).toBeNull();
    expect(hex(t.bool, true)).toBe("0801");
  });

  it("encodes 64-bit ints as JSON strings and smaller ones as numbers", () => {
    expect(cdc.marshalJSON(t.int64, -5n)).toBe("\"-5\"");
    expect(cdc.marshalJSON(t.uint32, 7)).toBe("7");
    expect(cdc.unmarshalJSON(t.uint64, "\"18446744073709551615\"")).toBe(2n ** 64n - 1n);
    expect(() => cdc.unmarshalJSON(t.int64, "5")).toThrow(/quoted/);
  });
});

describe("structs", () => {
  const Inner = t.struct("Inner", {
    n: t.int32,
  });
  const S = t.struct("S", {
    a: t.string,
    b: t.field(t.int64, {
      json: "b_renamed",
    }),
    inner: Inner,
    innerPt: t.pointer(Inner),
    list: t.slice(Inner),
    nums: t.slice(t.uint16),
  });

  it("infers value types", () => {
    type V = Infer<typeof S>;
    expectTypeOf<V>().toEqualTypeOf<{
      a: string
      b: bigint
      inner: {
        n: number
      }
      innerPt: {
        n: number
      } | null
      list: {
        n: number
      }[] | null
      nums: number[] | null
    }>();
  });

  const value: Infer<typeof S> = {
    a: "x",
    b: 2n,
    inner: {
      n: 0,
    },
    innerPt: {
      n: 0,
    },
    list: [
      {
        n: 1,
      },
      {
        n: 0,
      },
    ],
    nums: [1, 2, 300],
  };

  it("skips empty fields, but writes non-nil pointers and list elements", () => {
    // 1:a="x" | 2:b=2 | 3:inner empty, skipped | 4:innerPt empty but written |
    // 5:list, one entry each | 6:nums, packed
    expect(hex(S, value)).toBe("0a0178" + "1004" + "2200" + "2a020802" + "2a00" + "32040102ac02");
  });

  it("round-trips", () => {
    const back = cdc.unmarshal(S, cdc.marshal(S, value));
    expect(back).toEqual(value);
    expect(cdc.unmarshalJSON(S, cdc.marshalJSON(S, value))).toEqual(value);
  });

  it("writes JSON in field order with renamed keys", () => {
    expect(cdc.marshalJSON(S, value)).toBe(
      "{\"a\":\"x\",\"b_renamed\":\"2\",\"inner\":{\"n\":0},\"innerPt\":{\"n\":0},\"list\":[{\"n\":1},{\"n\":0}],\"nums\":[1,2,300]}",
    );
  });

  it("treats missing JS fields as zero values", () => {
    expect(hex(S, {
    })).toBe("");
    expect(cdc.marshalJSON(t.struct(undefined, {
      x: t.int64,
      y: t.slice(t.string),
    }), {
    } as never)).toBe("{\"x\":\"0\",\"y\":null}");
  });

  it("rejects unknown, duplicate and misplaced input", () => {
    expect(() => cdc.unmarshalJSON(S, "{\"zzz\":1}")).toThrow(/unknown JSON field/);
    expect(() => cdc.unmarshalJSON(S, "{\"a\":\"\",\"a\":\"\"}")).toThrow(/duplicate/);
    expect(() => cdc.unmarshal(S, fromHex("10040a0178"))).toThrow(/already seen/);
    expect(() => cdc.unmarshal(S, fromHex("0a0178ff"))).toThrow(AminoError);
  });

  it("rejects integer-like keys, which JS would reorder", () => {
    expect(() => t.struct("Bad", {
      a: t.int32,
      1: t.int32,
    })).toThrow(/integer-like/);
  });

  it("validates tags", () => {
    expect(() => t.struct("Bad", {
      f: t.field(t.string, {
        fixed64: true,
      }),
    })).toThrow(/fixed64/);
    expect(() => t.struct("Bad", {
      f: t.float64,
    })).toThrow(/unsafe/);
  });

  it("supports recursive schemas with t.lazy", () => {
    interface Node {
      v: number
      next: Node | null
    }
    const NodeT: AminoType = t.struct("Node", {
      v: t.int32,
      next: t.pointer(t.lazy(() => NodeT)),
    });
    const list: Node = {
      v: 1,
      next: {
        v: 2,
        next: null,
      },
    };
    const bz = cdc.marshal(NodeT, list as never);
    expect(cdc.unmarshal(NodeT, bz)).toEqual(list);
  });
});

describe("interfaces", () => {
  const Msg = t.interface("Msg");
  const Send = t.struct("Send", {
    to: t.string,
    amount: t.uint64,
  });
  const Holder = t.struct("Holder", {
    msg: Msg,
    msgs: t.slice(Msg),
  });
  const c = new Codec().register("/bank.Send", Send);
  const any: AnyValue = {
    typeUrl: "/bank.Send",
    value: {
      to: "bob",
      amount: 5n,
    },
  };

  it("encodes as google.protobuf.Any", () => {
    expect(toHex(c.marshalAny(any))).toBe("0a0a2f62616e6b2e53656e6412070a03626f621005");
    expect(c.unmarshalAny(c.marshalAny(any))).toEqual(any);
    expect(c.marshalJSONAny(any)).toBe("{\"@type\":\"/bank.Send\",\"to\":\"bob\",\"amount\":\"5\"}");
    expect(c.unmarshalJSONAny(c.marshalJSONAny(any))).toEqual(any);
  });

  it("uses {\"@type\",\"value\"} for non-struct concrete types", () => {
    expect(c.marshalJSONAny({
      typeUrl: "/google.protobuf.Int64Value",
      value: 3n,
    })).toBe("{\"@type\":\"/google.protobuf.Int64Value\",\"value\":\"3\"}");
  });

  it("round-trips inside structs", () => {
    const h = {
      msg: any,
      msgs: [any, null],
    };
    expect(c.unmarshal(Holder, c.marshal(Holder, h))).toEqual(h);
    expect(c.unmarshalJSON(Holder, c.marshalJSON(Holder, h))).toEqual(h);
  });

  it("requires registration", () => {
    expect(() => c.marshalAny({
      typeUrl: "/x.Unknown",
      value: {
      },
    })).toThrow(/unrecognized/);
    // Go matches on the full name after the last slash.
    expect(() => c.register("/example.com/bank.Send", Send)).toThrow(/already registered/);
    expect(() => c.register("NoSlash", Send)).toThrow(/slash/);
  });

  it("limits nesting depth", () => {
    const Box = t.struct("Box", {
      inner: t.interface(),
    });
    const bc = new Codec().register("/t.Box", Box);
    let v: AnyValue = {
      typeUrl: "/t.Box",
      value: {
        inner: null,
      },
    };
    for (let i = 0; i < 70; i++) v = {
      typeUrl: "/t.Box",
      value: {
        inner: v,
      },
    };
    expect(() => bc.unmarshalAny(bc.marshalAny(v))).toThrow(/nesting depth/);
  });
});

describe("repr types", () => {
  const Height = t.repr(t.string, (h: number) => `h${h}`, s => Number(s.slice(1)), {
    name: "Height",
  });
  it("encodes via the representation", () => {
    expect(cdc.marshalJSON(Height, 7)).toBe("\"h7\"");
    expect(cdc.unmarshal(Height, cdc.marshal(Height, 7))).toBe(7);
  });
});

describe("time and duration", () => {
  it("formats JSON with 0, 3, 6 or 9 fractional digits", () => {
    expect(Timestamp.format({
      seconds: 0n,
      nanos: 0,
    })).toBe("1970-01-01T00:00:00Z");
    expect(Timestamp.format({
      seconds: 1700000000n,
      nanos: 120000000,
    })).toBe("2023-11-14T22:13:20.120Z");
    expect(Timestamp.format({
      seconds: -1n,
      nanos: 1,
    })).toBe("1969-12-31T23:59:59.000000001Z");
    expect(Duration.format(-1500000000n)).toBe("-1.500s");
    expect(Duration.format(0n)).toBe("0s");
  });

  it("parses like Go", () => {
    expect(Timestamp.parse("2024-02-29T12:00:00.5+01:00")).toEqual({
      seconds: 1709204400n,
      nanos: 500000000,
    });
    expect(() => Timestamp.parse("2023-02-29T00:00:00Z")).toThrow();
    expect(Duration.parse("1h2m3.5s")).toBe(3723500000000n);
    expect(Duration.parse("-.5us")).toBe(-500n);
    expect(() => Duration.parse("1d")).toThrow(/unknown unit/);
    expect(() => Duration.parse("9223372036854775808ns")).toThrow();
  });

  it("converts Dates", () => {
    const d = new Date("2020-05-06T07:08:09.123Z");
    expect(Timestamp.toDate(Timestamp.fromDate(d))).toEqual(d);
    expect(cdc.marshalJSON(t.time, d as never)).toBe("\"2020-05-06T07:08:09.123Z\"");
  });

  it("rejects times out of range", () => {
    expect(() => cdc.marshal(t.time, {
      seconds: 253402300800n,
      nanos: 0,
    })).toThrow(/invalid time/);
  });
});

describe("sized encodings", () => {
  it("prefixes the length", () => {
    const bz = cdc.marshalSized(t.string, "hi");
    expect(toHex(bz)).toBe("040a026869");
    expect(cdc.unmarshalSized(t.string, bz)).toBe("hi");
    expect(() => cdc.unmarshalSized(t.string, fromHex("050a026869"))).toThrow(/Not enough/);
  });
});

describe("sortJSON", () => {
  it("sorts keys, strips whitespace and re-escapes like Go", () => {
    expect(sortJSON("{ \"b\": 1.50, \"a\": [ \"<\", {\"d\":1e21,\"c\":0.0000001} ] }"))
      .toBe("{\"a\":[\"\\u003c\",{\"c\":1e-7,\"d\":1e+21}],\"b\":1.5}");
  });
  it("orders keys by UTF-8 bytes", () => {
    expect(sortJSON("{\"\uffff\":1,\"\ud83d\ude80\":2,\"a\":3}")).toBe("{\"a\":3,\"\uffff\":1,\"\ud83d\ude80\":2}");
  });
});

describe("helpers", () => {
  it("base64", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 31]) {
      const bz = Uint8Array.from({
        length: n,
      }, (_, i) => (i * 37) & 0xff);
      expect(fromBase64(toBase64(bz))).toEqual(bz);
    }
    expect(() => fromBase64("AQ")).toThrow();
  });

  it("portable utf8 matches TextEncoder/TextDecoder", () => {
    const samples = ["", "abc", "é日🚀", "\ud800x", "x\udc00"];
    for (const s of samples) expect(utf8EncodePortable(s)).toEqual(new TextEncoder().encode(s));
    const bytes = [Uint8Array.of(0xff, 0x41), Uint8Array.of(0xe2, 0x82), Uint8Array.of(0xc0, 0xaf), Uint8Array.of(0xf0, 0x9f, 0x9a, 0x80)];
    for (const b of bytes) expect(utf8DecodePortable(b)).toBe(new TextDecoder().decode(b));
    expect(() => utf8Decode(Uint8Array.of(0xff), true)).toThrow(/UTF-8/);
    expect(() => utf8DecodePortable(Uint8Array.of(0xff), true)).toThrow(/UTF-8/);
  });
});
