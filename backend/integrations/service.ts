import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DB, one } from '../core/db';
import { Actor } from '../auth/service';
import { saveProduct } from '../products/service';
import { normalizePart } from '../pricing/engine';
import { Hooks, check, catalogItem, adminState, adminCommand, reviewProposal, protocol, readBody, ConnectionError, authenticate, getHistory } from './core';

export const priceHooks: Hooks = {
  app: 'pricelist',
  catalog: async tx => {
    const products = (await tx.query("SELECT p.id,p.part_number,p.description,p.unit,p.active,p.details,b.name brand,c.name category,COALESCE((SELECT json_agg(a.label) FROM product_aliases a WHERE a.product_id=p.id),'[]') aliases FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id")).rows;
    const custom = (await tx.query('SELECT id,reference,description,unit,status,product_id FROM reusable_custom_items')).rows;
    return [...products.map(p => catalogItem.parse({ id: p.id, type: 'PRODUCT', code: p.part_number, description: p.description, unit: p.unit, brand: p.brand || '', category: p.category || '', aliases: p.aliases, specifications: (p.details?.specifications || []).map((s: any) => `${s.label}: ${s.value}`).join('; ') || p.details?.detailedDescription || '', active: p.active })), ...custom.map(p => catalogItem.parse({ id: p.id, type: 'REUSABLE', code: p.reference, description: p.description, unit: p.unit, active: p.status === 'ACTIVE', convertedTo: p.product_id || null }))];
  },
  approve: async (tx, actor: Actor, input) => {
    check(actor.role === 'ADMIN', 'Administrator access required', 403);
    const type = z.enum(['PRODUCT', 'REUSABLE']).parse(input.type);
    if (input.decision === 'LINKED') {
      const id = z.string().uuid().parse(input.targetId);
      const row = await one(tx, type === 'PRODUCT' ? 'SELECT id,part_number code,unit FROM products WHERE id=$1 AND active=true' : "SELECT id,reference code,unit FROM reusable_custom_items WHERE id=$1 AND status='ACTIVE'", [id]);
      check(row, 'Choose an active existing item'); return { id, type, code: row.code, unit: row.unit };
    }
    if (type === 'PRODUCT') {
      check(input.product && typeof input.product.cost === 'string' && typeof input.product.listPrice === 'string' && input.pricingConfirmed === true, 'Enter and confirm product pricing before approval');
      const code = z.string().trim().min(1).max(100).parse(input.product.partNumber);
      await tx.query('SELECT id FROM settings WHERE id=1 FOR UPDATE');
      check(!await one(tx, "SELECT id FROM reusable_custom_items WHERE status='ACTIVE' AND normalized_reference=$1", [normalizePart(code)]), 'This reference exists as a reusable item. Link it or convert it in Reusable Custom Items first.', 409);
      const row = await saveProduct(tx, actor, input.product, undefined, undefined, 'WORKFLOW_REVIEW');
      return { id: row.id, type, code: input.product.partNumber, unit: input.product.unit };
    }
    const v = z.object({ reference: z.string().trim().max(100), description: z.string().trim().min(1).max(1000), unit: z.string().trim().min(1).max(20), suggestedUnitPrice: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/) }).strict().parse(input.custom);
    check(input.pricingConfirmed === true, 'Enter and confirm a suggested price');
    await tx.query('LOCK TABLE reusable_custom_items IN SHARE ROW EXCLUSIVE MODE');
    await tx.query('SELECT id FROM settings WHERE id=1 FOR UPDATE');
    const reference = normalizePart(v.reference); const description = v.description.trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
    const collision = await one(tx, "SELECT id FROM products WHERE $1<>'' AND normalized_part=$1 UNION ALL SELECT product_id FROM product_aliases WHERE $1<>'' AND normalized=$1 UNION ALL SELECT id FROM reusable_custom_items WHERE status='ACTIVE' AND (($1<>'' AND normalized_reference=$1) OR normalized_description=$2)", [reference, description]);
    check(!collision, 'A matching code or reusable description exists. Review and link the existing item instead.', 409);
    const id = randomUUID();
    await tx.query('INSERT INTO reusable_custom_items(id,reference,normalized_reference,description,normalized_description,unit,suggested_unit_price,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, v.reference, reference, v.description, description, v.unit, v.suggestedUnitPrice, actor.id]);
    return { id, type, code: v.reference, unit: v.unit };
  },
};
export async function integrationPublic(db: DB, req: Request, path: string) {
  if (path === "jobs-result") {
    try { const { receiveJobResult } = await import("./jobs"); return Response.json(await receiveJobResult(db, req)); }
    catch (e) { return Response.json({ error: e instanceof ConnectionError ? e.message : "Job result could not be applied" }, { status: e instanceof ConnectionError ? e.status : 503 }); }
  }
  if (path === 'users') {
    try {
      check(req.method === 'GET', 'Method not allowed', 405);
      await authenticate(db, req, 'users:read');
      const after = new URL(req.url).searchParams.get('after') || '';
      check(!after || z.string().uuid().safeParse(after).success, 'Invalid directory cursor');
      const rows = (await db.query("SELECT id,name,username,integration_reference reference,NOT COALESCE(disabled,false) active FROM users WHERE id::text>$1 ORDER BY id::text LIMIT 201", [after])).rows;
      return Response.json({ users: rows.slice(0,200), next: rows.length > 200 ? rows[199].id : null }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) { return Response.json({ error: e instanceof ConnectionError ? e.message : 'Directory unavailable' }, { status: e instanceof ConnectionError ? e.status : 503 }); }
  }
  try { return Response.json(await protocol(db, priceHooks, req, path), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (e) { return Response.json({ error: e instanceof ConnectionError ? e.message : 'Invalid or unavailable integration request' }, { status: e instanceof ConnectionError ? e.status : e instanceof z.ZodError ? 400 : 503 }); }
}
export async function integrationAdmin(db: DB, actor: Actor, req: Request) {
  try {
    check(actor.role === 'ADMIN', 'Administrator access required', 403);
    const url = new URL(req.url);
    if (req.method === 'GET') {
      if (url.searchParams.has('incoming')) { const page = Math.max(0, Math.min(100000, Number(url.searchParams.get('page')) || 0)); return Response.json({ rows: (await db.query('SELECT * FROM sw_link_proposals ORDER BY updated_at DESC LIMIT 100 OFFSET $1', [page * 100])).rows }); }
      if (url.searchParams.has('history')) { const page = Math.max(0, Math.min(100000, Number(url.searchParams.get('page')) || 0)); return Response.json({ rows: await getHistory(db, 50) }); }
      if (url.searchParams.has('search')) { const term = `%${(url.searchParams.get('search') || '').slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`; return Response.json({ rows: (await db.query("SELECT id,'PRODUCT' type,part_number code,description,unit FROM products WHERE active AND (part_number ILIKE $1 OR description ILIKE $1) UNION ALL SELECT id,'REUSABLE' type,reference code,description,unit FROM reusable_custom_items WHERE status='ACTIVE' AND (reference ILIKE $1 OR description ILIKE $1) LIMIT 100", [term])).rows }); }
      return Response.json(await adminState(db, priceHooks));
    }
    check(req.method === 'POST', 'Method not allowed', 405); const body = await readBody(req);
    return Response.json(body.action === 'review' ? await reviewProposal(db, priceHooks, actor, body) : await adminCommand(db, priceHooks, actor.id, body));
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Connection unavailable' }, { status: e instanceof ConnectionError ? e.status : e instanceof z.ZodError ? 400 : 500 }); }
}
