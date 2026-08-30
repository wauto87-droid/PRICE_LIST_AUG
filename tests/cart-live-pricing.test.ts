import test from "node:test";
import assert from "node:assert/strict";
import {
  cartLineHasBlockingError,
  catalogLivePricingInput,
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

test("Cart blocking rules reject invalid catalog and custom edits", () => {
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
