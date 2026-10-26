/**
 * A master-key signature has a zero session address, which must have no wire
 * presence: nodes accept only the canonical encoding of a transaction
 * (gnolang/gno#6404), and the Go encoder omits the field when it is zero.
 */
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  fromHex,
  toHex,
} from "../src";
import {
  addressFromBech32,
  gnoCodec,
  parseCoins,
  std,
} from "../src/gno";

const cdc = gnoCodec();
const zero = new Uint8Array(20);

describe("std.SessionAddress", () => {
  it("omits a zero session address in binary and JSON", () => {
    const sig = {
      pubKey: null,
      signature: new TextEncoder().encode("sig"),
      sessionAddr: zero,
    };
    expect(toHex(cdc.marshal(std.Signature, sig))).toBe("1203736967");
    expect(cdc.marshalJSON(std.Signature, sig)).toBe("{\"pub_key\":null,\"signature\":\"c2ln\"}");
    expect(cdc.unmarshal(std.Signature, fromHex("1203736967")).sessionAddr).toEqual(zero);
  });

  it("round-trips a session-signed signature", () => {
    const session = addressFromBech32("g18ua0rm8th52pp26p0mqdy7aledwngrshxah6rt");
    const sig = {
      pubKey: null,
      signature: new Uint8Array([1]),
      sessionAddr: session,
    };
    const bin = cdc.marshal(std.Signature, sig);
    expect(toHex(bin)).toBe("120101" + "1a28" + toHex(new TextEncoder().encode("g18ua0rm8th52pp26p0mqdy7aledwngrshxah6rt")));
    expect(cdc.unmarshal(std.Signature, bin)).toEqual(sig);
  });

  it("encodes a master-key tx exactly as the Go encoder", () => {
    // Canonical bytes produced by tm2 amino for this tx at gnolang/gno#6404.
    const goBytes = "0a700a0d2f62616e6b2e4d736753656e64125f0a28673134683777326e366a6e767334666337727678613738613735726b63787834636863756a6677671228673176636c3272306c6c753570633730637637656e6c7a6e7a7a326c686c327474686433726876701a093130303075676e6f7412130880dac409120c3230303030303075676e6f741a7e0a3a0a132f746d2e5075624b6579536563703235366b3112230a210211111111111111111111111111111111111111111111111111111111111111111240abababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababab";
    const tx = {
      msgs: [
        {
          typeUrl: "/bank.MsgSend",
          value: {
            fromAddress: addressFromBech32("g14h7w2n6jnvs4fc7rvxa78a75rkcxx4chcujfwg"),
            toAddress: addressFromBech32("g1vcl2r0llu5pc70cv7enlznzz2lhl2tthd3rhvp"),
            amount: parseCoins("1000ugnot"),
          },
        },
      ],
      fee: {
        gasWanted: 10000000n,
        gasFee: {
          denom: "ugnot",
          amount: 2000000n,
        },
      },
      signatures: [
        {
          pubKey: {
            typeUrl: "/tm.PubKeySecp256k1",
            value: fromHex("02" + "11".repeat(32)),
          },
          signature: fromHex("ab".repeat(64)),
          sessionAddr: zero,
        },
      ],
      memo: "",
    };
    expect(toHex(cdc.marshal(std.Tx, tx))).toBe(goBytes);
  });
});
