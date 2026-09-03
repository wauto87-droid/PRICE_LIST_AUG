"use client";
import { levelLabel } from "./levels";
import { useEffect, useState, useRef } from "react";
import { api, type Translate } from "./api";
import { showConfirm } from "./confirm";
import { appPath } from "../shared/paths";
import QuotationTemplates from "./QuotationTemplates";
export default function Quotations({
  t,
  onOpen,
  user,
  cart,
  onUseTemplate,
}: {
  t: Translate;
  onOpen: (q: any) => void;
  user: any;
  cart: any;
  onUseTemplate: (cart: any, message?: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [review, setReview] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pdf, setPdf] = useState<any>(null);
  const [filters, setFilters] = useState({
    q: "",
    status: "",
    from: "",
    to: "",
    scope: "mine",
  });
  const searchGeneration = useRef(0);
  const totalQuantity = selected?.lines.reduce(
    (sum: number, line: any) => sum + Number(line.price?.quantity ?? 0),
    0,
  );
  const formatQuantity = (value: number) =>
    value.toFixed(3).replace(/\.?(?:0+)$/, "");
  const load = () => {
    const generation = ++searchGeneration.current;
    return api(
      "quotations?" +
        new URLSearchParams(Object.entries(filters).filter(([, v]) => v)),
    )
      .then((value) => {
        if (generation === searchGeneration.current) {
          setRows(value);
          setError("");
        }
      })
      .catch((e) => {
        if (generation === searchGeneration.current) setError(e.message);
      });
  };
  useEffect(() => {
    load();
  }, []);
  async function action(fn: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!pdf || ["DONE", "FAILED"].includes(pdf.status)) return;
    const timer = setInterval(
      () =>
        api("documents/" + pdf.id)
          .then(setPdf)
          .catch((e) => setError(e.message)),
      1500,
    );
    return () => clearInterval(timer);
  }, [pdf]);
  return (
    <section className="card">
      <div className="section-title">
        <div>
          <div className="eyebrow">AMT ELECTRIC</div>
          <h2>{t("Quotations", "عروض الأسعار")}</h2>
        </div>
        <button onClick={load}>{t("Refresh", "تحديث")}</button>
      </div>
      <QuotationTemplates t={t} cart={cart} onUse={onUseTemplate} />
      <form
        className="form-grid three"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label>
          {t("Quotation number / prefix", "رقم عرض السعر")}
          <input
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
        </label>
        <label>
          {t("Status", "الحالة")}
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">All / الكل</option>
            <option>DRAFT</option>
            <option>ISSUED</option>
          </select>
        </label>
        <label>
          {t("From", "من")}
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </label>
        <label>
          {t("To", "إلى")}
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </label>
        {user.permissions.includes("QUOTE_VIEW_ALL") && (
          <label>
            {t("Scope", "النطاق")}
            <select
              value={filters.scope}
              onChange={(e) =>
                setFilters({ ...filters, scope: e.target.value })
              }
            >
              <option value="mine">My quotations / عروضي</option>
              <option value="all">All quotations / جميع العروض</option>
            </select>
          </label>
        )}
        <button type="submit">{t("Search", "بحث")}</button>
      </form>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("Number", "الرقم")}</th>
              <th>{t("Customer", "العميل")}</th>
              <th>{t("Status", "الحالة")}</th>
              <th>{t("Total", "الإجمالي")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id}>
                <td>
                  <strong>{q.number}</strong>
                  <small>{new Date(q.created_at).toLocaleDateString()}</small>
                </td>
                <td>
                  {q.customer.name ||
                    q.customer.number ||
                    t("Walk-in Customer", "عميل نقدي")}
                </td>
                <td>
                  <span
                    className={
                      "pill " + (q.status === "ISSUED" ? "success" : "")
                    }
                  >
                    {q.status === "ISSUED"
                      ? t("Issued", "صادر")
                      : t("Draft", "مسودة")}
                  </span>
                </td>
                <td>SAR {q.totals.total}</td>
                <td>
                  <button
                    onClick={() =>
                      action(async () => {
                        setSelected(await api("quotations/" + q.id));
                        setReview(null);
                        setPdf(null);
                      })
                    }
                  >
                    {t("Open", "فتح")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className="empty-state">
          {t(
            "No quotations yet. Start in Lookup.",
            "لا توجد عروض أسعار بعد. ابدأ بالبحث.",
          )}
        </div>
      )}
      {selected && (
        <div className="modal-backdrop">
          <section className="modal">
            <div className="section-title">
              <h2>{selected.number}</h2>
              <button
                onClick={() => {
                  setSelected(null);
                  setReview(null);
                }}
              >
                ×
              </button>
            </div>
            <p>
              {selected.customer.name || t("Walk-in Customer", "عميل نقدي")}
            </p>
            {selected.customer.notes && (
              <div className="notice">
                <strong>{t("Notes", "ملاحظات")}</strong>
                <div>{selected.customer.notes}</div>
              </div>
            )}
            {selected.lines.map((l: any, i: number) => (
              <div className="quote-line" key={i}>
                <span>
                  <strong>{i + 1}. {l.partNumber}</strong>
                  <small>
                    {l.source === "CUSTOM" || l.input?.type === "CUSTOM"
                      ? t("Custom item", "صنف مخصص")
                      : levelLabel(l.input?.sellingLevel ?? l.sellingLevel, t)}
                  </small>
                  <small>{l.description}</small>
                </span>
                <span>
                  {l.price.quantity} × {l.price.finalExcl}
                </span>
                <b>{l.price.total}</b>
              </div>
            ))}
            <p className="text-end">
              {t("Total Quantity", "إجمالي الكمية")}: {formatQuantity(totalQuantity)}
            </p>
            <h3 className="text-end">SAR {selected.totals.total}</h3>
            {review && (
              <div className="review-panel">
                <h3>
                  {t(
                    "Review current prices before issuing",
                    "راجع الأسعار الحالية قبل الإصدار",
                  )}
                </h3>
                <p>
                  {t(
                    "The current product prices, floors, VAT, and your permissions have been checked.",
                    "تم التحقق من أسعار الأصناف والحدود الدنيا والضريبة وصلاحياتك.",
                  )}
                </p>
                {review.after.map((l: any, i: number) => (
                  <div className="quote-line" key={i}>
                    <strong>{l.partNumber}</strong>
                    <small>
                      {l.source === "CUSTOM" || l.input?.type === "CUSTOM"
                        ? t("Custom item", "صنف مخصص")
                        : levelLabel(
                            l.input?.sellingLevel ?? l.sellingLevel,
                            t,
                          )}
                    </small>
                    <span>
                      {review.before.lines[i].price.finalExcl} →{" "}
                      {l.price.finalExcl}
                    </span>
                  </div>
                ))}
                <p>
                  {t("New total", "الإجمالي الجديد")}: SAR {review.totals.total}
                </p>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      const q = await api(
                        "quotations/" + selected.id + "/issue",
                        "POST",
                        { token: review.token },
                      );
                      setSelected(q);
                      setReview(null);
                    })
                  }
                >
                  {t(
                    "Accept prices and issue quotation",
                    "قبول الأسعار وإصدار العرض",
                  )}
                </button>
              </div>
            )}
            <small className="muted">
              {t("Internal reference", "المرجع الداخلي")}: {selected.internalReference}
            </small>
            <div className="actions wrap">
              {selected.status === "DRAFT" && (
                <>
                  <button disabled={busy} onClick={() => onOpen(selected)}>
                    {t("Edit quotation", "تعديل عرض السعر")}
                  </button>
                  {user.permissions.includes("QUOTE_ISSUE") && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        action(async () =>
                          setReview(
                            await api(
                              "quotations/" + selected.id + "/review",
                              "POST",
                              {},
                            ),
                          ),
                        )
                      }
                    >
                      {t("Review & issue", "مراجعة وإصدار")}
                    </button>
                  )}
                </>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  action(async () =>
                    onOpen(
                      await api(
                        "quotations/" + selected.id + "/duplicate",
                        "POST",
                        {},
                      ),
                    ),
                  )
                }
              >
                {t("Duplicate", "نسخ")}
              </button>
              <a
                className="button"
                href={appPath("/api/v1/quotations/" + selected.id + "/print")}
                target="_blank"
                rel="noreferrer"
              >
                {t("Print view", "عرض الطباعة")}
              </a>
              <button
                disabled={busy}
                onClick={() =>
                  action(async () =>
                    setPdf(
                      await api(
                        "quotations/" + selected.id + "/pdf",
                        "POST",
                        {},
                      ),
                    ),
                  )
                }
              >
                {t("Generate PDF", "إنشاء PDF")}
              </button>
              {selected.status === "DRAFT" &&
                user.permissions.includes("QUOTE_DELETE") && (
                  <button
                    className="danger"
                    onClick={async () => {
                      if (
                        await showConfirm(
                          t("Delete this draft?", "حذف هذه المسودة؟"),
                        )
                      )
                        action(async () => {
                          await api("quotations/" + selected.id, "DELETE");
                          setSelected(null);
                        });
                    }}
                  >
                    {t("Delete", "حذف")}
                  </button>
                )}
            </div>
            {pdf &&
              (pdf.status === "DONE" ? (
                <a
                  className="button primary"
                  href={appPath("/api/v1/documents/" + pdf.id + "/download")}
                >
                  {t("Download PDF", "تنزيل PDF")}
                </a>
              ) : (
                <div className="notice">
                  {pdf.status === "FAILED"
                    ? pdf.error
                    : t(
                        "Preparing PDF in background…",
                        "جارٍ تجهيز PDF في الخلفية…",
                      )}
                </div>
              ))}
            {error && <div className="notice error">{error}</div>}
          </section>
        </div>
      )}
    </section>
  );
}
