"use client";
import { useState, useMemo } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";

export interface StoreOrdersProps {
  t: Translate;
  user: any;
  orders: any[];
  warehouses: any[];
  onRefresh: () => Promise<void>;
}

export function resolveCustomer(order: any) {
  const name =
    order.customer_name ||
    order.guest_contact?.name ||
    order.address?.name ||
    (order.account_email ? order.account_email.split("@")[0] : "") ||
    "Store Customer";
  const mobile =
    order.account_mobile ||
    order.customer_mobile ||
    order.guest_contact?.mobile ||
    order.guest_contact?.phone ||
    order.address?.mobile ||
    order.address?.phone ||
    "";
  const email =
    order.account_email ||
    order.customer_email ||
    order.guest_contact?.email ||
    "";
  const company = order.company_name || "";
  const customerNumber = order.customer_number || "";
  return { name, mobile, email, company, customerNumber };
}

export function cleanPhone(mobile: string): string {
  if (!mobile) return "";
  const digits = mobile.replace(/\D/g, "");
  if (digits.startsWith("05")) return "966" + digits.slice(1);
  if (digits.startsWith("5") && digits.length === 9) return "966" + digits;
  return digits;
}

export function getOrderStatusStage(o: any): {
  stage: number;
  labelEn: string;
  labelAr: string;
  badgeClass: string;
} {
  if (o.status === "CANCELLED") {
    return {
      stage: -1,
      labelEn: "Cancelled",
      labelAr: "ملغي",
      badgeClass: "badge-cancelled",
    };
  }
  if (o.status === "FAILED") {
    return {
      stage: -1,
      labelEn: "Failed",
      labelAr: "فشل",
      badgeClass: "badge-cancelled",
    };
  }
  const fStatus = o.fulfillment_data?.fulfillmentStatus;
  if (fStatus === "DELIVERED") {
    return {
      stage: 5,
      labelEn: "Delivered",
      labelAr: "تم التوصيل",
      badgeClass: "badge-delivered",
    };
  }
  if (fStatus === "SHIPPED" || o.fulfillment_data?.tracking) {
    return {
      stage: 4,
      labelEn: "In Transit",
      labelAr: "قيد التوصيل",
      badgeClass: "badge-shipped",
    };
  }
  if (fStatus === "PROCESSING") {
    return {
      stage: 3,
      labelEn: "Preparing",
      labelAr: "قيد التجهيز",
      badgeClass: "badge-processing",
    };
  }
  if (o.status === "CONFIRMED") {
    return {
      stage: 2,
      labelEn: "Confirmed",
      labelAr: "مؤكد",
      badgeClass: "badge-confirmed",
    };
  }
  if (o.status === "PENDING_PAYMENT") {
    return {
      stage: 1,
      labelEn: "Pending Payment",
      labelAr: "بانتظار الدفع",
      badgeClass: "badge-pending",
    };
  }
  return {
    stage: 1,
    labelEn: "Pending Review",
    labelAr: "بانتظار المراجعة",
    badgeClass: "badge-review",
  };
}

export default function StoreOrders({
  t,
  user,
  orders = [],
  warehouses = [],
  onRefresh,
}: StoreOrdersProps) {
  const [filterTab, setFilterTab] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [paymentFilter, setPaymentFilter] = useState<string>("ALL");
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");

  // Action Drawer Form State
  const [actionType, setActionType] = useState<string>("");
  const [carrierInput, setCarrierInput] = useState<string>("");
  const [trackingInput, setTrackingInput] = useState<string>("");
  const [paymentAmountInput, setPaymentAmountInput] = useState<string>("");
  const [paymentRefInput, setPaymentRefInput] = useState<string>("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("");

  // Synchronize selected order updates if orders list updates
  const activeOrder = useMemo(() => {
    if (!selectedOrder) return null;
    return orders.find((o) => o.id === selectedOrder.id) || selectedOrder;
  }, [selectedOrder, orders]);

  // KPIs
  const stats = useMemo(() => {
    let sales = 0;
    let total = orders.length;
    let pending = 0;
    let processing = 0;
    let inTransit = 0;
    let delivered = 0;

    for (const o of orders) {
      const stage = getOrderStatusStage(o);
      if (o.status === "CONFIRMED" || stage.stage >= 2) {
        sales += Number(o.totals?.total || 0);
      }
      if (stage.stage === 1) pending++;
      else if (stage.stage === 2 || stage.stage === 3) processing++;
      else if (stage.stage === 4) inTransit++;
      else if (stage.stage === 5) delivered++;
    }

    return {
      sales: sales.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      total,
      pending,
      processing,
      inTransit,
      delivered,
    };
  }, [orders]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const stage = getOrderStatusStage(o);
      // Status Tab filter
      if (filterTab === "CONFIRMED" && stage.stage < 2) return false;
      if (filterTab === "PENDING" && stage.stage !== 1) return false;
      if (filterTab === "PROCESSING" && stage.stage !== 3) return false;
      if (filterTab === "SHIPPED" && stage.stage !== 4) return false;
      if (filterTab === "DELIVERED" && stage.stage !== 5) return false;
      if (filterTab === "CANCELLED" && stage.stage !== -1) return false;

      // Payment Filter
      if (paymentFilter !== "ALL" && o.payment_method !== paymentFilter)
        return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const cust = resolveCustomer(o);
        const matchNumber = o.number?.toLowerCase().includes(q);
        const matchName = cust.name?.toLowerCase().includes(q);
        const matchMobile = cust.mobile?.toLowerCase().includes(q);
        const matchEmail = cust.email?.toLowerCase().includes(q);
        const matchTracking = o.fulfillment_data?.tracking
          ?.toLowerCase()
          .includes(q);
        const matchCompany = cust.company?.toLowerCase().includes(q);
        if (
          !matchNumber &&
          !matchName &&
          !matchMobile &&
          !matchEmail &&
          !matchTracking &&
          !matchCompany
        ) {
          return false;
        }
      }

      return true;
    });
  }, [orders, filterTab, paymentFilter, searchQuery]);

  async function executeOrderAction(
    action: string,
    extraData: Record<string, any> = {},
  ) {
    if (!activeOrder) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`storefront-admin/order-actions/${activeOrder.id}`, "PUT", {
        action,
        version: activeOrder.version,
        idempotencyKey: crypto.randomUUID(),
        carrier: carrierInput || activeOrder.fulfillment_data?.carrier || "",
        tracking: trackingInput || activeOrder.fulfillment_data?.tracking || "",
        warehouseId: selectedWarehouseId || activeOrder.warehouse_id || undefined,
        ...extraData,
      });
      await onRefresh();
      setNotice(
        t("Order updated successfully", "تم تحديث الطلب بنجاح"),
      );
      setActionType("");
    } catch (e: any) {
      setError(e.message || "Failed to update order");
    } finally {
      setBusy(false);
    }
  }

  function printOrderInvoice(order: any) {
    const cust = resolveCustomer(order);
    const stage = getOrderStatusStage(order);
    const win = window.open("", "_blank");
    if (!win) return;

    const itemsHtml = (order.lines || [])
      .map(
        (l: any, idx: number) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${idx + 1}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">
          <strong>${l.partNumber || ""}</strong>
          <div style="font-size: 12px; color: #555;">${l.description || ""}</div>
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${l.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${Number(l.unitPriceExcl || 0).toFixed(2)} SAR</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${Number(l.vatAmount || 0).toFixed(2)} SAR</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;"><strong>${Number(l.lineTotal || 0).toFixed(2)} SAR</strong></td>
      </tr>
    `,
      )
      .join("");

    win.document.write(`
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8"/>
        <title>Order Invoice ${order.number}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 30px; color: #1e293b; background: #fff; line-height: 1.5; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 20px; }
          .title { font-size: 24px; font-weight: 800; color: #0f172a; }
          .meta { font-size: 13px; color: #64748b; line-height: 1.6; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; font-size: 13px; }
          .card h4 { margin: 0 0 10px; color: #0f172a; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 13px; }
          th { background: #f1f5f9; padding: 10px; text-align: left; border-bottom: 2px solid #cbd5e1; }
          .totals { width: 340px; margin-left: auto; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; font-size: 13px; }
          .totals-row { display: flex; justify-content: space-between; padding: 5px 0; }
          .totals-total { font-size: 16px; font-weight: 800; border-top: 2px solid #0f172a; padding-top: 10px; margin-top: 5px; color: #0284c7; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="title">Online Store Order Invoice</div>
            <div class="meta">Order Number: <strong>${order.number}</strong></div>
            <div class="meta">Date: ${new Date(order.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div>
            <div class="meta">Order Status: <strong>${stage.labelEn || stage.labelAr}</strong></div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 20px; font-weight: 700; color: #0284c7;">AMT ELECTRICAL SUPPLIES</div>
            <div class="meta">Electrical Materials & Project Solutions</div>
            <div class="meta">VAT Registration No: 300000000000003</div>
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <h4>Customer Details</h4>
            <div><strong>Name:</strong> ${cust.name}</div>
            <div><strong>Mobile:</strong> ${cust.mobile || "—"}</div>
            <div><strong>Email:</strong> ${cust.email || "—"}</div>
            ${cust.company ? `<div><strong>Company:</strong> ${cust.company}</div>` : ""}
          </div>
          <div class="card">
            <h4>Fulfillment & Payment Details</h4>
            <div><strong>Fulfillment:</strong> ${order.fulfillment_method === "PICKUP" ? "Pickup from Warehouse / Branch" : "Delivery to Address"}</div>
            <div><strong>City / Region:</strong> ${order.address?.city || "Riyadh"}${order.address?.district ? ` - ${order.address.district}` : ""}</div>
            <div><strong>Address:</strong> ${order.address?.street || "—"}</div>
            <div><strong>Payment:</strong> ${order.payment_method} (${order.paid_amount > 0 ? "Paid " + Number(order.paid_amount).toFixed(2) + " SAR" : "Unpaid"})</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="text-align: center; width: 40px;">#</th>
              <th>Item & Description</th>
              <th style="text-align: center; width: 70px;">Qty</th>
              <th style="text-align: right; width: 120px;">Unit Price (excl. VAT)</th>
              <th style="text-align: right; width: 100px;">VAT (15%)</th>
              <th style="text-align: right; width: 120px;">Line Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="totals">
          <div class="totals-row">
            <span>Subtotal (excl. VAT):</span>
            <span>${Number(order.totals?.subtotal || 0).toFixed(2)} SAR</span>
          </div>
          <div class="totals-row">
            <span>VAT (15%):</span>
            <span>${Number(order.totals?.vat || 0).toFixed(2)} SAR</span>
          </div>
          <div class="totals-row">
            <span>Delivery Fee:</span>
            <span>${Number(order.totals?.delivery || 0).toFixed(2)} SAR</span>
          </div>
          <div class="totals-row totals-total">
            <span>Total Amount Due:</span>
            <span>${Number(order.totals?.total || 0).toFixed(2)} SAR</span>
          </div>
        </div>

        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `);
    win.document.close();
  }

  return (
    <div className="store-orders-hub">
      {/* KPI METRICS STRIP */}
      <div className="orders-kpi-grid">
        <div className="orders-kpi-card highlight">
          <div className="kpi-icon">💰</div>
          <div className="kpi-content">
            <span className="kpi-label">
              {t("Confirmed Sales", "المبيعات المؤكدة")}
            </span>
            <span className="kpi-value">{stats.sales} SAR</span>
          </div>
        </div>
        <div className="orders-kpi-card">
          <div className="kpi-icon">📦</div>
          <div className="kpi-content">
            <span className="kpi-label">
              {t("Total Orders", "إجمالي الطلبات")}
            </span>
            <span className="kpi-value">{stats.total}</span>
          </div>
        </div>
        <div className="orders-kpi-card warning">
          <div className="kpi-icon">⏳</div>
          <div className="kpi-content">
            <span className="kpi-label">
              {t("Pending Review", "بانتظار المراجعة")}
            </span>
            <span className="kpi-value">{stats.pending}</span>
          </div>
        </div>
        <div className="orders-kpi-card info">
          <div className="kpi-icon">⚙️</div>
          <div className="kpi-content">
            <span className="kpi-label">
              {t("In Preparation", "قيد التجهيز")}
            </span>
            <span className="kpi-value">{stats.processing}</span>
          </div>
        </div>
        <div className="orders-kpi-card primary">
          <div className="kpi-icon">🚚</div>
          <div className="kpi-content">
            <span className="kpi-label">
              {t("In Transit", "قيد التوصيل")}
            </span>
            <span className="kpi-value">{stats.inTransit}</span>
          </div>
        </div>
        <div className="orders-kpi-card success">
          <div className="kpi-icon">✅</div>
          <div className="kpi-content">
            <span className="kpi-label">
              {t("Delivered", "تم التوصيل")}
            </span>
            <span className="kpi-value">{stats.delivered}</span>
          </div>
        </div>
      </div>

      {/* FILTER TABS */}
      <div className="orders-status-tabs">
        {[
          ["ALL", t("All Orders", "كل الطلبات"), stats.total],
          ["CONFIRMED", t("Confirmed", "مؤكدة"), stats.processing + stats.inTransit + stats.delivered],
          ["PENDING", t("Pending Review", "قيد المراجعة"), stats.pending],
          ["PROCESSING", t("Preparing", "قيد التجهيز"), stats.processing],
          ["SHIPPED", t("In Transit", "قيد التوصيل"), stats.inTransit],
          ["DELIVERED", t("Delivered", "تم التوصيل"), stats.delivered],
          ["CANCELLED", t("Cancelled", "ملغية"), orders.filter(o => o.status === "CANCELLED").length],
        ].map(([key, label, count]) => (
          <button
            key={key as string}
            type="button"
            className={`status-tab-btn ${filterTab === key ? "active" : ""}`}
            onClick={() => setFilterTab(key as string)}
          >
            <span>{label}</span>
            <span className="tab-count-badge">{count}</span>
          </button>
        ))}
      </div>

      {/* SEARCH AND QUICK FILTER CONTROLS */}
      <div className="orders-toolbar">
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-field"
            placeholder={t(
              "Search Order #, customer name, mobile, email, tracking…",
              "بحث برقم الطلب، اسم العميل، الجوال، البريد، التتبع…",
            )}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearchQuery("")}
            >
              ✕
            </button>
          )}
        </div>

        <div className="filter-select-wrap">
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="filter-select"
            aria-label={t("Filter by payment method", "تصفية حسب طريقة الدفع")}
          >
            <option value="ALL">{t("All Payment Methods", "كل طرق الدفع")}</option>
            <option value="MOYASAR">{t("Credit / Debit Card (Moyasar)", "بطاقة بنكية / مدى")}</option>
            <option value="BANK_TRANSFER">{t("Bank Transfer", "تحويل بنكي")}</option>
            <option value="CREDIT_TERMS">{t("Company Credit", "آجل شركات")}</option>
          </select>
        </div>

        <button
          type="button"
          className="refresh-btn"
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onRefresh();
              setNotice(t("Orders list refreshed", "تم تحديث قائمة الطلبات"));
              setTimeout(() => setNotice(""), 3000);
            } catch (err: any) {
              setError(err.message || "Failed to refresh");
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          title={t("Refresh orders list", "تحديث قائمة الطلبات")}
        >
          🔄 {t("Refresh", "تحديث")}
        </button>
      </div>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}

      {/* ORDERS LIST / TABLE */}
      {filteredOrders.length === 0 ? (
        <div className="orders-empty-state">
          <div className="empty-icon">📭</div>
          <h3>{t("No orders found", "لم يتم العثور على أي طلبات")}</h3>
          <p>
            {searchQuery
              ? t("Try adjusting your search query or status filter.", "جرب تغيير نص البحث أو خيارات التصفية.")
              : t("When customers place orders on your store, they will appear here.", "عندما يطلب العملاء من المتجر ستظهر طلباتهم هنا مباشرة.")}
          </p>
        </div>
      ) : (
        <div className="orders-table-wrapper">
          <table className="orders-enterprise-table">
            <thead>
              <tr>
                <th>{t("Order Details", "تفاصيل الطلب")}</th>
                <th>{t("Customer", "العميل")}</th>
                <th>{t("Fulfillment", "التنفيذ")}</th>
                <th>{t("Items", "الأصناف")}</th>
                <th>{t("Payment & Total", "الدفع والمبلغ")}</th>
                <th>{t("Status", "الحالة")}</th>
                <th style={{ textAlign: "center" }}>{t("Action", "الإجراء")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((o) => {
                const cust = resolveCustomer(o);
                const stage = getOrderStatusStage(o);
                const waPhone = cleanPhone(cust.mobile);
                const waText = encodeURIComponent(
                  `مرحباً ${cust.name}، بخصوص طلبكم رقم ${o.number} من شركة المواد الكهربائية للتجارة (AMT).`,
                );
                const isSelected = activeOrder?.id === o.id;

                return (
                  <tr
                    key={o.id}
                    className={`order-row ${isSelected ? "selected-row" : ""}`}
                    onClick={() => setSelectedOrder(o)}
                  >
                    {/* ORDER DETAILS */}
                    <td>
                      <div className="order-number-cell">
                        <span className="order-number">{o.number}</span>
                        <span className="order-date">
                          {new Date(o.created_at).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })} · {new Date(o.created_at).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {o.fulfillment_data?.tracking && (
                          <span className="tracking-tag">
                            🚚 {o.fulfillment_data.carrier || "Carrier"}: {o.fulfillment_data.tracking}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* CUSTOMER */}
                    <td>
                      <div className="customer-cell">
                        <div className="customer-name-row">
                          <strong className="customer-name">{cust.name}</strong>
                          {cust.company && (
                            <span className="company-badge">🏢 {cust.company}</span>
                          )}
                        </div>
                        {cust.mobile && (
                          <div className="customer-contact-row">
                            <span className="phone-text">📞 {cust.mobile}</span>
                            <a
                              href={`https://wa.me/${waPhone}?text=${waText}`}
                              target="_blank"
                              rel="noreferrer"
                              className="whatsapp-quick-btn"
                              title={t("Chat on WhatsApp", "مراسلة عبر واتساب")}
                              onClick={(e) => e.stopPropagation()}
                            >
                              💬 WhatsApp
                            </a>
                          </div>
                        )}
                        {cust.email && (
                          <span className="email-text">✉️ {cust.email}</span>
                        )}
                      </div>
                    </td>

                    {/* FULFILLMENT */}
                    <td>
                      <div className="fulfillment-cell">
                        {o.fulfillment_method === "PICKUP" ? (
                          <span className="fulfillment-badge pickup">
                            🏬 {t("Warehouse Pickup", "استلام من الفرع")}
                          </span>
                        ) : (
                          <span className="fulfillment-badge delivery">
                            🚚 {t("Delivery", "توصيل للعنوان")}
                          </span>
                        )}
                        <span className="fulfillment-subtext">
                          {o.address?.city || (o.fulfillment_method === "PICKUP" ? (o.warehouse_name || "Warehouse") : "Riyadh")}
                          {o.address?.district ? ` · ${o.address.district}` : ""}
                        </span>
                      </div>
                    </td>

                    {/* ITEMS */}
                    <td>
                      <div className="items-summary-cell">
                        <span className="items-count-badge">
                          {(o.lines || []).length} {t("items", "أصناف")}
                        </span>
                        <div className="items-mini-preview">
                          {(o.lines || []).slice(0, 2).map((l: any, i: number) => (
                            <div key={i} className="mini-item-line">
                              {l.quantity}× {l.partNumber}
                            </div>
                          ))}
                          {(o.lines || []).length > 2 && (
                            <small className="more-items">
                              +{o.lines.length - 2} {t("more", "المزيد")}
                            </small>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* PAYMENT & TOTAL */}
                    <td>
                      <div className="payment-cell">
                        <span className="grand-total-text">
                          {Number(o.totals?.total || 0).toFixed(2)} SAR
                        </span>
                        <div className="payment-sub-row">
                          <span className={`payment-badge ${o.payment_method?.toLowerCase()}`}>
                            {o.payment_method === "MOYASAR"
                              ? t("Moyasar Card", "بطاقة مدى / فيزا")
                              : o.payment_method === "BANK_TRANSFER"
                              ? t("Bank Transfer", "تحويل بنكي")
                              : t("Credit Terms", "آجل")}
                          </span>
                          {Number(o.paid_amount || 0) >= Number(o.totals?.total || 0) ? (
                            <span className="paid-status-tag paid">✓ {t("Paid", "مدفوع")}</span>
                          ) : Number(o.paid_amount || 0) > 0 ? (
                            <span className="paid-status-tag partial">
                              {Number(o.paid_amount).toFixed(0)} / {Number(o.totals?.total).toFixed(0)}
                            </span>
                          ) : (
                            <span className="paid-status-tag unpaid">{t("Unpaid", "غير مدفوع")}</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* STATUS */}
                    <td>
                      <div className="status-cell">
                        <span className={`order-status-badge ${stage.badgeClass}`}>
                          {t(stage.labelEn, stage.labelAr)}
                        </span>
                      </div>
                    </td>

                    {/* ACTION */}
                    <td style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        className="manage-order-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedOrder(o);
                        }}
                      >
                        {t("Manage", "إدارة")} ➔
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* AMAZON / FLIPKART STYLE ORDER MANAGEMENT DRAWER / MODAL */}
      {activeOrder && (
        <div
          className="order-drawer-backdrop"
          onClick={() => {
            setSelectedOrder(null);
            setActionType("");
          }}
        >
          <div
            className="order-drawer-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t("Order Details", "تفاصيل الطلب")}
          >
            {/* DRAWER HEADER */}
            <div className="drawer-header">
              <div className="header-left">
                <h2>
                  {t("Order", "الطلب")} #{activeOrder.number}
                </h2>
                <span
                  className={`order-status-badge ${
                    getOrderStatusStage(activeOrder).badgeClass
                  }`}
                >
                  {t(
                    getOrderStatusStage(activeOrder).labelEn,
                    getOrderStatusStage(activeOrder).labelAr,
                  )}
                </span>
              </div>
              <div className="header-actions">
                <button
                  type="button"
                  className="drawer-action-icon-btn"
                  onClick={() => printOrderInvoice(activeOrder)}
                  title={t("Print Tax Invoice", "طباعة الفاتورة الضريبية")}
                >
                  🖨️ {t("Print Invoice", "طباعة الفاتورة")}
                </button>
                <button
                  type="button"
                  className="drawer-close-btn"
                  onClick={() => {
                    setSelectedOrder(null);
                    setActionType("");
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* STEPPER PROGRESS BAR (Amazon / Flipkart style) */}
            <div className="order-stepper-container">
              {(() => {
                const stage = getOrderStatusStage(activeOrder);
                const steps = [
                  { num: 1, titleEn: "Placed", titleAr: "تم الطلب" },
                  { num: 2, titleEn: "Confirmed", titleAr: "مؤكد" },
                  { num: 3, titleEn: "Preparing", titleAr: "قيد التجهيز" },
                  { num: 4, titleEn: "In Transit", titleAr: "قيد التوصيل" },
                  { num: 5, titleEn: "Delivered", titleAr: "تم التوصيل" },
                ];

                return (
                  <div className="stepper-track">
                    {steps.map((step) => {
                      const isComplete = stage.stage >= step.num;
                      const isCurrent = stage.stage === step.num;
                      return (
                        <div
                          key={step.num}
                          className={`stepper-step ${
                            isComplete ? "complete" : ""
                          } ${isCurrent ? "current" : ""}`}
                        >
                          <div className="stepper-dot">
                            {isComplete && step.num < stage.stage ? "✓" : step.num}
                          </div>
                          <span className="stepper-label">
                            {t(step.titleEn, step.titleAr)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* ACTION TOOLBAR */}
            <div className="drawer-actions-toolbar">
              {/* Confirm action */}
              {activeOrder.status !== "CONFIRMED" &&
                activeOrder.status !== "CANCELLED" && (
                  <button
                    type="button"
                    className="action-btn confirm"
                    onClick={() => executeOrderAction("CONFIRM")}
                    disabled={busy}
                  >
                    🟢 {t("Confirm Order", "تأكيد الطلب")}
                  </button>
                )}

              {/* Processing action */}
              {getOrderStatusStage(activeOrder).stage >= 2 &&
                getOrderStatusStage(activeOrder).stage < 4 && (
                  <button
                    type="button"
                    className="action-btn prepare"
                    onClick={() => executeOrderAction("PROCESSING")}
                    disabled={busy}
                  >
                    📦 {t("Mark In Preparation", "تجهيز في المستودع")}
                  </button>
                )}

              {/* Tracking / Ship action */}
              {activeOrder.status !== "CANCELLED" && (
                <button
                  type="button"
                  className="action-btn ship"
                  onClick={() =>
                    setActionType(actionType === "TRACKING" ? "" : "TRACKING")
                  }
                  disabled={busy}
                >
                  🚚 {t("Dispatch / Update Tracking", "تحديث الشحن والتتبع")}
                </button>
              )}

              {/* Deliver action */}
              {getOrderStatusStage(activeOrder).stage >= 2 &&
                getOrderStatusStage(activeOrder).stage < 5 && (
                  <button
                    type="button"
                    className="action-btn deliver"
                    onClick={() => executeOrderAction("DELIVER")}
                    disabled={busy}
                  >
                    ✅ {t("Mark as Delivered", "تأكيد التسليم")}
                  </button>
                )}

              {/* Record Payment action */}
              {["BANK_TRANSFER", "CREDIT_TERMS"].includes(
                activeOrder.payment_method,
              ) &&
                Number(activeOrder.paid_amount || 0) <
                  Number(activeOrder.totals?.total || 0) && (
                  <button
                    type="button"
                    className="action-btn payment"
                    onClick={() =>
                      setActionType(actionType === "PAYMENT" ? "" : "PAYMENT")
                    }
                    disabled={busy}
                  >
                    💳 {t("Record Payment", "تسجيل دفعة بنكية")}
                  </button>
                )}

              {/* Cancel action */}
              {!["CANCELLED", "FAILED"].includes(activeOrder.status) && (
                <button
                  type="button"
                  className="action-btn cancel"
                  onClick={() => {
                    if (
                      confirm(
                        t(
                          "Are you sure you want to cancel this order? Holds will be released.",
                          "هل أنت متأكد من رغبتك في إلغاء هذا الطلب؟ سيتم فك حجز المنتجات.",
                        ),
                      )
                    ) {
                      executeOrderAction("CANCEL");
                    }
                  }}
                  disabled={busy}
                >
                  ❌ {t("Cancel Order", "إلغاء الطلب")}
                </button>
              )}
            </div>

            {/* INLINE ACTION SUB-PANELS */}
            {actionType === "TRACKING" && (
              <div className="action-subpanel tracking-subpanel">
                <h4>{t("Update Shipping & Tracking", "تحديث بيانات الشحن والتتبع")}</h4>
                <div className="form-row-grid">
                  <label>
                    <span>{t("Carrier Name", "شركة الشحن")}</span>
                    <input
                      type="text"
                      placeholder="e.g. SMSA, Aramex, DHL, AMT Fleet"
                      value={carrierInput}
                      onChange={(e) => setCarrierInput(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>{t("Tracking Number / Airway Bill", "رقم التتبع / البوليصة")}</span>
                    <input
                      type="text"
                      placeholder="e.g. 2901928374"
                      value={trackingInput}
                      onChange={(e) => setTrackingInput(e.target.value)}
                    />
                  </label>
                </div>
                <div className="subpanel-buttons">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !trackingInput.trim()}
                    onClick={() =>
                      executeOrderAction("TRACKING", {
                        carrier: carrierInput,
                        tracking: trackingInput,
                      })
                    }
                  >
                    {t("Save & Mark In Transit", "حفظ وتحديث كشحنة منطلقة")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActionType("")}
                    disabled={busy}
                  >
                    {t("Cancel", "إلغاء")}
                  </button>
                </div>
              </div>
            )}

            {actionType === "PAYMENT" && (
              <div className="action-subpanel payment-subpanel">
                <h4>{t("Record Verified Bank Payment", "تسجيل دفعة بنكية محققة")}</h4>
                <div className="form-row-grid">
                  <label>
                    <span>{t("Payment Amount (SAR)", "مبلغ الدفعة (ر.س)")}</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder={String(
                        Number(activeOrder.totals?.total || 0) -
                          Number(activeOrder.paid_amount || 0),
                      )}
                      value={paymentAmountInput}
                      onChange={(e) => setPaymentAmountInput(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>{t("Bank Reference / Transfer ID", "المرجع البنكي / رقم الحوالة")}</span>
                    <input
                      type="text"
                      placeholder="e.g. TXN-928374"
                      value={paymentRefInput}
                      onChange={(e) => setPaymentRefInput(e.target.value)}
                    />
                  </label>
                </div>
                <div className="subpanel-buttons">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !paymentAmountInput || !paymentRefInput}
                    onClick={() =>
                      executeOrderAction("PAYMENT", {
                        amount: paymentAmountInput,
                        reference: paymentRefInput,
                      })
                    }
                  >
                    {t("Verify & Apply Payment", "تأكيد وتسجيل الدفعة")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActionType("")}
                    disabled={busy}
                  >
                    {t("Cancel", "إلغاء")}
                  </button>
                </div>
              </div>
            )}

            {/* DRAWER 2-COLUMN BODY */}
            <div className="drawer-body-grid">
              {/* LEFT COLUMN: Customer + Delivery details */}
              <div className="drawer-column left">
                {/* Customer Profile Card */}
                {(() => {
                  const cust = resolveCustomer(activeOrder);
                  const waPhone = cleanPhone(cust.mobile);
                  const waText = encodeURIComponent(
                    `مرحباً ${cust.name}، بخصوص طلبكم رقم ${activeOrder.number} من متجرنا.`,
                  );

                  return (
                    <div className="drawer-card">
                      <div className="card-header">
                        <h3>👤 {t("Customer Details", "بيانات العميل")}</h3>
                      </div>
                      <div className="card-content">
                        <div className="info-line">
                          <span className="info-label">{t("Name", "الاسم")}:</span>
                          <strong className="info-value">{cust.name}</strong>
                        </div>
                        {cust.company && (
                          <div className="info-line">
                            <span className="info-label">{t("Company", "الشركة")}:</span>
                            <span className="info-value badge-company">🏢 {cust.company}</span>
                          </div>
                        )}
                        {cust.customerNumber && (
                          <div className="info-line">
                            <span className="info-label">{t("Customer #", "رقم العميل")}:</span>
                            <span className="info-value">{cust.customerNumber}</span>
                          </div>
                        )}
                        <div className="info-line">
                          <span className="info-label">{t("Mobile", "الجوال")}:</span>
                          <span className="info-value">{cust.mobile || "—"}</span>
                        </div>
                        {cust.email && (
                          <div className="info-line">
                            <span className="info-label">{t("Email", "البريد")}:</span>
                            <span className="info-value">{cust.email}</span>
                          </div>
                        )}

                        {cust.mobile && (
                          <div className="customer-direct-actions">
                            <a
                              href={`https://wa.me/${waPhone}?text=${waText}`}
                              target="_blank"
                              rel="noreferrer"
                              className="whatsapp-action-btn"
                            >
                              💬 {t("Chat on WhatsApp", "مراسلة عبر واتساب")}
                            </a>
                            <a
                              href={`tel:${cust.mobile}`}
                              className="call-action-btn"
                            >
                              📞 {t("Call", "اتصال هاتفي")}
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Delivery & Fulfillment Card */}
                <div className="drawer-card">
                  <div className="card-header">
                    <h3>📍 {t("Fulfillment & Delivery", "التنفيذ والتوصيل")}</h3>
                  </div>
                  <div className="card-content">
                    <div className="info-line">
                      <span className="info-label">{t("Method", "طريقة الاستلام")}:</span>
                      <strong className="info-value">
                        {activeOrder.fulfillment_method === "PICKUP"
                          ? `🏬 ${t("Warehouse Pickup", "استلام من المستودع")}`
                          : `🚚 ${t("Address Delivery", "توصيل للعنوان")}`}
                      </strong>
                    </div>
                    {activeOrder.fulfillment_method === "DELIVERY" && (
                      <>
                        <div className="info-line">
                          <span className="info-label">{t("City / Zone", "المدينة / المنطقة")}:</span>
                          <span className="info-value">
                            {activeOrder.address?.city || "Riyadh"}
                            {activeOrder.address?.district ? ` - ${activeOrder.address.district}` : ""}
                          </span>
                        </div>
                        <div className="info-line">
                          <span className="info-label">{t("Street Address", "العنوان التفصيلي")}:</span>
                          <span className="info-value">{activeOrder.address?.street || "—"}</span>
                        </div>
                        {activeOrder.address?.notes && (
                          <div className="info-line">
                            <span className="info-label">{t("Delivery Notes", "ملاحظات التوصيل")}:</span>
                            <span className="info-value notes-text">{activeOrder.address.notes}</span>
                          </div>
                        )}
                      </>
                    )}

                    {/* Warehouse Allocation */}
                    <div className="info-line" style={{ marginTop: "10px" }}>
                      <span className="info-label">{t("Fulfilling Warehouse", "مستودع التجهيز")}:</span>
                      <select
                        className="warehouse-assign-select"
                        value={selectedWarehouseId || activeOrder.warehouse_id || ""}
                        onChange={(e) => setSelectedWarehouseId(e.target.value)}
                      >
                        <option value="">{t("Select warehouse…", "اختر المستودع…")}</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({w.code})
                          </option>
                        ))}
                      </select>
                    </div>
                    {selectedWarehouseId && selectedWarehouseId !== activeOrder.warehouse_id && (
                      <button
                        type="button"
                        className="assign-wh-btn"
                        onClick={() => executeOrderAction("CONFIRM", { warehouseId: selectedWarehouseId })}
                        disabled={busy}
                      >
                        💾 {t("Save Warehouse Allocation", "حفظ تخصيص المستودع")}
                      </button>
                    )}
                  </div>
                </div>

                {/* Tracking & Carrier Card */}
                {activeOrder.fulfillment_data?.tracking && (
                  <div className="drawer-card">
                    <div className="card-header">
                      <h3>🚚 {t("Shipment Tracking", "تتبع الشحنة")}</h3>
                    </div>
                    <div className="card-content">
                      <div className="info-line">
                        <span className="info-label">{t("Carrier", "شركة الشحن")}:</span>
                        <strong className="info-value">
                          {activeOrder.fulfillment_data.carrier || "Standard Carrier"}
                        </strong>
                      </div>
                      <div className="info-line">
                        <span className="info-label">{t("Tracking #", "رقم التتبع")}:</span>
                        <strong className="info-value tracking-highlight">
                          {activeOrder.fulfillment_data.tracking}
                        </strong>
                      </div>
                      {activeOrder.fulfillment_data.shippedAt && (
                        <div className="info-line">
                          <span className="info-label">{t("Shipped At", "تاريخ الشحن")}:</span>
                          <span className="info-value">
                            {new Date(activeOrder.fulfillment_data.shippedAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: Ordered Items & Financial Summary */}
              <div className="drawer-column right">
                {/* Line Items Card */}
                <div className="drawer-card">
                  <div className="card-header">
                    <h3>📦 {t("Ordered Items", "الأصناف المطلوبة")} ({(activeOrder.lines || []).length})</h3>
                  </div>
                  <div className="card-content" style={{ padding: 0 }}>
                    <div className="drawer-items-table-wrap">
                      <table className="drawer-items-table">
                        <thead>
                          <tr>
                            <th>{t("Product", "الصنف")}</th>
                            <th style={{ textAlign: "center" }}>{t("Qty", "الكمية")}</th>
                            <th style={{ textAlign: "right" }}>{t("Unit Price", "السعر")}</th>
                            <th style={{ textAlign: "right" }}>{t("Total", "الإجمالي")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(activeOrder.lines || []).map((line: any, idx: number) => (
                            <tr key={idx}>
                              <td>
                                <div className="item-title-block">
                                  <strong className="item-part-num">{line.partNumber}</strong>
                                  <span className="item-desc">{line.description}</span>
                                </div>
                              </td>
                              <td style={{ textAlign: "center", fontWeight: "bold" }}>
                                {line.quantity}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                {Number(line.unitPriceExcl || 0).toFixed(2)} SAR
                              </td>
                              <td style={{ textAlign: "right", fontWeight: "bold" }}>
                                {Number(line.lineTotal || 0).toFixed(2)} SAR
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Financial Summary Card */}
                <div className="drawer-card">
                  <div className="card-header">
                    <h3>💵 {t("Payment & Financials", "الدفع والمطابقة المالية")}</h3>
                  </div>
                  <div className="card-content">
                    <div className="summary-row">
                      <span>{t("Subtotal (Excl. VAT)", "المجموع الفرعي (بدون ضريبة)")}</span>
                      <span>{Number(activeOrder.totals?.subtotal || 0).toFixed(2)} SAR</span>
                    </div>
                    <div className="summary-row">
                      <span>{t("VAT (15%)", "ضريبة القيمة المضافة (15%)")}</span>
                      <span>{Number(activeOrder.totals?.vat || 0).toFixed(2)} SAR</span>
                    </div>
                    <div className="summary-row">
                      <span>{t("Delivery Fee", "رسوم التوصيل")}</span>
                      <span>{Number(activeOrder.totals?.delivery || 0).toFixed(2)} SAR</span>
                    </div>
                    <div className="summary-row grand-total">
                      <span>{t("Grand Total", "المجموع النهائي")}</span>
                      <span>{Number(activeOrder.totals?.total || 0).toFixed(2)} SAR</span>
                    </div>

                    <div className="payment-status-breakdown">
                      <div className="summary-row">
                        <span>{t("Payment Method", "طريقة الدفع")}</span>
                        <strong>{activeOrder.payment_method}</strong>
                      </div>
                      <div className="summary-row">
                        <span>{t("Amount Paid", "المبلغ المدفوع")}</span>
                        <strong className="paid-amount-text">
                          {Number(activeOrder.paid_amount || 0).toFixed(2)} SAR
                        </strong>
                      </div>
                      <div className="summary-row balance-due">
                        <span>{t("Balance Due", "المبلغ المتبقي")}</span>
                        <strong>
                          {Math.max(
                            0,
                            Number(activeOrder.totals?.total || 0) -
                              Number(activeOrder.paid_amount || 0),
                          ).toFixed(2)}{" "}
                          SAR
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
