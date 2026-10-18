import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { DB } from "../core/db";
import { one } from "../core/db";
import { assert } from "../core/errors";
import { audit } from "../core/audit";
import {
  has,
  requirePermission,
  pricingPolicy,
  type Actor,
} from "../auth/service";
import { getProduct, toInput } from "../products/service";
import { calculateTargetPrice, normalizePart } from "../pricing/engine";
import * as quotes from "./service";
import { sharedQuotationSnapshot } from "../integrations/shared-quotation-pdf";
import { resolveSharedReferences, retainReferenceEvidence } from "./references";
import { enqueue } from "../integrations/job-protocol";
import { quotationPdfFingerprint } from "../pdf/cache";

/** A verified saved reference can be bound for *new revision pricing*. This
 * lookup is never used to recover the reference printed on an old document. */
export async function revisionInputs(db: DB, actor: Actor, document: any) {
  if (!document.legacyShared)
    return document.lines.map((line: any) => ({
      ...quotes.duplicateLineInput(line),
      watcherEventId: randomUUID(),
    }));
  const result: any[] = [];
  for (const [index, line] of document.lines.entries()) {
    const partNumber =
      line.partNumber === "Not recorded" ? "" : line.partNumber;
    const product = partNumber
      ? await one(db, "SELECT id FROM products WHERE normalized_part=$1", [
          normalizePart(partNumber),
        ])
      : undefined;
    if (product) {
      const p = await getProduct(db, product.id);
      const input = {
        type: "CATALOG",
        productId: product.id,
        quantity: String(line.price.quantity),
        override: false,
        reason: "",
        sellingLevel: "END_CUSTOMER" as const,
      };
      const price = calculateTargetPrice(toInput(p), pricingPolicy(actor), {
        ...input,
        targetFinalExcl: line.price.finalExcl,
      });
      result.push({
        ...input,
        discount: price.requestedDiscount,
        ...(price.adjustmentMode === "MARKUP"
          ? { markup: price.requestedMarkup }
          : {}),
      });
    } else
      result.push({
        type: "CUSTOM",
        partNumber,
        description: line.description,
        unit: line.unit || "pcs",
        quantity: String(line.price.quantity),
        unitPriceExcl: String(
          document.revisionUnitPrices?.[index] ?? line.price.finalExcl,
        ),
        vat: String(line.price.vatRate),
        discount: "0",
      });
  }
  return result;
}

/** Local, read-only document projection. Opening a document never contacts ERP. */
export async function readDocument(
  db: DB,
  actor: Actor,
  id: string,
  version?: number,
) {
  const original = await quotes.getQuote(db, actor, id);
  const link = await one(db, "SELECT data FROM sw_job_documents WHERE id=$1", [
    id,
  ]);
  const versions = link?.data.sharedQuotations || [];
  const legacy = versions.length > 0;
  let q = original,
    references: any[] = [];
  if (legacy) {
    const selected =
      version === undefined
        ? versions.at(-1)
        : versions.find((v: any) => v.version === version);
    assert(selected, 404, "Saved quotation version not found");
    assert(
      Array.isArray(selected.lines) && selected.lines.length > 0,
      409,
      "Saved quotation snapshot is incomplete; its original records are preserved for review",
    );
    const resolved = await resolveSharedReferences(db, id, selected);
    references = resolved.resolutions;
    // Retain the first render's company snapshot. Never replace historical branding.
    const render = await one(
      db,
      "SELECT payload FROM jobs WHERE kind='QUOTE_PDF' AND payload->>'quoteId'=$1 ORDER BY created_at,id LIMIT 1",
      [`shared:${selected.id}:v${selected.version}`],
    );
    const company =
      render?.payload.snapshot?.company_snapshot ||
      original.company_snapshot ||
      (await one(db, "SELECT data FROM settings WHERE id=1"))?.data;
    const projection = sharedQuotationSnapshot(
      resolved.quote,
      company,
      original.number,
    );
    if (render?.payload.snapshot) {
      const financial = (s: any) => ({
        customer: s.customer,
        totals: s.totals,
        lines: s.lines.map(({ partNumber, ...line }: any) => line),
      });
      assert(
        quotationPdfFingerprint(financial(render.payload.snapshot)) ===
          quotationPdfFingerprint(financial(projection)),
        409,
        "Historical PDF and saved version differ. Review the preserved original records.",
      );
    }
    q = {
      ...original,
      ...(render?.payload.snapshot || projection),
      lines: projection.lines,
      id,
      version: original.version,
      status: "ISSUED",
      selectedVersion: selected.version,
      sourceItemIds: resolved.quote.lines.map((l: any) => l.itemId),
      revisionUnitPrices: resolved.quote.lines.map((l: any) =>
        selected.taxBasis === "INCLUSIVE"
          ? new Decimal(l.sellingPrice)
              .div(new Decimal(selected.taxRate || "0").div(100).plus(1))
              .toDecimalPlaces(6)
              .toFixed()
          : l.sellingPrice,
      ),
    };
  } else {
    const frozen = await one(
      db,
      "SELECT snapshot FROM quotation_document_snapshots WHERE quotation_id=$1 ORDER BY version DESC LIMIT 1",
      [id],
    );
    if (frozen)
      q = {
        ...original,
        customer: frozen.snapshot.customer,
        lines: frozen.snapshot.lines,
        totals: frozen.snapshot.totals,
        company_snapshot: frozen.snapshot.company_snapshot,
        issued_at: frozen.snapshot.issued_at,
      };
  }
  const source = await one(
    db,
    "SELECT * FROM quotation_revision_sources WHERE quotation_id=$1",
    [id],
  );
  if (source?.reference_requirements) {
    q = {
      ...q,
      lines: q.lines.map((l: any) => {
        if (
          source.reference_requirements[l.input?.watcherEventId] &&
          !String(
            (l.input?.type === "CUSTOM" ? l.input.partNumber : l.partNumber) ||
              "",
          ).trim()
        ) {
          references.push({
            itemId: l.input?.watcherEventId,
            status: "UNRESOLVED",
          });
          return { ...l, partNumber: "Not recorded" };
        }
        return l;
      }),
    };
  }
  const pendingReferences = references.some((r) => r.status !== "RECOVERED");
  const publication = await one(
    db,
    "SELECT * FROM quotation_workflow_publications WHERE quotation_id=$1 ORDER BY version DESC LIMIT 1",
    [id],
  );
  let own =
    original.owner_id === actor.id ||
    has(actor, "QUOTE_EDIT_ALL") ||
    (!link && original.shared_with?.includes(actor.id));
  const protectedRoot = link || (source ? await one(db,"SELECT data FROM sw_job_documents WHERE id=$1",[source.root_document_id]) : undefined);
  if(protectedRoot){
    const rootOwner=source ? (await one(db,"SELECT owner_id FROM quotations WHERE id=$1",[source.root_document_id]))?.owner_id : original.owner_id;
    const grant=protectedRoot.data.overrides?.[actor.id];
    own=Boolean(own && !protectedRoot.data.handover && (rootOwner===actor.id || (actor.role==='ADMIN' && grant?.reason && Date.parse(grant.until)>Date.now())));
  }
  const draft = ["DRAFT", "REJECTED"].includes(q.status) && !legacy;
  const issued = [
    "ISSUED",
    "SENT",
    "VIEWED",
    "ACCEPTED",
    "DECLINED",
    "EXPIRED",
  ].includes(q.status);
  const capability = (allowed: boolean, reason: string) => ({
    allowed,
    reason: allowed ? "" : reason,
  });
  return {
    ...quotes.publicQuote(q, actor),
    sharedWorkflow: Boolean(link && (link.data.erpRequestId || versions.length || Object.keys(link.data.lines || {}).length)),
    quotationManagedLocally: true,
    workflowLinked: !!link || !!source,
    legacyShared: legacy,
    savedVersions: versions.map((v: any) => ({
      version: v.version,
      date: v.date,
    })),
    selectedVersion: q.selectedVersion,
    referenceResolution: references,
    revisionSource: source,
    synchronization: publication
      ? { state: publication.state, remoteVersion: publication.remote_version }
      : {
          state: legacy
            ? "SYNCED"
            : link || source
              ? "NOT_ISSUED"
              : "NOT_REQUIRED",
        },
    capabilities: {
      verifyReferences:capability(own && legacy && has(actor,"QUOTE_EDIT"),"The responsible owner or an administrator with a current recorded override must verify historical references."),
      edit: capability(
        own && draft && has(actor, "QUOTE_EDIT"),
        "Only an owned draft can be edited. Create a revision of an issued quotation.",
      ),
      revise: capability(
        own && issued && has(actor, "QUOTE_CREATE"),
        "Create permission and access to the responsible document are required.",
      ),
      submit: capability(
        own && draft && has(actor, "QUOTE_EDIT"),
        "Only an editable draft can be submitted.",
      ),
      issue: capability(
        own &&
          has(actor, "QUOTE_ISSUE") &&
          ["DRAFT", "APPROVED"].includes(q.status) &&
          !legacy &&
          !pendingReferences,
        pendingReferences
          ? "Verify or enter missing part numbers in this revision first."
          : "Approval and issue permission are required.",
      ),
      duplicate: capability(
        has(actor, "QUOTE_CREATE") && !pendingReferences,
        pendingReferences
          ? "Create a corrected revision or verify the historical part numbers first."
          : "Create quotation permission is required.",
      ),
      customerLink: capability(
        (!protectedRoot || own) && !legacy &&
          has(actor, "QUOTE_ISSUE") &&
          ["ISSUED", "SENT", "VIEWED"].includes(q.status),
        "Create and issue a local revision before sharing this historical document.",
      ),
    },
  };
}

/** Revision creation is serialized on the original root and is retry-idempotent. */
export async function reviseDocument(
  db: DB,
  actor: Actor,
  id: string,
  settings: any,
  version?: number,
  eventId?: string,
) {
  requirePermission(actor, "QUOTE_CREATE");
  return db.transaction(async (tx) => {
    let original = await quotes.getQuote(tx, actor, id, true);
    const root = original.parent_quotation_id || id;
    await tx.query("SELECT id FROM quotations WHERE id=$1 FOR UPDATE", [root]);
    // Recheck ownership/override expiry after waiting for a concurrent writer.
    original = await quotes.getQuote(tx, actor, id, true);
    if (eventId) {
      const previous = await one(
        tx,
        "SELECT quotation_id,root_document_id,source_document_id,source_version FROM quotation_revision_sources WHERE request_id=$1",
        [`${actor.id}:${eventId}`],
      );
      if (previous) {
        assert(
          previous.source_document_id === id &&
            previous.root_document_id === root &&
            (version === undefined || previous.source_version === version),
          409,
          "Revision retry refers to a different source",
        );
        return quotes.publicQuote(
          await quotes.getQuote(tx, actor, previous.quotation_id),
          actor,
        );
      }
    }
    const document = await readDocument(tx, actor, id, version);
    assert(
      document.capabilities.revise.allowed,
      403,
      document.capabilities.revise.reason,
    );
    const latest = await one(
      tx,
      "SELECT COALESCE(max(revision),1) n FROM quotations WHERE id=$1 OR parent_quotation_id=$1",
      [root],
    );
    const revision = Number(latest?.n || 1) + 1;
    const draft = await quotes.saveDraft(
      tx,
      actor,
      {
        customer: document.customer,
        lines: await revisionInputs(tx, actor, document),
      },
      settings,
      undefined, undefined, undefined, {preserveCustomerMaster:true},
    );
    const number = `${original.number.replace(/-R\d+$/i, "")}-R${revision}`;
    await tx.query(
      "UPDATE quotations SET number=$2,parent_quotation_id=$3,revision=$4,owner_id=$5,document_currency=$6 WHERE id=$1",
      [
        draft.id,
        number,
        root,
        revision,
        original.owner_id,
        document.currency ||
          document.document_currency ||
          document.company_snapshot?.currency ||
          settings.currency ||
          "SAR",
      ],
    );
    const sourceLink = await one(
      tx,
      "SELECT data FROM sw_job_documents WHERE id=$1",
      [root],
    );
    const previousSource = await one(
      tx,
      "SELECT line_mapping FROM quotation_revision_sources WHERE quotation_id=$1",
      [id],
    );
    const mapping = Object.fromEntries(
      draft.lines
        .map((l: any, index: number) => [
          l.input.watcherEventId,
          document.sourceItemIds?.[index] ||
            previousSource?.line_mapping?.[
              document.lines[index].input?.watcherEventId
            ] ||
            sourceLink?.data.lines?.[
              document.lines[index].input?.watcherEventId
            ]?.itemId ||
            null,
        ])
        .filter(([, itemId]: any) => itemId),
    );
    const required = Object.fromEntries(
      draft.lines
        .map((l: any, index: number) => [
          l.input.watcherEventId,
          document.referenceResolution?.some(
            (r: any) =>
              r.itemId === document.sourceItemIds?.[index] &&
              r.status !== "RECOVERED",
          ),
        ])
        .filter(([, pending]: any) => pending),
    );
    await tx.query(
      "INSERT INTO quotation_revision_sources(quotation_id,root_document_id,source_version,request_id,line_mapping,source_document_id,reference_requirements) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)",
      [
        draft.id,
        root,
        document.selectedVersion || original.version,
        eventId ? `${actor.id}:${eventId}` : null,
        JSON.stringify(mapping),
        id,
        JSON.stringify(required),
      ],
    );
    if (document.legacyShared)
      await retainReferenceEvidence(
        tx,
        id,
        document.selectedVersion,
        document.referenceResolution,
      );
    await audit(
      tx,
      actor.id,
      "QUOTATION_REVISION_CREATE",
      "quotations",
      draft.id,
      null,
      {
        rootId: root,
        sourceId: id,
        sourceVersion: document.selectedVersion || original.version,
        revision,
      },
    );
    return {
      ...quotes.publicQuote(await quotes.getQuote(tx, actor, draft.id), actor),
      revisionPricingNotice:
        "Editable revision created locally. Review current permitted prices and totals before issuing; the original version remains unchanged.",
    };
  });
}

/** Called within issue's transaction, after stable line identities are assigned. */
export async function freezeIssuedDocument(
  db: DB,
  q: any,
  actorId = q.owner_id,
) {
  const snapshot = structuredClone(q);
  await db.query(
    "INSERT INTO quotation_document_snapshots(quotation_id,version,snapshot) VALUES($1,$2,$3::jsonb)",
    [q.id, q.version, JSON.stringify(snapshot)],
  );
  const source = await one(
    db,
    "SELECT * FROM quotation_revision_sources WHERE quotation_id=$1",
    [q.id],
  );
  const root = source?.root_document_id || q.id;
  const link = await one(db, "SELECT data FROM sw_job_documents WHERE id=$1", [
    root,
  ]);
  if (!link) return;
  const eventId = randomUUID();
  const payload = {
    eventId,
    documentId: root,
    revisionId: q.id,
    version: q.version,
    ownerId: q.owner_id,
    actorId,
    requestId: link.data.erpRequestId,
    revisionIndex: q.revision || 1,
    issuedAt: new Date(q.issued_at).toISOString(),
    number: q.number,
    customer: q.customer,
    totals: q.totals,
    currency: q.company_snapshot?.currency || "SAR",
    lines: q.lines.map((l: any) => ({
      id: l.input.watcherEventId,
      itemId:
        source?.line_mapping?.[l.input.watcherEventId] ||
        link.data.lines?.[l.input.watcherEventId]?.itemId,
      partNumber: l.partNumber || "",
      description: l.description,
      unit: l.unit,
      price: l.price,
    })),
  };
  await db.query(
    "INSERT INTO quotation_workflow_publications(quotation_id,version,event_id,root_document_id,request_id) VALUES($1,$2,$3,$4,$5)",
    [q.id, q.version, eventId, root, link.data.erpRequestId],
  );
  await enqueue(db, eventId, "jobs-quotation-publish", payload);
}
