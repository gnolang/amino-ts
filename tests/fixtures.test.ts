/** Differential tests of every amino feature, on the types in gen/types.go. */

import {
  runFixtures,
} from "./differential";
import {
  newCodec,
  schemas,
} from "./schemas";

// The gen/ types have no generated Go code, so Go decodes them by reflection.
runFixtures("fixtures.json", newCodec({
  strictUtf8: true,
  goDecoder: "reflect",
}), name => schemas[name as keyof typeof schemas]);
