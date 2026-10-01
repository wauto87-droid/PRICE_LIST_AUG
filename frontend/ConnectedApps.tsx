'use client';
import { useCallback, useEffect, useState } from 'react';
type Row = Record<string, any>;
export type ConnectionCall = (body?: Row) => Promise<Row>;
export async function workflowConnectionCall(body?: Row) {
  const r = await fetch('/api/sales-workflow/connections', { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const result = await r.json(); if (!r.ok) throw new Error(result.error || result.message || 'Connection unavailable'); return result;
}
const style = { padding: 12, border: '1px solid #cbd5e1', borderRadius: 8, marginBottom: 12 };
export default function ConnectedApps({ call = workflowConnectionCall }: { call?: ConnectionCall }) {
  const [data, setData] = useState<Row>(); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [key, setKey] = useState('');
  const load = useCallback(async () => { try { setData(await call()); } catch (e) { setError((e as Error).message); } }, [call]);
  useEffect(() => { void load(); }, [load]);
  const action = async (body: Row) => { setBusy(true); setError(''); setMessage(''); setKey(''); try { const r = await call(body); if (r.key) setKey(r.key); setMessage(r.message || 'Saved'); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <section style={style}><h2>Connected Apps</h2><p>Exchange product details and review decisions between Sales Workflow and Price List.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!data ? <button onClick={load}>Retry loading</button> : <>
      <p>Server switch: {data.enabled ? 'Enabled' : 'Disabled'} · Encryption: {data.encryptionReady ? 'Ready' : 'Server setup needed'}</p>
      <p>Catalog records: {data.importedCount} · Last success: {data.lastSuccess || 'Never'}</p><p>{(data.counts || []).map((r: Row) => `${r.status}: ${r.count}`).join(' · ')}</p>
      {data.lastError && <p role="alert">{data.lastError} · Next retry: {data.nextAttempt}</p>}
      <form key={data.url || 'new'} style={style} onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const v = new FormData(form); await action({ action: 'configure', url: v.get('url'), key: v.get('key'), paused: v.get('paused') === 'on' }); (form.elements.namedItem('key') as HTMLInputElement).value = ''; }}>
        <h3>Outgoing connection</h3><label>Other app’s integration API URL <input name="url" type="url" required defaultValue={data.url || ''} placeholder={data.app === 'workflow' ? 'https://host/api/v1/integration/v1' : 'https://host/api/sales-workflow/integration/v1'} style={{ width: '100%' }} /></label>
        <label>API key generated in the other app <input name="key" type="password" autoComplete="new-password" placeholder={data.credentialConfigured ? 'Saved securely; leave blank to keep' : 'Paste key'} style={{ width: '100%' }} /></label>
        <label><input name="paused" type="checkbox" defaultChecked={data.paused} /> Pause synchronization</label><br /><button disabled={busy}>Save connection</button>
      </form>
      <button disabled={busy} onClick={() => action({ action: 'test' })}>Test connection</button>{' '}<button disabled={busy} onClick={() => action({ action: 'sync' })}>Sync now / retry</button>
      <form style={style} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action({ action: 'generate', name: f.get('name'), expires: new Date(String(f.get('expires'))).toISOString(), scopes: f.getAll('scope') }); }}>
        <h3>Incoming API keys</h3><p>Generate a key here and save it in the other app’s outgoing connection.</p>
        <label>Key name <input name="name" required maxLength={100} /></label>{' '}<label>Expires <input name="expires" type="datetime-local" required /></label>
        {data.scopes.map((scope: string) => <label key={scope} style={{ display: 'block' }}><input type="checkbox" name="scope" value={scope} defaultChecked />{scope}</label>)}<button disabled={busy}>Generate key</button>
      </form>
      {key && <div role="status" style={style}><strong>Copy this key now. It will not be shown again.</strong><textarea readOnly value={key} style={{ width: '100%' }} /><button onClick={() => setKey('')}>Hide key</button></div>}
      {data.keys.map((k: Row) => <div key={k.id} style={style}><strong>{k.name}</strong><p>{k.scopes.join(', ')} · Expires {new Date(k.expires_at).toLocaleString()} · Last used {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}</p>{k.revoked_at ? 'Revoked' : <><button disabled={busy} onClick={() => action({ action: 'revoke', id: k.id })}>Revoke</button>{' '}<button disabled={busy} onClick={() => action({ action: 'rotate', id: k.id, name: k.name, scopes: k.scopes, expires: new Date(Date.now() + 90 * 86400000).toISOString() })}>Rotate (90 days; old key stops immediately)</button></>}</div>)}
    </>}
  </section>;
}
