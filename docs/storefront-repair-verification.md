# Storefront repair verification — 2026-09-07

## Implemented

- Storefront admin tab URLs survive refresh and browser history. Staff product
  shortcuts open the exact product; customer accounts cannot access staff APIs.
- New-product saving keeps the editor open for images. Images have an explicit
  cover action, captions, ordering and removal; image-only management does not
  require access to costs. Saving and storefront publication have distinct labels.
- Bulk publication retains failed/unprocessed selections and reports partial
  results. Management requests cannot overwrite newer responses.
- Storefront management no longer depends on unrelated order/warehouse requests.
  WhatsApp management remains accessible if the catalog management request fails.
- Category routes return a proper 404 for unavailable categories/closed stores,
  with empty-state content for active categories without published products.
  Store routes have retry and unavailable pages.
- WhatsApp has bounded initialization, expiring QR display, generation guards for
  stale browser events, explicit session clearing on disconnect, and distinct
  configuration/connection/token diagnostics.
- The guided installer accepts provider settings and optionally supervises one
  WhatsApp service with the release. See `commerce-release.md` for configuration.

## Verified locally

- Full application suite: 206 passed, 2 pre-existing skips.
- Final targeted WhatsApp tests: 5 passed (expiry, stale events, timeout recovery,
  credential reset and transport diagnostics).
- Deployment suite: 101 passed, 1 skipped.
- TypeScript and optimized production build passed.
- Commerce browser journey passed publishing, images, create-then-upload, banners,
  product pages/metadata, category SEO, mobile layout and Arabic direction.
- Signup browser journey passed admin QR display/status, required verification,
  failed delivery, registration and password login with a simulated provider.
- Additional browser journey passed exact-product editing, all existing core
  admin tabs, tab persistence, customer isolation and category 404 handling.
- No runtime page errors in those browser journeys. Mobile screenshot inspected.

## Production and external checks still pending

- The live homepage, catalog, homepage API and three sampled product pages returned
  HTTP 200. This is a read-only sample, not authenticated production acceptance.
- No production deployment, backup or database mutation was performed: SSH cannot
  proceed until the server host key is verified and key access is established.
- Real local WhatsApp browser startup timed out with Edge and cached Chrome,
  including a standalone Puppeteer launch. No real QR or phone pairing was
  verified. Recheck the managed service on the deployment host with supported
  Chromium, its sandbox policy, private token, session permissions and network.
- Actual phone pairing, restart restoration, explicitly authorized test delivery
  and real payment-provider checks remain release gates. No messages were sent.
- No database schema changes are required for these repairs.
