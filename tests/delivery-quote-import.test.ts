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
