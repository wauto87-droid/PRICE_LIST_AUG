import { test } from "node:test";
import assert from "node:assert/strict";
import { describeHistory } from "../frontend/history-details";
const t = (en: string) => en;
test("Product audit entries use business language and calculated selling prices", () => {
  const entry = describeHistory(
    {
      action: "PRODUCT_CREATE",
      actor: "AMT Preview Admin",
      before_value: null,
      after_value: {
        partNumber: "AMT-TIER-DEMO",
        description: "Distribution item",
        cost: "80",
        vat: "15",
        unit: "pcs",
        active: true,
        method: "COST_MARKUP",
        markup: "25",
        listPrice: "0",
        baseDiscount: "0",
        minimumEnabled: true,
        minimum: "85",
        quantityPrecision: 3,
        aliases: [],
        brand: "",
        category: "",
        keywords: "",
        defaultLevel: "RETAIL",
        levels: [
          {
            code: "WHOLESALE",
            active: true,
            method: "FIXED",
            fixedPrice: "90",
            markup: "0",
            listPrice: "0",
            baseDiscount: "0",
          },
          {
            code: "RETAIL",
            active: true,
            method: "COST_MARKUP",
            fixedPrice: "0",
            markup: "25",
            listPrice: "0",
            baseDiscount: "0",
          },
          {
            code: "END_CUSTOMER",
            active: true,
            method: "LIST_DISCOUNT",
            fixedPrice: "0",
            markup: "0",
            listPrice: "200",
            baseDiscount: "40",
          },
        ],
      },
    },
    t,
  );
  assert.equal(entry.title, "Product added");
  assert.equal(entry.subject, "AMT-TIER-DEMO");
  assert.deepEqual(entry.highlights, [
    "Wholesale: SAR 90.00",
    "Retail: SAR 100.00",
    "End Customer: SAR 120.00",
    "Default: Retail",
  ]);
  assert(
    entry.changes.some(
      (change) =>
        change.label === "Minimum price before VAT" &&
        change.after === "SAR 85.00",
    ),
  );
  assert(
    entry.changes.every(
      (change) => !/[{}_\[\]"]/.test(change.label + change.after),
    ),
  );
});
test("Unknown technical audit actions degrade to a clear sentence without JSON", () => {
  const entry = describeHistory(
    {
      action: "FUTURE_INTERNAL_EVENT",
      before_value: { internal: { secret: true } },
      after_value: { internal: { secret: false } },
    },
    t,
  );
  assert.equal(entry.title, "Activity recorded");
  assert.deepEqual(entry.changes, []);
  assert.deepEqual(entry.highlights, []);
});
