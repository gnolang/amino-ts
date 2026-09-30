/**
 * Amino JSON decoder, after `tm2/pkg/amino/json_decode.go`. It is as strict
 * as Go's: unknown and duplicate keys are rejected, 64-bit integers must be
 * quoted, and `null` decodes to amino's default value for the type.
 */

import {
  MAX_ANY_DEPTH,
} from "../binary/decode";
import {
  fromBase64,
} from "../bytes";
import {
  AminoError,
  wrap,
} from "../errors";
import {
  defaultValue,
  goZero,
  typeName,
} from "../info";
import {
  inRange,
  INT_RE,
} from "../numbers";
import {
  type AminoType,
  type AnyValue,
  type FieldOptions,
  resolve,
  type StructType,
  type TypeRegistry,
} from "../types";
import {
  parseDuration,
  parseTime,
} from "../wellknown";
import {
  isJSONAnyValueType,
} from "./encode";
import {
  type JsonNode,
  objectMap,
  parseJson,
} from "./gojson";

const NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

export class JsonDecoder {
  constructor(private readonly registry: TypeRegistry) {}

  unmarshal(type: AminoType, json: string): unknown {
    if (json.length === 0) throw new AminoError("cannot decode empty bytes");
    // Go reads structs and interfaces with a streaming json.Decoder that stops
    // at the end of the object, so it ignores anything after it; every other
    // type goes through json.Unmarshal, which rejects trailing data.
    const streamed = isObjectKind(type) && json !== "null";
    return this.decode(parseJson(json, streamed), type, {
    }, 0);
  }

  /** Go `decodeReflectJSON`. */
  decode(node: JsonNode, type: AminoType, fopts: FieldOptions, anyDepth: number): unknown {
    if (node.t === "null") return defaultValue(type);
    let info = resolve(type);
    if (info.kind === "pointer") info = resolve(info.elem);

    switch (info.kind) {
      case "time":
        return parseTime(expectString(node, "time"));
      case "duration":
        return parseDuration(expectString(node, "duration"));
      case "repr": {
        const r = this.decode(node, info.repr, fopts, anyDepth);
        try {
          return info.fromRepr(r as never);
        }
        catch (e) {
          throw wrap(e, `${typeName(info)}.fromRepr`);
        }
      }
      case "interface":
        return this.decodeInterface(node, fopts, anyDepth + 1);
      case "bytearray": {
        const bz = fromBase64(expectString(node, typeName(info)));
        if (bz.length !== info.length) {
          throw new AminoError(`decodeReflectJSONArray: byte-length mismatch, got ${bz.length} want ${info.length}`);
        }
        return bz;
      }
      case "bytes": {
        const bz = fromBase64(expectString(node, "[]byte"));
        return bz.length === 0 ? null : bz;
      }
      case "array": {
        if (node.t !== "arr") throw mismatch(node, typeName(info));
        if (node.items.length !== info.length) {
          throw new AminoError(`decodeReflectJSONArray: length mismatch, got ${node.items.length} want ${info.length}`);
        }
        return node.items.map(item => this.decode(item, info.elem, fopts, anyDepth));
      }
      case "slice": {
        if (node.t !== "arr") throw mismatch(node, typeName(info));
        return node.items.map(item => this.decode(item, info.elem, fopts, anyDepth));
      }
      case "struct":
        return this.decodeStruct(node, info, anyDepth);
      case "int64":
      case "int":
      case "uint64":
      case "uint": {
        if (node.t !== "str" || !node.raw.startsWith("\"") || !node.raw.endsWith("\"")) {
          throw new AminoError(`invalid character -- Amino:JSON int/int64/uint/uint64 expects quoted values for javascript numeric support, got: ${render(node)}`);
        }
        // Go unmarshals the text between the quotes as a JSON number.
        const inner = node.raw.slice(1, -1).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
        // ...so `"null"` is a no-op there, leaving zero.
        if (inner === "null") return 0n;
        return parseInteger(inner, info.kind);
      }
      case "int32":
      case "int16":
      case "int8":
      case "uint32":
      case "uint16":
      case "uint8": {
        if (node.t !== "num") throw mismatch(node, info.kind);
        return Number(parseInteger(node.raw, info.kind));
      }
      case "float64":
      case "float32": {
        if (!fopts.unsafe) throw new AminoError("amino:JSON float* support requires `amino:\"unsafe\"`");
        if (node.t !== "num") throw mismatch(node, info.kind);
        const f = Number(node.raw);
        const v = info.kind === "float32" ? Math.fround(f) : f;
        if (!Number.isFinite(v)) throw new AminoError(`json: cannot unmarshal number ${node.raw} into Go value of type ${info.kind}`);
        return v;
      }
      case "bool":
        if (node.t !== "bool") throw mismatch(node, "bool");
        return node.v;
      case "string":
        return expectString(node, "string");
      default:
        throw new AminoError(`unsupported type ${info.kind}`);
    }
  }

  /** Go `decodeReflectJSONInterface`. */
  private decodeInterface(node: JsonNode, fopts: FieldOptions, anyDepth: number): AnyValue {
    if (anyDepth > MAX_ANY_DEPTH) throw new AminoError(`exceeded max Any nesting depth ${MAX_ANY_DEPTH}`);
    if (node.t !== "obj") throw new AminoError(`cannot parse Any JSON wrapper: expected '{', got ${render(node)}`);
    const m = objectMap(node);
    const typeNode = m.get("@type");
    let typeUrl = "";
    if (typeNode !== undefined && typeNode.t !== "null") {
      typeUrl = expectString(typeNode, "@type");
    }
    if (typeUrl === "") throw new AminoError("JSON encoding of interfaces require non-empty @type field");
    const resolved = this.registry.resolveTypeUrl(typeUrl);
    const cinfo = resolved.type;

    if (isJSONAnyValueType(cinfo)) {
      const value = m.get("value");
      if (value === undefined) throw new AminoError(`missing "value" for ${typeUrl}`);
      return {
        typeUrl: resolved.typeUrl,
        value: this.decode(value, cinfo, fopts, anyDepth),
      };
    }
    // The concrete fields are inlined next to "@type", which must come first.
    const [first, ...rest] = node.entries;
    if (first[0] !== "@type") {
      throw new AminoError("expected JSON object representing Any to start with \"@type\" field");
    }
    const value = this.decode({
      t: "obj",
      entries: rest,
    }, cinfo, fopts, anyDepth);
    return {
      typeUrl: resolved.typeUrl,
      value,
    };
  }

  /** Go `decodeReflectJSONStruct`. */
  private decodeStruct(node: JsonNode, info: StructType, anyDepth: number): Record<string, unknown> {
    if (node.t !== "obj") throw mismatch(node, typeName(info));
    const m = objectMap(node);
    const out: Record<string, unknown> = {
    };
    const known = new Set<string>();
    for (const field of info.fields) {
      const name = field.options.json ?? field.key;
      known.add(name);
      const v = m.get(name);
      if (v === undefined) {
        // Go leaves omitempty fields untouched (the zero value of a fresh
        // struct) and resets the others to their default value.
        out[field.key] = field.options.omitEmpty ? goZero(field.type) : defaultValue(field.type);
        continue;
      }
      out[field.key] = this.decode(v, field.type, field.options, anyDepth);
    }
    for (const key of m.keys()) {
      if (!known.has(key)) throw new AminoError(`unknown JSON field ${JSON.stringify(key)} for type ${typeName(info)}`);
    }
    return out;
  }
}

/** Whether Go decodes the type from a JSON object (struct or interface, possibly behind reprs). */
function isObjectKind(type: AminoType): boolean {
  let r = resolve(type);
  for (;;) {
    if (r.kind === "pointer") r = resolve(r.elem);
    else if (r.kind === "repr") r = resolve(r.repr);
    else break;
  }
  return (r.kind === "struct" || r.kind === "interface");
}

/** Parses an integer literal as Go's `encoding/json` does for an integer type. */
function parseInteger(raw: string, kind: string): bigint {
  if (!INT_RE.test(raw)) {
    if (NUMBER_RE.test(raw)) throw new AminoError(`json: cannot unmarshal number ${raw} into Go value of type ${kind}`);
    throw new AminoError(`invalid ${kind} literal ${JSON.stringify(raw)}`);
  }
  const v = BigInt(raw);
  if (!inRange(v, kind)) throw new AminoError(`json: cannot unmarshal number ${raw} into Go value of type ${kind}`);
  return v;
}

function expectString(node: JsonNode, what: string): string {
  if (node.t !== "str") throw mismatch(node, what);
  return node.v;
}

function render(node: JsonNode): string {
  switch (node.t) {
    case "null": return "null";
    case "bool": return String(node.v);
    case "num": return node.raw;
    case "str": return node.raw;
    case "arr": return "array";
    case "obj": return "object";
  }
}

function mismatch(node: JsonNode, what: string): AminoError {
  const kinds: Record<JsonNode["t"], string> = {
    null: "null",
    bool: "bool",
    num: "number",
    str: "string",
    arr: "array",
    obj: "object",
  };
  return new AminoError(`json: cannot unmarshal ${kinds[node.t]} into Go value of type ${what}`);
}
