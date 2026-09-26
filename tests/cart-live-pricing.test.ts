import test from "node:test";
import assert from "node:assert/strict";
import {
  cartLineHasBlockingError,
  catalogLivePricingInput,
  normalizeTargetPrice,
  livePricingSignature,
  recoverImportedCustomUnitPrice,
} from "../frontend/cart-live-pricing";

test("Catalog live pricing accepts valid cart edits", () => {
  const line = {
    productId: "11111111-1111-1111-1111-111111111111",
    sellingLevel: "END_CUSTOMER",
    input: {
      type: "CATALOG",
      quantity: "2",
      discount: "7.5",
      importMeta: { source: "DELIVERY_NOTE", docNo: "1614" },
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

test("Catalog live pricing preserves markup and supports target-price requests", () => {
  const line = {
    productId: "11111111-1111-1111-1111-111111111111",
    input: { quantity: "1", discount: "0", markup: "54" },
  };
  assert.equal((catalogLivePricingInput(line) as any).markup, "54");
  assert.deepEqual(
    catalogLivePricingInput({
      ...line,
      targetPriceRequested: "77.00",
    }),
    {
      productId: line.productId,
      sellingLevel: "END_CUSTOMER",
      quantity: "1",
      targetFinalExcl: "77.00",
      override: false,
      reason: "",
    },
  );
});

test("Catalog final-price entry validates and canonicalizes money", () => {
  assert.deepEqual(normalizeTargetPrice("77"), {
    ok: true,
    target: "77.00",
  });
  assert.deepEqual(normalizeTargetPrice("200."), {
    ok: true,
    target: "200.00",
  });
  assert.equal(normalizeTargetPrice("12.345").ok, false);
  assert.equal(normalizeTargetPrice("1,200").ok, false);
  assert.deepEqual(normalizeTargetPrice("0"), {
    ok: true,
    target: "0.00",
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
      price: { adjustmentMode: "MARKUP" },
      input: { quantity: "1", discount: "20" },
    }),
    true,
  );
  assert.equal(
    cartLineHasBlockingError({
      productId: "11111111-1111-1111-1111-111111111111",
      price: { adjustmentMode: "DISCOUNT" },
      input: { quantity: "1", discount: "0", markup: "20" },
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

test("Delivery custom rows recover a legacy unit price stored as an impossible discount", () => {
  const input = {
    type: "CUSTOM",
    partNumber: "ENS 504015",
    description: "Enclosure",
    quantity: "1",
    unitPriceExcl: "0",
    discount: "115",
    importMeta: { source: "DELIVERY_NOTE", docNo: "1758" },
  };
  const repaired = recoverImportedCustomUnitPrice(input);
  assert.equal(repaired.unitPriceExcl, "115");
  assert.equal(repaired.discount, "0");
  assert.equal(repaired.importMeta.recoveredUnitPrice, true);
  assert.equal(cartLineHasBlockingError({ input: repaired }), false);
  const unrelated = { ...input, importMeta: { source: "OTHER" } };
  assert.equal(recoverImportedCustomUnitPrice(unrelated), unrelated);
  const validLargeMarkup = { ...input, discount: "0", markup: "115" };
  assert.equal(
    recoverImportedCustomUnitPrice(validLargeMarkup),
    validLargeMarkup,
  );
});
