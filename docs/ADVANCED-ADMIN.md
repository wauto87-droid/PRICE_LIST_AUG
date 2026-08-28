# Advanced administration

## Excel workflow

Download Simple Price Update, Simple Supplier Pricelist, or Advanced Catalog from **Admin → Imports / PDF**. Importable data goes in the first worksheet; Instructions and Examples are reference sheets. Keep part numbers as text and paste values, not spreadsheet formulas.

Simple `WHOLESALE.sellingPrice`, `RETAIL.sellingPrice`, `END_CUSTOMER.sellingPrice` explicitly set fixed before-VAT prices for populated cells. Advanced level fields retain FIXED / COST_MARKUP / LIST_DISCOUNT formulas. Blank/unmapped cells preserve current values and other levels. Supplier list prices belong in `listPrice`, not confidential purchase `cost`.

Update Existing Only is the default: unknown parts cannot publish. Create & Update requires PRODUCT_CREATE at mapping and publication; each new item must be verified individually. Save decisions, use **Preview saved prices**, inspect old/new amounts and percentage differences, then confirm. The 30-minute confirmation fingerprint binds rows, job/product/settings versions, actor and permissions. Duplicates must be resolved. Retries do not reapply completed imports; rollback refuses later-edited products and retains history.

## Reusable rules

Admin → Bulk pricing rules edits the catalog. The panel inside an import stages changes only, requiring separate import confirmation.

Choose Match all/any, conditions and actions. Text supports EQ/PREFIX/CONTAINS, numeric ranges GTE/LTE. Target DEFAULT, ALL, WHOLESALE, RETAIL or END_CUSTOMER. Import states: EXISTING, UNKNOWN, VALID, ERROR, CHANGED, UNCHANGED, DUPLICATE. Catalog states: EXISTING, ACTIVE, ARCHIVED, VALID.

Actions set values or increase/decrease numeric fields by a percentage. Fixed-price conversion requires method = FIXED and fixedPrice = the amount. Shared cost recalculates cost-based levels. Minimum protection remains enforced.

Example: partNumber PREFIX `BKJ`, state EQ `VALID`, Match ALL; decision SET `UPDATE`, verified SET `true`. Acknowledge source verification, preview all matches, apply, then preview/confirm the import. New products and uncertain PDF values require individual verification. Editing values invalidates prior verification unless an eligible explicit verification action accompanies the change.

Rules evaluate the complete dataset, with a maximum of 10,000 matches per execution and 50 preview rows per page. Visible-row/checkbox selection requires a new preview. Named rules support save, rename, duplicate, deactivate/reactivate and delete. Deletion retains execution history. Exact definitions, author, match counts and execution times are recorded separately from imports. Stale previews fail; application is transactional and retry-safe.

## Quotation search, numbering and branding

Search exact quotation numbers or prefixes, status and inclusive Saudi-calendar date bounds. The latest 200 matches are returned. My quotations is always the default. All quotations requires QUOTE_VIEW_ALL; knowing a number or ID grants no access.

New issuance uses PostgreSQL BIGINT `quotation_serial_seq`, NO CYCLE, default CACHE 1. `nextval` is not rolled back: failed issuance burns the serial. Successful allocations are recorded in `quotation_allocations`, with unique constraints on serial and number. Concurrent requests may commit in a different order than they allocate. Gaps are intentional.

Migration 004 keeps existing issued numbers/snapshots and seeds future serials above their largest numeric suffix. Prefix changes never reset the sequence. Admin → Quotation Settings can only raise the next serial, with confirmation and a reason. General Settings retains currency/default VAT; Quotation Settings controls unit-price display and future numbering.

Configure company/legal names, registrations, address/contact, banking, validity, delivery/payment, bilingual terms, notes, signature/footer, logo and watermark. Preview does not save. Uploaded PNG/JPEG/WebP artwork is limited to 500 KB in the UI and snapshotted at issuance; AMT's built-in logo is snapshotted too. Watermark defaults off with bounded opacity, size, rotation and position. PDF/print share snapshot-based rendering and exclude alternative levels/internal costs and formulas.

## New REST interfaces

All paths below are under `/api/v1` and require the existing authenticated session and mutation CSRF protection.

- `GET /templates/simple|supplier-simple|advanced`: IMPORT_CONFIRM; advanced additionally COST_VIEW.
- `GET/POST /bulk-rules`, `PUT/DELETE /bulk-rules/:id`, `GET /bulk-rules/history`: PRODUCT_EDIT + COST_VIEW. Updates include rule version; delete is soft.
- `POST /bulk-preview`: `{scope, importId?, ruleId?, definition, selectedIds?, acknowledgeVerification?}`. Requires COST_VIEW plus IMPORT_CONFIRM or PRODUCT_EDIT. Returns a preview ID, match/error count and first 50 items.
- `GET /bulk-preview/:id?page=0`, `POST /bulk-preview/:id`: actor-owned preview paging/application. Import application stages changes only.
- `POST /imports/:id/mapping`: includes optional `mode: UPDATE_ONLY|CREATE_UPDATE`.
- `POST /imports/:id/preview-confirmation`: returns token and saved price differences. `POST /imports/:id/confirm` now requires `{version,token}`.
- `GET /quotations?q=AMT-QT-&scope=mine&status=ISSUED&from=2026-08-01&to=2026-08-31`.
- `GET/PUT /admin/quotation-settings`, `POST /admin/quotation-settings/preview`: SETTINGS_MANAGE. Save includes version; optional nextSerial increase requires reason. Image values are embedded data URIs, never remote fetch URLs.

## Upgrade and recovery

Back up, then run `pnpm migrate` against the dedicated PostgreSQL database before upgrading production app/worker services. Development hot reload checks additive migrations using the existing embedded connection, without opening another writer. Do not open a second embedded process against the running preview's directory.

Restore backups into an isolated database first. Before allowing issuance from a restored database, reconcile the serial high-water mark with every quotation allocated/printed since the backup and raise the next serial above that mark. A stale restored sequence must never resume issuance. Preserve sequence state, allocation records and audit history in backups.

## Verification boundaries

Tests cover both templates, 856-row selection, safe import modes, stale previews, retries, rollback, sequence rollback gaps, overlapping issue calls, prefix/increase rules, search ownership and immutable branding. The worker generates a four-page bilingual PDF with watermark and terms; every page was visually inspected.

The attachment contains pasted import-screen text, but the original XLSX was subsequently found in the local app's staged uploads. Read-only extraction confirmed 856 rows. The optional `LS_WORKBOOK_PATH` test exercises its mapping and grouped previews in an isolated database; the live import was not confirmed or modified. Its saved `P.L (SAR)` → cost mapping with LIST_DISCOUNT needs administrator correction to listPrice before publishing. PGlite uses PostgreSQL semantics but serializes transactions; multi-connection concurrency/load testing on deployment PostgreSQL remains a release check. VPS/domain/HTTPS deployment is separate.
