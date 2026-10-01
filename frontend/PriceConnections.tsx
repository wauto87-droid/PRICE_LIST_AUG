'use client';

import React, { useEffect, useState } from 'react';
import ConnectedApps from './ConnectedApps';
import ProductEditor, { blankProduct } from './ProductEditor';
import { api, Translate } from './api';

const call = (body?: any) => api('connected-apps', body ? 'POST' : 'GET', body);

export default function PriceConnections({ t }: { t: Translate }) {
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<any>();
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await api(`connected-apps?incoming=1&page=${page}`);
      setRows(res.rows || []);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, [page]);

  useEffect(() => {
    let active = true;
    api(`connected-apps?search=${encodeURIComponent(search)}`)
      .then((r) => {
        if (active) setMatches(r.rows || []);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [search]);

  const review = async (p: any, v: any) => {
    setBusy(true);
    setError('');
    try {
      await call({ action: 'review', id: p.id, revision: p.revision, ...v });
      setEdit(undefined);
      setActiveActionId(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING_REVIEW':
        return 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800';
      case 'APPROVED':
        return 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
      case 'LINKED':
        return 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800';
      case 'CHANGES_REQUESTED':
        return 'bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-800';
      case 'REJECTED':
        return 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800';
      default:
        return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700';
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 my-6 px-4">
      {/* Connected Apps Master Dashboard */}
      <ConnectedApps call={call} />

      {/* Incoming Products Review Queue Section */}
      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {/* Section Header */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-50/60 to-white dark:from-slate-800/40 dark:to-slate-900">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </span>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                Incoming Product Proposals
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Review product specifications proposed from Sales Workflow before creating or linking an item.
            </p>
          </div>

          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
          >
            <svg className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh queue
          </button>
        </div>

        {error && (
          <div role="alert" className="m-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div className="p-6 space-y-6">
          {/* Search bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                type="text"
                placeholder="Find existing product / reusable item to link..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {matches.length > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400 self-center">
                Found <strong>{matches.length}</strong> matching catalog items
              </span>
            )}
          </div>

          {/* Proposals List */}
          {rows.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl space-y-2">
              <div className="inline-flex p-3 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No incoming proposals</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                When Sales Workflow submits new product requests, they will show up here for review.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {rows.map((p) => {
                const item = p.data?.item || {};
                const isPending = p.status === 'PENDING_REVIEW';
                return (
                  <article
                    key={p.id}
                    className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700 transition shadow-sm space-y-4"
                  >
                    {/* Header: Code & Title & Status */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                            {item.code || 'NO CODE'}
                          </span>
                          <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                            {item.description || 'Untitled item'}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 dark:text-slate-400">
                          {item.brand && <span>Brand: <strong className="text-slate-700 dark:text-slate-300">{item.brand}</strong></span>}
                          {item.unit && <span>• Unit: <strong className="text-slate-700 dark:text-slate-300">{item.unit}</strong></span>}
                          {item.specifications && (
                            <span>• Specs: <span className="text-slate-600 dark:text-slate-300">{item.specifications}</span></span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`px-2.5 py-1 text-xs font-bold rounded-lg border uppercase tracking-wider ${getStatusBadge(p.status)}`}>
                          {p.status}
                        </span>
                      </div>
                    </div>

                    {/* Note & Decision Reason */}
                    {(p.data?.note || p.result?.reason) && (
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-xs space-y-1 text-slate-600 dark:text-slate-300">
                        {p.data?.note && (
                          <p><strong className="text-slate-700 dark:text-slate-200">Sales Workflow Note:</strong> {p.data.note}</p>
                        )}
                        {p.result?.reason && (
                          <p><strong className="text-slate-700 dark:text-slate-200">Review Outcome:</strong> {p.result.reason}</p>
                        )}
                      </div>
                    )}

                    {/* Actions for Pending Review */}
                    {isPending && (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setEdit(p)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition disabled:opacity-50"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Create regular product
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveActionId(activeActionId === `reusable-${p.id}` ? null : `reusable-${p.id}`)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                          >
                            Create reusable item
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveActionId(activeActionId === `link-${p.id}` ? null : `link-${p.id}`)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                          >
                            Link existing
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveActionId(activeActionId === `reject-${p.id}` ? null : `reject-${p.id}`)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                          >
                            Request changes / Reject
                          </button>
                        </div>

                        {/* Collapsible Action Sub-panels */}
                        {activeActionId === `reusable-${p.id}` && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = Object.fromEntries(new FormData(e.currentTarget));
                              void review(p, {
                                decision: 'APPROVED',
                                type: 'REUSABLE',
                                custom: {
                                  reference: f.reference,
                                  description: f.description,
                                  unit: f.unit,
                                  suggestedUnitPrice: f.price,
                                },
                                reason: f.reason,
                                pricingConfirmed: true,
                              }).catch(() => {});
                            }}
                            className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-3"
                          >
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                              Create Reusable Custom Item
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                              {[
                                ['reference', 'Reference', item.code || ''],
                                ['description', 'Description', item.description || ''],
                                ['unit', 'Unit', item.unit || 'PCS'],
                                ['price', 'Suggested unit price', ''],
                                ['reason', 'Review reason', ''],
                              ].map(([name, label, value]) => (
                                <label key={name} className="block text-xs font-medium text-slate-700 dark:text-slate-300 space-y-1">
                                  <span>{label}</span>
                                  <input
                                    name={name}
                                    defaultValue={value}
                                    required={name !== 'reference'}
                                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                </label>
                              ))}
                            </div>
                            <div className="flex items-center justify-between gap-4 pt-2">
                              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                                <input type="checkbox" required className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                <span>I confirmed the product and its suggested price</span>
                              </label>
                              <button
                                disabled={busy}
                                className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50"
                              >
                                Approve reusable item
                              </button>
                            </div>
                          </form>
                        )}

                        {activeActionId === `link-${p.id}` && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              const [type, targetId] = String(f.get('target')).split(':');
                              void review(p, {
                                decision: 'LINKED',
                                type,
                                targetId,
                                reason: f.get('reason'),
                              }).catch(() => {});
                            }}
                            className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-3"
                          >
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                              Link to Existing Catalog Item
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 space-y-1">
                                <span>Select matching product</span>
                                <select
                                  name="target"
                                  required
                                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                  <option value="">Choose matching product (use search bar above)</option>
                                  {matches.map((m) => (
                                    <option key={`${m.type}:${m.id}`} value={`${m.type}:${m.id}`}>
                                      {m.code} · {m.description} · {m.unit} ({m.type})
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 space-y-1">
                                <span>Verification evidence</span>
                                <input
                                  name="reason"
                                  required
                                  placeholder="Evidence that specifications match"
                                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </label>
                            </div>
                            <div className="flex justify-end pt-1">
                              <button
                                disabled={busy}
                                className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition disabled:opacity-50"
                              >
                                Link existing
                              </button>
                            </div>
                          </form>
                        )}

                        {activeActionId === `reject-${p.id}` && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              void review(p, {
                                decision: f.get('decision'),
                                reason: f.get('reason'),
                              }).catch(() => {});
                            }}
                            className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-3"
                          >
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                              Request Correction or Reject Proposal
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 space-y-1">
                                <span>Decision</span>
                                <select
                                  name="decision"
                                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                  <option value="CHANGES_REQUESTED">Request changes</option>
                                  <option value="REJECTED">Reject</option>
                                </select>
                              </label>
                              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 space-y-1">
                                <span>Reason / Note to salesperson</span>
                                <input
                                  name="reason"
                                  required
                                  placeholder="Reason / correction needed"
                                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </label>
                            </div>
                            <div className="flex justify-end pt-1">
                              <button
                                disabled={busy}
                                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition disabled:opacity-50"
                              >
                                Send decision
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              disabled={!page || busy}
              onClick={() => setPage(page - 1)}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              Previous
            </button>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Page {page + 1}
            </span>
            <button
              disabled={rows.length < 100 || busy}
              onClick={() => setPage(page + 1)}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {/* Product Editor Modal */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full p-6 space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  Create Regular Product from Proposal
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Enter current pricing and confirm it by saving. Values are never taken from the workflow proposal.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEdit(undefined)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <ProductEditor
              t={t}
              initial={{
                ...blankProduct,
                partNumber: edit.data?.item?.code || '',
                description: edit.data?.item?.description || '',
                brand: edit.data?.item?.brand || '',
                unit: edit.data?.item?.unit || 'PCS',
                cost: '',
                listPrice: '0',
                details: {
                  ...blankProduct.details,
                  detailedDescription: edit.data?.item?.specifications || '',
                  specifications: [],
                },
              }}
              onClose={() => setEdit(undefined)}
              actionBusy={busy}
              onSave={(product) =>
                review(edit, {
                  decision: 'APPROVED',
                  type: 'PRODUCT',
                  product,
                  pricingConfirmed: true,
                  reason: 'Administrator reviewed product specifications and entered pricing',
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

