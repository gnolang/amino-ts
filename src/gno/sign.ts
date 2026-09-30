/**
 * Transaction sign bytes, as tm2/pkg/std/doc.go builds them.
 */

import type {
  Codec,
} from "../codec";
import {
  sortJSON,
} from "../json/gojson";
import {
  type Infer,
  t,
} from "../types";
import {
  utf8Encode,
} from "../utf8";
import {
  std,
} from "./types.gen";

/** `std.SignDoc`: what a transaction signature covers. */
export const SignDoc = t.struct("std.SignDoc", {
  chainID: t.field(t.string, {
    json: "chain_id",
  }),
  accountNumber: t.field(t.uint64, {
    json: "account_number",
  }),
  sequence: t.uint64,
  fee: std.Fee,
  msgs: t.slice(std.Msg),
  memo: t.string,
});

export type SignDoc = Infer<typeof SignDoc>;

/**
 * `std.signDocPayload`: the SignDoc with the fee spelled out in the shape the
 * Ledger Cosmos app accepts (`{"amount":[{denom,amount}],"gas":...}`).
 */
const SignDocPayload = t.struct("std.signDocPayload", {
  chainID: t.field(t.string, {
    json: "chain_id",
  }),
  accountNumber: t.field(t.uint64, {
    json: "account_number",
  }),
  sequence: t.uint64,
  fee: t.struct("std.signDocFee", {
    amount: t.slice(t.struct("std.signDocCoin", {
      denom: t.string,
      amount: t.string,
    })),
    gas: t.string,
  }),
  msgs: t.slice(std.Msg),
  memo: t.string,
});

/**
 * `std.GetSignaturePayload`: the bytes to sign, with the Ledger-compatible
 * fee rendering. `cdc` must have the message types registered (`gnoCodec()`).
 */
export function getSignaturePayload(cdc: Codec, doc: SignDoc): Uint8Array {
  const gasFee = doc.fee.gasFee;
  const json = cdc.marshalJSON(SignDocPayload, {
    ...doc,
    fee: {
      // A zero fee is an empty list, not a list holding an empty coin.
      amount: gasFee.amount === 0n
        ? []
        : [
          {
            denom: gasFee.denom,
            amount: String(gasFee.amount),
          },
        ],
      gas: String(doc.fee.gasWanted),
    },
  });
  return utf8Encode(sortJSON(json));
}

/**
 * `std.GetSignaturePayloadLegacy`: the bytes to sign, with the fee rendered as
 * `std.Fee`. Nodes accept signatures over either payload.
 */
export function getSignaturePayloadLegacy(cdc: Codec, doc: SignDoc): Uint8Array {
  return utf8Encode(sortJSON(cdc.marshalJSON(SignDoc, doc)));
}
