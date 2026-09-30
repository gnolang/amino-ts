package main

import (
	"math"
	"time"

	fuzz "github.com/google/gofuzz"
)

// Strings that stress JSON escaping and UTF-8 handling.
var specialStrings = []string{
	"", "a", "<>&", "  ", "\x00\x01\x1f\x7f", "\b\f\n\r\t", `"\/`, "é", "日本語", "🚀x", "�",
}

func randString(c fuzz.Continue) string {
	switch c.Intn(4) {
	case 0:
		return ""
	case 1:
		return specialStrings[c.Intn(len(specialStrings))]
	case 2:
		return c.RandString()
	default:
		n := c.Intn(12)
		b := make([]byte, n)
		for i := range b {
			b[i] = byte(0x20 + c.Intn(0x5f))
		}
		return string(b)
	}
}

func randTime(c fuzz.Continue) time.Time {
	switch c.Intn(6) {
	case 0:
		return time.Unix(0, 0).UTC()
	case 1:
		return time.Unix(0, c.Int63n(10)).UTC()
	case 2:
		return time.Unix(c.Int63n(4102444800), c.Int63n(1e9)).UTC()
	case 3:
		return time.Unix(-c.Int63n(62135596800), c.Int63n(1e9)).UTC()
	case 4:
		return time.Unix(c.Int63n(10), c.Int63n(1e9)/1e6*1e6).UTC()
	default:
		return time.Unix(c.Int63n(253402300800), 0).UTC()
	}
}

func randDuration(c fuzz.Continue) time.Duration {
	switch c.Intn(5) {
	case 0:
		return time.Duration(c.Int63n(20) - 10)
	case 1:
		return time.Duration(c.Int63n(2e10) - 1e10)
	case 2:
		return time.Duration(c.Int63())
	case 3:
		return -time.Duration(c.Int63())
	default:
		return time.Duration(c.Int63n(1000)) * time.Millisecond
	}
}

func randIface(c fuzz.Continue, depth int) Iface {
	switch c.Intn(8) {
	case 0:
		return nil
	case 1:
		var a ConcreteA
		c.Fuzz(&a.X)
		a.Y = randString(c)
		return a
	case 2:
		var b ConcreteB
		c.Fuzz(&b)
		return b
	case 3:
		if depth > 2 {
			return ConcreteEmpty{}
		}
		cc := ConcreteC{Inner: randIface(c, depth+1)}
		for i := c.Intn(3); i > 0; i-- {
			cc.List = append(cc.List, randIface(c, depth+1))
		}
		return cc
	case 4:
		return ConcreteEmpty{}
	case 5:
		return ConcreteStr(randString(c))
	case 6:
		var s ConcreteSl
		c.Fuzz(&s)
		return s
	default:
		return ConcreteTime{T: randTime(c), D: randDuration(c)}
	}
}

func randAny(c fuzz.Continue) any {
	switch c.Intn(12) {
	case 0:
		return nil
	case 1:
		return int64(c.Int63() - c.Int63())
	case 2:
		return c.Uint64()
	case 3:
		return int32(c.Int31() - c.Int31())
	case 4:
		return c.Uint32()
	case 5:
		return randString(c)
	case 6:
		b := make([]byte, c.Intn(4))
		c.Read(b)
		return b
	case 7:
		return c.RandBool()
	case 8:
		return randTime(c)
	case 9:
		return randDuration(c)
	case 10:
		return uint16(c.Intn(math.MaxUint16))
	default:
		return randIface(c, 0)
	}
}

func randCoin(c fuzz.Continue) Coin {
	if c.Intn(4) == 0 {
		return Coin{}
	}
	denoms := []string{"ugnot", "atom", "x"}
	return Coin{Denom: denoms[c.Intn(len(denoms))], Amount: c.Int63n(1e12) + 1}
}

var fuzzFuncs = []any{
	func(s *string, c fuzz.Continue) { *s = randString(c) },
	func(p **string, c fuzz.Continue) {
		if c.Intn(4) == 0 {
			*p = nil
			return
		}
		s := randString(c)
		*p = &s
	},
	func(t *time.Time, c fuzz.Continue) { *t = randTime(c) },
	func(d *time.Duration, c fuzz.Continue) { *d = randDuration(c) },
	func(f *float64, c fuzz.Continue) {
		switch c.Intn(6) {
		case 0:
			*f = 0
		case 1:
			*f = float64(c.Int63n(1000)) / 100.0
		case 2:
			*f = -float64(c.Int63n(1000)) / 100.0
		case 3:
			*f = float64(c.Int63())
		case 4:
			*f = math.Float64frombits(c.Uint64()) // may be NaN/Inf
		default:
			*f = c.Float64() * 1e-8
		}
	},
	func(f *float32, c fuzz.Continue) {
		switch c.Intn(5) {
		case 0:
			*f = 0
		case 1:
			*f = float32(c.Intn(1000)) / 100.0
		case 2:
			*f = -float32(c.Intn(1000)) / 100.0
		case 3:
			*f = math.Float32frombits(c.Uint32())
		default:
			*f = c.Float32() * 1e30
		}
	},
	// Struct pointers in lists without nil_elements must not be nil.
	func(sl *[]*Small, c fuzz.Continue) {
		n := c.Intn(4)
		if n == 0 {
			*sl = nil
			return
		}
		*sl = make([]*Small, n)
		for i := range *sl {
			var s Small
			c.Fuzz(&s)
			(*sl)[i] = &s
		}
	},
	func(ar *[2]*Small, c fuzz.Continue) {
		for i := range ar {
			var s Small
			c.Fuzz(&s)
			ar[i] = &s
		}
	},
	func(sl *[]*Coin, c fuzz.Continue) {
		n := c.Intn(3)
		*sl = nil
		for i := 0; i < n; i++ {
			coin := randCoin(c)
			*sl = append(*sl, &coin)
		}
	},
	func(coin *Coin, c fuzz.Continue) { *coin = randCoin(c) },
	func(cs *Coins, c fuzz.Continue) {
		n := c.Intn(3)
		*cs = nil
		for i := 0; i < n; i++ {
			coin := randCoin(c)
			if coin.Denom == "" { // an empty coin does not survive the string round trip
				coin = Coin{"z", 1}
			}
			*cs = append(*cs, coin)
		}
	},
	func(i *Iface, c fuzz.Continue) { *i = randIface(c, 0) },
	func(a *any, c fuzz.Continue) { *a = randAny(c) },
}
