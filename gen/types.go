package main

// Types exercised by the fixtures. Each is mirrored as a schema in
// tests/schemas.ts; keep the two in sync.

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

type Empty struct{}

type Primitives struct {
	Int8        int8
	Int16       int16
	Int32       int32
	Int32Fixed  int32 `binary:"fixed32"`
	Int32Varint int32 `binary:"varint"`
	Int64       int64
	Int64Fixed  int64 `binary:"fixed64"`
	Int64Varint int64 `binary:"varint"`
	Int         int
	IntFixed    int `binary:"fixed64"`
	IntVarint   int `binary:"varint"`
	Byte        byte
	Uint8       uint8
	Uint16      uint16
	Uint32      uint32
	Uint32Fixed uint32 `binary:"fixed32"`
	Uint64      uint64
	Uint64Fixed uint64 `binary:"fixed64"`
	Uint        uint
	UintFixed   uint `binary:"fixed64"`
	Bool        bool
	Str         string
	Bytes       []byte
	Time        time.Time
	Duration    time.Duration
	Empty       Empty
}

type Arrays struct {
	Int8Ar       [4]int8
	Int32Ar      [4]int32
	Int32FixedAr [4]int32 `binary:"fixed32"`
	Int64Ar      [4]int64
	Int64FixedAr [4]int64 `binary:"fixed64"`
	ByteAr       [4]byte
	Uint16Ar     [4]uint16
	Uint64Ar     [4]uint64
	BoolAr       [3]bool
	StrAr        [4]string
	BytesAr      [4][]byte
	TimeAr       [2]time.Time
	DurationAr   [2]time.Duration
	EmptyAr      [2]Empty
	ZeroAr       [0]int64
}

type ArraysArrays struct {
	Int8ArAr     [2][2]int8
	Int64ArAr    [2][2]int64
	Int64FixedAA [2][2]int64 `binary:"fixed64"`
	ByteArAr     [2][2]byte
	StrArAr      [2][2]string
	BytesArAr    [2][2][]byte
	TimeArAr     [2][2]time.Time
	EmptyArAr    [2][2]Empty
}

type Slices struct {
	Int8Sl       []int8
	Int16Sl      []int16
	Int32Sl      []int32
	Int32FixedSl []int32 `binary:"fixed32"`
	Int64Sl      []int64
	Int64FixedSl []int64 `binary:"fixed64"`
	IntSl        []int
	ByteSl       []byte
	Uint16Sl     []uint16
	Uint32Sl     []uint32
	Uint64Sl     []uint64
	BoolSl       []bool
	StrSl        []string
	BytesSl      [][]byte
	TimeSl       []time.Time
	DurationSl   []time.Duration
	EmptySl      []Empty
	PrimSl       []Small
}

type SlicesSlices struct {
	Int8SlSl     [][]int8
	Int64SlSl    [][]int64
	Uint64FixSS  [][]uint64 `binary:"fixed64"`
	ByteSlSl     [][]byte
	StrSlSl      [][]string
	BytesSlSl    [][][]byte
	TimeSlSl     [][]time.Time
	DurationSlSl [][]time.Duration
	EmptySlSl    [][]Empty
	ArSl         [][2]int32
	SlAr         [2][]int32
}

type Small struct {
	A int32
	B string
	C []byte
}

type Pointers struct {
	Int8Pt       *int8
	Int32Pt      *int32
	Int32FixedPt *int32 `binary:"fixed32"`
	Int64Pt      *int64
	Int64FixedPt *int64 `binary:"fixed64"`
	UintPt       *uint
	BytePt       *byte
	BoolPt       *bool
	StrPt        *string
	BytesPt      *[]byte
	TimePt       *time.Time
	DurationPt   *time.Duration
	EmptyPt      *Empty
	SmallPt      *Small
	ArPt         *[2]int32
	SlPt         *[]string
}

type PointerSlices struct {
	Int8PtSl   []*int8
	Int64PtSl  []*int64
	BytePtSl   []*byte
	StrPtSl    []*string
	BytesPtSl  []*[]byte
	TimePtSl   []*time.Time
	DurPtSl    []*time.Duration
	SmallPtSl  []*Small // never holds nil, see fuzz funcs
	BoolPtAr   [2]*bool
	SmallPtAr  [2]*Small // never holds nil
	StrPtAr    [2]*string
	TimePtAr   [2]*time.Time
	UintPtSl   []*uint64
	Int32PtFix []*int32 `binary:"fixed32"`
}

type Nested struct {
	Prim   Primitives
	PrimPt *Primitives
	Arr    Arrays
	Sl     Slices
	Pt     Pointers
	Small  []Small
	Name   string
}

// Tags

type WriteEmpty struct {
	Name   string  `amino:"write_empty"`
	Values []int32 `amino:"write_empty"`
	Inner  Small   `amino:"write_empty"`
	Data   []byte  `amino:"write_empty"`
	Count  int64   `amino:"write_empty"`
	Flag   bool    `amino:"write_empty"`
	Strs   []string
	Normal string
}

type Pos struct {
	Line int
	Col  int
}

type NilElements struct {
	Entries []*Pos       `amino:"nil_elements"`
	Strs    []*string    `amino:"nil_elements"`
	Times   []*time.Time `amino:"nil_elements"`
	Plain   []Small      `amino:"nil_elements"`
	Name    string
}

type JSONTags struct {
	Renamed   string    `json:"renamed_field"`
	OmitStr   string    `json:"omit_str,omitempty"`
	OmitInt   int64     `json:"omit_int,omitempty"`
	OmitSl    []string  `json:"omit_sl,omitempty"`
	OmitPt    *Small    `json:"omit_pt,omitempty"`
	OmitSmall Small     `json:"omit_small,omitempty"`
	OmitTime  time.Time `json:"omit_time,omitempty"`
	OmitBytes []byte    `json:"omit_bytes,omitempty"`
	OmitAr    [2]int8   `json:"omit_ar,omitempty"`
	Skipped   string    `json:"-"`
	Kept      bool      `json:"kept"`
}

type UnsafeFloat struct {
	F64   float64    `amino:"unsafe"`
	F32   float32    `amino:"unsafe"`
	F64Sl []float64  `amino:"unsafe"`
	F32Ar [2]float32 `amino:"unsafe"`
	Label string
}

// Reserved: V2 removed field B of V1, keeping its number.

type ReservedV1 struct {
	A string
	B int64
	C []string
	D Small
}

type ReservedV2 struct {
	A string
	_ struct{} `amino:"reserved"`
	C []string
	D Small
}

// Interfaces

type Iface interface{ isIface() }

type ConcreteA struct {
	X int64
	Y string
}

func (ConcreteA) isIface() {}

type ConcreteB [4]byte

func (ConcreteB) isIface() {}

type ConcreteC struct {
	Inner Iface
	List  []Iface
}

func (ConcreteC) isIface() {}

type ConcreteEmpty struct{}

func (ConcreteEmpty) isIface() {}

type ConcreteStr string

func (ConcreteStr) isIface() {}

type ConcreteSl []int32

func (ConcreteSl) isIface() {}

type ConcreteTime struct {
	T time.Time
	D time.Duration
}

func (ConcreteTime) isIface() {}

type Interfaces struct {
	One    Iface
	Many   []Iface
	Arr    [2]Iface
	Anyval any
	Anys   []any
	Name   string
}

// Repr types (MarshalAmino/UnmarshalAmino)

// Coin mimics std.Coin: a struct encoded as "<amount><denom>".
type Coin struct {
	Denom  string
	Amount int64
}

func (c Coin) MarshalAmino() (string, error) {
	if c.Amount == 0 && c.Denom == "" {
		return "", nil
	}
	return fmt.Sprintf("%d%s", c.Amount, c.Denom), nil
}

func (c *Coin) UnmarshalAmino(s string) error {
	if s == "" {
		*c = Coin{}
		return nil
	}
	i := 0
	if i < len(s) && s[i] == '-' {
		i++
	}
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	n, err := strconv.ParseInt(s[:i], 10, 64)
	if err != nil {
		return err
	}
	*c = Coin{Denom: s[i:], Amount: n}
	return nil
}

// Coins mimics std.Coins: a slice encoded as a comma-joined string.
type Coins []Coin

func (cs Coins) MarshalAmino() (string, error) {
	parts := make([]string, len(cs))
	for i, c := range cs {
		parts[i], _ = c.MarshalAmino()
	}
	return strings.Join(parts, ","), nil
}

func (cs *Coins) UnmarshalAmino(s string) error {
	if s == "" {
		*cs = nil
		return nil
	}
	var out Coins
	for _, p := range strings.Split(s, ",") {
		var c Coin
		if err := c.UnmarshalAmino(p); err != nil {
			return err
		}
		out = append(out, c)
	}
	*cs = out
	return nil
}

// Addr mimics crypto.Address: a byte array encoded as a hex string.
type Addr [8]byte

func (a Addr) MarshalAmino() (string, error) {
	if a == (Addr{}) {
		return "", nil
	}
	return fmt.Sprintf("%x", a[:]), nil
}

func (a *Addr) UnmarshalAmino(s string) error {
	if s == "" {
		*a = Addr{}
		return nil
	}
	if len(s) != 16 {
		return fmt.Errorf("bad addr %q", s)
	}
	for i := range 8 {
		v, err := strconv.ParseUint(s[2*i:2*i+2], 16, 8)
		if err != nil {
			return err
		}
		a[i] = byte(v)
	}
	return nil
}

// Pair: struct -> struct repr.
type Pair struct {
	A int32
	B int32
}

type PairRepr struct {
	C int64
	D int64
}

func (p Pair) MarshalAmino() (PairRepr, error) { return PairRepr{int64(p.A), int64(p.B)}, nil }
func (p *Pair) UnmarshalAmino(r PairRepr) error {
	p.A, p.B = int32(r.C), int32(r.D)
	return nil
}

// Wrapped: struct -> int32 repr.
type Wrapped struct{ V int32 }

func (w Wrapped) MarshalAmino() (int32, error) { return w.V, nil }
func (w *Wrapped) UnmarshalAmino(v int32) error {
	w.V = v
	return nil
}

// Boxed: int32 -> struct repr.
type Boxed int32

type BoxedRepr struct{ Val int32 }

func (b Boxed) MarshalAmino() (BoxedRepr, error) { return BoxedRepr{int32(b)}, nil }
func (b *Boxed) UnmarshalAmino(r BoxedRepr) error {
	*b = Boxed(r.Val)
	return nil
}

// Tiny: struct -> uint8 repr, packed as raw bytes in lists.
type Tiny struct{ A int8 }

func (t Tiny) MarshalAmino() (uint8, error) { return uint8(t.A), nil }
func (t *Tiny) UnmarshalAmino(u uint8) error {
	t.A = int8(u)
	return nil
}

// Listy: struct -> []struct repr; as a struct field it is an unpacked list.
type Listy struct {
	A int32
	B string
}

func (l Listy) MarshalAmino() ([]Small, error) {
	if l.A == 0 && l.B == "" {
		return nil, nil
	}
	return []Small{{A: l.A}, {B: l.B}}, nil
}

func (l *Listy) UnmarshalAmino(r []Small) error {
	*l = Listy{}
	if len(r) > 0 {
		l.A = r[0].A
	}
	if len(r) > 1 {
		l.B = r[1].B
	}
	return nil
}

// ListyHolder: go-amino panics encoding a field whose repr is a list.
type ListyHolder struct {
	L Listy
	N int32
}

type Reprs struct {
	Coin     Coin
	Coins    Coins
	CoinsPt  *Coins
	CoinSl   []Coin
	CoinPtSl []*Coin
	Addr     Addr
	AddrSl   []Addr
	AddrAr   [2]Addr
	Pair     Pair
	PairSl   []Pair
	Wrapped  Wrapped
	WrapSl   []Wrapped
	Boxed    Boxed
	BoxedSl  []Boxed
	Tinies   []Tiny
	CoinOmit Coin  `json:"coin_omit,omitempty"`
	AddrOmit Addr  `json:"addr_omit,omitempty"`
	CoinsOm  Coins `json:"coins_om,omitempty"`
}

// Top-level (non-struct) types.
type (
	IntDef   int64
	IntAr    [4]int64
	IntSl    []int64
	ByteAr   [4]byte
	ByteSl   []byte
	StrSl    []string
	SmallSl  []Small
	SmallAr  [2]Small
	StrSlSl  [][]string
	Int8SlSl [][]int8
)
