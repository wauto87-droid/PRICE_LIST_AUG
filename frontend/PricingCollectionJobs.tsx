"use client";
import { useEffect, useState, useRef } from "react";
import { api } from "./api";
import CollectionOrders from "./CollectionOrders";
import SharedQuotation from "./SharedQuotation";

export default function PricingCollectionJobs({
  documentId,
}: {
  documentId?: string;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [current, setCurrent] = useState(documentId || "");
  const [doc, setDoc] = useState<any>();
  const [contextRefresh, setContextRefresh] = useState(0);
  const [context, setContext] = useState<any>();
  const [staff, setStaff] = useState<any[]>([]);
  const [userId, setUserId] = useState("");
  const [userReference, setUserReference] = useState<any>();
  const [isAdmin, setIsAdmin] = useState(false);
  const [creators, setCreators] = useState<
    Array<{ id: string; name: string; username: string }>
  >([]);
  const [ownerFilter, setOwnerFilter] = useState<string>("me");
  const [orderId, setOrderId] = useState("");
  const [section, setSection] = useState<"DRAFT" | "QUOTATIONS">("DRAFT");
  const [statusFilter, setStatusFilter] = useState<string>("DRAFT");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selected, setSelected] = useState<string[]>([]);
  const [version, setVersion] = useState<number>();
  const retry = useRef<{ hash: string; id: string } | null>(null);
  const [workflowVersion, setWorkflowVersion] = useState<number>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  async function load(
    id = current,
    owner = ownerFilter,
    status = statusFilter,
  ) {
    try {
      if (id) {
        setDoc(await api(`workflow-jobs?documentId=${encodeURIComponent(id)}`));
      } else {
        const params = new URLSearchParams();
        if (owner) params.set("owner", owner);
        if (status) params.set("status", status);
        const qStr = params.toString();
        const result = await api(`workflow-jobs${qStr ? `?${qStr}` : ""}`);
        setRows(result.rows || []);
        setUserId(result.userId || "");
        setUserReference(result.userReference);
        setIsAdmin(!!result.isAdmin);
        if (result.creators) setCreators(result.creators);
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load(current, ownerFilter, statusFilter);
    const timer = setInterval(
      () => void load(current, ownerFilter, statusFilter),
      10000,
    );
    return () => clearInterval(timer);
  }, [current, ownerFilter, statusFilter]);

  useEffect(() => {
    setContext(undefined);
    setStaff([]);
  }, [current]);
  useEffect(() => {
    let cancelled = false;
    if (current && doc?.id === current) {
      api(`workflow-jobs?staff=1&documentId=${encodeURIComponent(current)}`)
        .then((r) => {
          if (!cancelled) {
            setContext(r);
            setStaff(r.staff || []);
            if (r.workflowVersion !== undefined)
              setDoc((d: any) =>
                d?.id === current && d.workflowVersion !== r.workflowVersion
                  ? {
                      ...d,
                      workflowVersion: r.workflowVersion,
                      branchId: r.branchId,
                    }
                  : d,
              );
          }
        })
        .catch((e) => {
          if (!cancelled) setContext({ error: e.message });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [current, doc?.id, doc?.workflowVersion, doc?.status, contextRefresh]);

  const command = async (body: any) => {
    setBusy(true);
    setError("");
    try {
      delete body.eventId;
      const payload = {
        branchId: context?.branchId,
        ownerMappingRevision: context?.ownerMappingRevision,
        actorMappingRevision: context?.actorMappingRevision,
        ...body,
        documentId: current,
        version: body.version ?? version ?? doc.version,
        workflowVersion:
          body.workflowVersion ?? workflowVersion ?? doc.workflowVersion,
      };
      const hash = JSON.stringify(payload);
      if (retry.current?.hash !== hash)
        retry.current = { hash, id: crypto.randomUUID() };
      const result = await api("workflow-jobs", "POST", {
        ...payload,
        eventId: retry.current.id,
      });
      retry.current = null;
      setMessage(
        result.ready
          ? "All prices ready for creator review."
          : body.action === "branch"
            ? "Working branch saved."
            : "Saved. Pending jobs will synchronize with ERP.",
      );
      setSelected([]);
      setVersion(undefined);
      setWorkflowVersion(undefined);
      await load(current, ownerFilter, statusFilter);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const filteredRows = rows.filter((q) => {
    if (!searchQuery.trim()) return true;
    const term = searchQuery.toLowerCase().trim();
    const num = (q.number || "").toLowerCase();
    const cust = (
      typeof q.customer === "string" ? q.customer : q.customer?.name || ""
    ).toLowerCase();
    const creator = (q.creator || "").toLowerCase();
    return num.includes(term) || cust.includes(term) || creator.includes(term);
  });

  return (
    <section className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 4px 0" }}>Pricing & Collection Jobs</h2>
          <p
            style={{ margin: 0, color: "var(--muted, #64748b)", fontSize: 14 }}
          >
            Assign work here. Staff update jobs through ERP or ERP WhatsApp.
          </p>
        </div>
        {userId && (
          <div
            style={{
              fontSize: 13,
              background: "var(--surface-2, #f1f5f9)",
              padding: "4px 10px",
              borderRadius: 6,
            }}
          >
            Price List user: <strong>{userReference?.name}</strong> ·{" "}
            <code>{userReference?.reference || "Reference pending"}</code>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: "#fee2e2",
            border: "1px solid #f87171",
            color: "#991b1b",
            padding: "10px 14px",
            borderRadius: 6,
            margin: "12px 0",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          style={{
            background: "#ecfdf5",
            border: "1px solid #34d399",
            color: "#065f46",
            padding: "10px 14px",
            borderRadius: 6,
            margin: "12px 0",
            fontSize: 14,
          }}
        >
          {message}
        </div>
      )}

      <SharedQuotation documentId={current || undefined}/>
      {!current ? (
        <>
          <nav
            aria-label="Document type"
            style={{ display: "flex", gap: 8, marginTop: 12 }}
          >
            {(["DRAFT", "QUOTATIONS"] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                aria-pressed={section === tab}
                onClick={() => {
                  setSection(tab);
                  setStatusFilter(tab);
                }}
              >
                {tab === "DRAFT" ? "Drafts" : "Quotations"}
              </button>
            ))}
          </nav>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              margin: "16px 0 12px 0",
              padding: 12,
              background: "var(--surface-2, #f8fafc)",
              borderRadius: 8,
              border: "1px solid var(--border, #e2e8f0)",
            }}
          >
            {isAdmin ? (
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                <span>User:</span>
                <select
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    fontSize: 14,
                  }}
                >
                  <option value="me">My Documents / Drafts</option>
                  <option value="all">All Users</option>
                  {creators.length > 0 && (
                    <optgroup label="User-wise Filter">
                      {creators.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.username})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            ) : (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 14,
                }}
              >
                <span style={{ color: "#64748b" }}>Filter:</span>
                <span
                  style={{
                    background: "#e0f2fe",
                    color: "#0369a1",
                    padding: "4px 10px",
                    borderRadius: 4,
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  My Saved Documents
                </span>
              </div>
            )}

            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              <span>Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  fontSize: 14,
                }}
              >
                <option value="DRAFT">Drafts Only (Default)</option>
                <option value="QUOTATIONS">All quotations</option>
                <option value="ISSUED">Issued Only</option>
                <option value="APPROVED">Approved Only</option>
                <option value="SENT">Sent Only</option>
              </select>
            </label>

            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 14,
                fontWeight: 500,
                flex: "1 1 180px",
              }}
            >
              <span>Search:</span>
              <input
                type="search"
                placeholder="Search number, customer, creator..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  fontSize: 14,
                  width: "100%",
                }}
              />
            </label>

            <button
              onClick={() => {
                void load(current, ownerFilter, statusFilter);
                setContextRefresh((n) => n + 1);
              }}
              disabled={busy}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                fontWeight: 500,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "Loading..." : "Refresh"}
            </button>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              margin: "4px 0 10px 0",
              fontSize: 13,
              color: "#64748b",
            }}
          >
            <span>
              Showing <strong>{filteredRows.length}</strong>{" "}
              {statusFilter === "DRAFT" ? "draft(s)" : "document(s)"}
              {isAdmin
                ? ownerFilter === "me"
                  ? " for your account"
                  : ownerFilter === "all"
                    ? " for all users"
                    : " for selected user"
                : " for your account"}
            </span>
          </div>

          {filteredRows.length === 0 ? (
            <div
              style={{
                padding: "36px 16px",
                textAlign: "center",
                color: "#64748b",
                background: "var(--surface-2, #f8fafc)",
                borderRadius: 8,
                border: "1px dashed #cbd5e1",
                margin: "16px 0",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontWeight: 600,
                  fontSize: 15,
                  color: "#334155",
                }}
              >
                No documents match the current filters.
              </p>
              <p style={{ margin: "6px 0 0 0", fontSize: 13 }}>
                {statusFilter === "DRAFT"
                  ? 'There are currently no drafts under this user filter. You can select "All Statuses" or switch users to check other quotations.'
                  : "Try clearing your search query or choosing another user."}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
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
                  {filteredRows.map((q) => (
                    <tr key={q.id}>
                      <td>
                        <button
                          onClick={() => {
                            setCurrent(q.id);
                            setDoc(undefined);
                          }}
                          style={{
                            fontWeight: 600,
                            textDecoration: "underline",
                            background: "none",
                            border: "none",
                            color: "var(--primary, #0284c7)",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          {q.number}
                        </button>
                        <small style={{ display: "block" }}>
                          {q.workflow || "Tracking pending ERP sync"}
                          {q.orders?.map((o: any) => (
                            <span key={o.id}> · {o.number}</span>
                          ))}
                        </small>
                      </td>
                      <td>
                        {q.customer?.name ||
                          (typeof q.customer === "string" ? q.customer : "") ||
                          "Customer"}{" "}
                        · <span style={{ color: "#475569" }}>{q.creator}</span>
                      </td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 600,
                            background:
                              q.status === "DRAFT"
                                ? "#fef3c7"
                                : q.status === "ISSUED"
                                  ? "#e0e7ff"
                                  : q.status === "APPROVED"
                                    ? "#dcfce7"
                                    : "#f1f5f9",
                            color:
                              q.status === "DRAFT"
                                ? "#92400e"
                                : q.status === "ISSUED"
                                  ? "#3730a3"
                                  : q.status === "APPROVED"
                                    ? "#166534"
                                    : "#475569",
                          }}
                        >
                          {q.status}
                        </span>
                      </td>
                      <td>
                        {q.pricing}/{q.pricingAssigned}
                      </td>
                      <td>
                        {q.collection}/{q.collectionAssigned}
                      </td>
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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              margin: "12px 0 16px 0",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {!documentId && (
              <button
                onClick={() => {
                  setCurrent("");
                  setDoc(undefined);
                  setSelected([]);
                  setVersion(undefined);
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  fontWeight: 500,
                }}
              >
                ← Back to all documents
              </button>
            )}
            <button
              onClick={() => {
                void load(current, ownerFilter, statusFilter);
                setContextRefresh((n) => n + 1);
              }}
              disabled={busy}
              style={{ padding: "6px 14px", borderRadius: 6, fontWeight: 500 }}
            >
              {busy ? "Refreshing..." : "Refresh document"}
            </button>
          </div>

          <SharedQuotation documentId={current || undefined}/>
          {doc && (
            <>
              <h3>
                {doc.number} ·{" "}
                <span style={{ fontSize: "0.85em", color: "#64748b" }}>
                  {doc.status}
                </span>
              </h3>
              <div
                style={{
                  padding: 12,
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                }}
              >
                {doc.canOverride && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt(
                        "Administrator override reason (valid for 15 minutes)",
                      );
                      if (reason) void command({ action: "override", reason });
                    }}
                  >
                    Administrator override
                  </button>
                )}
                {doc.handoverPending && (
                  <p role="status">
                    Handover pending synchronization. Document changes are
                    locked.
                  </p>
                )}
                {!context ? (
                  <p>Checking ERP branch and mapping…</p>
                ) : context.error ? (
                  <div role="alert">
                    <p>{context.error}</p>
                    <p style={{ fontSize: 13, color: "#64748b" }}>
                      Your saved mappings and prices are preserved. The ERP
                      staff directory has not loaded.
                    </p>
                    {context.diagnostic?.code === "ENDPOINT_REQUIRED" && (
                      <p style={{ fontSize: 13 }}>
                        In Admin → Integrations / Connected Apps, save ERP’s
                        Integration Ingress URL and run Test connection.
                      </p>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => setContextRefresh((n) => n + 1)}
                    >
                      Retry staff loading
                    </button>
                  </div>
                ) : (
                  <>
                    <label>
                      Working ERP branch{" "}
                      <select
                        aria-label="Working ERP branch"
                        value={context.branchId}
                        disabled={
                          busy ||
                          context.branchLocked ||
                          context.branches.length < 2 ||
                          !doc.canAssign
                        }
                        onChange={(e) => {
                          setSelected([]);
                          setVersion(undefined);
                          setWorkflowVersion(undefined);
                          void command({
                            action: "branch",
                            branchId: e.target.value,
                            version: doc.version,
                            workflowVersion: doc.workflowVersion,
                          });
                        }}
                      >
                        {context.branches.map((b: any) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p>
                      {context.branchLocked
                        ? "Branch locked: assignments already queued."
                        : "Branch defaults from the creator’s ERP mapping."}
                    </p>
                    <p>
                      Connection: authenticated · User mapping: ready · Branch
                      access: authorized · Eligible staff: {staff.length}
                    </p>
                    {(!context.readiness.creatorWhatsApp ||
                      !context.readiness.assignerWhatsApp ||
                      staff.some((s) => !s.phoneConfigured)) && (
                      <p>
                        Some WhatsApp numbers are missing. App jobs remain
                        available; configure numbers in ERP.
                      </p>
                    )}
                    {!staff.length && (
                      <p role="alert">
                        No eligible staff in this branch. Ask the ERP
                        administrator to configure workflow roles.
                      </p>
                    )}
                  </>
                )}
              </div>
              <p style={{ fontSize: 13, color: "#64748b" }}>
                Creator: <strong>{doc.creator?.name}</strong> ·{" "}
                <code>{doc.creator?.reference || "Reference pending"}</code>
              </p>
              {doc.status !== "DRAFT" && (
                <CollectionOrders
                  doc={doc}
                  selected={selected}
                  quantities={quantities}
                  command={command}
                  orderId={orderId}
                  onOrder={(id) => {
                    setOrderId(id);
                    const order = doc.collectionOrders?.find(
                      (o: any) => o.id === id,
                    );
                    if (order) setQuantities({ ...order.quantities });
                  }}
                  busy={busy}
                />
              )}
              <p style={{ fontWeight: 500 }}>
                {doc.status !== "DRAFT"
                  ? "Quotation issued. Create a collection order, assign pickups, then confirm delivery in ERP."
                  : doc.ready
                    ? "All supplier prices ready for review. Finalize from the quotation screen."
                    : "Pricing or review remains pending."}
              </p>
              {doc.failures.map((f: any) => (
                <p
                  key={f.id}
                  role="status"
                  style={{ color: "#b91c1c", fontSize: 14 }}
                >
                  {f.state === "SENDING" ? "Pending ERP sync" : f.state}:{" "}
                  {f.error || "Waiting for ERP acknowledgement"}
                </p>
              ))}

              <div style={{ overflowX: "auto", margin: "16px 0" }}>
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
                            onChange={(e) => {
                              if (!selected.length) {
                                setVersion(doc.version);
                                setWorkflowVersion(doc.workflowVersion);
                              }
                              setSelected(
                                e.target.checked
                                  ? [...selected, l.id]
                                  : selected.filter((id) => id !== l.id),
                              );
                            }}
                          />
                        </td>
                        <td>
                          <strong>{l.partNumber}</strong> · {l.description}
                          <br />
                          <small style={{ color: "#64748b" }}>{l.unit}</small>
                        </td>
                        <td>
                          {doc.status === "DRAFT" ? (
                            l.quantity
                          ) : (
                            <input
                              aria-label={`Collect quantity for ${l.description}`}
                              type="number"
                              min="0.000001"
                              step="any"
                              max={l.quantity}
                              value={quantities[l.id] ?? l.quantity}
                              onChange={(e) =>
                                setQuantities({
                                  ...quantities,
                                  [l.id]: e.target.value,
                                })
                              }
                            />
                          )}
                        </td>
                        <td>
                          {["PRICING", "COLLECTION"].map(
                            (kind) =>
                              l.jobs[kind] && (
                                <div key={kind} style={{ marginBottom: 6 }}>
                                  <strong>{kind}</strong>: {l.jobs[kind].status}{" "}
                                  ·{" "}
                                  {staff.find(
                                    (s) => s.id === l.jobs[kind].owner,
                                  )?.name ||
                                    l.jobs[kind].ownerName ||
                                    l.workflowCost?.actorName ||
                                    "Assigned staff"}
                                  <br />
                                  {l.jobs[kind].blocker && (
                                    <span style={{ color: "#b91c1c" }}>
                                      {l.jobs[kind].blocker}
                                      <br />
                                    </span>
                                  )}
                                  <small style={{ color: "#64748b" }}>
                                    {l.jobs[kind].shops} · {l.jobs[kind].notes}
                                  </small>
                                  {l.jobs[kind].movements?.map((m: any) => (
                                    <div key={m.id} style={{ fontSize: 12 }}>
                                      {m.type} {m.quantity} · supplier{" "}
                                      {m.supplierName || m.supplier} ·{" "}
                                      {m.evidence}
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
                                {l.workflowCost.cost} {l.workflowCost.currency}/
                                {l.workflowCost.unit}
                              </span>
                              <br />
                              <small style={{ color: "#64748b" }}>
                                Price updated by {l.workflowCost.actorName} ·{" "}
                                {new Date(
                                  l.workflowCost.updatedAt,
                                ).toLocaleString()}
                              </small>
                              {l.workflowCost.stale && (
                                <strong style={{ color: "#b91c1c" }}>
                                  {" "}
                                  · Product changed: reconfirm cost
                                </strong>
                              )}
                              {false && l.margin !== null && (
                                <div style={{ fontSize: 12, color: "#047857" }}>
                                  Unit margin: {l.margin}
                                </div>
                              )}
                            </>
                          ) : (
                            <span
                              style={{ color: "#64748b", fontStyle: "italic" }}
                            >
                              Pending
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {doc.canAssign && context?.branchId && !context.error && (
                <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void command({
                        action: "assign",
                        eventId: crypto.randomUUID(),
                        kind: doc.status === "DRAFT" ? "PRICING" : "COLLECTION",
                        selected,
                        assignee: f.get("assignee"),
                        shops: f.get("shops"),
                        notes: f.get("notes"),
                        due: f.get("due")
                          ? new Date(String(f.get("due"))).toISOString()
                          : "",
                        noDueReason: f.get("noDueReason"),
                        mode: f.get("mode") || undefined,
                        poNumber: f.get("poNumber") || "",
                        authorized: f.get("authorized") === "on",
                        quantities,
                        orderId,
                      });
                    }}
                    style={{
                      background: "var(--surface-2, #f8fafc)",
                      padding: 16,
                      borderRadius: 8,
                      border: "1px solid var(--border, #e2e8f0)",
                      marginTop: 16,
                    }}
                  >
                    <h3 style={{ margin: "0 0 12px 0" }}>
                      Assign / edit {selected.length} selected products
                    </h3>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(240px, 1fr))",
                        gap: 12,
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          fontWeight: 500,
                          fontSize: 14,
                        }}
                      >
                        Staff:
                        <select
                          required
                          name="assignee"
                          style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid #cbd5e1",
                          }}
                        >
                          <option value="">Choose ERP staff</option>
                          {staff
                            .filter((s) =>
                              (doc.status === "DRAFT"
                                ? ["sales", "pricing", "manager"]
                                : ["sales", "collection", "manager"]
                              ).includes(s.role),
                            )
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                                {s.phoneConfigured
                                  ? ""
                                  : " — WhatsApp number missing"}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          fontWeight: 500,
                          fontSize: 14,
                        }}
                      >
                        Deadline:
                        <input
                          name="due"
                          type="datetime-local"
                          style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid #cbd5e1",
                          }}
                        />
                      </label>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(240px, 1fr))",
                        gap: 12,
                        marginTop: 12,
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          fontWeight: 500,
                          fontSize: 14,
                        }}
                      >
                        Shops to contact:
                        <textarea
                          name="shops"
                          maxLength={10000}
                          rows={2}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid #cbd5e1",
                          }}
                        />
                      </label>
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          fontWeight: 500,
                          fontSize: 14,
                        }}
                      >
                        Instructions:
                        <textarea
                          name="notes"
                          maxLength={10000}
                          rows={2}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid #cbd5e1",
                          }}
                        />
                      </label>
                    </div>

                    <label
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        fontWeight: 500,
                        fontSize: 14,
                        marginTop: 12,
                      }}
                    >
                      If unknown deadline, explain:
                      <input
                        name="noDueReason"
                        maxLength={500}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: "1px solid #cbd5e1",
                        }}
                      />
                    </label>

                    {doc.status !== "DRAFT" && (
                      <p>
                        Uses the selected collection order’s saved authorization
                        and PO reference. Change the planned shop in the order
                        before assignment.
                      </p>
                    )}

                    <div style={{ marginTop: 16 }}>
                      <button
                        disabled={
                          busy ||
                          !selected.length ||
                          (doc.status !== "DRAFT" && !orderId)
                        }
                        style={{
                          padding: "8px 20px",
                          borderRadius: 6,
                          fontWeight: 600,
                        }}
                      >
                        Assign selected products
                      </button>
                    </div>
                  </form>

                  {doc.status === "DRAFT" && selected.length === 1 && (
                    <details
                      style={{
                        marginTop: 16,
                        background: "var(--surface-2, #f8fafc)",
                        padding: 14,
                        borderRadius: 8,
                        border: "1px solid var(--border, #e2e8f0)",
                      }}
                    >
                      <summary style={{ fontWeight: 600, cursor: "pointer" }}>
                        Enter known cost
                      </summary>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          const line = doc.lines.find(
                            (l: any) => l.id === selected[0],
                          );
                          void command({
                            action: "known",
                            lineId: line.id,
                            cost: {
                              cost: f.get("cost"),
                              currency: f.get("currency"),
                              unit: line.unit,
                              supplier: f.get("supplier"),
                              taxBasis: f.get("taxBasis"),
                              availability: f.get("availability"),
                              evidence: f.get("evidence"),
                              leadTime: f.get("leadTime"),
                            },
                          });
                        }}
                        style={{ marginTop: 12 }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(200px, 1fr))",
                            gap: 12,
                          }}
                        >
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                              fontSize: 14,
                              fontWeight: 500,
                            }}
                          >
                            Cost price:
                            <input
                              name="cost"
                              type="number"
                              min="0"
                              step="any"
                              required
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #cbd5e1",
                              }}
                            />
                          </label>
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                              fontSize: 14,
                              fontWeight: 500,
                            }}
                          >
                            Currency:
                            <input
                              name="currency"
                              defaultValue={doc.currency}
                              pattern="[A-Z]{3}"
                              required
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #cbd5e1",
                              }}
                            />
                          </label>
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                              fontSize: 14,
                              fontWeight: 500,
                            }}
                          >
                            Supplier:
                            <input
                              name="supplier"
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #cbd5e1",
                              }}
                            />
                          </label>
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                              fontSize: 14,
                              fontWeight: 500,
                            }}
                          >
                            VAT treatment:
                            <select
                              name="taxBasis"
                              required
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #cbd5e1",
                              }}
                            >
                              <option value="">Choose VAT treatment</option>
                              {[
                                "Excluding VAT",
                                "Including VAT",
                                "No VAT",
                                "Unknown",
                              ].map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                          </label>
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                              fontSize: 14,
                              fontWeight: 500,
                            }}
                          >
                            Availability:
                            <input
                              name="availability"
                              required
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #cbd5e1",
                              }}
                            />
                          </label>
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                              fontSize: 14,
                              fontWeight: 500,
                            }}
                          >
                            Lead time:
                            <input
                              name="leadTime"
                              required
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #cbd5e1",
                              }}
                            />
                          </label>
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                              fontSize: 14,
                              fontWeight: 500,
                            }}
                          >
                            Evidence/reference:
                            <input
                              name="evidence"
                              required
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #cbd5e1",
                              }}
                            />
                          </label>
                        </div>
                        <div style={{ marginTop: 14 }}>
                          <button
                            disabled={busy}
                            style={{
                              padding: "8px 20px",
                              borderRadius: 6,
                              fontWeight: 600,
                            }}
                          >
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
