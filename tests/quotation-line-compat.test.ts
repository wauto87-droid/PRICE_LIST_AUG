import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Cart from "../frontend/Cart";
import { savedLineInput } from "../backend/quotations/service";
import {
  normalizeEditableQuotationCart,
  normalizeEditableQuotationLine,
  quotationSellingLevel,
} from "../shared/quotation-line-compat";

const catalogLine = {
  source: "CATALOG",
  productId: "11111111-1111-4111-8111-111111111111",
  partNumber: "LEGACY-1",
  description: "Legacy catalog line",
  sellingLevel: "RETAIL",
  price: {
    quantity: "2.5",
    requestedDiscount: "7",
    finalExcl: "93.00",
    subtotal: "232.50",
    vatAmount: "34.88",
    total: "267.38",
  },
};

test("legacy catalog lines without input are normalized without changing saved evidence", () => {
  const normalized = normalizeEditableQuotationLine(catalogLine);
  assert.equal(normalized.input.type, "CATALOG");
  assert.equal(normalized.input.productId, catalogLine.productId);
  assert.equal(normalized.input.sellingLevel, "RETAIL");
  assert.equal(normalized.input.quantity, "2.5");
  assert.equal(normalized.input.discount, "7");
  assert.equal(normalized.compatibilityIssue, undefined);
  assert.deepEqual(catalogLine.price, normalized.price);
  assert.equal((catalogLine as any).input, undefined);
  assert.equal(savedLineInput(catalogLine).sellingLevel, "RETAIL");
});

test("explicit custom lines recover editable fields while ambiguous rows stay blocked", () => {
  const custom = normalizeEditableQuotationLine({
    source: "CUSTOM",
    partNumber: "CUSTOM-1",
    description: "Recovered custom item",
    unit: "BOX",
    price: { quantity: "3", finalExcl: "12.50" },
  });
  assert.deepEqual(
    {
      type: custom.input.type,
      partNumber: custom.input.partNumber,
      description: custom.input.description,
      unit: custom.input.unit,
      quantity: custom.input.quantity,
      unitPriceExcl: custom.input.unitPriceExcl,
    },
    {
      type: "CUSTOM",
      partNumber: "CUSTOM-1",
      description: "Recovered custom item",
      unit: "BOX",
      quantity: "3",
      unitPriceExcl: "12.50",
    },
  );
  assert.equal(custom.compatibilityIssue, undefined);

  const ambiguous = normalizeEditableQuotationLine({
    partNumber: "UNKNOWN-1",
    description: "Identity was not saved",
    price: { quantity: "1", finalExcl: "10" },
  });
  assert.match(
    ambiguous.compatibilityIssue,
    /missing its catalog or custom-item identity/,
  );
  assert.throws(
    () => savedLineInput(ambiguous),
    /missing its catalog or custom-item identity/,
  );
});

test("Cart renders a missing-input catalog line and displays incomplete-line errors", () => {
  const validCart = normalizeEditableQuotationCart({
    customer: {
      name: "Legacy buyer",
      number: "",
      mobile: "",
      reference: "",
      notes: "",
    },
    lines: [catalogLine],
  });
  assert.equal(quotationSellingLevel(validCart.lines[0]), "RETAIL");
  const validHtml = renderToStaticMarkup(
    React.createElement(Cart, {
      t: (en: string) => en,
      user: { id: "owner", permissions: [] },
      cart: validCart,
      setCart() {},
      settings: { vat: "15" },
      online: true,
      onSaved() {},
    }),
  );
  assert.match(validHtml, /Legacy catalog line/);
  assert.match(validHtml, /value="RETAIL"/);

  const incompleteHtml = renderToStaticMarkup(
    React.createElement(Cart, {
      t: (en: string) => en,
      user: { id: "owner", permissions: [] },
      cart: {
        customer: {
          name: "Buyer",
          number: "",
          mobile: "",
          reference: "",
          notes: "",
        },
        lines: [
          {
            partNumber: "UNKNOWN-1",
            description: "Incomplete",
            price: { quantity: "1", finalExcl: "10" },
          },
        ],
      },
      setCart() {},
      settings: { vat: "15" },
      online: true,
      onSaved() {},
    }),
  );
  assert.match(incompleteHtml, /missing its catalog or custom-item identity/);
  assert.match(incompleteHtml, /Save quotation<\/button>/);
  assert.match(incompleteHtml, /disabled=""[^>]*>Save quotation/);
});
