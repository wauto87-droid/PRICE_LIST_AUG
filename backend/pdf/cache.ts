import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { type DB, one } from "../core/db";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

export function quotationPdfFingerprint(snapshot: unknown) {
  return createHash("sha256").update(stableJson(snapshot)).digest("hex");
}
/** Only fields consumed by the customer renderer belong in a render artifact. */
export function quotationRenderSnapshot(q:any){
  return {id:q.id,number:q.number,status:q.status==='DRAFT'?'DRAFT':'ISSUED',created_at:q.created_at,issued_at:q.issued_at,sharedVersion:q.sharedVersion,customer:q.customer,totals:q.totals,company_snapshot:q.company_snapshot,
    lines:q.lines.map((l:any)=>({source:l.source,partNumber:l.partNumber,description:l.description,unit:l.unit,importMeta:l.importMeta || l.input?.importMeta,
      input:{type:l.input?.type,quantity:l.input?.quantity},price:l.price?{quantity:l.price.quantity,finalExcl:l.price.finalExcl,finalIncl:l.price.finalIncl,subtotal:l.price.subtotal,vatAmount:l.price.vatAmount,vatRate:l.price.vatRate,total:l.price.total}:null}))};
}

const pdfPath = (jobId: string) =>
  path.join(
    path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
    "pdf",
    `${jobId}.pdf`,
  );
export async function quotationPdfArtifactExists(id:string){
  try{return (await fs.stat(pdfPath(id))).isFile();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}

async function removePdf(jobId: string) {
  try {
    await fs.unlink(pdfPath(jobId));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    console.error("Could not remove superseded quotation PDF", jobId, error);
    return false;
  }
}

/** Marks the completed PDF current and retires successfully generated older versions. */
export async function finalizeQuotationPdf(db: DB, job: any) {
  if(job.payload?.preserveHistory || String(job.payload?.quoteId || '').startsWith('shared:')){
    await db.query("UPDATE jobs SET status='DONE',error=NULL WHERE id=$1",[job.id]);
    return;
  }
  const quoteId = job.payload?.quoteId;
  if (!quoteId) {
    await db.query("UPDATE jobs SET status='DONE',error=NULL WHERE id=$1", [job.id]);
    return;
  }

  const newer = await one(
    db,
    `SELECT id FROM jobs
     WHERE kind='QUOTE_PDF' AND status='DONE' AND payload->>'quoteId'=$1
       AND (created_at,id) > (SELECT created_at,id FROM jobs WHERE id=$2)
     LIMIT 1`,
    [quoteId, job.id],
  );
  if (newer) {
    if (await removePdf(job.id))
      await db.query(
        "UPDATE jobs SET status='EXPIRED',error='Superseded by a newer quotation PDF' WHERE id=$1",
        [job.id],
      );
    return;
  }

  await db.query("UPDATE jobs SET status='DONE',error=NULL WHERE id=$1", [job.id]);
  const older = await db.query<{ id: string }>(
    `SELECT id FROM jobs
     WHERE kind='QUOTE_PDF' AND status='DONE' AND payload->>'quoteId'=$1 AND id<>$2
       AND (created_at,id) < (SELECT created_at,id FROM jobs WHERE id=$2)`,
    [quoteId, job.id],
  );
  for (const olderJob of older.rows)
    if (await removePdf(olderJob.id))
      await db.query(
        "UPDATE jobs SET status='EXPIRED',error='Superseded by a newer quotation PDF' WHERE id=$1",
        [olderJob.id],
      );
}
