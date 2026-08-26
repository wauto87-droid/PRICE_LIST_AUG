import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import { type Actor, requirePermission } from "../auth/service";
import {
  productInput,
  validateProduct,
  normalizePart,
} from "../pricing/engine";
import { saveProduct, getProduct, toInput } from "../products/service";
import { importCandidate } from "../pricing/transfer";
export async function upload(db: DB, actor: Actor, file: File) {
  const ext = path.extname(file.name).toLowerCase();
  assert(
    [".xlsx", ".xls", ".csv", ".pdf"].includes(ext),
    400,
    "Supported files: XLSX, XLS, CSV, PDF",
  );
  const kind = ext === ".pdf" ? "PDF" : "EXCEL";
  requirePermission(actor, kind === "PDF" ? "IMPORT_PDF" : "IMPORT_EXCEL");
  assert(
    file.size > 0 &&
      file.size <= Number(process.env.UPLOAD_MAX_MB || 20) * 1024 * 1024,
    413,
    "File exceeds upload limit",
  );
  const dir = path.resolve(process.env.UPLOAD_DIR || ".data/uploads");
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID();
  const target = path.join(dir, id + ext);
  await fs.writeFile(target, Buffer.from(await file.arrayBuffer()), {
    flag: "wx",
    mode: 0o600,
  });
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id) VALUES($1,$2,$3,$4,'UPLOADED',$5)",
      [id, path.basename(file.name), target, kind, actor.id],
    );
    await tx.query(
      "INSERT INTO jobs(id,kind,payload) VALUES($1,'IMPORT_EXTRACT',$2)",
      [randomUUID(), json({ importId: id })],
    );
    await audit(tx, actor.id, kind + "_UPLOAD", "import_jobs", id);
  });
  return { id };
}
export async function mapRows(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  requirePermission(actor, "IMPORT_CONFIRM");
  const data = z
    .object({
      mapping: z.record(z.string(), z.string()),
      defaults: z.record(z.string(), z.unknown()),
      version: z.number().int(),
    })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    const job = await one(
      tx,
      "SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      job && job.status === "AWAITING_REVIEW",
      409,
      "Import is not ready for mapping",
    );
    assert(job.version === data.version, 409, "Import changed. Reload");
    const rows = (
      await tx.query(
        "SELECT * FROM import_rows WHERE job_id=$1 ORDER BY row_number",
        [id],
      )
    ).rows;
    for (const row of rows) {
      let proposed: Record<string, any> = {};
      for (const [field, column] of Object.entries(data.mapping))
        if (row.raw[column] !== undefined && row.raw[column] !== "")
          proposed[field] = String(row.raw[column]).trim();
      if (typeof proposed.minimumEnabled === "string")
        proposed.minimumEnabled = ["true", "1", "yes", "on"].includes(
          proposed.minimumEnabled.toLowerCase(),
        );
      if (typeof proposed.quantityPrecision === "string")
        proposed.quantityPrecision = Number(proposed.quantityPrecision);
      if (typeof proposed.aliases === "string")
        proposed.aliases = proposed.aliases.split("|").filter(Boolean);
      let parsed: any = null;
      const errors: string[] = [];
      const duplicate = proposed.partNumber
        ? await one(
            tx,
            "SELECT id,version FROM products WHERE normalized_part=$1",
            [normalizePart(proposed.partNumber)],
          )
        : null;
      try {
        proposed = importCandidate(
          proposed,
          data.defaults,
          duplicate ? toInput(await getProduct(tx, duplicate.id)) : undefined,
        );
        parsed = validateProduct(productInput.parse(proposed));
      } catch (e) {
        errors.push(
          e instanceof z.ZodError
            ? e.issues.map((i) => i.path.join(".") + ": " + i.message).join(";")
            : (e as Error).message,
        );
      }
      await tx.query(
        "UPDATE import_rows SET proposed=$2,errors=$3,duplicate_id=$4,expected_version=$5,decision='REVIEW',verified=false WHERE id=$1",
        [
          row.id,
          json(parsed ?? proposed),
          json(errors),
          duplicate?.id ?? null,
          duplicate?.version ?? null,
        ],
      );
    }
    await tx.query(
      "UPDATE import_jobs SET mapping=$2,defaults=$3,version=version+1,updated_at=now() WHERE id=$1",
      [id, json(data.mapping), json(data.defaults)],
    );
    return { ok: true };
  });
}
export async function reviewRows(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  requirePermission(actor, "IMPORT_CONFIRM");
  const data = z
    .object({
      rows: z
        .array(
          z.object({
            id: z.string().uuid(),
            decision: z.enum(["KEEP", "UPDATE", "SKIP", "REVIEW"]),
            verified: z.boolean(),
            proposed: productInput.optional(),
          }),
        )
        .max(10000),
    })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    const job = await one(
      tx,
      "SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      job && job.status === "AWAITING_REVIEW",
      409,
      "Import is not awaiting review",
    );
    for (const change of data.rows) {
      const row = await one(
        tx,
        "SELECT * FROM import_rows WHERE id=$1 AND job_id=$2",
        [change.id, id],
      );
      assert(row, 404, "Import row not found");
      const proposed = change.proposed
        ? validateProduct(change.proposed)
        : row.proposed;
      let duplicate = row.duplicate_id,
        version = row.expected_version;
      if (change.proposed) {
        const match = await one(
          tx,
          "SELECT id,version FROM products WHERE normalized_part=$1",
          [normalizePart(change.proposed.partNumber)],
        );
        duplicate = match?.id ?? null;
        version = match?.version ?? null;
      }
      await tx.query(
        "UPDATE import_rows SET proposed=$2,errors=$3,decision=$4,verified=$5,duplicate_id=$6,expected_version=$7 WHERE id=$1",
        [
          row.id,
          json(proposed),
          json(change.proposed ? [] : row.errors),
          change.decision,
          change.verified,
          duplicate,
          version,
        ],
      );
    }
    await tx.query(
      "UPDATE import_jobs SET version=version+1,updated_at=now() WHERE id=$1",
      [id],
    );
    return { ok: true };
  });
}
export async function confirmImport(
  db: DB,
  actor: Actor,
  id: string,
  version: number,
) {
  requirePermission(actor, "IMPORT_CONFIRM");
  requirePermission(actor, "PRODUCT_EDIT");
  return db.transaction(async (tx) => {
    const job = await one(
      tx,
      "SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(job, 404, "Import not found");
    if (job.status === "IMPORTED") return { ok: true, alreadyImported: true };
    assert(
      job.status === "AWAITING_REVIEW" && job.version === version,
      409,
      "Import changed or is not awaiting review",
    );
    const rows = (
      await tx.query(
        "SELECT * FROM import_rows WHERE job_id=$1 ORDER BY row_number",
        [id],
      )
    ).rows;
    assert(rows.length > 0, 400, "Import has no rows");
    const seen = new Set<string>();
    const summary = { new: 0, updated: 0, skipped: 0 };
    await tx.query("UPDATE import_jobs SET status='CONFIRMED' WHERE id=$1", [
      id,
    ]);
    for (const row of rows) {
      assert(
        row.decision !== "REVIEW",
        400,
        `Row ${row.row_number} requires a decision`,
      );
      if (["KEEP", "SKIP"].includes(row.decision)) {
        summary.skipped++;
        continue;
      }
      assert(row.verified, 400, `Row ${row.row_number} must be verified`);
      assert(!row.errors.length, 400, `Row ${row.row_number} contains errors`);
      const p = validateProduct(productInput.parse(row.proposed));
      const normalized = normalizePart(p.partNumber);
      assert(
        !seen.has(normalized),
        409,
        `Duplicate within this file: ${p.partNumber}. Skip one row`,
      );
      seen.add(normalized);
      const current = await one(
        tx,
        "SELECT id,version FROM products WHERE normalized_part=$1",
        [normalized],
      );
      assert(
        (current?.id ?? null) === row.duplicate_id &&
          (current?.version ?? null) === row.expected_version,
        409,
        `Product changed since review: ${p.partNumber}`,
      );
      await saveProduct(
        tx,
        actor,
        p,
        current?.id,
        current?.version,
        "IMPORT",
        id,
      );
      current ? summary.updated++ : summary.new++;
    }
    await tx.query(
      "UPDATE import_jobs SET status='IMPORTED',summary=$2,version=version+1,updated_at=now() WHERE id=$1",
      [id, json(summary)],
    );
    await audit(
      tx,
      actor.id,
      job.kind + "_IMPORT",
      "import_jobs",
      id,
      null,
      summary,
    );
    return summary;
  });
}
export async function rollback(db: DB, actor: Actor, id: string) {
  requirePermission(actor, "IMPORT_CONFIRM");
  requirePermission(actor, "PRODUCT_EDIT");
  return db.transaction(async (tx) => {
    const job = await one(
      tx,
      "SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      job?.status === "IMPORTED",
      409,
      "Only completed imports can be rolled back",
    );
    const changes = (
      await tx.query(
        "SELECT * FROM price_history WHERE import_id=$1 ORDER BY created_at DESC",
        [id],
      )
    ).rows;
    for (const change of changes) {
      const current = await getProduct(tx, change.product_id);
      assert(
        current.version === change.resulting_version,
        409,
        `Rollback blocked: ${current.part_number} was edited after import. Review it manually`,
      );
    }
    for (const change of changes) {
      const current = await getProduct(tx, change.product_id);
      await saveProduct(
        tx,
        actor,
        change.before_value ?? { ...toInput(current), active: false },
        change.product_id,
        current.version,
        "ROLLBACK",
      );
    }
    await tx.query(
      "UPDATE import_jobs SET status='ROLLED_BACK',version=version+1 WHERE id=$1",
      [id],
    );
    await audit(tx, actor.id, "IMPORT_ROLLBACK", "import_jobs", id);
    return { ok: true };
  });
}
