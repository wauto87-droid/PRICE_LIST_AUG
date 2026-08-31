import test from "node:test";
import assert from "node:assert/strict";
import {
  formatReusableDiscount,
  formatReusablePrice,
  moveReusableIndex,
} from "../frontend/reusable-search";

test("Reusable search formats saved prices for staff", () => {
  assert.equal(formatReusablePrice("1000.000000"), "1,000.00");
  assert.equal(formatReusablePrice("2"), "2.00");
  assert.equal(formatReusableDiscount("0.0000"), "0");
  assert.equal(formatReusableDiscount("12.5000"), "12.5");
});
test("Reusable search keyboard index wraps safely", () => {
  assert.equal(moveReusableIndex(-1, 1, 3), 0);
  assert.equal(moveReusableIndex(-1, -1, 3), 2);
  assert.equal(moveReusableIndex(2, 1, 3), 0);
  assert.equal(moveReusableIndex(0, -1, 3), 2);
  assert.equal(moveReusableIndex(0, 1, 0), -1);
});
