/**
 * Type facts the codecs derive from a schema, each mirroring a helper of the
 * Go codec (`TypeInfo.GetTyp3`, `IsStructOrUnpacked`, `isNonstructDefaultValue`,
 * `defaultValue`, ...). Keeping them here, named after their Go counterparts,
 * makes it possible to check the TS rules against the Go ones line by line.
 */

import {
  Typ3,
} from "./binary/writer";
import {
  AminoError,
} from "./errors";
import {
  type AminoType,
  type FieldOptions,
  resolve,
  type StructField,
} from "./types";
import {
  type Timestamp,
  toTimestamp,
} from "./wellknown";

export type Resolved = Exclude<AminoType, {
  kind: "lazy"
}>;

/** The Go `reflect.Kind` of a schema type, where the codec branches on it. */
export type GoKind
  = | "bool" | "int8" | "int16" | "int32" | "int64" | "int"
    | "uint8" | "uint16" | "uint32" | "uint64" | "uint"
    | "float32" | "float64" | "string"
    | "slice" | "array" | "struct" | "interface" | "pointer" | "other";

export function goKind(type: AminoType): GoKind {
  const r = resolve(type);
  switch (r.kind) {
    case "bytes":
      return "slice";
    case "bytearray":
      return "array";
    case "time":
      return "struct";
    case "duration":
      return "int64";
    case "repr":
      return r.goKind === "struct" ? "struct" : r.goKind === "array" ? "array" : "other";
    case "reserved":
      throw new AminoError("reserved is only valid as a struct field");
    default:
      return r.kind;
  }
}

/** Dereferences a pointer type (Go `TypeInfo` is always the pointee's). */
export function deref(type: AminoType): Resolved {
  const r = resolve(type);
  return r.kind === "pointer" ? resolve(r.elem) : r;
}

/** Go `info.ReprType`: the representation type, one level deep. */
export function reprOf(type: AminoType): Resolved {
  const r = deref(type);
  return r.kind === "repr" ? deref(r.repr) : r;
}

/** Go `typeToTyp3(info.ReprType.Type, fopts)`. */
export function typ3Of(type: AminoType, fopts: FieldOptions): Typ3 {
  const r = reprOf(type);
  switch (r.kind) {
    case "time":
    case "duration":
    case "interface":
    case "array":
    case "slice":
    case "bytes":
    case "bytearray":
    case "string":
    case "struct":
    case "repr":
      return Typ3.ByteLength;
    case "int64":
    case "uint64":
      return fopts.fixed64 ? Typ3.Byte8 : Typ3.Varint;
    case "int32":
    case "uint32":
      return fopts.fixed32 ? Typ3.Byte4 : Typ3.Varint;
    case "int":
    case "uint":
      return fopts.fixed64 ? Typ3.Byte8 : fopts.fixed32 ? Typ3.Byte4 : Typ3.Varint;
    case "int8":
    case "int16":
    case "uint8":
    case "uint16":
    case "bool":
      return Typ3.Varint;
    case "float64":
      return Typ3.Byte8;
    case "float32":
      return Typ3.Byte4;
    default:
      throw new AminoError(`unsupported field type ${r.kind}`);
  }
}

/** Element type of a non-byte list, or undefined. */
export function listElem(type: AminoType): AminoType | undefined {
  const r = resolve(type);
  return r.kind === "slice" || r.kind === "array" ? r.elem : undefined;
}

/**
 * Go `IsStructOrUnpacked`: whether the type's binary form is a bare sequence
 * of fields, so that it can be the body of a message without being wrapped
 * in an implicit struct.
 */
export function isStructOrUnpacked(type: AminoType, fopts: FieldOptions): boolean {
  const r = reprOf(type);
  const kind = goKind(r);
  if (kind === "struct" || kind === "interface") return true;
  const elem = listElem(r);
  if (elem !== undefined) return typ3Of(elem, fopts) === Typ3.ByteLength;
  return false;
}

/** Whether the list's element representation is a byte (packed as raw bytes). */
export function elemIsReprByte(elem: AminoType): boolean {
  return reprOf(elem).kind === "uint8";
}

/**
 * Go `writeImplicit`: whether elements of a list of lists are wrapped in an
 * implicit struct because the inner list is packed.
 */
export function isImplicitList(elem: AminoType, fopts: FieldOptions): boolean {
  const einfo = deref(elem);
  if (einfo.kind !== "slice" && einfo.kind !== "array") return false;
  return !elemIsReprByte(einfo.elem) && typ3Of(einfo.elem, fopts) !== Typ3.ByteLength;
}

const unpackedCache = new WeakMap<StructField, boolean>();

/** Go `FieldInfo.UnpackedList`: the field is a list written as repeated entries. */
export function isUnpackedList(field: StructField): boolean {
  let v = unpackedCache.get(field);
  if (v === undefined) {
    const elem = listElem(reprOf(field.type));
    v = elem !== undefined && typ3Of(elem, field.options) === Typ3.ByteLength;
    unpackedCache.set(field, v);
  }
  return v;
}

export const EPOCH: Timestamp = Object.freeze({
  seconds: 0n,
  nanos: 0,
});

/**
 * Go `isNonstructDefaultValue`: the zero value of a non-struct type. Such
 * struct fields are skipped in binary. Structs (including `time.Time`,
 * `time.Duration` and struct-kinded repr types) never are.
 */
export function isNonstructDefault(type: AminoType, value: unknown): boolean {
  const r = resolve(type);
  switch (r.kind) {
    case "pointer":
      return value == null || isNonstructDefault(r.elem, value);
    case "duration":
    case "struct":
    case "time":
    case "array":
    case "bytearray":
    case "float32":
    case "float64":
      return false;
    case "bool":
      return value !== true;
    case "string":
      return value == null || value === "";
    case "bytes":
    case "slice":
      return value == null || (value as ArrayLike<unknown>).length === 0;
    case "interface":
      return value == null;
    case "repr":
      return r.goKind === "scalar" && !!r.isZero?.(value);
    case "int8":
    case "int16":
    case "int32":
    case "uint8":
    case "uint16":
    case "uint32":
    case "int64":
    case "int":
    case "uint64":
    case "uint":
      return value == null || isIntZero(value);
    default:
      return false;
  }
}

/** Go's zero `time.Time` (0001-01-01T00:00:00Z). */
export const GO_ZERO_TIME: Timestamp = Object.freeze({
  seconds: -62135596800n,
  nanos: 0,
});

/**
 * The zero value used when encoding a missing JS field or a `null` element.
 * Times default to the epoch, which amino treats as the empty time.
 */
export function zeroValue(type: AminoType): unknown {
  return zero(type, false);
}

/**
 * Go `reflect.Zero`: what Go holds in a freshly allocated value. Unlike
 * `zeroValue`, a `time.Time` here is year 1, not the epoch. Amino's decoder
 * produces these in a few places (nested structs of absent fields, empty
 * `Any` values, `nil_elements`), and matching them keeps re-encoding
 * byte-identical to Go.
 */
export function goZero(type: AminoType): unknown {
  return zero(type, true);
}

function zero(type: AminoType, go: boolean): unknown {
  const r = resolve(type);
  switch (r.kind) {
    case "bool":
      return false;
    case "int8":
    case "int16":
    case "int32":
    case "uint8":
    case "uint16":
    case "uint32":
    case "float32":
    case "float64":
      return 0;
    case "int64":
    case "int":
    case "uint64":
    case "uint":
    case "duration":
      return 0n;
    case "string":
      return "";
    case "bytes":
    case "slice":
    case "pointer":
    case "interface":
      return null;
    case "bytearray":
      return new Uint8Array(r.length);
    case "array":
      return Array.from({
        length: r.length,
      }, () => zero(r.elem, go));
    case "struct": {
      const o: Record<string, unknown> = {
      };
      for (const f of r.fields) o[f.key] = zero(f.type, go);
      return o;
    }
    case "time":
      return {
        ...(go ? GO_ZERO_TIME : EPOCH),
      };
    case "repr":
      return r.zero ? r.zero() : r.fromRepr(zero(r.repr, go));
    default:
      throw new AminoError(`no zero value for ${r.kind}`);
  }
}

/**
 * Go `defaultValue`: what an absent struct field or empty list element decodes
 * to. A `time.Time` (or pointer to one) becomes the epoch, a pointer to a
 * struct stays nil, other pointers point at a zero value, and everything else
 * is the Go zero value.
 */
export function defaultValue(type: AminoType): unknown {
  const r = resolve(type);
  const e = r.kind === "pointer" ? resolve(r.elem) : r;
  if (e.kind === "time") return {
    ...EPOCH,
  };
  if (r.kind === "pointer" && goKind(e) === "struct") return null;
  return goZero(e);
}

/** A zero integer, in any of the forms the encoders accept. */
const isIntZero = (v: unknown) => v === 0 || v === 0n || v === "0";

/**
 * Go `isJSONEmpty` for `omitempty`: the field is nil, deep-equals its Go zero
 * value, or is a zero-length list or string. A missing JS value stands for
 * the value the encoder would write, `zeroValue`.
 */
export function isJSONEmpty(type: AminoType, value: unknown): boolean {
  const r = resolve(type);
  if (value === undefined) value = zeroValue(r);
  if (value === null) return true;
  const d = r.kind === "pointer" ? resolve(r.elem) : r;
  switch (d.kind) {
    case "string":
    case "bytes":
    case "bytearray":
    case "slice":
    case "array":
      if ((value as ArrayLike<unknown>).length === 0) return true;
  }
  // A non-nil pointer never deep-equals the nil pointer zero value.
  if (r.kind === "pointer") return false;
  return isGoZero(r, value);
}

/** Go `reflect.DeepEqual(v, reflect.Zero(T))`. */
function isGoZero(type: AminoType, v: unknown): boolean {
  const r = resolve(type);
  if (v === undefined) v = zeroValue(r);
  switch (r.kind) {
    case "bool":
      return v === false;
    case "string":
      return v === "";
    case "int8":
    case "int16":
    case "int32":
    case "uint8":
    case "uint16":
    case "uint32":
    case "float32":
    case "float64":
    case "int64":
    case "int":
    case "uint64":
    case "uint":
    case "duration":
      return isIntZero(v);
    case "bytes":
    case "slice":
    case "pointer":
    case "interface":
      return v === null;
    case "bytearray":
      return (v as Uint8Array).every(b => b === 0);
    case "array":
      return (v as unknown[]).every(e => isGoZero(r.elem, e));
    case "struct":
      return r.fields.every(f => isGoZero(f.type, (v as Record<string, unknown>)[f.key]));
    case "time": {
      const ts = toTimestamp(v);
      return ts.seconds === GO_ZERO_TIME.seconds && ts.nanos === 0;
    }
    case "repr":
      return !!r.isZero?.(v);
    default:
      return false;
  }
}

/** Name for error messages. */
export function typeName(type: AminoType): string {
  const r = resolve(type);
  switch (r.kind) {
    case "struct":
    case "repr":
      return r.name ?? r.kind;
    case "interface":
      return r.name ?? "interface";
    case "bytearray":
      return `[${r.length}]byte`;
    case "bytes":
      return "[]byte";
    case "slice":
      return `[]${typeName(r.elem)}`;
    case "array":
      return `[${r.length}]${typeName(r.elem)}`;
    case "pointer":
      return `*${typeName(r.elem)}`;
    default:
      return r.kind;
  }
}
