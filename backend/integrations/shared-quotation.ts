import { z } from 'zod';
import Decimal from 'decimal.js';
import { DB, one } from '../core/db';
import { Actor, requirePermission } from '../auth/service';
import { authenticate, check, readBody, remote, state } from './core';
import { receipt, workflowEnabled } from './job-protocol';
import { getQuote } from '../quotations/service';
import { quotationHTML } from './quotation-print';

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
  if (documentId) {
    const q = await getQuote(db, actor, documentId, true);
    check(q.owner_id === actor.id || actor.role === 'ADMIN', 'Only creator can manage shared quotations', 403);
  }
  const config = await state(db);
  if (!documentId && !requestId && req.method === 'GET') return Response.json(await transport(config, 'jobs-quotation-list', { actorId: actor.id }));
  check(documentId || requestId, 'Choose a request');
  if (req.method === 'POST') {
    z.string().uuid().parse(input.eventId);
    check(['saveQuotation', 'confirmQuotation', 'approveCollection'].includes(input.action), 'Unsupported quotation action');
  }
  // Send the browser's revision unchanged. Retrying uses the same event ID and payload.
  const result = await transport(config, req.method === 'POST' ? 'jobs-quotation-command' : 'jobs-quotation', { ...input, documentId: documentId || undefined, requestId: requestId || undefined, actorId: actor.id });
  if (params.has('print')) {
    const q = result.quotations.find((q: any) => q.version === Number(params.get('version'))); check(q, 'Quotation missing', 404);
    const safe = { ...q, lines: q.lines.map((l: any) => ({ name: l.name, specifications: l.specifications, unit: l.unit, quantity: l.quantity, sellingPrice: l.sellingPrice, total: new Decimal(l.quantity).mul(l.sellingPrice).toFixed(2) })) };
    // Canonical totals and prices are returned by ERP; no internal fields are rendered.
    return new Response(quotationHTML(safe), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  return Response.json(result);
}
