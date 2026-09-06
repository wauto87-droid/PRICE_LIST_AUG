"use client";
import { useState } from "react";
import { api, type Translate } from "./api";
export default function CatalogOptionsSearch({
  t,
  onResults,
}: {
  t: Translate;
  onResults: (products: any[]) => void;
}) {
  const [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="actions"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await api(
            "storefront-admin/management?q=" + encodeURIComponent(query),
          );
          onResults(r.products);
          setMessage(
            `${r.products.length} / ${r.total} ${t("matches added to product choices below. Narrow the search for more precise results.", "نتيجة أضيفت إلى خيارات المنتجات أدناه. حدد البحث لنتائج أدق.")}`,
          );
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        aria-label={t(
          "Find products for these controls",
          "ابحث عن منتجات لهذه الخيارات",
        )}
        placeholder={t(
          "Find a SKU or product to select below",
          "ابحث عن رقم الصنف أو المنتج للاختيار أدناه",
        )}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button disabled={busy}>{t("Find products", "بحث المنتجات")}</button>
      <span role="status">{message}</span>
    </form>
  );
}
