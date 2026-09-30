package main

// Fixtures for the real tm2 and gno.land types shipped in src/gno.

import (
	"encoding/hex"
	"fmt"
	"math/rand"
	"reflect"
	"sort"

	fuzz "github.com/google/gofuzz"

	"github.com/gnolang/amino-ts/gen/gnotypes"
	"github.com/gnolang/gno/gno.land/pkg/gnoland"
	"github.com/gnolang/gno/tm2/pkg/sdk/params"
	"github.com/gnolang/gno/tm2/pkg/std"
)

type gnoType struct {
	url string
	rt  reflect.Type
}

func gnoTypes() []gnoType {
	var out []gnoType
	for _, ns := range gnotypes.Namespaces {
		for _, typ := range ns.Package.Types {
			if gnotypes.Excluded[ns.Name+"."+typ.Type.Name()] {
				continue
			}
			out = append(out, gnoType{ns.Package.TypeURLForType(typ.Type), typ.Type})
		}
	}
	return out
}

var gnoDenoms = []string{"ugnot", "atom", "/gno.land/r/demo/foo:bar", "ibc/abc"}

func randGnoCoin(c fuzz.Continue) std.Coin {
	if c.Intn(5) == 0 {
		return std.Coin{}
	}
	return std.Coin{Denom: gnoDenoms[c.Intn(len(gnoDenoms))], Amount: c.Int63n(1e15) + 1}
}

func randGnoCoins(c fuzz.Continue) std.Coins {
	if c.Intn(3) == 0 {
		return nil
	}
	seen := map[string]bool{}
	var cs std.Coins
	for i := c.Intn(3) + 1; i > 0; i-- {
		coin := randGnoCoin(c)
		if coin.Denom == "" || seen[coin.Denom] {
			continue
		}
		seen[coin.Denom] = true
		cs = append(cs, coin)
	}
	sort.Slice(cs, func(i, j int) bool { return cs[i].Denom < cs[j].Denom })
	return cs
}

var gnoFuzzFuncs = []any{
	func(coin *std.Coin, c fuzz.Continue) { *coin = randGnoCoin(c) },
	func(cs *std.Coins, c fuzz.Continue) { *cs = randGnoCoins(c) },
	func(p *params.Param, c fuzz.Continue) {
		key := "p" + fmt.Sprint(c.Intn(100))
		switch c.Intn(6) {
		case 0:
			*p = params.NewParam(key, randString(c))
		case 1:
			*p = params.NewParam(key, c.Int63()-c.Int63())
		case 2:
			*p = params.NewParam(key, c.Uint64())
		case 3:
			*p = params.NewParam(key, c.RandBool())
		case 4:
			b := make([]byte, c.Intn(5))
			c.Read(b)
			*p = params.NewParam(key, b)
		default:
			*p = params.NewParam(key, []string{"a", "", "b c"}[:c.Intn(4)])
		}
	},
	func(b *gnoland.Balance, c fuzz.Continue) {
		c.Fuzz(&b.Address)
		b.Amount = randGnoCoins(c)
		if c.Intn(2) == 0 {
			v := &std.VestingSchedule{OriginalVesting: randGnoCoins(c), StartTime: c.Int63n(1e10), EndTime: c.Int63n(1e10)}
			if c.RandBool() {
				v.Type = std.VestingDelayed
			}
			b.Vesting = v
		} else {
			b.Vesting = nil
		}
	},
}

// concreteFor returns registered types that can be stored in an interface.
func concreteFor(iface reflect.Type, all []gnoType) []reflect.Type {
	var out []reflect.Type
	for _, g := range all {
		if g.rt.Implements(iface) || reflect.PointerTo(g.rt).Implements(iface) {
			out = append(out, g.rt)
		}
	}
	return out
}

// fillInterfaces sets nil interface values (which gofuzz leaves alone) to
// fuzzed registered concrete values.
func fillInterfaces(v reflect.Value, f *fuzz.Fuzzer, r *rand.Rand, all []gnoType, depth int) {
	switch v.Kind() {
	case reflect.Pointer:
		if !v.IsNil() {
			fillInterfaces(v.Elem(), f, r, all, depth)
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if v.Field(i).CanSet() {
				fillInterfaces(v.Field(i), f, r, all, depth)
			}
		}
	case reflect.Slice, reflect.Array:
		for i := 0; i < v.Len(); i++ {
			fillInterfaces(v.Index(i), f, r, all, depth)
		}
	case reflect.Interface:
		if !v.IsNil() || depth > 3 || r.Intn(4) == 0 || !v.CanSet() {
			return
		}
		var cands []reflect.Type
		if v.Type().NumMethod() == 0 {
			cands = []reflect.Type{reflect.TypeOf(int64(0)), reflect.TypeOf(""), reflect.TypeOf([]byte(nil))}
		} else {
			cands = concreteFor(v.Type(), all)
		}
		if len(cands) == 0 {
			return
		}
		ct := cands[r.Intn(len(cands))]
		cv := reflect.New(ct)
		safeFuzz(f, cv)
		fillInterfaces(cv.Elem(), f, r, all, depth+1)
		if cv.Type().Implements(v.Type()) && !ct.Implements(v.Type()) {
			v.Set(cv)
		} else {
			v.Set(cv.Elem())
		}
	}
}

// GnoFixtures holds cases for the real types, keyed by type URL.
type GnoFixtures struct {
	Cases   []Case   `json:"cases"`
	Decodes []Decode `json:"decodes"`
}

func gnoCases() GnoFixtures {
	all := gnoTypes()
	// The generic fuzz funcs, minus those that put gen/ test types into interfaces.
	var funcs []any
	for _, fn := range fuzzFuncs {
		switch fn.(type) {
		case func(*Iface, fuzz.Continue), func(*any, fuzz.Continue):
		default:
			funcs = append(funcs, fn)
		}
	}
	funcs = append(funcs, gnoFuzzFuncs...)
	f := fuzz.NewWithSeed(7).NilChance(0.2).NumElements(0, 2).MaxDepth(5).Funcs(funcs...)
	r := rand.New(rand.NewSource(7))
	var fx GnoFixtures
	for _, g := range all {
		var valid [][]byte
		for i := 0; i < 12; i++ {
			v := reflect.New(g.rt)
			safeFuzz(f, v)
			fillInterfaces(v.Elem(), f, r, all, 0)
			c := record(g.url, v.Interface())
			fx.Cases = append(fx.Cases, c)
			if c.Bin != nil {
				bz, _ := hex.DecodeString(*c.Bin)
				valid = append(valid, bz)
			}
		}
		fx.Cases = append(fx.Cases, record(g.url, reflect.New(g.rt).Interface()))
		for i := 0; i < 6 && len(valid) > 0; i++ {
			fx.Decodes = append(fx.Decodes, decodeBin(g.url, reflect.New(g.rt).Interface(), mutate(r, valid[r.Intn(len(valid))])))
		}
	}
	return fx
}

// safeFuzz fuzzes *ptr, falling back to field by field for structs holding
// something gofuzz cannot handle (a nil interface{} in a nested type).
func safeFuzz(f *fuzz.Fuzzer, ptr reflect.Value) {
	ok := func() (ok bool) {
		defer func() {
			if recover() != nil {
				ok = false
			}
		}()
		f.Fuzz(ptr.Interface())
		return true
	}()
	if ok {
		return
	}
	v := ptr.Elem()
	v.Set(reflect.Zero(v.Type()))
	if v.Kind() == reflect.Struct {
		for i := 0; i < v.NumField(); i++ {
			if v.Field(i).CanSet() {
				safeFuzz(f, v.Field(i).Addr())
			}
		}
	}
}
