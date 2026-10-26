---
"@gnolang/amino-ts": patch
---

`std.Signature.sessionAddr` now uses `std.SessionAddress`, whose zero value marshals to `""`, so a master-key signature no longer carries a 42-byte zero session address in binary. This matches gnolang/gno#6404, where the Go encoder stops writing it and nodes start rejecting any encoding of a transaction other than the canonical one; without this change every master-key transaction produced by amino-ts would be rejected as non-canonical. Schemas and fixtures are regenerated against that gno revision.
