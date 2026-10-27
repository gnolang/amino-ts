---
"@gnolang/amino-ts": minor
---

Add the `skipZero` field option, mirroring go-amino's `amino:"skip_zero"` (gnolang/gno#6399): the field is left out of binary and JSON whenever its Go value is zero, even where its repr would encode to bytes, and a missing field decodes to the zero value. `std.Signature.sessionAddr` takes it in place of the `SessionAddress` repr from 0.2.1, whose Go type gno does not have; the bytes on the wire are unchanged. Schemas and fixtures are regenerated against gno at #6399.
