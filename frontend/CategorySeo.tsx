"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
export default function CategorySeo({ t }: { t: Translate }) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState("");
  async function load() {
    try {
      setData(await api("storefront-admin/category-seo"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const content = data?.content?.[selected] || {};
  return (
    <details>
      <summary>
        {t("Category pages and SEO", "صفحات الفئات وتحسين البحث")}
      </summary>
      {error && <p role="alert">{error}</p>}
      <label>
        {t("Category", "الفئة")}
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">{t("Choose category", "اختر الفئة")}</option>
          {data?.categories.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <form
          className="form-grid"
          key={selected + ":" + data.version}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              await api("storefront-admin/category-seo", "PUT", {
                categoryId: selected,
                version: data.version,
                title: f.get("title"),
                description: f.get("description"),
                titleAr: f.get("titleAr"),
                descriptionAr: f.get("descriptionAr"),
              });
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {[
            ["title", "SEO title", "عنوان البحث"],
            ["description", "SEO description", "وصف البحث"],
            ["titleAr", "Arabic title", "العنوان العربي"],
            ["descriptionAr", "Arabic description", "الوصف العربي"],
          ].map(([name, en, ar]) => (
            <label key={name}>
              {t(en, ar)}
              <input
                name={name}
                maxLength={name.includes("escription") ? 320 : 150}
                defaultValue={content[name] || ""}
              />
            </label>
          ))}
          <button disabled={busy}>
            {t("Save category page", "حفظ صفحة الفئة")}
          </button>
        </form>
      )}
    </details>
  );
}
