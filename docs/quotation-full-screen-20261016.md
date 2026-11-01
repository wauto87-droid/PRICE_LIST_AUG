# Full quotation editing screen — 16 October 2026

Candidate branch: `codex/quotation-full-screen-20261016`, based on deployed `7a1361ea45489fecafcf83dbb12583e5e1492939`. Prepared locally only; no remote push, SSH connection, deployment or live-data write occurred for this candidate.

## Confirmed cause and change

The owner's screenshot shows approximately three visible item rows and a large unused band beneath the totals. The quotation editor wraps its customer controls, item table and totals in a fieldset. The global `fieldset` rule in `app/globals.css` sets `max-height:300px; overflow:auto`. The previous Focus layout changed flex sizing but did not remove that cap. It therefore enlarged the card while leaving the actual fieldset constrained.

The fix changes screen-only CSS in `app/globals.css`:

- `.quotation-editor>fieldset` explicitly overrides the inherited height cap and nested scrolling with `max-height:none; overflow:visible`. Other fieldsets retain their existing global rule.
- While an editor is mounted, body, main, the ordinary/linked editor wrapper, editor, fieldset and table form a continuous viewport-height flex chain. Main uses the full width instead of its default 1280px cap. Header/navigation/footer retain their natural space in normal mode.
- The table wrapper flexes into the remaining height. Its responsive region owns row scrolling, retains sticky headers/identifiers and has no fixed viewport subtraction. Size containment prevents all 100 rows contributing to the surrounding editor's intrinsic minimum size; the table wrapper retains a 160px minimum for short-screen fallback.
- Intrinsic minimum sizes preserve customer fields/actions/totals. Main can scroll when the available viewport is too short to accommodate them. Outer editor spacing is 8px; input/touch-target sizing is unchanged.
- Focus hides surrounding controls, including linked-editor Back/progress controls, and restores them on exit. Customer details remain default-open and foldable in normal mode; folding reallocates their space to the table. Existing totals/save controls and all editing/dragging logic are unchanged.
- Generated PDF/print/export layouts are excluded by the existing `@media screen` boundary. No React, public API, schema, migration, pricing, saved-version, dependency or authorization changes.

## Verification

| Check | Result |
| --- | --- |
| Production build and TypeScript | **PASS**, Next 16.3.2 webpack including TypeScript, exit 0. Approved filesystem access avoided the previously documented sandbox `.next` EPERM issue. Synthetic unreachable PostgreSQL settings, integrations disabled. |
| Quotation/workflow regression | **PASS**, 48 tests, zero failures/skips, exit 0. Isolated embedded-database tests include save/update/reopen ordering, precision, quotation snapshots, permissions and PDF contracts. |
| DOM/display interaction command | **PASS**, nine tests, zero failures/skips, exit 0. Covers ordinary/linked 25/33/100-row editors, details/focus state, retained inputs after failed saves, navigation and mouse/keyboard/touch reorder sensors. These tests do not render the stylesheet or measure layout. |
| Scope/whitespace review | **PASS**, only stylesheet plus this review record differ from the deployed base; `git diff --check` passes. Global non-quotation fieldset styles and all behavioural source remain unchanged. |
| Focus: 10 rows at 1920×900, 8 at 1280×800, 6 at 390×844 | **NOT TESTED**. No rendered dimension measurements or screenshots of the candidate are available. |
| Normal-mode remaining-height allocation, folded-details expansion and absence of empty band | **NOT TESTED visually**. The fieldset cap removal and layout declarations are verified in source only. |
| Actual resize/zoom, on-screen keyboard, RTL, sticky columns, drag auto-scroll and short-screen controls | **NOT TESTED visually/on-device**. Existing interaction tests provide behavioural coverage only. |
| Deployment/live preservation comparison | **NOT TESTED for this candidate**, not deployed. |

Prior supported isolated browser access was policy-rejected. No alternate browser surface, raw Playwright/CDP or browser-workaround mechanism was used. The supplied screenshot is evidence of the deployed baseline failure, not evidence of candidate acceptance. Rendered acceptance remains outstanding and must not be inferred from the build, DOM tests or CSS source.

Counts overlap (the number-display case appears in regression and DOM commands); do not sum them as unique tests. Logs and exit files are in the parent workspace's `.deploy/mission-20261016`: `full-screen-build.*`, `full-screen-regression.*`, `full-screen-dom.*`.

## Release boundary

Live Price List remains `7a1361e`. Obtain approval for the new exact candidate before publication, then perform a fresh verified backup/isolated restore, original app-only deployment guards and before/after table/process/configuration comparisons. Retain the previous executable for rollback. Do not deploy ERP or alter accounting, Daybook, cash controls, credentials or bots.

Existing business data and unrelated main ERP working-tree changes were not edited, staged or reverted. No production/pilot-readiness conclusion follows from this presentation candidate; broader operational audit blockers remain separate.
