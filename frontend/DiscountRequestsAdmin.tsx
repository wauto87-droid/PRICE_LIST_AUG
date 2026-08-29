"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import type { AdminActionRunner } from "./admin-actions";
import HistoryDetails from "./HistoryDetails";

type RequestList = {
  items: any[];
  counts: { pending: number; approved: number; rejected: number };
};

const emptyList: RequestList = {
  items: [],
  counts: { pending: 0, approved: 0, rejected: 0 },
};

export default function DiscountRequestsAdmin({
  t,
  actionBusy,
  onAction,
}: {
  t: Translate;
  actionBusy: boolean;
  onAction: AdminActionRunner;
}) {
  const [data, setData] = useState<RequestList>(emptyList),
    [detail, setDetail] = useState<any>(null),
    [statusFilter, setStatusFilter] = useState("PENDING"),
    [decisionNote, setDecisionNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);

  async function load(selectedId?: string) {
    setError("");
    setBusy(true);
    try {
      const next = await api<RequestList>("discount-requests");
      setData(next);
      const keepSelectedId =
        selectedId ??
        (detail && next.items.some((item) => item.id === detail.id)
          ? detail.id
          : "");
      if (keepSelectedId) {
        const full = await api("discount-requests/" + keepSelectedId);
        setDetail(full);
        setDecisionNote(
          full.status === "PENDING" ? "" : (full.decisionNote ?? ""),
        );
      } else {
        setDetail(null);
        setDecisionNote("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setError("");
    setBusy(true);
    try {
      const full = await api("discount-requests/" + id);
      setDetail(full);
      setDecisionNote(full.status === "PENDING" ? "" : (full.decisionNote ?? ""));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const items =
    statusFilter === "ALL"
      ? data.items
      : data.items.filter((item) => item.status === statusFilter);

  return (
    <>
      <div className="section-title">
        <div>
          <h2>{t("Discount Requests", "طلبات الخصم")}</h2>
          <p className="muted">
            {t(
              "Review below-minimum requests with recent product pricing and quotation usage before approving or rejecting them.",
              "راجع طلبات الخصم الأقل من الحد الأدنى مع سجل أسعار المنتج واستخدامه في عروض الأسعار قبل الموافقة أو الرفض.",
            )}
          </p>
        </div>
      </div>
      <div className="notice">
        {t("Pending", "معلقة")}: {data.counts.pending} ·{" "}
        {t("Approved", "موافق عليها")}: {data.counts.approved} ·{" "}
        {t("Rejected", "مرفوضة")}: {data.counts.rejected}
      </div>
      <div className="actions wrap">
        {["PENDING", "APPROVED", "REJECTED", "ALL"].map((value) => (
          <button
            key={value}
            type="button"
            className={statusFilter === value ? "primary" : ""}
            disabled={busy || actionBusy}
            onClick={() => setStatusFilter(value)}
          >
            {value === "PENDING"
              ? t("Pending", "معلقة")
              : value === "APPROVED"
                ? t("Approved", "موافق عليها")
                : value === "REJECTED"
                  ? t("Rejected", "مرفوضة")
                  : t("All", "الكل")}
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("Status", "الحالة")}</th>
              <th>{t("Part / request", "الصنف / الطلب")}</th>
              <th>{t("Requested by", "طالب الخصم")}</th>
              <th>{t("Prices", "الأسعار")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                style={{
                  backgroundColor:
                    detail?.id === item.id ? "rgba(15, 23, 42, 0.04)" : undefined,
                  cursor: "pointer",
                }}
                onClick={() => open(item.id)}
              >
                <td>
                  <strong>{item.status}</strong>
                  <small>{new Date(item.createdAt).toLocaleString()}</small>
                </td>
                <td>
                  <strong>{item.partNumber}</strong>
                  <small>{item.productDescription}</small>
                  <small>{item.reason}</small>
                </td>
                <td>{item.requestedBy}</td>
                <td>
                  <strong>
                    {t("Requested", "المطلوب")}: SAR {item.requestedFinalPrice}
                  </strong>
                  <small>
                    {t("Protected", "المحمي")}: SAR {item.protectedPrice}
                  </small>
                  <small>
                    {t("Qty", "الكمية")}: {item.quantity} ·{" "}
                    {t("Discount", "الخصم")}: {item.requestedDiscount}%
                  </small>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={4}>
                  {t(
                    "No requests match this filter yet.",
                    "لا توجد طلبات مطابقة لهذا الفلتر بعد.",
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {detail && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="section-title">
            <div>
              <h2>
                {detail.partNumber} · {detail.status}
              </h2>
              <p className="muted">{detail.productDescription}</p>
            </div>
          </div>
          <div className="notice">
            {t("Requester", "الطالب")}: {detail.requestedBy} ·{" "}
            {t("Level", "المستوى")}: {detail.sellingLevel} ·{" "}
            {t("Quantity", "الكمية")}: {detail.quantity} ·{" "}
            {t("Requested discount", "الخصم المطلوب")}: {detail.requestedDiscount}% ·{" "}
            {t("Requested final", "السعر المطلوب")}: SAR {detail.requestedFinalPrice} ·{" "}
            {t("Protected price", "السعر المحمي")}: SAR {detail.protectedPrice}
          </div>
          <div className="notice warning">
            {t("Reason", "السبب")}: {detail.reason}
            {detail.decisionNote
              ? ` · ${t("Decision note", "ملاحظة القرار")}: ${detail.decisionNote}`
              : ""}
          </div>
          {detail.status === "PENDING" && (
            <div className="actions wrap">
              <label className="grow">
                {t("Decision note", "ملاحظة القرار")}
                <textarea
                  rows={3}
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  placeholder={t(
                    "Required note for approval or rejection",
                    "ملاحظة مطلوبة للموافقة أو الرفض",
                  )}
                />
              </label>
              <button
                className="primary"
                disabled={busy || actionBusy || !decisionNote.trim()}
                onClick={() =>
                  onAction(
                    {
                      saving: t("Approving request…", "جارٍ اعتماد الطلب…"),
                      success: t("Request approved", "تم اعتماد الطلب"),
                      successDetail: t(
                        "The approval and decision note were saved.",
                        "تم حفظ الموافقة وملاحظة القرار.",
                      ),
                      error: t(
                        "Request could not be approved",
                        "تعذر اعتماد الطلب",
                      ),
                    },
                    async () => {
                      await api("discount-requests/" + detail.id + "/approve", "POST", {
                        note: decisionNote,
                      });
                      await load(detail.id);
                    },
                  )
                }
              >
                {t("Approve", "موافقة")}
              </button>
              <button
                disabled={busy || actionBusy || !decisionNote.trim()}
                onClick={() =>
                  onAction(
                    {
                      saving: t("Rejecting request…", "جارٍ رفض الطلب…"),
                      success: t("Request rejected", "تم رفض الطلب"),
                      successDetail: t(
                        "The rejection and decision note were saved.",
                        "تم حفظ الرفض وملاحظة القرار.",
                      ),
                      error: t("Request could not be rejected", "تعذر رفض الطلب"),
                    },
                    async () => {
                      await api("discount-requests/" + detail.id + "/reject", "POST", {
                        note: decisionNote,
                      });
                      await load(detail.id);
                    },
                  )
                }
              >
                {t("Reject", "رفض")}
              </button>
            </div>
          )}
          <h3>{t("Recent product history", "سجل المنتج الحديث")}</h3>
          <div className="table-scroll">
            <table>
              <tbody>
                {detail.history.map((row: any) => (
                  <tr key={row.id}>
                    <td>{new Date(row.created_at).toLocaleString()}</td>
                    <td>{row.actor || t("System", "النظام")}</td>
                    <td>
                      <HistoryDetails row={row} t={t} />
                    </td>
                  </tr>
                ))}
                {!detail.history.length && (
                  <tr>
                    <td colSpan={3}>
                      {t(
                        "No recent price history for this product.",
                        "لا يوجد سجل أسعار حديث لهذا المنتج.",
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <h3>{t("Recent quotation usage", "استخدامات عروض الأسعار الحديثة")}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("Quotation", "عرض السعر")}</th>
                  <th>{t("Customer / owner", "العميل / المسؤول")}</th>
                  <th>{t("Line pricing", "تسعير السطر")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.quotations.map((row: any) => (
                  <tr key={row.id + row.updated_at}>
                    <td>
                      <strong>{row.number}</strong>
                      <small>{row.status}</small>
                      <small>{new Date(row.updated_at).toLocaleString()}</small>
                    </td>
                    <td>
                      {row.customer_name || t("Walk-in / not set", "عميل مباشر / غير محدد")}
                      <small>{row.owner}</small>
                    </td>
                    <td>
                      {t("Final", "النهائي")}: SAR {row.final_price || "0.00"}
                      <small>
                        {t("Qty", "الكمية")}: {row.quantity || "—"} ·{" "}
                        {t("Discount", "الخصم")}: {row.effective_discount || "0"}%
                      </small>
                    </td>
                  </tr>
                ))}
                {!detail.quotations.length && (
                  <tr>
                    <td colSpan={3}>
                      {t(
                        "This product has no recent quotation usage.",
                        "هذا المنتج ليس له استخدام حديث في عروض الأسعار.",
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <h3>{t("Request history", "سجل الطلب")}</h3>
          <div className="table-scroll">
            <table>
              <tbody>
                {detail.events.map((event: any) => (
                  <tr key={event.id}>
                    <td>{new Date(event.created_at).toLocaleString()}</td>
                    <td>{event.action}</td>
                    <td>{event.actor || t("System", "النظام")}</td>
                    <td>{event.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {error && <div className="notice error">{error}</div>}
    </>
  );
}
