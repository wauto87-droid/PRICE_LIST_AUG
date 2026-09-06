"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
export default function StoreInventory({
  t,
  products,
  user,
}: {
  t: Translate;
  products: any[];
  user: any;
}) {
  const [warehouses, setWarehouses] = useState<any[]>([]),
    [balances, setBalances] = useState<any>(),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [mode, setMode] = useState("ADJUSTMENT");
  const can = user.permissions.includes("INVENTORY_MANAGE");
  async function load() {
    try {
      const [w, b] = await Promise.all([
        api("warehouses?pageSize=100&active=ACTIVE"),
        api(
          "inventory/balances?query=" +
            encodeURIComponent(query) +
            "&page=" +
            page,
        ),
      ]);
      setWarehouses(w.items);
      setBalances(b);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, [page, query]);
  const warehouse = (name: string) => (
    <select name={name} required>
      <option value="">{t("Choose warehouse", "اختر المستودع")}</option>
      {warehouses.map((w) => (
        <option value={w.id} key={w.id}>
          {w.code} · {w.name}
        </option>
      ))}
    </select>
  );
  return (
    <section>
      <h3>{t("Stock management", "إدارة المخزون")}</h3>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {can && (
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            const productId = String(f.get("productId"));
            try {
              if (mode === "TRANSFER")
                await api("inventory/transfers", "POST", {
                  fromWarehouseId: f.get("warehouseId"),
                  toWarehouseId: f.get("toWarehouseId"),
                  lines: [{ productId, quantity: f.get("quantity") }],
                  reason: f.get("reason"),
                  idempotencyKey: crypto.randomUUID(),
                });
              else if (mode === "MINIMUM")
                await api("storefront-admin/replenishment", "PUT", {
                  productId,
                  warehouseId: f.get("warehouseId"),
                  minimum: f.get("quantity"),
                });
              else
                await api("inventory/adjustments", "POST", {
                  warehouseId: f.get("warehouseId"),
                  productId,
                  quantity: f.get("quantity"),
                  unitCost: f.get("unitCost") || "0",
                  reason: f.get("reason"),
                  kind: mode,
                  idempotencyKey: crypto.randomUUID(),
                });
              await load();
              setNotice(t("Stock updated", "تم تحديث المخزون"));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              {t("Action", "الإجراء")}
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="OPENING">
                  {t("Opening stock", "رصيد افتتاحي")}
                </option>
                <option value="RECEIPT">
                  {t("Receive stock", "استلام مخزون")}
                </option>
                <option value="ADJUSTMENT">
                  {t("Adjust stock (+ / −)", "تعديل المخزون (+ / −)")}
                </option>
                <option value="TRANSFER">
                  {t("Transfer stock", "نقل مخزون")}
                </option>
                <option value="MINIMUM">
                  {t("Low stock threshold", "حد انخفاض المخزون")}
                </option>
              </select>
            </label>
            <label>
              {t("Warehouse", "المستودع")}
              {warehouse("warehouseId")}
            </label>
            {mode === "TRANSFER" && (
              <label>
                {t("Destination warehouse", "المستودع المستلم")}
                {warehouse("toWarehouseId")}
              </label>
            )}
            <label>
              {t("Product", "المنتج")}
              <select name="productId" required>
                <option value="">{t("Select product", "اختر المنتج")}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.part_number} · {p.description}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Quantity", "الكمية")}
              <input name="quantity" type="number" step="any" required />
            </label>
            {!["TRANSFER", "MINIMUM"].includes(mode) && (
              <label>
                {t("Unit cost for receipts", "تكلفة الوحدة للمستلمات")}
                <input
                  name="unitCost"
                  type="number"
                  step="any"
                  min="0"
                  defaultValue="0"
                  required
                />
              </label>
            )}
            <label>
              {t("Reason / reference", "السبب / المرجع")}
              <input
                name="reason"
                minLength={3}
                required={mode !== "MINIMUM"}
              />
            </label>
          </div>
          <button className="primary" disabled={busy}>
            {t("Post stock action", "تسجيل حركة المخزون")}
          </button>
        </form>
      )}
      <label>
        {t("Search stock", "بحث المخزون")}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <div className="dense-table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Product / المنتج",
                "Warehouse / المستودع",
                "On hand / الرصيد",
                "Reserved / المحجوز",
                "Available / المتاح",
              ].map((v) => (
                <th key={v}>{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {balances?.items.map((b: any) => (
              <tr key={b.product_id + b.warehouse_id}>
                <td>
                  {b.part_number} · {b.description}
                </td>
                <td>{b.warehouse_name}</td>
                <td>{b.on_hand}</td>
                <td>{b.reserved}</td>
                <td>{b.available}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
          {t("Previous", "السابق")}
        </button>
        <span>
          {page} / {balances?.totalPages || 1}
        </span>
        <button
          disabled={page >= (balances?.totalPages || 1)}
          onClick={() => setPage((v) => v + 1)}
        >
          {t("Next", "التالي")}
        </button>
      </div>
    </section>
  );
}
