"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { StoreDialog } from "./StorefrontCheckout";
export default function StoreReceipts({
  t,
  close,
}: {
  t: Translate;
  close: () => void;
}) {
  const [receipts, setReceipts] = useState<any[]>([]),
    [order, setOrder] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      setReceipts(
        JSON.parse(localStorage.getItem("amt-store-receipts") || "[]"),
      );
    } catch {}
  }, []);
  async function open(r: any) {
    setBusy(true);
    setError("");
    try {
      setOrder({
        ...(await api("storefront/orders/" + r.orderId, "POST", {
          verificationToken: r.verificationToken,
        })),
        verificationToken: r.verificationToken,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <StoreDialog title={t("Your orders", "طلباتك")} close={close}>
      {error && (
        <p className="sf-alert" role="alert">
          {error}
        </p>
      )}
      <p>
        {t(
          "Guest receipts saved on this device. Company orders are in the company portal.",
          "إيصالات الضيوف المحفوظة على هذا الجهاز. طلبات الشركات في بوابة الشركة.",
        )}
      </p>
      {receipts.map((r) => (
        <p key={r.orderId}>
          <button disabled={busy} onClick={() => open(r)}>
            {r.orderNumber}
          </button>
        </p>
      ))}
      {order && (
        <article>
          <h3>{order.orderNumber}</h3>
          <p>
            {order.status} · {order.fulfillmentStatus} · SAR{" "}
            {order.totals.total}
          </p>
          <p>
            {order.fulfillment?.carrier} {order.fulfillment?.tracking}
          </p>
          {order.lines.map((l: any) => (
            <p key={l.productId}>
              {l.quantity} × {l.partNumber} · SAR {l.lineTotal}
            </p>
          ))}
          {order.fulfillmentStatus && (
            <form
              className="sf-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const f = new FormData(e.currentTarget);
                try {
                  await api("storefront/returns", "POST", {
                    orderId: order.orderId,
                    verificationToken: order.verificationToken,
                    reason: f.get("reason"),
                    lines: [
                      {
                        productId: f.get("productId"),
                        quantity: f.get("quantity"),
                      },
                    ],
                  });
                  await open(order);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                {t("Return delivered item", "إرجاع منتج تم تسليمه")}
                <select name="productId">
                  {order.lines.map((l: any) => (
                    <option key={l.productId} value={l.productId}>
                      {l.partNumber}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Quantity", "الكمية")}
                <input
                  name="quantity"
                  type="number"
                  min="0.000001"
                  step="any"
                  required
                />
              </label>
              <label>
                {t("Reason", "السبب")}
                <input name="reason" required minLength={3} />
              </label>
              <button disabled={busy}>
                {t("Request return", "طلب إرجاع")}
              </button>
            </form>
          )}
          {order.events.map((e: any, i: number) => (
            <p key={i}>
              {new Date(e.created_at).toLocaleString()} · {e.message}
            </p>
          ))}
        </article>
      )}
    </StoreDialog>
  );
}
