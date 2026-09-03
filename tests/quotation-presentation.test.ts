import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quotationPdfDisposition,
  quotationPdfFilename,
} from "../backend/pdf/filename";
import { quotationHtml } from "../backend/pdf/template";
import { embedded, migrate } from "../backend/core/db";
import { nextDraftNumber } from "../backend/quotations/service";

test("Short draft numbers are globally unique under concurrent allocation", async () => {
  const db = await embedded();
  try {
    await migrate(db);
    const numbers = await Promise.all(
      Array.from({ length: 8 }, () =>
        nextDraftNumber(db, { draftPrefix: "DR" }),
      ),
    );
    assert.equal(new Set(numbers).size, numbers.length);
    assert(numbers.every((number) => /^DR-\d{4,}$/.test(number)));
  } finally {
    await db.close?.();
  }
});

test("Quotation PDF filenames use the snapshotted number and safe customer name", () => {
  assert.equal(
    quotationPdfFilename({
      number: "AMT-QT-000001",
      customer: { name: "Al Jaleel Trading" },
    }),
    "AMT-QT-000001 - Al Jaleel Trading.pdf",
  );
  assert.equal(
    quotationPdfFilename({
      number: "DR-0001",
      customer: { name: "Walk-in Customer" },
    }),
    "DR-0001.pdf",
  );
  assert.equal(
    quotationPdfFilename({
      number: "QT/12\r\nInjected: yes",
      customer: { name: 'شركة: الاختبار/"فرع"' },
    }),
    "QT 12 Injected yes - شركة الاختبار فرع.pdf",
  );
  const disposition = quotationPdfDisposition({
    number: "QT-0002",
    customer: { name: "شركة الكهرباء" },
  });
  assert.match(disposition, /^attachment; filename="[\x20-\x7e]+";/);
  assert.match(disposition, /filename\*=UTF-8''QT-0002%20-%20/);
  assert.doesNotMatch(disposition, /[\r\n]/);
});

test("Customer notes print once after totals and before quotation terms", () => {
  const html = quotationHtml(
    {
      number: "DR-0001",
      status: "DRAFT",
      created_at: "2026-08-30T00:00:00Z",
      customer: {
        name: "Customer",
        number: "",
        mobile: "",
        reference: "REF-1",
        notes: "Call before delivery",
      },
      lines: [],
      totals: { subtotal: "0.00", vat: "0.00", total: "0.00" },
    },
    {
      companyName: "AMT Electric",
      companyArabic: "",
      currency: "SAR",
      pdfUnitPrices: "BOTH",
      quotation: {},
    },
    "data:image/svg+xml;base64,AA==",
  );
  assert.equal(html.match(/Call before delivery/g)?.length, 1);
  assert(
    html.indexOf('class="totals"') < html.indexOf('class="customer-notes"'),
  );
  assert(
    html.indexOf('class="customer-notes"') < html.indexOf('class="terms"'),
  );

  const blank = quotationHtml(
    {
      number: "DR-0002",
      status: "DRAFT",
      created_at: "2026-08-30T00:00:00Z",
      customer: { name: "", number: "", mobile: "", reference: "", notes: "" },
      lines: [],
      totals: { subtotal: "0.00", vat: "0.00", total: "0.00" },
    },
    {
      companyName: "AMT Electric",
      companyArabic: "",
      currency: "SAR",
      pdfUnitPrices: "BOTH",
      quotation: {},
    },
    "data:image/svg+xml;base64,AA==",
  );
  assert.doesNotMatch(blank, /class="customer-notes"/);
});

test("Customer-facing quotation output omits internal discount percentages", () => {
  const html = quotationHtml(
    {
      number: "DR-0003",
      status: "DRAFT",
      created_at: "2026-09-02T00:00:00Z",
      customer: { name: "Customer", number: "", mobile: "", reference: "" },
      lines: [
        {
          partNumber: "ITEM-1",
          description: "Item",
          source: "CATALOG",
          unit: "pcs",
          price: {
            quantity: "1",
            finalExcl: "80.00",
            finalIncl: "92.00",
            effectiveDiscount: "20",
            subtotal: "80.00",
            vatAmount: "12.00",
            vatRate: "15",
            total: "92.00",
          },
        },
      ],
      totals: { subtotal: "80.00", vat: "12.00", total: "92.00" },
    },
    {
      companyName: "AMT",
      companyArabic: "",
      currency: "SAR",
      pdfUnitPrices: "BOTH",
      quotation: {},
    },
    "",
  );
  assert.doesNotMatch(html, /Discount|الخصم|20%/);
  assert.match(html, /80\.00/);
  assert.match(html, /92\.00/);
});

test("Printed quotations number lines and total quantities without internal references", () => {
  const html = quotationHtml(
    {
      number: "DR-0004",
      internal_reference: "QID-000001",
      status: "DRAFT",
      created_at: "2026-09-02T00:00:00Z",
      customer: { name: "Customer", number: "", mobile: "", reference: "" },
      lines: [
        { partNumber: "ITEM-1", description: "First", unit: "pcs", price: { quantity: "1.5", finalExcl: "10", finalIncl: "11.5", subtotal: "15", vatAmount: "2.25", vatRate: "15", total: "17.25" } },
        { partNumber: "ITEM-2", description: "Second", unit: "pcs", price: { quantity: "2.25", finalExcl: "10", finalIncl: "11.5", subtotal: "22.5", vatAmount: "3.38", vatRate: "15", total: "25.88" } },
      ],
      totals: { subtotal: "37.50", vat: "5.63", total: "43.13" },
    },
    { companyName: "AMT", companyArabic: "", currency: "SAR", pdfUnitPrices: "BOTH", quotation: {} },
    "",
  );
  assert.match(html, /Ref \/ المرجع/);
  assert.match(html, /Total Quantity \/ إجمالي الكمية/);
  assert.match(html, /3\.75/);
  assert.match(html, /<td class="num">1<\/td>/);
  assert.match(html, /<td class="num">2<\/td>/);
  assert.doesNotMatch(html, /QID-000001/);
});
