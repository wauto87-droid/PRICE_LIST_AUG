import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { DB, one } from '../core/db';
import { Actor, has, requirePermission } from '../auth/service';
import { getQuote } from '../quotations/service';
import { audit } from '../core/audit';
import { authenticate, check, readBody, remote, state } from './core';
import { assignmentInput, costInput, deliver, enqueue, hash, lineFingerprint, receipt, workflowEnabled } from './job-protocol';

const J = JSON.stringify;
const idFor = (line: any) => line.input?.watcherEventId;
function mayCost(actor: Actor, quote: any) { return quote.owner_id === actor.id || actor.role === 'ADMIN' || has(actor, 'COST_VIEW'); }
async function document(db: DB, actor: Actor, id: string, edit = false) {
  const q = await getQuote(db, actor, id, edit);
  if (edit) { requirePermission(actor, 'QUOTE_EDIT'); check(mayCost(actor, q), 'Cost access is required for job assignments', 403); }
  const settings = await one(db, 'SELECT data FROM settings WHERE id=1');
  q.workflowCurrency = q.company_snapshot?.currency || settings?.data?.currency || 'SAR';
  return q;
}
async function prepare(tx: DB, q: any) {
  let changed = false; const seen = new Set<string>();
  for (const line of q.lines) {
    let id = idFor(line);
    if (!id) { id = randomUUID(); line.input = { ...line.input, watcherEventId: id }; changed = true; }
    check(!seen.has(id), 'Duplicate line identities. Duplicate products must have separate line IDs.', 409); seen.add(id);
  }
  if (changed) {
    await tx.query('UPDATE quotations SET lines=$2::jsonb,version=version+1 WHERE id=$1', [q.id, J(q.lines)]); q.version++;
  }
  await tx.query('INSERT INTO sw_job_documents(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING', [q.id, J({ lines: {} })]);
  return (await one(tx, 'SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE', [q.id]))!;
}
function ready(q: any, link: any) {
  const complete = q.lines.length > 0 && q.lines.every((l: any) => {
    const job = link.data.lines[idFor(l)]?.PRICING;
    return l.workflowCost?.fingerprint === lineFingerprint(l) && (!job || job.status === 'COMPLETED' || job.status === 'KNOWN');
  });
  return { complete, ready: complete && q.status === 'DRAFT', count: q.lines.length, round: complete ? hash(q.lines.map((l: any) => [idFor(l), l.workflowCost])) : null };
}
export async function jobWorkspace(db: DB, actor: Actor, req: Request) {
  workflowEnabled(); const url = new URL(req.url); const id = url.searchParams.get('documentId');
  if (req.method === 'GET' && url.searchParams.has('staff')) {
    const config = await state(db); check(config.url && config.secret, 'Pair ERP before assigning jobs');
    return remote(config, `jobs-staff?actor=${encodeURIComponent(actor.id)}`);
  }
  if (req.method === 'GET' && !id) {
    const isAdmin = actor.role === 'ADMIN' || has(actor, 'QUOTE_VIEW_ALL');
    const statusParam = (url.searchParams.get('status') || '').trim().toUpperCase();
    const ownerParam = (url.searchParams.get('owner') || '').trim();

    const conditions: string[] = ["q.status<>'DELETED'"];
    const params: any[] = [];

    if (statusParam && statusParam !== 'ALL') {
      params.push(statusParam);
      conditions.push(`q.status = $${params.length}`);
    }

    if (!isAdmin) {
      params.push(actor.id);
      conditions.push(`(q.owner_id = $${params.length}::uuid OR $${params.length}::uuid = ANY(q.shared_with))`);
    } else {
      if (ownerParam === 'me') {
        params.push(actor.id);
        conditions.push(`q.owner_id = $${params.length}::uuid`);
      } else if (ownerParam && ownerParam !== 'all') {
        params.push(ownerParam);
        conditions.push(`q.owner_id = $${params.length}::uuid`);
      }
    }

    const whereClause = conditions.join(' AND ');
    const rows = (await db.query(`SELECT q.id,q.number,q.status,q.customer,q.owner_id,u.name creator,j.data workflow FROM quotations q
      LEFT JOIN users u ON u.id=q.owner_id LEFT JOIN sw_job_documents j ON j.id=q.id::text
      WHERE ${whereClause} ORDER BY q.updated_at DESC LIMIT 200`, params)).rows;

    const creators = isAdmin
      ? (await db.query('SELECT id, name, username FROM users WHERE disabled IS NOT TRUE ORDER BY name ASC')).rows
      : [];

    return {
      userId: actor.id,
      isAdmin,
      creators,
      rows: rows.map(q => {
        const lines = Object.values<any>(q.workflow?.lines || {});
        return {
          id: q.id,
          number: q.number,
          status: q.status,
          customer: q.customer,
          creator: q.creator || 'Unknown',
          ownerId: q.owner_id,
          pricing: lines.filter(l => ['COMPLETED','KNOWN'].includes(l.PRICING?.status)).length,
          pricingAssigned: lines.filter(l => l.PRICING).length,
          collection: lines.filter(l => l.COLLECTION?.status === 'COMPLETED').length,
          collectionAssigned: lines.filter(l => l.COLLECTION).length,
          blockers: lines.filter(l => l.PRICING?.blocker || l.COLLECTION?.blocker).length
        };
      })
    };
  }
  if (req.method === 'GET' && id) return db.transaction(async tx => {
    await tx.query('SELECT id FROM quotations WHERE id=$1 FOR UPDATE', [id]);
    const q = await document(tx, actor, id); const link = await prepare(tx, q);
    const failures = (await tx.query("SELECT id,state,error FROM sw_job_outbox WHERE payload->>'documentId'=$1 AND state<>'SENT' ORDER BY next_at DESC", [id])).rows;
    return { id: q.id, number: q.number, status: q.status, version: q.version, workflowVersion: link.revision, creatorId: q.owner_id, currency: q.workflowCurrency, ...ready(q, link),
      canAssign: mayCost(actor, q) && has(actor,'QUOTE_EDIT'), failures, lines: q.lines.map((l: any) => ({ id: idFor(l), description: l.description, partNumber: l.partNumber, unit: l.unit, quantity: l.input?.quantity || l.price?.quantity, jobs: link.data.lines[idFor(l)] || {},
        ...(mayCost(actor, q) ? { workflowCost: l.workflowCost, sellingPrice: l.price?.finalExcl, margin: l.workflowCost && l.price?.finalExcl && l.workflowCost.currency === q.workflowCurrency ? new Decimal(l.price.finalExcl).minus(l.workflowCost.cost).toFixed() : null } : {}) })) };
  });
  check(req.method === 'POST', 'Method not allowed', 405);
  const input = await readBody(req); const documentId = z.string().uuid().parse(input.documentId);
  const commandId = z.string().uuid().parse(input.eventId);
  const result = await receipt(db, `local:${actor.id}:${commandId}`, input, async tx => {
    await tx.query('SELECT id FROM quotations WHERE id=$1 FOR UPDATE', [documentId]);
    const q = await document(tx, actor, documentId, true); const link = await prepare(tx, q);
    check(input.workflowVersion === link.revision, 'Assignments changed. Refresh before editing.', 409);
    check(q.version === input.version, 'Draft changed. Refresh before assigning or confirming prices.', 409);
    if (input.action === 'known') {
      check(q.status === 'DRAFT', 'Only editable drafts can receive confirmed prices', 409);
      const line = q.lines.find((l: any) => idFor(l) === input.lineId); check(line, 'Line missing');
      check(!link.data.lines[input.lineId]?.PRICING || ['COMPLETED','KNOWN','REVIEW_REQUIRED'].includes(link.data.lines[input.lineId].PRICING.status), 'Finish or reassign the pending pricing job before marking its cost known', 409);
      const cost = costInput.parse(input.cost); check(cost.unit === line.unit && cost.currency === q.workflowCurrency, 'Confirm currency and unit conversion first');
      line.workflowCost = { ...cost, ownerId: q.owner_id, fingerprint: lineFingerprint(line), actorName: (actor as any).name || 'Creator', actorId: actor.id, updatedAt: new Date().toISOString() };
      link.data.lines[input.lineId] = { ...link.data.lines[input.lineId], PRICING: { status: 'KNOWN', updatedAt: line.workflowCost.updatedAt } };
      await tx.query('UPDATE quotations SET lines=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1', [q.id, J(q.lines)]);
    } else {
      check(input.action === 'assign', 'Unknown job action');
      const kind = z.enum(['PRICING','COLLECTION']).parse(input.kind);
      check(kind === 'PRICING' ? q.status === 'DRAFT' : ['ISSUED','ACCEPTED'].includes(q.status), kind === 'PRICING' ? 'Save an editable draft before assigning pricing' : 'Issue the quotation before authorizing collection', 409);
      const payload = assignmentInput.parse({ ...input, eventId: z.string().uuid().parse(input.eventId), documentVersion: q.version,
        ownerId: q.owner_id, actorId: actor.id, number: q.number, customer: q.customer.name || 'Customer', contact: q.customer.mobile || '',
        lines: q.lines.map((l: any) => ({ id: idFor(l), name: l.description, partNumber: l.partNumber || '', specifications: l.specifications || '', unit: l.unit,
          quantity: String(l.input?.quantity || l.price?.quantity), currency: q.workflowCurrency, fingerprint: lineFingerprint(l), knownCost: l.workflowCost?.fingerprint === lineFingerprint(l) ? l.workflowCost : undefined })) });
      const oldEvent = await one(tx, 'SELECT payload FROM sw_job_outbox WHERE id=$1', [payload.eventId]);
      check(!oldEvent || hash(oldEvent.payload) === hash(payload), 'Assignment retry differs from the original', 409);
      if (!oldEvent) {
        for (const lineId of payload.selected) {
          const entry = link.data.lines[lineId] ||= {};
          entry[kind] = { token: payload.eventId, status: 'PENDING_ERP_SYNC', owner: payload.assignee, currency: payload.lines.find(l => l.id === lineId)!.currency, notes: payload.notes, shops: payload.shops, due: payload.due || payload.noDueReason };
        }
        await enqueue(tx, payload.eventId, 'jobs-assign', payload);
      }
    }
    await tx.query('UPDATE sw_job_documents SET data=$2::jsonb,revision=revision+1 WHERE id=$1', [q.id, J(link.data)]);
    await audit(tx, actor.id, 'WORKFLOW_JOB', 'quotations', q.id, null, { action: input.action, selected: input.selected || [input.lineId] });
    const completion = ready(q, link);
    if (completion.ready && completion.round) await enqueue(tx, `ready:${q.id}:${completion.round}`, 'jobs-ready', { eventId: `ready:${q.id}:${completion.round}`, documentId: q.id, actorId: actor.id, ...completion });
    return { saved: true, ...completion };
  });
  void runPriceJobs(db).catch(() => {});
  return result;
}
const resultInput = z.object({ eventId: z.string().uuid(), documentId: z.string().uuid(), lineId: z.string().uuid(), token: z.string().uuid(),
  revision: z.number().int(), kind: z.enum(['PRICING','COLLECTION']), fingerprint: z.string().length(64), done: z.boolean(), blocker: z.string(),
  actorName: z.string().max(500), updatedAt: z.string().datetime(), cost: costInput.optional(), movements: z.array(z.any()).max(10000).default([]) });
export async function receiveJobResult(db: DB, req: Request) {
  workflowEnabled(); check(req.method === 'POST', 'Method not allowed', 405); await authenticate(db, req, 'jobs:results');
  const result = resultInput.parse(await readBody(req));
  return receipt(db, result.eventId, result, async tx => {
    const q = await one(tx, 'SELECT * FROM quotations WHERE id=$1 FOR UPDATE', [result.documentId]); check(q, 'Document not found', 404);
    const link = await one(tx, 'SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE', [q.id]); check(link, 'Document was not linked', 409);
    const job = link.data.lines[result.lineId]?.[result.kind];
    if (!job || job.token !== result.token || (job.revision || 0) >= result.revision) return { received: true, stale: true };
    const line = q.lines.find((l: any) => idFor(l) === result.lineId);
    const conflict = !line || lineFingerprint(line) !== result.fingerprint || (result.kind === 'PRICING' && q.status !== 'DRAFT') ||
      (result.cost && (result.cost.unit !== line?.unit || result.cost.currency !== job.currency));
    job.revision = result.revision; job.status = conflict ? 'REVIEW_REQUIRED' : result.done ? 'COMPLETED' : 'PENDING';
    job.blocker = conflict ? 'Document, product, currency or unit changed; review the retained ERP result' : result.blocker;
    job.actorName = result.actorName; job.updatedAt = result.updatedAt;
    // Costs stay in the restricted quotation line; job summaries contain no cost payload.
    if (conflict) { job.pendingResultId = result.eventId; (link.data.pendingResults ||= {})[result.eventId] = result; }
    if (result.kind === 'COLLECTION') job.movements = result.movements;
    if (!conflict && result.kind === 'PRICING' && result.done) {
      check(result.cost, 'Completed pricing requires a supplier cost');
      line.workflowCost = { ...result.cost, ownerId: q.owner_id, fingerprint: result.fingerprint, actorName: result.actorName, updatedAt: result.updatedAt };
      await tx.query('UPDATE quotations SET lines=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1', [q.id, J(q.lines)]);
    }
    await tx.query('UPDATE sw_job_documents SET data=$2::jsonb,revision=revision+1 WHERE id=$1', [q.id, J(link.data)]);
    await audit(tx, null, 'WORKFLOW_RESULT', 'quotations', q.id, null, { eventId: result.eventId, lineId: result.lineId, conflict });
    return { received: true, ...ready(q, link) };
  });
}
let running = false;
export async function runPriceJobs(db: DB) {
  if (running || process.env.WORKFLOW_INTEGRATION_ENABLED !== 'true') return; running = true;
  try { await deliver(db, 'REMOTE', undefined, async (row, response) => {
    if (row.endpoint !== 'jobs-assign') return;
    await db.transaction(async tx => {
      const link = await one(tx, 'SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE', [row.payload.documentId]); if (!link) return;
      for (const lineId of row.payload.selected) {
        const job = link.data.lines[lineId]?.[row.payload.kind];
        if (job?.token === row.payload.eventId && job.status === 'PENDING_ERP_SYNC') job.status = 'ASSIGNED';
      }
      link.data.erpRequestId = response.requestId;
      await tx.query('UPDATE sw_job_documents SET data=$2::jsonb WHERE id=$1', [link.id, J(link.data)]);
    });
  }); } finally { running = false; }
}

// Quotation save/issue rebuilds prices from the catalog. Keep only server-owned
// per-line sourcing metadata whose identity/specification fingerprint still matches.
export function preserveWorkflowCosts(lines: any[], oldLines: any[]) {
  const old = new Map(oldLines.map(l => [idFor(l), l])); const ids = new Set<string>();
  for (const line of lines) {
    const id = idFor(line); check(id && !ids.has(id), 'Each product card needs its own line identity', 409); ids.add(id);
    const previous = old.get(id);
    if (previous?.workflowCost) line.workflowCost = { ...previous.workflowCost, stale: previous.workflowCost.fingerprint !== lineFingerprint(line) };
  }
  return lines;
}

export async function assertWorkflowPricingReady(db: DB, q: any) {
  const link = await one(db, 'SELECT * FROM sw_job_documents WHERE id=$1', [q.id]);
  if (link && Object.values<any>(link.data.lines).some(l => l.PRICING)) check(ready(q, link).complete, 'Finish or review all assigned supplier prices before issuing this quotation', 409);
}
