import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WorkflowCostReference from "../frontend/WorkflowCostReference";
import { publicQuote } from "../backend/quotations/service";
import { quotationHtml } from "../backend/pdf/template";

const cost = {
  cost: "16.0001",
  currency: "SAR",
  unit: "pcs",
  taxBasis: "Excluding VAT",
  supplier: "Private Supplier",
  actorName: "testt",
  ownerId: "owner",
  updatedAt: "2026-10-02T12:00:00Z",
};
const line = {
  unit: "pcs",
  partNumber: "LC1D12B7",
  description: "Contactor",
  workflowCost: cost,
  price: {
    quantity: "5",
    finalExcl: "70.00",
    finalIncl: "80.50",
    subtotal: "350.00",
    vatAmount: "52.50",
    total: "402.50",
    vatRate: "15",
  },
};
const render = (value: any, visible = true) =>
  renderToStaticMarkup(
    createElement(WorkflowCostReference, {
      line: value,
      visible,
      t: (en: string) => en,
    }),
  );

test("cost reference retains decimal precision and shows source details", () => {
  const html = render(line);
  assert.match(html, /Cost price: SAR 16\.0001\/pcs · Excluding VAT/);
  assert.match(html, /Updated by.*testt/);
  assert.match(html, /<details><summary[^>]*>Cost details/);
  assert.match(html, /Private Supplier/);
  assert.doesNotMatch(html, /70\.00/);
  assert.match(render({ ...line, price: { finalExcl: "90.00" } }), /16\.0001/);
});

test("pending, stale and incompatible reference states remain explicit", () => {
  assert.match(render({}), /Cost pending/);
  assert.match(
    render({
      ...line,
      workflowCost: {
        ...cost,
        stale: true,
        currency: "USD",
        unit: "box",
        taxBasis: "Unknown",
      },
    }),
    /Product changed — reconfirm cost/,
  );
  const changed = render({
    ...line,
    workflowCost: {
      ...cost,
      currency: "USD",
      unit: "box",
      taxBasis: "Unknown",
    },
  });
  assert.match(changed, /Different currency/);
  assert.match(changed, /Different unit/);
  assert.match(changed, /Tax basis not confirmed/);
  assert.equal(render(line, false), "");
});

test("server hides costs from unauthorized readers and customer quotation output excludes them", () => {
  const quote = {
    number: "DR-0049",
    status: "DRAFT",
    created_at: "2026-10-02T00:00:00Z",
    owner_id: "owner",
    customer: {},
    lines: [line],
    totals: { subtotal: "350.00", vat: "52.50", total: "402.50" },
  };
  const actor = (id: string, permissions: string[] = []) =>
    ({ id, permissions, role: "STAFF" }) as any;
  assert.equal(
    publicQuote(quote, actor("reader")).lines[0].workflowCost,
    undefined,
  );
  assert.equal(
    publicQuote(quote, actor("owner")).lines[0].workflowCost.cost,
    "16.0001",
  );
  assert.equal(
    publicQuote(quote, actor("account", ["COST_VIEW"])).lines[0].workflowCost
      .cost,
    "16.0001",
  );
  const html = quotationHtml(
    quote,
    {
      companyName: "AMT",
      currency: "SAR",
      pdfUnitPrices: "BOTH",
      quotation: {},
    },
    "",
  );
  assert.doesNotMatch(html, /16\.0001|Private Supplier|testt|Cost price/);
  assert.match(html, /70\.00/);
});
