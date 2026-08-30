import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import { type Actor, requirePermission } from "../auth/service";

const permission = (actor: Actor) =>
  requirePermission(actor, "QUANTITY_FINDER");
export async function upload(db: DB, actor: Actor, file: File) {
  permission(actor);
  const ext = path.extname(file.name).toLowerCase();
  assert(
    [".xls", ".xlsx", ".csv"].includes(ext),
    400,
    "Supported files: XLS, XLSX, CSV",
  );
  assert(
    file.size > 0 &&
      file.size <= Number(process.env.UPLOAD_MAX_MB || 20) * 1024 * 1024,
    413,
    "File exceeds upload limit",
  );
  const dir = path.resolve(
    process.env.UPLOAD_DIR || ".data/uploads",
    "quantity-finder",
  );
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID(),
    target = path.join(dir, id + ext);
  await fs.writeFile(target, Buffer.from(await file.arrayBuffer()), {
    flag: "wx",
    mode: 0o600,
  });
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO quantity_reports(id,filename,file_path,status,owner_id) VALUES($1,$2,$3,'UPLOADED',$4)",
      [id, path.basename(file.name), target, actor.id],
    );
    await tx.query(
      "INSERT INTO jobs(id,kind,payload) VALUES($1,'QUANTITY_EXTRACT',$2)",
      [randomUUID(), json({ reportId: id })],
    );
    await audit(tx, actor.id, "QUANTITY_FINDER_UPLOAD", "quantity_reports", id);
  });
  return { id };
}
export async function list(db: DB, actor: Actor) {
  permission(actor);
  return (
    await db.query(
      "SELECT id,filename,status,summary,progress,error,version,created_at,updated_at FROM quantity_reports ORDER BY created_at DESC LIMIT 100",
    )
  ).rows;
}
export async function get(
  db: DB,
  actor: Actor,
  id: string,
  page = 0,
  pageSize = 50,
  view = "GROUPS",
  search = "",
  sort = "PART_ASC",
) {
  permission(actor);
  const report = await one(
    db,
    "SELECT id,filename,status,mapping,columns,summary,progress,error,version,created_at,updated_at FROM quantity_reports WHERE id=$1",
    [id],
  );
  assert(report, 404, "Quantity report not found");
  const pattern = `%${search}%`,
    offset = page * pageSize;
  if (view === "INVALID") {
    const rows = (
      await db.query(
        "SELECT * FROM quantity_report_rows WHERE report_id=$1 AND status='INVALID' AND (coalesce(source_part,'') ILIKE $2 OR raw::text ILIKE $2) ORDER BY row_number LIMIT $3 OFFSET $4",
        [id, pattern, pageSize, offset],
      )
    ).rows;
    const count = await one(
      db,
      "SELECT count(*)::int total FROM quantity_report_rows WHERE report_id=$1 AND status='INVALID' AND (coalesce(source_part,'') ILIKE $2 OR raw::text ILIKE $2)",
      [id, pattern],
    );
    return {
      ...report,
      rows,
      resultCount: count?.total ?? 0,
      page,
      pageSize,
      view,
    };
  }
  const orders: Record<string, string> = {
    PART_ASC: "source_part ASC",
    SOLD_DESC: "sold_quantity DESC,source_part ASC",
    RETURNED_DESC: "returned_quantity DESC,source_part ASC",
    NET_DESC: "net_quantity DESC,source_part ASC",
    OCCURRENCES_DESC: "occurrences DESC,source_part ASC",
  };
  const order = orders[sort] ?? orders.PART_ASC;
  const rows = (
    await db.query(
      `SELECT * FROM quantity_report_groups WHERE report_id=$1 AND source_part ILIKE $2 ORDER BY ${order} LIMIT $3 OFFSET $4`,
      [id, pattern, pageSize, offset],
    )
  ).rows;
  const count = await one(
    db,
    "SELECT count(*)::int total FROM quantity_report_groups WHERE report_id=$1 AND source_part ILIKE $2",
    [id, pattern],
  );
  return {
    ...report,
    rows,
    resultCount: count?.total ?? 0,
    page,
    pageSize,
    view: "GROUPS",
  };
}
export async function analyze(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  permission(actor);
  const data = z
    .object({
      version: z.coerce.number().int(),
      partNumber: z.string().min(1),
      quantity: z.string().min(1),
    })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    const report = await one(
      tx,
      "SELECT * FROM quantity_reports WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      report && report.status === "AWAITING_MAPPING",
      409,
      "Report is not ready for mapping",
    );
    assert(
      report.version === data.version,
      409,
      "Report changed. Reload and try again",
    );
    assert(
      report.columns.includes(data.partNumber) &&
        report.columns.includes(data.quantity),
      400,
      "Select columns from this file",
    );
    assert(
      !(await one(
        tx,
        "SELECT id FROM jobs WHERE kind='QUANTITY_ANALYZE' AND payload->>'reportId'=$1 AND status IN ('PENDING','RUNNING')",
        [id],
      )),
      409,
      "Analysis is already queued",
    );
    await tx.query(
      "UPDATE quantity_reports SET status='PROCESSING',mapping=$2,progress=$3,error=NULL,updated_at=now() WHERE id=$1",
      [
        id,
        json(data),
        json({
          phase: "QUEUED",
          processedRows: 0,
          totalRows: report.summary.totalRows ?? 0,
          percentage: 0,
          remainingSeconds: null,
        }),
      ],
    );
    const job = randomUUID();
    await tx.query(
      "INSERT INTO jobs(id,kind,payload) VALUES($1,'QUANTITY_ANALYZE',$2)",
      [job, json({ reportId: id, actorId: actor.id })],
    );
    return { id, jobId: job, status: "PROCESSING" };
  });
}
const quantityText = (value: unknown) => String(value ?? "");
export async function processAnalysis(
  db: DB,
  reportId: string,
  actorId: string,
) {
  const report = await one(db, "SELECT * FROM quantity_reports WHERE id=$1", [
    reportId,
  ]);
  if (!report) throw new Error("Quantity report missing");
  const mapping = z
    .object({
      partNumber: z.string(),
      quantity: z.string(),
      version: z.any().optional(),
    })
    .parse(report.mapping);
  const rows = (
    await db.query(
      "SELECT id,row_number,raw FROM quantity_report_rows WHERE report_id=$1 ORDER BY row_number",
      [reportId],
    )
  ).rows;
  const groups = new Map<
    string,
    { sold: Decimal; returned: Decimal; occurrences: number; firstRow: number }
  >();
  const started = Date.now();
  let invalid = 0;
  for (let index = 0; index < rows.length; index++) {
    const row: any = rows[index],
      part = quantityText(row.raw[mapping.partNumber]),
      rawQuantity = quantityText(row.raw[mapping.quantity]);
    let status = "VALID",
      error: string | null = null,
      amount: Decimal | null = null;
    if (part === "") {
      status = "INVALID";
      error = "Part number is blank";
    } else if (!/^-?\d+(?:\.\d+)?$/.test(rawQuantity)) {
      status = "INVALID";
      error = "Quantity is not a valid decimal without commas";
    } else {
      amount = new Decimal(rawQuantity);
      if (!amount.isFinite() || amount.isZero() || amount.decimalPlaces() > 6) {
        status = "INVALID";
        error = amount.isZero()
          ? "Quantity is zero"
          : "Quantity supports up to six decimal places";
        amount = null;
      }
    }
    if (status === "INVALID") invalid++;
    else if (amount) {
      const group = groups.get(part) ?? {
        sold: new Decimal(0),
        returned: new Decimal(0),
        occurrences: 0,
        firstRow: row.row_number,
      };
      if (amount.gt(0)) group.sold = group.sold.add(amount);
      else group.returned = group.returned.add(amount.abs());
      group.occurrences++;
      groups.set(part, group);
    }
    await db.query(
      "UPDATE quantity_report_rows SET source_part=$2,quantity=$3,status=$4,error=$5 WHERE id=$1",
      [row.id, part, amount?.toString() ?? null, status, error],
    );
    if ((index + 1) % 250 === 0 || index + 1 === rows.length) {
      const processed = index + 1;
      const elapsedSeconds = (Date.now() - started) / 1000;
      const remainingSeconds =
        processed >= 250 && elapsedSeconds > 0
          ? Math.max(
              0,
              Math.ceil(
                ((rows.length - processed) * elapsedSeconds) / processed,
              ),
            )
          : null;
      await db.query(
        "UPDATE quantity_reports SET progress=$2,updated_at=now() WHERE id=$1",
        [
          reportId,
          json({
            phase: "GROUPING",
            processedRows: processed,
            totalRows: rows.length,
            percentage: rows.length
              ? Math.floor((processed * 100) / rows.length)
              : 100,
            remainingSeconds,
          }),
        ],
      );
    }
  }
  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM quantity_report_groups WHERE report_id=$1", [
      reportId,
    ]);
    for (const [part, g] of groups)
      await tx.query(
        "INSERT INTO quantity_report_groups(id,report_id,source_part,sold_quantity,returned_quantity,net_quantity,occurrences,first_row) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          reportId,
          part,
          g.sold.toString(),
          g.returned.toString(),
          g.sold.sub(g.returned).toString(),
          g.occurrences,
          g.firstRow,
        ],
      );
    const soldQuantity = [...groups.values()].reduce(
      (a, g) => a.add(g.sold),
      new Decimal(0),
    );
    const returnedQuantity = [...groups.values()].reduce(
      (a, g) => a.add(g.returned),
      new Decimal(0),
    );
    const summary = {
      totalRows: rows.length,
      validRows: rows.length - invalid,
      invalidRows: invalid,
      groupCount: groups.size,
      soldQuantity: soldQuantity.toString(),
      returnedQuantity: returnedQuantity.toString(),
      netQuantity: soldQuantity.sub(returnedQuantity).toString(),
    };
    await tx.query(
      "UPDATE quantity_reports SET status='READY',summary=$2,progress=$3,version=version+1,error=NULL,updated_at=now() WHERE id=$1",
      [
        reportId,
        json(summary),
        json({
          phase: "COMPLETE",
          processedRows: rows.length,
          totalRows: rows.length,
          percentage: 100,
          remainingSeconds: 0,
        }),
      ],
    );
    await audit(
      tx,
      actorId,
      "QUANTITY_FINDER_ANALYZE",
      "quantity_reports",
      reportId,
      null,
      summary,
    );
  });
}
export async function queueExport(
  db: DB,
  actor: Actor,
  id: string,
  format: "XLSX" | "PDF",
) {
  permission(actor);
  const job = randomUUID();
  await db.transaction(async (tx) => {
    const report = await one(
      tx,
      "SELECT status FROM quantity_reports WHERE id=$1",
      [id],
    );
    assert(report?.status === "READY", 409, "Report is not ready");
    await tx.query("INSERT INTO jobs(id,kind,payload) VALUES($1,$2,$3)", [
      job,
      `QUANTITY_${format}`,
      json({ reportId: id, ownerId: actor.id }),
    ]);
    await audit(
      tx,
      actor.id,
      `QUANTITY_FINDER_${format}_EXPORT`,
      "quantity_reports",
      id,
    );
  });
  return { id: job, status: "PENDING", format };
}
export async function remove(db: DB, actor: Actor, id: string) {
  permission(actor);
  const report = await one(
    db,
    "SELECT file_path FROM quantity_reports WHERE id=$1",
    [id],
  );
  assert(report, 404, "Quantity report not found");
  await db.transaction(async (tx) => {
    assert(
      !(await one(
        tx,
        "SELECT id FROM jobs WHERE payload->>'reportId'=$1 AND status IN ('PENDING','RUNNING')",
        [id],
      )),
      409,
      "Report processing or export is still running",
    );
    await tx.query("DELETE FROM quantity_reports WHERE id=$1", [id]);
    await audit(tx, actor.id, "QUANTITY_FINDER_DELETE", "quantity_reports", id);
  });
  await fs.rm(report.file_path, { force: true });
  return { ok: true };
}
