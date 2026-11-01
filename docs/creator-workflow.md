# Price List creator workflow

The normal flow is **Draft → Pricing assigned → Prices collected → Quotation → Customer order confirmed → Collection assigned → Materials collected → Delivery marked**.

Price List owns the creator screens and its existing pricing database. ERP stores the canonical quotation versions, accepted orders and quantity movements. ERP staff pricing and collection jobs remain available through their existing screens and WhatsApp. No procurement, receiving or collection-approval stage is added to the normal flow.

## Using the apps

- In **Pricing & Collection Jobs**, **Create quotation** opens the linked document in the existing **Edit draft** menu. Supplier prices and the staff who collected them use the existing internal cost-note component. There is no second quotation editor.
- Review customer details, selected items, quantities, selling prices and tax, then choose **Convert to quotation**. Existing shared quotations use **Save quotation version**. The document ID and quotation number stay unchanged; no parallel quotation is created.
- **Open quotation** opens the existing quotation detail screen with the selected canonical version and its existing themed print/PDF engine. ERP-originated requests use the same editor/detail screens without creating a local quotation record.
- Creation and editing show quotation controls only. Return to **Pricing & Collection Jobs** and choose **Open quotation** for fulfilment actions. Printing or downloading never confirms an order.
- **Confirm customer order** explicitly selects a saved version and accepted quantities, with an optional customer order reference. Confirmation creates no staff jobs. Historical orders and collected allocations are accepted in place against the selected saved version, with immutable accepted quantity and price snapshots.
- **Assign collection** in the quotation detail screen selects products and collectors, with an optional **PO reference**. The reference is informational and creates no procurement document or additional approval. The second collection-assignment form is removed; staff record pickup quantities through existing ERP screens.
- One **Mark delivery** form combines selected items across orders and historical pickups. It accepts partial quantities up to explicitly confirmed, collected, undelivered balances and requires an invoice or delivery reference and delivery date. Delivery history stays visible in both apps.
- ERP shows quotation versions, orders, collection balances and delivery history. Its creator links open the same Price List workspace, including the selected version for printing. ERP session commands cannot create/edit quotations, confirm orders, assign collectors or mark delivery.
- Historical collected allocations without order records can also be delivered from Price List. Their original allocation and movements remain intact; no replacement quotation, order or job is created. Missing confirmation means unconfirmed, regardless of historical authorization or pickups. Confirm a saved shared quotation before delivery; the old unversioned confirmation shortcuts are rejected.

## Existing themed quotation PDF

Shared quotations use Price List's existing `quotationHtml` template and `QUOTE_PDF` worker, with company branding, logo, terms, watermark and the existing A4 layout. **Print quotation / Save PDF** opens the themed print view; **Download themed PDF** uses the existing background worker and displays a download link when ready. Sharing remains manual.

The adapter uses the selected ERP quotation's currency and canonical totals, not local pricing defaults. Inclusive, exclusive and exempt tax are supported; line rounding is apportioned to reconcile exactly to canonical totals. Supplier costs, offers, staff identities and margins are excluded. A company presentation snapshot is retained per shared identity/version, so retries or later branding changes cannot silently alter an existing version's output. Different versions retain independent PDF caches.

PDF snapshots are output metadata in the existing jobs table. They do not insert local quotation records or require a table migration. PDF status/download requests recheck the mapped creator's access to the canonical request and version.

## Integration and duplicate protection

- `jobs-quotation-list` and `jobs-quotation` retain creator/administrator and branch authorization. Reads include saved quotation versions, orders, historical allocation balances, and delivery history.
- `jobs-quotation-command` accepts `saveQuotation`, `confirmQuotation`, `approveCollection`, `markDelivery`, `orderDelivered`, `orderCancel` and `legacyDelivered`. Old `orderConfirm` and `confirmLegacyCollection` shortcuts return a validation error directing users to version-bound confirmation. Commands use the existing ERP service, revision checks, serializable transactions, audits and persisted receipts.
- Price List's `shared-quotation` endpoint additionally handles the local `quotationPdf` action and versioned print/status/download output. ERP's authenticated integration authorizes creator mutations independently of its session endpoint.
- `shared-quotation?draft=1` adapts canonical versions into the existing draft controls. Shared saves retain customer code, reference and internal notes as additive version data. Existing saved currency, tax basis and totals are preserved instead of using current local pricing defaults.
- `approveCollection` accepts an optional `poReference` on allocations without changing order acceptance or confirmation identity. Explicitly confirmed orders with historical local line keys can be assigned in place; subsequent partial assignment extends the original allocation and collector job rather than creating another job; no replacement order or quotation is created.
- A lost response retains the original command payload, revision and event ID even after background refresh. Explicit validation/conflict responses allow a fresh attempt after loading the latest version. Failed saves never appear committed.
- Identical saves create no extra version. Repeated confirmation content is rejected, and collection allocations cannot be created twice. Committed updates retain their existing outbox identities and stale-revision protection.
- Later quotation edits do not alter accepted orders. Cancel remaining uncollected quantities explicitly before confirming changed accepted quantities against another quotation version.
- Old local issue/revision/duplicate/PDF paths are guarded for workflow-managed quotations. The native quotation screen routes shared documents through canonical commands. New local collection-order creation is blocked; existing historical orders, allocations and jobs are preserved.
- Explicitly rejected obsolete collection assignments with the known ERP HTTP 409 are marked `REJECTED` and stop retrying. Their history remains visible. Uncertain network failures retain safe retries. Collection progress displays canonical jobs rather than rejected local pending markers.
- Both quotation lists project committed canonical status and totals onto the original document. This is synchronized display metadata, not a second quotation record. Print/PDF presentation retains the original Price List quotation number and shared version identity.

## Manual rollout

Deploy both applications together using the existing paired integration configuration and workflow flags. Keep the Price List worker running for PDF generation. Do not activate production until the manual staging pilot passes:

1. From Pricing & Collection Jobs, create a quotation through the existing Edit draft menu. Check staff price notes, conversion, the same document number, canonical values in both lists, and the ERP version. Verify ERP creator mutations are rejected while staff jobs still work.
2. Confirm only some items, assign collectors, record partial pickups, and mark partial delivery with references. Reject collection before confirmation and delivery above collected balances.
3. Retry after an uncertain response and attempt simultaneous edits. Check for duplicate versions, orders, allocations, tasks and delivery movements.
4. Edit a quotation after confirmation and verify the accepted version remains unchanged. Test explicit cancellation/reconfirmation for changed remaining quantities.
5. Open the previously failed legacy assignment: confirm it stops retrying the obsolete endpoint, explicitly confirm its saved quotation, then assign its existing order from quotation details, and verify no replacement order appears. For the pasted historical request with old pickups and no shared confirmation, verify delivery is hidden and rejected by ERP. Confirm the selected saved version, then deliver the original collected balances without replacement records.
6. Interrupt integration, verify visible errors, restore connectivity and retry safely.
7. Print/download the same selected version and compare the themed PDF with ERP values. Check multi-page output, branding, tax and absence of supplier costs.

Deployment and the live pilot remain manual. No external messages or remote deployments are performed by the local verification.

## Local verification — 5 October 2026

All 96 ERP workflow tests and 36 Price List workflow/quotation tests pass. ERP workflow verification covers version-bound confirmation, historical pickups, partial acceptance and assignment, combined delivery, retries, duplicate prevention, quantity limits and creator authorization. Price List verification covers quotation-only creation, Jobs-origin fulfilment actions, one combined delivery form, the native editor, and canonical themed PDF output.

Both production builds and the Price List typecheck pass. ERP full typecheck still reports existing mobile, finance and page-export errors; the changed workflow files have no reported type errors. Targeted ERP workflow lint passes.

Deployment and the live pilot are manual; no live data has been changed.
