"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";

const doneStatuses = new Set(["DELIVERED", "CANCELLED"]);
const num = (value: unknown) => Number(value || 0);

export default function CollectionOrders({ doc, staff, command, busy }: { doc: any; staff: any[]; command: (body: any) => Promise<boolean | undefined>; busy: boolean }) {
  const [po, setPO] = useState("");
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [deliveryQty, setDeliveryQty] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const orderIds = useRef<Record<string, string>>({});

  useEffect(() => {
    const orderable = doc.presentation?.orderableQuantities || Object.fromEntries(doc.lines.map((line: any) => [line.id, line.quantity]));
    setIncluded(Object.fromEntries(doc.lines.map((line: any) => [line.id, num(orderable[line.id]) > 0])));
    setQuantities(Object.fromEntries(doc.lines.map((line: any) => [line.id, orderable[line.id] || "0"])));
    setSuppliers(Object.fromEntries(doc.lines.map((line: any) => [line.id, line.workflowCost?.supplier || ""])));
  }, [doc.id]);

  const orders = doc.collectionOrders || [];
  const activeOrder = orders.find((order: any) => order.id === doc.presentation?.activeOrderId) || [...orders].reverse().find((order: any) => !doneStatuses.has(doc.orders?.find((state: any) => state.id === order.id)?.status));
  const activeState = activeOrder ? doc.orders?.find((state: any) => state.id === activeOrder.id) : undefined;
  const history = orders.filter((order: any) => order.id !== activeOrder?.id);
  const groups = useMemo(() => {
    if (!activeOrder) return [];
    const grouped = new Map<string, any[]>();
    for (const lineId of Object.keys(activeOrder.quantities || {})) {
      const line = doc.lines.find((candidate: any) => candidate.id === lineId);
      const supplier = activeOrder.suppliers?.[lineId] || line?.workflowCost?.supplier || "Pickup shop required";
      grouped.set(supplier, [...(grouped.get(supplier) || []), line]);
    }
    return [...grouped.entries()].map(([supplier, lines]) => ({ supplier, lines }));
  }, [activeOrder, doc.lines]);

  async function download(order: any, supplier: string, staffId: string, internal = false) {
    try {
      setError("");
      const result = await api("workflow-jobs", "POST", { action: "pickup", documentId: doc.id, orderId: order.id, supplier, staff: staffId, internal });
      const bytes = Uint8Array.from(atob(result.pdf), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); }
  }

  async function createOrder(mode: "ORDER_CONFIRMED" | "EARLY_AUTHORIZED") {
    const selected = doc.lines.filter((line: any) => included[line.id]);
    if (!selected.length) return setError("Select at least one quotation line.");
    const missing = selected.find((line: any) => !String(suppliers[line.id] || "").trim());
    if (missing) return setError(`Add a planned pickup shop for ${missing.partNumber || missing.description}.`);
    setError("");
    const orderId = orderIds.current[mode] ||= crypto.randomUUID();
    const saved = await command({ action: "createOrder", operationKey: `create-order:${mode}`, authorized: true, poNumber: po, order: { id: orderId, mode, quantities: Object.fromEntries(selected.map((line: any) => [line.id, quantities[line.id] || line.quantity])), suppliers: Object.fromEntries(selected.map((line: any) => [line.id, suppliers[line.id]])) } });
    if (saved) delete orderIds.current[mode];
  }

  return <section style={{ marginTop: 18 }}>
    {error && <p role="alert" style={{ color: "#991b1b" }}>{error}</p>}

    {!activeOrder && ["CUSTOMER_ORDER", "CLOSED"].includes(doc.presentation?.stage) && Object.keys(doc.presentation?.orderableQuantities || {}).length > 0 && doc.canAssign && <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>{doc.presentation?.stage === "CLOSED" ? "Additional customer order" : "Customer confirmed"}</h3>
      <p>All quotation lines and full quantities are selected. Reduce or remove anything the customer did not order.</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Include</th><th>Item</th><th>Ordered quantity</th><th>Planned pickup shop</th></tr></thead><tbody>{doc.lines.map((line: any) => <tr key={line.id}>
        <td><input aria-label={`Include ${line.description}`} type="checkbox" checked={!!included[line.id]} onChange={(e) => setIncluded({ ...included, [line.id]: e.target.checked })} /></td>
        <td><strong>{line.partNumber || line.description}</strong><small style={{ display: "block" }}>{line.description}</small></td>
        <td><input aria-label={`Ordered quantity for ${line.description}`} type="number" min="0.000001" step="any" max={line.quantity} disabled={!included[line.id]} value={quantities[line.id] || ""} onChange={(e) => setQuantities({ ...quantities, [line.id]: e.target.value })} /> {line.unit}</td>
        <td><input aria-label={`Pickup shop for ${line.description}`} disabled={!included[line.id]} value={suppliers[line.id] || ""} onChange={(e) => setSuppliers({ ...suppliers, [line.id]: e.target.value })} /></td>
      </tr>)}</tbody></table></div>
      <label>Customer PO / reference (optional)<input value={po} onChange={(e) => setPO(e.target.value)} /></label>
      <button className="primary" type="button" disabled={busy} onClick={() => void createOrder("ORDER_CONFIRMED")}>Customer confirmed — create collection list</button>
    </div>}

    {activeOrder && <div className="card" style={{ padding: 16 }}>
      <div className="section-title"><div><h3 style={{ margin: 0 }}>{activeState?.number || "Collection list syncing to ERP"}</h3><small>{activeState?.status?.replaceAll("_", " ") || "Pending ERP synchronization"} · {activeOrder.poNumber || "No customer reference"}</small></div></div>

      {doc.presentation?.stage === "ASSIGN_COLLECTION" && doc.canAssign && <div>
        <h4>Assign collection by supplier</h4>
        <p>Choose one collector for each pickup shop. Successful groups stay assigned if another group needs a retry.</p>
        {groups.map((group) => {
          const jobs = group.lines.map((line: any) => line.jobs?.collections?.[activeOrder.id]).filter(Boolean);
          const assigned = jobs.length === group.lines.length;
          return <form key={group.supplier} onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void command({ action: "assign", operationKey: `collection:${activeOrder.id}:${group.supplier}`, kind: "COLLECTION", selected: group.lines.map((line: any) => line.id), assignee: form.get("assignee"), shops: group.supplier, notes: form.get("notes"), due: form.get("due") ? new Date(String(form.get("due"))).toISOString() : "", noDueReason: form.get("due") ? "" : "No deadline supplied", quantities: activeOrder.quantities, orderId: activeOrder.id });
          }} style={{ border: "1px solid var(--border, #dbe3ec)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <strong>{group.supplier}</strong> · {group.lines.length} item{group.lines.length === 1 ? "" : "s"}
            {assigned ? <p role="status">Assigned to {jobs[0]?.ownerName || "collector"}</p> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginTop: 10 }}>
              <label>Collector<select name="assignee" required defaultValue=""><option value="">Choose collector</option>{staff.filter((person) => ["sales", "collection", "manager"].includes(person.role)).map((person) => <option key={person.id} value={person.id}>{person.name}{person.phoneConfigured ? "" : " — WhatsApp unavailable"}</option>)}</select></label>
              <label>Deadline (optional)<input name="due" type="datetime-local" /></label>
              <label>Instructions (optional)<input name="notes" maxLength={10000} /></label>
              <button className="primary" disabled={busy}>Assign collector</button>
            </div>}
          </form>;
        })}
      </div>}

      {activeState && <>
        <h4>Collection progress</h4>
        <div style={{ overflowX: "auto" }}><table><thead><tr><th>Item</th><th>Supplier</th><th>Ordered</th><th>Collected</th><th>Remaining</th><th>Delivered</th><th>Available</th></tr></thead><tbody>{activeState.lines.map((line: any) => <tr key={line.lineId}><td><strong>{line.partNumber || line.description}</strong></td><td>{line.supplier || "Shop pending"}</td><td>{line.quantity} {line.unit}</td><td>{line.collected} {line.unit}</td><td>{line.outstanding} {line.unit}</td><td>{line.delivered} {line.unit}</td><td>{line.availableToDeliver} {line.unit}</td></tr>)}</tbody></table></div>

        {activeState.lines.some((line: any) => num(line.availableToDeliver) > 0) && doc.canAssign && <form onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const selected = activeState.lines.filter((line: any) => form.get(`use:${line.lineId}`) === "on");
          if (!selected.length) return setError("Select at least one available item.");
          void command({ action: "orderAction", operation: "orderDelivered", operationKey: `delivery:${activeOrder.id}`, orderId: activeOrder.id, selected: selected.map((line: any) => line.lineId), quantities: Object.fromEntries(selected.map((line: any) => [line.lineId, deliveryQty[line.lineId] || line.availableToDeliver])), deliveryDate: form.get("deliveryDate"), invoiceNumber: form.get("invoiceNumber"), deliveryNumber: form.get("deliveryNumber"), receivedConfirmed: true });
        }} style={{ marginTop: 16 }}>
          <h4>Confirm delivery</h4>
          {activeState.lines.filter((line: any) => num(line.availableToDeliver) > 0).map((line: any) => <label key={line.lineId} style={{ display: "grid", gridTemplateColumns: "auto minmax(180px,1fr) 150px", gap: 8, alignItems: "center", margin: "7px 0" }}><input name={`use:${line.lineId}`} type="checkbox" defaultChecked /><span>{line.partNumber || line.description}</span><span><input aria-label={`Delivery quantity for ${line.partNumber || line.description}`} type="number" min="0.000001" step="any" max={line.availableToDeliver} value={deliveryQty[line.lineId] ?? line.availableToDeliver} onChange={(e) => setDeliveryQty({ ...deliveryQty, [line.lineId]: e.target.value })} /> {line.unit}</span></label>)}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><label>Delivery date<input name="deliveryDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Invoice number<input name="invoiceNumber" /></label><label>Delivery number<input name="deliveryNumber" /></label></div>
          <p><small>Enter at least one invoice or delivery number. This posts to the same ERP delivery record used by the ERP screen.</small></p>
          <button className="primary" disabled={busy}>Confirm delivery</button>
        </form>}

        <div style={{ marginTop: 14 }}>{[...new Map(activeState.lines.flatMap((line: any) => {
          const job = doc.lines.find((item: any) => item.id === line.lineId)?.jobs?.collections?.[activeOrder.id];
          return job?.owner ? [[`${line.supplier}|${job.owner}`, { supplier: line.supplier, staffId: job.owner, staffName: job.ownerName || "collector" }]] : [];
        })).values()].map((entry: any) => <button key={`${entry.supplier}:${entry.staffId}`} type="button" disabled={busy} onClick={() => void download(activeOrder, entry.supplier, entry.staffId)}>Download {entry.supplier} pickup PDF · {entry.staffName}</button>)}</div>
      </>}
    </div>}

    {history.length > 0 && <details style={{ marginTop: 14 }}><summary>Completed and older collection lists ({history.length})</summary>{history.map((order: any) => { const state = doc.orders?.find((snapshot: any) => snapshot.id === order.id); return <p key={order.id}><strong>{state?.number || "Pending ERP sync"}</strong> · {state?.status?.replaceAll("_", " ") || order.mode.replaceAll("_", " ")}</p>; })}</details>}

    {doc.canAssign && <details style={{ marginTop: 14 }}><summary>Advanced actions</summary>
      {!activeOrder && <button type="button" disabled={busy} onClick={() => void createOrder("EARLY_AUTHORIZED")}>Authorize early collection</button>}
      {activeState && !doneStatuses.has(activeState.status) && <>
        <details><summary>Change planned pickup shops</summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void command({ action: "orderAction", operation: "orderEdit", operationKey: `shops:${activeOrder.id}`, orderId: activeOrder.id, suppliers: Object.fromEntries(activeState.lines.map((line: any) => [line.lineId, String(form.get(line.lineId) || "")])) }); }}>{activeState.lines.map((line: any) => <label key={line.lineId}>{line.partNumber}<input name={line.lineId} required defaultValue={line.supplier} /></label>)}<button disabled={busy}>Save planned shops</button></form></details>
        <button type="button" disabled={busy} onClick={() => { const reason = window.prompt("Reason to cancel remaining work"); if (reason) void command({ action: "orderAction", operation: "orderCancel", operationKey: `cancel:${activeOrder.id}`, orderId: activeOrder.id, reason }); }}>Cancel remaining work</button>
        {activeState.mode === "EARLY_AUTHORIZED" && <button type="button" disabled={busy} onClick={() => { const reference = window.prompt("Customer PO / reference (optional)"); if (reference !== null) void command({ action: "orderAction", operation: "orderConfirm", operationKey: `confirm:${activeOrder.id}`, orderId: activeOrder.id, authorized: true, poNumber: reference }); }}>Confirm customer order</button>}
        <button type="button" disabled={busy} onClick={() => void download(activeOrder, "", "", true)}>Internal pickup PDF</button>
      </>}
      {doc.failures?.length > 0 && <div><h4>Synchronization diagnostics</h4>{doc.failures.map((failure: any) => <p key={failure.id}>{failure.endpoint}: {failure.error || failure.state}</p>)}</div>}
    </details>}
  </section>;
}
