# Quotation row colours, visible details and ordering — 16 October 2026

Candidate branch: `codex/quotation-row-order-20261016`, based on deployed `6a40c42048153f64da9607257445722465581d62`. This candidate has not been pushed or deployed. No VPS connection or live data operation was performed for this implementation.

## Changes reviewed

- Existing exact part-number matching and six-colour duplicate palette retained. Every duplicate cell receives the group tint, including the sticky first column. Groups keep their colour while rows move; a textual repeated-item/count badge supplements colour.
- Customer quotation details open initially, remain manually foldable, and retain their state during editor updates. Validation reveals details and exits Focus table when necessary. Focus mode hides customer fields without discarding them and restores their expansion state when exited.
- Existing dnd-kit packages provide handle-only mouse dragging, touch hold (250 ms / 5 px tolerance), keyboard Space/arrow/drop/Escape controls, announcements, automatic scrolling, a drag preview and an insertion marker. Input fields and the rest of each row are not drag activators. Existing arrows remain available.
- Editor-only stable row identities keep repeated items distinct and preserve expanded details/focus across moves. They are not stored on business records or included in save payloads. Dragging and arrows share one reorder function; linked drafts are marked unsaved. Saving still requires the existing explicit action.
- Reordering waits for pending pricing, previous-price retrieval, saving or an uncertain pending shared command. Index-addressed pricing responses are invalidated before positions change. A changed row set during a drag prevents applying the old move.
- The shared draft presentation adapter reopens items in saved quotation order and appends remaining active items in their original order. Removed items remain excluded; saved-version-only mode retains its existing snapshot order. No request item list or historical quotation is rewritten by opening the editor.
- Reordering alone preserves authoritative shared quotation totals. Price, quantity, currency or tax edits still use the existing preview calculations. No pricing engine changes.
- Focus table uses a viewport-height flex layout: the table fills space left by the compact header/actions and totals instead of using fixed height deductions. The same rule applies at mobile widths. Controls remain present; generated print/PDF styles are excluded.

## Verification record

| Check | Result |
| --- | --- |
| Final quotation/workflow regression command | **PASS: 48 tests**, zero failures/skips. Includes shared adapter saved-order reopening, permission and PDF snapshot protections, 33/100-row identity/move checks and a real isolated embedded-database quotation save/update/reopen. |
| Final DOM/display command | **PASS: 9 tests**, zero failures/skips. Exercises 25/33/100-row editors; repeated parts; mouse, keyboard and long-press touch sensors; cancellation; stable details/focus/colour classes; failed-save retention; canonical totals; exact ordered save payloads; and existing navigation. |
| TypeScript / production build | **PASS**, Next 16.3.2 webpack build including TypeScript, exit 0 with approved filesystem access. Synthetic unreachable PostgreSQL URL and disabled integrations. |
| Scope and whitespace checks | **PASS**, no backend, database, migration/deployment script, package or lockfile changes; `git diff --check` passes. The shared adapter changes presentation order only; public request/response fields are unchanged. |
| Rendered browser/layout, physical touch device, RTL/zoom, actual row counts, scrolling reachability | **NOT TESTED**. Previously permitted isolated browser access was policy-rejected; no alternate browser surface or raw browser-control workaround was used. DOM tests use explicitly synthetic rectangles and do not prove visual layout or native-device behaviour. |
| Deployment and live preservation comparison | **NOT TESTED for this candidate**; no deployment requested/approved for its new commit yet. |

Test commands overlap (including number-display and row-order helper checks); their counts must not be summed into a unique total. The isolated database fixture changes only its synthetic users/quotations and is closed after testing.

Logs under the parent workspace's `.deploy/mission-20261016`: `row-order-regression-final.log/.exit`, `row-order-dom-final.log/.exit`, `row-order-persistence.log/.exit`, `row-order-build-permitted.log/.exit`. Initial failures remain in separate logs: old tests expected collapsed details; synthetic overlay geometry initially supplied the wrong height; one new fixture needed a literal CUSTOM type; and sandbox builds twice failed creating generated `.next/static/chunks/next/dist/client`. Expectations/fixture geometry/type were corrected. The final permitted build passed without weakening application checks or changing source to suppress an error.

## Release boundary

Accounting, Daybook, cash controls, credentials, bots, ERP releases, authorization, database schemas, prices and historical records are unchanged. Existing unrelated changes in the main ERP checkout were not edited, staged or reverted. No accounting feature or material-check activation was added.

Before publishing this candidate: obtain exact-commit approval, perform a fresh verified backup/isolated restore and normal app-only deployment guards, retain the current executable for rollback, and compare all business-table fingerprints and protected process/configuration state. Browser acceptance remains a separate unverified requirement. This UI candidate does not resolve the broader ERP operational audit blockers or establish production/pilot readiness.
