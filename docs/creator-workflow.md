# Price List creator workflow

The normal flow is **Draft → Pricing assigned → Prices collected → Quotation → Customer order confirmed → Collection assigned → Materials collected → Delivery marked**.

Price List owns the creator screens and its existing pricing database. ERP stores the canonical quotation versions, accepted orders and quantity movements. ERP staff pricing and collection jobs remain available through their existing screens and WhatsApp. No procurement, receiving or collection-approval stage is added to the normal flow.

## Using the apps

- In Price List, open **Quotations** or **Pricing & Collection Jobs**. A linked draft opens its own creator workflow. ERP-originated requests appear in the request selector without creating another local quotation.
- After prices are collected, choose **Create quotation** or **Open quotation**. Save customer details, selected items, quantities, selling prices, currency and tax as a new shared version.
- **Confirm customer order** explicitly selects a saved version and accepted quantities, with an optional customer order reference. Confirmation creates no staff jobs.
- **Assign collection** selects collectors and creates collection jobs against confirmed balances only. Staff record pickup quantities through existing ERP screens.
- **Mark delivery** accepts partial quantities up to collected balances and requires an invoice or delivery reference and delivery date. Delivery history stays visible in both apps.
- ERP shows quotation versions, orders, collection balances and delivery history. Its creator links open the same Price List workspace, including the selected version for printing. ERP session commands cannot create/edit quotations, confirm orders, assign collectors or mark delivery.
- Historical collected allocations without order records can also be delivered from Price List. Their original allocation and movements remain intact; no replacement quotation, order or job is created. Early-authorized historical allocations require explicit customer confirmation first.

## Existing themed quotation PDF

Shared quotations use Price List's existing `quotationHtml` template and `QUOTE_PDF` worker, with company branding, logo, terms, watermark and the existing A4 layout. **Print quotation / Save PDF** opens the themed print view; **Download themed PDF** uses the existing background worker and displays a download link when ready. Sharing remains manual.

The adapter uses the selected ERP quotation's currency and canonical totals, not local pricing defaults. Inclusive, exclusive and exempt tax are supported; line rounding is apportioned to reconcile exactly to canonical totals. Supplier costs, offers, staff identities and margins are excluded. A company presentation snapshot is retained per shared identity/version, so retries or later branding changes cannot silently alter an existing version's output. Different versions retain independent PDF caches.

PDF snapshots are output metadata in the existing jobs table. They do not insert local quotation records or require a table migration. PDF status/download requests recheck the mapped creator's access to the canonical request and version.

## Integration and duplicate protection

- `jobs-quotation-list` and `jobs-quotation` retain creator/administrator and branch authorization. Reads include saved quotation versions, orders, historical allocation balances, and delivery history.
- `jobs-quotation-command` accepts `saveQuotation`, `confirmQuotation`, `approveCollection`, `orderDelivered`, `orderConfirm`, `orderCancel`, `legacyDelivered` and `confirmLegacyCollection`. Commands use the existing ERP service, revision checks, serializable transactions, audits and persisted receipts.
- Price List's `shared-quotation` endpoint additionally handles the local `quotationPdf` action and versioned print/status/download output. ERP's authenticated integration authorizes creator mutations independently of its session endpoint.
- A lost response retains the original command payload, revision and event ID even after background refresh. Explicit validation/conflict responses allow a fresh attempt after loading the latest version. Failed saves never appear committed.
- Identical saves create no extra version. Repeated confirmation content is rejected, and collection allocations cannot be created twice. Committed updates retain their existing outbox identities and stale-revision protection.
- Later quotation edits do not alter accepted orders. Cancel remaining uncollected quantities explicitly before confirming changed accepted quantities against another quotation version.
- Old local issue/revision/duplicate/PDF paths are guarded for workflow-managed quotations. The native quotation screen opens the shared creator workspace instead. New local collection-order creation is blocked; existing historical orders/jobs remain available for reassignment and delivery.

## Manual rollout

Deploy both applications together using the existing paired integration configuration and workflow flags. Keep the Price List worker running for PDF generation. Do not activate production until the manual staging pilot passes:

1. Create a quotation in Price List and check the same version, amounts and identity in ERP. Verify ERP creator mutations are rejected while staff jobs still work.
2. Confirm only some items, assign collectors, record partial pickups, and mark partial delivery with references. Reject collection before confirmation and delivery above collected balances.
3. Retry after an uncertain response and attempt simultaneous edits. Check for duplicate versions, orders, allocations, tasks and delivery movements.
4. Edit a quotation after confirmation and verify the accepted version remains unchanged. Test explicit cancellation/reconfirmation for changed remaining quantities.
5. Open an existing collected order and an allocation without an order. Deliver against the original records and verify no replacement records appear.
6. Interrupt integration, verify visible errors, restore connectivity and retry safely.
7. Print/download the same selected version and compare the themed PDF with ERP values. Check multi-page output, branding, tax and absence of supplier costs.

Deployment and the live pilot remain manual. No external messages or remote deployments are performed by the local verification.

## Local verification — 5 October 2026

All 93 ERP workflow tests and 30 Price List workflow/quotation tests pass, including creator authorization, retries and historical allocations. The actual existing PDF worker generated a multi-page branded quotation with canonical totals, repeated table headers, safe customer data and retained historical versions. Both production builds and the Price List typecheck pass.

ERP's full typecheck retains unrelated mobile, finance and page-export errors. Older workflow components retain existing React effect lint findings; changed server code and new components pass targeted lint.
