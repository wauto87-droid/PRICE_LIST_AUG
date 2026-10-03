import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pickupHtml, pickupInput } from "../backend/pdf/pickup";
const fixture = (internal: boolean) =>
  pickupInput.parse({
    documentId: randomUUID(),
    workflow: "REQ-PL-000001",
    number: "QT-001",
    customer: internal ? "Private Customer" : "",
    staff: "",
    supplier: internal ? "" : "ABC Trading",
    internal,
    order: {
      id: randomUUID(),
      number: "CO-000001",
      mode: "EARLY_AUTHORIZED",
      poNumber: "",
      revision: 1,
      createdAt: "2026-10-03T06:00:00Z",
      lines: [
        {
          lineId: "line",
          name: "Contactor / كونتاكتور",
          partNumber: "LC1D12B7",
          specifications: "24V 50/60Hz",
          unit: "pcs",
          quantity: "5",
          collected: "0",
          outstanding: "5",
          accountingCode: "Code pending",
          supplier: "ABC Trading",
          staff: [
            {
              id: "s",
              name: "Ahmed",
              taskId: "t",
              due: "",
              nextAction: "Collect from counter",
              done: false,
              blocker: "",
            },
          ],
          ...(internal
            ? { cost: "16.0001", currency: "SAR", taxBasis: "Excluding VAT" }
            : {}),
        },
      ],
    },
  });
test("official pickup template shows stable references, exact costs and early authorization", () => {
  const html = pickupHtml(
    fixture(true),
    {
      companyName: "AMT Electric",
      companyArabic: "أم تي",
      quotation: { footer: "Official footer" },
    },
    "",
  );
  assert.match(html, /PICKUP LIST/);
  assert.match(html, /CO-000001/);
  assert.match(html, /REQ-PL-000001/);
  assert.match(html, /16.0001/);
  assert.match(html, /CUSTOMER ORDER NOT CONFIRMED/);
  assert.match(html, /Code pending/);
  assert.match(html, /Official footer/);
});
test("supplier template excludes internal prices, customer information and quotation totals", () => {
  const html = pickupHtml(
    fixture(false),
    { companyName: "AMT Electric", quotation: {} },
    "",
  );
  assert.doesNotMatch(
    html,
    /16.0001|Cost price|Private Customer|Grand total|Subtotal/,
  );
  assert.match(html, /ABC Trading/);
  assert.match(html, /5 pcs/);
  assert.match(html, /not proof of collection/);
});
