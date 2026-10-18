# Normal quotation entry redesign — 18 October 2026

Implemented locally on `codex/normal-quotation-entry-20261018`, after fetching and fast-forwarding the clean checkout from `774dabc` to `ddddd6a` (`origin/master`). No push or deployment.

## Behavior

- Normal mode keeps the existing app logo and theme, with compact customer details, a nine-column entry grid, notes and totals below.
- Every eligible item row searches catalogue products and saved custom items together. Results retain their source identities. Selecting a result replaces the row; typing or cancelling does not.
- An empty quotation starts with one editor-only row. Selecting an item and entering a positive quantity commits it and creates exactly one next row. Quantity focus is restored to the committed row. Unfinished rows never enter quotation totals or save payloads.
- No-match searches offer a custom editor immediately beneath the row. It validates details, checks catalogue references and reusable duplicates, and offers the existing saved item when found. New custom items become reusable through the existing quotation-save transaction; the editor explicitly explains this timing.
- Search failure is distinct from no match. Superseded responses are cancelled/ignored. Search works with keyboard, mouse and touch; popups stay attached to their row and can open above the field near the screen bottom.
- Existing sortable rows, colour groups, mouse/touch sensors, keyboard dragging and move buttons are retained. The draft row is outside the sortable set. The same drag handle survives normal/focused mode switches.
- Focused mode retains its six-column table and existing quick-add behavior. Linked quotations retain their existing item-identity and entry restrictions.

## Compatibility fix required for dragging

The latest pulled compatibility normalizer recreated every item object, causing stable sortable identities to remain at positions instead of following moved items. Already-normalized lines now retain their references and exact editable custom descriptions. Explicitly cleared quantities stay blank and block incomplete lines instead of silently becoming `1`. Legacy missing-input recovery and ambiguity warnings remain covered by tests.

## Validation

- Quotation, entry, row-order, legacy compatibility, reusable-custom, shared quotation, creator-flow and document suites: **46 passed**.
- Existing quotation DOM suite: **8 passed**, including 33/100-item editors, mouse/touch/keyboard dragging, cancellation, focus/details preservation and exact save order for ordinary and linked quotations.
- New isolated Edge browser fixture: **passed**. Covers combined search, keyboard/touch selection, replacement/cancel, quantity/focus, stale/cleared searches, partial search failure, custom validation/deduplication, failed saves, reuse after saving, drag ordering, focused/linked restrictions and responsive overflow. API data is synthetic and intercepted; this is not live-data acceptance.
- Production webpack build and included TypeScript validation: **passed**.
- `git diff --check`: **passed**.

Screenshots are generated under ignored `test-results/quotation-normal-entry/`: normal entry at 1280×768 and 1920×1080, search, inline custom entry, narrow-screen scrolling and focused mode. Real application branding/styles/components are used with synthetic fixture data.

Run the browser check with `node tests/browser/quotation-normal-entry.mjs`. It defaults to the installed Windows Edge path; `TEST_BROWSER` can select another Chromium executable. The DOM suite uses the existing `QUOTATION_TEST_DOM_RUNTIME` override when jsdom is supplied from the parent workspace.
