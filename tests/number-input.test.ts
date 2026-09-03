import { test } from "node:test";
import assert from "node:assert/strict";
import {
  preventArrowNumberInputChange,
  preventWheelNumberInputChange,
} from "../frontend/number-input";

test("Wheel-safe number handler blurs before passive wheel default handling", () => {
  let blurred = false;
  preventWheelNumberInputChange({
    currentTarget: {
      blur() {
        blurred = true;
      },
    } as HTMLInputElement,
  });
  assert.equal(blurred, true);
});

test("Discount number handler blocks keyboard arrow stepping only", () => {
  for (const key of ["ArrowUp", "ArrowDown", "1", "Tab"]) {
    let prevented = false;
    preventArrowNumberInputChange({
      key,
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, key === "ArrowUp" || key === "ArrowDown");
  }
});
