"use client";
import { useState } from "react";
import { api } from "./api";
export default function CollectionOrders({
  doc,
  selected,
  quantities,
  command,
  orderId,
  onOrder,
  busy,
}: {
  doc: any;
  selected: string[];
  quantities: Record<string, string>;
  command: (body: any) => Promise<boolean | undefined>;
  orderId: string;
  onOrder: (id: string) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState("ORDER_CONFIRMED"),
    [po, setPO] = useState(""),
    [suppliers, setSuppliers] = useState<Record<string, string>>({}),
    [authorized, setAuthorized] = useState(false),
    [error, setError] = useState("");
  const orders = doc.collectionOrders || [];
  async function download(
    order: any,
    supplier: string,
    staff: string,
    internal: boolean,
  ) {
    try {
      setError("");
      const result = await api("workflow-jobs", "POST", {
        action: "pickup",
        documentId: doc.id,
        orderId: order.id,
        supplier,
        staff,
        internal,
      });
      const bytes = Uint8Array.from(atob(result.pdf), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="card" style={{ padding: 16, marginTop: 16 }}>
      <h3>Collection orders & pickup lists</h3>
      <p>
        Workflow: <strong>{doc.workflow || "Tracking pending ERP sync"}</strong>
      </p>
      {error && <p role="alert">{error}</p>}
      <label>
        Working order{" "}
        <select value={orderId} onChange={(e) => onOrder(e.target.value)}>
          <option value="">Create or select an order</option>
          {orders.map((o: any) => (
            <option key={o.id} value={o.id}>
              {doc.orders?.find((s: any) => s.id === o.id)?.number ||
                "Pending ERP sync"}{" "}
              · {o.poNumber || o.mode.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      {orders.map((order: any) => {
        const state = doc.orders?.find((s: any) => s.id === order.id);
        const shops = [
          ...new Set<string>(
            (state?.lines || []).map((l: any) => l.supplier).filter(Boolean),
          ),
        ];
        return (
          <article
            key={order.id}
            style={{ borderTop: "1px solid #ddd", padding: "12px 0" }}
          >
            <strong>{state?.number || "Pending ERP sync"}</strong> ·{" "}
            {state?.status?.replaceAll("_", " ") ||
              "Assign collection staff to synchronize"}
            <p>
              {order.mode === "EARLY_AUTHORIZED"
                ? "Early collection authorized — customer order not confirmed"
                : "Customer order confirmed"}{" "}
              · {order.poNumber || "No customer PO reference"}
            </p>
            {state?.lines?.map((l: any) => (
              <div key={l.lineId}>
                {l.partNumber} · {l.quantity} {l.unit} ·{" "}
                {l.supplier || "Shop pending"} · Collected {l.collected} · To
                collect {l.outstanding} · Delivered {l.delivered}
              </div>
            ))}
            {state &&
              doc.canAssign &&
              !["DELIVERED", "CANCELLED"].includes(state.status) && (
                <details>
                  <summary>Change planned pickup shops</summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void command({
                        action: "orderAction",
                        operation: "orderEdit",
                        orderId: order.id,
                        suppliers: Object.fromEntries(
                          state.lines.map((l: any) => [
                            l.lineId,
                            String(f.get(l.lineId) || ""),
                          ]),
                        ),
                      });
                    }}
                  >
                    {state.lines.map((l: any) => (
                      <label
                        key={l.lineId}
                        style={{ display: "block", margin: "8px 0" }}
                      >
                        {l.partNumber}
                        <input
                          name={l.lineId}
                          required
                          defaultValue={l.supplier}
                          style={{ maxWidth: "100%" }}
                        />
                      </label>
                    ))}
                    <button type="submit" disabled={busy}>
                      Save planned shops
                    </button>
                  </form>
                </details>
              )}
            {state &&
              doc.canAssign &&
              !["DELIVERED", "CANCELLED"].includes(state.status) && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt(
                        "Reason to cancel remaining uncollected quantities",
                      );
                      if (reason)
                        void command({
                          action: "orderAction",
                          operation: "orderCancel",
                          orderId: order.id,
                          reason,
                        });
                    }}
                  >
                    Cancel remaining work
                  </button>
                  {state.mode === "EARLY_AUTHORIZED" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const po = window.prompt(
                          "Confirm customer order: PO reference (optional)",
                        );
                        if (po !== null)
                          void command({
                            action: "orderAction",
                            operation: "orderConfirm",
                            orderId: order.id,
                            authorized: true,
                            poNumber: po,
                          });
                      }}
                    >
                      Confirm customer order
                    </button>
                  )}
                </>
              )}
            {state && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void download(order, "", "", true)}
                >
                  Internal pickup PDF
                </button>
                {shops.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => void download(order, s, "", false)}
                  >
                    {s}: supplier pickup PDF
                  </button>
                ))}
              </>
            )}
          </article>
        );
      })}
      {doc.canAssign && (
        <details>
          <summary>
            Create collection order for {selected.length} selected products
          </summary>
          <p>
            Choose products in the table first. Different staff assignments can
            reuse the same order.
          </p>
          <label>
            Collection basis{" "}
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="ORDER_CONFIRMED">Customer order confirmed</option>
              <option value="EARLY_AUTHORIZED">
                Authorize early collection
              </option>
            </select>
          </label>
          <label>
            Customer PO reference{" "}
            <input value={po} onChange={(e) => setPO(e.target.value)} />
          </label>
          {selected.map((id) => {
            const l = doc.lines.find((l: any) => l.id === id);
            return (
              <label key={id} style={{ display: "block", margin: "8px 0" }}>
                {l?.partNumber} · {quantities[id] || l?.quantity} {l?.unit} ·
                Pickup shop{" "}
                <input
                  value={suppliers[id] ?? l?.workflowCost?.supplier ?? ""}
                  onChange={(e) =>
                    setSuppliers((v) => ({ ...v, [id]: e.target.value }))
                  }
                />
              </label>
            );
          })}
          <label>
            <input
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
            />
            I confirm the customer order or authorize early collection for these
            quantities.
          </label>
          <button
            type="button"
            disabled={busy || !authorized || !selected.length}
            onClick={async () => {
              const id = crypto.randomUUID();
              const success = await command({
                action: "createOrder",
                authorized,
                poNumber: po,
                order: {
                  id,
                  mode,
                  quantities: Object.fromEntries(
                    selected.map((id) => [
                      id,
                      quantities[id] ||
                        doc.lines.find((l: any) => l.id === id)?.quantity,
                    ]),
                  ),
                  suppliers: Object.fromEntries(
                    selected.map((id) => [
                      id,
                      suppliers[id] ??
                        doc.lines.find((l: any) => l.id === id)?.workflowCost
                          ?.supplier ??
                        "",
                    ]),
                  ),
                },
              });
              if (success) onOrder(id);
            }}
          >
            Create order
          </button>
        </details>
      )}
    </section>
  );
}
