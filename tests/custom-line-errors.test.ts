import test from "node:test";
import assert from "node:assert/strict";
import { humanizeCustomLineError } from "../frontend/custom-line-errors";

test("Custom line errors mention the failing line and field clearly", () => {
  assert.equal(
    humanizeCustomLineError(
      "Please correct the highlighted values — lines.2.unitPriceExcl: Use a positive decimal, without commas",
    ),
    "Line 3: Enter unit price as a number like 12.5 or 100, without commas.",
  );
  assert.equal(
    humanizeCustomLineError(
      "Please correct the highlighted values — lines.1.discount: Maximum is 100%",
    ),
    "Line 2: Discount cannot be more than 100%.",
  );
});
