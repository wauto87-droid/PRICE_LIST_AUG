import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchingCustomLineIndexes,
  normalizedCustomReference,
} from "../frontend/Cart";

const custom = (partNumber: string, quantity = "1") => ({
  input: { type: "CUSTOM", partNumber, quantity },
});

test("Custom catalog replacement targets one row or identical references only", () => {
  const lines = [
    custom("BKJ63N-2P C32", "12"),
    custom(" bkj63n-2p c32 ", "18"),
    custom("BKJ63N-2P C50", "12"),
    custom("", "1"),
    { input: { type: "CATALOG", partNumber: "BKJ63N-2P C32" } },
  ];
  assert.equal(normalizedCustomReference(" bkj63n-2p c32 "), "BKJ63N-2P C32");
  assert.deepEqual(matchingCustomLineIndexes(lines, 0, "ROW"), [0]);
  assert.deepEqual(matchingCustomLineIndexes(lines, 0, "ALL_IDENTICAL"), [0, 1]);
  assert.deepEqual(matchingCustomLineIndexes(lines, 3, "ALL_IDENTICAL"), [3]);
});
