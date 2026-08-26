# REST API v1

See [advanced admin interfaces](ADVANCED-ADMIN.md#new-rest-interfaces) for templates, bulk rules, import preview tokens, quotation search and branding settings. Import confirmation now requires `{version, token}` from `/imports/:id/preview-confirmation`.

Base path: `/api/v1`. Same-origin JSON requests; cookies are HttpOnly, SameSite=Strict, and Secure in HTTPS deployment. Authenticate with `POST /auth/login`, retrieve the session and CSRF token through `GET /auth/me`, and send `X-CSRF-Token` on all mutations. Origin must exactly match APP_ORIGIN. Responses use `Cache-Control: no-store`.

Public routes: `GET /health`, `GET /setup`, token-protected `POST /setup`, rate-limited `POST /auth/login`. Setup is serialized and disabled once any user exists.

| Capability             | Routes                                                                                                          | Authorization                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Lookup                 | `GET /search?q=...`, `GET /products/:id`, `POST /pricing`                                                       | PRODUCT_VIEW; field-level filtering                                                  |
| Product administration | `GET/POST /products`, `PUT /products/:id`, `POST /products/bulk`                                                | Create/edit plus COST_VIEW for pricing mutations                                     |
| Drafts                 | `GET/POST /quotations`, `GET/PUT/DELETE /quotations/:id`                                                        | Quote permission plus ownership/all-record permission                                |
| Issue                  | `POST /quotations/:id/review`, `/issue`                                                                         | QUOTE_ISSUE plus ownership/edit-all                                                  |
| Duplicate              | `POST /quotations/:id/duplicate`                                                                                | Source visibility + QUOTE_CREATE                                                     |
| Print/PDF              | `GET /quotations/:id/print`, `POST /quotations/:id/pdf`, `GET /documents/:job`, `/download`                     | Quote visibility                                                                     |
| Customers              | `GET/POST /customers`                                                                                           | QUOTE_CREATE                                                                         |
| Imports                | `GET/POST /imports`, `GET /imports/:id`, `POST /imports/:id/mapping`, `/review`, `/confirm`, `/rollback`        | Import permission + COST_VIEW; confirmation requires IMPORT_CONFIRM and PRODUCT_EDIT |
| Spreadsheet export     | `POST /exports`, `GET /exports/:job`, `/download`                                                               | EXPORT and job ownership; sensitive workbooks require current COST_VIEW              |
| Administration         | `/admin/dashboard`, `/settings`, `/users`, `/roles`, `/brands`, `/categories`, `/history`, `/audit`, `/backups` | ADMIN_VIEW and capability-specific permission                                        |

All mutation payloads use strict server schemas. Pricing requests:

```json
{
  "productId": "UUID",
  "sellingLevel": "WHOLESALE",
  "quantity": "5",
  "discount": "20",
  "override": false,
  "reason": ""
}
```

Draft creation:

```json
{
  "customer": { "name": "", "number": "", "mobile": "", "reference": "" },
  "lines": [
    {
      "productId": "UUID",
      "sellingLevel": "RETAIL",
      "quantity": "5",
      "discount": "20",
      "override": false,
      "reason": ""
    }
  ]
}
```

Draft updates include `version`. Product updates include `version`. Import mapping/confirmation include the reviewed job `version`. HTTP 409 means reload/review rather than blind retry. Issuance accepts only `{ "token": "review fingerprint" }`; the token binds the draft version, current product values, permissions and company settings.

Draft deletes soft-delete only drafts. Issued quotes are immutable. API money/percent values are decimal strings; quantity precision is a small integer. Boolean settings remain booleans. Part identifiers use NFKC + trim + uppercase, with meaningful internal punctuation preserved.

Import uploads are multipart form-data field `file`. Files are stored under random identifiers outside the public web tree. Mapping uses system-field-to-column-name pairs plus explicit defaults. `UPDATE` means insert a new product or update the matched version; `KEEP`/`SKIP` leave live products untouched. Review decisions must be saved before confirmation.

Responses are bounded: search/catalog returns up to 50 matches; quote list 200; histories 300; imports 10,000 rows/job and 100 listed jobs. Narrow catalog searches rather than downloading the whole database. Exports stream the catalog in 1,000-row batches through the isolated worker using a repeatable-read database snapshot. These operational limits are explicit, not silently unlimited.

The cart sends a stable UUID `requestId` on initial draft creation. Repeating the same request returns the existing draft; changing the input under the same key returns a conflict instead of silently creating another quotation.

## Multiple selling levels

Products accept `levels` (one to three unique entries) and `defaultLevel`. Codes: `WHOLESALE`, `RETAIL`, `END_CUSTOMER`. Every entry has `code`, `active`, `method` (`FIXED`, `COST_MARKUP`, `LIST_DISCOUNT`), `fixedPrice`, `markup`, `listPrice`, and `baseDiscount`; monetary/percentage values are strings. Cost, VAT, minimum and units remain product-wide. At least one level must be active and the explicitly selected default must be active. Top-level legacy method/formula fields mirror the default; legacy updates without `levels` update only that default formula and preserve other levels.

Staff responses include safe `sellingLevels: [{code, masterExcl, masterIncl}]` and `defaultLevel`. Internal `levels` formulas are COST_VIEW-only. Pricing requests accept optional `sellingLevel`; omission on a new request uses the current default. Quotation snapshots persist the resolved code in `input.sellingLevel`, `sellingLevel`, and `price.sellingLevel`. Inactive or unknown levels are rejected; clients must request review after changing a draft's level.

Bulk pricing accepts `sellingLevel` (`DEFAULT`, `ALL`, or a code) for MARKUP, BASE_DISCOUNT and FIXED_PRICE. Targets must use the corresponding method; mismatches fail before confirmation. Cost changes affect shared cost, VAT/minimum changes affect the whole product. Preview returns before/after amounts for every active level.

Import/export columns include `defaultLevel` and each code's `.active`, `.method`, `.fixedPrice`, `.markup`, `.listPrice`, `.baseDiscount` (for example `WHOLESALE.fixedPrice`). Blank/unmapped columns preserve existing values and other levels. New tiered products require `defaultLevel` plus a method for each supplied level. To disable a level, explicitly map `.active=false` and choose another active default. Legacy import defaults apply to new products, not unmapped existing fields. Reviewed changes and rollback include every level. Staff exports include only level selling amounts, never formulas, cost or minimums.
