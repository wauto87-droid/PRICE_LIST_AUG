'use client';

import React, { useCallback, useEffect, useState } from 'react';

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

export default function ConnectedApps({ call = workflowConnectionCall }: { call?: ConnectionCall }) {
  const [data, setData] = useState<Row>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const [showKeyPassword, setShowKeyPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'history' | 'guide'>('config');
  const [historyFilter, setHistoryFilter] = useState<string>('ALL');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await call());
    } catch (e) {
      setError((e as Error).message);
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
    } catch (e) {
      setError((e as Error).message);
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
      // Fallback
    }
  };

  const defaultSelfUrl = data?.selfUrl || 'https://softwaresolver.online/amt_price_list/api/v1/integration/v1';

  const historyList = (data?.history || []).filter((h: Row) => {
    if (historyFilter === 'ALL') return true;
    if (historyFilter === 'SYNC') return (h.type || '').includes('SYNC');
    if (historyFilter === 'TEST') return (h.type || '').includes('TEST');
    if (historyFilter === 'REQ') return (h.type || '').includes('REQ') || (h.type || '').includes('INCOMING');
    if (historyFilter === 'KEY') return (h.type || '').includes('KEY');
    return true;
  });

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-6 text-slate-800 dark:text-slate-100 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start gap-3">
          <div className="p-3 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl text-white shadow-md shadow-blue-500/20">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Connected Apps (Price List ↔ Sales ERP)</h2>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                v1 Protocol
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Publish price-list catalog to Panel ERP and review salesman product proposals.
            </p>
          </div>
        </div>

        {/* Global Action / Refresh */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <svg className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Global Alerts */}
      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <strong className="font-semibold">Connection Alert: </strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {message && (
        <div role="status" className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-sm flex items-center gap-3">
          <svg className="w-5 h-5 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>{message}</span>
        </div>
      )}

      {!data ? (
        <div className="py-12 text-center space-y-3">
          <div className="inline-block p-3 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
            <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <p className="text-sm text-slate-500">Loading integration configuration…</p>
          <button
            onClick={load}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Retry loading
          </button>
        </div>
      ) : (
        <>
          {/* Status Bar Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800 space-y-1">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Server Switch</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${data.enabled ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {data.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800 space-y-1">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Encryption Engine</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${data.encryptionReady ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {data.encryptionReady ? 'AES-256 Ready' : 'Setup Needed'}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800 space-y-1">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Local Catalog Items</span>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-extrabold text-blue-600 dark:text-blue-400">
                  {data.importedCount ?? 0}
                </span>
                <span className="text-xs text-slate-500">records</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800 space-y-1">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Last Sync Status</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${data.lastSuccess ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                <span className="text-xs font-semibold truncate text-slate-800 dark:text-slate-200" title={data.lastSuccess || 'Never'}>
                  {data.lastSuccess ? new Date(data.lastSuccess).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
                </span>
              </div>
            </div>
          </div>

          {/* Proposal Counts Banner if any */}
          {data.counts && data.counts.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-xs bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Proposal Queue:</span>
              {data.counts.map((r: Row) => (
                <span
                  key={r.status}
                  className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium text-slate-700 dark:text-slate-200"
                >
                  {r.status}: <strong className="text-blue-600 dark:text-blue-400">{r.count}</strong>
                </span>
              ))}
            </div>
          )}

          {data.lastError && (
            <div role="alert" className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-medium">Previous Sync Issue: {data.lastError}</p>
                {data.nextAttempt && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                    Next automatic retry: {new Date(data.nextAttempt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* New Key Generated Notice (High Prominence) */}
          {key && (
            <div role="status" className="p-5 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-blue-500/10 border-2 border-emerald-500 dark:border-emerald-600 space-y-3 shadow-lg">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2.5 text-emerald-800 dark:text-emerald-300">
                  <div className="p-1.5 bg-emerald-600 text-white rounded-lg">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-sm sm:text-base">New API Key Generated Successfully</h3>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      Copy this key now. It is stored securely as a SHA-256 hash and cannot be displayed again.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setKey('')}
                  className="text-xs font-semibold px-2.5 py-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 bg-white/70 dark:bg-slate-800 rounded-md transition"
                >
                  Hide key
                </button>
              </div>

              <div className="relative">
                <textarea
                  readOnly
                  value={key}
                  rows={2}
                  className="w-full font-mono text-xs sm:text-sm p-3 bg-white dark:bg-slate-950 border border-emerald-300 dark:border-emerald-800 rounded-xl select-all focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-emerald-200"
                />
              </div>

              <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => copyToClipboard(key, true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 transition-all"
                >
                  {copiedKey ? (
                    <>
                      <svg className="w-4 h-4 text-emerald-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied to Clipboard!
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      Copy API Key
                    </>
                  )}
                </button>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  👉 Next: Open <strong>Panel ERP (Sales Workflow)</strong> and paste this key into its Outgoing Connection.
                </span>
              </div>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('config')}
              className={`pb-2.5 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'config'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Pairing & API Keys
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`pb-2.5 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'history'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Connection & Request History
              {(data?.history || []).length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {data.history.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('guide')}
              className={`pb-2.5 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'guide'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Vice-Versa Setup Guide
            </button>
          </div>

          {/* TAB 1: CONFIGURATION & KEYS */}
          {activeTab === 'config' && (
            <div className="space-y-6">
              {/* This App's Ingress Public URL Card */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50/50 dark:from-slate-800/60 dark:to-slate-800/30 border border-blue-100 dark:border-slate-700/60 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wide">
                      Price List Ingress URL (Catalog & Proposals Endpoint)
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">Give this URL to Panel ERP</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={defaultSelfUrl}
                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg select-all"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(defaultSelfUrl, false)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1.5"
                  >
                    {copiedUrl ? 'Copied!' : 'Copy URL'}
                  </button>
                </div>
              </div>

              {/* Two Column Section: Outgoing & Incoming */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Outgoing Connection Form */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 bg-slate-50/50 dark:bg-slate-800/30">
                  <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white">
                      <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                      <h3 className="font-bold text-sm">Outgoing Connection (To Panel ERP)</h3>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Configure webhook notifications to inform Panel ERP when products are created, linked, or updated.
                    </p>
                  </div>

                  <form
                    key={data.url || 'new'}
                    onSubmit={async e => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const v = new FormData(form);
                      await action({
                        action: 'configure',
                        url: v.get('url'),
                        key: v.get('key'),
                        paused: v.get('paused') === 'on',
                      });
                      const keyInput = form.elements.namedItem('key') as HTMLInputElement;
                      if (keyInput) keyInput.value = '';
                    }}
                    className="space-y-4"
                  >
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Panel ERP Webhook API URL
                      </label>
                      <input
                        name="url"
                        type="url"
                        required
                        defaultValue={data.url || ''}
                        placeholder="https://softwaresolver.online/api/sales-workflow/integration/v1"
                        className="w-full px-3 py-2 text-xs sm:text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <span className="text-[11px] text-slate-400 block">
                        Must resolve to an HTTPS URL pointing to Panel ERP's integration endpoint.
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          API Key (Generated in Panel ERP)
                        </label>
                        {data.credentialConfigured && (
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Saved & Encrypted (AES-256)
                          </span>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          name="key"
                          type={showKeyPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          placeholder={data.credentialConfigured ? 'Key saved securely; leave blank to keep unchanged' : 'Paste swk_... token with notifications:write scope'}
                          className="w-full px-3 py-2 pr-10 text-xs sm:text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKeyPassword(!showKeyPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          {showKeyPassword ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        name="paused"
                        id="pause-sync-check"
                        type="checkbox"
                        defaultChecked={data.paused}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                      />
                      <label htmlFor="pause-sync-check" className="text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                        Pause synchronization notifications
                      </label>
                    </div>

                    <div className="pt-2 flex items-center justify-between gap-2 flex-wrap">
                      <button
                        type="submit"
                        disabled={busy}
                        className="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition disabled:opacity-50"
                      >
                        Save connection
                      </button>
                    </div>
                  </form>

                  {/* Actions & Diagnostics */}
                  <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => action({ action: 'test' })}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Test connection
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => action({ action: 'sync' })}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Sync now / retry
                    </button>
                  </div>
                </div>

                {/* Incoming API Keys Form */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 bg-slate-50/50 dark:bg-slate-800/30">
                  <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white">
                      <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                      <h3 className="font-bold text-sm">Incoming API Keys (For Panel ERP)</h3>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Generate a key here with catalog and proposal permissions and paste it into Panel ERP.
                    </p>
                  </div>

                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void action({
                        action: 'generate',
                        name: f.get('name'),
                        expires: new Date(String(f.get('expires'))).toISOString(),
                        scopes: f.getAll('scope'),
                      });
                    }}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Key Name / Label
                        </label>
                        <input
                          name="name"
                          required
                          maxLength={100}
                          placeholder="e.g. Panel ERP Connection Key"
                          className="w-full px-3 py-2 text-xs sm:text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Expires Date & Time
                        </label>
                        <input
                          name="expires"
                          type="datetime-local"
                          required
                          defaultValue={new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 16)}
                          className="w-full px-3 py-2 text-xs sm:text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                        Authorized Scopes (Catalog & Proposals)
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {data.scopes.map((scope: string) => (
                          <label
                            key={scope}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-800 dark:text-slate-200 cursor-pointer select-none"
                          >
                            <input
                              type="checkbox"
                              name="scope"
                              value={scope}
                              defaultChecked
                              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            {scope}
                          </label>
                        ))}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-50"
                    >
                      Generate key
                    </button>
                  </form>
                </div>
              </div>

              {/* Active Keys List */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Generated Keys</span>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold">
                      {data.keys.length}
                    </span>
                  </h3>
                  <span className="text-xs text-slate-400">Rotating immediately revokes previous key</span>
                </div>

                {data.keys.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-xs">
                    No API keys generated yet. Use the form above to generate an incoming key for Panel ERP.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {data.keys.map((k: Row) => {
                      const isExpired = new Date(k.expires_at).getTime() < Date.now();
                      const isRevoked = !!k.revoked_at;
                      return (
                        <div
                          key={k.id}
                          className={`p-4 rounded-xl border transition-all ${
                            isRevoked
                              ? 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-60'
                              : isExpired
                              ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/60'
                              : 'bg-white dark:bg-slate-850 border-slate-200 dark:border-slate-700 shadow-sm'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <strong className="text-sm font-bold text-slate-900 dark:text-white block">{k.name}</strong>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {k.scopes.map((s: string) => (
                                  <span key={s} className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                    {s}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isRevoked
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                  : isExpired
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              }`}
                            >
                              {isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
                            </span>
                          </div>

                          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                            <div>
                              Expires: <span className="font-medium text-slate-700 dark:text-slate-300">{new Date(k.expires_at).toLocaleString()}</span>
                            </div>
                            <div>
                              Last used:{' '}
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}
                              </span>
                            </div>
                          </div>

                          {!isRevoked && (
                            <div className="mt-3 pt-2 flex items-center gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => action({ action: 'revoke', id: k.id })}
                                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-950 transition"
                              >
                                Revoke
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  action({
                                    action: 'rotate',
                                    id: k.id,
                                    name: k.name,
                                    scopes: k.scopes,
                                    expires: new Date(Date.now() + 90 * 86400000).toISOString(),
                                  })
                                }
                                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-950 transition"
                              >
                                Rotate (90 days; old key stops immediately)
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: CONNECTION & REQUEST HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {['ALL', 'SYNC', 'TEST', 'REQ', 'KEY'].map(filter => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setHistoryFilter(filter)}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                        historyFilter === filter
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {filter === 'ALL'
                        ? 'All Events'
                        : filter === 'SYNC'
                        ? 'Sync Runs'
                        : filter === 'TEST'
                        ? 'Pings / Tests'
                        : filter === 'REQ'
                        ? 'Incoming Requests'
                        : 'Key Changes'}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => action({ action: 'clearHistory' })}
                    disabled={busy || historyList.length === 0}
                    className="text-xs text-slate-400 hover:text-rose-500 transition px-2 py-1"
                  >
                    Clear History
                  </button>
                </div>
              </div>

              {historyList.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <svg className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm font-medium text-slate-500">No events logged yet for this filter</p>
                  <p className="text-xs text-slate-400">Run a "Test connection" or "Sync now" to see live activity here.</p>
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                        <tr>
                          <th className="py-3 px-4">Time</th>
                          <th className="py-3 px-4">Type</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Message / Details</th>
                          <th className="py-3 px-4 text-right">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {historyList.map((h: Row) => {
                          const isSuccess = h.status === 'SUCCESS';
                          const isFailed = h.status === 'FAILED';
                          return (
                            <tr key={h.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition">
                              <td className="py-3 px-4 text-slate-500 whitespace-nowrap font-mono text-[11px]">
                                {new Date(h.created_at).toLocaleString()}
                              </td>
                              <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono">
                                  {h.type}
                                </span>
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    isSuccess
                                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                      : isFailed
                                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                      : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                                  }`}
                                >
                                  {h.status || 'INFO'}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                                <div className="font-medium">{h.message}</div>
                                {h.details && Object.keys(h.details).length > 0 && (
                                  <div className="text-[10px] font-mono text-slate-400 truncate max-w-md mt-0.5">
                                    {JSON.stringify(h.details)}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-slate-500 text-[11px] whitespace-nowrap">
                                {h.duration_ms ? `${h.duration_ms}ms` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: VICE-VERSA SETUP GUIDE */}
          {activeTab === 'guide' && (
            <div className="space-y-6 text-sm text-slate-700 dark:text-slate-300">
              <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 space-y-2">
                <h4 className="font-bold text-blue-900 dark:text-blue-200">How the Bidirectional 2-Way Pairing Works</h4>
                <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
                  Price List and Sales Workflow (ERP) communicate vice-versa over authenticated HTTPS APIs:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-blue-100 dark:border-slate-800 space-y-1">
                    <strong className="text-blue-600 block">Direction 1: Panel ERP → Price List</strong>
                    <p className="text-slate-500">Panel ERP pulls catalog items & submits local product proposals for review.</p>
                    <p className="font-mono text-[11px] text-slate-400">Target URL: Price List integration URL</p>
                    <p className="font-mono text-[11px] text-slate-400">Key Scopes: catalog:read, proposals:write, proposals:read</p>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-blue-100 dark:border-slate-800 space-y-1">
                    <strong className="text-emerald-600 block">Direction 2: Price List → Panel ERP</strong>
                    <p className="text-slate-500">Price List notifies ERP when products are edited, approved, or linked.</p>
                    <p className="font-mono text-[11px] text-slate-400">Target URL: ERP integration URL</p>
                    <p className="font-mono text-[11px] text-slate-400">Key Scopes: notifications:write</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-bold text-slate-900 dark:text-white">Step-by-Step Setup Checklist:</h4>
                <ol className="space-y-3 list-decimal list-inside text-xs sm:text-sm">
                  <li className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                    <strong>In this Price List app:</strong> Under Incoming API Keys, generate a key with <code className="text-blue-600">catalog:read</code>, <code className="text-blue-600">proposals:write</code>, and <code className="text-blue-600">proposals:read</code>. Copy Price List's Ingress URL (<code className="text-slate-600">{defaultSelfUrl}</code>) and this generated key.
                  </li>
                  <li className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                    <strong>In Panel ERP app:</strong> Go to Admin → Integrations → Connected Apps. Paste Price List's Ingress URL and the key generated from Price List into Outgoing Connection. Save & Test Connection.
                  </li>
                  <li className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                    <strong>In Panel ERP app:</strong> Generate an incoming key with <code className="text-emerald-600">notifications:write</code>. Copy Panel ERP's Ingress URL (<code className="text-slate-600">https://softwaresolver.online/api/sales-workflow/integration/v1</code>) and the key.
                  </li>
                  <li className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                    <strong>In this Price List app:</strong> In the Outgoing Connection form above, paste Panel ERP's Ingress URL and key. Click <strong>Save connection</strong> then <strong>Test connection</strong>!
                  </li>
                </ol>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

