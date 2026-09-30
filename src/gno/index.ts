/**
 * @gnolang/amino-ts/gno: schemas for every amino type of tm2 and gno.land
 * (transactions and messages, accounts, blocks, votes, validators, ABCI
 * results, events, genesis), generated from the Go type information, plus
 * helpers for addresses, coins and sign bytes.
 */

import {
  Codec,
  type CodecOptions,
} from "../codec";
import {
  registerGnoTypes,
} from "./types.gen";

export {
  bech32Decode,
  bech32Encode,
} from "./bech32";
export {
  ADDRESS_PREFIX,
  ADDRESS_SIZE,
  addressFromBech32,
  addressToBech32,
  type BalanceValue,
  type CoinValue,
  formatBalance,
  formatCoin,
  formatCoins,
  formatParam,
  MAX_COINS_COUNT,
  MAX_DENOM_LENGTH,
  type ParamValue,
  parseBalance,
  parseCoin,
  parseCoins,
  parseParam,
  validateDenom,
  type VestingScheduleValue,
} from "./reprs";
export {
  getSignaturePayload,
  getSignaturePayloadLegacy,
  SignDoc,
} from "./sign";
export {
  abci,
  auth,
  bank,
  bft,
  bitarray,
  chain,
  crypto,
  ed25519,
  gnoland,
  merkle,
  multisig,
  params,
  registerGnoTypes,
  sdk,
  secp256k1,
  std,
  vm,
} from "./types.gen";

/** A codec with every tm2 and gno.land type registered under its Go type URL. */
export function gnoCodec(options?: CodecOptions): Codec {
  return registerGnoTypes(new Codec(options));
}
