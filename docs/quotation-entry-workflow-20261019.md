# Quotation entry and delivery import repair

Normal and focused entry now share catalogue/custom search, inline creation and quantity-driven draft rows. Grid keys navigate editable cells; search options keep priority. Imported delivery sources and authorized supplier cost references stay visible. Existing sortable row identities and Workflow restrictions remain.

Delivery review serializes writes, keeps dirty values by import/row across pages, ignores superseded page reads and reloads conflicts without discarding edits. Finalize accepts pending row edits in the same locked transaction as quotation creation. Completed retries return the existing quotation. Included rows determine delivery references across pages; editing drafts updates only generated reference lines while retaining manual notes and historical snapshots.

Validation: 67 quotation/import/Workflow tests passed; one PostgreSQL-only suite skipped. Browser fixtures cover unified search/custom reuse, focused entry, keyboard navigation, dragging, responsive layout and the 105-row / 88-included conversion case with cross-page edits and conflict recovery. Type checking and a production build passed before release preparation. No schema or dependency change.

Workflow assignment and early-collection actions are a separate compatible release after ERP handlers are verified.
