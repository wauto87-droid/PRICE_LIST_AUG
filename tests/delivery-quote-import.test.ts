import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../backend/auth/service";
import {
  mapRows,
  get,
  reviewRows,
  finalize,
  history,
  historyDateBounds,
} from "../backend/delivery-quote-imports/service";
import { json } from "../backend/core/audit";

test("Delivery-note quotation import maps rows, supports row actions, and finalizes into a quotation", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "delivery-quote-setup-token-long-enough";
  process.env.UPLOAD_DIR = path.join(
    process.cwd(),
    ".data",
    "delivery-quote-test-" + randomUUID(),
  );
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "admin",
    password: "abcd",
    name: "Admin",
    companyName: "AMT",
  });
  const signed = await login(db, { username: "admin", password: "abcd" });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(signed.token).split(";")[0] },
    }),
  );
  const productId = randomUUID();
  await db.query(
    "INSERT INTO products(id,part_number,normalized_part,description,keywords,unit,quantity_precision,active,created_by,updated_by) VALUES($1,'LC1D09M7','LC1D09M7','Contactor','',$2,0,true,$3,$3)",
    [productId, "pcs", actor.id],
  );
  await db.query(
    "INSERT INTO product_selling_levels(product_id,code,active,method,fixed_price,markup,list_price,base_discount) VALUES($1,'END_CUSTOMER',true,'LIST_DISCOUNT',0,0,110,0)",
    [productId],
  );
  await db.query(
    "INSERT INTO product_pricing(product_id,method,cost,markup,list_price,base_discount,master_excl,vat,minimum_enabled,minimum,default_level) VALUES($1,'LIST_DISCOUNT',0,0,110,0,110,15,false,0,'END_CUSTOMER')",
    [productId],
  );
  const filePath = path.join(process.env.UPLOAD_DIR, "delivery.csv");
  await fs.mkdir(process.env.UPLOAD_DIR, { recursive: true });
  await fs.writeFile(filePath, "fixture");
  const jobId = randomUUID();
  await db.query(
    "INSERT INTO delivery_quote_jobs(id,filename,file_path,status,owner_id,summary) VALUES($1,'delivery.csv',$2,'AWAITING_MAPPING',$3,$4)",
    [jobId, filePath, actor.id, json({ columns: ["Date", "Doc", "Customer", "Item", "Description", "Qty", "Price"] })],
  );
  await db.query(
    "INSERT INTO delivery_quote_rows(id,job_id,row_number,raw) VALUES($1,$2,1,$3),($4,$2,2,$5)",
    [
      randomUUID(),
      jobId,
      json({
        Date: "2026-08-31",
        Doc: "DN-100",
        Customer: "ACME",
        Item: "LC1D09M7",
        Description: "Contactor",
        Qty: "2",
        Price: "99",
      }),
      randomUUID(),
      json({
        Date: "2026-08-31",
        Doc: "DN-100",
        Customer: "ACME",
        Item: "SITE-WORK",
        Description: "Site work",
        Qty: "1",
        Price: "",
      }),
    ],
  );
  await mapRows(db, actor, jobId, {
    version: 1,
    date: "Date",
    docNo: "Doc",
    customerName: "Customer",
    partNumber: "Item",
    description: "Description",
    quantity: "Qty",
    price: "Price",
  });
  let opened: any = await get(db, actor, jobId);
  assert.equal(opened.status, "AWAITING_REVIEW");
  assert.equal(opened.summary.customerName, "ACME");
  assert.equal(opened.summary.matchedRows, 1);
  assert.equal(opened.summary.customRows, 1);
  const matched = opened.rows.find((row: any) => row.resolution === "MATCHED_CATALOG");
  const custom = opened.rows.find((row: any) => row.resolution === "UNMATCHED_CUSTOM");
  assert.equal(matched.completed, true);
  assert.equal(custom.completed, false);
  await reviewRows(db, actor, jobId, {
    version: opened.version,
    rowIds: [matched.id],
    action: "REMOVE",
  });
  opened = await get(db, actor, jobId);
  const removedMatched = opened.rows.find((row: any) => row.id === matched.id);
  assert.equal(removedMatched.action, "REMOVE");
  await reviewRows(db, actor, jobId, {
    version: opened.version,
    rowIds: [matched.id],
    action: "RESTORE",
  });
  opened = await get(db, actor, jobId);
  await reviewRows(db, actor, jobId, {
    version: opened.version,
    rowIds: [custom.id],
    completed: true,
    updates: {
      unitPriceExcl: "75",
      quantity: "1",
    },
  });
  opened = await get(db, actor, jobId);
  const readyCustom = opened.rows.find((row: any) => row.id === custom.id);
  assert.equal(readyCustom.completed, true);
  const quote: any = await finalize(db, actor, jobId, {
    version: opened.version,
  });
  assert.equal(quote.customer.name, "ACME");
  assert.match(quote.customer.reference, /DN-100/);
  assert.equal(quote.lines.length, 2);
  assert.equal(quote.lines[0].source, "CATALOG");
  assert.equal(quote.lines[1].source, "CUSTOM");
  assert.equal(quote.lines[1].price.finalExcl, "75.00");
  assert.equal(
    (await one(db, "SELECT status,quote_id FROM delivery_quote_jobs WHERE id=$1", [jobId]))!.status,
    "COMPLETED",
  );
  assert.equal(productId.length > 0, true);
  await db.close?.();
});

test("Delivery-note quotation import accepts files with no mapped price column", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "delivery-quote-no-price-token-long-enough";
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "admin",
    password: "abcd",
    name: "Admin",
    companyName: "AMT",
  });
  const signed = await login(db, { username: "admin", password: "abcd" });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(signed.token).split(";")[0] },
    }),
  );
  const productId = randomUUID();
  await db.query(
    "INSERT INTO products(id,part_number,normalized_part,description,keywords,unit,quantity_precision,active,created_by,updated_by) VALUES($1,'ITEM-1','ITEM-1','Catalog item','',$2,0,true,$3,$3)",
    [productId, "pcs", actor.id],
  );
  await db.query(
    "INSERT INTO product_selling_levels(product_id,code,active,method,fixed_price,markup,list_price,base_discount) VALUES($1,'END_CUSTOMER',true,'LIST_DISCOUNT',0,0,45,0)",
    [productId],
  );
  await db.query(
    "INSERT INTO product_pricing(product_id,method,cost,markup,list_price,base_discount,master_excl,vat,minimum_enabled,minimum,default_level) VALUES($1,'LIST_DISCOUNT',0,0,45,0,45,15,false,0,'END_CUSTOMER')",
    [productId],
  );
  const jobId = randomUUID();
  await db.query(
    "INSERT INTO delivery_quote_jobs(id,filename,file_path,status,owner_id,summary) VALUES($1,'1533.XLS','fixture','AWAITING_MAPPING',$2,$3)",
    [jobId, actor.id, json({ columns: ["Date", "Doc.No", "Customer", "Item Code", "Item Name", "Qty"] })],
  );
  const customRowId = randomUUID();
  await db.query(
    "INSERT INTO delivery_quote_rows(id,job_id,row_number,raw) VALUES($1,$2,1,$3),($4,$2,2,$5)",
    [
      randomUUID(),
      jobId,
      json({
        Date: "2026-08-31",
        "Doc.No": "DN-300",
        Customer: "ACME",
        "Item Code": "ITEM-1",
        "Item Name": "Catalog item",
        Qty: "2",
      }),
      customRowId,
      json({
        Date: "2026-08-31",
        "Doc.No": "DN-300",
        Customer: "ACME",
        "Item Code": "SITE-SERVICE",
        "Item Name": "Site service",
        Qty: "1",
      }),
    ],
  );
  await mapRows(db, actor, jobId, {
    version: 1,
    date: "Date",
    docNo: "Doc.No",
    customerName: "Customer",
    partNumber: "Item Code",
    description: "Item Name",
    quantity: "Qty",
  });
  let opened: any = await get(db, actor, jobId);
  assert.equal(opened.status, "AWAITING_REVIEW");
  assert.equal(opened.mapping.price, undefined);
  assert.equal(opened.mapping.date, "Date");
  assert.equal(opened.mapping.docNo, "Doc.No");
  assert.equal(opened.summary.customerName, "ACME");
  assert.equal(opened.rows.length, 2);
  const matched = opened.rows.find((row: any) => row.resolution === "MATCHED_CATALOG");
  const custom = opened.rows.find((row: any) => row.id === customRowId);
  assert.equal(matched.raw.Date, "2026-08-31");
  assert.equal(matched.raw["Doc.No"], "DN-300");
  assert.equal(matched.completed, true);
  assert.equal(custom.completed, false);
  await reviewRows(db, actor, jobId, {
    version: opened.version,
    rowIds: [customRowId],
    completed: true,
    updates: {
      unitPriceExcl: "25",
      quantity: "1",
    },
  });
  opened = await get(db, actor, jobId);
  const quote: any = await finalize(db, actor, jobId, {
    version: opened.version,
  });
  assert.equal(quote.customer.name, "ACME");
  assert.equal(quote.lines.length, 2);
  assert.equal(quote.lines[0].source, "CATALOG");
  assert.equal(quote.lines[0].price.finalExcl, "45.00");
  assert.equal(quote.lines[1].source, "CUSTOM");
  assert.equal(quote.lines[1].price.finalExcl, "25.00");
  await db.close?.();
});

test("Delivery-note quotation import blocks finalize when customer names are mixed", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "delivery-quote-mixed-token-long-enough";
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "admin",
    password: "abcd",
    name: "Admin",
    companyName: "AMT",
  });
  const signed = await login(db, { username: "admin", password: "abcd" });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(signed.token).split(";")[0] },
    }),
  );
  const jobId = randomUUID();
  await db.query(
    "INSERT INTO delivery_quote_jobs(id,filename,file_path,status,owner_id,summary) VALUES($1,'mixed.csv','fixture','AWAITING_MAPPING',$2,$3)",
    [jobId, actor.id, json({ columns: ["Date", "Doc", "Customer", "Item", "Description", "Qty", "Price"] })],
  );
  await db.query(
    "INSERT INTO delivery_quote_rows(id,job_id,row_number,raw) VALUES($1,$2,1,$3),($4,$2,2,$5)",
    [
      randomUUID(),
      jobId,
      json({
        Date: "2026-08-31",
        Doc: "DN-200",
        Customer: "ACME",
        Item: "X1",
        Description: "Item 1",
        Qty: "1",
        Price: "10",
      }),
      randomUUID(),
      json({
        Date: "2026-08-31",
        Doc: "DN-201",
        Customer: "BETA",
        Item: "X2",
        Description: "Item 2",
        Qty: "1",
        Price: "20",
      }),
    ],
  );
  await mapRows(db, actor, jobId, {
    version: 1,
    date: "Date",
    docNo: "Doc",
    customerName: "Customer",
    partNumber: "Item",
    description: "Description",
    quantity: "Qty",
    price: "Price",
  });
  const opened: any = await get(db, actor, jobId);
  await assert.rejects(
    finalize(db, actor, jobId, { version: opened.version }),
    /more than one customer name/i,
  );
  await db.close?.();
});

test("Delivery-note quotation import preserves per-row updates and defaults empty price to 0", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "delivery-quote-bulk-update-token-123456";
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "admin",
    password: "abcd",
    name: "Admin",
    companyName: "AMT",
  });
  const signed = await login(db, { username: "admin", password: "abcd" });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(signed.token).split(";")[0] },
    }),
  );
  const jobId = randomUUID();
  await db.query(
    "INSERT INTO delivery_quote_jobs(id,filename,file_path,status,owner_id,summary) VALUES($1,'bulk.xlsx','fixture','AWAITING_MAPPING',$2,$3)",
    [jobId, actor.id, json({ columns: ["Date", "Doc", "Customer", "Item", "Description", "Qty"] })],
  );
  const row1Id = randomUUID();
  const row2Id = randomUUID();
  const row3Id = randomUUID();
  await db.query(
    "INSERT INTO delivery_quote_rows(id,job_id,row_number,raw) VALUES($1,$2,1,$3),($4,$5,2,$6),($7,$8,3,$9)",
    [
      row1Id,
      jobId,
      json({ Date: "2026-08-31", Doc: "DN-101", Customer: "ACME", Item: "CUSTOM-A", Description: "Desc A", Qty: "2" }),
      row2Id,
      jobId,
      json({ Date: "2026-08-31", Doc: "DN-101", Customer: "ACME", Item: "CUSTOM-B", Description: "Desc B", Qty: "3" }),
      row3Id,
      jobId,
      json({ Date: "2026-08-31", Doc: "DN-101", Customer: "ACME", Item: "CUSTOM-C", Description: "Desc C", Qty: "4" }),
    ],
  );
  await mapRows(db, actor, jobId, {
    version: 1,
    date: "Date",
    docNo: "Doc",
    customerName: "Customer",
    partNumber: "Item",
    description: "Description",
    quantity: "Qty",
  });
  let opened: any = await get(db, actor, jobId);
  assert.equal(opened.rows.length, 3);
  // Bulk update prices and mark complete: row1 has 12, row2 has 11, row3 is empty (should default to 0)
  await reviewRows(db, actor, jobId, {
    version: opened.version,
    rowIds: [row1Id, row2Id, row3Id],
    completed: true,
    rowUpdates: {
      [row1Id]: { unitPriceExcl: "12", quantity: "2" },
      [row2Id]: { unitPriceExcl: "11", quantity: "3" },
      [row3Id]: { unitPriceExcl: "", quantity: "4" },
    },
  });
  opened = await get(db, actor, jobId);
  const r1 = opened.rows.find((r: any) => r.id === row1Id);
  const r2 = opened.rows.find((r: any) => r.id === row2Id);
  const r3 = opened.rows.find((r: any) => r.id === row3Id);
  assert.equal(r1.line_input.unitPriceExcl, "12");
  assert.equal(r1.completed, true);
  assert.equal(r2.line_input.unitPriceExcl, "11");
  assert.equal(r2.completed, true);
  assert.equal(r3.line_input.unitPriceExcl, "0");
  assert.equal(r3.completed, true);

  const quote: any = await finalize(db, actor, jobId, { version: opened.version });
  assert.equal(quote.lines.length, 3);
  assert.equal(quote.lines[0].price.finalExcl, "12.00");
  assert.equal(quote.lines[1].price.finalExcl, "11.00");
  assert.equal(quote.lines[2].price.finalExcl, "0.00");
  await db.close?.();
});

test("Delivery-note quotation import normalizes Excel serial dates and doc numbers like 1586.0", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "delivery-quote-date-format-token-123456";
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "admin",
    password: "abcd",
    name: "Admin",
    companyName: "AMT",
  });
  const signed = await login(db, { username: "admin", password: "abcd" });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(signed.token).split(";")[0] },
    }),
  );
  const jobId = randomUUID();
  await db.query(
    "INSERT INTO delivery_quote_jobs(id,filename,file_path,status,owner_id,summary) VALUES($1,'excel_dates.xlsx','fixture','AWAITING_MAPPING',$2,$3)",
    [jobId, actor.id, json({ columns: ["Date", "Doc", "Customer", "Item", "Description", "Qty"] })],
  );
  const rowId = randomUUID();
  await db.query(
    "INSERT INTO delivery_quote_rows(id,job_id,row_number,raw) VALUES($1,$2,1,$3)",
    [
      rowId,
      jobId,
      json({
        Date: "46264.478310185186",
        Doc: "1586.0",
        Customer: "IEC OHOD MAJID",
        Item: "MC-630a-AC220V",
        Description: "MAGNETIC CONTACTOR 630A",
        Qty: "3.0",
      }),
    ],
  );
  await mapRows(db, actor, jobId, {
    version: 1,
    date: "Date",
    docNo: "Doc",
    customerName: "Customer",
    partNumber: "Item",
    description: "Description",
    quantity: "Qty",
  });
  let opened: any = await get(db, actor, jobId);
  assert.equal(opened.rows.length, 1);
  const r = opened.rows[0];
  assert.equal(r.line_input.importMeta.docNo, "1586");
  assert.equal(r.line_input.importMeta.docDate.startsWith("2026-08-3"), true);
  await reviewRows(db, actor, jobId, {
    version: opened.version,
    rowIds: [rowId],
    completed: true,
  });
  opened = await get(db, actor, jobId);
  const quote: any = await finalize(db, actor, jobId, { version: opened.version });
  assert.equal(quote.lines.length, 1);
  assert.equal(quote.lines[0].importMeta.docNo, "1586");
  assert.equal(quote.lines[0].importMeta.docDate.startsWith("2026-08-3"), true);
  await db.close?.();
});

test("Delivery-note history searches, filters, sorts and paginates on Riyadh dates", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "delivery-history-token-long-enough-123";
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "historyadmin",
    password: "abcd",
    name: "History Admin",
    companyName: "AMT",
  });
  const signed = await login(db, { username: "historyadmin", password: "abcd" });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(signed.token).split(";")[0] },
    }),
  );
  for (let index = 0; index < 25; index++) {
    const quoteId = randomUUID();
    const jobId = randomUUID();
    const number = `QT-${String(index + 1).padStart(4, "0")}`;
    const customer = index === 7 ? "Literal Customer" : `Customer ${index}`;
    await db.query(
      "INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,$2,'DRAFT',$3,$4,'[]','{}')",
      [quoteId, number, actor.id, json({ name: customer })],
    );
    await db.query(
      `INSERT INTO delivery_quote_jobs(id,filename,file_path,status,owner_id,header,summary,quote_id,created_at,updated_at)
       VALUES($1,$2,'fixture','COMPLETED',$3,$4,$5,$6,$7::timestamptz,$7::timestamptz)`,
      [
        jobId,
        index === 7 ? "100%_delivery.xlsx" : `delivery-${index}.xlsx`,
        actor.id,
        json({ customerName: customer, docNos: [`DN-${index}`] }),
        json({ customerName: customer, docNos: [`DN-${index}`] }),
        quoteId,
        `2026-08-${String((index % 25) + 1).padStart(2, "0")}T12:00:00+03:00`,
      ],
    );
  }
  const first: any = await history(db, actor, {
    scope: "converted",
    page: 0,
    pageSize: 20,
    sort: "newest",
  });
  assert.equal(first.total, 25);
  assert.equal(first.items.length, 20);
  assert.equal(first.totalPages, 2);
  assert.equal(first.items[0].quotation_number, "QT-0025");
  const second: any = await history(db, actor, {
    scope: "converted",
    page: 1,
    pageSize: 20,
    sort: "newest",
  });
  assert.equal(second.items.length, 5);
  const literal: any = await history(db, actor, {
    scope: "converted",
    query: "%_delivery",
  });
  assert.equal(literal.total, 1);
  assert.equal(literal.items[0].customer_name, "Literal Customer");
  const byReference: any = await history(db, actor, {
    scope: "converted",
    query: "DN-7",
  });
  assert.equal(byReference.total, 1);
  const ranged: any = await history(db, actor, {
    scope: "converted",
    datePreset: "custom",
    from: "2026-08-10",
    to: "2026-08-12",
    sort: "oldest",
  });
  assert.deepEqual(
    ranged.items.map((item: any) => item.quotation_number),
    ["QT-0010", "QT-0011", "QT-0012"],
  );
  const filenameSorted: any = await history(db, actor, {
    scope: "converted",
    sort: "filename_asc",
  });
  assert.equal(filenameSorted.items[0].filename, "100%_delivery.xlsx");
  const customerSorted: any = await history(db, actor, {
    scope: "converted",
    sort: "customer_desc",
  });
  assert.equal(customerSorted.items[0].customer_name, "Literal Customer");
  const quotationSorted: any = await history(db, actor, {
    scope: "converted",
    sort: "quotation_asc",
  });
  assert.equal(quotationSorted.items[0].quotation_number, "QT-0001");
  const bounds = historyDateBounds(
    "today",
    "",
    "",
    new Date("2026-08-31T20:00:00Z"),
  );
  assert.equal(bounds.from, "2026-08-31T00:00:00+03:00");
  assert.equal(bounds.toExclusive, "2026-09-01T00:00:00+03:00");
  const staffId = randomUUID();
  await db.query(
    "INSERT INTO users(id,username,name,password_hash,role_id) SELECT $1,'historystaff','History Staff',password_hash,'STAFF' FROM users WHERE id=$2",
    [staffId, actor.id],
  );
  const staffQuoteId = randomUUID();
  await db.query(
    "INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,'QT-STAFF','DRAFT',$2,$3,'[]','{}')",
    [staffQuoteId, staffId, json({ name: "Staff Customer" })],
  );
  await db.query(
    "INSERT INTO delivery_quote_jobs(id,filename,file_path,status,owner_id,quote_id) VALUES($1,'staff.xlsx','fixture','COMPLETED',$2,$3)",
    [randomUUID(), staffId, staffQuoteId],
  );
  await db.query(
    "INSERT INTO delivery_quote_jobs(id,filename,file_path,status,owner_id) VALUES($1,'failed.xlsx','fixture','FAILED',$2)",
    [randomUUID(), actor.id],
  );
  const staffActor = {
    ...actor,
    id: staffId,
    role: "STAFF",
    permissions: ["PRODUCT_VIEW", "QUOTE_CREATE", "QUOTE_EDIT", "QUOTE_ISSUE"],
  };
  const owned: any = await history(db, staffActor, { scope: "converted" });
  assert.equal(owned.total, 1);
  assert.equal(owned.items[0].quotation_number, "QT-STAFF");
  await assert.rejects(() => history(db, staffActor, { scope: "admin" }), /permission/i);
  const failed: any = await history(db, actor, {
    scope: "admin",
    status: "FAILED",
  });
  assert.equal(failed.total, 1);
  assert.equal(failed.items[0].filename, "failed.xlsx");
  await db.close?.();
});


