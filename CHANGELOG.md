# @gnolang/amino-ts

## 0.3.0

### Minor Changes

- [#4](https://github.com/gnolang/amino-ts/pull/4) [`d5908a8`](https://github.com/gnolang/amino-ts/commit/d5908a82f49eebdad3e1fcba6c67a7f385035ece) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Add the `skipZero` field option, mirroring go-amino's `amino:"skip_zero"` (gnolang/gno#6399): the field is left out of binary and JSON whenever its Go value is zero, even where its repr would encode to bytes, and a missing field decodes to the zero value. `std.Signature.sessionAddr` takes it in place of the `SessionAddress` repr from 0.2.1, whose Go type gno does not have; the bytes on the wire are unchanged. Schemas and fixtures are regenerated against gno at [#6399](https://github.com/gnolang/amino-ts/issues/6399).

## 0.2.1

### Patch Changes

- [#2](https://github.com/gnolang/amino-ts/pull/2) [`009d059`](https://github.com/gnolang/amino-ts/commit/009d059ddd4c98dbf394357bcc239c8cf7f2c607) Thanks [@clockworkgr](https://github.com/clockworkgr)! - `std.Signature.sessionAddr` now uses `std.SessionAddress`, whose zero value marshals to `""`, so a master-key signature no longer carries a 42-byte zero session address in binary. This matches gnolang/gno#6404, where the Go encoder stops writing it and nodes start rejecting any encoding of a transaction other than the canonical one; without this change every master-key transaction produced by amino-ts would be rejected as non-canonical. Schemas and fixtures are regenerated against that gno revision.

## 0.2.0

### Minor Changes

- [`8f3014d`](https://github.com/gnolang/amino-ts/commit/8f3014dace4ddff341a7d95a6da2697da6f210b5) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Initial release: schema-driven Amino binary and JSON encoding/decoding, byte-compatible with go-amino, with `Any` support, well-known types, repr (`MarshalAmino`) types and `sortJSON` for tm2 sign bytes. The `@gnolang/amino-ts/gno` subpath ships generated schemas for all tm2 and gno.land amino types (transactions, messages, accounts, blocks, votes, validators, ABCI, events, genesis), with address, coin and sign-bytes helpers.
