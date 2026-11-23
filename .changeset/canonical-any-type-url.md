---
"@gnolang/amino-ts": patch
---

Encode an interface value with its registered type URL instead of the one it was given, as go-amino does. An alias such as `/example.com/bank.Send` used to reach the wire and make nodes reject the tx.
