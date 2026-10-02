'use client';
import { useEffect, useState, useRef } from 'react';
import { api } from './api';

export default function PricingCollectionJobs({ documentId }: { documentId?: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [current, setCurrent] = useState(documentId || '');
  const [doc, setDoc] = useState<any>();
  const [staff, setStaff] = useState<any[]>([]);
  const [userId, setUserId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [creators, setCreators] = useState<Array<{ id: string; name: string; username: string }>>([]);
  const [ownerFilter, setOwnerFilter] = useState<string>('me');
  const [statusFilter, setStatusFilter] = useState<string>('DRAFT');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selected, setSelected] = useState<string[]>([]);
  const [version, setVersion] = useState<number>();
  const retry = useRef<{ hash: string; id: string } | null>(null);
  const [workflowVersion, setWorkflowVersion] = useState<number>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  async function load(id = current, owner = ownerFilter, status = statusFilter) {
    try {
      if (id) {
        setDoc(await api(`workflow-jobs?documentId=${encodeURIComponent(id)}`));
      } else {
        const params = new URLSearchParams();
        if (owner) params.set('owner', owner);
        if (status) params.set('status', status);
        const qStr = params.toString();
        const result = await api(`workflow-jobs${qStr ? `?${qStr}` : ''}`);
        setRows(result.rows || []);
        setUserId(result.userId || '');
        setIsAdmin(!!result.isAdmin);
        if (result.creators) setCreators(result.creators);
      }
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load(current, ownerFilter, statusFilter);
    const timer = setInterval(() => void load(current, ownerFilter, statusFilter), 10000);
    return () => clearInterval(timer);
  }, [current, ownerFilter, statusFilter]);

  useEffect(() => {
    if (current) {
      api('workflow-jobs?staff=1')
        .then(r => setStaff(r.staff || []))
        .catch(e => setError(e.message));
    }
  }, [current]);

  const command = async (body: any) => {
    setBusy(true);
    setError('');
    try {
      delete body.eventId;
      const payload = {
        ...body,
        documentId: current,
        version: version ?? doc.version,
        workflowVersion: workflowVersion ?? doc.workflowVersion,
      };
      const hash = JSON.stringify(payload);
      if (retry.current?.hash !== hash) retry.current = { hash, id: crypto.randomUUID() };
      const result = await api('workflow-jobs', 'POST', { ...payload, eventId: retry.current.id });
      retry.current = null;
      setMessage(
        result.ready
          ? 'All prices ready for creator review.'
          : 'Saved. Pending jobs will synchronize with ERP.',
      );
      setSelected([]);
      setVersion(undefined);
      setWorkflowVersion(undefined);
      await load(current, ownerFilter, statusFilter);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const filteredRows = rows.filter(q => {
    if (!searchQuery.trim()) return true;
    const term = searchQuery.toLowerCase().trim();
    const num = (q.number || '').toLowerCase();
    const cust = (typeof q.customer === 'string' ? q.customer : q.customer?.name || '').toLowerCase();
    const creator = (q.creator || '').toLowerCase();
    return num.includes(term) || cust.includes(term) || creator.includes(term);
  });

  return (
    <section className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0' }}>Pricing & Collection Jobs</h2>
          <p style={{ margin: 0, color: 'var(--muted, #64748b)', fontSize: 14 }}>
            Assign work here. Staff update jobs through ERP or ERP WhatsApp.
          </p>
        </div>
        {userId && (
          <div style={{ fontSize: 13, background: 'var(--surface-2, #f1f5f9)', padding: '4px 10px', borderRadius: 6 }}>
            Your Price List ID: <code style={{ fontWeight: 600 }}>{userId}</code>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" style={{ background: '#fee2e2', border: '1px solid #f87171', color: '#991b1b', padding: '10px 14px', borderRadius: 6, margin: '12px 0', fontSize: 14 }}>
          {error}
        </div>
      )}
      {message && (
        <div role="status" style={{ background: '#ecfdf5', border: '1px solid #34d399', color: '#065f46', padding: '10px 14px', borderRadius: 6, margin: '12px 0', fontSize: 14 }}>
          {message}
        </div>
      )}

      {!current ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, margin: '16px 0 12px 0', padding: 12, background: 'var(--surface-2, #f8fafc)', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)' }}>
            {isAdmin ? (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 500 }}>
                <span>User:</span>
                <select
                  value={ownerFilter}
                  onChange={e => setOwnerFilter(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 14 }}
                >
                  <option value="me">My Documents / Drafts</option>
                  <option value="all">All Users</option>
                  {creators.length > 0 && (
                    <optgroup label="User-wise Filter">
                      {creators.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.username})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            ) : (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                <span style={{ color: '#64748b' }}>Filter:</span>
                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: 4, fontWeight: 500, fontSize: 13 }}>
                  My Saved Documents
                </span>
              </div>
            )}

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 500 }}>
              <span>Status:</span>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 14 }}
              >
                <option value="DRAFT">Drafts Only (Default)</option>
                <option value="ALL">All Statuses</option>
                <option value="ISSUED">Issued Only</option>
                <option value="APPROVED">Approved Only</option>
                <option value="SENT">Sent Only</option>
              </select>
            </label>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 500, flex: '1 1 180px' }}>
              <span>Search:</span>
              <input
                type="search"
                placeholder="Search number, customer, creator..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 14, width: '100%' }}
              />
            </label>

            <button
              onClick={() => void load(current, ownerFilter, statusFilter)}
              disabled={busy}
              style={{ padding: '6px 16px', borderRadius: 6, fontWeight: 500, cursor: busy ? 'not-allowed' : 'pointer' }}
            >
              {busy ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 10px 0', fontSize: 13, color: '#64748b' }}>
            <span>
              Showing <strong>{filteredRows.length}</strong> {statusFilter === 'DRAFT' ? 'draft(s)' : 'document(s)'}
              {isAdmin ? (ownerFilter === 'me' ? ' for your account' : ownerFilter === 'all' ? ' for all users' : ' for selected user') : ' for your account'}
            </span>
          </div>

          {filteredRows.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', color: '#64748b', background: 'var(--surface-2, #f8fafc)', borderRadius: 8, border: '1px dashed #cbd5e1', margin: '16px 0' }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: '#334155' }}>No documents match the current filters.</p>
              <p style={{ margin: '6px 0 0 0', fontSize: 13 }}>
                {statusFilter === 'DRAFT'
                  ? 'There are currently no drafts under this user filter. You can select "All Statuses" or switch users to check other quotations.'
                  : 'Try clearing your search query or choosing another user.'}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Customer / creator</th>
                    <th>Status</th>
                    <th>Pricing</th>
                    <th>Collection</th>
                    <th>Blockers</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(q => (
                    <tr key={q.id}>
                      <td>
                        <button
                          onClick={() => {
                            setCurrent(q.id);
                            setDoc(undefined);
                          }}
                          style={{ fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', color: 'var(--primary, #0284c7)', cursor: 'pointer', padding: 0 }}
                        >
                          {q.number}
                        </button>
                      </td>
                      <td>
                        {q.customer?.name || (typeof q.customer === 'string' ? q.customer : '') || 'Customer'} · <span style={{ color: '#475569' }}>{q.creator}</span>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          background: q.status === 'DRAFT' ? '#fef3c7' : q.status === 'ISSUED' ? '#e0e7ff' : q.status === 'APPROVED' ? '#dcfce7' : '#f1f5f9',
                          color: q.status === 'DRAFT' ? '#92400e' : q.status === 'ISSUED' ? '#3730a3' : q.status === 'APPROVED' ? '#166534' : '#475569',
                        }}>
                          {q.status}
                        </span>
                      </td>
                      <td>{q.pricing}/{q.pricingAssigned}</td>
                      <td>{q.collection}/{q.collectionAssigned}</td>
                      <td>{q.blockers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 16px 0', flexWrap: 'wrap', gap: 8 }}>
            {!documentId && (
              <button
                onClick={() => {
                  setCurrent('');
                  setDoc(undefined);
                  setSelected([]);
                  setVersion(undefined);
                }}
                style={{ padding: '6px 14px', borderRadius: 6, fontWeight: 500 }}
              >
                ← Back to all documents
              </button>
            )}
            <button
              onClick={() => void load(current, ownerFilter, statusFilter)}
              disabled={busy}
              style={{ padding: '6px 14px', borderRadius: 6, fontWeight: 500 }}
            >
              {busy ? 'Refreshing...' : 'Refresh document'}
            </button>
          </div>

          {doc && (
            <>
              <h3>{doc.number} · <span style={{ fontSize: '0.85em', color: '#64748b' }}>{doc.status}</span></h3>
              <p style={{ fontSize: 13, color: '#64748b' }}>Creator mapping ID: <code>{doc.creatorId}</code></p>
              <p style={{ fontWeight: 500 }}>
                {doc.ready
                  ? 'All supplier prices ready for review. Finalize from the quotation screen.'
                  : 'Pricing or review remains pending.'}
              </p>
              {doc.failures.map((f: any) => (
                <p key={f.id} role="status" style={{ color: '#b91c1c', fontSize: 14 }}>
                  {f.state === 'SENDING' ? 'Pending ERP sync' : f.state}: {f.error || 'Waiting for ERP acknowledgement'}
                </p>
              ))}

              <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Product</th>
                      <th>Quantity</th>
                      <th>Pricing / collection</th>
                      <th>Supplier cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((l: any) => (
                      <tr key={l.id}>
                        <td>
                          <input
                            aria-label={`Select ${l.description}`}
                            type="checkbox"
                            checked={selected.includes(l.id)}
                            onChange={e => {
                              if (!selected.length) {
                                setVersion(doc.version);
                                setWorkflowVersion(doc.workflowVersion);
                              }
                              setSelected(e.target.checked ? [...selected, l.id] : selected.filter(id => id !== l.id));
                            }}
                          />
                        </td>
                        <td>
                          <strong>{l.partNumber}</strong> · {l.description}
                          <br />
                          <small style={{ color: '#64748b' }}>{l.unit}</small>
                        </td>
                        <td>
                          {doc.status === 'DRAFT' ? (
                            l.quantity
                          ) : (
                            <input
                              aria-label={`Collect quantity for ${l.description}`}
                              type="number"
                              min="0.000001"
                              step="any"
                              max={l.quantity}
                              value={quantities[l.id] ?? l.quantity}
                              onChange={e => setQuantities({ ...quantities, [l.id]: e.target.value })}
                            />
                          )}
                        </td>
                        <td>
                          {['PRICING', 'COLLECTION'].map(
                            kind =>
                              l.jobs[kind] && (
                                <div key={kind} style={{ marginBottom: 6 }}>
                                  <strong>{kind}</strong>: {l.jobs[kind].status} · {staff.find(s => s.id === l.jobs[kind].owner)?.name || l.jobs[kind].owner}
                                  <br />
                                  {l.jobs[kind].blocker && <span style={{ color: '#b91c1c' }}>{l.jobs[kind].blocker}<br /></span>}
                                  <small style={{ color: '#64748b' }}>
                                    {l.jobs[kind].shops} · {l.jobs[kind].notes}
                                  </small>
                                  {l.jobs[kind].movements?.map((m: any) => (
                                    <div key={m.id} style={{ fontSize: 12 }}>
                                      {m.type} {m.quantity} · supplier {m.supplierName || m.supplier} · {m.evidence}
                                    </div>
                                  ))}
                                </div>
                              ),
                          )}
                        </td>
                        <td>
                          {l.workflowCost ? (
                            <>
                              <span style={{ fontWeight: 600 }}>
                                {l.workflowCost.cost} {l.workflowCost.currency}/{l.workflowCost.unit}
                              </span>
                              <br />
                              <small style={{ color: '#64748b' }}>
                                Price updated by {l.workflowCost.actorName} · {new Date(l.workflowCost.updatedAt).toLocaleString()}
                              </small>
                              {l.workflowCost.stale && <strong style={{ color: '#b91c1c' }}> · Product changed: reconfirm cost</strong>}
                              {l.margin !== null && <div style={{ fontSize: 12, color: '#047857' }}>Unit margin: {l.margin}</div>}
                            </>
                          ) : (
                            <span style={{ color: '#64748b', fontStyle: 'italic' }}>Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {doc.canAssign && (
                <>
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void command({
                        action: 'assign',
                        eventId: crypto.randomUUID(),
                        kind: doc.status === 'DRAFT' ? 'PRICING' : 'COLLECTION',
                        selected,
                        assignee: f.get('assignee'),
                        shops: f.get('shops'),
                        notes: f.get('notes'),
                        due: f.get('due') ? new Date(String(f.get('due'))).toISOString() : '',
                        noDueReason: f.get('noDueReason'),
                        mode: f.get('mode') || undefined,
                        poNumber: f.get('poNumber') || '',
                        authorized: f.get('authorized') === 'on',
                        quantities,
                      });
                    }}
                    style={{ background: 'var(--surface-2, #f8fafc)', padding: 16, borderRadius: 8, border: '1px solid var(--border, #e2e8f0)', marginTop: 16 }}
                  >
                    <h3 style={{ margin: '0 0 12px 0' }}>Assign {selected.length} selected products</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 500, fontSize: 14 }}>
                        Staff:
                        <select required name="assignee" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
                          <option value="">Choose ERP staff</option>
                          {staff
                            .filter(s =>
                              (doc.status === 'DRAFT'
                                ? ['sales', 'pricing', 'manager']
                                : ['sales', 'collection', 'manager']
                              ).includes(s.role),
                            )
                            .map(s => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                                {s.phoneConfigured ? '' : ' — WhatsApp number missing'}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 500, fontSize: 14 }}>
                        Deadline:
                        <input name="due" type="datetime-local" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                      </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 12 }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 500, fontSize: 14 }}>
                        Shops to contact:
                        <textarea name="shops" maxLength={10000} rows={2} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 500, fontSize: 14 }}>
                        Instructions:
                        <textarea name="notes" maxLength={10000} rows={2} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                      </label>
                    </div>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 500, fontSize: 14, marginTop: 12 }}>
                      If unknown deadline, explain:
                      <input name="noDueReason" maxLength={500} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                    </label>

                    {doc.status !== 'DRAFT' && (
                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 500, fontSize: 14 }}>
                          Collection basis:
                          <select name="mode" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
                            <option value="ORDER_CONFIRMED">Customer order confirmed</option>
                            <option value="EARLY_AUTHORIZED">Authorize collection before customer order</option>
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 500, fontSize: 14 }}>
                          Customer PO reference (optional):
                          <input name="poNumber" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                          <input name="authorized" type="checkbox" required />
                          I confirm this order or authorize early collection for the selected quantities.
                        </label>
                      </div>
                    )}

                    <div style={{ marginTop: 16 }}>
                      <button disabled={busy || !selected.length} style={{ padding: '8px 20px', borderRadius: 6, fontWeight: 600 }}>
                        Assign selected products
                      </button>
                    </div>
                  </form>

                  {doc.status === 'DRAFT' && selected.length === 1 && (
                    <details style={{ marginTop: 16, background: 'var(--surface-2, #f8fafc)', padding: 14, borderRadius: 8, border: '1px solid var(--border, #e2e8f0)' }}>
                      <summary style={{ fontWeight: 600, cursor: 'pointer' }}>
                        Price already known / confirm reviewed supplier cost
                      </summary>
                      <form
                        onSubmit={e => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          const line = doc.lines.find((l: any) => l.id === selected[0]);
                          void command({
                            action: 'known',
                            lineId: line.id,
                            cost: {
                              cost: f.get('cost'),
                              currency: f.get('currency'),
                              unit: line.unit,
                              supplier: f.get('supplier'),
                              taxBasis: f.get('taxBasis'),
                              availability: f.get('availability'),
                              evidence: f.get('evidence'),
                              leadTime: f.get('leadTime'),
                            },
                          });
                        }}
                        style={{ marginTop: 12 }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 500 }}>
                            Supplier cost:
                            <input name="cost" type="number" min="0" step="any" required style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 500 }}>
                            Currency:
                            <input name="currency" defaultValue={doc.currency} pattern="[A-Z]{3}" required style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 500 }}>
                            Supplier:
                            <input name="supplier" required style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 500 }}>
                            Tax basis:
                            <input name="taxBasis" required style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 500 }}>
                            Availability:
                            <input name="availability" required style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 500 }}>
                            Lead time:
                            <input name="leadTime" required style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 500 }}>
                            Evidence/reference:
                            <input name="evidence" required style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                          </label>
                        </div>
                        <div style={{ marginTop: 14 }}>
                          <button disabled={busy} style={{ padding: '8px 20px', borderRadius: 6, fontWeight: 600 }}>
                            Confirm this price
                          </button>
                        </div>
                      </form>
                    </details>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
