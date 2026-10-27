---
"@gnolang/amino-ts": minor
---

Add the `skipZero` field option, mirroring go-amino's `amino:"skip_zero"` (gnolang/gno#6399): the field is left out of binary and JSON whenever its Go value is zero, even where its repr would encode to bytes, and a missing field decodes to the zero value. `std.Signature.sessionAddr` takes it, so a master-key signature no longer carries a 42-byte zero session address and amino-ts encodes it byte for byte as Go after #6399 and tm2-js-client do. Schemas and fixtures are regenerated against gno at #6399.
