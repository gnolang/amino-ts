/**
 * Amino binary encoder. Each function corresponds to the Go function of the
 * same name in `tm2/pkg/amino/binary_encode.go`; the comments there explain
 * the protobuf-compatibility reasons behind each rule.
 */

import {
  asBytes,
} from "../bytes";
import {
  AminoError,
} from "../errors";
import {
  deref,
  elemIsReprByte,
  goKind,
  isImplicitList,
  isNonstructDefault,
  isStructOrUnpacked,
  isUnpackedList,
  type Resolved,
  typ3Of,
  typeName,
  zeroValue,
} from "../info";
import {
  toBigInt,
  toInt,
} from "../numbers";
import {
  type AminoType,
  type AnyValue,
  type ArrayType,
  type FieldOptions,
  resolve,
  type ResolvedFieldOptions,
  type SliceType,
  type StructType,
  type TypeRegistry,
} from "../types";
import {
  utf8Encode,
} from "../utf8";
import {
  checkTime,
  durationParts,
  toTimestamp,
} from "../wellknown";
import {
  Typ3,
  Writer,
} from "./writer";

type Opts = Partial<ResolvedFieldOptions>;

const NO_OPTS: Opts = Object.freeze({
});

export class BinaryEncoder {
  constructor(private readonly registry: TypeRegistry) {}

  /** Go `Codec.MarshalReflect`: the top-level (unprefixed) encoding. */
  marshal(type: AminoType, value: unknown): Uint8Array {
    let info = resolve(type);
    if (info.kind === "pointer") {
      if (value == null) {
        throw new AminoError("cannot marshal a nil pointer directly; wrap it in a struct");
      }
      info = resolve(info.elem);
    }
    const w = new Writer();
    this.encodeMessage(w, info, value, NO_OPTS);
    return w.bytes().slice();
  }

  /** Go `Codec.MarshalAny`: an `Any` of a registered concrete value. */
  marshalAny(any: AnyValue): Uint8Array {
    const w = new Writer();
    this.encodeInterface(w, any, NO_OPTS, true);
    return w.bytes().slice();
  }

  /**
   * Go `encodeReflectBinary`.
   * CONTRACT: `type` is not a pointer; the caller dereferences.
   * `byteOption` is Go's `beOptionByte`: a byte element of a packed list.
   */
  encode(w: Writer, type: AminoType, value: unknown, fopts: Opts, bare: boolean, byteOption: boolean): void {
    const info = resolve(type);
    switch (info.kind) {
      case "time":
      case "duration":
        this.encodeWellKnown(w, info, value, bare);
        return;
      case "repr":
        this.encode(w, info.repr, info.toRepr(value), fopts, bare, byteOption);
        return;
      case "interface":
        this.encodeInterface(w, value as AnyValue | null, fopts, bare);
        return;
      case "bytearray": {
        const bz = asBytes(value, typeName(info));
        if (bz.length !== info.length) {
          throw new AminoError(`expected ${info.length} bytes for ${typeName(info)}, got ${bz.length}`);
        }
        w.byteSlice(bz);
        return;
      }
      case "bytes":
        w.byteSlice(asBytes(value, typeName(info)));
        return;
      case "slice":
      case "array":
        this.encodeList(w, info, value as unknown[] | null, fopts, bare);
        return;
      case "struct":
        this.encodeStruct(w, info, value as Record<string, unknown>, bare);
        return;
      case "int64":
      case "int": {
        const v = toBigInt(value, info.kind);
        if (fopts.fixed64) w.fixed64(v);
        else if (info.kind === "int" && fopts.fixed32) w.fixed32(Number(BigInt.asIntN(32, v)));
        else if (fopts.varint) w.uvarint64(v);
        else w.varint64(v);
        return;
      }
      case "int32": {
        const v = toInt(value, info.kind);
        if (fopts.fixed32) w.fixed32(v);
        else if (fopts.varint) w.uvarint64(BigInt(v));
        else w.varint(v);
        return;
      }
      case "int16":
      case "int8":
        w.varint(toInt(value, info.kind));
        return;
      case "uint64":
      case "uint": {
        const v = toBigInt(value, info.kind);
        if (fopts.fixed64) w.fixed64(v);
        else if (info.kind === "uint" && fopts.fixed32) w.fixed32(Number(BigInt.asUintN(32, v)));
        else w.uvarint64(v);
        return;
      }
      case "uint32": {
        const v = toInt(value, info.kind);
        if (fopts.fixed32) w.fixed32(v);
        else w.uvarint(v);
        return;
      }
      case "uint16":
        w.uvarint(toInt(value, info.kind));
        return;
      case "uint8": {
        const v = toInt(value, info.kind);
        if (byteOption) w.byte(v);
        else w.uvarint(v);
        return;
      }
      case "bool":
        if (typeof value !== "boolean" && value != null) {
          throw new AminoError(`expected boolean, got ${typeof value}`);
        }
        w.byte(value ? 1 : 0);
        return;
      case "float64":
      case "float32":
        if (!fopts.unsafe) {
          throw new AminoError("amino float* support requires `amino:\"unsafe\"`");
        }
        if (typeof value !== "number" && value != null) {
          throw new AminoError(`expected number, got ${typeof value}`);
        }
        if (info.kind === "float64") w.float64(value ?? 0);
        else w.float32(value ?? 0);
        return;
      case "string":
        if (typeof value !== "string" && value != null) {
          throw new AminoError(`expected string, got ${typeof value}`);
        }
        w.byteSlice(utf8Encode(value ?? ""));
        return;
      case "pointer":
        throw new AminoError("unexpected pointer; nested pointers are not supported");
      default:
        throw new AminoError(`unsupported type ${info.kind}`);
    }
  }

  /**
   * A value as a whole message (top level, or an `Any` value): structs and
   * unpacked lists are written bare, anything else inside an implicit struct
   * as field 1.
   */
  private encodeMessage(w: Writer, info: AminoType, value: unknown, fopts: Opts) {
    if (isStructOrUnpacked(info, fopts)) {
      this.encode(w, info, value, {
        fieldNum: 1,
      }, true, false);
    }
    else {
      this.writeFieldIfNotEmpty(w, 1, info, NO_OPTS, value, false);
    }
  }

  /** Go `encodeReflectBinaryInterface`: a google.protobuf.Any. */
  private encodeInterface(w: Writer, any: AnyValue | null | undefined, fopts: Opts, bare: boolean) {
    if (any == null) {
      writeMaybeBare(w, EMPTY, bare);
      return;
    }
    if (typeof any !== "object" || typeof any.typeUrl !== "string") {
      throw new AminoError("interface values must be { typeUrl, value } objects");
    }
    const cinfo = this.registry.resolveTypeUrl(any.typeUrl).type;
    const cr = resolve(cinfo);
    if (cr.kind === "pointer" || cr.kind === "interface") {
      throw new AminoError(`registered type for ${any.typeUrl} must be concrete`);
    }
    if (any.value === null && goKind(cr) === "struct") {
      throw new AminoError(`illegal nil value of type ${any.typeUrl} for an interface; `
        + "nil-pointer interface values are forbidden");
    }

    const buf = new Writer();
    buf.fieldKey(1, Typ3.ByteLength);
    buf.byteSlice(utf8Encode(any.typeUrl));

    const buf2 = new Writer();
    this.encodeMessage(buf2, cr, any.value, fopts);
    const bz2 = buf2.bytes();
    if (!(bz2.length === 0 || (bz2.length === 1 && bz2[0] === 0))) {
      buf.fieldKey(2, Typ3.ByteLength);
      buf.byteSlice(bz2);
    }
    writeMaybeBare(w, buf.bytes(), bare);
  }

  /** Go `encodeReflectBinaryList`. */
  encodeList(w: Writer, info: SliceType | ArrayType, value: unknown[] | null | undefined, fopts: Opts, bare: boolean) {
    const list = value ?? [];
    if (!Array.isArray(list)) throw new AminoError(`expected array for ${typeName(info)}`);
    if (info.kind === "array" && list.length !== info.length) {
      throw new AminoError(`expected ${info.length} elements for ${typeName(info)}, got ${list.length}`);
    }
    const ert = resolve(info.elem);
    const ertIsPointer = ert.kind === "pointer";
    const einfo = deref(ert);
    const buf = new Writer();

    const byteOption = elemIsReprByte(einfo);
    const typ3 = typ3Of(einfo, fopts);
    if (typ3 !== Typ3.ByteLength || byteOption) {
      // Packed form.
      for (let erv of list) {
        if (ertIsPointer && erv == null) erv = zeroValue(einfo);
        this.encode(buf, einfo, erv, fopts, false, byteOption);
      }
    }
    else {
      // Unpacked form: repeated fields of the enclosing struct.
      const ertIsStruct = goKind(einfo) === "struct";
      const writeImplicit = isImplicitList(einfo, fopts);
      const implicitOpts: Opts = {
        ...fopts,
        fieldNum: 0,
      };
      const elemOpts: Opts = {
        ...fopts,
        fieldNum: 1,
      };
      for (const erv of list) {
        buf.fieldKey(fopts.fieldNum ?? 0, Typ3.ByteLength);
        if (isNonstructDefault(ert, erv)) {
          if (ertIsStruct && ertIsPointer && !fopts.nilElements) {
            throw new AminoError("nil struct pointers in lists not supported unless nil_elements field tag is also set");
          }
          buf.byte(0x00);
        }
        else if (writeImplicit) {
          // Nested packed lists are wrapped in an implicit struct.
          const elemBuf = new Writer();
          elemBuf.fieldKey(1, Typ3.ByteLength);
          this.encode(elemBuf, einfo, erv, implicitOpts, false, false);
          buf.byteSlice(elemBuf.bytes());
        }
        else {
          this.encode(buf, einfo, erv, elemOpts, false, false);
        }
      }
    }
    writeMaybeBare(w, buf.bytes(), bare);
  }

  /** Go `encodeReflectBinaryStruct`. */
  private encodeStruct(w: Writer, info: StructType, value: Record<string, unknown> | null | undefined, bare: boolean) {
    if (value != null && typeof value !== "object") {
      throw new AminoError(`expected object for struct ${typeName(info)}`);
    }
    const buf = new Writer();
    for (const field of info.fields) {
      const frv = value?.[field.key];
      const ft = resolve(field.type);
      const frvIsPtr = ft.kind === "pointer";
      if (!field.options.writeEmpty && isNonstructDefault(ft, frv)) {
        continue;
      }
      const finfo = frvIsPtr ? resolve(ft.elem) : ft;
      if (isUnpackedList(field)) {
        this.encodeUnpackedField(buf, finfo, frv, field.options);
      }
      else {
        const writeEmpty = !!field.options.writeEmpty || frvIsPtr;
        this.writeFieldIfNotEmpty(buf, field.options.fieldNum, finfo, field.options, frv, writeEmpty);
      }
    }
    writeMaybeBare(w, buf.bytes(), bare);
  }

  /** Go: `encodeReflectBinaryList(..., bare=true)` for an unpacked list field. */
  private encodeUnpackedField(w: Writer, finfo: Resolved, value: unknown, fopts: Opts) {
    if (finfo.kind === "repr") {
      // go-amino panics here ("reflect: Elem of invalid type"); refuse rather
      // than produce bytes Go cannot produce.
      throw new AminoError(`cannot encode field of type ${typeName(finfo)}: go-amino does not support `
        + "struct fields whose repr type is a list of length-prefixed elements");
    }
    this.encodeList(w, finfo as SliceType | ArrayType, value as unknown[] | null, fopts, true);
  }

  /** Go `writeFieldIfNotEmpty`. */
  private writeFieldIfNotEmpty(w: Writer, fieldNum: number, finfo: AminoType, fopts: FieldOptions, value: unknown, writeEmpty: boolean) {
    const lBeforeKey = w.length;
    w.fieldKey(fieldNum, typ3Of(finfo, fopts));
    const lBeforeValue = w.length;
    this.encode(w, finfo, value, fopts, false, false);
    if (!writeEmpty && w.length === lBeforeValue + 1 && w.lastByte() === 0x00) {
      // An empty value: roll back the key and the value.
      w.truncate(lBeforeKey);
    }
  }

  /** Go `encodeReflectBinaryWellKnown` for time.Time and time.Duration. */
  private encodeWellKnown(w: Writer, info: Resolved & {
    kind: "time" | "duration"
  }, value: unknown, bare: boolean) {
    let s: bigint;
    let ns: number;
    if (info.kind === "time") {
      ({
        seconds: s, nanos: ns,
      } = toTimestamp(value));
      checkTime(s, ns);
    }
    else {
      [s, ns] = durationParts(toBigInt(value ?? 0n, "duration"));
    }
    const buf = bare ? w : new Writer(16);
    if (s !== 0n) {
      buf.fieldKey(1, Typ3.Varint);
      buf.uvarint64(s);
    }
    if (ns !== 0) {
      buf.fieldKey(2, Typ3.Varint);
      buf.uvarint64(BigInt(ns));
    }
    if (!bare) w.byteSlice(buf.bytes());
  }
}

const EMPTY = new Uint8Array(0);

/** Go `writeMaybeBare`. */
function writeMaybeBare(w: Writer, bz: Uint8Array, bare: boolean) {
  if (bare) w.raw(bz);
  else w.byteSlice(bz);
}
