import type { Translate } from "./api";

type Props = { line: any; visible: boolean; currency?: string; compact?: boolean; t: Translate };

export default function WorkflowCostReference({
  line,
  visible,
  currency = "SAR",
  t,
  compact = false,
}: Props) {
  if (!visible) return null;
  const cost = line.workflowCost;
  const style = {
    display: "block",
    fontSize: "0.8rem",
    lineHeight: 1.5,
    overflowWrap: "anywhere" as const,
    marginTop: "0.35rem",
  };
  if (line.workflowPricing?.status === "SKIPPED" && !line.workflowPricing.stale)
    return (
      <div style={style}>{t("Cost not requested", "لم يتم طلب التكلفة")}</div>
    );
  if (!cost || !/^\d+(?:\.\d+)?$/.test(String(cost.cost ?? "")))
    return <div style={style}>{t("Cost pending", "التكلفة قيد الانتظار")}</div>;
  const date = new Date(cost.updatedAt);
  const dateText = Number.isNaN(date.getTime())
    ? t("Date not recorded", "التاريخ غير مسجل")
    : date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric", hour: "2-digit", minute: "2-digit",
      });
  const unit = line.unit || line.input?.unit;
  const tax = String(cost.taxBasis || "");
  const taxText =
    tax === "Excluding VAT"
      ? t("Excluding VAT", "غير شامل الضريبة")
      : tax === "Including VAT"
        ? t("Including VAT", "شامل الضريبة")
        : tax === "No VAT"
          ? t("No VAT", "بدون ضريبة")
          : t("Tax basis not confirmed", "أساس الضريبة غير مؤكد");
  if (compact) {
    const summary = `${cost.currency} ${String(cost.cost)}/${cost.unit} · ${cost.actorName || t("Staff", "الموظف")} · ${dateText}`;
    const warnings = [cost.stale ? t("Product changed — reconfirm cost", "تغير المنتج — أعد تأكيد التكلفة") : "", cost.currency !== currency ? t("Different currency", "عملة مختلفة") : "", unit && cost.unit !== unit ? t("Different unit", "وحدة مختلفة") : ""].filter(Boolean).join(" · ");
    return <details className="quotation-workflow-cost quotation-workflow-cost-compact"><summary title={`${summary} · ${cost.supplier || ''} · ${taxText}${warnings ? ' · '+warnings : ''}`}>{summary}{warnings && <span className="sales-check-error"> · {warnings}</span>}</summary>
      <div className="quotation-cost-expanded"><WorkflowCostReference line={line} visible={visible} currency={currency} t={t}/></div>
    </details>;
  }
  return (
    <div className="quotation-workflow-cost" style={style}>
      <strong style={{ color: "#b91c1c" }}>
        {t("Cost price", "سعر التكلفة")}: {cost.currency} {String(cost.cost)}/
        {cost.unit} · {taxText}
      </strong>
      <small style={{ display: "block" }}>{t("Supplier", "المورد")}: {cost.supplier || t("Not recorded", "غير مسجل")}</small>
      <span style={{ display: "block" }}>
        {t("Updated by", "تم التحديث بواسطة")}{" "}
        {cost.actorName || t("Staff", "الموظف")} · {dateText}
      </span>
      {cost.stale && (
        <strong style={{ display: "block", color: "#b91c1c" }}>
          {t(
            "Product changed — reconfirm cost",
            "تغير المنتج — أعد تأكيد التكلفة",
          )}
        </strong>
      )}
      {cost.currency !== currency && (
        <span style={{ display: "block", color: "#b45309" }}>
          {t(
            "Different currency — review before comparing",
            "عملة مختلفة — راجع قبل المقارنة",
          )}
          : {cost.currency} / {currency}
        </span>
      )}
      {unit && cost.unit !== unit && (
        <span style={{ display: "block", color: "#b45309" }}>
          {t(
            "Different unit — conversion needs confirmation",
            "وحدة مختلفة — يجب تأكيد التحويل",
          )}
          : {cost.unit} / {unit}
        </span>
      )}
      <details>
        <summary style={{ cursor: "pointer" }}>
          {t("Cost details", "تفاصيل التكلفة")}
        </summary>
        <div>
          {t("Supplier", "المورد")}:{" "}
          {cost.supplier || t("Not recorded", "غير مسجل")}
        </div>
        <div>
          {t("Updated by", "تم التحديث بواسطة")}:{" "}
          {cost.actorName || t("Staff", "الموظف")}
        </div>
        <div>
          {t("Updated", "تم التحديث")}:{" "}
          {Number.isNaN(date.getTime()) ? dateText : date.toLocaleString()}
        </div>
        {tax && !["Excluding VAT", "Including VAT", "No VAT"].includes(tax) && (
          <div>
            {t("Recorded tax basis", "أساس الضريبة المسجل")}: {tax}
          </div>
        )}
      </details>
    </div>
  );
}
