/**
 * Amino JSON encoder, after `tm2/pkg/amino/json_encode.go`. Output is
 * byte-identical to Go's (field order is declaration order; use `sortJSON`
 * for sign bytes).
 */

import {
  asBytes,
  toBase64,
} from "../bytes";
import {
  AminoError,
} from "../errors";
import {
  deref,
  goKind,
  isJSONEmpty,
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
  type InterfaceType,
  resolve,
  type SliceType,
  type StructType,
  type TypeRegistry,
} from "../types";
import {
  formatDuration,
  formatTime,
  toTimestamp,
} from "../wellknown";
import {
  formatFloat,
  quote,
} from "./gojson";

export class JsonEncoder {
  constructor(private readonly registry: TypeRegistry) {}

  /** Go `encodeReflectJSON`. */
  encode(type: AminoType, value: unknown, fopts: FieldOptions = {
  }): string {
    let info = resolve(type);
    if (info.kind === "pointer") {
      if (value == null) return "null";
      info = resolve(info.elem);
    }
    switch (info.kind) {
      case "time":
        return quote(formatTime(toTimestamp(value)));
      case "duration":
        return quote(formatDuration(toBigInt(value ?? 0n, "duration")));
      case "repr":
        return this.encode(info.repr, info.toRepr(value), fopts);
      case "interface":
        return this.encodeInterface(value as AnyValue | null, fopts, info);
      case "bytes":
        if (value == null) return "null";
        return quote(toBase64(asBytes(value, typeName(info))));
      case "bytearray": {
        const bz = asBytes(value ?? new Uint8Array(info.length), typeName(info));
        if (bz.length !== info.length) {
          throw new AminoError(`expected ${info.length} bytes for ${typeName(info)}, got ${bz.length}`);
        }
        return quote(toBase64(bz));
      }
      case "slice":
      case "array":
        return this.encodeList(info, value as unknown[] | null, fopts);
      case "struct":
        return this.encodeStruct(info, value as Record<string, unknown> | null);
      case "int64":
      case "int":
      case "uint64":
      case "uint":
        return `"${toBigInt(value, info.kind)}"`;
      case "int32":
      case "int16":
      case "int8":
      case "uint32":
      case "uint16":
      case "uint8":
        return String(toInt(value, info.kind));
      case "float64":
      case "float32":
        if (!fopts.unsafe) throw new AminoError("amino.JSON float* support requires `amino:\"unsafe\"`");
        if (typeof value !== "number" && value != null) throw new AminoError(`expected number, got ${typeof value}`);
        return formatFloat(value ?? 0, info.kind === "float64" ? 64 : 32);
      case "bool":
        if (typeof value !== "boolean" && value != null) throw new AminoError(`expected boolean, got ${typeof value}`);
        return value ? "true" : "false";
      case "string":
        if (typeof value !== "string" && value != null) throw new AminoError(`expected string, got ${typeof value}`);
        return quote(value ?? "");
      default:
        throw new AminoError(`unsupported type ${info.kind}`);
    }
  }

  /** Go `encodeReflectJSONInterface`. */
  encodeInterface(any: AnyValue | null | undefined, fopts: FieldOptions, iface?: InterfaceType): string {
    if (any == null) return "null";
    if (typeof any !== "object" || typeof any.typeUrl !== "string") {
      throw new AminoError("interface values must be { typeUrl, value } objects");
    }
    const resolved = this.registry.resolveTypeUrl(any.typeUrl);
    if (iface) this.registry.assertImplements(iface, resolved.typeUrl);
    const cinfo = resolve(resolved.type);
    if (any.value === null && goKind(cinfo) === "struct") {
      throw new AminoError(`illegal nil value of type ${any.typeUrl} for an interface; `
        + "nil-pointer interface values are forbidden");
    }
    const body = this.encode(cinfo, any.value, fopts);
    const prefix = `{"@type":${quote(any.typeUrl)}`;
    if (isJSONAnyValueType(cinfo)) {
      if (body.startsWith("{")) throw new AminoError("unexpected JSON object");
      return `${prefix},"value":${body}}`;
    }
    if (!body.startsWith("{") || !body.endsWith("}")) throw new AminoError("expected JSON object");
    const inner = body.slice(1);
    return inner === "}" ? `${prefix}}` : `${prefix},${inner}`;
  }

  private encodeList(info: SliceType | ArrayType, value: unknown[] | null | undefined, fopts: FieldOptions): string {
    if (value == null) {
      if (info.kind === "slice") return "null";
      value = zeroValue(info) as unknown[];
    }
    if (!Array.isArray(value)) throw new AminoError(`expected array for ${typeName(info)}`);
    if (info.kind === "array" && value.length !== info.length) {
      throw new AminoError(`expected ${info.length} elements for ${typeName(info)}, got ${value.length}`);
    }
    const parts = value.map(e => this.encode(info.elem, e, fopts));
    return `[${parts.join(",")}]`;
  }

  private encodeStruct(info: StructType, value: Record<string, unknown> | null | undefined): string {
    if (value != null && typeof value !== "object") throw new AminoError(`expected object for struct ${typeName(info)}`);
    const parts: string[] = [];
    for (const field of info.fields) {
      const frv = value?.[field.key];
      if (field.options.omitEmpty && isJSONEmpty(field.type, frv)) continue;
      parts.push(`${quote(field.options.json ?? field.key)}:${this.encode(field.type, frv, field.options)}`);
    }
    return `{${parts.join(",")}}`;
  }
}

/**
 * Go `isJSONAnyValueType`: concrete types whose interface JSON is
 * `{"@type":...,"value":...}` rather than the object with `@type` inlined.
 */
export function isJSONAnyValueType(type: AminoType): boolean {
  const r = deref(type);
  if (r.kind === "repr") {
    return r.goKind !== "struct" || isJSONAnyValueType(r.repr);
  }
  return r.kind !== "struct" && r.kind !== "interface";
}
