import {
  BinaryDecoder,
  type DecodeOptions,
} from "./binary/decode";
import {
  BinaryEncoder,
} from "./binary/encode";
import {
  decodeUvarint,
} from "./binary/reader";
import {
  Writer,
} from "./binary/writer";
import {
  AminoError,
} from "./errors";
import {
  JsonDecoder,
} from "./json/decode";
import {
  JsonEncoder,
} from "./json/encode";
import {
  type AminoType,
  type AnyValue,
  type Infer,
  type InterfaceType,
  resolve,
  t,
} from "./types";
import {
  utf8Decode,
} from "./utf8";

/** Go `typeURLtoFullname`: the part after the last slash. */
function fullnameOf(typeUrl: string): string {
  const i = typeUrl.lastIndexOf("/");
  if (i < 0) {
    throw new AminoError(`invalid type_url ${JSON.stringify(typeUrl)}: must contain at least one slash and be followed by the full name`);
  }
  return typeUrl.slice(i + 1);
}

const GOOGLE_EMPTY = t.struct("google.protobuf.Empty", {
});

export type CodecOptions = DecodeOptions;

/**
 * A registry of concrete types plus the Amino binary and JSON codecs.
 *
 * Every `Codec` starts with the types go-amino registers on its own
 * (`time.Time`, `time.Duration`, the protobuf wrapper types and the small
 * `/amino.*` integers), so that interface values holding them work out of the
 * box. Register your own concrete types with `register` or `registerPackage`
 * before encoding or decoding interface values that hold them.
 */
export class Codec {
  private readonly byFullname = new Map<string, {
    typeUrl: string
    type: AminoType
  }>();

  /** For each interface with declared implementers, their canonical type URLs. */
  private readonly implementers = new Map<InterfaceType, Set<string>>();

  private readonly binEnc: BinaryEncoder;
  private readonly binDec: BinaryDecoder;
  private readonly jsonEnc: JsonEncoder;
  private readonly jsonDec: JsonDecoder;

  constructor(options: CodecOptions = {
  }) {
    this.binEnc = new BinaryEncoder(this);
    this.binDec = new BinaryDecoder(this, options);
    this.jsonEnc = new JsonEncoder(this);
    this.jsonDec = new JsonDecoder(this);

    this.register("/amino.UInt16", t.uint16);
    this.register("/amino.UInt8", t.uint8);
    this.register("/amino.Int16", t.int16);
    this.register("/amino.Int8", t.int8);
    this.register("/google.protobuf.Timestamp", t.time);
    this.register("/google.protobuf.Duration", t.duration);
    this.register("/google.protobuf.Int64Value", t.int64);
    this.register("/google.protobuf.UInt64Value", t.uint64);
    this.register("/google.protobuf.Int32Value", t.int32);
    this.register("/google.protobuf.UInt32Value", t.uint32);
    this.register("/google.protobuf.BoolValue", t.bool);
    this.register("/google.protobuf.StringValue", t.string);
    this.register("/google.protobuf.BytesValue", t.bytes);
    this.register("/google.protobuf.Empty", GOOGLE_EMPTY);
  }

  // ----------------------------------------
  // Registry

  /**
   * Registers a concrete type under its type URL (`/<p3 package>.<Name>`), so
   * interface values can hold it. Registering the same URL twice fails, as in Go.
   *
   * `implements` lists the interfaces the Go type implements. Once an
   * interface has any declared implementer (or `declareInterface` was called
   * on it), it only accepts those, as Go rejects decoding a type that does not
   * implement the target interface. Other interfaces accept any registered type.
   */
  register(typeUrl: string, type: AminoType, implements_: readonly InterfaceType[] = []): this {
    const fullname = fullnameOf(typeUrl);
    if (!fullname.includes(".")) {
      throw new AminoError(`invalid type_url ${JSON.stringify(typeUrl)}, full name must contain dot`);
    }
    const r = resolve(type);
    if (r.kind === "pointer" || r.kind === "interface" || r.kind === "reserved") {
      throw new AminoError(`expected non-interface non-pointer concrete type for ${typeUrl}, got ${r.kind}`);
    }
    const existing = this.byFullname.get(fullname);
    if (existing) {
      throw new AminoError(`fullname <${fullname}> already registered (TypeURL: ${existing.typeUrl})`);
    }
    this.byFullname.set(fullname, {
      typeUrl,
      type,
    });
    for (const iface of implements_) {
      let set = this.implementers.get(iface);
      if (!set) this.implementers.set(iface, set = new Set());
      set.add(typeUrl);
    }
    return this;
  }

  /**
   * Declares that `iface` only holds the types registered as implementing it,
   * even if there are none yet.
   */
  declareInterface(iface: InterfaceType): this {
    if (!this.implementers.has(iface)) this.implementers.set(iface, new Set());
    return this;
  }

  /** Throws when `iface` is declared or has declared implementers, and the type is not one of them. */
  assertImplements(iface: InterfaceType, typeUrl: string): void {
    const set = this.implementers.get(iface);
    if (set && !set.has(typeUrl)) {
      throw new AminoError(`decoded type ${typeUrl} is not assignable to interface ${iface.name ?? "interface"}`);
    }
  }

  /**
   * Registers several types of one package: each key is the Go type name, and
   * the type URL is `/<p3pkg>.<Name>`, as `amino.NewPackage(...).WithTypes(...)` does.
   */
  registerPackage(p3pkg: string, types: Record<string, AminoType>): this {
    for (const [name, type] of Object.entries(types)) {
      this.register(`/${p3pkg}.${name}`, type);
    }
    return this;
  }

  /** The type registered for a type URL (matched on the part after the last slash, as Go does). */
  lookupTypeUrl(typeUrl: string): AminoType {
    return this.resolveTypeUrl(typeUrl).type;
  }

  /**
   * The registered type and its canonical URL. Go matches type URLs on their
   * full name only, so `/any/prefix/pkg.Name` resolves to `/pkg.Name`.
   */
  resolveTypeUrl(typeUrl: string): {
    typeUrl: string
    type: AminoType
  } {
    const entry = this.byFullname.get(fullnameOf(typeUrl));
    if (!entry) throw new AminoError(`amino: unrecognized concrete type full name ${fullnameOf(typeUrl)}`);
    return entry;
  }

  /** Whether a type URL is registered. */
  has(typeUrl: string): boolean {
    try {
      return this.byFullname.has(fullnameOf(typeUrl));
    }
    catch {
      return false;
    }
  }

  // ----------------------------------------
  // Binary

  /** Go `amino.Marshal`. */
  marshal<T extends AminoType>(type: T, value: Infer<T>): Uint8Array {
    return this.binEnc.marshal(type, value as unknown);
  }

  /** Go `amino.Unmarshal`. */
  unmarshal<T extends AminoType>(type: T, bz: Uint8Array): Infer<T> {
    return this.binDec.unmarshal(type, bz) as Infer<T>;
  }

  /** Go `amino.MarshalSized`: `Marshal` with a uvarint length prefix. */
  marshalSized<T extends AminoType>(type: T, value: Infer<T>): Uint8Array {
    return sized(this.marshal(type, value));
  }

  /** Go `amino.UnmarshalSized`. */
  unmarshalSized<T extends AminoType>(type: T, bz: Uint8Array): Infer<T> {
    return this.unmarshal(type, unsized(bz));
  }

  /** Go `amino.MarshalAny`: a `google.protobuf.Any` holding a registered type. */
  marshalAny(any: AnyValue): Uint8Array {
    return this.binEnc.marshalAny(any);
  }

  /** Go `amino.UnmarshalAny`. */
  unmarshalAny(bz: Uint8Array): AnyValue {
    const v = this.binDec.unmarshalAny(bz);
    if (v === null) throw new AminoError("cannot decode an empty Any");
    return v;
  }

  /** Go `amino.MarshalAnySized`. */
  marshalAnySized(any: AnyValue): Uint8Array {
    return sized(this.marshalAny(any));
  }

  /** Go `amino.UnmarshalAnySized`. */
  unmarshalAnySized(bz: Uint8Array): AnyValue {
    return this.unmarshalAny(unsized(bz));
  }

  // ----------------------------------------
  // JSON

  /** Go `amino.MarshalJSON`. */
  marshalJSON<T extends AminoType>(type: T, value: Infer<T>): string {
    return this.jsonEnc.encode(type, value as unknown);
  }

  /** Go `amino.UnmarshalJSON`. Accepts text or UTF-8 bytes. */
  unmarshalJSON<T extends AminoType>(type: T, json: string | Uint8Array): Infer<T> {
    return this.jsonDec.unmarshal(type, typeof json === "string" ? json : utf8Decode(json)) as Infer<T>;
  }

  /** Go `amino.MarshalJSONAny`: `{"@type": ..., ...}`. */
  marshalJSONAny(any: AnyValue): string {
    if (any == null) throw new AminoError("MarshalJSONAny() requires non-nil argument");
    return this.jsonEnc.encodeInterface(any, {
    });
  }

  /** Decodes interface JSON (`{"@type": ..., ...}`) to an `AnyValue`. */
  unmarshalJSONAny(json: string | Uint8Array): AnyValue {
    const v = this.unmarshalJSON(t.interface(), json);
    if (v === null) throw new AminoError("cannot decode a null Any");
    return v;
  }
}

function sized(bz: Uint8Array): Uint8Array {
  const w = new Writer(bz.length + 10);
  w.byteSlice(bz);
  return w.bytes().slice();
}

function unsized(bz: Uint8Array): Uint8Array {
  if (bz.length === 0) throw new AminoError("unmarshalSized cannot decode empty bytes");
  const [len, n] = decodeUvarint(bz);
  if (len > bz.length - n) {
    throw new AminoError(`Not enough bytes to read in UnmarshalSized, want ${len} more bytes but only have ${bz.length - n}`);
  }
  if (len < bz.length - n) {
    throw new AminoError(`Bytes left over in UnmarshalSized, should read ${len} more bytes but have ${bz.length - n}`);
  }
  return bz.subarray(n);
}
