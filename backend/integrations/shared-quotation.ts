import { z } from 'zod';
import { DB, one } from '../core/db';
import { Actor, requirePermission } from '../auth/service';
import { authenticate, check, readBody, remote, state, ConnectionError } from './core';
import { receipt, workflowEnabled } from './job-protocol';
import { getQuote } from '../quotations/service';
import { sharedQuotationPrint, sharedQuotationPdfJob, sharedQuotationPdfDownload } from './shared-quotation-pdf';
import { sharedDraft } from '../../shared/shared-draft';

export async function receiveSharedQuotation(db: DB, req: Request) {
  workflowEnabled(); await authenticate(db, req, 'jobs:results');
  check(req.method === 'POST', 'Method not allowed', 405);
  const input = await readBody(req);
  z.string().uuid().parse(input.documentId); z.number().int().positive().parse(input.requestRevision);
  return receipt(db, input.eventId, input, async tx => {
    const link = await one(tx, 'SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE', [input.documentId]);
    check(link, 'Document missing', 404);
    if ((link.data.quotationRevision || 0) >= input.requestRevision) return { received: true, stale: true };
    link.data.sharedQuotations = input.quotations;
    link.data.quotationRevision = input.requestRevision;
    link.data.erpRevision = Math.max(link.data.erpRevision || 0, input.requestRevision);
    link.data.erpRequestId = input.requestId;
    link.data.sharedQuotationStatus = input.status;
    await tx.query('UPDATE sw_job_documents SET data=$2::jsonb WHERE id=$1', [link.id, JSON.stringify(link.data)]);
    return { received: true };
  });
}

export async function sharedQuotationWorkspace(db: DB, actor: Actor, req: Request, transport = remote) {
  workflowEnabled(); requirePermission(actor, 'QUOTE_EDIT');
  const params = new URL(req.url).searchParams;
  const input: any = req.method === 'POST' ? await readBody(req) : {};
  const documentId = input.documentId || params.get('documentId');
  const requestId = input.requestId || params.get('requestId');
  let sourceQuote: any;
  if (documentId) {
    const q = sourceQuote = await getQuote(db, actor, documentId, true);
    check(q.owner_id === actor.id || actor.role === 'ADMIN', 'Only creator can manage shared quotations', 403);
  }
  const config = await state(db);
  if (!documentId && !requestId && req.method === 'GET') return Response.json(await transport(config, 'jobs-quotation-list', { actorId: actor.id }));
  check(documentId || requestId, 'Choose a request');
  if (req.method === 'POST') {
    z.string().uuid().parse(input.eventId);
    check(['saveQuotation', 'confirmQuotation', 'approveCollection', 'orderDelivered', 'legacyDelivered', 'confirmLegacyCollection', 'orderConfirm', 'orderCancel', 'quotationPdf'].includes(input.action), 'Unsupported quotation action');
  }
  // Send the browser's revision unchanged. Retrying uses the same event ID and payload.
  const localPdf = input.action === 'quotationPdf';
  let result;
  try {
    result = await transport(config, req.method === 'POST' && !localPdf ? 'jobs-quotation-command' : 'jobs-quotation', { ...input, documentId: documentId || undefined, requestId: requestId || undefined, actorId: actor.id });
  } catch (error) {
    // Preserve explicit validation/conflict responses so the editor can refresh after a rejected save.
    if (error instanceof ConnectionError && [400, 409, 422].includes(error.remoteStatus || 0)) throw new ConnectionError(error.message, error.remoteStatus, error.remoteStatus, error.code);
    throw error;
  }
  if (documentId && !localPdf && !params.has('pdfJob') && !params.has('print')) {
    await db.transaction(async tx => {
      const link = await one(tx, 'SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE', [documentId]);
      if (link && Number(link.data.quotationRevision || 0) <= result.requestRevision) {
        link.data.sharedQuotations = result.quotations.map((q: any) => ({ ...q, lines: q.lines.map(({ offer, actor, ...line }: any) => line) }));
        link.data.quotationRevision = result.requestRevision;
        link.data.erpRequestId = result.requestId;
        await tx.query('UPDATE sw_job_documents SET data=$2::jsonb WHERE id=$1', [link.id, JSON.stringify(link.data)]);
      }
    });
  }
  if (params.has('pdfJob')) {
    z.string().uuid().parse(params.get('pdfJob'));
    return sharedQuotationPdfDownload(db, result, params.get('pdfJob')!, params.has('download'));
  }
  if (localPdf) {
    const version = z.number().int().positive().parse(input.quoteVersion);
    const q = result.quotations.find((q: any) => q.version === version); check(q, 'Quotation missing', 404);
    if (!sourceQuote && result.documentId) sourceQuote = await getQuote(db, actor, result.documentId, true);
    const job = await sharedQuotationPdfJob(db, actor.id, result.requestId, q, sourceQuote?.number || result.number);
    return Response.json({ id: job.id, status: job.status, error: job.error });
  }
  if (params.has('print')) {
    if (!sourceQuote && result.documentId) sourceQuote = await getQuote(db, actor, result.documentId, true);
    return sharedQuotationPrint(db, actor.id, { ...result, number: sourceQuote?.number || result.number }, Number(params.get('version')));
  }
  if (params.has('draft')) {
    const source = sourceQuote || (result.documentId ? await getQuote(db, actor, result.documentId, true) : undefined);
    return Response.json(sharedDraft(result, source, Number(params.get('version')) || undefined));
  }
  return Response.json(result);
}
