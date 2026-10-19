import test from "node:test";
import assert from "node:assert/strict";
import {
  extractLineEffectivePrice,
  findRepeatedItemPriceMismatches,
  formatPriceMismatchWarning,
  getMismatchedRowIndexes,
} from "../frontend/quotation-price-mismatch";

test("extractLineEffectivePrice prioritizes draft price, then final calculated, then custom unit price", () => {
  // Target draft takes priority when present
  assert.equal(
    extractLineEffectivePrice({
      targetPriceDraft: "125.50",
      price: { finalExcl: "100.00" },
    }),
    125.5,
  );

  // Fallback to price.finalExcl
  assert.equal(
    extractLineEffectivePrice({
      price: { finalExcl: "99.90" },
    }),
    99.9,
  );

  // Inclusive mode uses finalIncl
  assert.equal(
    extractLineEffectivePrice(
      {
        price: { finalExcl: "100.00", finalIncl: "115.00" },
      },
      true,
    ),
    115,
  );

  // Custom line unitPriceExcl
  assert.equal(
    extractLineEffectivePrice({
      input: { type: "CUSTOM", unitPriceExcl: "45.00" },
    }),
    45,
  );

  assert.equal(extractLineEffectivePrice(null), null);
  assert.equal(extractLineEffectivePrice({}), null);
});

test("findRepeatedItemPriceMismatches finds zero mismatches when prices are identical", () => {
  const lines = [
    {
      partNumber: "ITEM-A",
      price: { finalExcl: "50.00" },
    },
    {
      partNumber: "ITEM-B",
      price: { finalExcl: "75.00" },
    },
    {
      partNumber: "ITEM-A",
      price: { finalExcl: "50.00" },
    },
  ];

  const mismatches = findRepeatedItemPriceMismatches(lines, false, "SAR");
  assert.equal(mismatches.length, 0);

  const rowIndexes = getMismatchedRowIndexes(mismatches);
  assert.equal(rowIndexes.size, 0);
});

test("findRepeatedItemPriceMismatches detects differing prices and accurately reports line numbers", () => {
  const lines = [
    {
      partNumber: "BOLT-M8",
      description: "Hex Bolt",
      input: { quantity: "10" },
      price: { finalExcl: "10.00" },
    }, // Row 1
    {
      partNumber: "CABLE-3C",
      description: "Copper Cable",
      input: { quantity: "100" },
      price: { finalExcl: "25.00" },
    }, // Row 2
    {
      partNumber: "BOLT-M8",
      description: "Hex Bolt",
      input: { quantity: "5" },
      price: { finalExcl: "12.50" }, // Differing price!
    }, // Row 3
    {
      partNumber: "SWITCH-1P",
      description: "Single Pole Switch",
      input: { quantity: "2" },
      price: { finalExcl: "15.00" },
    }, // Row 4
    {
      partNumber: "CABLE-3C",
      description: "Copper Cable",
      input: { quantity: "50" },
      price: { finalExcl: "25.00" }, // Same price
    }, // Row 5
  ];

  const mismatches = findRepeatedItemPriceMismatches(lines, false, "SAR");
  assert.equal(mismatches.length, 1);

  const mismatch = mismatches[0];
  assert.equal(mismatch.partNumber, "BOLT-M8");
  assert.equal(mismatch.occurrences.length, 2);

  // 1-based row numbers
  assert.equal(mismatch.occurrences[0].rowNumber, 1);
  assert.equal(mismatch.occurrences[0].price, 10);
  assert.equal(mismatch.occurrences[1].rowNumber, 3);
  assert.equal(mismatch.occurrences[1].price, 12.5);

  const rowIndexes = getMismatchedRowIndexes(mismatches);
  assert.equal(rowIndexes.size, 2);
  assert.ok(rowIndexes.has(0)); // 0-based Row 1
  assert.ok(rowIndexes.has(2)); // 0-based Row 3
});

test("formatPriceMismatchWarning produces a clear bilingual warning message", () => {
  const fakeTranslate = (en: string, ar: string) => `${en} / ${ar}`;
  const mismatches = [
    {
      key: "ABC",
      partNumber: "ABC",
      description: "Special Filter",
      distinctPrices: [100, 120],
      occurrences: [
        {
          rowIndex: 1,
          rowNumber: 2,
          price: 100,
          formattedPrice: "100.00",
          quantity: "2",
        },
        {
          rowIndex: 4,
          rowNumber: 5,
          price: 120,
          formattedPrice: "120.00",
          quantity: "1",
        },
      ],
    },
  ];

  const message = formatPriceMismatchWarning(mismatches, fakeTranslate, "SAR");
  assert.ok(message.includes("Line / السطر 2: SAR 100.00"));
  assert.ok(message.includes("Line / السطر 5: SAR 120.00"));
  assert.ok(message.includes("ABC (Special Filter)"));
});
