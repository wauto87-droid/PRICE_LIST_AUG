# AMT Electric Price List

Advanced admin features: [Excel templates, reviewed bulk rules, global quotation numbering and branding](docs/ADVANCED-ADMIN.md). Open **Admin → Imports / PDF**, **Bulk pricing rules**, or **Quotation Settings**.

AMT-branded bilingual English/Arabic counter lookup, protected pricing, reviewed imports, and immutable quotation snapshots. Built with Next.js/React, TypeScript, PostgreSQL and isolated background services. This is an application with persistent backend data, not a static mockup.

## Current handoff

- Local development preview: `http://127.0.0.1:18180` while `pnpm dev` is running.
- Local preview credentials are in `.data/dev-access.json` (git-ignored). Preview products are explicitly development fixtures; production starts empty and requires secure setup.
- The application has **not been deployed to the VPS**. Read-only inspection confirmed Podman/Compose, Caddy, available port 18180 and an unused target directory. SSH-key access, password rotation, runtime/recovery verification and domain/HTTPS remain release gates.
- See `docs/VERIFICATION.md` for tested behavior and remaining production checks. Do not treat local tests as proof of live-server isolation, restoration, or iPhone installation.

## Start locally

Requires Node.js 24 and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm exec tsx scripts/dev-prepare.ts
pnpm dev
```

`dev-prepare` creates a local embedded PostgreSQL-compatible PGlite database, sample catalog, and random local-only administrator credentials. It refuses to overwrite an existing database. The production runtime refuses embedded storage.

For background extraction locally, set `PYTHON_BIN` to a Python environment containing `scripts/requirements.txt`. Install Poppler and Tesseract with English/Arabic language data for scanned PDFs. Install Chromium with `pnpm exec playwright install chromium`, or set `CHROMIUM_EXECUTABLE` to a local Chromium binary. `.env.local` can set `DEV_WORKER=true` to run the worker in the same process as the embedded development database. **Do not start a separate worker process against PGlite.** Production uses independent services sharing actual PostgreSQL.

## Validate

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod
pnpm benchmark
```

Worker integration tests require `RUN_WORKER_TESTS=true`, Python dependencies and Chromium. They produce a multi-page Arabic/English PDF in `test-results/`. CI supplies these dependencies and runs the worker tests. The benchmark creates 100,000 records in an isolated in-memory database, never in the shop database.

## Project map

- `app/`, `frontend/`: AMT screens, English/Arabic UI, responsive styling and API client.
- `backend/auth/`, `products/`, `pricing/`, `quotations/`: authorization and authoritative business rules.
- `backend/imports/`, `worker/`, `pdf/`: staged imports, extraction queue and snapshot PDF rendering.
- `backend/admin/`, `core/`: administration, database access and audit records.
- `database/`: ordered transactional SQL migrations.
- `scripts/`, `docker/`, `compose.yaml`: operation, extraction, backups and deployment.
- `tests/`: pricing, API security, PostgreSQL-backed workflow, and worker tests.

## Business behavior

Both pricing methods share one catalog and search. Costs and minimums are omitted from staff API payloads unless explicitly permitted. The browser submits product IDs, quantities, and discount requests; the backend computes all authoritative prices.

Products can offer Wholesale, Retail and End Customer levels, each fixed or formula-based, with an admin-selected default. Staff see every active level and select one before adding a line. Discount limits and one shared product minimum apply to all levels. Before-VAT values are prominent; VAT-inclusive values remain smaller bold references. Configure levels through **Admin → Products → Edit → Selling levels**, preview, then confirm. Existing products migrate to one End Customer level with unchanged prices.

Saved drafts retain snapshots. Issuing requires a server-generated review token bound to current prices, permissions and company settings. Issued quotations cannot be edited or deleted. Duplicate creates a current-price draft without carrying forward below-minimum approval.

Imports are never auto-published. Map columns, inspect original data and differences, correct errors, select decisions, verify rows, **save decisions**, then confirm import. Duplicate rows within a file must be resolved. An import rollback is all-or-nothing: later edits block it; newly created products are archived rather than erased.

Offline price caching is disabled by default. When enabled, only sanitized recent search results and the current account's draft are stored on that device. Offline prices are explicitly unconfirmed; final issue/print/PDF requires the server. Reconnect, recalculate, and explicitly save. Version conflicts stop the save so another user's changes are not silently replaced. Use trusted shop devices only; browser-local data is not an encrypted vault.

The header always shows **Install App / تثبيت التطبيق**. On production HTTPS, Chrome/Edge/Android uses the native install prompt; iPhone/iPad displays Safari **Share → Add to Home Screen** instructions. The development preview explains why installation caching is disabled instead of silently hiding the control. An already installed standalone app displays **App Installed**.

## Operation guides

- `docs/DEPLOYMENT.md`: isolated VPS preflight, installation, SSH tunnel and HTTPS.
- `docs/BACKUP_RESTORE.md`: schedules, retention, isolated restoration and recovery.
- `docs/UPGRADE.md`: backup-first upgrades without touching other applications.
- `docs/PRICING.md`: rounding, discount/floor precedence and snapshots.
- `docs/API.md`: API routes, permissions, payloads and conflicts.
- `docs/VERIFICATION.md`: evidence, limitations and release gates.

The existing `GitHub/work` application is not a dependency and is not modified. Only its AMT SVG logo was reused. No VPS password is included in source or deployment files.
