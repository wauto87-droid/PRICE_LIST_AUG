# Lookup history and WhatsApp repair

Lookup calculations now have immutable snapshots in `price_lookup_history`, linked to the existing lifecycle interaction. The activity view combines these snapshots with current cart/quotation evidence. Summary cards and item/staff aggregates continue to use lifecycle records, so extra calculation snapshots do not inflate existing totals. Existing LOOKUP rows are migrated as "Legacy snapshot"; overwritten historical calculations cannot be recovered.

The personal history endpoint requires PRODUCT_VIEW and always restricts results to the authenticated actor. Price Watcher and exports retain PRICE_WATCHER permission. Default history/activity ordering is newest first; timestamps and date boundaries use Asia/Riyadh. The existing default 90-day range is preserved.

The live deployment was missing the WhatsApp process and all service configuration. For a managed PM2 deployment, persist WHATSAPP_MANAGED=true and a random WHATSAPP_SERVICE_TOKEN of at least 32 characters in the private shared environment. The deployment manager supplies the loopback URL and persistent session directory; it detects system Chromium and configures the root-only browser launch requirement. Preserve explicit overrides. The Compose deployment starts its profile-gated service when managed WhatsApp is enabled.

Do not put service tokens in URLs or reports. The admin connection page is `/?commerce=storefront&storeTab=whatsapp` beneath `/amt_price_list`. Sign in, scan using WhatsApp → Linked devices → Link a device, then confirm READY before testing signup verification. Successful QR generation alone does not establish that phone pairing or delivery succeeded.

Validation includes pricing/history, sorting of every column, idempotent retries, ownership isolation, quotation preservation, export order, QR lifecycle races, deployment tests, typecheck, production builds, and the local browser scenario in `tests/browser/price-history.mjs`.
