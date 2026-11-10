import test from "node:test";
import assert from "node:assert/strict";
import {
  extractActiveDeliveryNotes,
  syncQuotationReference,
  stripDeliveryNotesFromReference,
  syncQuotationNotes,
  syncQuotationDeliveryMeta,
  importedDeliveryMeta,
  sortLinesByDeliveryNote,
} from "../backend/quotations/delivery-sync";
import { formatDeliveryDateDisplay } from "../backend/pricing/normalize";
import { isEmptyDraftRow, createBlankEntryLine } from "../frontend/Cart";
import { quotationHtml } from "../backend/pdf/template";

test("extractActiveDeliveryNotes extracts and deduplicates active DN docNos and dates", () => {
  const lines = [
    {
      importMeta: { source: "DELIVERY_NOTE", docNo: "1924", docDate: "2026-09-28" },
      partNumber: "A9F44363",
    },
    {
      input: {
        importMeta: { source: "DELIVERY_NOTE", docNo: "1924", docDate: "2026-09-28" },
      },
      partNumber: "3NA3830",
    },
    {
      importMeta: { source: "DELIVERY_NOTE", docNo: "2005", docDate: "2026-10-05" },
      partNumber: "ABN103c-60A",
    },
    {
      partNumber: "NON_DN_ITEM",
    },
  ];

  const { docNos, dates } = extractActiveDeliveryNotes(lines);
  assert.deepEqual(docNos, ["1924", "2005"]);
  assert.deepEqual(dates, ["2026-09-28", "2026-10-05"]);
});

test("syncQuotationReference updates stale delivery note references with active ones", () => {
  // Stale reference with older removed DNs
  const currentRef = "Delivery notes: 1661, 1679, 1684, 1694, 1827, 1903";
  const updated = syncQuotationReference(currentRef, ["1924"]);
  assert.equal(updated, "Delivery notes: 1924");

  // Multiple active DNs
  const multiUpdated = syncQuotationReference(currentRef, ["1924", "2005"]);
  assert.equal(multiUpdated, "Delivery notes: 1924, 2005");
});

test("syncQuotationReference preserves custom reference while updating delivery notes", () => {
  const currentRef = "PO-9944 · Delivery notes: 1661, 1679";
  const updated = syncQuotationReference(currentRef, ["1924"]);
  assert.equal(updated, "PO-9944 · Delivery notes: 1924");
});

test("syncQuotationReference prunes delivery notes when no active delivery notes remain", () => {
  const currentRef = "Delivery notes: 1661, 1679";
  assert.equal(syncQuotationReference(currentRef, []), "");

  const customAndDn = "PO-8888 · Delivery notes: 1661, 1679";
  assert.equal(syncQuotationReference(customAndDn, []), "PO-8888");

  const dnAndCustom = "Delivery notes: 1661, 1679 · Project Beta";
  assert.equal(syncQuotationReference(dnAndCustom, []), "Project Beta");
});

test("stripDeliveryNotesFromReference strips delivery notes to protect customer master record", () => {
  assert.equal(
    stripDeliveryNotesFromReference("Delivery notes: 1661, 1679, 1827"),
    "",
  );
  assert.equal(
    stripDeliveryNotesFromReference("VIP Account · Delivery notes: 1661"),
    "VIP Account",
  );
});

test("syncQuotationNotes synchronizes dates and docNos while preserving user notes", () => {
  const staleNotes = [
    "Please pack carefully in two boxes",
    "Delivery dates: 2026-09-28, 2026-10-05, 2026-10-08",
    "Imported from delivery notes: 1924, 2005, 2006, 2008, 2033, 2036",
    "Call 0501234567 on arrival",
  ].join("\n");

  const activeDocNos = ["1924"];
  const activeDates = ["2026-09-28"];

  const updatedNotes = syncQuotationNotes(staleNotes, activeDocNos, activeDates);
  assert.equal(
    updatedNotes,
    [
      "Please pack carefully in two boxes",
      "Call 0501234567 on arrival",
      "Delivery dates: 28-09-26",
      "Imported from delivery notes: 1924",
    ].join("\n"),
  );
});

test("syncQuotationNotes removes delivery note lines when all delivery rows are removed", () => {
  const staleNotes = [
    "Delivery dates: 2026-09-28, 2026-10-05",
    "Imported from delivery notes: 1924, 2005",
  ].join("\n");

  assert.equal(syncQuotationNotes(staleNotes, [], []), "");

  const withUserNotes = [
    "Customer requested net 30 payment",
    "Delivery dates: 2026-09-28",
    "Imported from delivery notes: 1924",
  ].join("\n");

  assert.equal(
    syncQuotationNotes(withUserNotes, [], []),
    "Customer requested net 30 payment",
  );
});

test("syncQuotationDeliveryMeta synchronizes customer object with active lines", () => {
  const lines = [
    {
      importMeta: { source: "DELIVERY_NOTE", docNo: "1924", docDate: "2026-09-28" },
      partNumber: "A9F44363",
    },
  ];
  const customer = {
    name: "MAX TOOLS ESTABLISHMENT",
    number: "8646",
    reference: "Delivery notes: 1661, 1679, 1684, 1694, 1827, 1903",
    notes: [
      "Delivery dates: 2026-09-28, 2026-10-05, 2026-10-08",
      "Imported from delivery notes: 1924, 2005, 2006, 2008, 2033, 2036",
    ].join("\n"),
  };

  const synced = syncQuotationDeliveryMeta(lines, customer);
  assert.equal(synced.reference, "Delivery notes: 1924");
  assert.equal(
    synced.notes,
    ["Delivery dates: 28-09-26", "Imported from delivery notes: 1924"].join("\n"),
  );
});

test("quotationHtml prints only active delivery notes and prunes stale ones", () => {
  const q = {
    number: "DR-0077",
    status: "DRAFT",
    created_at: new Date().toISOString(),
    customer: {
      name: "MAX TOOLS ESTABLISHMENT",
      number: "8646",
      reference: "Delivery notes: 1661, 1679, 1684, 1694, 1827, 1903",
      notes: [
        "Delivery dates: 2026-09-28, 2026-10-05, 2026-10-08",
        "Imported from delivery notes: 1924, 2005, 2006, 2008, 2033, 2036",
      ].join("\n"),
    },
    lines: [
      {
        partNumber: "A9F44363",
        description: "ACTI9 IC60N 3P 63A C MCB",
        unit: "pcs",
        price: { quantity: "2", finalExcl: "106", subtotal: "212", vatAmount: "31.8", vatRate: "15", total: "243.8" },
        importMeta: { source: "DELIVERY_NOTE", docNo: "1924", docDate: "2026-09-28", rowNumber: 2 },
      },
      {
        partNumber: "3NA3830",
        description: "LV HRC fuse element",
        unit: "pcs",
        price: { quantity: "2", finalExcl: "35", subtotal: "70", vatAmount: "10.5", vatRate: "15", total: "80.5" },
      },
    ],
    totals: { subtotal: "282", vat: "42.3", total: "324.3" },
  };

  const html = quotationHtml(q, { companyName: "AMT", quotation: { validityDays: 30 } }, "");

  // Stale delivery notes should NOT be in the HTML
  assert.ok(!html.includes("1661"), "Stale DN 1661 should not appear in HTML");
  assert.ok(!html.includes("1679"), "Stale DN 1679 should not appear in HTML");
  assert.ok(!html.includes("2005"), "Stale DN 2005 should not appear in HTML");
  assert.ok(!html.includes("2026-10-05"), "Stale date 2026-10-05 should not appear in HTML");

  // Active delivery note 1924 SHOULD be in the HTML
  assert.ok(html.includes("Delivery notes: 1924"), "Active DN 1924 should appear in Reference");
  assert.ok(html.includes("Imported from delivery notes: 1924"), "Active DN 1924 should appear in Notes");
  assert.ok(html.includes("Delivery dates: 28-09-26"), "Active date should appear in Notes");
  assert.ok(html.includes("DN: 1924 · Date: 28-09-26"), "Line item should show DN info");
});

test("formatDeliveryDateDisplay formats dates strictly to DD-MM-YY", () => {
  assert.equal(formatDeliveryDateDisplay("2026-10-29"), "29-10-26");
  assert.equal(formatDeliveryDateDisplay("2026-09-08"), "08-09-26");
  assert.equal(formatDeliveryDateDisplay("29-10-26"), "29-10-26");
  assert.equal(formatDeliveryDateDisplay("29-10-2026"), "29-10-26");
  assert.equal(formatDeliveryDateDisplay(""), "");
});

test("sortLinesByDeliveryNote sorts items by DN number ascending (oldest to newest / smallest to largest)", () => {
  const lines = [
    { partNumber: "ITEM-2276", importMeta: { source: "DELIVERY_NOTE", docNo: "2276", docDate: "2026-10-29" } },
    { partNumber: "ITEM-2242", importMeta: { source: "DELIVERY_NOTE", docNo: "2242", docDate: "2026-10-27" } },
    { partNumber: "ITEM-2383-A", importMeta: { source: "DELIVERY_NOTE", docNo: "2383", docDate: "2026-11-09", rowNumber: 1 } },
    { partNumber: "ITEM-2100", importMeta: { source: "DELIVERY_NOTE", docNo: "2100", docDate: "2026-10-14" } },
    { partNumber: "ITEM-2143", importMeta: { source: "DELIVERY_NOTE", docNo: "2143", docDate: "2026-10-18" } },
    { partNumber: "ITEM-2383-B", importMeta: { source: "DELIVERY_NOTE", docNo: "2383", docDate: "2026-11-09", rowNumber: 2 } },
    { partNumber: "CUSTOM-NO-DN", source: "CUSTOM", input: { type: "CUSTOM", description: "Standalone" } },
  ];

  const sorted = sortLinesByDeliveryNote(lines);
  const partOrder = sorted.map((l: any) => l.partNumber);
  assert.deepEqual(partOrder, [
    "ITEM-2100",
    "ITEM-2143",
    "ITEM-2242",
    "ITEM-2276",
    "ITEM-2383-A",
    "ITEM-2383-B",
    "CUSTOM-NO-DN",
  ]);
});

test("isEmptyDraftRow identifies empty trailing entry placeholder lines", () => {
  const blankLine = createBlankEntryLine();
  assert.equal(isEmptyDraftRow(blankLine), true);

  const filledLine = {
    ...blankLine,
    input: { ...blankLine.input, quantity: "5", unitPriceExcl: "100" },
  };
  assert.equal(isEmptyDraftRow(filledLine), false);

  const dnLine = {
    partNumber: "ENS-705025",
    importMeta: { source: "DELIVERY_NOTE", docNo: "2276" },
  };
  assert.equal(isEmptyDraftRow(dnLine), false);
});
