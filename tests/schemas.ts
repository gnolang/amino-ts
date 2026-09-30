/**
 * TS mirror of gen/types.go. Field order, names and tags must match the Go
 * declarations exactly.
 */

import {
  AminoError,
  Codec,
  type CodecOptions,
  t,
} from "../src";

const f = t.field;

export const Empty = t.struct("Empty", {
});

export const Small = t.struct("Small", {
  A: t.int32,
  B: t.string,
  C: t.bytes,
});

export const Pos = t.struct("Pos", {
  Line: t.int,
  Col: t.int,
});

export const Primitives = t.struct("Primitives", {
  Int8: t.int8,
  Int16: t.int16,
  Int32: t.int32,
  Int32Fixed: f(t.int32, {
    fixed32: true,
  }),
  Int32Varint: f(t.int32, {
    varint: true,
  }),
  Int64: t.int64,
  Int64Fixed: f(t.int64, {
    fixed64: true,
  }),
  Int64Varint: f(t.int64, {
    varint: true,
  }),
  Int: t.int,
  IntFixed: f(t.int, {
    fixed64: true,
  }),
  IntVarint: f(t.int, {
    varint: true,
  }),
  Byte: t.byte,
  Uint8: t.uint8,
  Uint16: t.uint16,
  Uint32: t.uint32,
  Uint32Fixed: f(t.uint32, {
    fixed32: true,
  }),
  Uint64: t.uint64,
  Uint64Fixed: f(t.uint64, {
    fixed64: true,
  }),
  Uint: t.uint,
  UintFixed: f(t.uint, {
    fixed64: true,
  }),
  Bool: t.bool,
  Str: t.string,
  Bytes: t.bytes,
  Time: t.time,
  Duration: t.duration,
  Empty,
});

const fixed32 = {
  fixed32: true,
};
const fixed64 = {
  fixed64: true,
};

export const Arrays = t.struct("Arrays", {
  Int8Ar: t.array(t.int8, 4),
  Int32Ar: t.array(t.int32, 4),
  Int32FixedAr: f(t.array(t.int32, 4), fixed32),
  Int64Ar: t.array(t.int64, 4),
  Int64FixedAr: f(t.array(t.int64, 4), fixed64),
  ByteAr: t.byteArray(4),
  Uint16Ar: t.array(t.uint16, 4),
  Uint64Ar: t.array(t.uint64, 4),
  BoolAr: t.array(t.bool, 3),
  StrAr: t.array(t.string, 4),
  BytesAr: t.array(t.bytes, 4),
  TimeAr: t.array(t.time, 2),
  DurationAr: t.array(t.duration, 2),
  EmptyAr: t.array(Empty, 2),
  ZeroAr: t.array(t.int64, 0),
});

export const ArraysArrays = t.struct("ArraysArrays", {
  Int8ArAr: t.array(t.array(t.int8, 2), 2),
  Int64ArAr: t.array(t.array(t.int64, 2), 2),
  Int64FixedAA: f(t.array(t.array(t.int64, 2), 2), fixed64),
  ByteArAr: t.array(t.byteArray(2), 2),
  StrArAr: t.array(t.array(t.string, 2), 2),
  BytesArAr: t.array(t.array(t.bytes, 2), 2),
  TimeArAr: t.array(t.array(t.time, 2), 2),
  EmptyArAr: t.array(t.array(Empty, 2), 2),
});

export const Slices = t.struct("Slices", {
  Int8Sl: t.slice(t.int8),
  Int16Sl: t.slice(t.int16),
  Int32Sl: t.slice(t.int32),
  Int32FixedSl: f(t.slice(t.int32), fixed32),
  Int64Sl: t.slice(t.int64),
  Int64FixedSl: f(t.slice(t.int64), fixed64),
  IntSl: t.slice(t.int),
  ByteSl: t.bytes,
  Uint16Sl: t.slice(t.uint16),
  Uint32Sl: t.slice(t.uint32),
  Uint64Sl: t.slice(t.uint64),
  BoolSl: t.slice(t.bool),
  StrSl: t.slice(t.string),
  BytesSl: t.slice(t.bytes),
  TimeSl: t.slice(t.time),
  DurationSl: t.slice(t.duration),
  EmptySl: t.slice(Empty),
  PrimSl: t.slice(Small),
});

export const SlicesSlices = t.struct("SlicesSlices", {
  Int8SlSl: t.slice(t.slice(t.int8)),
  Int64SlSl: t.slice(t.slice(t.int64)),
  Uint64FixSS: f(t.slice(t.slice(t.uint64)), fixed64),
  ByteSlSl: t.slice(t.bytes),
  StrSlSl: t.slice(t.slice(t.string)),
  BytesSlSl: t.slice(t.slice(t.bytes)),
  TimeSlSl: t.slice(t.slice(t.time)),
  DurationSlSl: t.slice(t.slice(t.duration)),
  EmptySlSl: t.slice(t.slice(Empty)),
  ArSl: t.slice(t.array(t.int32, 2)),
  SlAr: t.array(t.slice(t.int32), 2),
});

export const Pointers = t.struct("Pointers", {
  Int8Pt: t.pointer(t.int8),
  Int32Pt: t.pointer(t.int32),
  Int32FixedPt: f(t.pointer(t.int32), fixed32),
  Int64Pt: t.pointer(t.int64),
  Int64FixedPt: f(t.pointer(t.int64), fixed64),
  UintPt: t.pointer(t.uint),
  BytePt: t.pointer(t.byte),
  BoolPt: t.pointer(t.bool),
  StrPt: t.pointer(t.string),
  BytesPt: t.pointer(t.bytes),
  TimePt: t.pointer(t.time),
  DurationPt: t.pointer(t.duration),
  EmptyPt: t.pointer(Empty),
  SmallPt: t.pointer(Small),
  ArPt: t.pointer(t.array(t.int32, 2)),
  SlPt: t.pointer(t.slice(t.string)),
});

export const PointerSlices = t.struct("PointerSlices", {
  Int8PtSl: t.slice(t.pointer(t.int8)),
  Int64PtSl: t.slice(t.pointer(t.int64)),
  BytePtSl: t.slice(t.pointer(t.byte)),
  StrPtSl: t.slice(t.pointer(t.string)),
  BytesPtSl: t.slice(t.pointer(t.bytes)),
  TimePtSl: t.slice(t.pointer(t.time)),
  DurPtSl: t.slice(t.pointer(t.duration)),
  SmallPtSl: t.slice(t.pointer(Small)),
  BoolPtAr: t.array(t.pointer(t.bool), 2),
  SmallPtAr: t.array(t.pointer(Small), 2),
  StrPtAr: t.array(t.pointer(t.string), 2),
  TimePtAr: t.array(t.pointer(t.time), 2),
  UintPtSl: t.slice(t.pointer(t.uint64)),
  Int32PtFix: f(t.slice(t.pointer(t.int32)), fixed32),
});

export const Nested = t.struct("Nested", {
  Prim: Primitives,
  PrimPt: t.pointer(Primitives),
  Arr: Arrays,
  Sl: Slices,
  Pt: Pointers,
  Small: t.slice(Small),
  Name: t.string,
});

const writeEmpty = {
  writeEmpty: true,
};

export const WriteEmpty = t.struct("WriteEmpty", {
  Name: f(t.string, writeEmpty),
  Values: f(t.slice(t.int32), writeEmpty),
  Inner: f(Small, writeEmpty),
  Data: f(t.bytes, writeEmpty),
  Count: f(t.int64, writeEmpty),
  Flag: f(t.bool, writeEmpty),
  Strs: t.slice(t.string),
  Normal: t.string,
});

const nilElements = {
  nilElements: true,
};

export const NilElements = t.struct("NilElements", {
  Entries: f(t.slice(t.pointer(Pos)), nilElements),
  Strs: f(t.slice(t.pointer(t.string)), nilElements),
  Times: f(t.slice(t.pointer(t.time)), nilElements),
  Plain: f(t.slice(Small), nilElements),
  Name: t.string,
});

export const JSONTags = t.struct("JSONTags", {
  Renamed: f(t.string, {
    json: "renamed_field",
  }),
  OmitStr: f(t.string, {
    json: "omit_str",
    omitEmpty: true,
  }),
  OmitInt: f(t.int64, {
    json: "omit_int",
    omitEmpty: true,
  }),
  OmitSl: f(t.slice(t.string), {
    json: "omit_sl",
    omitEmpty: true,
  }),
  OmitPt: f(t.pointer(Small), {
    json: "omit_pt",
    omitEmpty: true,
  }),
  OmitSmall: f(Small, {
    json: "omit_small",
    omitEmpty: true,
  }),
  OmitTime: f(t.time, {
    json: "omit_time",
    omitEmpty: true,
  }),
  OmitBytes: f(t.bytes, {
    json: "omit_bytes",
    omitEmpty: true,
  }),
  OmitAr: f(t.array(t.int8, 2), {
    json: "omit_ar",
    omitEmpty: true,
  }),
  // Skipped: `json:"-"` fields are not part of the schema at all.
  Kept: f(t.bool, {
    json: "kept",
  }),
});

const unsafe = {
  unsafe: true,
};

export const UnsafeFloat = t.struct("UnsafeFloat", {
  F64: f(t.float64, unsafe),
  F32: f(t.float32, unsafe),
  F64Sl: f(t.slice(t.float64), unsafe),
  F32Ar: f(t.array(t.float32, 2), unsafe),
  Label: t.string,
});

export const ReservedV1 = t.struct("ReservedV1", {
  A: t.string,
  B: t.int64,
  C: t.slice(t.string),
  D: Small,
});

export const ReservedV2 = t.struct("ReservedV2", {
  A: t.string,
  _B: t.reserved(),
  C: t.slice(t.string),
  D: Small,
});

// Interfaces

export const Iface = t.interface("Iface");

export const ConcreteA = t.struct("ConcreteA", {
  X: t.int64,
  Y: t.string,
});
export const ConcreteB = t.byteArray(4);
export const ConcreteC = t.struct("ConcreteC", {
  Inner: Iface,
  List: t.slice(Iface),
});
export const ConcreteEmpty = t.struct("ConcreteEmpty", {
});
export const ConcreteStr = t.string;
export const ConcreteSl = t.slice(t.int32);
export const ConcreteTime = t.struct("ConcreteTime", {
  T: t.time,
  D: t.duration,
});

export const Interfaces = t.struct("Interfaces", {
  One: Iface,
  Many: t.slice(Iface),
  Arr: t.array(Iface, 2),
  Anyval: t.interface("any"),
  Anys: t.slice(t.interface("any")),
  Name: t.string,
});

// Repr types

export interface Coin {
  Denom: string
  Amount: bigint
}

export function coinToString(c: Coin): string {
  if (c.Amount === 0n && c.Denom === "") return "";
  return `${c.Amount}${c.Denom}`;
}

export function coinFromString(s: string): Coin {
  if (s === "") return {
    Denom: "",
    Amount: 0n,
  };
  const m = /^(-?\d*)(.*)$/s.exec(s)!;
  if (!/^-?\d+$/.test(m[1])) throw new AminoError(`bad coin ${JSON.stringify(s)}`);
  const amount = BigInt(m[1]);
  if (amount < -(2n ** 63n) || amount >= 2n ** 63n) throw new AminoError("coin amount out of range");
  return {
    Denom: m[2],
    Amount: amount,
  };
}

export const Coin = t.repr(t.string, coinToString, coinFromString, {
  name: "Coin",
  isZero: c => c.Amount === 0n && c.Denom === "",
});

export const Coins = t.repr(
  t.string,
  (cs: Coin[] | null) => (cs ?? []).map(coinToString).join(","),
  // An empty list, not null: `*Coins` must tell a nil pointer from a pointer to no coins.
  s => (s === "" ? [] : s.split(",").map(coinFromString)),
  {
    name: "Coins",
    goKind: "scalar",
    isZero: cs => !cs || cs.length === 0,
  },
);

export const Addr = t.repr(
  t.string,
  (a: Uint8Array) => (a.every(b => b === 0) ? "" : Array.from(a, b => b.toString(16).padStart(2, "0")).join("")),
  (s) => {
    if (s === "") return new Uint8Array(8);
    if (!/^[0-9a-fA-F]{16}$/.test(s)) throw new AminoError(`bad addr ${JSON.stringify(s)}`);
    return Uint8Array.from(s.match(/../g)!, h => parseInt(h, 16));
  },
  {
    name: "Addr",
    goKind: "array",
    isZero: a => a.every(b => b === 0),
  },
);

export const PairRepr = t.struct("PairRepr", {
  C: t.int64,
  D: t.int64,
});
export const Pair = t.repr(
  PairRepr,
  (p: {
    A: number
    B: number
  }) => ({
    C: BigInt(p.A),
    D: BigInt(p.B),
  }),
  r => ({
    A: Number(BigInt.asIntN(32, r.C)),
    B: Number(BigInt.asIntN(32, r.D)),
  }),
  {
    name: "Pair",
    isZero: p => p.A === 0 && p.B === 0,
  },
);

export const Wrapped = t.repr(t.int32, (w: {
  V: number
}) => w.V, v => ({
  V: v,
}), {
  name: "Wrapped",
});

export const BoxedRepr = t.struct("BoxedRepr", {
  Val: t.int32,
});
export const Boxed = t.repr(BoxedRepr, (b: number) => ({
  Val: b,
}), r => r.Val, {
  name: "Boxed",
  goKind: "scalar",
  isZero: b => b === 0,
});

export const Tiny = t.repr(t.uint8, (x: {
  A: number
}) => x.A & 0xff, u => ({
  A: (u << 24) >> 24,
}), {
  name: "Tiny",
});

export const Listy = t.repr(
  t.slice(Small),
  (l: {
    A: number
    B: string
  }) => (l.A === 0 && l.B === ""
    ? null
    : [
      {
        A: l.A,
        B: "",
        C: null,
      },
      {
        A: 0,
        B: l.B,
        C: null,
      },
    ]),
  r => ({
    A: r?.[0]?.A ?? 0,
    B: r?.[1]?.B ?? "",
  }),
  {
    name: "Listy",
  },
);

export const ListyHolder = t.struct("ListyHolder", {
  L: Listy,
  N: t.int32,
});

export const Reprs = t.struct("Reprs", {
  Coin,
  Coins,
  CoinsPt: t.pointer(Coins),
  CoinSl: t.slice(Coin),
  CoinPtSl: t.slice(t.pointer(Coin)),
  Addr,
  AddrSl: t.slice(Addr),
  AddrAr: t.array(Addr, 2),
  Pair,
  PairSl: t.slice(Pair),
  Wrapped,
  WrapSl: t.slice(Wrapped),
  Boxed,
  BoxedSl: t.slice(Boxed),
  Tinies: t.slice(Tiny),
  CoinOmit: f(Coin, {
    json: "coin_omit",
    omitEmpty: true,
  }),
  AddrOmit: f(Addr, {
    json: "addr_omit",
    omitEmpty: true,
  }),
  CoinsOm: f(Coins, {
    json: "coins_om",
    omitEmpty: true,
  }),
});

export const schemas = {
  Empty,
  Primitives,
  Arrays,
  ArraysArrays,
  Slices,
  SlicesSlices,
  Small,
  Pointers,
  PointerSlices,
  Nested,
  WriteEmpty,
  NilElements,
  JSONTags,
  UnsafeFloat,
  ReservedV1,
  ReservedV2,
  Interfaces,
  Reprs,
  ListyHolder,
  IntDef: t.int64,
  IntAr: t.array(t.int64, 4),
  IntSl: t.slice(t.int64),
  ByteAr: t.byteArray(4),
  ByteSl: t.bytes,
  StrSl: t.slice(t.string),
  SmallSl: t.slice(Small),
  SmallAr: t.array(Small, 2),
  StrSlSl: t.slice(t.slice(t.string)),
  Int8SlSl: t.slice(t.slice(t.int8)),
  Time: t.time,
  Duration: t.duration,
  String: t.string,
  Int64: t.int64,
  Uint16: t.uint16,
  Bool: t.bool,
  Bytes: t.bytes,
  Pos,
};

export function newCodec(options?: CodecOptions): Codec {
  return new Codec(options).registerPackage("gen", {
    Empty,
    Primitives,
    Arrays,
    ArraysArrays,
    Slices,
    SlicesSlices,
    Small,
    Pos,
    Pointers,
    PointerSlices,
    Nested,
    WriteEmpty,
    NilElements,
    JSONTags,
    UnsafeFloat,
    ReservedV1,
    ReservedV2,
    ConcreteA,
    ConcreteB,
    ConcreteC,
    ConcreteEmpty,
    ConcreteStr,
    ConcreteSl,
    ConcreteTime,
    Interfaces,
    Coin,
    Coins,
    Addr,
    Listy,
    ListyHolder,
    Pair,
    PairRepr,
    Wrapped,
    Boxed,
    BoxedRepr,
    Tiny,
    Reprs,
    IntDef: schemas.IntDef,
    IntAr: schemas.IntAr,
    IntSl: schemas.IntSl,
    ByteAr: schemas.ByteAr,
    ByteSl: schemas.ByteSl,
    StrSl: schemas.StrSl,
    SmallSl: schemas.SmallSl,
    SmallAr: schemas.SmallAr,
    StrSlSl: schemas.StrSlSl,
    Int8SlSl: schemas.Int8SlSl,
  });
}
