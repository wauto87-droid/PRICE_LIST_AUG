# Backup and restore

The dedicated backup service runs a PostgreSQL custom-format dump at least once per 24-hour window and services Backup Now requests. Defaults retain 14 days; settings permit 3–365 days. Files have restrictive permissions and live in the project-specific `amt-pricelist_backups` volume, surviving app/container replacement. Retention deletes only recorded, validated `amt-*.dump` filenames inside the backup directory and marks their records EXPIRED.

Each completed dump is checked with `pg_restore --list`; that is a structural check, **not a restoration drill**. Interrupted jobs are marked failed; an administrator can request another backup. Monitor failures and copy backups off-host using your established secure backup infrastructure. Local VPS volumes alone do not protect against host loss.

## What to preserve

- Database dump: catalog, prices/history, users/roles, customers, quotes/snapshots, settings, import rows and audits.
- `amt-pricelist_uploads` volume: original supplier files and generated PDFs. These are separate from `pg_dump` and must be included in filesystem/off-host backups if retention of source files is required. Quotations can regenerate PDFs from their snapshots.
- Private `.env`, release version and this source package. Store secrets encrypted and separately from public source.

## Isolated restore drill (required before launch)

Select one exact backup filename from the Backups screen. Copy that one dump from the backup service to a restricted local staging directory; do not use guessed wildcard paths. Verify its checksum before/after transfer.

Create a **new temporary PostgreSQL 17 container with its own network, volume and credentials**, with no public database port. Name it unambiguously for the drill, such as `amt-pricelist-restorecheck`. Do not restore into the live shop database or any existing app database.

Inside the temporary environment:

```sh
pg_restore --list /restore/selected-backup.dump
pg_restore --exit-on-error --no-owner --no-acl --dbname=amt_restorecheck /restore/selected-backup.dump
```

Supply PostgreSQL connection parameters through environment variables/private credentials, not command history. Confirm catalog counts, recent price history/audit entries, quotations and VAT snapshots, user role integrity, and a known quotation's totals. Run the app against the restored test database in an isolated test configuration, verify search/login/PDF generation, and record the result/date/checksum. Stop and remove only explicitly identified drill resources after approval.

## Actual recovery

Schedule a shop-only maintenance window; capture a fresh emergency copy of the current shop data where possible. Stop only this project's app, worker and backup service. Restore into a **new project-owned replacement database**, verify it using the drill checks, then switch only this project's connection configuration. Keep the old database available for rollback. Never use `--clean`, drop the live database, delete volumes, or restore over another application's database without a separately reviewed recovery operation.

After recovery, invalidate restored sessions (`DELETE FROM sessions` in the verified replacement shop database), restart only this project's services, verify counters and immutable quotes, and resume backup monitoring. Recovery is not complete until an operator verifies both shop functionality and unrelated VPS services.
