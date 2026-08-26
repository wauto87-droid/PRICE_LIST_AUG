# Upgrade safely

1. Record the running release, app-only environment and volume names. Review migrations before applying them.
2. Take and verify a new database backup; preserve the uploads volume and prior release. Ensure recent restore-drill evidence exists.
3. Run automated tests and production build in a staging copy. Exercise imports and PDF under Linux, not just local embedded tests.
4. Announce a short shop-only maintenance window. Stop only `amt-pricelist` app/worker/backup services to prevent writes during migrations. Leave unrelated services alone.
5. Build the new image and run the migration service for this project. Start app/worker/backup only after successful migration. Ordered migrations are applied transactionally; the initial deployment must have only one migration service.
6. Check login, search, a draft/review/issue, PDF, imports, backup queue, health and unrelated VPS applications.
7. Version the service-worker cache when static-shell compatibility changes. Do not force-reload users with unsaved carts. Tell staff to save drafts before updating installed PWAs.

If a deployment fails, keep the maintenance window and inspect the exact failure. Roll back app images only if the database schema remains backward-compatible. Otherwise restore into an isolated replacement database using the recovery guide, preserving the original. Never run global Docker cleanup or remove project volumes as an upgrade step.
