"use client";
import { api, type Translate } from "./api";
export default function CommercialLists({
  section,
  data,
  t,
  reload,
  warehouseChoice,
  setWarehouseChoice,
}: {
  section: string;
  data: any;
  t: Translate;
  reload: () => Promise<void>;
  warehouseChoice: Record<string, string>;
  setWarehouseChoice: (v: Record<string, string>) => void;
}) {
  if (section === "orders")
    return (
      <div className="card compact-card">
        <div className="section-head">
          <h3>{t("Sales orders", "أوامر البيع")}</h3>
          <button onClick={reload}>{t("Refresh", "تحديث")}</button>
        </div>
        <div className="dense-table-wrap">
          <table className="dense-table">
            <thead>
              <tr>
                <th>{t("Order", "الطلب")}</th>
                <th>{t("Customer", "العميل")}</th>
                <th>{t("Warehouse", "المستودع")}</th>
                <th>{t("Status", "الحالة")}</th>
                <th>{t("Total", "الإجمالي")}</th>
                <th>{t("Actions", "الإجراءات")}</th>
              </tr>
            </thead>
            <tbody>
              {data?.items?.map((row: any) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.number}</strong>
                  </td>
                  <td>{row.customer?.name || row.customer?.number || "—"}</td>
                  <td>{row.warehouse_code || "—"}</td>
                  <td>
                    <span className="pill">
                      {row.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>SAR {row.totals?.total}</td>
                  <td>
                    <div className="actions">
                      <button
                        onClick={async () => {
                          await api(
                            `sales-orders/${row.id}/reserve`,
                            "POST",
                            {},
                          );
                          await reload();
                        }}
                        disabled={[
                          "DELIVERED",
                          "CANCELLED",
                          "CLOSED",
                          "RESERVED",
                        ].includes(row.status)}
                      >
                        {t("Reserve", "حجز")}
                      </button>
                      <button
                        onClick={async () => {
                          await api(`sales-orders/${row.id}/proforma`, "POST", {
                            idempotencyKey: crypto.randomUUID(),
                          });
                          await reload();
                        }}
                      >
                        {t("Proforma", "فاتورة أولية")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  if (section === "purchasing")
    return (
      <div className="card compact-card">
        <div className="section-head">
          <h3>{t("Purchase orders", "أوامر الشراء")}</h3>
          <button onClick={reload}>{t("Refresh", "تحديث")}</button>
        </div>
        <div className="dense-table-wrap">
          <table className="dense-table">
            <thead>
              <tr>
                <th>{t("PO", "أمر الشراء")}</th>
                <th>{t("Supplier", "المورد")}</th>
                <th>{t("Warehouse", "المستودع")}</th>
                <th>{t("Status", "الحالة")}</th>
                <th>{t("Total", "الإجمالي")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items?.map((row: any) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.number}</strong>
                  </td>
                  <td>{row.supplier_name}</td>
                  <td>{row.warehouse_code}</td>
                  <td>
                    <span className="pill">
                      {row.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>
                    {row.currency} {row.totals?.total}
                  </td>
                  <td>
                    {row.status === "DRAFT" && (
                      <button
                        className="primary"
                        onClick={async () => {
                          await api(
                            `purchase-orders/${row.id}/approve`,
                            "POST",
                            { version: row.version },
                          );
                          await reload();
                        }}
                      >
                        {t("Approve", "موافقة")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  if (section === "storefront")
    return (
      <div className="card compact-card">
        <div className="section-head">
          <div>
            <h3>{t("Online orders", "طلبات المتجر")}</h3>
            <a href="/amt_price_list/store" target="_blank">
              {t("Open storefront", "فتح المتجر")}
            </a>
          </div>
          <button onClick={reload}>{t("Refresh", "تحديث")}</button>
        </div>
        <div className="dense-table-wrap">
          <table className="dense-table">
            <thead>
              <tr>
                <th>{t("Order", "الطلب")}</th>
                <th>{t("Customer", "العميل")}</th>
                <th>{t("Fulfillment", "الاستلام")}</th>
                <th>{t("Payment", "الدفع")}</th>
                <th>{t("Status", "الحالة")}</th>
                <th>{t("Process", "معالجة")}</th>
              </tr>
            </thead>
            <tbody>
              {data?.items?.map((row: any) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.number}</strong>
                    <small>SAR {row.totals?.total}</small>
                  </td>
                  <td>
                    {row.guest_contact?.name}
                    <small>{row.guest_contact?.mobile}</small>
                  </td>
                  <td>{row.fulfillment_method}</td>
                  <td>{row.payment_method}</td>
                  <td>
                    <span className="pill">
                      {row.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>
                    {!row.sales_order_id &&
                      ["PENDING_REVIEW", "CONFIRMED"].includes(row.status) && (
                        <div className="actions">
                          <select
                            aria-label={t("Warehouse", "المستودع")}
                            value={warehouseChoice[row.id] || ""}
                            onChange={(e) =>
                              setWarehouseChoice({
                                ...warehouseChoice,
                                [row.id]: e.target.value,
                              })
                            }
                          >
                            <option value="">
                              {t("Choose warehouse", "اختر المستودع")}
                            </option>
                            {data.warehouses?.map((w: any) => (
                              <option key={w.id} value={w.id}>
                                {w.code} · {w.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="primary"
                            disabled={!warehouseChoice[row.id]}
                            onClick={async () => {
                              await api(
                                `online-orders/${row.id}/approve`,
                                "POST",
                                { warehouseId: warehouseChoice[row.id] },
                              );
                              await reload();
                            }}
                          >
                            {t("Create Sales Order", "إنشاء أمر بيع")}
                          </button>
                        </div>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  return null;
}
