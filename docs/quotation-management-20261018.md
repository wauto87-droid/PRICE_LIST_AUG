# Independent quotation management candidate

Base: deployed Price List `bac3d78`. This candidate is prepared for review, not authorized for publication.

## Behaviour

Quotations uses one local document workspace for ordinary and linked documents. It provides draft editing, the existing approval/review/issue lifecycle, editable revisions, duplication, customer links, print and PDF jobs. Procurement and fulfilment remain in Workflow. Opening a quotation does not contact ERP or create workflow requests.

Existing `sharedWorkflow` linkage metadata remains available to older callers. The additive `quotationManagedLocally`, capabilities, saved versions, reference resolution, revision source and synchronization metadata describe the new workspace. The editor opens a native draft; it does not redirect linked documents into the procurement editor.

Issued documents are append-only snapshots. Historical linked versions are never edited in place. A revision receives its own item identities, records explicit source/item mappings and retains the original responsible owner. Revision creation is serialized and accepts a retry identity. Ownership is rechecked after acquiring the root lock. Copies/revisions do not overwrite the current customer master with historical customer details. Explicit ordinary draft saves retain their existing behaviour.

Local issue does not require supplier prices or an available ERP. Existing selling-price, authorization, approval and issue rules still apply. An issued linked snapshot enters the transactional outbox. Its synchronization status is separate from a local save; failure does not destroy the local document. No customer or staff messages are sent by these actions.

## Historical references and rendering

Preview, print and PDF use the selected saved version. A recorded reference wins. Recovery requires an exact intake item identity, original snapshot and dated assignment audit. The optional explicit verification action asks the authenticated ERP interface for that evidence and retains it separately. Current catalogue entries, descriptions, positions and the mutable draft are not recovery evidence.

Missing/conflicting references stay visibly unresolved. A corrected revision cannot be issued until its missing historical references are explicitly supplied or verified. A financial mismatch between an old render snapshot and the saved version raises a conflict rather than silently replacing it.

PDF render fingerprints use customer presentation fields, including resolved references. A changed verified reference creates a new artifact; retries reuse it. Existing artifacts remain retained. Missing completed artifacts can be regenerated. Supplier costs and recovery provenance are excluded from customer render snapshots.

## Additive schema

Only new migrations `072_quotation_documents.sql` and `073_quotation_revision_identity.sql` are introduced. Original migration files are unchanged. They add immutable document snapshots, immutable recovery provenance, revision lineage/item mappings, publication state and nullable document currency metadata. Old outbox entries receive no invented creation timestamp. The SQL runner executes complete migration files so PL/pgSQL trigger bodies are not split at internal semicolons.

The migration rehearsal compares original-column fingerprints before/after and performs a real PostgreSQL dump/restore. This synthetic retained-schema test is not a restoration of the live business backup.

## Release gates

- Review the exact candidate commit and the separate ERP candidate.
- Complete permitted rendered browser/PDF-download acceptance; an interrupted browser check is not a pass.
- Rehearse a fresh actual staging backup and compare protected-data fingerprints before/after staging acceptance.
- Keep both conflicting ERP financial settings. Their recovery blocker remains unresolved by user decision.
- Obtain exact-candidate approval before publishing. Prior approvals for older Price List commits do not cover this candidate.
- Replace only the approved application release. Do not rotate credentials, restart bots or deploy production as part of an audit.
- Rollback restores the previous application release while retaining additive snapshots, mappings and records. Do not restore a database over newer staff activity.

Accounting, Daybook, cash controls, existing credentials and bots are outside this change. Workflow invoices and payments remain deferred. The system is not approved for an operational pilot while critical recovery/acceptance gates remain open.
