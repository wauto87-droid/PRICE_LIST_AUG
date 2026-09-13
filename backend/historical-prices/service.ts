import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { type Actor, requirePermission } from "../auth/service";
import ExcelJS from "exceljs";

const permission = (actor: Actor) =>
  requirePermission(actor, "SALES_PRICE_CHECK");

export async function upload(db: DB, actor: Actor, file: File) {
  permission(actor);
  const ext = path.extname(file.name).toLowerCase();
  assert(
    [".xls", ".xlsx", ".csv"].includes(ext),
    400,
    "Supported files: XLS, XLSX, CSV",
  );
  const bytes = await file.arrayBuffer();
  
  // We parse the file synchronously since it's just to get columns and row count
  const book = new ExcelJS.Workbook();
  if (ext === ".csv") await book.csv.read(Buffer.from(bytes) as any);
  else await book.xlsx.load(Buffer.from(bytes));
  
  const sheet = book.worksheets[0];
  assert(sheet, 400, "Workbook is empty");
  
  let headerRow = sheet.getRow(1);
  if (!headerRow.values || !(headerRow.values as any[]).length) {
    headerRow = sheet.getRow(2); // Try row 2 if row 1 is empty
  }
  const columns = (headerRow.values as any[])
    .map((v) => String(v?.richText?.[0]?.text ?? v ?? "").trim())
    .map((v, i) => (v ? v : `Column ${i}`));
    
  assert(columns.filter(Boolean).length > 0, 400, "Could not read columns from the file");

  const id = randomUUID();
  const name = path.basename(file.name, ext);
  
  const target = path.join(dir, id + ext);
  await fs.writeFile(target, Buffer.from(bytes), {
    flag: "wx",
    mode: 0o600,
  });

  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO historical_price_lists (id, name, owner_id) VALUES ($1, $2, $3)",
      [id, name, actor.id]
    );
  });
  
  return { id, columns, name };
}

export async function mapAndSave(
  db: DB,
  actor: Actor,
  id: string,
  mapping: { partNumber: string; validFrom: string; validTo: string; price: string }
) {
  permission(actor);
  const list = await one(db, "SELECT * FROM historical_price_lists WHERE id=$1", [id]);
  assert(list, 404, "Historical price list not found");
  
  const dir = path.resolve(process.env.UPLOAD_DIR || ".data/uploads", "historical-prices");
  
  let target = "";
  let ext = "";
  for (const e of [".xlsx", ".xls", ".csv"]) {
    target = path.join(dir, id + e);
    try {
      await fs.stat(target);
      ext = e;
      break;
    } catch {
      target = "";
    }
  }
  assert(target, 404, "File not found");
  
  const book = new ExcelJS.Workbook();
  if (ext === ".csv") await book.csv.readFile(target);
  else await book.xlsx.readFile(target);
  
  const sheet = book.worksheets[0];
  assert(sheet, 400, "Workbook is empty");
  
  let headerRow = sheet.getRow(1);
  if (!headerRow.values || !(headerRow.values as any[]).length) {
    headerRow = sheet.getRow(2);
  }
  const columns = (headerRow.values as any[])
    .map((v) => String(v?.richText?.[0]?.text ?? v ?? "").trim())
    .map((v, i) => (v ? v : `Column ${i}`));
    
  const partIdx = columns.indexOf(mapping.partNumber) + 1;
  const fromIdx = columns.indexOf(mapping.validFrom) + 1;
  const toIdx = columns.indexOf(mapping.validTo) + 1;
  const priceIdx = columns.indexOf(mapping.price) + 1;
  
  assert(partIdx > 0, 400, "Part Number column not found");
  assert(priceIdx > 0, 400, "Price column not found");
  
  const entries: any[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === headerRow.number) return;
    const values = row.values as any[];
    
    let part = values[partIdx];
    if (part && typeof part === "object" && part.richText) part = part.richText.map((t: any) => t.text).join("");
    part = String(part ?? "").trim();
    
    let price = values[priceIdx];
    if (price && typeof price === "object" && price.richText) price = price.richText.map((t: any) => t.text).join("");
    const parsedPrice = parseFloat(String(price ?? "").replace(/[^\d.-]/g, ""));
    
    let from = values[fromIdx];
    let to = values[toIdx];
    
    const parseDate = (d: any) => {
      if (!d) return null;
      if (d instanceof Date) return d.toISOString().split("T")[0];
      const parsed = new Date(String(d));
      if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0];
      return null;
    };
    
    if (part && !isNaN(parsedPrice)) {
      entries.push({
        id: randomUUID(),
        part_number: part,
        valid_from: parseDate(from),
        valid_to: parseDate(to),
        price: parsedPrice
      });
    }
  });
  
  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM historical_price_entries WHERE list_id=$1", [id]);
    
    // Batch insert
    for (let i = 0; i < entries.length; i += 500) {
      const batch = entries.slice(i, i + 500);
      const values = batch.map((_, idx) => `($1, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4}, $${idx * 4 + 5})`).join(", ");
      const args = batch.flatMap(e => [e.part_number, e.valid_from, e.valid_to, e.price]);
      await tx.query(
        `INSERT INTO historical_price_entries (list_id, part_number, valid_from, valid_to, price) VALUES ${values}`,
        [id, ...args]
      );
    }
  });
  
  return { ok: true, rows: entries.length };
}

export async function list(db: DB, actor: Actor) {
  permission(actor);
  return (await db.query("SELECT id, name, created_at, (SELECT count(*) FROM historical_price_entries WHERE list_id=historical_price_lists.id) as count FROM historical_price_lists ORDER BY created_at DESC")).rows;
}

export async function remove(db: DB, actor: Actor, id: string) {
  permission(actor);
  await db.query("DELETE FROM historical_price_lists WHERE id=$1", [id]);
  return { ok: true };
}
