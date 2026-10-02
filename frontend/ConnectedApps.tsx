'use client';

import React, { useCallback, useEffect, useState, useRef } from 'react';

type Row = Record<string, any>;
export type ConnectionCall = (body?: Row) => Promise<Row>;

export async function workflowConnectionCall(body?: Row) {
  const r = await fetch('/api/sales-workflow/connections', {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || result.message || 'Connection unavailable');
  return result;
}

const defaultData: Row = {
  app: 'pricelist',
  enabled: undefined,
  encryptionReady: undefined,
  url: '',
  paused: true,
  credentialConfigured: false,
  keys: [],
  history: [],
  importedCount: 0,
  scopes: ['catalog:read', 'proposals:write', 'proposals:read', 'jobs:results', 'users:read'],
};

export default function ConnectedApps({ call = workflowConnectionCall }: { call?: ConnectionCall }) {
  const [data, setData] = useState<Row>(defaultData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const [showKeyPassword, setShowKeyPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'history' | 'guide'>('config');
  const [replacement, setReplacement] = useState<Row | null>(null);
  const replacementDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (replacement) replacementDialog.current?.showModal(); else replacementDialog.current?.close(); }, [replacement?.id]);
  const [historyFilter, setHistoryFilter] = useState<string>('ALL');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call();
      if (!res || !Array.isArray(res.keys)) throw new Error("Invalid integration settings response");
      if (res && typeof res === 'object') {
        setData(prev => ({ ...prev, ...res }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  const action = async (body: Row) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await call(body);
      if (r.key) {
        setKey(r.key);
      }
      setMessage(r.message || 'Saved successfully');
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const copyToClipboard = async (text: string, isKey = false) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isKey) {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
      } else {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      }
    } catch {
      setMessage('Clipboard unavailable. Select the key text and copy it manually.');
    }
  };

  const defaultSelfUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/amt_price_list/api/v1/integration/v1`
    : 'https://softwaresolver.online/amt_price_list/api/v1/integration/v1';

  const activeData: Row = {
    ...defaultData,
    ...(data || {}),
    keys: Array.isArray(data?.keys) ? data.keys : [],
    history: Array.isArray(data?.history) ? data.history : [],
    scopes: Array.isArray(data?.scopes) && data.scopes.length > 0 ? data.scopes : defaultData.scopes,
  };

  const ingressUrl = activeData.selfUrl || defaultSelfUrl;

  const filteredHistory = (activeData.history || []).filter((h: Row) => {
    if (historyFilter === 'ALL') return true;
    if (historyFilter === 'SYNC') return (h.type || '').includes('SYNC');
    if (historyFilter === 'TEST') return (h.type || '').includes('TEST');
    if (historyFilter === 'REQ') return (h.type || '').includes('REQ') || (h.type || '').includes('INCOMING');
    if (historyFilter === 'KEY') return (h.type || '').includes('KEY');
    return true;
  });

  return (
    <div className="conn-container">
      <dialog ref={replacementDialog} onCancel={e => { if (busy) e.preventDefault(); else setReplacement(null); }} aria-labelledby="replacement-key-title" style={{ width: 'min(92vw, 620px)', maxHeight: '90dvh', overflow: 'auto', padding: 24, borderRadius: 14, border: '1px solid var(--border, #cbd5e1)', background: 'var(--card, #fff)', color: 'var(--text, #0f172a)' }}>
        {replacement && <form onSubmit={async e => { e.preventDefault(); const ok = await action({ action: replacement.mode, ...(replacement.mode === 'rotate' ? { id: replacement.id } : {}), name: `${replacement.name} replacement`, scopes: replacement.selectedScopes, expires: new Date(`${replacement.expiry}T23:59:59Z`).toISOString() }); if (ok) setReplacement(null); }}>
          <h3 id="replacement-key-title" style={{ marginTop: 0 }}>Replace / upgrade API key</h3>
          <p style={{ fontSize: 13 }}>Choose permissions explicitly. ERP user mapping needs <code>users:read</code>. Saved keys cannot gain permissions automatically.</p>
          <fieldset style={{ margin: '16px 0', padding: 12 }}><legend>Permissions</legend>{activeData.scopes.map((scope: string) => <label key={scope} style={{ display: 'flex', gap: 8, margin: '10px 0' }}><input type="checkbox" checked={replacement.selectedScopes.includes(scope)} disabled={busy} onChange={e => setReplacement({ ...replacement, selectedScopes: e.target.checked ? [...replacement.selectedScopes,scope] : replacement.selectedScopes.filter((s: string) => s !== scope) })} /><span>{scope}{scope === 'users:read' && ' — load users for ERP mapping'}</span></label>)}<button type="button" disabled={busy} onClick={() => setReplacement({ ...replacement, selectedScopes: [...activeData.scopes] })}>Select required integration permissions</button></fieldset>
          <label style={{ display: 'block', marginBottom: 16 }}>Expires <input type="date" required min={new Date().toISOString().slice(0,10)} value={replacement.expiry} disabled={busy} onChange={e => setReplacement({ ...replacement, expiry: e.target.value })} /></label>
          <label style={{ display: 'block', marginBottom: 10 }}><input type="radio" name="replacement-mode" checked={replacement.mode === 'generate'} disabled={busy} onChange={() => setReplacement({ ...replacement, mode: 'generate' })} /> Generate replacement; keep old key active until verified (recommended)</label>
          <label style={{ display: 'block', marginBottom: 16 }}><input type="radio" name="replacement-mode" checked={replacement.mode === 'rotate'} disabled={busy} onChange={() => setReplacement({ ...replacement, mode: 'rotate' })} /> Rotate now; immediately revoke old key</label>
          <p style={{ fontSize: 13 }}>Copy the new key into ERP Outgoing Connection, test user loading, then revoke the previous key if still active.</p>
          {error && <p role="alert" style={{ color: 'var(--red, #b91c1c)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}><button type="button" disabled={busy} onClick={() => setReplacement(null)}>Cancel</button><button type="submit" disabled={busy || !replacement.selectedScopes.length}>{busy ? 'Generating…' : replacement.mode === 'rotate' ? 'Rotate and revoke old key' : 'Generate replacement key'}</button></div>
        </form>}
      </dialog>

      {/* Header */}
      <div className="conn-header">
        <div className="conn-header-left">
          <h2>Connected Apps (Price List ↔ Sales ERP)</h2>
          <span className="conn-badge red">v1 Protocol</span>
        </div>
        <div>
          <button type="button" onClick={load} disabled={busy || loading} className="button">
            ↻ Refresh
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 14px 0' }}>
        Bidirectional integration to exchange catalog details and review decisions with Sales Workflow.
      </p>

      {/* Global Alerts */}
      {error && (
        <div role="alert" className="conn-badge red" style={{ display: 'block', padding: '10px 14px', marginBottom: 12, fontSize: 12 }}>
          <strong>Error: </strong>{error}
        </div>
      )}
      {message && (
        <div role="status" className="conn-badge green" style={{ display: 'block', padding: '10px 14px', marginBottom: 12, fontSize: 12 }}>
          <strong>Success: </strong>{message}
        </div>
      )}

      {loading && (
        <div style={{ background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#1565c0' }}>
          ↻ Refreshing connection status from server…
        </div>
      )}

      {/* Health Stats Grid */}
      <div className="conn-stat-grid">
        <div className="conn-stat-box">
          <span className="conn-stat-label">Server Switch</span>
          <span className="conn-stat-value">
            <span className={`conn-dot ${activeData.enabled ? 'green' : 'red'}`} />
            {activeData.enabled ? 'Active' : 'Disabled'}
          </span>
        </div>

        <div className="conn-stat-box">
          <span className="conn-stat-label">Encryption Engine</span>
          <span className="conn-stat-value">
            <span className={`conn-dot ${activeData.encryptionReady ? 'green' : 'red'}`} />
            {activeData.encryptionReady === undefined ? 'Not verified' : activeData.encryptionReady ? 'AES-256 Ready' : 'Setup Needed'}
          </span>
        </div>

        <div className="conn-stat-box">
          <span className="conn-stat-label">Published Catalog Items</span>
          <span className="conn-stat-value">
            <strong style={{ color: 'var(--red)', fontSize: 16 }}>{activeData.importedCount || 0}</strong>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>records</span>
          </span>
        </div>

        <div className="conn-stat-box">
          <span className="conn-stat-label">Last Sync Status</span>
          <span className="conn-stat-value" style={{ fontSize: 12 }}>
            <span className={`conn-dot ${activeData.lastSuccess ? 'green' : 'gray'}`} />
            {activeData.lastSuccess ? new Date(activeData.lastSuccess).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
          </span>
        </div>
      </div>

      {/* Proposal Counts if any */}
      {activeData.counts && activeData.counts.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {activeData.counts.map((r: Row) => (
            <span key={r.status} className="conn-badge gray">
              {r.status}: <strong style={{ color: 'var(--red)' }}>{r.count}</strong>
            </span>
          ))}
        </div>
      )}

      {activeData.lastError && (
        <div role="alert" className="conn-badge red" style={{ display: 'block', padding: '10px 14px', marginBottom: 14, fontSize: 12 }}>
          <strong>Sync Issue: </strong>{activeData.lastError}
          {activeData.nextAttempt && <span style={{ marginLeft: 8 }}>(Next retry: {new Date(activeData.nextAttempt).toLocaleTimeString()})</span>}
        </div>
      )}

          {/* Key Banner (when newly generated) */}
          {key && (
            <div role="status" className="conn-key-banner">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ color: 'var(--green)', fontSize: 13 }}>
                  ✓ New API Key Generated Successfully
                </strong>
                <button type="button" onClick={() => setKey('')} style={{ fontSize: 11, padding: '3px 8px' }}>
                  Hide key
                </button>
              </div>
              <p style={{ margin: '4px 0 8px 0', fontSize: 11, color: '#2e7d32' }}>
                Copy this key now. It is stored as a SHA-256 hash and cannot be displayed again.
              </p>
              <textarea aria-label="New API key" readOnly value={key} onFocus={e => e.currentTarget.select()} style={{ color: "#111827", background: "#ffffff", minHeight: 72, width: "100%", fontFamily: "monospace" }} rows={3} />
              <div className="conn-actions">
                <button type="button" className="primary" onClick={() => copyToClipboard(key, true)}>
                  {copiedKey ? '✓ Copied to clipboard!' : 'Copy API key'}
                </button>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="conn-tabs">
            <button
              type="button"
              className={`conn-tab-btn ${activeTab === 'config' ? 'active' : ''}`}
              onClick={() => setActiveTab('config')}
            >
              Pairing & API Keys
            </button>
            <button
              type="button"
              className={`conn-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              Connection & Request History ({activeData.history?.length || 0})
            </button>
            <button
              type="button"
              className={`conn-tab-btn ${activeTab === 'guide' ? 'active' : ''}`}
              onClick={() => setActiveTab('guide')}
            >
              Vice-Versa Setup Guide
            </button>
          </div>

          {/* TAB 1: CONFIGURATION */}
          {activeTab === 'config' && (
            <div>
              {/* App Ingress Endpoint Card */}
              <div className="conn-card" style={{ background: '#fafafa', borderStyle: 'dashed' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>This App’s Integration Ingress URL</h3>
                    <p style={{ margin: '2px 0 0 0', fontSize: 11 }}>
                      Paste this URL into Panel ERP’s Outgoing Connection setting:
                    </p>
                  </div>
                  <button type="button" onClick={() => copyToClipboard(ingressUrl)} style={{ fontSize: 11 }}>
                    {copiedUrl ? '✓ Copied URL' : 'Copy Ingress URL'}
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <code style={{ fontSize: 12, background: '#fff', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--line)', display: 'block', wordBreak: 'break-all' }}>
                    {ingressUrl}
                  </code>
                </div>
              </div>

              {/* Outgoing Connection Form */}
              <div className="conn-card">
                <h3>Outgoing Connection (Link to Panel ERP)</h3>
                <p>Configure the URL and API key of the Sales Workflow app to receive notifications and sync proposals.</p>

                <form
                  key={activeData.url || 'new'}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const v = new FormData(form);
                    await action({
                      action: 'configure',
                      url: v.get('url'),
                      key: v.get('key'),
                      paused: v.get('paused') === 'on',
                    });
                    const keyInput = form.elements.namedItem('key') as HTMLInputElement | null;
                    if (keyInput) keyInput.value = '';
                  }}
                >
                  <div className="conn-form-grid">
                    <label>
                      <span>Panel ERP Integration API URL</span>
                      <input
                        name="url"
                        type="url"
                        required
                        defaultValue={activeData.url || ''}
                        placeholder="https://softwaresolver.online/api/sales-workflow/integration/v1"
                      /><small>Copy the Integration Ingress URL from ERP Connected Apps. A login or dashboard URL cannot load branch staff.</small>
                    </label>

                    <label>
                      <span>API Key generated in Panel ERP</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          name="key"
                          type={showKeyPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          placeholder={activeData.credentialConfigured ? '•••••••• (Saved securely)' : 'Paste API key from ERP'}
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowKeyPassword(!showKeyPassword)}
                          style={{ padding: '0 10px', fontSize: 11 }}
                          title="Toggle reveal"
                        >
                          {showKeyPassword ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </label>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <label className="check" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                      <input name="paused" type="checkbox" defaultChecked={activeData.paused} />
                      <span>Pause synchronization temporarily</span>
                    </label>
                  </div>

                  <div className="conn-actions">
                    <button type="submit" disabled={busy || loading} className="primary">
                      Save connection
                    </button>
                    <button type="button" disabled={busy || loading} onClick={() => action({ action: 'test' })}>
                      Test connection
                    </button>
                    <button type="button" disabled={busy || loading} onClick={() => action({ action: 'sync' })}>
                      Sync now / retry
                    </button>
                  </div>
                </form>
              </div>

              {/* Incoming API Keys Form */}
              <div className="conn-card">
                <h3>Incoming API Keys</h3>
                <p>Generate keys for Panel ERP to authenticate when accessing Price List endpoints.</p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void action({
                      action: 'generate',
                      name: f.get('name'),
                      expires: new Date(String(f.get('expires'))).toISOString(),
                      scopes: f.getAll('scope'),
                    });
                  }}
                >
                  <div className="conn-form-grid">
                    <label>
                      <span>Key Name / Client Description</span>
                      <input name="name" required maxLength={100} placeholder="e.g. Panel ERP Sync" />
                    </label>

                    <label>
                      <span>Expiration Date</span>
                      <input
                        name="expires"
                        type="datetime-local"
                        required
                        defaultValue={new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 16)}
                      />
                    </label>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                      Permissions / Scopes:
                    </span>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {activeData.scopes.map((scope: string) => (
                        <label key={scope} className="check" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <input type="checkbox" name="scope" value={scope} defaultChecked />
                          <code>{scope}</code>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="conn-actions">
                    <button type="submit" disabled={busy || loading} className="primary">
                      Generate key
                    </button>
                  </div>
                </form>

                {/* Active Keys Table */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <h4 style={{ fontSize: 12, fontWeight: 700, margin: 0, textTransform: 'uppercase', color: 'var(--muted)' }}>
                      Active Keys ({activeData.keys.length})
                    </h4>
                  </div>
                  <p style={{ margin: '0 0 8px 0', fontSize: 11, color: 'var(--muted)' }}>
                    🔒 <strong>Security note:</strong> Keys are stored as SHA-256 hashes at rest and raw tokens cannot be retrieved again. Copy newly generated keys from the green banner above when created.
                  </p>

                  {activeData.keys.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 6, fontSize: 12, color: 'var(--muted)' }}>
                      No active API keys generated yet. Use the form above to generate an API key for Panel ERP.
                    </div>
                  ) : (
                    <div className="table-scroll">
                      <table className="conn-table">
                        <thead>
                          <tr>
                            <th>Key Name</th>
                            <th>Scopes</th>
                            <th>Expires</th>
                            <th>Last Used</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeData.keys.map((k: Row) => (
                            <tr key={k.id}>
                              <td>
                                <strong>{k.name}</strong>
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {k.scopes.map((s: string) => (
                                    <span key={s} className="conn-badge gray" style={{ fontSize: 10 }}>
                                      {s}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td style={{ fontSize: 11 }}>{new Date(k.expires_at).toLocaleDateString()}</td>
                              <td style={{ fontSize: 11 }}>
                                {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
                              </td>
                              <td>
                                {k.revoked_at ? (
                                  <span className="conn-badge red" style={{ fontSize: 10 }}>Revoked</span>
                                ) : (
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                      type="button"
                                      disabled={busy || loading}
                                      onClick={() => action({ action: 'revoke', id: k.id })}
                                      style={{ padding: '3px 8px', fontSize: 11, color: 'var(--red)' }}
                                    >
                                      Revoke
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy || loading}
                                      onClick={() => setReplacement({ ...k, selectedScopes: [...k.scopes], mode: 'generate', expiry: new Date(Date.now() + 90 * 86400000).toISOString().slice(0,10) })}
                                      style={{ padding: '3px 8px', fontSize: 11 }}
                                    >
                                      Replace / upgrade key
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AUDIT & REQUEST HISTORY */}
          {activeTab === 'history' && (
            <div className="conn-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <div className="conn-chips">
                  {[
                    ['ALL', 'All Events'],
                    ['SYNC', 'Sync Runs'],
                    ['TEST', 'Pings / Tests'],
                    ['REQ', 'Incoming Requests'],
                    ['KEY', 'Key Changes'],
                  ].map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={`conn-chip ${historyFilter === val ? 'active' : ''}`}
                      onClick={() => setHistoryFilter(val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={busy || loading}
                  onClick={() => action({ action: 'clearHistory' })}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  Clear history
                </button>
              </div>

              {filteredHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--muted)' }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>No events logged yet for this filter</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: 11 }}>Run a "Test connection" or "Sync now" to see live activity here.</p>
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="conn-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Latency</th>
                        <th>Message / Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map((h: Row) => {
                        const isSuccess = h.status === 'SUCCESS' || h.status === 'COMPLETED';
                        const isFailed = h.status === 'FAILED' || h.status === 'ERROR';
                        return (
                          <tr key={h.id}>
                            <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                              {new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </td>
                            <td>
                              <span className="conn-badge gray" style={{ fontSize: 10 }}>{h.type}</span>
                            </td>
                            <td>
                              <span className={`conn-badge ${isSuccess ? 'green' : isFailed ? 'red' : 'gray'}`} style={{ fontSize: 10 }}>
                                {h.status}
                              </span>
                            </td>
                            <td style={{ fontSize: 11, fontFamily: 'monospace' }}>
                              {h.durationMs ? `${h.durationMs}ms` : '—'}
                            </td>
                            <td>
                              <span style={{ fontWeight: 600 }}>{h.message || '—'}</span>
                              {h.details && Object.keys(h.details).length > 0 && (
                                <details style={{ marginTop: 4 }}>
                                  <summary style={{ fontSize: 10, color: 'var(--muted)', cursor: 'pointer' }}>View payload details</summary>
                                  <pre style={{ margin: '4px 0 0 0', fontSize: 10 }}>{JSON.stringify(h.details, null, 2)}</pre>
                                </details>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SETUP GUIDE */}
          {activeTab === 'guide' && (
            <div className="conn-card">
              <h3>Bidirectional 2-Way Pairing Architecture</h3>
              <p>How Price List and Panel ERP communicate with each other securely:</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, margin: '14px 0' }}>
                <div style={{ padding: 12, background: '#f8f8fa', border: '1px solid var(--line)', borderRadius: 6 }}>
                  <strong style={{ color: 'var(--red)', display: 'block', marginBottom: 4 }}>
                    Direction 1: Panel ERP → Price List
                  </strong>
                  <p style={{ margin: 0, fontSize: 11 }}>
                    Panel ERP pulls catalog records and submits new product proposals for pricing review.
                  </p>
                  <p style={{ margin: '6px 0 0 0', fontSize: 10, fontFamily: 'monospace', color: 'var(--muted)' }}>
                    Scopes: catalog:read, proposals:write, proposals:read
                  </p>
                </div>

                <div style={{ padding: 12, background: '#f8f8fa', border: '1px solid var(--line)', borderRadius: 6 }}>
                  <strong style={{ color: 'var(--green)', display: 'block', marginBottom: 4 }}>
                    Direction 2: Price List → Panel ERP
                  </strong>
                  <p style={{ margin: 0, fontSize: 11 }}>
                    Price List notifies Panel ERP when items are approved, linked, or revised by an admin.
                  </p>
                  <p style={{ margin: '6px 0 0 0', fontSize: 10, fontFamily: 'monospace', color: 'var(--muted)' }}>
                    Scopes: notifications:write
                  </p>
                </div>
              </div>

              <h4 style={{ fontSize: 13, margin: '16px 0 8px 0' }}>Quick Pairing Steps:</h4>
              <ol style={{ paddingLeft: 18, fontSize: 12, lineHeight: 1.8, margin: 0 }}>
                <li>
                  <strong>In Price List:</strong> Under Incoming API Keys, generate a key. Copy this key and Price List’s Ingress URL (<code>{ingressUrl}</code>).
                </li>
                <li>
                  <strong>In Panel ERP:</strong> Go to Connected Apps → Outgoing Connection. Paste Price List’s Ingress URL and key. Click <em>Save Connection</em> and <em>Test Connection</em>.
                </li>
                <li>
                  <strong>In Panel ERP:</strong> Under Incoming API Keys, generate a key. Copy Panel ERP’s Ingress URL and key.
                </li>
                <li>
                  <strong>In Price List:</strong> Under Outgoing Connection above, paste Panel ERP’s Ingress URL and key. Click <em>Save Connection</em> and <em>Test Connection</em>.
                </li>
              </ol>
            </div>
          )}
    </div>
  );
}
