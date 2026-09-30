/** Differential tests of every tm2 and gno.land type shipped in @gnolang/amino-ts/gno. */

import {
  gnoCodec,
} from "../src/gno";
import {
  runFixtures,
} from "./differential";

const cdc = gnoCodec({
  strictUtf8: true,
});

// Fixture types are named by their type URL.
runFixtures("gno-fixtures.json", cdc, url => cdc.lookupTypeUrl(url));
