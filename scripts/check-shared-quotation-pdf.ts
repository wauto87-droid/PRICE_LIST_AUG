// Isolated visual check of the real quotation worker. Writes only to the provided QA output directory.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { embedded, migrate, one } from '../backend/core/db';
import { sharedQuotationPdfJob, sharedQuotationPrint, sharedQuotationPdfDownload } from '../backend/integrations/shared-quotation-pdf';
import { runJob } from '../backend/worker/process';

const output = process.argv[2];
assert(output && path.isAbsolute(output), 'Pass an absolute QA output directory');
process.env.UPLOAD_DIR = output;
const db = await embedded();
try {
  await migrate(db);
  await db.query(`UPDATE settings SET data=jsonb_set(data,'{quotation}',data->'quotation' || $1::jsonb) WHERE id=1`, [JSON.stringify({ legalName: 'AMT Electric · QA', termsEnglish: 'Payment and delivery follow the accepted customer order.', termsArabic: 'شروط الدفع والتسليم حسب طلب العميل', watermark: { enabled: true, text: 'AMT Electric', opacity: 0.07, size: 320, position: 'CENTER', rotation: -25, useLogo: false, image: '' } })]);
  const requestId = randomUUID();
  const q = { id: randomUUID(), version: 1, date: '2026-10-05T09:00:00Z', customer: 'Quotation QA Customer', contact: 'customer@example.test', currency: 'SAR', taxBasis: 'EXCLUSIVE', taxRate: '15', subtotal: '7500.00', taxTotal: '1125.00', total: '8625.00', lines: Array.from({ length: 75 }, (_, i) => ({ name: `TeSys contactor ${i + 1}`, specifications: '3P AC3 · 24V AC coil · Arabic وصف المنتج', unit: 'pcs', quantity: '1', sellingPrice: '100', offer: { supplier: 'INTERNAL_SUPPLIER_DO_NOT_PRINT', cost: 'INTERNAL_COST_DO_NOT_PRINT' } })) };
  await fs.mkdir(output, { recursive: true });
  const result = { requestId, number: 'REQ-QA', quotations: [q] };
  const print = await sharedQuotationPrint(db, 'qa-owner', result, 1);
  const html = await print.text();
  assert(!html.includes('INTERNAL_'));
  await fs.writeFile(path.join(output, 'quotation-preview.html'), html);
  const job = await sharedQuotationPdfJob(db, 'qa-owner', requestId, q, 'REQ-QA');
  assert.equal((await one(db, "SELECT count(*) n FROM jobs WHERE kind='QUOTE_PDF'"))!.n, 1);
  await runJob(db);
  const finished = await one(db, 'SELECT status,error FROM jobs WHERE id=$1', [job.id]);
  assert.equal(finished!.status, 'DONE', finished!.error);
  const response = await sharedQuotationPdfDownload(db, result, job.id, true);
  await fs.writeFile(path.join(output, 'quotation.pdf'), Buffer.from(await response.arrayBuffer()));
  // A different version uses an independent presentation snapshot; neither version is expired.
  const next = await sharedQuotationPdfJob(db, 'qa-owner', requestId, { ...q, version: 2 }, 'REQ-QA');
  await runJob(db);
  assert.equal((await one(db, 'SELECT status FROM jobs WHERE id=$1', [job.id]))!.status, 'DONE');
  assert.equal((await one(db, 'SELECT status FROM jobs WHERE id=$1', [next.id]))!.status, 'DONE');
  assert.equal((await one(db, 'SELECT count(*) n FROM quotations'))!.n, 0);
  console.log('Real PDF worker passed: stable snapshot, safe output, no duplicate quotation/job, historical version retained.');
  console.log(path.join(output, 'quotation.pdf'));
} finally { await db.close!(); }
