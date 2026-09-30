# @gnolang/amino-ts

Amino encoding and decoding for TypeScript, byte-for-byte compatible with the
Go implementation used by [Tendermint2](https://github.com/gnolang/gno/tree/master/tm2)
and [gno.land](https://gno.land).

- **Binary** (`amino.Marshal`), **JSON** (`amino.MarshalJSON`), `Any`, and the
  length-prefixed (`Sized`) forms, for encoding and decoding.
- **Schema-driven.** Declare your types once with the `t` builders, which
  mirror Go declarations and struct tags. Value types are inferred.
- **Go-exact.** Tested differentially against go-amino: thousands of fuzzed
  values, corrupted inputs, and real gno.land transactions (including their
  sign bytes) are produced by Go and must be reproduced exactly.
- No runtime dependencies and no Node APIs, so it runs in browsers, Node,
  Deno and Bun. Ships ESM and CJS.

## Install

```sh
npm install @gnolang/amino-ts
```

## Usage

```ts
import { Codec, t, type Infer } from "@gnolang/amino-ts";

// type Coin struct { Denom string `json:"denom"`; Amount int64 `json:"amount"` }
const Coin = t.struct("Coin", {
  denom: t.string,
  amount: t.int64,
});

// type MsgSend struct { ... }
const MsgSend = t.struct("MsgSend", {
  fromAddress: t.field(t.string, { json: "from_address" }),
  toAddress: t.field(t.string, { json: "to_address" }),
  amount: t.slice(Coin),
});

type MsgSend = Infer<typeof MsgSend>;
// { fromAddress: string; toAddress: string; amount: { denom: string; amount: bigint }[] | null }

const cdc = new Codec().register("/bank.MsgSend", MsgSend);

const msg: MsgSend = {
  fromAddress: "g1...",
  toAddress: "g1...",
  amount: [{ denom: "ugnot", amount: 1000n }],
};

const bytes = cdc.marshal(MsgSend, msg);           // Uint8Array
const back = cdc.unmarshal(MsgSend, bytes);        // MsgSend
const json = cdc.marshalJSON(MsgSend, msg);        // '{"from_address":"g1...",...}'

// Interfaces (protobuf Any)
const any = cdc.marshalAny({ typeUrl: "/bank.MsgSend", value: msg });
cdc.unmarshalAny(any); // { typeUrl: "/bank.MsgSend", value: {...} }
cdc.marshalJSONAny({ typeUrl: "/bank.MsgSend", value: msg });
// '{"@type":"/bank.MsgSend","from_address":"g1...",...}'
```

### Sign bytes

tm2 signs `sortJSON(aminoJSON(signDoc))`. `sortJSON` matches `std.MustSortJSON`
(keys sorted, whitespace stripped, and strings and numbers re-encoded the way Go
does):

```ts
import { sortJSON } from "@gnolang/amino-ts";

const signBytes = new TextEncoder().encode(sortJSON(cdc.marshalJSON(SignDoc, doc)));
```

`tests/tm2.ts` defines the full gno.land transaction schemas (`std.Tx`,
`bank.MsgSend`, `vm.MsgCall`, `vm.MsgAddPackage`, `vm.MsgRun`, and both sign
doc renderings). Copy it as a starting point.

## Schema reference

| Go | Schema | JS value |
|----|--------|----------|
| `bool` | `t.bool` | `boolean` |
| `int8` `int16` `int32` | `t.int8` `t.int16` `t.int32` | `number` |
| `uint8`/`byte` `uint16` `uint32` | `t.uint8`/`t.byte` `t.uint16` `t.uint32` | `number` |
| `int64` `int` `uint64` `uint` | `t.int64` `t.int` `t.uint64` `t.uint` | `bigint` (encoders also take safe-integer `number`s and decimal strings) |
| `float32` `float64` | `t.float32` `t.float64` (need `unsafe`) | `number` |
| `string` | `t.string` | `string` |
| `[]byte` | `t.bytes` | `Uint8Array \| null` |
| `[N]byte` | `t.byteArray(N)` | `Uint8Array` |
| `[]T` | `t.slice(T)` | `T[] \| null` |
| `[N]T` | `t.array(T, N)` | `T[]` |
| `*T` | `t.pointer(T)` | `T \| null` |
| `struct {...}` | `t.struct(name, { field: T, ... })` | object |
| interface | `t.interface(name?)` | `{ typeUrl, value } \| null` |
| `time.Time` | `t.time` | `{ seconds: bigint, nanos: number }` (a `Date` is accepted when encoding) |
| `time.Duration` | `t.duration` | `bigint` nanoseconds |
| `MarshalAmino`/`UnmarshalAmino` | `t.repr(reprType, toRepr, fromRepr, options?)` | any |
| `_ struct{} amino:"reserved"` | `t.reserved()` | (none) |
| recursive types | `t.lazy(() => T)` | |

`null` stands for Go's `nil`. Go distinguishes a nil slice (`null` in JSON)
from an empty one (`[]`), and so does this library. Decoding binary always
yields `null` for empty slices and bytes, as Go does.

### Struct fields and tags

Object key order is field order, and field order sets the field numbers, as in
Go. Keys that look like integers are rejected, because JS would reorder them.
Wrap a type in `t.field(type, options)` to add tags:

| Go tag | option |
|--------|--------|
| `json:"name"` | `json: "name"` |
| `json:",omitempty"` | `omitEmpty: true` |
| `binary:"fixed32"` / `binary:"fixed64"` | `fixed32: true` / `fixed64: true` |
| `binary:"varint"` | `varint: true` |
| `amino:"unsafe"` | `unsafe: true` |
| `amino:"write_empty"` | `writeEmpty: true` |
| `amino:"nil_elements"` | `nilElements: true` |

A field tagged `json:"-"` is not encoded at all, so leave it out of the schema.
A field missing from a JS object is encoded as its zero value.

### Repr types (`MarshalAmino`)

A Go type with `MarshalAmino() (R, error)` is encoded as `R`:

```ts
// crypto.Address: [20]byte, encoded as a bech32 string
const Address = t.repr(t.string, addr => bech32Encode("g", addr), s => bech32Decode(s), {
  goKind: "array",
  isZero: a => a.every(b => b === 0),
});
```

Amino also looks at the kind of the Go type itself, so `t.repr` asks for it:

- `goKind`: `"struct"` (the default), `"array"`, or `"scalar"` (Go numbers,
  strings, bools and slices). A `"scalar"` field holding its zero value is
  skipped in binary without being converted, and non-struct kinds use the
  `{"@type","value"}` form of interface JSON.
- `isZero(v)`: whether `v` is the Go zero value, for `omitempty` (and for
  skipping `"scalar"` fields).
- `zero()`: the Go zero value, if `fromRepr(zero of R)` does not give it.

If a repr type is used behind a pointer, give it a zero value that is not
`null`, or a nil pointer and a pointer to the zero value become
indistinguishable.

### Registration

`new Codec()` comes with go-amino's built-in registrations:
`/google.protobuf.{Timestamp,Duration,Int64Value,UInt64Value,Int32Value,UInt32Value,BoolValue,StringValue,BytesValue,Empty}`
and `/amino.{UInt8,Int8,UInt16,Int16}`. Register your own concrete types with
`register(typeUrl, type)`, or with `registerPackage(p3pkg, { Name: type })`,
which builds the `/<p3pkg>.<Name>` URLs the way `amino.NewPackage` does. As in
Go, type URLs are matched on the part after the last `/`.

## Compatibility notes

- **Strictness matches Go.** Decoders reject what go-amino rejects:
  out-of-order or duplicate fields, unknown fields and JSON keys, trailing
  bytes, unquoted 64-bit JSON integers, and `Any` nesting deeper than 64.
  They also accept what Go accepts, such as non-canonical varints and trailing
  data after a top-level JSON object.
- **Invalid UTF-8.** Go strings can hold arbitrary bytes, and JS strings
  cannot. By default, invalid sequences decode to U+FFFD, like `TextDecoder`,
  so re-encoding such a value does not reproduce the original bytes. Pass
  `new Codec({ strictUtf8: true })` to reject such input instead.
- **Go zero time.** A zero `time.Time` in Go is year 1, and amino treats the
  Unix epoch as its "empty" time. Decoders return year-1 timestamps wherever
  Go would (empty `Any` values, fields of absent nested structs), so that
  re-encoding stays identical.
- go-amino cannot encode a struct field whose repr type is a list of structs
  (it panics), so this library refuses to encode one too.

## Development

```sh
pnpm install
pnpm test          # vitest
pnpm lint
pnpm build         # tsc + tsdown + attw
pnpm fixtures      # regenerate testdata/fixtures.json from go-amino (needs Go and ../gno)
```

`gen/` is a Go program that fuzzes the types in `gen/types.go` with go-amino
and records every encode and decode path. `tests/schemas.ts` mirrors those
types. When you add a type, add it to both.

## License

Apache-2.0
