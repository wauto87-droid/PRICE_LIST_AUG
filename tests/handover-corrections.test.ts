import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import { correctCatalogImport, correctDeliveryImport } from "../backend/handover/service";

test("completed catalog and delivery imports create non-destructive correction copies", async () => {
  const db = await embedded();
  await migrate(db);
  const userId = randomUUID();
  await db.query("INSERT INTO roles(id,permissions,max_discount) VALUES('TEST',$1,100)", [["IMPORT_CONFIRM", "PRODUCT_EDIT", "QUOTE_CREATE"]]);
  await db.query("INSERT INTO users(id,username,name,password_hash,role_id) VALUES($1,'correction@test','Correction Admin','x','TEST')", [userId]);
  const actor: any = { id: userId, username: "correction@test", name: "Correction Admin", role: "TEST", permissions: ["IMPORT_CONFIRM", "PRODUCT_EDIT", "QUOTE_CREATE"], maxDiscount: "100", csrf: "x" };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amt-correction-"));
  try {
    const catalogId = randomUUID(), catalogFile = path.join(dir, catalogId + ".xlsx");
    await fs.writeFile(catalogFile, "fixture");
    await db.query("INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id,mapping,defaults,summary,mode) VALUES($1,'catalog.xlsx',$2,'EXCEL','IMPORTED',$3,'{}','{}','{}','UPDATE_ONLY')", [catalogId, catalogFile, userId]);
    await db.query("INSERT INTO import_rows(id,job_id,row_number,raw) VALUES($1,$2,2,$3)", [randomUUID(), catalogId, { Part: "A" }]);
    const catalogCopy = await correctCatalogImport(db, actor, catalogId, { version: 1 });
    const copiedCatalog = await one(db, "SELECT status,source_job_id FROM import_jobs WHERE id=$1", [catalogCopy.id]);
    assert.equal(copiedCatalog!.status, "AWAITING_REVIEW");
    assert.equal(copiedCatalog!.source_job_id, catalogId);
    assert.equal((await one(db, "SELECT status FROM import_jobs WHERE id=$1", [catalogId]))!.status, "IMPORTED");

    const deliveryId = randomUUID(), deliveryFile = path.join(dir, deliveryId + ".xls");
    await fs.writeFile(deliveryFile, "fixture");
    await db.query("INSERT INTO delivery_quote_jobs(id,filename,file_path,status,owner_id) VALUES($1,'delivery.xls',$2,'COMPLETED',$3)", [deliveryId, deliveryFile, userId]);
    await db.query("INSERT INTO delivery_quote_rows(id,job_id,row_number,raw) VALUES($1,$2,2,$3)", [randomUUID(), deliveryId, { Item: "A" }]);
    const deliveryCopy = await correctDeliveryImport(db, actor, deliveryId, { version: 1 });
    const copiedDelivery = await one(db, "SELECT status,source_job_id FROM delivery_quote_jobs WHERE id=$1", [deliveryCopy.id]);
    assert.equal(copiedDelivery!.status, "AWAITING_MAPPING");
    assert.equal(copiedDelivery!.source_job_id, deliveryId);
    assert.equal((await one(db, "SELECT status FROM delivery_quote_jobs WHERE id=$1", [deliveryId]))!.status, "COMPLETED");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await db.close?.();
  }
});
