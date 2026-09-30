/**
 * Real gno.land transactions, encoded and signed by the Go node code
 * (fixtures from gen/tx.go), through the public @gnolang/amino-ts/gno API.
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
  toHex,
} from "../src";
import {
  addressFromBech32,
  addressToBech32,
  bech32Decode,
  getSignaturePayload,
  getSignaturePayloadLegacy,
  gnoCodec,
  parseCoins,
  type SignDoc,
  std,
  vm,
} from "../src/gno";
import {
  utf8Decode,
} from "../src/utf8";

interface TxCase {
  name: string
  bin: string
  json: string
  chainId: string
  accountNumber: number
  sequence: number
  signPayload: string
  signPayloadLegacy: string
}

const {
  txs,
} = JSON.parse(readFileSync(new URL("../testdata/fixtures.json", import.meta.url), "utf8")) as {
  txs: TxCase[]
};
const cdc = gnoCodec();

describe.each(txs)("gno.land tx: $name", (c) => {
  it("round-trips binary", () => {
    const tx = cdc.unmarshal(std.Tx, fromHex(c.bin));
    expect(toHex(cdc.marshal(std.Tx, tx))).toBe(c.bin);
    expect(cdc.marshalJSON(std.Tx, tx)).toBe(c.json);
  });

  it("round-trips JSON", () => {
    const tx = cdc.unmarshalJSON(std.Tx, c.json);
    expect(cdc.marshalJSON(std.Tx, tx)).toBe(c.json);
    expect(toHex(cdc.marshal(std.Tx, tx))).toBe(c.bin);
  });

  it("builds the sign bytes Go signs", () => {
    const tx = cdc.unmarshal(std.Tx, fromHex(c.bin));
    const doc: SignDoc = {
      chainID: c.chainId,
      accountNumber: BigInt(c.accountNumber),
      sequence: BigInt(c.sequence),
      fee: tx.fee,
      msgs: tx.msgs,
      memo: tx.memo,
    };
    expect(utf8Decode(getSignaturePayload(cdc, doc))).toBe(c.signPayload);
    expect(utf8Decode(getSignaturePayloadLegacy(cdc, doc))).toBe(c.signPayloadLegacy);
  });
});

describe("gno helpers", () => {
  it("builds a MsgCall with typed values", () => {
    const caller = addressFromBech32("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5");
    const tx = cdc.marshalJSON(std.Tx, {
      msgs: [
        {
          typeUrl: "/vm.m_call",
          value: {
            caller,
            send: parseCoins("1000ugnot"),
            maxDeposit: [],
            pkgPath: "gno.land/r/demo/counter",
            func: "Incr",
            args: null,
          } satisfies Infer<typeof vm.MsgCall>,
        },
      ],
      fee: {
        gasWanted: 1000000n,
        gasFee: {
          denom: "ugnot",
          amount: 1000n,
        },
      },
      signatures: null,
      memo: "",
    });
    expect(tx).toBe("{\"msg\":[{\"@type\":\"/vm.m_call\",\"caller\":\"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5\","
      + "\"send\":\"1000ugnot\",\"max_deposit\":\"\",\"pkg_path\":\"gno.land/r/demo/counter\",\"func\":\"Incr\"}],"
      + "\"fee\":{\"gas_wanted\":\"1000000\",\"gas_fee\":\"1000ugnot\"},\"signatures\":null,\"memo\":\"\"}");
    expect(addressToBech32(caller)).toBe("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5");
  });

  it("rejects messages that are not std.Msg", () => {
    expect(() => cdc.marshal(std.Tx, {
      msgs: [
        {
          typeUrl: "/std.Fee",
          value: {
            gasWanted: 0n,
            gasFee: {
              denom: "",
              amount: 0n,
            },
          },
        },
      ],
      fee: {
        gasWanted: 0n,
        gasFee: {
          denom: "",
          amount: 0n,
        },
      },
      signatures: null,
      memo: "",
    })).toThrow(/not assignable to interface std.Msg/);
  });

  it("parses coins like std.ParseCoins", () => {
    expect(parseCoins(" 2ugnot,1atom ")).toEqual([
      {
        denom: "atom",
        amount: 1n,
      },
      {
        denom: "ugnot",
        amount: 2n,
      },
    ]);
    expect(() => parseCoins("1ugnot,2ugnot")).toThrow(/duplicate/);
    expect(() => parseCoins("0ugnot")).toThrow(/non-positive/);
    expect(() => parseCoins("1UGNOT")).toThrow(/invalid coin/);
    expect(() => parseCoins("9223372036854775808ugnot")).toThrow(/amount/);
  });

  it("decodes bech32 like btcutil", () => {
    const upper = "G1JG8MTUTU9KHHFWC4NXMUHCPFTF0PAJDHFVSQF5";
    expect(bech32Decode(upper).prefix).toBe("g");
    expect(() => bech32Decode("g1Jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")).toThrow(/case/);
    expect(() => addressFromBech32("cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a")).toThrow(/prefix/);
  });
});
