import test from "node:test";
import assert from "node:assert/strict";
import {
  cartLineHasBlockingError,
  catalogLivePricingInput,
  discountForTargetPrice,
  livePricingSignature,
} from "../frontend/cart-live-pricing";

test("Catalog live pricing accepts valid cart edits", () => {
  const line = {
    productId: "11111111-1111-1111-1111-111111111111",
    sellingLevel: "END_CUSTOMER",
    input: {
      quantity: "2",
      discount: "7.5",
    },
  };
  assert.deepEqual(catalogLivePricingInput(line), {
    productId: "11111111-1111-1111-1111-111111111111",
    sellingLevel: "END_CUSTOMER",
    quantity: "2",
    discount: "7.5",
    override: false,
    reason: "",
  });
  assert.equal(typeof livePricingSignature(line), "string");
  assert.equal(cartLineHasBlockingError(line), false);
});

test("Catalog final-price entry derives an exact bounded discount", () => {
  assert.deepEqual(discountForTargetPrice("192", "77"), {
    ok: true,
    target: "77.00",
    discount: "59.895833",
    aboveBase: false,
  });
  assert.deepEqual(discountForTargetPrice("192", "200"), {
    ok: true,
    target: "200.00",
    discount: "0",
    aboveBase: true,
  });
  assert.equal(discountForTargetPrice("192", "12.345").ok, false);
  assert.equal(discountForTargetPrice("192", "1,200").ok, false);
  assert.deepEqual(discountForTargetPrice("192", "0"), {
    ok: true,
    target: "0.00",
    discount: "100",
    aboveBase: false,
  });
});

test("Cart blocking rules reject invalid catalog and custom edits", () => {
  assert.equal(
    cartLineHasBlockingError({
      productId: "11111111-1111-1111-1111-111111111111",
      targetPriceError: true,
      input: { quantity: "2", discount: "0" },
    }),
    true,
  );
  assert.equal(
    cartLineHasBlockingError({
      productId: "11111111-1111-1111-1111-111111111111",
      input: { quantity: "2", discount: "120" },
    }),
    true,
  );
  assert.equal(
    cartLineHasBlockingError({
      input: {
        type: "CUSTOM",
        description: "Service",
        quantity: "1",
        unitPriceExcl: "",
        discount: "0",
      },
    }),
    true,
  );
});
