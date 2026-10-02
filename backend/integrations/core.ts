// This protocol module is mirrored in PRICE_LIST_AUG/backend/integrations/core.ts.
import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { z } from 'zod';

export interface ConnectionDB {
  query(sql: string, args?: any[]): Promise<{ rows: any[] }>;
  transaction<T>(fn: (tx: ConnectionDB) => Promise<T>): Promise<T>;
}
export class ConnectionError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function check(value: unknown, message: string, status = 400): asserts value { if (!value) throw new ConnectionError(message, status); }
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const json = (v: unknown): string => JSON.stringify(v, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
const one = async (db: ConnectionDB, sql: string, args: any[] = []) => (await db.query(sql, args)).rows[0];
const str = z.string().trim().max(1000);
export const catalogItem = z.object({ id: z.string().min(1).max(200), type: z.enum(['PRODUCT', 'REUSABLE', 'LOCAL']), code: str, description: str.min(1), unit: str.min(1), brand: str.default(''), category: str.default(''), aliases: z.array(str).max(200).default([]), specifications: z.string().max(10000).default(''), manufacturerPart: str.default(''), active: z.boolean(), convertedTo: z.string().nullable().default(null), deleted: z.boolean().default(false) }).strict();
export type CatalogItem = z.infer<typeof catalogItem>;
export type Hooks = { app: 'workflow' | 'pricelist'; afterSync?: () => Promise<void>; catalog?: (tx: ConnectionDB) => Promise<CatalogItem[]>; approve?: (tx: ConnectionDB, actor: any, input: any) => Promise<{ id: string; type: 'PRODUCT' | 'REUSABLE'; code?: string; unit?: string }> };
export const scopesFor = (app: string) => app === 'pricelist' ? ['catalog:read', 'proposals:write', 'proposals:read', 'jobs:results', 'users:read'] : ['notifications:write', 'jobs:read', 'jobs:write'];
const keyBytes = () => { const raw = process.env.CONNECTED_APPS_ENCRYPTION_KEY || ''; check(/^[a-f\d]{64}$/i.test(raw), 'Configure CONNECTED_APPS_ENCRYPTION_KEY (64 hex characters) on this server', 503); return Buffer.from(raw, 'hex'); };
export function encrypt(secret: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv); const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]); return [iv, cipher.getAuthTag(), body].map(b => b.toString('base64')).join('.'); }
export function decrypt(value: string) { const [iv, tag, body] = value.split('.').map(s => Buffer.from(s, 'base64')); const cipher = createDecipheriv('aes-256-gcm', keyBytes(), iv); cipher.setAuthTag(tag); return Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8'); }
export async function validateURL(raw: string) {
  const u = new URL(raw); check(u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash, 'Use an HTTPS API URL without credentials, query or fragment');
  const addresses = await lookup(u.hostname, { all: true });
  check(addresses.length && addresses.every(a => isPublicAddress(a.address)), 'Connection URL must resolve to a public server');
  return u.toString().replace(/\/$/, '');
}
export function isPublicAddress(ip: string) {
  if (isIP(ip) === 6) return /^(2|3)/i.test(ip) && !/^2001:(db8|0:)/i.test(ip);
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return !([0, 10, 127].includes(a) || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b)));
}
export function enabled() { check(process.env.CONNECTED_APPS_ENABLED === 'true', 'Connected Apps is disabled on this server', 503); }
export async function state(db: ConnectionDB) { return (await one(db, 'SELECT data FROM sw_link_state WHERE id=1')).data; }
async function audit(db: ConnectionDB, actor: string, action: string, data: unknown) { await db.query('INSERT INTO sw_link_audit(id,actor,action,data) VALUES($1::uuid,$2,$3,$4::jsonb)', [randomUUID(), actor, action, json(data)]); }
export async function authenticate(db: ConnectionDB, req: Request, scope: string) {
  enabled(); const token = req.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  check(/^swk_[a-f0-9]{64}$/.test(token), 'Invalid integration key', 401);
  const row = await one(db, 'UPDATE sw_link_keys SET last_used_at=now() WHERE hash=$1 AND revoked_at IS NULL AND expires_at>now() AND $2=ANY(scopes) RETURNING id', [digest(token), scope]);
  check(row, 'Key expired, revoked or missing permission', 401); return row.id;
}
export async function logHistory(
  db: ConnectionDB,
  type: string,
  status: 'SUCCESS' | 'FAILED' | 'INFO',
  message: string,
  details: Record<string, any> = {},
  durationMs?: number
) {
  try {
    await audit(db, 'system', type, { status, message, duration_ms: durationMs ?? null, ...details });
  } catch {}
}

export async function getHistory(db: ConnectionDB, limit = 50) {
  try {
    const res = await db.query(
      `SELECT id, action as type, coalesce(data->>'status', 'INFO') as status, coalesce(data->>'message', action) as message, (data->>'duration_ms')::int as duration_ms, data as details, created_at FROM sw_link_audit ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return res.rows;
  } catch {
    return [];
  }
}

export async function adminState(db: ConnectionDB, hooks: Hooks) {
  const s = await state(db);
  const keys = (await db.query('SELECT id,name,scopes,expires_at,created_at,last_used_at,revoked_at FROM sw_link_keys ORDER BY created_at DESC')).rows;
  const counts = (await db.query('SELECT status,count(*)::int count FROM sw_link_proposals GROUP BY status')).rows;
  const count = await one(db, 'SELECT count(*)::int count FROM sw_link_catalog');
  return { ...s, app: hooks.app, enabled: process.env.CONNECTED_APPS_ENABLED === 'true',
    encryptionReady: /^[a-f\d]{64}$/i.test(process.env.CONNECTED_APPS_ENCRYPTION_KEY || ''),
    workflowEnabled: process.env.WORKFLOW_INTEGRATION_ENABLED === 'true', secret: undefined,
    credentialConfigured: !!s.secret, keys, counts, importedCount: count.count, scopes: scopesFor(hooks.app),
    history: await getHistory(db, 50) };
}

export async function adminCommand(db: ConnectionDB, hooks: Hooks, actor: string, input: any) {
  if (input.action === 'generate' || input.action === 'rotate') {
    const name = str.min(1).parse(input.name); const scopes = z.array(z.enum(scopesFor(hooks.app) as [string, ...string[]])).min(1).parse(input.scopes);
    const expires = z.string().datetime().parse(input.expires); check(Date.parse(expires) > Date.now(), 'Expiry must be in the future');
    const token = `swk_${randomBytes(32).toString('hex')}`; const id = randomUUID();
    await db.transaction(async tx => {
      if (input.action === 'rotate') { const old = await one(tx, 'UPDATE sw_link_keys SET revoked_at=now() WHERE id=$1::uuid AND revoked_at IS NULL RETURNING id', [z.string().uuid().parse(input.id)]); check(old, 'Key already revoked or missing', 409); }
      await tx.query('INSERT INTO sw_link_keys(id,name,hash,scopes,expires_at) VALUES($1::uuid,$2,$3,$4::text[],$5::timestamptz)', [id, name, digest(token), scopes, expires]);
      await audit(tx, actor, input.action, { id, name, scopes, expires, status: 'SUCCESS', message: `${input.action === 'rotate' ? 'Rotated' : 'Generated'} API key "${name}" (${scopes.join(', ')})` });
    }); return { id, key: token };
  }
  if (input.action === 'revoke') {
    await db.query('UPDATE sw_link_keys SET revoked_at=now() WHERE id=$1::uuid', [z.string().uuid().parse(input.id)]);
    await audit(db, actor, 'revoke', { id: input.id, status: 'INFO', message: 'Revoked API key' });
    return { saved: true };
  }
  if (input.action === 'configure') {
    const url = await validateURL(z.string().max(2000).parse(input.url)); const paused = z.boolean().parse(input.paused);
    const secret = input.key ? encrypt(z.string().regex(/^swk_[a-f0-9]{64}$/).parse(input.key)) : undefined;
    await db.transaction(async tx => {
      const s = (await one(tx, 'SELECT data FROM sw_link_state WHERE id=1 FOR UPDATE')).data;
      check(!s.url || s.url === url, 'Changing the source app requires a separate migration to preserve catalog identities');
      await tx.query('UPDATE sw_link_state SET data=$1::jsonb WHERE id=1', [json({ ...s, url, paused, ...(secret ? { secret } : {}) })]);
      await audit(tx, actor, 'configure', { url, paused, credentialUpdated: !!secret, status: 'SUCCESS', message: `Updated outgoing connection: ${url} (paused: ${paused})` });
    }); return { saved: true };
  }
  if (input.action === 'clearHistory') {
    try { await db.query('DELETE FROM sw_link_history'); } catch {}
    return { saved: true, message: 'History cleared' };
  }
  enabled();
  if (input.action === 'test') {
    const s = await state(db);
    const start = Date.now();
    try {
      const r = await remote(s, 'health');
      check(r.app === (hooks.app === 'workflow' ? 'pricelist' : 'workflow') && r.protocol === 1, 'Connected URL is not the expected app');
      const required = scopesFor(hooks.app === 'workflow' ? 'pricelist' : 'workflow');
      check(required.every(scope => r.scopes?.includes(scope)), 'Authentication succeeded, but the remote key lacks required permissions. Generate or rotate a key with all integration scopes.', 403);
      const latency = Date.now() - start;
      await logHistory(db, 'TEST_PING', 'SUCCESS', `Connection verified in ${latency}ms to ${s.url}`, { latency, remoteApp: r.app, url: s.url }, latency);
      return { message: `Authentication and permissions verified (${latency}ms). Run Sync now to verify data synchronization.`, latency, authentication: true, permissions: true, synchronization: "NOT_TESTED", workflowEnabled: r.workflowEnabled };
    } catch (err: any) {
      const latency = Date.now() - start;
      await logHistory(db, 'TEST_PING', 'FAILED', `Connection test failed: ${err.message}`, { latency, url: s.url, error: err.message }, latency);
      throw err;
    }
  }
  if (input.action === 'sync') { await sync(db, hooks, true); return { message: 'Synchronization completed' }; }
  throw new ConnectionError('Unknown connection action');
}
export async function remote(s: any, path: string, body?: unknown) {
  check(s.url && s.secret, 'Configure the remote URL and API key', 503);
  const base = await validateURL(s.url);
  const url = new URL(`${base}/${path}`);
  const addresses = await lookup(url.hostname, { all: true });
  check(addresses.length && addresses.every(a => isPublicAddress(a.address)), 'Connection URL must resolve to a public server');
  // Pin the validated DNS answer to this request; redirects are never followed.
  return new Promise<any>((resolve, reject) => {
    const req = httpsRequest(url, { method: body ? 'POST' : 'GET', agent: false, lookup: ((_host: string, options: any, cb: any) => options.all ? cb(null, addresses) : cb(null, addresses[0].address, addresses[0].family)) as any, headers: { Authorization: `Bearer ${decrypt(s.secret)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(25000) }, res => {
      const failed = !res.statusCode || res.statusCode < 200 || res.statusCode >= 300;
      let size = 0; const chunks: Buffer[] = [];
      res.on('data', (b: Buffer) => { size += b.length; if (size > 10_000_000) { res.destroy(); reject(new ConnectionError('Remote response too large', 502)); } else chunks.push(b); });
      res.on('error', reject); res.on('end', () => { try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (failed) { const detail = typeof data.error === 'string' ? data.error.slice(0, 500).replace(/swk_[a-zA-Z0-9_-]+/g, '[redacted]') : 'Check pairing and permissions'; reject(new ConnectionError(`Remote HTTP ${res.statusCode}: ${detail}`, 502)); return; }
        resolve(data);
      } catch { reject(new ConnectionError('Invalid remote response', 502)); } });
    }); req.on('error', reject); req.end(body ? json(body) : undefined);
  });
}
// A durable projection detects updates, deletes and reusable conversions even when
// they originated in older import/delete paths. No price fields enter the feed.
export async function refreshCatalog(db: ConnectionDB, hooks: Hooks) {
  if (!hooks.catalog) return;
  await db.transaction(async tx => {
    await tx.query('SELECT id FROM sw_link_state WHERE id=1 FOR UPDATE');
    const all = (await hooks.catalog!(tx)).map(v => catalogItem.parse(v));
    const old = (await tx.query('SELECT identity,data FROM sw_link_catalog')).rows;
    const previous = new Map(old.map(v => [v.identity, v.data]));
    const seen = new Set<string>();
    for (const item of all) { const identity = `${item.type}:${item.id}`; seen.add(identity); if (json(previous.get(identity)) !== json(item)) await tx.query("INSERT INTO sw_link_catalog(identity,data,seq) VALUES($1,$2::jsonb,nextval('sw_link_sequence')) ON CONFLICT(identity) DO UPDATE SET data=excluded.data,seq=excluded.seq", [identity, json(item)]); }
    for (const row of old) if (!seen.has(row.identity) && !row.data.deleted) await tx.query("UPDATE sw_link_catalog SET data=$2::jsonb,seq=nextval('sw_link_sequence') WHERE identity=$1", [row.identity, json({ ...row.data, active: false, deleted: true })]);
  });
}
const proposalInput = z.object({ id: z.string().uuid(), revision: z.number().int().positive(), item: catalogItem, note: str.default('') }).strict();
export async function submitProposal(db: ConnectionDB, input: unknown) {
  const p = proposalInput.parse(input);
  return db.transaction(async tx => {
    await tx.query('SELECT id FROM sw_link_state WHERE id=1 FOR UPDATE');
    const old = await one(tx, 'SELECT * FROM sw_link_proposals WHERE id=$1::uuid FOR UPDATE', [p.id]);
    if (old) {
      if (p.revision === old.revision) { check(digest(json(p)) === old.hash, 'Proposal ID/revision has different content', 409); return { id: p.id, status: old.status }; }
      check(p.revision === old.revision + 1 && ['REJECTED', 'CHANGES_REQUESTED'].includes(old.status), 'Refresh proposal before resubmitting', 409);
      await audit(tx, 'workflow', 'proposal-revised', { before: old, after: p });
    }
    await tx.query("INSERT INTO sw_link_proposals(id,revision,hash,data,status) VALUES($1::uuid,$2,$3,$4::jsonb,'PENDING_REVIEW') ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,hash=excluded.hash,data=excluded.data,status=excluded.status,result='{}'::jsonb,updated_at=now()", [p.id, p.revision, digest(json(p)), json(p)]);
    return { id: p.id, status: 'PENDING_REVIEW' };
  });
}
export async function reviewProposal(db: ConnectionDB, hooks: Hooks, actor: any, input: any) {
  check(hooks.approve, 'Review is only available in the price-list app');
  const id = z.string().uuid().parse(input.id); const decision = z.enum(['APPROVED', 'LINKED', 'CHANGES_REQUESTED', 'REJECTED']).parse(input.decision);
  const reason = str.min(1).parse(input.reason);
  return db.transaction(async tx => {
    await tx.query('SELECT id FROM sw_link_state WHERE id=1 FOR UPDATE');
    const p = await one(tx, 'SELECT * FROM sw_link_proposals WHERE id=$1::uuid FOR UPDATE', [id]);
    check(p && p.revision === input.revision && p.status === 'PENDING_REVIEW', 'Proposal changed; refresh before reviewing', 409);
    let target: any = {};
    if (['APPROVED', 'LINKED'].includes(decision)) target = await hooks.approve!(tx, actor, input);
    const result = { ...target, reason, reviewedBy: actor.id, reviewedAt: new Date().toISOString() };
    await tx.query('UPDATE sw_link_proposals SET status=$2,result=$3::jsonb,updated_at=now() WHERE id=$1::uuid', [id, decision, json(result)]);
    await audit(tx, actor.id, 'review', { id, revision: p.revision, decision, result });
    await tx.query("UPDATE sw_link_state SET data=data || jsonb_build_object('notifyPending',true,'notificationVersion',coalesce((data->>'notificationVersion')::int,0)+1) WHERE id=1");
    return { saved: true };
  });
}
export async function protocol(db: ConnectionDB, hooks: Hooks, req: Request, path: string) {
  const scope = hooks.app === 'pricelist' ? path === 'proposals' && req.method === 'POST' ? 'proposals:write' : path === 'proposals' ? 'proposals:read' : 'catalog:read' : 'notifications:write';
  const keyId = await authenticate(db, req, scope);
  await logHistory(db, 'INCOMING_REQ', 'SUCCESS', `Incoming ${req.method} /${path}`, { path, method: req.method, keyId });
  if (path === 'health' && req.method === 'GET') return { app: hooks.app, protocol: 1, workflowEnabled: process.env.WORKFLOW_INTEGRATION_ENABLED === 'true', scopes: (await one(db, 'SELECT scopes FROM sw_link_keys WHERE id=$1::uuid', [keyId])).scopes };
  if (hooks.app === 'pricelist' && path === 'catalog' && req.method === 'GET') {
    await refreshCatalog(db, hooks);
    const after = new URL(req.url).searchParams.get('after') || '0'; check(/^\d{1,19}$/.test(after), 'Invalid cursor');
    const rows = (await db.query('SELECT identity,data,seq::text FROM sw_link_catalog WHERE seq>$1::bigint ORDER BY sw_link_catalog.seq LIMIT 200', [after])).rows;
    return { rows, cursor: rows.at(-1)?.seq || after, more: rows.length === 200 };
  }
  if (hooks.app === 'pricelist' && path === 'proposals') {
    if (req.method === 'POST') return submitProposal(db, await readBody(req));
    if (req.method === 'GET') { const id = z.string().uuid().parse(new URL(req.url).searchParams.get('id')); const row = await one(db, 'SELECT id,revision,status,result FROM sw_link_proposals WHERE id=$1::uuid', [id]); check(row, 'Proposal not found', 404); return row; }
  }
  if (hooks.app === 'workflow' && path === 'notifications' && req.method === 'POST') {
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(await readBody(req));
    await db.transaction(async tx => { const added = await tx.query('INSERT INTO sw_link_events(id) VALUES($1::uuid) ON CONFLICT DO NOTHING RETURNING id', [id]); if (added.rows.length) await tx.query("UPDATE sw_link_state SET data=data || '{\"refreshRequested\":true}'::jsonb WHERE id=1"); });
    return { received: true };
  }
  throw new ConnectionError('Unknown integration endpoint', 404);
}
export async function readBody(req: Request) {
  const reader = req.body?.getReader(); check(reader, 'Missing body'); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > 250000) { await reader.cancel(); throw new ConnectionError('Payload too large', 413); } chunks.push(r.value); } } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ConnectionError('Invalid JSON'); }
}
export async function sync(db: ConnectionDB, hooks: Hooks, manual = false, transport = remote) {
  enabled();
  const startTime = Date.now();
  const token = randomUUID();
  const locked = await one(db, "UPDATE sw_link_state SET lease=$1,lease_until=now()+interval '10 minutes' WHERE id=1 AND (lease_until IS NULL OR lease_until<now()) RETURNING data", [token]);
  if (!locked) { if (manual) throw new ConnectionError('Synchronization already running', 409); return; }
  let s = locked.data;
  const deadline = Date.now() + 240000;
  try {
    if (s.paused || !s.url || !s.secret) { if (manual) throw new ConnectionError('Save an active connection first'); return; }
    if (!manual && !s.refreshRequested && Date.parse(s.nextAttempt || '') > Date.now()) return;
    if (hooks.app === 'pricelist') {
      await refreshCatalog(db, hooks);
      const seq = (await one(db, 'SELECT coalesce(max(seq),0)::text seq FROM sw_link_catalog')).seq;
      if (s.notifiedSeq !== seq || s.notifyPending) {
        const eventId = s.eventId || randomUUID(); await db.query("UPDATE sw_link_state SET data=data || $1::jsonb WHERE id=1", [json({ eventId })]);
        await transport(s, 'notifications', { id: eventId });
        await db.query("UPDATE sw_link_state SET data=data || $1::jsonb || jsonb_build_object('notifyPending',coalesce((data->>'notificationVersion')::int,0)<>$2) WHERE id=1", [json({ notifiedSeq: seq, eventId: null }), s.notificationVersion || 0]);
      }
    } else {
      // Each page is a resumable transaction. Bound each run; the next run resumes.
      const pullCatalog = async () => {
      for (let page = 0; page < 25; page++) {
        if (Date.now() > deadline) break;
        const result = await transport(s, `catalog?after=${encodeURIComponent(s.cursor || '0')}`);
        const schema = z.object({ rows: z.array(z.object({ identity: z.string(), seq: z.string().regex(/^\d{1,19}$/), data: catalogItem })).max(200), cursor: z.string().regex(/^\d{1,19}$/), more: z.boolean() });
        const data = schema.parse(result);
        check(BigInt(data.cursor) >= BigInt(s.cursor || '0'), 'Remote cursor moved backwards', 502);
        check(!data.more || BigInt(data.cursor) > BigInt(s.cursor || '0'), 'Remote pagination made no progress', 502);
        check(data.cursor === (data.rows.at(-1)?.seq || s.cursor || '0'), 'Remote cursor does not match the committed page', 502);
        let previousSeq = BigInt(s.cursor || '0');
        for (const row of data.rows) { check(BigInt(row.seq) > previousSeq && BigInt(row.seq) <= BigInt(data.cursor), 'Remote catalog sequence is invalid', 502); previousSeq = BigInt(row.seq); }
        await db.transaction(async tx => {
          for (const r of data.rows) { check(r.identity === `${r.data.type}:${r.data.id}`, 'Invalid catalog identity', 502); await tx.query('INSERT INTO sw_link_catalog(identity,data,seq) VALUES($1,$2::jsonb,$3::bigint) ON CONFLICT(identity) DO UPDATE SET data=excluded.data,seq=excluded.seq WHERE sw_link_catalog.seq<=excluded.seq', [r.identity, json(r.data), r.seq]); }
          await tx.query('UPDATE sw_link_state SET data=data || $1::jsonb WHERE id=1', [json({ cursor: data.cursor, refreshRequested: false })]);
        });
        s = { ...s, cursor: data.cursor }; if (!data.more) break;
      }
      };
      await pullCatalog();
      let reviewed = false;
      const proposals = (await db.query("SELECT * FROM sw_link_proposals WHERE status IN ('PENDING_SYNC','PENDING_REVIEW') ORDER BY updated_at LIMIT 100")).rows;
      for (const p of proposals) {
        if (Date.now() > deadline) break;
        if (p.status === 'PENDING_SYNC') await transport(s, 'proposals', p.data);
        const r = await transport(s, `proposals?id=${p.id}`);
        check(r.id === p.id && r.revision === p.revision && ['PENDING_REVIEW', 'APPROVED', 'LINKED', 'CHANGES_REQUESTED', 'REJECTED'].includes(r.status), 'Invalid proposal status', 502);
        const result = z.object({ id: z.string().optional(), type: z.enum(['PRODUCT','REUSABLE']).optional(), code: str.optional(), unit: str.optional(), reason: str.optional(), reviewedBy: z.string().optional(), reviewedAt: z.string().optional() }).strict().parse(r.result || {});
        await db.query('UPDATE sw_link_proposals SET status=$2,result=$3::jsonb,updated_at=now() WHERE id=$1::uuid AND revision=$4', [p.id, r.status, json(result), p.revision]);
        if (result.id) reviewed = true;
      }
      if (reviewed) await pullCatalog();
    }
    await hooks.afterSync?.();
    const duration = Date.now() - startTime;
    await logHistory(db, 'SYNC_RUN', 'SUCCESS', hooks.app === 'workflow' ? `Sync completed in ${duration}ms (cursor: ${s.cursor || '0'})` : `Sync notification delivered in ${duration}ms`, { duration, cursor: s.cursor, app: hooks.app }, duration);
    await db.query('UPDATE sw_link_state SET data=data || $1::jsonb WHERE id=1', [json({ lastSuccess: new Date().toISOString(), lastError: null, attempts: 0, nextAttempt: new Date(Date.now() + 300000).toISOString() })]);
  } catch (e) {
    const duration = Date.now() - startTime;
    const attempts = (s.attempts || 0) + 1;
    const message = e instanceof ConnectionError ? e.message : 'Connection failed; check URL, key, encryption configuration and remote availability';
    await logHistory(db, 'SYNC_RUN', 'FAILED', `Sync failed: ${message}`, { duration, error: message, attempts }, duration);
    await db.query('UPDATE sw_link_state SET data=data || $1::jsonb WHERE id=1', [json({ lastError: message, attempts, nextAttempt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7))).toISOString() })]);
    if (manual) throw new ConnectionError(message, 502);
  } finally { await db.query('UPDATE sw_link_state SET lease=NULL,lease_until=NULL WHERE id=1 AND lease=$1', [token]); }
}
