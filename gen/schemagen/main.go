// Command schemagen writes src/gno/types.gen.ts: amino-ts schemas for the
// tm2 and gno.land types listed in gen/gnotypes, derived from go-amino's own
// type information so they cannot drift from the Go declarations.
//
// Usage: go run ./schemagen <output file>
package main

import (
	"fmt"
	"os"
	"reflect"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/gnolang/amino-ts/gen/gnotypes"
	"github.com/gnolang/gno/tm2/pkg/amino"
)

// reprs maps Go types with MarshalAmino to hand-written schemas in src/gno/reprs.ts.
var reprs = map[string]string{
	"github.com/gnolang/gno/tm2/pkg/crypto.Address":       "reprs.Address",
	"github.com/gnolang/gno/tm2/pkg/std.Coin":             "reprs.Coin",
	"github.com/gnolang/gno/tm2/pkg/std.Coins":            "reprs.Coins",
	"github.com/gnolang/gno/tm2/pkg/sdk/params.Param":     "reprs.Param",
	"github.com/gnolang/gno/gno.land/pkg/gnoland.Balance": "reprs.Balance",
}

var (
	timeType     = reflect.TypeOf(time.Time{})
	durationType = reflect.TypeOf(time.Duration(0))
)

type export struct{ name, varName string }

type gen struct {
	nsOfPkg  map[string]string // Go package path -> TS namespace
	vars     map[reflect.Type]string
	emitting map[reflect.Type]bool
	cyclic   map[reflect.Type]bool // referenced from inside their own definition
	decls    []string
	exports  map[string][]export
	regs     []reg
	ifaces   []reflect.Type // named interfaces, in declaration order
}

type reg struct {
	url, varName string
	rt           reflect.Type
	ptr          bool // decoded as a pointer (PointerPreferred)
}

func (g *gen) ns(rt reflect.Type) string {
	if ns, ok := g.nsOfPkg[rt.PkgPath()]; ok {
		return ns
	}
	parts := strings.Split(rt.PkgPath(), "/")
	return parts[len(parts)-1]
}

func (g *gen) declare(rt reflect.Type, expr string) string {
	v := g.ns(rt) + "_" + rt.Name()
	g.vars[rt] = v
	if g.cyclic[rt] {
		// TS cannot infer a type that refers to itself; its values are untyped.
		g.decls = append(g.decls, fmt.Sprintf("const %s: StructType<any> = %s;", v, expr))
	} else {
		g.decls = append(g.decls, fmt.Sprintf("const %s = %s;", v, expr))
	}
	g.exports[g.ns(rt)] = append(g.exports[g.ns(rt)], export{rt.Name(), v})
	return v
}

func (g *gen) expr(rt reflect.Type) string {
	switch rt {
	case timeType:
		return "t.time"
	case durationType:
		return "t.duration"
	}
	if rt.Kind() == reflect.Pointer {
		return fmt.Sprintf("t.pointer(%s)", g.expr(rt.Elem()))
	}
	if v, ok := g.vars[rt]; ok {
		return v
	}
	if g.emitting[rt] {
		g.cyclic[rt] = true
		return fmt.Sprintf("t.lazy(() => %s_%s)", g.ns(rt), rt.Name())
	}
	info, err := amino.GetTypeInfo(rt)
	if err != nil {
		panic(err)
	}
	if info.IsAminoMarshaler {
		key := rt.PkgPath() + "." + rt.Name()
		r, ok := reprs[key]
		if !ok {
			panic(fmt.Sprintf("no hand-written repr for %s (MarshalAmino to %v)", key, info.ReprType.Type))
		}
		return r
	}
	switch rt.Kind() {
	case reflect.Interface:
		if rt.Name() == "" {
			return "t.interface()"
		}
		g.ifaces = append(g.ifaces, rt)
		return g.declare(rt, fmt.Sprintf("t.interface(%q)", g.ns(rt)+"."+rt.Name()))
	case reflect.Struct:
		if rt.Name() == "" {
			return g.structExpr(rt, info)
		}
		g.emitting[rt] = true
		e := g.structExpr(rt, info)
		delete(g.emitting, rt)
		return g.declare(rt, e)
	case reflect.Slice:
		if rt.Elem().Kind() == reflect.Uint8 {
			return "t.bytes"
		}
		return fmt.Sprintf("t.slice(%s)", g.expr(rt.Elem()))
	case reflect.Array:
		if rt.Elem().Kind() == reflect.Uint8 {
			return fmt.Sprintf("t.byteArray(%d)", rt.Len())
		}
		return fmt.Sprintf("t.array(%s, %d)", g.expr(rt.Elem()), rt.Len())
	case reflect.Bool, reflect.String, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Int,
		reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uint,
		reflect.Float32, reflect.Float64:
		return "t." + rt.Kind().String()
	default:
		panic(fmt.Sprintf("unsupported type %v", rt))
	}
}

func (g *gen) structExpr(rt reflect.Type, info *amino.TypeInfo) string {
	var b strings.Builder
	name := g.ns(rt) + "." + rt.Name()
	if rt.Name() == "" {
		fmt.Fprintf(&b, "t.struct(undefined, {")
	} else {
		fmt.Fprintf(&b, "t.struct(%q, {", name)
	}
	next := uint32(1)
	seen := map[string]bool{}
	for _, f := range info.Fields {
		for next < f.BinFieldNum {
			fmt.Fprintf(&b, "\n  _reserved%d: t.reserved(),", next)
			next++
		}
		next++
		key := lowerCamel(f.Name)
		if seen[key] {
			panic(fmt.Sprintf("%s: duplicate key %s", name, key))
		}
		seen[key] = true
		var opts []string
		if f.JSONName != key {
			opts = append(opts, fmt.Sprintf("json: %q", f.JSONName))
		}
		flag := func(on bool, s string) {
			if on {
				opts = append(opts, s+": true")
			}
		}
		flag(f.JSONOmitEmpty, "omitEmpty")
		flag(f.BinFixed32, "fixed32")
		flag(f.BinFixed64, "fixed64")
		flag(f.BinPlainVarint, "varint")
		flag(f.Unsafe, "unsafe")
		flag(f.WriteEmpty, "writeEmpty")
		flag(f.NilElements, "nilElements")
		typ := g.expr(f.Type)
		if len(opts) == 0 {
			fmt.Fprintf(&b, "\n  %s: %s,", key, typ)
		} else {
			fmt.Fprintf(&b, "\n  %s: t.field(%s, { %s }),", key, typ, strings.Join(opts, ", "))
		}
	}
	if len(info.Fields) == 0 {
		b.WriteString("})")
	} else {
		b.WriteString("\n})")
	}
	return b.String()
}

// lowerCamel turns a Go field name into a TS property: ChainID -> chainID,
// ID -> id, IPAddr -> ipAddr.
func lowerCamel(s string) string {
	r := []rune(s)
	i := 0
	for i < len(r) && unicode.IsUpper(r[i]) {
		i++
	}
	switch {
	case i == 0:
		return s
	case i == len(r):
		return strings.ToLower(s)
	case i == 1:
		return strings.ToLower(string(r[:1])) + string(r[1:])
	default: // an acronym followed by a word: keep the word's capital
		return strings.ToLower(string(r[:i-1])) + string(r[i-1:])
	}
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: schemagen <output file>")
		os.Exit(2)
	}
	g := &gen{
		nsOfPkg:  map[string]string{},
		vars:     map[reflect.Type]string{},
		emitting: map[reflect.Type]bool{},
		cyclic:   map[reflect.Type]bool{},
		exports:  map[string][]export{},
	}
	for _, ns := range gnotypes.Namespaces {
		g.nsOfPkg[ns.Package.GoPkgPath] = ns.Name
	}
	for _, ns := range gnotypes.Namespaces {
		for _, typ := range ns.Package.Types {
			if gnotypes.Excluded[ns.Name+"."+typ.Type.Name()] {
				continue
			}
			rt := typ.Type
			v, ok := g.vars[rt]
			if !ok {
				e := g.expr(rt)
				if strings.HasPrefix(e, "reprs.") || !strings.HasPrefix(e, ns.Name+"_") {
					// Registered non-struct type or repr: give it a name.
					v = g.declare(rt, e)
				} else {
					v = e
				}
			}
			g.regs = append(g.regs, reg{ns.Package.TypeURLForType(rt), v, rt, typ.PointerPreferred})
		}
	}

	var b strings.Builder
	b.WriteString(`// Code generated by gen/schemagen from go-amino type information. DO NOT EDIT.
// Regenerate with: pnpm schemas

/* eslint-disable @stylistic/object-curly-newline, @stylistic/object-property-newline, @stylistic/max-len, max-lines, @typescript-eslint/no-explicit-any */

import type {
  Codec,
} from "../codec";
import {
  type StructType,
  t,
} from "../types";
import * as reprs from "./reprs";

`)
	for _, d := range g.decls {
		b.WriteString(d + "\n\n")
	}
	var nss []string
	for _, ns := range gnotypes.Namespaces {
		nss = append(nss, ns.Name)
	}
	for ns := range g.exports {
		found := false
		for _, n := range nss {
			found = found || n == ns
		}
		if !found {
			nss = append(nss, ns)
		}
	}
	for _, ns := range nss {
		exps := g.exports[ns]
		if len(exps) == 0 {
			continue
		}
		sort.Slice(exps, func(i, j int) bool { return exps[i].name < exps[j].name })
		fmt.Fprintf(&b, "export const %s = {\n", ns)
		for _, e := range exps {
			fmt.Fprintf(&b, "  %s: %s,\n", e.name, e.varName)
		}
		b.WriteString("};\n\n")
	}
	b.WriteString("/** Registers every tm2 and gno.land concrete type under its Go type URL. */\n")
	b.WriteString("export function registerGnoTypes(cdc: Codec): Codec {\n  return cdc")
	for _, it := range g.ifaces {
		fmt.Fprintf(&b, "\n    .declareInterface(%s)", g.vars[it])
	}
	for _, r := range g.regs {
		// Go only decodes a type into an interface it implements, checking
		// the pointer when the type is registered as pointer-preferred.
		held := r.rt
		if r.ptr {
			held = reflect.PointerTo(r.rt)
		}
		var impls []string
		for _, it := range g.ifaces {
			if held.Implements(it) {
				impls = append(impls, g.vars[it])
			}
		}
		if len(impls) == 0 {
			fmt.Fprintf(&b, "\n    .register(%q, %s)", r.url, r.varName)
		} else {
			fmt.Fprintf(&b, "\n    .register(%q, %s, [%s])", r.url, r.varName, strings.Join(impls, ", "))
		}
	}
	b.WriteString(";\n}\n")
	if err := os.WriteFile(os.Args[1], []byte(b.String()), 0o644); err != nil {
		panic(err)
	}
	fmt.Printf("wrote %s: %d declarations, %d registered types\n", os.Args[1], len(g.decls), len(g.regs))
}
