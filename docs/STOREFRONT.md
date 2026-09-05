# Storefront management and verification

Open **Commercial → Online store → Store settings**. Check **Store is open** and save. Under **Products**, search the catalog and publish the products you want customers to see. Products must be active and have an active selling level. Existing products are not automatically published by migration.

The public address is `/amt_price_list/store`. A disabled store displays a branded closed message without requesting the catalog. Direct catalog requests while closed return JSON `404` with `Online store is not available`; an HTML 404 instead indicates a deployment/base-path problem. Verify the full request path is `/amt_price_list/api/v1/storefront/catalog`.

Use **Delivery zones** to configure active zones, fees and optional free-delivery thresholds. Thresholds apply to the merchandise subtotal before VAT, preserving the existing pricing policy. Enable pickup and configure active pickup locations under **Commercial → Warehouses**. Delivery checkout requires a zone and address; pickup requires an available branch.

Use **Business accounts** to approve, block, assign pricing levels and set credit limits. Registration verifies the applicant's email and awaits approval. Guest checkout verifies the supplied mobile. Blocking an account invalidates its sessions. Online orders display the associated business or guest contact; an order can become a sales order only once.

**Stock** has search across the inventory, 20/50/100 rows per page and page navigation. Click a part number for full details and images when your role has product-view permission.

## Server configuration

- `APP_ORIGIN`: exact browser origin, including scheme and port, used to validate mutations.
- `COOKIE_SECURE=true` on HTTPS deployments; `false` only for local HTTP development.
- `PUBLIC_URL`: public origin or application URL. Card returns always use its origin plus `/amt_price_list/store?payment=return`.
- `OTP_PROVIDER_URL` and `OTP_PROVIDER_TOKEN`: server endpoint accepting JSON `{destination, channel, code}` with a bearer token. `channel` is `SMS` or `EMAIL`. Return a successful HTTP response only when delivery is accepted. Codes are never returned to production clients. Requests are limited to five per destination per 15 minutes, and each challenge permits five verification attempts within ten minutes.
- `MOYASAR_PUBLISHABLE_KEY` and `MOYASAR_SECRET_KEY`: use test keys during verification. Card data goes directly from the browser to Moyasar's token endpoint; only its token reaches this application.

Run migrations before restarting the production app: `pnpm migrate`. Migration 024 adds checkout request ownership and retry serialization; it preserves store activation, publication choices and existing orders. Deploy the matching backend and frontend together. Older orders remain visible to staff.

## Checkout recovery

The preview endpoint calculates prices, VAT and delivery. HTTP checkout requires that preview hash and refuses changed prices. Checkout reserves one order and one provider reference before contacting Moyasar. Retries use the same `given_id`, following [Moyasar's create-payment API](https://docs.moyasar.com/api/payments/01-create-payment). A timeout must be retried from the saved checkout rather than creating another attempt. Payment status is fetched from Moyasar using the server secret and checked against currency, amount and order metadata.

The cart is stored locally. An unfinished checkout is stored in session storage, excluding raw card fields. Guest order status requires the verification token; business order status requires the owning account. Pending payment returns provide a refresh action. Non-card orders require AMT review and confirmation of payment arrangements.

## Release checks

Run `pnpm typecheck`, `pnpm test` with `NODE_ENV=test`, and `pnpm build`. The storefront regression suite covers disabled-store routing, publication, filters/counts, rounding, OTP lockout/expiry, delivery thresholds, retry ownership, business credit, payment verification and stock pagination.

Browser smoke checks: closed store, enabled published catalog, search/filter/reset, real image/detail view, persistent cart, quantity editing/removal, guest verification, business login, delivery/pickup, reviewed total, order confirmation, pending/failed/paid card return, keyboard dialog focus, English/Arabic and mobile overflow. Live SMS/email delivery and real gateway behavior require the deployment's provider credentials and must be checked with test recipients/cards before opening checkout to customers.
