# Verification and release gates

Date: 26 August 2026. Environment: Windows development workspace; Node.js 24; PostgreSQL-compatible PGlite for local/integration checks. Production targets PostgreSQL 17 in isolated Docker Compose.

## Automated evidence

- Production Next.js build and strict TypeScript check pass.
- Pricing and API integration tests pass: both pricing methods, floor clamping, permission limits, explicit/reasoned overrides, fractional quantities, decimal rounding, zero-price handling, and VAT snapshots.
- Backend checks cover CSRF/origin rejection, staff field filtering, unauthorized endpoints, ownership, disabled sessions, normalized duplicates/aliases, product/draft version conflicts, immutable issued quotes, stale issue tokens, idempotent draft retries, and backup/export enqueueing.
- Import tests cover required review/verification, within-file duplicates, transactional import, safe rollback, and rollback refusal after subsequent edits.
- Worker tests pass for CSV extraction, malformed PDF/XLSX, oversized uploads, multi-page bilingual PDF generation, text-PDF extraction, page limits, and streamed permission-filtered XLSX export with literal formula-like strings.
- Local database close/reopen test passes, preserving setup state and authenticated sessions. This is not a substitute for a real PostgreSQL container restart test.
- Dependency audit: no known production vulnerabilities reported after pinning ExcelJS's UUID dependency to the patched version.

Run all locally available checks with `RUN_WORKER_TESTS=true`, `PYTHON_BIN`, and `CHROMIUM_EXECUTABLE` configured. At handoff, 58 automated test entries pass (including grouped suite entries). Request-size tests verify rejection before JSON/multipart parsing.

Selling-level coverage includes fixed/formula levels, one/two/three choices, explicit defaults, shared floors, discounts and overrides, migration without historical snapshot mutation, staff field filtering, forged inputs, stale review rejection, unavailable levels, per-level bulk previews, partial-import preservation, retry/rollback and XLSX round trips. Admin regression checks prevent stale dashboard objects from being rendered as arrays, validate response shapes, and browser checks cover Dashboard, Products, Brands, Categories, Users, Roles, Price history, Audit log, Backups and Settings.

PWA checks cover installed/development/insecure/iOS/prompt/unavailable states, manifest scope/start URL/icons, and service-worker API exclusion. The visible bilingual Install App button is present in development but explains that caching is intentionally disabled. Native prompt, installed-state and offline-launch acceptance still require a production build on localhost and the final HTTPS domain/device matrix.

## Performance

Isolated 100,000-product benchmark after selling-level support (one migrated level per product):

| Query       | Local p50 | Local p95 |
| ----------- | --------: | --------: |
| Exact part  |   40.3 ms |   45.2 ms |
| Part prefix |   51.4 ms |   69.0 ms |
| Description |   24.9 ms |   28.0 ms |

These are embedded local measurements, not live-VPS service-level results. Re-run on the target hardware and measure during OCR/import load before accepting the 200 ms p95 target.

## Visual and browser checks

- AMT logo, white-card layout, separate exclusive/inclusive prices and red final-price panel inspected.
- Bold English/Arabic selling-level cards verified on desktop/mobile, including RTL and Enter-key selection. Admin editor successfully created the local-only `AMT-TIER-DEMO` sample with fixed Wholesale 90, cost-plus Retail 100 (default), and list-discount End Customer 120 SAR. Changing the selected level preserves quantity/discount; cart switching recalculates correctly. The temporary test cart line was removed; the labelled sample product remains available for preview.
- Counter workflow checked in browser: exact part lookup, discount and quantity entry, floor result 110.00 / 126.50, subtotal 550.00, VAT 82.50 and total 632.50, add-to-cart/refocus, saved draft and price review.
- Four-page bilingual quotation PDF visually inspected after rendering all pages: Arabic text, repeated headers, page numbering, and total 19119.10 verified. Three font subsets are embedded.
- Development service-worker caching is deliberately disabled to avoid stale hot-reload assets. Test offline shell caching and installability on the deployed HTTPS origin.

## Outstanding production checks — do not mark as complete

1. Verified SSH-key access and rotation of the exposed VPS root password.
2. Recheck the completed read-only VPS inventory immediately before deployment: Podman 5.7.0 / Compose 2.32.4-3, active Caddy, eight unrelated containers, port 18180 free, target directory unused, approximately 43 GB disk / 4.6 GB RAM available on 2026-08-26. Runtime compatibility and build memory headroom remain unverified.
3. Actual Linux image builds and `docker compose config --quiet`/startup checks. Docker is not available in this Windows workspace.
4. Native PostgreSQL integration, service restart/recovery, real `pg_dump` backups and an isolated `pg_restore` drill.
5. Scanned-PDF OCR and legacy XLS acceptance with representative supplier files under the deployed Linux worker. Tesseract is supplied by the worker image but is not available in the local Windows runtime.
6. Live HTTPS domain, secure-cookie verification, Android/iPhone installation, offline reload/reconnection and real-device conflict testing.
7. Unrelated VPS applications verified healthy before/after deployment; live search load tested while OCR runs.
8. Operator-provided off-host backup destination and monitoring/alert integration, if required for host-loss recovery.

No VPS application, database, volume, reverse-proxy configuration or root password was changed. Local sample accounts/catalog are excluded from production. The existing GitHub/work application remains untouched.
