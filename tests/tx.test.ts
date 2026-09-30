/**
 * Real gno.land transactions, encoded and signed by the Go node code
 * (fixtures from gen/tx.go).
 */

import {
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  fromHex,
  type Infer,
  sortJSON,
  toHex,
} from "../src";
import {
  gnoCodec,
  SignDoc,
  SignDocPayload,
  Tx,
} from "./tm2";

interface TxCase {
  name: string
  bin: string
  json: string
  chainId: string
  accountNumber: number
  sequence: number
  signPayload: string
  signPayloadLegacy: string
  signDocJsonUnsorted: string
}

const {
  txs,
} = JSON.parse(readFileSync(new URL("../testdata/fixtures.json", import.meta.url), "utf8")) as {
  txs: TxCase[]
};
const cdc = gnoCodec();

describe.each(txs)("gno.land tx: $name", (c) => {
  it("round-trips binary", () => {
    const tx = cdc.unmarshal(Tx, fromHex(c.bin));
    expect(toHex(cdc.marshal(Tx, tx))).toBe(c.bin);
    expect(cdc.marshalJSON(Tx, tx)).toBe(c.json);
  });

  it("round-trips JSON", () => {
    const tx = cdc.unmarshalJSON(Tx, c.json);
    expect(cdc.marshalJSON(Tx, tx)).toBe(c.json);
    expect(toHex(cdc.marshal(Tx, tx))).toBe(c.bin);
  });

  it("builds the sign bytes Go signs", () => {
    const tx = cdc.unmarshal(Tx, fromHex(c.bin));
    const doc: Infer<typeof SignDoc> = {
      chainId: c.chainId,
      accountNumber: BigInt(c.accountNumber),
      sequence: BigInt(c.sequence),
      fee: tx.fee,
      msgs: tx.msgs,
      memo: tx.memo,
    };
    const legacy = cdc.marshalJSON(SignDoc, doc);
    expect(legacy).toBe(c.signDocJsonUnsorted);
    expect(sortJSON(legacy)).toBe(c.signPayloadLegacy);

    const gasFee = tx.fee.gasFee;
    const payload = cdc.marshalJSON(SignDocPayload, {
      ...doc,
      fee: {
        amount: gasFee.amount === 0n
          ? []
          : [
            {
              denom: gasFee.denom,
              amount: String(gasFee.amount),
            },
          ],
        gas: String(tx.fee.gasWanted),
      },
    });
    expect(sortJSON(payload)).toBe(c.signPayload);
  });
});
