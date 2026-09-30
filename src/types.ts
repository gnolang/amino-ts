/**
 * Schema descriptors for Amino types.
 *
 * Amino has no self-describing wire format: the Go implementation drives
 * encoding off `reflect.Type` plus struct tags. In TypeScript the same
 * information is supplied as a schema built with the `t` builders below. Each
 * builder mirrors one Go construct, and the encoders follow the Go codec rules
 * for it exactly, so a schema that matches the Go declaration produces the
 * same bytes and the same JSON as `go-amino`.
 */

import {
  AminoError,
} from "./errors";
import type {
  Timestamp,
} from "./wellknown";

// ----------------------------------------
// Values

/** An interface (Go `interface{...}` / protobuf `Any`) value. */
export interface AnyValue<T = unknown> {
  /** Registered type URL of the concrete value, e.g. `/bank.MsgSend`. */
  typeUrl: string
  /** The concrete value, shaped as its registered schema describes. */
  value: T
}

// ----------------------------------------
// Field options (the Go struct tags)

export interface FieldOptions {
  /** JSON key; defaults to the field's key in the schema (`json:"name"`). */
  json?: string
  /** Omit the field from JSON when it holds its zero value (`json:",omitempty"`). */
  omitEmpty?: boolean
  /** Encode a 32-bit or `int`/`uint` integer as 4 little-endian bytes (`binary:"fixed32"`). */
  fixed32?: boolean
  /** Encode a 64-bit or `int`/`uint` integer as 8 little-endian bytes (`binary:"fixed64"`). */
  fixed64?: boolean
  /** Encode a signed integer as a plain, non-zigzag varint (`binary:"varint"`). */
  varint?: boolean
  /** Allow floating point values (`amino:"unsafe"`). */
  unsafe?: boolean
  /** Always write the field, even when empty (`amino:"write_empty"`). */
  writeEmpty?: boolean
  /** Let empty list elements decode as `null` (`amino:"nil_elements"`). */
  nilElements?: boolean
}

/** Options with the field number filled in, as the codec sees them. */
export interface ResolvedFieldOptions extends FieldOptions {
  fieldNum: number
}

// ----------------------------------------
// Descriptors

interface TypeBase<K extends string, T> {
  readonly kind: K
  /** Phantom marker carrying the value type; never set at runtime. */
  readonly __value?: T
}

export type BoolType = TypeBase<"bool", boolean>;
export type Int8Type = TypeBase<"int8", number>;
export type Int16Type = TypeBase<"int16", number>;
export type Int32Type = TypeBase<"int32", number>;
export type Int64Type = TypeBase<"int64", bigint>;
/** Go `int`, which is 64 bits wide on every platform gno runs on. */
export type IntType = TypeBase<"int", bigint>;
export type Uint8Type = TypeBase<"uint8", number>;
export type Uint16Type = TypeBase<"uint16", number>;
export type Uint32Type = TypeBase<"uint32", number>;
export type Uint64Type = TypeBase<"uint64", bigint>;
/** Go `uint`, which is 64 bits wide on every platform gno runs on. */
export type UintType = TypeBase<"uint", bigint>;
export type Float32Type = TypeBase<"float32", number>;
export type Float64Type = TypeBase<"float64", number>;
export type StringType = TypeBase<"string", string>;
/** Go `[]byte`. `null` stands for a nil slice. */
export type BytesType = TypeBase<"bytes", Uint8Array | null>;
/** Go `time.Time`. */
export type TimeType = TypeBase<"time", Timestamp>;
/** Go `time.Duration`, in nanoseconds. */
export type DurationType = TypeBase<"duration", bigint>;

/** Go `[N]byte`. */
export interface ByteArrayType extends TypeBase<"bytearray", Uint8Array> {
  readonly length: number
}

/** Go `[]T`. `null` stands for a nil slice. */
export interface SliceType<E extends AminoType = AminoType> {
  readonly kind: "slice"
  readonly __value?: Infer<E>[] | null
  readonly elem: E
}

/** Go `[N]T` for a non-byte `T`. */
export interface ArrayType<E extends AminoType = AminoType> {
  readonly kind: "array"
  readonly __value?: Infer<E>[]
  readonly elem: E
  readonly length: number
}

/** Go `*T`. `null` stands for a nil pointer. */
export interface PointerType<E extends AminoType = AminoType> {
  readonly kind: "pointer"
  readonly __value?: Infer<E> | null
  readonly elem: E
}

/** Go interface type; values are `AnyValue`s resolved through the codec registry. */
export interface InterfaceType extends TypeBase<"interface", AnyValue | null> {
  readonly name?: string
}

/** A reserved (removed) struct field; it keeps its field number. `_ struct{} amino:"reserved"` */
export type ReservedType = TypeBase<"reserved", never>;

export interface FieldDef<T extends AminoType = AminoType> {
  readonly type: T
  readonly options: FieldOptions
}

export type FieldSpec = AminoType | FieldDef;

type FieldTypeOf<F> = F extends FieldDef<infer T> ? T : F extends AminoType ? F : never;

type ReservedKeys<F> = {
  [K in keyof F]: FieldTypeOf<F[K]> extends ReservedType ? K : never
}[keyof F];

export type StructValue<F extends Record<string, FieldSpec>> = {
  -readonly [K in Exclude<keyof F, ReservedKeys<F>>]: Infer<FieldTypeOf<F[K]>>
};

export interface StructField {
  /** Key of the field in the JS value object. */
  readonly key: string
  readonly type: AminoType
  readonly options: ResolvedFieldOptions
}

/** Go struct. */
export interface StructType<F extends Record<string, FieldSpec> = Record<string, FieldSpec>> {
  readonly kind: "struct"
  readonly __value?: StructValue<F>
  readonly name?: string
  readonly spec: F
  /** Resolved fields in declaration order, reserved fields removed. */
  readonly fields: readonly StructField[]
}

/**
 * A Go type that implements `MarshalAmino()`/`UnmarshalAmino()`: it is encoded
 * as its representation type instead of its own structure.
 */
export interface ReprType<T = unknown, R extends AminoType = AminoType> extends TypeBase<"repr", T> {
  readonly name?: string
  readonly repr: R
  readonly toRepr: (value: T) => Infer<R>
  readonly fromRepr: (repr: Infer<R>) => T
  /** Mirrors the Go type's own kind where amino looks at it; see `ReprOptions`. */
  readonly goKind: ReprGoKind
  readonly isZero?: (value: T) => boolean
  readonly zero?: () => T
}

/** Deferred reference, for recursive schemas. */
export interface LazyType<T extends AminoType = AminoType> {
  readonly kind: "lazy"
  readonly __value?: Infer<T>
  readonly get: () => T
}

/* eslint-disable @typescript-eslint/no-explicit-any -- `any` stops the union from instantiating itself recursively. */
export type AminoType
  = | BoolType
    | Int8Type
    | Int16Type
    | Int32Type
    | Int64Type
    | IntType
    | Uint8Type
    | Uint16Type
    | Uint32Type
    | Uint64Type
    | UintType
    | Float32Type
    | Float64Type
    | StringType
    | BytesType
    | ByteArrayType
    | SliceType<any>
    | ArrayType<any>
    | PointerType<any>
    | StructType<any>
    | InterfaceType
    | TimeType
    | DurationType
    | ReprType<any, any>
    | LazyType<any>
    | ReservedType;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The JS value type a schema encodes and decodes. */
export type Infer<S> = S extends {
  readonly __value?: infer T
} ? T : never;

// ----------------------------------------
// Builders

const prim = <K extends string, T>(kind: K): TypeBase<K, T> => Object.freeze({
  kind,
}) as TypeBase<K, T>;

/** The kind of the Go type behind a repr type; see `ReprOptions.goKind`. */
export type ReprGoKind = "struct" | "array" | "scalar";

export interface ReprOptions<T> {
  /** Name used in error messages. */
  name?: string
  /**
   * The kind of the Go type itself (not of its repr). Amino looks at it in a
   * few places:
   * - `"struct"` (the default): a field is always encoded, `nil` pointers to it
   *   are rejected in lists, and interface JSON inlines a struct repr.
   * - `"array"`: like a struct in binary, but interface JSON always uses
   *   `{"@type","value"}`.
   * - `"scalar"` (Go numbers, strings, bools, slices): a field holding the Go
   *   zero value (per `isZero`) is skipped in binary without calling
   *   `toRepr`, and interface JSON uses `{"@type","value"}`.
   */
  goKind?: ReprGoKind
  /**
   * Whether a value is the Go zero value (`reflect.DeepEqual` to it). Used by
   * JSON `omitempty` and, for `"scalar"` kinds, to skip empty fields in binary.
   * Without it, values are never considered zero.
   */
  isZero?: (value: T) => boolean
  /** The Go zero value; defaults to `fromRepr(<zero of repr>)`. */
  zero?: () => T
}

function isCanonicalIndex(key: string): boolean {
  return /^(0|[1-9]\d*)$/.test(key) && Number(key) < 2 ** 32 - 1;
}

function buildFields(spec: Record<string, FieldSpec>, name: string | undefined): StructField[] {
  const fields: StructField[] = [];
  let fieldNum = 1;
  for (const key of Object.keys(spec)) {
    if (isCanonicalIndex(key)) {
      // JS objects iterate integer-like keys first, which would silently
      // reorder the fields and so change their field numbers.
      throw new AminoError(`struct ${name ?? "<anonymous>"}: field key "${key}" is integer-like, which breaks field ordering`);
    }
    const s = spec[key];
    const def: FieldDef = "options" in s && "type" in s
      ? s as FieldDef
      : {
        type: s as AminoType,
        options: {
        },
      };
    if (def.type.kind === "reserved") {
      fieldNum++;
      continue;
    }
    const options: ResolvedFieldOptions = {
      ...def.options,
      fieldNum: fieldNum++,
    };
    validateFieldOptions(name, key, def.type, options);
    fields.push({
      key,
      type: def.type,
      options,
    });
  }
  return fields;
}

function validateFieldOptions(struct: string | undefined, key: string, type: AminoType, o: FieldOptions) {
  const where = `field ${struct ?? "<anonymous>"}.${key}`;
  if ([o.fixed32, o.fixed64, o.varint].filter(Boolean).length > 1) {
    throw new AminoError(`${where}: binary options are mutually exclusive: at most one of fixed32, fixed64, varint`);
  }
  // Validation needs the ultimate element kind, which may be lazy; defer
  // unless it is already resolvable.
  let u: AminoType = type;
  for (;;) {
    if (u.kind === "lazy") return;
    if (u.kind === "pointer" || u.kind === "slice" || u.kind === "array") {
      u = u.elem;
      continue;
    }
    break;
  }
  if (o.fixed32 && !["int32", "uint32", "int", "uint"].includes(u.kind)) {
    throw new AminoError(`${where}: fixed32 requires a 32-bit or int/uint type, got ${u.kind}`);
  }
  if (o.fixed64 && !["int64", "uint64", "int", "uint"].includes(u.kind)) {
    throw new AminoError(`${where}: fixed64 requires a 64-bit or int/uint type, got ${u.kind}`);
  }
  if (o.varint && !["int32", "int64", "int"].includes(u.kind)) {
    throw new AminoError(`${where}: varint is only valid on int/int32/int64, got ${u.kind}`);
  }
  if (!o.unsafe && (u.kind === "float32" || u.kind === "float64")) {
    throw new AminoError(`${where}: floating point types require the unsafe option`);
  }
}

export const t = {
  bool: prim<"bool", boolean>("bool") as BoolType,
  int8: prim<"int8", number>("int8") as Int8Type,
  int16: prim<"int16", number>("int16") as Int16Type,
  int32: prim<"int32", number>("int32") as Int32Type,
  int64: prim<"int64", bigint>("int64") as Int64Type,
  int: prim<"int", bigint>("int") as IntType,
  uint8: prim<"uint8", number>("uint8") as Uint8Type,
  /** Alias of `uint8`. */
  byte: prim<"uint8", number>("uint8") as Uint8Type,
  uint16: prim<"uint16", number>("uint16") as Uint16Type,
  uint32: prim<"uint32", number>("uint32") as Uint32Type,
  uint64: prim<"uint64", bigint>("uint64") as Uint64Type,
  uint: prim<"uint", bigint>("uint") as UintType,
  float32: prim<"float32", number>("float32") as Float32Type,
  float64: prim<"float64", number>("float64") as Float64Type,
  string: prim<"string", string>("string") as StringType,
  bytes: prim<"bytes", Uint8Array | null>("bytes") as BytesType,
  time: prim<"time", Timestamp>("time") as TimeType,
  duration: prim<"duration", bigint>("duration") as DurationType,

  /** Go `[length]byte`. */
  byteArray(length: number): ByteArrayType {
    assertLength(length);
    return Object.freeze({
      kind: "bytearray",
      length,
    });
  },

  /** Go `[]E`. A slice of `uint8` is `t.bytes`. */
  slice<E extends AminoType>(elem: E): E extends Uint8Type ? BytesType : SliceType<E> {
    if (elem.kind === "uint8") return t.bytes as never;
    return Object.freeze({
      kind: "slice",
      elem,
    }) as never;
  },

  /** Go `[length]E`. An array of `uint8` is `t.byteArray(length)`. */
  array<E extends AminoType>(elem: E, length: number): E extends Uint8Type ? ByteArrayType : ArrayType<E> {
    assertLength(length);
    if (elem.kind === "uint8") return t.byteArray(length) as never;
    return Object.freeze({
      kind: "array",
      elem,
      length,
    }) as never;
  },

  /** Go `*E`. */
  pointer<E extends AminoType>(elem: E): PointerType<E> {
    if (elem.kind === "pointer") throw new AminoError("nested pointers are not supported");
    if (elem.kind === "interface") throw new AminoError("pointers to interfaces are not supported");
    return Object.freeze({
      kind: "pointer",
      elem,
    });
  },

  /**
   * Go struct. Field order is significant: it assigns the field numbers.
   * Wrap a field type in `t.field(type, options)` to set struct tags.
   */
  struct<F extends Record<string, FieldSpec>>(name: string | undefined, spec: F): StructType<F> {
    let fields: StructField[] | undefined;
    const st = {
      kind: "struct" as const,
      name,
      spec,
      get fields(): StructField[] {
        if (!fields) {
          fields = buildFields(spec, name);
        }
        return fields;
      },
    };
    // Build eagerly when possible so option errors surface at definition.
    void st.fields;
    return Object.freeze(st);
  },

  /** A struct field with options (the Go struct tags). */
  field<T extends AminoType>(type: T, options: FieldOptions = {
  }): FieldDef<T> {
    return Object.freeze({
      type,
      options: Object.freeze({
        ...options,
      }),
    });
  },

  /** A removed field that still holds its field number (`_ struct{} amino:"reserved"`). */
  reserved(): ReservedType {
    return RESERVED;
  },

  /**
   * Go interface type. Concrete values are looked up in the codec by type
   * URL; see `Codec.register` for restricting which types it may hold.
   */
  interface(name?: string): InterfaceType {
    return Object.freeze({
      kind: "interface",
      name,
    });
  },

  /**
   * A Go type with `MarshalAmino`/`UnmarshalAmino` methods: it is encoded as
   * `repr` after converting with `toRepr`, and decoded with `fromRepr`.
   */
  repr<T, R extends AminoType>(
    repr: R,
    toRepr: (value: T) => Infer<R>,
    fromRepr: (repr: Infer<R>) => T,
    options: ReprOptions<T> = {
    },
  ): ReprType<T, R> {
    if (repr.kind === "pointer") throw new AminoError("repr types cannot be pointers");
    return Object.freeze({
      kind: "repr",
      name: options.name,
      repr,
      toRepr,
      fromRepr,
      goKind: options.goKind ?? "struct",
      isZero: options.isZero,
      zero: options.zero,
    });
  },

  /** A reference resolved on first use, for recursive or out-of-order schemas. */
  lazy<T extends AminoType>(get: () => T): LazyType<T> {
    let cached: T | undefined;
    return Object.freeze({
      kind: "lazy",
      get: () => (cached ??= get()),
    });
  },
};

const RESERVED: ReservedType = Object.freeze({
  kind: "reserved",
});

function assertLength(length: number) {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new AminoError(`invalid array length ${length}`);
  }
}

/** Where the codecs look up the concrete types of interface values. */
export interface TypeRegistry {
  /** The registered type and its canonical URL; throws when the URL is unknown. */
  resolveTypeUrl(typeUrl: string): {
    typeUrl: string
    type: AminoType
  }
  /** Throws when the type is known not to implement the interface. */
  assertImplements(iface: InterfaceType, typeUrl: string): void
}

/** Follows `lazy` references until a concrete descriptor is reached. */
export function resolve(type: AminoType): Exclude<AminoType, LazyType> {
  while (type.kind === "lazy") {
    type = type.get();
  }
  return type;
}
