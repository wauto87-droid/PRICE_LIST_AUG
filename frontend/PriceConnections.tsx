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

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'PENDING_REVIEW':
        return 'conn-badge blue';
      case 'APPROVED':
        return 'conn-badge green';
      case 'LINKED':
        return 'conn-badge gray';
      case 'CHANGES_REQUESTED':
        return 'conn-badge red';
      case 'REJECTED':
        return 'conn-badge red';
      default:
        return 'conn-badge gray';
    }
  };

  return (
    <div className="conn-container">
      {/* Master Connected Apps Panel */}
      <ConnectedApps call={call} />

      {/* Incoming Product Proposals Queue */}
      <div className="conn-card" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Incoming Product Proposals (Sales Queue)</h3>
            <p style={{ margin: '2px 0 0 0', fontSize: 12 }}>
              Review product specifications proposed from Sales Workflow before linking or creating an item.
            </p>
          </div>
          <button type="button" onClick={load} disabled={busy} className="button" style={{ fontSize: 12 }}>
            ↻ Refresh queue
          </button>
        </div>

        {error && (
          <div role="alert" className="conn-badge red" style={{ display: 'block', padding: '10px 14px', marginBottom: 12, fontSize: 12 }}>
            <strong>Error: </strong>{error}
          </div>
        )}

        {/* Search bar */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <input
              type="text"
              placeholder="Find existing product / reusable item to link..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ fontSize: 12, padding: '7px 10px' }}
            />
          </div>
          {matches.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              Found <strong>{matches.length}</strong> matching catalog items
            </span>
          )}
        </div>

        {/* Proposals List */}
        {rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--muted)', border: '1px dashed var(--line)', borderRadius: 8 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>No incoming proposals pending review</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 11 }}>
              When Sales Workflow submits new product requests, they will show up here.
            </p>
          </div>
        ) : (
          <div>
            {rows.map((p) => {
              const item = p.data?.item || {};
              const isPending = p.status === 'PENDING_REVIEW';
              return (
                <div key={p.id} className="conn-proposal-card">
                  <div className="conn-proposal-header">
                    <div>
                      <span className="conn-badge gray" style={{ marginRight: 6, fontFamily: 'monospace' }}>
                        {item.code || 'NO CODE'}
                      </span>
                      <strong style={{ fontSize: 14, color: 'var(--ink)' }}>
                        {item.description || 'Untitled item'}
                      </strong>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {item.brand && <span>Brand: <strong style={{ color: 'var(--ink)' }}>{item.brand}</strong></span>}
                        {item.unit && <span>Unit: <strong style={{ color: 'var(--ink)' }}>{item.unit}</strong></span>}
                        {item.specifications && <span>Specs: {item.specifications}</span>}
                      </div>
                    </div>

                    <span className={getStatusBadgeClass(p.status)}>
                      {p.status}
                    </span>
                  </div>

                  {(p.data?.note || p.result?.reason) && (
                    <div style={{ marginTop: 8, padding: 8, background: '#f8f8fa', borderRadius: 6, fontSize: 11 }}>
                      {p.data?.note && <div><strong>Sales Workflow Note:</strong> {p.data.note}</div>}
                      {p.result?.reason && <div><strong>Outcome Note:</strong> {p.result.reason}</div>}
                    </div>
                  )}

                  {isPending && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                      <div className="conn-actions">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setEdit(p)}
                          className="primary"
                          style={{ fontSize: 11 }}
                        >
                          Create regular product
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveActionId(activeActionId === `reusable-${p.id}` ? null : `reusable-${p.id}`)}
                          style={{ fontSize: 11 }}
                        >
                          Create reusable item
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveActionId(activeActionId === `link-${p.id}` ? null : `link-${p.id}`)}
                          style={{ fontSize: 11 }}
                        >
                          Link existing
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveActionId(activeActionId === `reject-${p.id}` ? null : `reject-${p.id}`)}
                          style={{ fontSize: 11, color: 'var(--red)' }}
                        >
                          Request changes / Reject
                        </button>
                      </div>

                      {/* Collapsible Action Subpanels */}
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
                          className="conn-subpanel"
                        >
                          <h4 style={{ fontSize: 12, margin: '0 0 8px 0', textTransform: 'uppercase', color: 'var(--muted)' }}>
                            Create Reusable Custom Item
                          </h4>
                          <div className="conn-form-grid">
                            <label>
                              Reference
                              <input name="reference" defaultValue={item.code || ''} />
                            </label>
                            <label>
                              Description
                              <input name="description" defaultValue={item.description || ''} required />
                            </label>
                            <label>
                              Unit
                              <input name="unit" defaultValue={item.unit || 'PCS'} required />
                            </label>
                            <label>
                              Suggested Unit Price (SAR)
                              <input name="price" required placeholder="0.00" />
                            </label>
                            <label style={{ gridColumn: '1 / -1' }}>
                              Review Reason
                              <input name="reason" required placeholder="Admin approval reason" />
                            </label>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                            <label className="check" style={{ fontSize: 11 }}>
                              <input type="checkbox" required />
                              <span>I confirmed the product and its suggested price</span>
                            </label>
                            <button disabled={busy} className="primary" style={{ fontSize: 11 }}>
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
                          className="conn-subpanel"
                        >
                          <h4 style={{ fontSize: 12, margin: '0 0 8px 0', textTransform: 'uppercase', color: 'var(--muted)' }}>
                            Link to Existing Catalog Item
                          </h4>
                          <div className="conn-form-grid">
                            <label>
                              Select Matching Product
                              <select name="target" required>
                                <option value="">Choose matching item (use search bar above)</option>
                                {matches.map((m) => (
                                  <option key={`${m.type}:${m.id}`} value={`${m.type}:${m.id}`}>
                                    {m.code} · {m.description} · {m.unit} ({m.type})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Verification Evidence
                              <input name="reason" required placeholder="Evidence that specs match" />
                            </label>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                            <button disabled={busy} className="primary" style={{ fontSize: 11 }}>
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
                          className="conn-subpanel"
                        >
                          <h4 style={{ fontSize: 12, margin: '0 0 8px 0', textTransform: 'uppercase', color: 'var(--muted)' }}>
                            Request Changes or Reject Proposal
                          </h4>
                          <div className="conn-form-grid">
                            <label>
                              Decision
                              <select name="decision">
                                <option value="CHANGES_REQUESTED">Request changes</option>
                                <option value="REJECTED">Reject</option>
                              </select>
                            </label>
                            <label>
                              Reason / Note for Salesperson
                              <input name="reason" required placeholder="Reason / correction required" />
                            </label>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                            <button disabled={busy} style={{ fontSize: 11, background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }}>
                              Send decision
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <button
            disabled={!page || busy}
            onClick={() => setPage(page - 1)}
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            ← Previous
          </button>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
            Page {page + 1}
          </span>
          <button
            disabled={rows.length < 100 || busy}
            onClick={() => setPage(page + 1)}
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Product Editor Modal */}
      {edit && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card" style={{ maxWidth: 900, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>Create Regular Product from Proposal</h3>
                <p style={{ margin: '2px 0 0 0', fontSize: 12, color: 'var(--muted)' }}>
                  Enter current pricing and confirm it by saving. Values are never taken from workflow.
                </p>
              </div>
              <button type="button" onClick={() => setEdit(undefined)} style={{ padding: '2px 8px', fontSize: 12 }}>
                ✕ Close
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
