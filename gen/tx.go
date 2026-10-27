package main

import (
	"encoding/hex"

	"github.com/gnolang/gno/gno.land/pkg/sdk/vm"
	"github.com/gnolang/gno/tm2/pkg/amino"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
	"github.com/gnolang/gno/tm2/pkg/sdk/bank"
	"github.com/gnolang/gno/tm2/pkg/std"
)

// TxCase is a real gno.land transaction with its encodings and sign bytes.
type TxCase struct {
	Name                string `json:"name"`
	Bin                 string `json:"bin"`
	JSON                string `json:"json"`
	ChainID             string `json:"chainId"`
	AccountNumber       uint64 `json:"accountNumber"`
	Sequence            uint64 `json:"sequence"`
	SignPayload         string `json:"signPayload"`
	SignPayloadLegacy   string `json:"signPayloadLegacy"`
	SignDocJSONUnsorted string `json:"signDocJsonUnsorted"`
}

func txCases() []TxCase {
	privKey := secp256k1.GenPrivKeySecp256k1([]byte("amino-ts fixture key"))
	pub := privKey.PubKey()
	caller := pub.Address()
	other := crypto.AddressFromPreimage([]byte("other"))

	pkg := &std.MemPackage{
		Name: "counter",
		Path: "gno.land/r/demo/counter",
		Files: []*std.MemFile{
			{Name: "counter.gno", Body: "package counter\n\nvar n int\n\nfunc Incr(cur realm) int { n++; return n }\n"},
			{Name: "gnomod.toml", Body: "module = \"gno.land/r/demo/counter\"\ngno = \"0.9\"\n"},
		},
	}

	type spec struct {
		name string
		tx   std.Tx
		acc  uint64
		seq  uint64
	}
	fee := std.NewFee(2_000_000, std.NewCoin("ugnot", 1_000_000))
	specs := []spec{
		{"send", std.Tx{
			Msgs: []std.Msg{bank.MsgSend{FromAddress: caller, ToAddress: other, Amount: std.NewCoins(std.NewCoin("ugnot", 12345))}},
			Fee:  fee,
			Memo: "hello <world> & \"friends\"",
		}, 7, 0},
		{"call", std.Tx{
			Msgs: []std.Msg{vm.MsgCall{
				Caller: caller, Send: std.NewCoins(std.NewCoin("ugnot", 1)), PkgPath: "gno.land/r/demo/counter",
				Func: "Incr", Args: []string{"1", "é", ""},
			}},
			Fee: std.NewFee(100_000, std.Coin{}),
		}, 0, 42},
		{"call-no-args", std.Tx{
			Msgs: []std.Msg{vm.MsgCall{Caller: caller, PkgPath: "gno.land/r/demo/counter", Func: "Incr"}},
			Fee:  fee,
		}, 1, 1},
		{"addpkg", std.Tx{
			Msgs: []std.Msg{vm.MsgAddPackage{Creator: caller, Package: pkg, MaxDeposit: std.NewCoins(std.NewCoin("ugnot", 5_000_000))}},
			Fee:  fee,
		}, 3, 9},
		{"run", std.Tx{
			Msgs: []std.Msg{vm.MsgRun{Caller: caller, Package: &std.MemPackage{
				Name: "main", Path: "gno.land/e/" + caller.String() + "/run",
				Files: []*std.MemFile{{Name: "main.gno", Body: "package main\n\nfunc main() { println(\"hi\") }\n"}},
			}}},
			Fee: fee,
		}, 3, 10},
		{"multi-msg", std.Tx{
			Msgs: []std.Msg{
				bank.MsgSend{FromAddress: caller, ToAddress: other, Amount: std.NewCoins(std.NewCoin("atom", 3), std.NewCoin("ugnot", 2))},
				vm.MsgCall{Caller: caller, PkgPath: "gno.land/r/demo/counter", Func: "Incr", Args: []string{}},
			},
			Fee: fee,
		}, 11, 12},
	}

	var out []TxCase
	for _, s := range specs {
		doc := std.SignDoc{ChainID: "gnoland1", AccountNumber: s.acc, Sequence: s.seq, Fee: s.tx.Fee, Msgs: s.tx.Msgs, Memo: s.tx.Memo}
		payload, err := std.GetSignaturePayload(doc)
		if err != nil {
			panic(err)
		}
		legacy, err := std.GetSignaturePayloadLegacy(doc)
		if err != nil {
			panic(err)
		}
		sig, err := privKey.Sign(payload)
		if err != nil {
			panic(err)
		}
		s.tx.Signatures = []std.Signature{{PubKey: pub, Signature: sig}}
		if s.name == "multi-msg" {
			s.tx.Signatures = append(s.tx.Signatures, std.Signature{Signature: sig, SessionAddr: other})
		}
		bin := amino.MustMarshal(s.tx)
		js := amino.MustMarshalJSON(s.tx)
		out = append(out, TxCase{
			Name: s.name, Bin: hex.EncodeToString(bin), JSON: string(js),
			ChainID: doc.ChainID, AccountNumber: doc.AccountNumber, Sequence: doc.Sequence,
			SignPayload: string(payload), SignPayloadLegacy: string(legacy),
			SignDocJSONUnsorted: string(amino.MustMarshalJSON(doc)),
		})
	}
	return out
}
