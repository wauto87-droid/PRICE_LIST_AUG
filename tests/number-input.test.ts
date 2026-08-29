import { test } from "node:test";
import assert from "node:assert/strict";
import { preventWheelNumberInputChange } from "../frontend/number-input";

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
