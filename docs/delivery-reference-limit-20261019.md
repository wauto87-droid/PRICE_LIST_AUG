# Delivery quotation reference length repair

The retained 1533.XLS review has 88 included rows and 45 delivery numbers. Its generated customer reference is 284 characters, beyond the existing 200-character validation limit. Complete generated notes are 541 characters, within their existing 1000-character limit.

Generated references now show as many complete numbers as fit, followed by the number of additional references and a see-notes hint. Full included delivery numbers remain in notes and row metadata. Short references and manually written notes/references retain their existing behavior. Removal/restoration recalculates the same bounded reference. No validation limit is raised and no import decisions are changed.

The 105-row / 88-included regression now uses 44 distinct delivery numbers and dates, reproduces the original failure before the fix and passes after it. Conversion retries, note preservation, row removal/restoration and a single oversized reference are covered. All 12 import/reference tests and TypeScript pass.

Standalone patch based on live cfaaba8; excludes the blocked Workflow client and ERP changes.
