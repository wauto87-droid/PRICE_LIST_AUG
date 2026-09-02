import { test } from "node:test";
import assert from "node:assert/strict";
import {
  preventArrowNumberInputChange,
  preventWheelNumberInputChange,
} from "../frontend/number-input";

test("Wheel-safe number handler prevents accidental wheel stepping and blurs the input", () => {
  let blurred = false;
  let prevented = false;
  preventWheelNumberInputChange({
    currentTarget: {
      blur() {
        blurred = true;
      },
    } as HTMLInputElement,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
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
