import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Decimal from 'decimal.js';
import { DB, one } from '../core/db';
import { check } from './core';
import { quotationHtml } from '../pdf/template';
import { quotationPdfFingerprint } from '../pdf/cache';
import { quotationPdfDisposition } from '../pdf/filename';

/** Customer-only adapter. Monetary totals come from ERP, never local pricing settings. */
export function sharedQuotationSnapshot(q: any, company: any, number?: string) {
  check(q.id && Number.isInteger(q.version), 'Quotation identity missing');
  const rate = new Decimal(q.taxBasis === 'EXEMPT' ? '0' : q.taxRate || '0');
  const weights = q.lines.map((l: any) => new Decimal(l.quantity).mul(l.sellingPrice));
  const gross = weights.reduce((n: Decimal, w: Decimal) => n.plus(w), new Decimal(0));
  let cumulative = new Decimal(0), priorSubtotal = new Decimal(0), priorTax = new Decimal(0);
  const lines = q.lines.map((l: any, index: number) => {
    cumulative = cumulative.plus(weights[index]);
    const share = gross.isZero() ? new Decimal(index + 1).div(q.lines.length) : cumulative.div(gross);
    const subtotal = new Decimal(q.subtotal).mul(share).toDecimalPlaces(2);
    const tax = new Decimal(q.taxTotal).mul(share).toDecimalPlaces(2);
    const lineSubtotal = subtotal.minus(priorSubtotal), lineTax = tax.minus(priorTax);
    priorSubtotal = subtotal; priorTax = tax;
    const unit = new Decimal(l.sellingPrice);
    const excl = q.taxBasis === 'INCLUSIVE' ? unit.div(rate.div(100).plus(1)) : unit;
    const incl = q.taxBasis === 'INCLUSIVE' ? unit : unit.mul(rate.div(100).plus(1));
    return { partNumber: l.partNumber || '', description: [l.name, l.specifications].filter(Boolean).join(' · '), unit: l.unit,
      price: { quantity: l.quantity, finalExcl: excl.toFixed(2), finalIncl: incl.toFixed(2), subtotal: lineSubtotal.toFixed(2), vatAmount: lineTax.toFixed(2), vatRate: rate.toFixed(), total: lineSubtotal.plus(lineTax).toFixed(2) } };
  });
  return { id: q.id, sharedVersion: q.version, number: `${number || q.id} · V${q.version}`, status: 'ISSUED', created_at: q.date, issued_at: q.date,
    customer: { name: q.customer, mobile: q.contact || '', number: q.customerDetails?.number || '', reference: q.customerDetails?.reference || '' }, lines,
    totals: { subtotal: q.subtotal, vat: q.taxTotal, total: q.total },
    company_snapshot: { ...structuredClone(company), currency: q.currency, pdfUnitPrices: q.taxBasis === 'INCLUSIVE' ? 'INCL' : 'EXCL' } };
}

/** The existing PDF jobs are presentation snapshots; no local quotation is created. */
export async function sharedQuotationPdfJob(db: DB, actorId: string, requestId: string, q: any, number?: string) {
  const quoteId = `shared:${q.id}:v${q.version}`;
  return db.transaction(async tx => {
    // Lock the existing settings row to serialize first-time snapshot creation and retries.
    const settings = await one(tx, 'SELECT data FROM settings WHERE id=1 FOR UPDATE');
    check(settings, 'Company settings missing', 503);
    const existing = await one(tx, "SELECT * FROM jobs WHERE kind='QUOTE_PDF' AND payload->>'quoteId'=$1 ORDER BY created_at,id LIMIT 1", [quoteId]);
    check(!existing || existing.payload.sharedRequestId === requestId, 'Quotation request identity mismatch', 409);
    const snapshot = existing?.payload.snapshot || sharedQuotationSnapshot(q, settings.data, number);
    const fingerprint = quotationPdfFingerprint(snapshot);
    const cached = await one(tx, "SELECT id,status,error,payload FROM jobs WHERE kind='QUOTE_PDF' AND payload->>'quoteId'=$1 AND payload->>'fingerprint'=$2 AND status IN ('PENDING','RUNNING','DONE') ORDER BY created_at DESC,id DESC LIMIT 1", [quoteId, fingerprint]);
    if (cached) return cached;
    const id = randomUUID();
    const payload = { quoteId, sharedRequestId: requestId, sharedQuotationId: q.id, sharedVersion: q.version, ownerId: actorId, fingerprint, snapshot };
    await tx.query("INSERT INTO jobs(id,kind,payload) VALUES($1,'QUOTE_PDF',$2::jsonb)", [id, JSON.stringify(payload)]);
    return { id, status: 'PENDING', error: null, payload };
  });
}

export async function sharedQuotationPrint(db: DB, actorId: string, result: any, version: number) {
  const q = result.quotations.find((q: any) => q.version === version);
  check(q, 'Quotation missing', 404);
  const job = await sharedQuotationPdfJob(db, actorId, result.requestId, q, result.number);
  const logo = 'data:image/svg+xml;base64,' + (await fs.readFile(path.join(process.cwd(), 'public', 'logo.svg'))).toString('base64');
  const html = quotationHtml(job.payload.snapshot, job.payload.snapshot.company_snapshot, logo)
    .replace('<body>', '<body><div class="no-print"><button onclick="window.print()">Print quotation / Save PDF</button></div>');
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function sharedQuotationPdfDownload(db: DB, result: any, jobId: string, download: boolean) {
  const job = await one(db, "SELECT * FROM jobs WHERE id=$1 AND kind='QUOTE_PDF'", [jobId]);
  check(job && job.payload.sharedRequestId === result.requestId && result.quotations.some((q: any) => q.id === job.payload.sharedQuotationId && q.version === job.payload.sharedVersion), 'PDF not found', 404);
  if (!download) return Response.json({ id: job.id, status: job.status, error: job.error });
  check(job.status === 'DONE', 'PDF is not ready', 409);
  return new Response(await fs.readFile(path.join(path.resolve(process.env.UPLOAD_DIR || '.data/uploads'), 'pdf', `${job.id}.pdf`)),
    { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': quotationPdfDisposition(job.payload.snapshot), 'Cache-Control': 'private, no-store' } });
}
