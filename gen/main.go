// Command gen writes the cross-implementation fixtures used by the amino-ts
// test suite. Every value is encoded and decoded by go-amino itself, so the
// fixtures pin down exactly what Go produces and accepts.
//
// Usage: go run . <output dir>
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"reflect"
	"time"

	fuzz "github.com/google/gofuzz"

	"github.com/gnolang/gno/tm2/pkg/amino"
)

var Package = amino.RegisterPackage(amino.NewPackage(
	"main",
	"gen",
	amino.GetCallersDirname(),
).WithTypes(
	Empty{}, Primitives{}, Arrays{}, ArraysArrays{}, Slices{}, SlicesSlices{},
	Small{}, Pos{}, Pointers{}, PointerSlices{}, Nested{}, WriteEmpty{}, NilElements{},
	JSONTags{}, UnsafeFloat{}, ReservedV1{}, ReservedV2{},
	ConcreteA{}, ConcreteB{}, ConcreteC{}, ConcreteEmpty{}, ConcreteStr(""),
	ConcreteSl(nil), ConcreteTime{}, Interfaces{},
	Coin{}, Coins(nil), Addr{}, Listy{}, ListyHolder{}, Pair{}, PairRepr{}, Wrapped{}, Boxed(0), BoxedRepr{}, Tiny{}, Reprs{},
	IntDef(0), IntAr{}, IntSl(nil), ByteAr{}, ByteSl(nil), StrSl(nil), SmallSl(nil), SmallAr{},
	StrSlSl(nil), Int8SlSl(nil),
))

// Case records every path through the Go codec for one value. A nil string
// means the path was not taken; an Err field holds the Go error instead.
type Case struct {
	Type       string  `json:"type"`
	Bin        *string `json:"bin,omitempty"`
	BinErr     *string `json:"binErr,omitempty"`
	JSON       *string `json:"json,omitempty"`
	JSONErr    *string `json:"jsonErr,omitempty"`
	BinToBin   *string `json:"binToBin,omitempty"`
	BinToJSON  *string `json:"binToJson,omitempty"`
	BinDecErr  *string `json:"binDecErr,omitempty"`
	JSONToBin  *string `json:"jsonToBin,omitempty"`
	JSONToJSON *string `json:"jsonToJson,omitempty"`
	JSONDecErr *string `json:"jsonDecErr,omitempty"`
}

// Decode records how Go decodes arbitrary (often invalid) input.
type Decode struct {
	Type   string  `json:"type"`
	Bin    *string `json:"bin,omitempty"`
	JSON   *string `json:"json,omitempty"`
	Err    *string `json:"err,omitempty"`
	ToBin  *string `json:"toBin,omitempty"`
	ToJSON *string `json:"toJson,omitempty"`
}

type Fixtures struct {
	Cases   []Case   `json:"cases"`
	Decodes []Decode `json:"decodes"`
	Txs     []TxCase `json:"txs"`
}

func ptr(s string) *string { return &s }

func errStr(err error) *string {
	if err == nil {
		return nil
	}
	return ptr(err.Error())
}

func safe(f func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
		}
	}()
	return f()
}

func marshal(v any) (string, error) {
	var bz []byte
	err := safe(func() (err error) { bz, err = amino.Marshal(v); return })
	return hex.EncodeToString(bz), err
}

func marshalJSON(v any) (string, error) {
	var bz []byte
	err := safe(func() (err error) { bz, err = amino.MarshalJSON(v); return })
	return string(bz), err
}

// newOf returns a pointer to a fresh value of the same type as v's pointee.
func newOf(v any) any {
	return reflect.New(reflect.TypeOf(v).Elem()).Interface()
}

func deref(p any) any { return reflect.ValueOf(p).Elem().Interface() }

func record(name string, v any) Case {
	c := Case{Type: name}
	val := deref(v)
	if bin, err := marshal(val); err != nil {
		c.BinErr = errStr(err)
	} else {
		c.Bin = ptr(bin)
		bz, _ := hex.DecodeString(bin)
		out := newOf(v)
		if err := safe(func() error { return amino.Unmarshal(bz, out) }); err != nil {
			c.BinDecErr = errStr(err)
		} else {
			b2, err := marshal(deref(out))
			if err == nil {
				c.BinToBin = ptr(b2)
			}
			j2, err := marshalJSON(deref(out))
			if err == nil {
				c.BinToJSON = ptr(j2)
			}
		}
	}
	if js, err := marshalJSON(val); err != nil {
		c.JSONErr = errStr(err)
	} else {
		c.JSON = ptr(js)
		out := newOf(v)
		if err := safe(func() error { return amino.UnmarshalJSON([]byte(js), out) }); err != nil {
			c.JSONDecErr = errStr(err)
		} else {
			b2, err := marshal(deref(out))
			if err == nil {
				c.JSONToBin = ptr(b2)
			}
			j2, err := marshalJSON(deref(out))
			if err == nil {
				c.JSONToJSON = ptr(j2)
			}
		}
	}
	return c
}

func decodeBin(name string, proto any, bz []byte) Decode {
	d := Decode{Type: name, Bin: ptr(hex.EncodeToString(bz))}
	out := newOf(proto)
	if err := safe(func() error { return amino.Unmarshal(bz, out) }); err != nil {
		d.Err = errStr(err)
		return d
	}
	if b, err := marshal(deref(out)); err == nil {
		d.ToBin = ptr(b)
	}
	if j, err := marshalJSON(deref(out)); err == nil {
		d.ToJSON = ptr(j)
	}
	return d
}

func decodeJSON(name string, proto any, js string) Decode {
	d := Decode{Type: name, JSON: ptr(js)}
	out := newOf(proto)
	if err := safe(func() error { return amino.UnmarshalJSON([]byte(js), out) }); err != nil {
		d.Err = errStr(err)
		return d
	}
	if b, err := marshal(deref(out)); err == nil {
		d.ToBin = ptr(b)
	}
	if j, err := marshalJSON(deref(out)); err == nil {
		d.ToJSON = ptr(j)
	}
	return d
}

// mutate returns a corrupted copy of bz.
func mutate(r *rand.Rand, bz []byte) []byte {
	out := append([]byte(nil), bz...)
	switch r.Intn(6) {
	case 0: // flip a byte
		if len(out) > 0 {
			out[r.Intn(len(out))] ^= byte(1 << r.Intn(8))
		}
	case 1: // set a byte
		if len(out) > 0 {
			out[r.Intn(len(out))] = byte(r.Intn(256))
		}
	case 2: // truncate
		if len(out) > 0 {
			out = out[:r.Intn(len(out))]
		}
	case 3: // insert
		i := r.Intn(len(out) + 1)
		out = append(out[:i], append([]byte{byte(r.Intn(256))}, out[i:]...)...)
	case 4: // delete
		if len(out) > 0 {
			i := r.Intn(len(out))
			out = append(out[:i], out[i+1:]...)
		}
	case 5: // append
		out = append(out, byte(r.Intn(256)))
	}
	return out
}

// mutateJSON returns a corrupted or perturbed copy of a JSON document.
func mutateJSON(r *rand.Rand, js string) string {
	b := []byte(js)
	pieces := []string{
		`null`, `""`, `"0"`, `0`, `-1`, `1.5`, `1e3`, `"1e3"`, `[]`, `{}`, `true`, `"x"`,
		`"AA=="`, `"AAA"`, `"1970-01-01T00:00:00Z"`, `"2024-02-30T00:00:00Z"`, `"1s"`, `"1h2m"`,
		`"18446744073709551616"`, `"-9223372036854775809"`, `256`, `-129`, `"<"`,
		`{"@type":"/gen.ConcreteA","X":"1","Y":""}`, `{"@type":"/gen.Nope"}`,
	}
	switch r.Intn(5) {
	case 0:
		if len(b) > 0 {
			chars := "{}[],:\"0a "
			b[r.Intn(len(b))] = chars[r.Intn(len(chars))]
		}
		return string(b)
	case 1:
		if len(b) > 0 {
			return string(b[:r.Intn(len(b))])
		}
		return js
	default:
		// Replace a JSON value (the text after a colon) with a piece.
		var doc any
		if err := json.Unmarshal(b, &doc); err != nil {
			return js
		}
		obj, ok := doc.(map[string]any)
		if !ok || len(obj) == 0 {
			return pieces[r.Intn(len(pieces))]
		}
		keys := make([]string, 0, len(obj))
		for k := range obj {
			keys = append(keys, k)
		}
		// Map order is random; sort for determinism.
		sortStrings(keys)
		k := keys[r.Intn(len(keys))]
		var piece any
		_ = json.Unmarshal([]byte(pieces[r.Intn(len(pieces))]), &piece)
		obj[k] = piece
		out, _ := json.Marshal(obj)
		return string(out)
	}
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

type entry struct {
	name  string
	proto any // pointer to a zero value
	n     int // number of fuzzed cases
}

var entries = []entry{
	{"Empty", &Empty{}, 2},
	{"Primitives", &Primitives{}, 60},
	{"Arrays", &Arrays{}, 30},
	{"ArraysArrays", &ArraysArrays{}, 30},
	{"Slices", &Slices{}, 40},
	{"SlicesSlices", &SlicesSlices{}, 40},
	{"Small", &Small{}, 20},
	{"Pointers", &Pointers{}, 40},
	{"PointerSlices", &PointerSlices{}, 40},
	{"Nested", &Nested{}, 15},
	{"WriteEmpty", &WriteEmpty{}, 30},
	{"NilElements", &NilElements{}, 30},
	{"JSONTags", &JSONTags{}, 40},
	{"UnsafeFloat", &UnsafeFloat{}, 40},
	{"ReservedV1", &ReservedV1{}, 20},
	{"ReservedV2", &ReservedV2{}, 20},
	{"Interfaces", &Interfaces{}, 60},
	{"Reprs", &Reprs{}, 50},
	{"ListyHolder", &ListyHolder{}, 4},
	{"IntDef", new(IntDef), 10},
	{"IntAr", new(IntAr), 10},
	{"IntSl", new(IntSl), 10},
	{"ByteAr", new(ByteAr), 10},
	{"ByteSl", new(ByteSl), 10},
	{"StrSl", new(StrSl), 10},
	{"SmallSl", new(SmallSl), 10},
	{"SmallAr", new(SmallAr), 10},
	{"StrSlSl", new(StrSlSl), 10},
	{"Int8SlSl", new(Int8SlSl), 10},
	{"Time", new(time.Time), 20},
	{"Duration", new(time.Duration), 20},
	{"String", new(string), 20},
	{"Int64", new(int64), 10},
	{"Uint16", new(uint16), 10},
	{"Bool", new(bool), 4},
	{"Bytes", new([]byte), 10},
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: gen <output dir>")
		os.Exit(2)
	}
	var fx Fixtures
	f := fuzz.NewWithSeed(20260930).NilChance(0.25).NumElements(0, 3).MaxDepth(6).Funcs(fuzzFuncs...)
	r := rand.New(rand.NewSource(42))

	for _, e := range entries {
		var valid [][]byte
		var jsons []string
		for i := 0; i < e.n; i++ {
			v := newOf(e.proto)
			f.Fuzz(v)
			c := record(e.name, v)
			fx.Cases = append(fx.Cases, c)
			if c.Bin != nil {
				bz, _ := hex.DecodeString(*c.Bin)
				valid = append(valid, bz)
			}
			if c.JSON != nil {
				jsons = append(jsons, *c.JSON)
			}
		}
		// Zero value.
		fx.Cases = append(fx.Cases, record(e.name, newOf(e.proto)))
		// Corrupted inputs.
		for i := 0; i < e.n && len(valid) > 0; i++ {
			fx.Decodes = append(fx.Decodes, decodeBin(e.name, e.proto, mutate(r, valid[r.Intn(len(valid))])))
		}
		for i := 0; i < e.n && len(jsons) > 0; i++ {
			fx.Decodes = append(fx.Decodes, decodeJSON(e.name, e.proto, mutateJSON(r, jsons[r.Intn(len(jsons))])))
		}
	}
	fx.Cases = append(fx.Cases, handpicked()...)
	fx.Decodes = append(fx.Decodes, handpickedDecodes()...)
	fx.Txs = txCases()

	out, err := json.MarshalIndent(fx, "", " ")
	if err != nil {
		panic(err)
	}
	path := filepath.Join(os.Args[1], "fixtures.json")
	if err := os.WriteFile(path, append(out, '\n'), 0o644); err != nil {
		panic(err)
	}
	fmt.Printf("wrote %s: %d cases, %d decodes, %d txs\n", path, len(fx.Cases), len(fx.Decodes), len(fx.Txs))

	gfx := gnoCases()
	out, err = json.MarshalIndent(gfx, "", " ")
	if err != nil {
		panic(err)
	}
	path = filepath.Join(os.Args[1], "gno-fixtures.json")
	if err := os.WriteFile(path, append(out, '\n'), 0o644); err != nil {
		panic(err)
	}
	fmt.Printf("wrote %s: %d cases, %d decodes\n", path, len(gfx.Cases), len(gfx.Decodes))
}

// handpicked covers edges the fuzzer is unlikely to hit.
func handpicked() []Case {
	var cs []Case
	add := func(name string, v any) { cs = append(cs, record(name, v)) }

	s := func(v string) *string { return &v }
	add("String", s("<script>&  \x00\x08\x0c\x1f\x7f \"\\ é 日本 🚀"))
	add("String", s("\xff\xfe invalid utf8 \xc3"))
	add("Primitives", &Primitives{
		Int8: math.MinInt8, Int16: math.MinInt16, Int32: math.MinInt32, Int32Fixed: math.MinInt32, Int32Varint: -1,
		Int64: math.MinInt64, Int64Fixed: math.MinInt64, Int64Varint: math.MinInt64, Int: math.MinInt64,
		IntFixed: -1, IntVarint: -5, Byte: 255, Uint8: 255, Uint16: math.MaxUint16, Uint32: math.MaxUint32,
		Uint32Fixed: math.MaxUint32, Uint64: math.MaxUint64, Uint64Fixed: math.MaxUint64, Uint: math.MaxUint64,
		UintFixed: math.MaxUint64, Bool: true, Str: "x", Bytes: []byte{},
		Time: time.Unix(-62135596800, 0).UTC(), Duration: math.MinInt64,
	})
	add("Primitives", &Primitives{
		Int8: math.MaxInt8, Int16: math.MaxInt16, Int32: math.MaxInt32, Int64: math.MaxInt64, Int: math.MaxInt64,
		Time: time.Unix(253402300799, 999999999).UTC(), Duration: math.MaxInt64,
	})
	add("Primitives", &Primitives{Time: time.Unix(0, 1).UTC(), Duration: 1})
	add("Primitives", &Primitives{Time: time.Unix(-1, 999999999).UTC(), Duration: -1})
	add("Primitives", &Primitives{Time: time.Unix(1, 1000).UTC(), Duration: 1500 * time.Millisecond})
	add("Primitives", &Primitives{Time: time.Unix(1, 1000000).UTC(), Duration: -1500 * time.Millisecond})
	// Out-of-range time (year 10000) fails to encode.
	add("Primitives", &Primitives{Time: time.Unix(253402300800, 0).UTC()})
	// Go's zero time.Time (year 1) is valid for amino.
	add("Time", &time.Time{})
	add("Slices", &Slices{Int8Sl: []int8{}, StrSl: []string{}, BytesSl: [][]byte{nil, {}}, EmptySl: []Empty{{}, {}}})
	add("Pointers", &Pointers{Int8Pt: new(int8), StrPt: s(""), BytesPt: &[]byte{}, TimePt: &time.Time{},
		EmptyPt: &Empty{}, SmallPt: &Small{}, ArPt: &[2]int32{}, SlPt: &[]string{}})
	add("PointerSlices", &PointerSlices{SmallPtSl: []*Small{nil}})
	add("NilElements", &NilElements{Entries: []*Pos{nil, {1, 2}, nil}, Strs: []*string{nil, s("a")},
		Times: []*time.Time{nil, {}}, Plain: []Small{{}, {A: 1}}})
	add("UnsafeFloat", &UnsafeFloat{F64: math.Copysign(0, -1), F32: 0.1, F64Sl: []float64{1e21, 1e-7, 123456789.125, 5e-324}})
	add("UnsafeFloat", &UnsafeFloat{F64: math.NaN()})
	add("UnsafeFloat", &UnsafeFloat{F64: 1e20, F32: 1e-7, F32Ar: [2]float32{3.4028235e38, 1.1754944e-38}})
	add("JSONTags", &JSONTags{OmitTime: time.Unix(0, 0).UTC(), OmitSl: []string{}, OmitBytes: []byte{}, OmitPt: &Small{}})
	add("Interfaces", &Interfaces{
		One:    ConcreteC{Inner: ConcreteC{Inner: ConcreteA{X: 1}}, List: []Iface{ConcreteB{1, 2, 3, 4}, nil, ConcreteEmpty{}}},
		Many:   []Iface{ConcreteStr(""), ConcreteSl(nil), ConcreteSl{1, -2}, ConcreteTime{}},
		Anyval: time.Duration(0),
		Anys:   []any{int64(0), "", []byte(nil), uint8(7), int8(-7), uint16(9), int16(-9), true, time.Time{}},
	})
	add("Interfaces", &Interfaces{Anyval: ConcreteEmpty{}, Anys: []any{ConcreteEmpty{}, ConcreteA{}}})
	add("Reprs", &Reprs{Coins: Coins{}, CoinsPt: &Coins{}, CoinPtSl: []*Coin{nil}, Tinies: []Tiny{{-1}, {0}, {127}}})
	add("Reprs", &Reprs{Coin: Coin{"ugnot", 5}, CoinOmit: Coin{"x", 1}, AddrOmit: Addr{1}, CoinsOm: Coins{{"a", 1}, {"b", 2}}})
	add("ReservedV1", &ReservedV1{A: "a", B: 7, C: []string{"x"}, D: Small{A: 1}})
	add("SlicesSlices", &SlicesSlices{Int8SlSl: [][]int8{nil, {}, {1}}, StrSlSl: [][]string{nil, {""}, {"a", "b"}},
		BytesSlSl: [][][]byte{nil, {nil}, {{1}}}, EmptySlSl: [][]Empty{{}, {{}}}, ArSl: [][2]int32{{}, {1, 2}},
		SlAr: [2][]int32{nil, {3}}})
	return cs
}

// handpickedDecodes feeds specific inputs to the decoders.
func handpickedDecodes() []Decode {
	var ds []Decode
	bin := func(name string, proto any, h string) {
		bz, err := hex.DecodeString(h)
		if err != nil {
			panic(err)
		}
		ds = append(ds, decodeBin(name, proto, bz))
	}
	js := func(name string, proto any, s string) { ds = append(ds, decodeJSON(name, proto, s)) }

	// Reserved: V2 skips field 2 written by V1.
	v1, _ := amino.Marshal(ReservedV1{A: "a", B: 7, C: []string{"x"}, D: Small{A: 1}})
	bin("ReservedV2", &ReservedV2{}, hex.EncodeToString(v1))
	bin("ReservedV2", &ReservedV2{}, "0a01611007")   // A, B only
	bin("ReservedV2", &ReservedV2{}, "1007")         // B only
	bin("ReservedV2", &ReservedV2{}, "10071007")     // duplicate reserved field
	bin("ReservedV1", &ReservedV1{}, "1a01781a0179") // repeated C
	// Field order and duplicates.
	bin("Small", &Small{}, "08011202")                                             // A then B with bad length
	bin("Small", &Small{}, "12016108")                                             // truncated
	bin("Small", &Small{}, "1201610801")                                           // B before A
	bin("Small", &Small{}, "08010802")                                             // duplicate A
	bin("Small", &Small{}, "0801200a")                                             // unknown field 4
	bin("Small", &Small{}, "0a01")                                                 // wrong typ3 for A
	bin("Small", &Small{}, "00")                                                   // field number 0
	bin("Small", &Small{}, "08ffffffffffffffffff01")                               // varint overflow
	bin("Small", &Small{}, "08ffffffffffffffff7f")                                 // int32 truncation
	bin("Small", &Small{}, "0880808080808080808001")                               // 10-byte varint
	bin("Primitives", &Primitives{}, "a80102")                                     // bool = 2
	bin("Primitives", &Primitives{}, "0880")                                       // truncated varint
	bin("Primitives", &Primitives{}, "08ff01")                                     // int8 overflow
	bin("Primitives", &Primitives{}, "c2010408e80710")                             // time with truncated nanos
	bin("Primitives", &Primitives{}, "c20106088080808010")                         // time seconds out of range
	bin("Primitives", &Primitives{}, "c201051080ca3d")                             // time with nanos 1e9
	bin("Primitives", &Primitives{}, "c2010410010801")                             // nanos before seconds
	bin("Primitives", &Primitives{}, "ca01021001")                                 // duration nanos only
	bin("Primitives", &Primitives{}, "ca010408011001")                             // duration mismatched ok signs
	bin("Primitives", &Primitives{}, "ca010b08ffffffffffffffffff011001")           // duration sign mismatch
	bin("Interfaces", &Interfaces{}, "0a00")                                       // empty Any
	bin("Interfaces", &Interfaces{}, "0a0b0a092f67656e2e4e6f7065")                 // unknown type
	bin("Interfaces", &Interfaces{}, "0a0f0a0d2f67656e2e436f6e637265746541")       // /gen.ConcreteA, empty value
	bin("Interfaces", &Interfaces{}, "0a0e0a0c2f67656e2e436f6e6372657465")         // no dot in full name? still a name
	bin("Interfaces", &Interfaces{}, "0a031201ff")                                 // Any without type url
	bin("Interfaces", &Interfaces{}, "0a0412020801")                               // Any value first
	bin("Interfaces", &Interfaces{}, "0a110a0d2f67656e2e436f6e637265746541120008") // trailing bytes
	bin("Interfaces", &Interfaces{}, "0a0d0a0b2f67656e2e0a436f6e63")               // non-ascii type url
	bin("IntDef", new(IntDef), "")
	bin("IntDef", new(IntDef), "0801")
	bin("IntDef", new(IntDef), "1001")
	bin("IntDef", new(IntDef), "0801ff")
	bin("ByteAr", new(ByteAr), "0a0401020304")
	bin("ByteAr", new(ByteAr), "0a03010203")
	bin("IntAr", new(IntAr), "0a0402040608")
	bin("IntAr", new(IntAr), "0a03020406")
	bin("SmallAr", new(SmallAr), "0a000a00")
	bin("SmallAr", new(SmallAr), "0a00")
	bin("SmallAr", new(SmallAr), "0a000a000a00")
	bin("NilElements", &NilElements{}, "0a000a020801")
	bin("PointerSlices", &PointerSlices{}, "3a00")
	bin("Reprs", &Reprs{}, "0a03787878")   // bad coin string
	bin("String", new(string), "0a03e282") // truncated utf8
	bin("String", new(string), "0a02c0af") // overlong utf8

	// JSON.
	js("Small", &Small{}, `{"A":1,"B":"x","C":"AQ=="}`)
	js("Small", &Small{}, `{"A":1,"A":2}`)
	js("Small", &Small{}, `{"A":1,"D":2}`)
	js("Small", &Small{}, `{"a":1}`)
	js("Small", &Small{}, `{"A":"1"}`)
	js("Small", &Small{}, `{"A":1.0}`)
	js("Small", &Small{}, `{"A":1e2}`)
	js("Small", &Small{}, `{"A":-0}`)
	js("Small", &Small{}, `{"A":2147483648}`)
	js("Small", &Small{}, `{"C":"AQ"}`)
	js("Small", &Small{}, `{"C":"AR=="}`)
	js("Small", &Small{}, `{"C":""}`)
	js("Small", &Small{}, `{"C":null,"A":null,"B":null}`)
	js("Small", &Small{}, ` { "A" : 1 } `)
	js("Small", &Small{}, `{"A":1}x`)
	js("Small", &Small{}, `null`)
	js("Small", &Small{}, `[]`)
	js("Small", &Small{}, `{"B":"🚀<\/"}`)
	js("Small", &Small{}, `{"B":"\ud800"}`)
	js("Primitives", &Primitives{}, `{"Int64":1}`)
	js("Primitives", &Primitives{}, `{"Int64":"01"}`)
	js("Primitives", &Primitives{}, `{"Int64":" 1 "}`)
	js("Primitives", &Primitives{}, `{"Int64":"null"}`)
	js("Primitives", &Primitives{}, `{"Int64":"9223372036854775808"}`)
	js("Primitives", &Primitives{}, `{"Uint64":"18446744073709551615"}`)
	js("Primitives", &Primitives{}, `{"Uint64":"-1"}`)
	js("Primitives", &Primitives{}, `{"Time":"2024-02-29T12:34:56.123456789+02:30"}`)
	js("Primitives", &Primitives{}, `{"Time":"2024-02-29T12:34:56.1234567891Z"}`)
	js("Primitives", &Primitives{}, `{"Time":"2023-02-29T00:00:00Z"}`)
	js("Primitives", &Primitives{}, `{"Time":"0000-01-01T00:00:00Z"}`)
	js("Primitives", &Primitives{}, `{"Time":"2024-01-01T00:00:00z"}`)
	js("Primitives", &Primitives{}, `{"Time":"2024-01-01 00:00:00Z"}`)
	js("Primitives", &Primitives{}, `{"Time":"2024-01-01T24:00:00Z"}`)
	js("Primitives", &Primitives{}, `{"Time":"2024-01-01T00:00:60Z"}`)
	js("Primitives", &Primitives{}, `{"Time":"2024-01-01T00:00:00,5Z"}`)
	js("Primitives", &Primitives{}, `{"Time":null}`)
	js("Primitives", &Primitives{}, `{"Duration":"1h2m3.5s"}`)
	js("Primitives", &Primitives{}, `{"Duration":"-1.000000001s"}`)
	js("Primitives", &Primitives{}, `{"Duration":".5us"}`)
	js("Primitives", &Primitives{}, `{"Duration":"1µs2μs3ns"}`)
	js("Primitives", &Primitives{}, `{"Duration":"2562047h47m16.854775807s"}`)
	js("Primitives", &Primitives{}, `{"Duration":"2562047h47m16.854775808s"}`)
	js("Primitives", &Primitives{}, `{"Duration":"-2562047h47m16.854775808s"}`)
	js("Primitives", &Primitives{}, `{"Duration":"1"}`)
	js("Primitives", &Primitives{}, `{"Duration":"0"}`)
	js("Primitives", &Primitives{}, `{"Duration":"1d"}`)
	js("Primitives", &Primitives{}, `{"Duration":"0.3333333333333333333h"}`)
	js("Primitives", &Primitives{}, `{"Int8":-128,"Int16":-32768,"Uint8":255,"Uint16":65535,"Uint32":4294967295}`)
	js("Primitives", &Primitives{}, `{"Uint8":256}`)
	js("Primitives", &Primitives{}, `{"Bool":"true"}`)
	js("Primitives", &Primitives{}, `{"Empty":null,"Bytes":null}`)
	js("Arrays", &Arrays{}, `{"Int8Ar":[1,2,3]}`)
	js("Arrays", &Arrays{}, `{"ByteAr":"AQIDBAU="}`)
	js("Arrays", &Arrays{}, `{"ZeroAr":[]}`)
	js("Slices", &Slices{}, `{"Int8Sl":[],"StrSl":[],"EmptySl":[{}],"ByteSl":""}`)
	js("Pointers", &Pointers{}, `{"Int8Pt":null,"SmallPt":null,"TimePt":null,"StrPt":null,"EmptyPt":{}}`)
	js("PointerSlices", &PointerSlices{}, `{"Int8PtSl":[null,1],"SmallPtSl":[null],"TimePtSl":[null]}`)
	js("Interfaces", &Interfaces{}, `{"One":{"@type":"/gen.ConcreteA","X":"1","Y":"y"}}`)
	js("Interfaces", &Interfaces{}, `{"One":{"X":"1","@type":"/gen.ConcreteA"}}`)
	js("Interfaces", &Interfaces{}, `{"One":{"@type":"/gen.ConcreteA","X":"1","Z":1}}`)
	js("Interfaces", &Interfaces{}, `{"One":{"@type":"/gen.ConcreteA","@type":"/gen.ConcreteA"}}`)
	js("Interfaces", &Interfaces{}, `{"One":{"@type":"/gen.ConcreteB","value":"AQIDBA=="}}`)
	js("Interfaces", &Interfaces{}, `{"One":{"@type":"/gen.ConcreteB","value":"AQIDBA==","extra":1}}`)
	js("Interfaces", &Interfaces{}, `{"One":{"@type":"/gen.ConcreteB"}}`)
	js("Interfaces", &Interfaces{}, `{"One":{"@type":""}}`)
	js("Interfaces", &Interfaces{}, `{"One":{"@type":"gen.ConcreteA"}}`)
	js("Interfaces", &Interfaces{}, `{"One":{"@type":"/other/gen.ConcreteEmpty"}}`)
	js("Interfaces", &Interfaces{}, `{"Anyval":{"@type":"/google.protobuf.Int64Value","value":"5"}}`)
	js("Interfaces", &Interfaces{}, `{"Anyval":{"@type":"/google.protobuf.Timestamp","value":"2020-01-01T00:00:00Z"}}`)
	js("Interfaces", &Interfaces{}, `{"Anyval":{"@type":"/google.protobuf.Duration","value":"1s"}}`)
	js("Interfaces", &Interfaces{}, `{"Anyval":{"@type":"/amino.UInt8","value":300}}`)
	js("Interfaces", &Interfaces{}, `{"Anys":[{"@type":"/google.protobuf.StringValue","value":"s"},null]}`)
	js("Reprs", &Reprs{}, `{"Coin":"5ugnot","Coins":"1a,2b","Addr":"0102030405060708"}`)
	js("Reprs", &Reprs{}, `{"Addr":"zz"}`)
	js("Reprs", &Reprs{}, `{"Pair":{"C":"1","D":"2"},"Boxed":{"Val":3},"Wrapped":4,"Tinies":[1,255]}`)
	js("UnsafeFloat", &UnsafeFloat{}, `{"F64":1e400}`)
	js("UnsafeFloat", &UnsafeFloat{}, `{"F32":3.5e38}`)
	js("UnsafeFloat", &UnsafeFloat{}, `{"F32":0.1,"F64":"1"}`)
	js("IntDef", new(IntDef), `"5"`)
	js("IntDef", new(IntDef), `5`)
	js("Time", new(time.Time), `"1970-01-01T00:00:00Z"`)
	js("Bytes", new([]byte), `"AAECAw=="`)
	js("Bytes", new([]byte), "\"AAEC\r\nAw==\"")
	js("String", new(string), `"a\/bé\t"`)
	js("String", new(string), `"a`)
	js("String", new(string), "\"a\tb\"")
	return ds
}
