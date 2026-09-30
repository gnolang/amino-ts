// Package gnotypes lists the tm2 and gno.land amino packages whose types
// amino-ts ships under @gnolang/amino-ts/gno.
package gnotypes

import (
	"github.com/gnolang/gno/gno.land/pkg/gnoland"
	"github.com/gnolang/gno/gno.land/pkg/sdk/vm"
	"github.com/gnolang/gno/gnovm/stdlibs/chain"
	abci "github.com/gnolang/gno/tm2/pkg/bft/abci/types"
	bft "github.com/gnolang/gno/tm2/pkg/bft/types"
	"github.com/gnolang/gno/tm2/pkg/bitarray"
	"github.com/gnolang/gno/tm2/pkg/crypto/ed25519"
	"github.com/gnolang/gno/tm2/pkg/crypto/merkle"
	"github.com/gnolang/gno/tm2/pkg/crypto/multisig"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
	"github.com/gnolang/gno/tm2/pkg/sdk"
	"github.com/gnolang/gno/tm2/pkg/sdk/auth"
	"github.com/gnolang/gno/tm2/pkg/sdk/bank"
	"github.com/gnolang/gno/tm2/pkg/sdk/params"
	"github.com/gnolang/gno/tm2/pkg/std"

	"github.com/gnolang/gno/tm2/pkg/amino"
)

// Namespace is one TS export: a Go package's registered types.
type Namespace struct {
	Name    string // TS namespace
	Package *amino.Package
}

// Namespaces in dependency order.
var Namespaces = []Namespace{
	{"bitarray", bitarray.Package},
	{"merkle", merkle.Package},
	{"secp256k1", secp256k1.Package},
	{"ed25519", ed25519.Package},
	{"multisig", multisig.Package},
	{"abci", abci.Package},
	{"bft", bft.Package},
	{"std", std.Package},
	{"sdk", sdk.Package},
	{"params", params.Package},
	{"auth", auth.Package},
	{"bank", bank.Package},
	{"chain", chain.Package},
	{"vm", vm.Package},
	{"gnoland", gnoland.Package},
}

// Excluded types: test mocks, private keys, and consensus-internal state.
var Excluded = map[string]bool{
	"abci.MockHeader":            true,
	"bft.MockGoodEvidence":       true,
	"bft.MockRandomGoodEvidence": true,
	"bft.MockBadEvidence":        true,
	"bft.MockAppState":           true,
	"bft.VoteSet":                true,
	"bft.PartSet":                true,
	"secp256k1.PrivKeySecp256k1": true,
	"ed25519.PrivKeyEd25519":     true,
}
