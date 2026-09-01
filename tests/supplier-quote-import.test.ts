import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import {
  authenticate,
  login,
  sessionCookie,
  setup,
} from "../backend/auth/service";
import { mapRows } from "../backend/imports/service";
import { json } from "../backend/core/audit";
import { productInput } from "../backend/pricing/engine";
import { importCandidate } from "../backend/pricing/transfer";

test("supplier quote imports require exactly one unit-price destination", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "supplier-quote-import-setup-token-123456";
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
    "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id,summary,mode) VALUES($1,'quote.pdf','fixture','PDF','AWAITING_REVIEW',$2,$3,'CREATE_UPDATE')",
    [
      jobId,
      actor.id,
      json({
        profile: "SUPPLIER_QUOTE",
        columns: ["Article number", "Description", "Unit", "Unit price"],
      }),
    ],
  );
  await db.query(
    "INSERT INTO import_rows(id,job_id,row_number,raw) VALUES($1,$2,1,$3)",
    [
      randomUUID(),
      jobId,
      json({
        "Article number": "3RT2015-1BB41",
        Description: "Contactor",
        Unit: "Piece",
        "Unit price": "60.94",
      }),
    ],
  );

  await assert.rejects(
    mapRows(db, actor, jobId, {
      mapping: {
        partNumber: "Article number",
        description: "Description",
        unit: "Unit",
      },
      defaults: { method: "COST_MARKUP", markup: "25" },
      version: 1,
      mode: "CREATE_UPDATE",
    }),
    /Choose exactly one destination/,
  );

  await mapRows(db, actor, jobId, {
    mapping: {
      partNumber: "Article number",
      description: "Description",
      unit: "Unit",
      cost: "Unit price",
    },
    defaults: { method: "COST_MARKUP", markup: "25" },
    version: 1,
    mode: "CREATE_UPDATE",
  });
  let row = await one(
    db,
    "SELECT proposed,errors FROM import_rows WHERE job_id=$1",
    [jobId],
  );
  assert.deepEqual(row!.errors, []);
  assert.equal(row!.proposed.cost, "60.94");

  await mapRows(db, actor, jobId, {
    mapping: {
      partNumber: "Article number",
      description: "Description",
      unit: "Unit",
      listPrice: "Unit price",
    },
    defaults: { method: "LIST_DISCOUNT" },
    version: 2,
    mode: "CREATE_UPDATE",
  });
  row = await one(
    db,
    "SELECT proposed,errors FROM import_rows WHERE job_id=$1",
    [jobId],
  );
  assert.deepEqual(row!.errors, []);
  assert.equal(row!.proposed.listPrice, "60.94");

  await mapRows(db, actor, jobId, {
    mapping: {
      partNumber: "Article number",
      description: "Description",
      unit: "Unit",
      "END_CUSTOMER.sellingPrice": "Unit price",
    },
    defaults: { defaultLevel: "END_CUSTOMER" },
    version: 3,
    mode: "CREATE_UPDATE",
  });
  row = await one(
    db,
    "SELECT proposed,errors FROM import_rows WHERE job_id=$1",
    [jobId],
  );
  assert.deepEqual(row!.errors, []);
  assert.equal(row!.proposed.levels[0].fixedPrice, "60.94");
  await db.close?.();
});

test("supplier cost mapping replaces an existing default level with staff markup pricing", () => {
  const existing = productInput.parse({
    partNumber: "3RU2126-1GB0",
    description: "Existing relay",
    method: "LIST_DISCOUNT",
    cost: "20",
    listPrice: "100",
    vat: "15",
    unit: "Piece",
    defaultLevel: "END_CUSTOMER",
    levels: [
      {
        code: "END_CUSTOMER",
        method: "LIST_DISCOUNT",
        listPrice: "100",
        baseDiscount: "0",
      },
    ],
  });
  const updated = importCandidate(
    { cost: "77.22" },
    { method: "COST_MARKUP", markup: "0", baseDiscount: "0" },
    existing,
    true,
  );
  const level = updated.levels!.find((item) => item.code === "END_CUSTOMER")!;
  assert.equal(updated.cost, "77.22");
  assert.equal(level.method, "COST_MARKUP");
  assert.equal(level.markup, "0");
});
