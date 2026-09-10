"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { personalColumns } from "../shared/price-watch";
import { PriceActivityTable, WatchPagination } from "./PriceActivityTable";
export default function LookupHistory({
  t,
  revision,
  onOpen,
  online,
}: {
  t: Translate;
  revision: number;
  onOpen: (p: any) => void;
  online: boolean;
}) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState({
    page: 0,
    sort: "last_seen_at",
    direction: "desc",
    query: "",
  });
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setFilter((f) => ({ ...f, page: 0 }));
    setRefresh((v) => v + 1);
  }, [revision]);
  useEffect(() => {
    const focus = () => setRefresh((v) => v + 1);
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  useEffect(() => {
    if (!online) return;
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true);
      api(
        "price-watcher/history?" +
          new URLSearchParams({ ...filter, page: String(filter.page) }),
      )
        .then((value) => {
          if (active) {
            setData(value);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [filter, refresh, online]);
  async function reopen(row: any) {
    try {
      const product = await api("products/" + row.product_id);
      if (!product.active)
        throw new Error(t("This item is archived", "هذا الصنف مؤرشف"));
      onOpen(product);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="card lookup-history">
      <div className="section-heading">
        <h3>{t("Recent lookup history", "سجل البحث الأخير")}</h3>
        <button
          type="button"
          disabled={!online || busy}
          onClick={() => setRefresh((v) => v + 1)}
        >
          {t("Refresh", "تحديث")}
        </button>
      </div>
      <p>
        {t(
          "Your pricing calculations · Riyadh time · Activity is not confirmed sales or collected revenue.",
          "عمليات التسعير الخاصة بك · توقيت الرياض · النشاط ليس مبيعات مؤكدة أو إيرادات محصلة.",
        )}
      </p>
      <label>
        {t("Item / reference", "الصنف / المرجع")}
        <input
          value={filter.query}
          onChange={(e) =>
            setFilter((f) => ({ ...f, query: e.target.value, page: 0 }))
          }
        />
      </label>
      {!online && (
        <p>
          {t(
            "Reconnect to load lookup history",
            "أعد الاتصال لتحميل سجل البحث",
          )}
        </p>
      )}
      {busy && <p role="status">{t("Loading…", "جارٍ التحميل…")}</p>}
      {error && <p role="alert">{error}</p>}
      <PriceActivityTable
        rows={data?.items ?? []}
        columns={personalColumns}
        sort={filter.sort}
        direction={filter.direction}
        t={t}
        onSort={(sort) =>
          setFilter((f) => ({
            ...f,
            sort,
            direction:
              f.sort === sort && f.direction === "desc" ? "asc" : "desc",
            page: 0,
          }))
        }
        onOpen={online ? (row) => void reopen(row) : undefined}
        openLabel={t("Reopen item", "فتح الصنف")}
      />
      <WatchPagination
        data={data}
        onPage={(page) => setFilter((f) => ({ ...f, page }))}
        t={t}
      />
    </section>
  );
}
