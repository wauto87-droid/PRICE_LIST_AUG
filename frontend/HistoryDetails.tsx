import type { Translate } from "./api";
import { describeHistory } from "./history-details";
export default function HistoryDetails({ row, t }: { row: any; t: Translate }) {
  const entry = describeHistory(row, t);
  return (
    <div className="history-details">
      {entry.description && <p>{entry.description}</p>}
      {!!entry.highlights.length && (
        <div className="history-highlights">
          {entry.highlights.map((text) => (
            <span key={text}>{text}</span>
          ))}
          <small>
            {t("Selling prices before VAT", "أسعار البيع قبل الضريبة")}
          </small>
        </div>
      )}
      {entry.reason && (
        <p>
          {t("Reason", "السبب")}: {entry.reason}
        </p>
      )}
      {entry.changes.length ? (
        <details>
          <summary>
            {entry.created
              ? t("View product details", "عرض التفاصيل")
              : t("See what changed", "عرض التغييرات")}
          </summary>
          <dl className="history-changes">
            {entry.changes.map((change) => (
              <div key={change.label}>
                <dt>{change.label}</dt>
                <dd>
                  {entry.created ? (
                    <strong>{change.after}</strong>
                  ) : (
                    <>
                      <span>
                        {t("Previously", "سابقاً")}: {change.before}
                      </span>
                      <strong>
                        {t("Now", "الآن")}: {change.after}
                      </strong>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : (
        <p>
          {entry.reason
            ? t("Approval recorded.", "تم تسجيل الموافقة.")
            : t(
                "This activity was recorded successfully.",
                "تم تسجيل هذا النشاط بنجاح.",
              )}
        </p>
      )}
    </div>
  );
}
