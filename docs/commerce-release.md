# Commerce release and WhatsApp signup

New personal and company accounts require a WhatsApp SIGNUP challenge for their exact normalized mobile number. Checkout and LOGIN challenges cannot register an account. Phone changes invalidate the signup proof. Personal accounts become active after verification; company profiles await staff approval. Existing password login remains available. Existing accounts with ambiguous shared mobile numbers must use password login until staff corrects their records.

## Deployment

### Guided installer QR service

The guided installer now accepts the storefront provider environment keys. Earlier
versions rejected WhatsApp/payment configuration as unknown environment keys and
did not supervise the QR service.

In the deployment's private `shared/.env`, set `WHATSAPP_MANAGED=true` and a random
`WHATSAPP_SERVICE_TOKEN` of at least 32 characters before upgrading. PM2 runs one
`amt-pricelist-whatsapp` process on loopback port 3010, with its session under
`shared/runtime/whatsapp-session`; its app URL is set automatically. Compose builds
and starts the private `whatsapp` service with the same release as the app. Do not
also run a manually started service against the same session directory or port.
Stop the managed service before disabling its management flag.

PM2 uses the installer's Playwright Chromium unless `CHROMIUM_EXECUTABLE_PATH` is
set. Host Chromium keeps its sandbox enabled by default; use an appropriate
unprivileged host process. A root-managed host must explicitly configure its
Chromium sandbox policy (`WHATSAPP_NO_SANDBOX=true` is supported). The container
already supplies its isolated runtime policy. Do not delete the persistent
session during an upgrade. **Disconnect** explicitly clears pairing credentials;
reconnect preserves them.

Startup is bounded to 90 seconds. The admin displays QR expiry and safe connection
diagnostics, and remains accessible when unrelated store-management requests fail.
Missing service configuration, unreachable service, and mismatched tokens have
distinct errors. Actual pairing still requires scanning with the company phone.

1. Back up PostgreSQL and uploaded files. Build the app and worker, and apply additive migrations through `026_signup_verification.sql` using the existing migration command. Keep the commerce switches disabled until staging acceptance.
2. Set a random `WHATSAPP_SERVICE_TOKEN` of at least 32 characters in the deployment environment. The application and WhatsApp service must use the same token. The Compose URL is `http://whatsapp:3010`; the service has no published host port.
3. Build and start the optional service with `docker compose --profile whatsapp up -d --build whatsapp`. Its Chromium session persists in the `whatsapp_session` volume. Do not run multiple instances against that volume.
4. In **Commercial → Storefront → WhatsApp OTP**, connect and scan the QR using the company phone's **Linked devices** screen. Confirm READY, then explicitly send a test message to a number you control. The application never marks failed delivery as successful.
5. Set `PUBLIC_URL`, existing Moyasar credentials, and optional notification/legacy OTP webhook configuration. Configure delivery/pickup locations, banking instructions, and company credit terms in admin. The app and worker have outbound connectivity for configured providers; PostgreSQL remains on the private network.
6. Run staging acceptance, then enable storefront, business, and operations switches together. Online holds default to 15 minutes; bank review holds default to 24 hours. Cash on delivery is excluded.

The QR service uses whatsapp-web.js to operate WhatsApp Web with Chromium. Pairing requires physical access to the company phone. Session storage contains authentication material and must remain private. A disconnection blocks new OTP delivery; existing customers can still use password login. The QR adapter is separate from Meta's official Cloud API.

For a host-managed deployment, run `node scripts/whatsapp-service.cjs` as one supervised process with `WHATSAPP_SERVICE_TOKEN`, `WHATSAPP_SESSION_DIR`, and `CHROMIUM_EXECUTABLE_PATH` configured. Set the app's `WHATSAPP_SERVICE_URL` to that private service. The Docker service uses an isolated, unprivileged container with Chromium's sandbox disabled; the host-managed default leaves Chromium's sandbox enabled.

## Admin workflows

- **Products:** add/edit, review exact SKU image matches before upload, filter publication or missing content, select a page or all matching products, publish/unpublish, and review per-product conflicts. All-matching selection is limited to 10,000 products per operation; narrow filters for larger catalogs.
- **Bulk import workspace:** opens Catalog Management → Add / Import. Publishing requires an active product; unpriced products remain available for quotation requests.
- **Homepage:** manage scheduled banners and sections, plus category SEO titles/descriptions in English and Arabic. Existing public product metadata never uses company prices.
- **WhatsApp OTP:** inspect QR/connection status, reconnect, disconnect, and explicitly test delivery. Staff login remains unchanged.

## Verification

- `pnpm typecheck`, `pnpm test`, and `pnpm build` cover application compilation and the existing regression suite.
- `tests/storefront-signup.test.ts` covers required proof, purpose isolation, phone changes, expiry, attempts, resend cooldown, single use, retail/company signup, login fallback, and provider failure.
- `tests/commerce-management.test.ts` covers pricing, company isolation, requirements, stock/credit holds, simultaneous submissions, coupons, fulfillment, returns, and management selection. These database tests run on embedded PostgreSQL; repeat concurrent acceptance against the deployed PostgreSQL service.
- `tests/browser/commerce.mjs` exercises admin creation, bulk publishing, the formerly broken import link, image upload, banners, public metadata, mobile layout, and Arabic direction against an isolated local database.
- `tests/browser/commerce-signup.mjs` uses a local WhatsApp stub and isolated server on port 18183. It verifies the admin QR/status interface, failed delivery, mandatory signup verification, registration, and password sign-in. It does not pair a real phone or send real WhatsApp messages. A separate runtime check successfully launched the real Chromium adapter and generated an unpaired QR code.

Production acceptance must additionally exercise actual QR pairing/session restoration, actual message delivery, provider payments, and configured delivery operations. Disabling feature switches stops rollout without removing existing records; do not reverse additive migrations to roll back the UI.
