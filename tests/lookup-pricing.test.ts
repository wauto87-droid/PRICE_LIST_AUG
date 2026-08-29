import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLookupLineRequest,
  normalizeLookupDiscountInput,
  normalizeLookupQuantityInput,
  previewLookupPrice,
} from "../frontend/lookup-pricing";

const product = {
  id: "00000000-0000-4000-8000-000000000123",
  partNumber: "LC1D09M7",
  description: "Contactor",
  unit: "pcs",
  quantityPrecision: 3,
  vat: "15",
  defaultLevel: "END_CUSTOMER" as const,
  sellingLevels: [{ code: "END_CUSTOMER" as const, masterExcl: "100.00" }],
  maxDiscount: "10",
};

const user = { maxDiscount: "25" };

test("Blank discount normalizes to zero for lookup requests", () => {
  assert.equal(normalizeLookupDiscountInput(""), "0");
  assert.equal(normalizeLookupDiscountInput("0"), "0");
  assert.equal(normalizeLookupDiscountInput("12."), "12");
  assert.equal(
    buildLookupLineRequest(product.id, "END_CUSTOMER", "1", "").discount,
    "0",
  );
});

test("Lookup quantity normalization accepts draft decimals and rejects blanks", () => {
  assert.equal(normalizeLookupQuantityInput("1"), "1");
  assert.equal(normalizeLookupQuantityInput("1.250"), "1.250");
  assert.equal(normalizeLookupQuantityInput("1."), "1");
  assert.equal(normalizeLookupQuantityInput(""), null);
});

test("Local lookup preview matches fixed-price discount math immediately", () => {
  const preview = previewLookupPrice(product, user, {
    sellingLevel: "END_CUSTOMER",
    quantity: "2",
    discount: "5",
    override: false,
    reason: "",
  });
  assert.equal(preview.finalExcl, "95.00");
  assert.equal(preview.subtotal, "190.00");
  assert.equal(preview.total, "218.50");
});

test("Lookup preview respects the current max allowed discount", () => {
  const preview = previewLookupPrice(
    { ...product, minimumEnabled: true, minimum: "90.00" },
    user,
    {
      sellingLevel: "END_CUSTOMER",
      quantity: "1",
      discount: "20",
      override: false,
      reason: "",
    },
  );
  assert.equal(preview.allowedDiscount, "10");
  assert.equal(preview.finalExcl, "90.00");
  assert.equal(preview.discountLimited, true);
});
