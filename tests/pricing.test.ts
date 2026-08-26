import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculate,
  masterPrice,
  normalizePart,
  productInput,
  validateProduct,
  totals,
} from "../backend/pricing/engine";
const product = productInput.parse({
  partNumber: "LC1D09M7",
  description: "Contactor",
  method: "COST_MARKUP",
  cost: "100",
  markup: "25",
  vat: "15",
});
const policy = { maxDiscount: "100", canOverride: false };
const input = { quantity: "1", discount: "0", override: false, reason: "" };
test("Cost + markup example", () => {
  const p = calculate(product, policy, input);
  assert.equal(p.finalExcl, "125.00");
  assert.equal(p.vatAmount, "18.75");
  assert.equal(p.finalIncl, "143.75");
});
test("List minus discount example", () => {
  const p = calculate(
    {
      ...product,
      method: "LIST_DISCOUNT",
      listPrice: "100",
      baseDiscount: "40",
    },
    policy,
    input,
  );
  assert.equal(p.finalExcl, "60.00");
  assert.equal(p.vatAmount, "9.00");
  assert.equal(p.finalIncl, "69.00");
});
test("Floor clamps 20% request from 125 to 110", () => {
  const p = calculate(
    { ...product, minimumEnabled: true, minimum: "110" },
    policy,
    { ...input, discount: "20" },
  );
  assert.equal(p.finalExcl, "110.00");
  assert.equal(p.vatAmount, "16.50");
  assert.equal(p.finalIncl, "126.50");
  assert.equal(p.minimumReached, true);
  assert.equal(p.maxDiscount, "12");
});
test("Quantity uses final allowed unit price", () => {
  const p = calculate(
    { ...product, minimumEnabled: true, minimum: "110" },
    policy,
    { ...input, discount: "20", quantity: "5" },
  );
  assert.equal(p.subtotal, "550.00");
  assert.equal(p.vatAmount, "82.50");
  assert.equal(p.total, "632.50");
});
test("Line VAT rounding matches 273.13 example, not unit-inclusive multiplication", () => {
  const p = calculate(product, policy, {
    ...input,
    discount: "5",
    quantity: "2",
  });
  assert.equal(p.finalExcl, "118.75");
  assert.equal(p.finalIncl, "136.56");
  assert.equal(p.vatAmount, "35.63");
  assert.equal(p.total, "273.13");
});
test("Role limit applies before floor", () => {
  const p = calculate(
    {
      ...product,
      cost: "100",
      markup: "0",
      minimumEnabled: true,
      minimum: "95",
    },
    { maxDiscount: "10", canOverride: false },
    { ...input, discount: "20" },
  );
  assert.equal(p.finalExcl, "95.00");
  assert.equal(p.allowedDiscount, "10");
  assert.equal(p.effectiveDiscount, "5");
  assert.equal(p.discountLimited, true);
});
test("Override requires permission, explicit intent, and reason", () => {
  const p = { ...product, minimumEnabled: true, minimum: "110" };
  assert.throws(() =>
    calculate(p, policy, {
      ...input,
      discount: "20",
      override: true,
      reason: "Customer contract",
    }),
  );
  assert.throws(() =>
    calculate(
      p,
      { ...policy, canOverride: true },
      { ...input, discount: "20", override: true },
    ),
  );
  assert.equal(
    calculate(p, { ...policy, canOverride: true }, { ...input, discount: "20" })
      .finalExcl,
    "110.00",
  );
  assert.equal(
    calculate(
      p,
      { ...policy, canOverride: true },
      { ...input, discount: "20", override: true, reason: "Customer contract" },
    ).finalExcl,
    "100.00",
  );
});
test("Override does not bypass maximum role discount", () => {
  assert.equal(
    calculate(
      { ...product, minimumEnabled: true, minimum: "120" },
      { maxDiscount: "5", canOverride: true },
      { ...input, discount: "90", override: true, reason: "Approved" },
    ).finalExcl,
    "118.75",
  );
});
test("Floor cannot exceed master and floor must be cent-aligned", () => {
  assert.throws(() =>
    validateProduct({ ...product, minimumEnabled: true, minimum: "126" }),
  );
  assert.throws(() => validateProduct({ ...product, minimum: "0.001" }));
});
test("Fractional quantities and invalid quantities", () => {
  assert.equal(
    calculate({ ...product, quantityPrecision: 3 }, policy, {
      ...input,
      quantity: "1.125",
    }).subtotal,
    "140.63",
  );
  for (const quantity of ["0", "-1", "0.5", "1000001"])
    assert.throws(() => calculate(product, policy, { ...input, quantity }));
  assert.throws(() =>
    calculate({ ...product, quantityPrecision: 3 }, policy, {
      ...input,
      quantity: "1.0001",
    }),
  );
});
test("Zero price and VAT do not produce division errors", () => {
  const p = calculate({ ...product, cost: "0", vat: "0" }, policy, input);
  assert.equal(p.effectiveDiscount, "0");
  assert.equal(p.total, "0.00");
});
test("Normalization preserves meaningful internal punctuation", () => {
  assert.equal(normalizePart(" lc1d09m7 "), "LC1D09M7");
  assert.notEqual(normalizePart("A-1"), normalizePart("A1"));
});
test("Totals use decimal arithmetic", () => {
  const p = calculate(
    { ...product, cost: "0.1", markup: "0", vat: "0" },
    policy,
    input,
  );
  assert.equal(totals([p, p, p]).total, "0.30");
});
test("Half-cent master rounding is deterministic", () => {
  assert.equal(
    masterPrice({ ...product, cost: "1.005", markup: "0" }).toFixed(2),
    "1.01",
  );
});
