/**
 * Amino binary decoder. Each function corresponds to the Go function of the
 * same name in `tm2/pkg/amino/binary_decode.go`, and rejects the same inputs.
 */

import {
  toHex,
} from "../bytes";
import {
  AminoError,
  wrap,
} from "../errors";
import {
  defaultValue,
  deref,
  elemIsReprByte,
  goKind,
  goZero,
  isImplicitList,
  isStructOrUnpacked,
  isUnpackedList,
  type Resolved,
  typ3Of,
  typeName,
  zeroValue,
} from "../info";
import {
  inRange,
} from "../numbers";
import {
  type AminoType,
  type AnyValue,
  type ArrayType,
  type FieldOptions,
  type InterfaceType,
  resolve,
  type ResolvedFieldOptions,
  type SliceType,
  type StructType,
  type TypeRegistry,
} from "../types";
import {
  utf8Decode,
} from "../utf8";
import {
  checkTime,
  durationFromParts,
  type Timestamp,
} from "../wellknown";
import {
  decodeBool,
  decodeByte,
  decodeByteSlice,
  decodeByteSliceView,
  type Decoded,
  decodeFieldKey,
  decodeFixed32,
  decodeFixed64,
  decodeFloat32,
  decodeFloat64,
  decodePlainVarint64,
  decodeUvarint64,
  decodeVarint64,
} from "./reader";
import {
  Typ3,
  typ3Name,
} from "./writer";

/** Maximum nesting of interface values, as in Go (`maxAnyDepth`). */
export const MAX_ANY_DEPTH = 64;

export interface DecodeOptions {
  /** Throw on strings that are not valid UTF-8 instead of substituting U+FFFD. */
  strictUtf8?: boolean
  /**
   * Which go-amino decoder to match where the two disagree. `"generated"`
   * (the default) is the pb3_gen code every tm2 and gno.land type uses, so
   * it is what nodes run. `"reflect"` is the reflection decoder Go falls back
   * to for types without generated code. They differ on two malformed inputs:
   * reflect reads a `[]byte` cut off right after its field key as empty, and
   * decodes empty top-level input for a MarshalAmino type to its zero value
   * without calling UnmarshalAmino.
   */
  goDecoder?: "generated" | "reflect"
}

type Opts = Partial<ResolvedFieldOptions>;

const NO_OPTS: Opts = Object.freeze({
});

export class BinaryDecoder {
  constructor(private readonly registry: TypeRegistry, private readonly options: DecodeOptions = {
  }) {}

  /** Go `Codec.UnmarshalReflect`. */
  unmarshal(type: AminoType, bz: Uint8Array): unknown {
    const info = deref(type);
    const topIsStruct = isStructOrUnpacked(info, NO_OPTS);
    if (bz.length === 0 && !topIsStruct && info.kind !== "interface") {
      // The generated decoders still run UnmarshalAmino on the empty repr.
      if (info.kind === "repr" && this.options.goDecoder !== "reflect") {
        return info.fromRepr(zeroValue(info.repr) as never);
      }
      return defaultValue(info);
    }
    let bare = true;
    let nWrap = 0;
    if (!topIsStruct && bz.length > 0 && info.kind !== "interface") {
      nWrap = readImplicitKey(bz, info);
      bz = bz.subarray(nWrap);
      bare = false;
    }
    let value: unknown;
    let n: number;
    try {
      [value, n] = this.decode(bz, info, {
        fieldNum: 1,
      }, bare, false, 0);
    }
    catch (e) {
      throw wrap(e, `unmarshal to ${typeName(info)} failed`);
    }
    if (n !== bz.length) {
      throw new AminoError(`unmarshal to ${typeName(info)}: trailing bytes after top-level unmarshal. Expected to read ${bz.length + nWrap}, only read ${n + nWrap}`);
    }
    return value;
  }

  /** Go `Codec.UnmarshalAny`: decodes a bare `Any`. */
  unmarshalAny(bz: Uint8Array): AnyValue | null {
    const [value] = this.decodeInterface(bz, NO_OPTS, true, 0);
    return value;
  }

  /**
   * Go `decodeReflectBinary`. A pointer type always decodes to a value
   * (never `null`), as Go constructs the pointee.
   */
  decode(bz: Uint8Array, type: AminoType, fopts: Opts, bare: boolean, byteOption: boolean, anyDepth: number): Decoded<unknown> {
    const info = deref(type);
    switch (info.kind) {
      case "time":
      case "duration":
        return this.decodeWellKnown(bz, info, bare);
      case "repr": {
        const [r, n] = this.decode(bz, info.repr, fopts, bare, byteOption, anyDepth);
        try {
          return [info.fromRepr(r as never), n];
        }
        catch (e) {
          throw wrap(e, `${typeName(info)}.fromRepr`);
        }
      }
      case "interface":
        return this.decodeInterface(bz, fopts, bare, anyDepth + 1, info);
      case "bytearray": {
        if (bz.length < info.length) throw new AminoError(`insufficient bytes to decode [${info.length}]byte`);
        const [bs, n] = decodeByteSlice(bz);
        if (bs.length !== info.length) {
          throw new AminoError(`mismatched byte array length: Expected ${info.length}, got ${bs.length}`);
        }
        return [bs, n];
      }
      case "bytes": {
        if (bz.length === 0 && this.options.goDecoder === "reflect") return [null, 0];
        const [bs, n] = decodeByteSlice(bz);
        return [bs.length === 0 ? null : bs, n];
      }
      case "array":
        return this.decodeArray(bz, info, fopts, bare, anyDepth);
      case "slice":
        return this.decodeSlice(bz, info, fopts, bare, anyDepth);
      case "struct":
        return this.decodeStruct(bz, info, bare, anyDepth);
      case "int64":
      case "int": {
        if (fopts.fixed64) return signed64(decodeFixed64(bz));
        if (info.kind === "int" && fopts.fixed32) return [BigInt(decodeFixed32(bz)[0] | 0), 4];
        if (fopts.varint) return decodePlainVarint64(bz);
        return decodeVarint64(bz);
      }
      case "int32": {
        if (fopts.fixed32) return [decodeFixed32(bz)[0] | 0, 4];
        if (fopts.varint) {
          const [v, n] = decodePlainVarint64(bz);
          if (!inRange(v, "int32")) throw new AminoError("plain varint int32 overflow");
          return [Number(v), n];
        }
        // NOTE: Go decodes a zigzag int32 as int64 and truncates it.
        const [v, n] = decodeVarint64(bz);
        return [Number(BigInt.asIntN(32, v)), n];
      }
      case "int16":
      case "int8": {
        const [v, n] = decodeVarint64(bz);
        if (!inRange(v, info.kind)) throw new AminoError(`EOF decoding ${info.kind}`);
        return [Number(v), n];
      }
      case "uint64":
      case "uint": {
        if (fopts.fixed64) return decodeFixed64(bz);
        if (info.kind === "uint" && fopts.fixed32) {
          const [v, n] = decodeFixed32(bz);
          return [BigInt(v), n];
        }
        return decodeUvarint64(bz);
      }
      case "uint32": {
        if (fopts.fixed32) return decodeFixed32(bz);
        // NOTE: Go decodes a uint32 varint as uint64 and truncates it.
        const [v, n] = decodeUvarint64(bz);
        return [Number(BigInt.asUintN(32, v)), n];
      }
      case "uint16":
      case "uint8": {
        if (info.kind === "uint8" && byteOption) return decodeByte(bz);
        const [v, n] = decodeUvarint64(bz);
        if (!inRange(v, info.kind)) throw new AminoError(`EOF decoding ${info.kind}`);
        return [Number(v), n];
      }
      case "bool":
        return decodeBool(bz);
      case "float64":
      case "float32":
        if (!fopts.unsafe) throw new AminoError("float support requires `amino:\"unsafe\"`");
        return info.kind === "float64" ? decodeFloat64(bz) : decodeFloat32(bz);
      case "string": {
        const [bs, n] = decodeByteSliceView(bz);
        return [utf8Decode(bs, this.options.strictUtf8), n];
      }
      default:
        throw new AminoError(`unknown field type ${info.kind}`);
    }
  }

  /** Go `decodeReflectBinaryInterface`. */
  private decodeInterface(bz: Uint8Array, fopts: Opts, bare: boolean, anyDepth: number, iface?: InterfaceType): Decoded<AnyValue | null> {
    if (anyDepth > MAX_ANY_DEPTH) throw new AminoError(`exceeded max Any nesting depth ${MAX_ANY_DEPTH}`);
    let n: number;
    [bz, n] = decodeMaybeBare(bz, bare);
    if (bz.length === 0) return [null, n];

    let [fnum, typ, _n] = decodeFieldKey(bz);
    bz = bz.subarray(_n);
    n += _n;
    if (fnum !== 1 || typ !== Typ3.ByteLength) {
      throw new AminoError(`expected Any field number 1 TypeURL, got num ${fnum} typ ${typ3Name(typ)}`);
    }
    const [urlBytes, _n2] = decodeByteSliceView(bz);
    bz = bz.subarray(_n2);
    n += _n2;

    let value: Uint8Array | undefined;
    if (bz.length > 0) {
      [fnum, typ, _n] = decodeFieldKey(bz);
      bz = bz.subarray(_n);
      n += _n;
      if (fnum !== 2 || typ !== Typ3.ByteLength) {
        throw new AminoError(`expected Any field number 2 Value, got num ${fnum} typ ${typ3Name(typ)}`);
      }
      const [v, _n3] = decodeByteSliceView(bz);
      if (_n3 !== bz.length) throw new AminoError("bytes left over after reading Any.");
      value = v;
      n += _n3;
    }
    for (const b of urlBytes) {
      if (b < 32 || b > 126) throw new AminoError(`invalid type_url string bytes ${toHex(urlBytes).toUpperCase()}`);
    }
    if (urlBytes.length === 0) throw new AminoError("invalid type_url: empty");
    const resolved = this.registry.resolveTypeUrl(String.fromCharCode(...urlBytes));
    if (iface) this.registry.assertImplements(iface, resolved.typeUrl);
    return [
      {
        typeUrl: resolved.typeUrl,
        value: this.decodeAny(resolved.type, value ?? new Uint8Array(0), fopts, anyDepth),
      },
      n,
    ];
  }

  /** Go `decodeReflectBinaryAny`. */
  private decodeAny(cinfo: AminoType, value: Uint8Array, fopts: Opts, anyDepth: number): unknown {
    const cr = resolve(cinfo);
    if (value.length === 0) return goZero(cr); // Go allocates a fresh value

    const efopts: Opts = {
      ...fopts,
      fieldNum: 1,
    };
    let bareValue = true;
    if (!isStructOrUnpacked(cr, efopts)) {
      value = value.subarray(readImplicitKey(value, cr));
      bareValue = false;
    }
    const [v, n] = this.decode(value, cr, efopts, bareValue, false, anyDepth);
    if (n !== value.length) throw new AminoError("bytes left over after reading Any.Value.");
    return v;
  }

  /** Go `decodeReflectBinaryArray`. */
  private decodeArray(bz: Uint8Array, info: ArrayType, fopts: Opts, bare: boolean, anyDepth: number): Decoded<unknown[]> {
    const einfo = deref(info.elem);
    let n: number;
    [bz, n] = decodeMaybeBare(bz, bare);
    const out: unknown[] = [];
    // NOTE: Go's array decoder only treats *uint8 elements as raw bytes, while
    // its encoder does so for any element whose repr is a byte. Arrays of
    // non-pointer byte-repr types therefore don't round-trip in Go either.
    const byteOption = resolve(info.elem).kind === "pointer" && einfo.kind === "uint8";
    const typ3 = typ3Of(einfo, fopts);
    if (typ3 !== Typ3.ByteLength || byteOption) {
      for (let i = 0; i < info.length; i++) {
        const [v, _n] = this.decodeElem(bz, einfo, fopts, byteOption, anyDepth, "array");
        bz = bz.subarray(_n);
        n += _n;
        out.push(v);
      }
      if (bz.length > 0) throw new AminoError("bytes left over after reading array contents");
    }
    else {
      const isErtStructPointer = resolve(info.elem).kind === "pointer" && goKind(einfo) === "struct";
      const writeImplicit = isImplicitList(einfo, fopts);
      const lopts = listOpts(fopts);
      for (let i = 0; i < info.length; i++) {
        const [fnum, typ, _n] = decodeFieldKey(bz);
        bz = bz.subarray(_n);
        n += _n;
        if (fnum !== fopts.fieldNum) throw new AminoError(`expected repeated field number ${fopts.fieldNum}, got ${fnum}`);
        if (typ !== Typ3.ByteLength) throw new AminoError(`expected repeated field type ByteLength, got ${typ3Name(typ)}`);
        const [v, _n2] = this.decodeUnpackedElem(bz, info.elem, einfo, lopts, isErtStructPointer, writeImplicit, anyDepth, "array");
        bz = bz.subarray(_n2);
        n += _n2;
        out.push(v);
      }
      if (bz.length > 0) {
        const [fnum] = decodeFieldKey(bz);
        if (fnum <= (fopts.fieldNum ?? 0)) {
          throw new AminoError(`unexpected field number ${fnum} after repeated field number ${fopts.fieldNum}`);
        }
      }
    }
    return [out, n];
  }

  /** Go `decodeReflectBinarySlice`. */
  private decodeSlice(bz: Uint8Array, info: SliceType, fopts: Opts, bare: boolean, anyDepth: number): Decoded<unknown[] | null> {
    const einfo = deref(info.elem);
    let n: number;
    [bz, n] = decodeMaybeBare(bz, bare);
    const out: unknown[] = [];
    const byteOption = elemIsReprByte(einfo);
    const typ3 = typ3Of(einfo, fopts);
    if (typ3 !== Typ3.ByteLength || byteOption) {
      while (bz.length !== 0) {
        const [v, _n] = this.decodeElem(bz, einfo, fopts, byteOption, anyDepth, "array");
        bz = bz.subarray(_n);
        n += _n;
        out.push(v);
      }
    }
    else {
      const isErtStructPointer = resolve(info.elem).kind === "pointer" && goKind(einfo) === "struct";
      const writeImplicit = isImplicitList(einfo, fopts);
      const lopts = listOpts(fopts);
      const fieldNum = fopts.fieldNum ?? 0;
      while (bz.length !== 0) {
        const [fnum, typ, _n] = decodeFieldKey(bz);
        if (fnum > fieldNum) break;
        bz = bz.subarray(_n);
        n += _n;
        if (fnum < fieldNum) throw new AminoError(`expected repeated field number ${fieldNum} or greater, got ${fnum}`);
        if (typ !== Typ3.ByteLength) throw new AminoError(`expected repeated field type ByteLength, got ${typ3Name(typ)}`);
        const [v, _n2] = this.decodeUnpackedElem(bz, info.elem, einfo, lopts, isErtStructPointer, writeImplicit, anyDepth, "slice");
        bz = bz.subarray(_n2);
        n += _n2;
        out.push(v);
      }
    }
    return [out.length === 0 ? null : out, n];
  }

  private decodeElem(bz: Uint8Array, einfo: Resolved, fopts: Opts, byteOption: boolean, anyDepth: number, what: string): Decoded<unknown> {
    try {
      return this.decode(bz, einfo, fopts, false, byteOption, anyDepth);
    }
    catch (e) {
      throw wrap(e, `error reading ${what} contents`);
    }
  }

  /** One ByteLength element of an unpacked list (the shared loop body of the Go array/slice decoders). */
  private decodeUnpackedElem(
    bz: Uint8Array, ert: AminoType, einfo: Resolved, lopts: ListOpts,
    isErtStructPointer: boolean, writeImplicit: boolean, anyDepth: number, what: string,
  ): Decoded<unknown> {
    if (bz.length > 0 && bz[0] === 0x00 && (!isErtStructPointer || lopts.elem.nilElements)) {
      // With nil_elements Go stores reflect.Zero (nil for pointers);
      // without, it stores defaultValue.
      return [lopts.elem.nilElements ? goZero(ert) : defaultValue(ert), 1];
    }
    if (writeImplicit) {
      const [implicit, n] = decodeByteSliceView(bz);
      let ibz = implicit;
      const [fnum, ityp, _n] = decodeFieldKey(ibz);
      ibz = ibz.subarray(_n);
      if (fnum !== 1) throw new AminoError(`unexpected field number ${fnum} of implicit list struct`);
      if (ityp !== Typ3.ByteLength) {
        throw new AminoError(`unexpected typ3 ${typ3Name(ityp)} of implicit list struct field 1 (want ByteLength)`);
      }
      const [v, _n2] = this.decodeElem(ibz, einfo, lopts.implicit, false, anyDepth, what);
      if (_n2 !== ibz.length) {
        throw new AminoError(`unexpected trailing bytes after implicit list struct's Value field: ${toHex(ibz.subarray(_n2)).toUpperCase()}`);
      }
      return [v, n];
    }
    return this.decodeElem(bz, einfo, lopts.elem, false, anyDepth, what);
  }

  /** Go `decodeReflectBinaryStruct`. */
  private decodeStruct(bz: Uint8Array, info: StructType, bare: boolean, anyDepth: number): Decoded<Record<string, unknown>> {
    let n: number;
    [bz, n] = decodeMaybeBare(bz, bare);
    const out: Record<string, unknown> = {
    };
    let lastFieldNum = 0;
    for (const field of info.fields) {
      const ftype = field.type;
      const fnumWant = field.options.fieldNum;
      if (bz.length === 0) {
        out[field.key] = defaultValue(ftype);
        continue;
      }
      if (isUnpackedList(field)) {
        const [fnum] = decodeFieldKey(bz);
        if (fnumWant < fnum) {
          out[field.key] = defaultValue(ftype);
          continue;
        }
        const [v, _n] = this.decodeUnpackedField(bz, ftype, field.options, anyDepth);
        bz = bz.subarray(_n);
        n += _n;
        out[field.key] = v;
        continue;
      }
      let [fnum, typ, _n] = decodeFieldKey(bz);
      if (fnumWant < fnum) {
        out[field.key] = defaultValue(ftype);
        continue;
      }
      // Skip wire fields of removed (reserved) fields that precede this one.
      let exhausted = false;
      while (fnum < fnumWant) {
        bz = bz.subarray(_n);
        n += _n;
        if (fnum <= lastFieldNum) {
          throw new AminoError(`encountered fieldNum: ${fnum}, but we have already seen fnum: ${lastFieldNum}`);
        }
        lastFieldNum = fnum;
        const skipped = consumeAny(typ, bz);
        bz = bz.subarray(skipped);
        n += skipped;
        if (bz.length === 0) {
          exhausted = true;
          break;
        }
        [fnum, typ, _n] = decodeFieldKey(bz);
      }
      if (exhausted || fnum !== fnumWant) {
        out[field.key] = defaultValue(ftype);
        continue;
      }
      bz = bz.subarray(_n);
      n += _n;
      if (fnum <= lastFieldNum) {
        throw new AminoError(`encountered fieldNum: ${fnum}, but we have already seen fnum: ${lastFieldNum}`);
      }
      lastFieldNum = fnum;
      const want = typ3Of(ftype, field.options);
      if (typ !== want) {
        throw new AminoError(`expected field type ${typ3Name(want)} for # ${fnum} of ${typeName(info)}, got ${typ3Name(typ)}`);
      }
      const [v, _n2] = this.decode(bz, ftype, field.options, false, false, anyDepth);
      bz = bz.subarray(_n2);
      n += _n2;
      out[field.key] = v;
    }
    if (bz.length > 0) {
      const [fnum] = decodeFieldKey(bz);
      throw new AminoError(`unknown field number ${fnum} for ${typeName(info)}`);
    }
    return [out, n];
  }

  /** An unpacked list field, possibly behind a repr (Go: `decodeReflectBinary(..., bare=true)`). */
  private decodeUnpackedField(bz: Uint8Array, ftype: AminoType, fopts: FieldOptions, anyDepth: number): Decoded<unknown> {
    const info = deref(ftype);
    if (info.kind === "repr") {
      const [r, n] = this.decodeUnpackedField(bz, info.repr, fopts, anyDepth);
      return [info.fromRepr(r as never), n];
    }
    return this.decode(bz, info, fopts, true, false, anyDepth);
  }

  /** Go `decodeReflectBinaryWellKnown` (`DecodeTime` / `DecodeDuration`). */
  private decodeWellKnown(bz: Uint8Array, info: Resolved & {
    kind: "time" | "duration"
  }, bare: boolean): Decoded<Timestamp | bigint> {
    let n: number;
    [bz, n] = decodeMaybeBare(bz, bare);
    let s = 0n;
    let ns = 0;
    let sawSec = false;
    let sawNs = false;
    let pos = 0;
    while (pos < bz.length) {
      const [fnum, typ, hdr] = decodeFieldKey(bz.subarray(pos));
      if (fnum === 1 && typ === Typ3.Varint) {
        if (sawSec) throw new AminoError("duplicate field 1 (seconds)");
        if (sawNs) throw new AminoError("seconds (field 1) after nanos (field 2): out of order");
        const [v, vn] = decodeUvarint64(bz.subarray(pos + hdr));
        pos += hdr + vn;
        s = BigInt.asIntN(64, v);
        sawSec = true;
      }
      else if (fnum === 2 && typ === Typ3.Varint) {
        if (sawNs) throw new AminoError("duplicate field 2 (nanos)");
        const [v, vn] = decodeUvarint64(bz.subarray(pos + hdr));
        pos += hdr + vn;
        const nv = BigInt.asIntN(64, v);
        if (nv >= 1000000000n || nv <= -1000000000n) {
          throw new AminoError(`invalid time: nanoseconds not in interval [-999999999, 999999999] ${nv}`);
        }
        ns = Number(nv);
        sawNs = true;
      }
      else {
        throw new AminoError(`unexpected field in Timestamp/Duration: num=${fnum} typ=${typ3Name(typ)}`);
      }
    }
    n += pos;
    if (info.kind === "time") {
      checkTime(s, ns);
      return [
        {
          seconds: s,
          nanos: ns,
        },
        n,
      ];
    }
    return [durationFromParts(s, ns), n];
  }
}

/** Options for the elements of an unpacked list, built once per list. */
interface ListOpts {
  elem: Opts
  implicit: Opts
}

function listOpts(fopts: Opts): ListOpts {
  return {
    elem: {
      ...fopts,
      fieldNum: 1,
    },
    implicit: {
      ...fopts,
      fieldNum: 0,
    },
  };
}

/** Reads and checks the field-1 key of an implicit struct; returns its size. */
function readImplicitKey(bz: Uint8Array, info: AminoType): number {
  const [fnum, typ, n] = decodeFieldKey(bz);
  if (fnum !== 1) throw new AminoError(`expected field number: 1; got: ${fnum}`);
  const want = typ3Of(info, NO_OPTS);
  if (typ !== want) {
    throw new AminoError(`expected field type ${typ3Name(want)} for # 1 of ${typeName(info)}, got ${typ3Name(typ)}`);
  }
  return n;
}

function signed64([v, n]: Decoded<bigint>): Decoded<bigint> {
  return [BigInt.asIntN(64, v), n];
}

/** Go `decodeMaybeBare`: strips the length prefix unless bare. */
function decodeMaybeBare(bz: Uint8Array, bare: boolean): [Uint8Array, number] {
  if (bare) return [bz, 0];
  const [buf, n] = decodeByteSliceView(bz);
  return [buf, n - buf.length];
}

/** Go `consumeAny`: skips one field value. */
function consumeAny(typ: number, bz: Uint8Array): number {
  switch (typ) {
    case Typ3.Varint:
      return decodeUvarint64(bz)[1];
    case Typ3.Byte8:
      return decodeFixed64(bz)[1];
    case Typ3.ByteLength:
      return decodeByteSliceView(bz)[1];
    case Typ3.Byte4:
      return decodeFixed32(bz)[1];
    default:
      throw new AminoError(`invalid typ3 bytes ${typ}`);
  }
}
