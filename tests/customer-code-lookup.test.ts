import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { embedded, migrate } from "../backend/core/db";
const json = (v: any) => JSON.stringify(v);
import { setup, login, sessionCookie } from "../backend/auth/service";
import { handle } from "../backend/api/router";
import { formatDeliveryDateDisplay } from "../backend/pricing/normalize";
import { sortLinesByDeliveryNote } from "../backend/quotations/delivery-sync";
import { isEmptyDraftRow, createBlankEntryLine } from "../frontend/Cart";
import { normalizeEditableQuotationLine } from "../shared/quotation-line-compat";

test("Customer lookup resolves customer names from draft quotations, imports, and DN tracker", async () => {
  const db = await embedded();
  await migrate(db);

  process.env.SETUP_TOKEN = "test-token-customers-lookup-12345";
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "admin",
    password: "password123",
    name: "Admin User",
    companyName: "AMT Test",
  });
  const signed = await login(db, { username: "admin", password: "password123" });
  const cookie = sessionCookie(signed.token).split(";")[0];

  // 1. Insert a DRAFT quotation with customer code CUST-99 and customer name "Engineering & Industrial Trading"
  const draftQuoteId = randomUUID();
  await db.query(
    `INSERT INTO quotations(id, number, status, owner_id, customer, lines, totals)
     VALUES($1, 'DR-0103', 'DRAFT', (SELECT id FROM users LIMIT 1), $2, '[]', '{}')`,
    [
      draftQuoteId,
      json({
        name: "Engineering & Industrial Trading",
        number: "CUST-99",
        mobile: "0551234567",
        reference: "Ref-0103",
      }),
    ],
  );

  // 2. Query GET /api/v1/customers?q=CUST-99
  const req = new Request("http://localhost/amt_price_list/api/v1/customers?q=CUST-99", {
    headers: { Cookie: cookie },
  });
  const res = await handle(req, db);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(Array.isArray(data), "Should return array of customer candidates");
  assert.equal(data.length, 1);
  assert.equal(data[0].number, "CUST-99");
  assert.equal(data[0].name, "Engineering & Industrial Trading");
  assert.equal(data[0].mobile, "0551234567");

  // 3. Insert into delivery_quote_jobs with code CUST-88
  const jobId = randomUUID();
  await db.query(
    `INSERT INTO delivery_quote_jobs(id, filename, file_path, status, owner_id, header)
     VALUES($1, 'test.csv', '/tmp/test.csv', 'AWAITING_REVIEW', (SELECT id FROM users LIMIT 1), $2)`,
    [
      jobId,
      json({
        customerName: "Job Customer EST",
        customerCode: "CUST-88",
        customerMobile: "0509998888",
      }),
    ],
  );

  const reqJob = new Request("http://localhost/amt_price_list/api/v1/customers?q=CUST-88", {
    headers: { Cookie: cookie },
  });
  const resJob = await handle(reqJob, db);
  assert.equal(resJob.status, 200);
  const dataJob = await resJob.json();
  assert.equal(dataJob.length, 1);
  assert.equal(dataJob[0].number, "CUST-88");
  assert.equal(dataJob[0].name, "Job Customer EST");

  await db.close?.();
});

test("Date format strictly outputs DD-MM-YY with 2-digit year", () => {
  assert.equal(formatDeliveryDateDisplay("2026-10-29"), "29-10-26");
  assert.equal(formatDeliveryDateDisplay("2026-10-14"), "14-10-26");
  assert.equal(formatDeliveryDateDisplay("2026-11-09"), "09-11-26");
  assert.equal(formatDeliveryDateDisplay("2026-08-31"), "31-08-26");
  assert.equal(formatDeliveryDateDisplay("29-10-26"), "29-10-26");
});

test("DN lines sort in ascending order from smallest to largest DN number", () => {
  const lines = [
    { partNumber: "ENS-705025", importMeta: { source: "DELIVERY_NOTE", docNo: "2276", docDate: "2026-10-29" } },
    { partNumber: "A9H348MEZ100FD", importMeta: { source: "DELIVERY_NOTE", docNo: "2242", docDate: "2026-10-27" } },
    { partNumber: "XB4BD33", importMeta: { source: "DELIVERY_NOTE", docNo: "2243", docDate: "2026-10-27" } },
    { partNumber: "RES318EZ150", importMeta: { source: "DELIVERY_NOTE", docNo: "2255", docDate: "2026-10-28" } },
    { partNumber: "RE22R1QCMU", importMeta: { source: "DELIVERY_NOTE", docNo: "2256", docDate: "2026-10-28" } },
    { partNumber: "IOCNFE1000", importMeta: { source: "DELIVERY_NOTE", docNo: "2268", docDate: "2026-10-29" } },
    { partNumber: "MC-330a", importMeta: { source: "DELIVERY_NOTE", docNo: "2383", docDate: "2026-11-09" } },
    { partNumber: "ERX-20", importMeta: { source: "DELIVERY_NOTE", docNo: "2393", docDate: "2026-11-10" } },
    { partNumber: "ATV320U15N4C", importMeta: { source: "DELIVERY_NOTE", docNo: "2100", docDate: "2026-10-14" } },
    { partNumber: "E-CSCS200NM4CO", importMeta: { source: "DELIVERY_NOTE", docNo: "2143", docDate: "2026-10-18" } },
  ];

  const sorted = sortLinesByDeliveryNote(lines);
  const docNumbers = sorted.map((l: any) => l.importMeta.docNo);
  assert.deepEqual(docNumbers, [
    "2100",
    "2143",
    "2242",
    "2243",
    "2255",
    "2256",
    "2268",
    "2276",
    "2383",
    "2393",
  ]);
});

test("isEmptyDraftRow differentiates blank entry lines from real quotation items", () => {
  const blank = createBlankEntryLine();
  assert.equal(isEmptyDraftRow(blank), true);

  const modified = { ...blank, input: { ...blank.input, quantity: "2" } };
  assert.equal(isEmptyDraftRow(modified), false);
});

test("normalizeEditableQuotationLine preserves empty string quantity when cleared by backspace and does not attach compatibilityIssue to blank draft rows", () => {
  const blank = createBlankEntryLine();
  const normalizedBlank = normalizeEditableQuotationLine(blank);
  assert.equal(normalizedBlank.input.quantity, "");
  assert.equal(normalizedBlank.compatibilityIssue, undefined);

  // When user backspaces an existing line's quantity to empty string
  const existingCatalogLine = {
    source: "CATALOG",
    productId: "prod-1",
    input: {
      type: "CATALOG",
      productId: "prod-1",
      quantity: "", // cleared by backspace!
      discount: "0",
    },
  };
  const normalizedCatalog = normalizeEditableQuotationLine(existingCatalogLine);
  assert.equal(normalizedCatalog.input.quantity, "");

  const existingCustomLine = {
    source: "CUSTOM",
    input: {
      type: "CUSTOM",
      partNumber: "CUSTOM-X",
      description: "My custom item",
      quantity: "", // cleared by backspace!
      unitPriceExcl: "50",
    },
  };
  const normalizedCustom = normalizeEditableQuotationLine(existingCustomLine);
  assert.equal(normalizedCustom.input.quantity, "");
});

