# Sales Workflow ↔ Price List

## Deployment and admin setup

This integration exchanges product identity only. It does not exchange prices, costs, invoices, quantities or stock postings. Catalog references are not verified accounting codes.

Deploy both repositories together after reviewing their Git changes. Apply the work Prisma migration `20261002120000_connected_apps` with `prisma migrate deploy` and Price List migration `034_connected_apps.sql` using its existing migration command. Do not use a schema reset. Disabling the feature preserves all integration records.

On each server set `CONNECTED_APPS_ENABLED=true` and a **different**, securely generated `CONNECTED_APPS_ENCRYPTION_KEY`: 32 random bytes encoded as 64 hex characters. Keep that encryption key in deployment secrets and include it in secure recovery procedures; losing it requires re-entering the outgoing API key. It is distinct from the API keys users generate in the admin screen. Do not change it without re-encrypting or re-entering outgoing credentials. Keep staging and production databases, URLs, encryption keys and API keys separate.

1. Work: **Admin → Integrations → Connected Apps**. Generate an incoming key with `notifications:write` and an expiry.
2. Price List: **Admin → Integrations / Connected Apps**. Save Work's integration URL (`https://HOST/api/sales-workflow/integration/v1`) and that key.
3. In Price List generate a separate incoming key with `catalog:read`, `proposals:write` and `proposals:read`.
4. In Work save Price List's integration URL (`https://HOST/amt_price_list/api/v1/integration/v1`, or `/api/v1/integration/v1` when hosted without the prefix) and that key.
5. Uncheck Pause, save, test both connections, and run Sync now in Work. A large initial catalog resumes over successive runs.

Keys display once. Rotation immediately revokes the old key: copy the replacement into the other app. Only full administrators can manage the connection or review incoming products. Outgoing credentials are encrypted with AES-256-GCM; incoming credentials are stored as SHA-256 hashes. Remote URLs must use HTTPS and resolve to public addresses; DNS is pinned per request and redirects are refused.

Work's existing server instrumentation checks for due work every minute. Successful syncs are due every five minutes. Price List's existing background worker checks every 30 seconds and sends change notifications when due; Work polling recovers missed notifications. Failures retry with capped exponential backoff. Manual Sync now retries immediately. A database lease prevents overlapping workers. Keep the Price List worker running for prompt notifications.

## Staff and review flow

Under **Sales Workflow → Item Directory**, expand the price-list catalog. Search by code, description, brand or alias. Search first to reveal Create missing product. Local proposals belong to the selected team and remain usable while awaiting review. Existing confirmed accounting codes remain in the separate accounting directory.

After customer PO confirmation, open the item's **PO item codes → Select catalog product / create missing product**. Select a catalog product or a local proposal, then separately select the accounting identity. Nothing automatically treats a catalog number as an accounting code.

Price List's **Incoming Products** queue supports creating regular products through its product/pricing editor, creating reusable items with an explicitly entered suggested price, linking existing items after specification review, requesting corrections and rejecting with a reason. Salesmen correct and resubmit rejected/change-requested proposals in Work. Admin decisions, actor, reason and previous proposal versions remain audited.

Regular products, reusable items, inactive records, blank references and reusable-to-product conversions retain separate stable identities. Conversion links and deletion tombstones remain in the cache. Inactive/deleted/converted entries cannot be selected for new PO lines. Historical PO, collection and exported handoff snapshots are never rewritten by remote changes. Material code/unit/conversion changes raise reconciliation exceptions for salesman review.

## Protocol and persistence

The protocol version is 1. Price List serves `GET health`, `GET catalog?after=<cursor>`, `POST proposals`, and `GET proposals?id=<UUID>` beneath its integration URL. Work serves `GET health` and `POST notifications` beneath its integration URL. All require scoped bearer keys; session-only admin endpoints cannot be called using these keys.

Catalog responses contain `{rows:[{identity,seq,data}],cursor,more}` with pages of 200, monotonic decimal-string cursors and product-only whitelisted fields. Identity is `<PRODUCT|REUSABLE>:<source UUID>`. A durable projection detects edits, alias changes, conversions and physical deletions across existing source write paths. JSON comparison is canonicalized, and sequence ordering is numeric. Cache rows and cursors commit together.

Proposal payload: `{id,revision,item,note}`. Local ID and revision are stable; repeated content returns the same proposal. Conflicting content at the same revision returns 409. Resubmission increments revision only after rejection or a request for changes. Approval returns the source identity, code, unit and review evidence. Notification IDs deduplicate. Both apps use dedicated `sw_link_*` tables; Work additionally uses its existing command receipts and request audit.

## Validation

Run Work's `sales-workflow*.node.test.ts` tests using `node --import tsx --test`. In Price List run `node --import tsx --test tests/connected-apps.test.ts`. Those tests use isolated embedded PostgreSQL databases and exercise the two app directions with generated test keys; they never contact live services or update customer data.

Before production, verify the live staging connection, initial counts against source counts, a new local product awaiting review, approval/linking and return status, outage retry, revocation, inactive/conversion behavior, and accounting-code separation. Live deployment configuration and real staging verification are separate from the isolated automated pilot.
