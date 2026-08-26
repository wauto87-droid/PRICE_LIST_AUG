# Authoritative pricing policy

All monetary inputs are base-10 decimal strings. PostgreSQL stores costs/percentages at up to six decimal places and master/minimum prices at two. `decimal.js` uses 32-digit precision and ROUND_HALF_UP. Native JavaScript floating-point math is never authoritative for money.

1. Resolve the selected active selling level (Wholesale, Retail, End Customer), using the admin-selected product default only for new requests without a level. Compute its master exclusive price from a fixed amount, shared cost × (1 + level markup/100), or level list × (1 − level supplier discount/100); round to 2 decimals.
2. Clamp requested quotation discount to the current user's numerical maximum (user override if present, otherwise role default).
3. Compute discounted exclusive unit price and round to 2 decimals.
4. Enforce the configured exclusive floor. An explicit `OVERRIDE_MINIMUM_PRICE` permission plus a per-line confirmation/reason can bypass the floor, but never the role discount limit.
5. Multiply final exclusive unit price by positive quantity; round line exclusive subtotal to 2 decimals.
6. Compute VAT from the line subtotal × VAT/100; round to 2 decimals.
7. Line total = exclusive subtotal + line VAT. Quotation totals sum the rounded lines.

Inclusive unit prices are informational, rounded to 2 decimals. Do not multiply them to get line totals: 118.75 × 2 = 237.50; VAT = 35.63; total = 273.13, even though the displayed inclusive unit value is 136.56.

Product quantity precision is 0–3 decimal places; quantity must be greater than zero and no more than 1,000,000. Minimum price must be cent-aligned and cannot exceed master price. A zero master price has zero effective discount rather than dividing by zero. SAR is the supported currency in this release; changing currency denomination requires a deliberate migration, not relabeling historical prices.

Draft snapshots store product identity/version, selected selling level, requested input, master values, final prices, VAT, effective discount, floor application, internal floor configuration and timestamp. Internal floor configuration is stripped from ordinary quote responses. Override reasons are retained and audited. Master changes do not silently rewrite drafts or issued quotes. The shared optional minimum cannot exceed any active level's master price. Selecting Wholesale does not bypass discount limits or the minimum.

Migration 003 creates one End Customer level from every legacy product formula without repricing. Existing issued JSON remains untouched. Legacy saved lines without a level resolve to End Customer, never a changed product default. New snapshots pin the resolved level explicitly. Disabling/removing a selected level blocks review/issue until the draft is edited to an available level; duplication also refuses unavailable levels. No silent substitution occurs.

Issuance recalculates current prices and demands acceptance of a review fingerprint. Concurrent master changes invalidate acceptance. Numbering uses transactional daily counters and the Asia/Riyadh date. Issued company/VAT snapshots are immutable. Global VAT is a new-product default; existing product rates require reviewed bulk changes.
