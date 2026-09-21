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

test("Client-side Zod JSON errors are humanized properly", () => {
  assert.equal(
    humanizeCustomLineError(
      JSON.stringify([
        {
          code: "invalid_format",
          path: ["unitPriceExcl"],
          message: "Use a positive decimal, without commas",
        },
      ]),
    ),
    "Enter unit price as a number like 12.5 or 100, without commas.",
  );
  assert.equal(
    humanizeCustomLineError(
      JSON.stringify([
        {
          code: "invalid_format",
          path: ["quantity"],
          message: "Use a positive decimal, without commas",
        },
      ]),
    ),
    "Enter quantity as a positive number without commas.",
  );
  assert.equal(
    humanizeCustomLineError(
      JSON.stringify([
        {
          code: "custom",
          path: ["discount"],
          message: "Maximum is 100%",
        },
      ]),
    ),
    "Discount cannot be more than 100%.",
  );
});
