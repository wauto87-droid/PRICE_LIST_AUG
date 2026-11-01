import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../backend/auth/service";
import * as quotes from "../backend/quotations/service";
import { readDocument, reviseDocument } from "../backend/quotations/documents";
import {
  resolveSharedReferences,
  verifyHistoricalReferences,
} from "../backend/quotations/references";
import { sharedQuotationPdfJob } from "../backend/integrations/shared-quotation-pdf";
import { handle } from "../backend/api/router";
import {quotationRenderSnapshot,quotationPdfFingerprint} from "../backend/pdf/cache";

test("fresh additive migrations, local linked lifecycle, immutable snapshots and retry-safe revisions", async () => {
  const db = await embedded();
  try {
    await migrate(db);
    const applied = await one(db, "SELECT count(*) n FROM migrations");
    await migrate(db);
    assert.deepEqual(
      await one(db, "SELECT count(*) n FROM migrations"),
      applied,
    );
    process.env.SETUP_TOKEN = "isolated-local-quotation-setup-token";
    await setup(db, {
      token: process.env.SETUP_TOKEN,
      username: "quotation-owner",
      password: "Synthetic-password-123",
      name: "Pilot",
      companyName: "Synthetic",
    });
    const session = await login(db, {
      username: "quotation-owner",
      password: "Synthetic-password-123",
    });
    const cookie = sessionCookie(session.token).split(";")[0];
    const actor = await authenticate(
      db,
      new Request("http://localhost", { headers: { Cookie: cookie } }),
    );
    const settings = (await one(db, "SELECT data FROM settings WHERE id=1"))!
      .data;
    const input = {
      customer: { name: "Synthetic customer", number: "SYN-CUSTOMER" },
      lines: [
        {
          type: "CUSTOM",
          partNumber: "EXACT-A",
          description: "Repeated description",
          quantity: "2",
          unit: "pcs",
          unitPriceExcl: "10.123456",
          vat: "15",
        },
      ],
    };
    const draft = await quotes.saveDraft(db, actor, input, settings);
    await db.query(
      "INSERT INTO sw_job_documents(id,data) VALUES($1,$2::jsonb)",
      [
        draft.id,
        JSON.stringify({ erpRequestId: randomUUID(), lines: {} }),
      ],
    );
    process.env.WORKFLOW_INTEGRATION_ENABLED = "false";
    const review = await quotes.reviewIssue(db, actor, draft.id, settings);
    const issued = await quotes.issue(
      db,
      actor,
      draft.id,
      review.token,
      settings,
    );
    assert.equal(issued.status, "ISSUED");
    assert.equal(quotationPdfFingerprint(quotationRenderSnapshot({...issued,status:"SENT"})),quotationPdfFingerprint(quotationRenderSnapshot(issued)),"Sharing must not duplicate an unchanged render artifact");
    assert.equal(
      (await readDocument(db, actor, draft.id)).synchronization.state,
      "PENDING",
    );
    assert.equal(
      (await one(
        db,
        "SELECT count(*) n FROM sw_job_outbox WHERE endpoint='jobs-quotation-publish'",
      ))!.n,
      1,
    );
    await assert.rejects(
      db.query(
        "UPDATE quotation_document_snapshots SET snapshot='{}' WHERE quotation_id=$1",
        [draft.id],
      ),
      /append-only/,
    );
    await assert.rejects(
      quotes.issue(db, actor, draft.id, review.token, settings),
    );
    await db.query("UPDATE customers SET mobile='current-profile' WHERE number='SYN-CUSTOMER'");
    const ungrantedAdmin={...actor,id:randomUUID()};
    assert.equal((await readDocument(db,ungrantedAdmin,draft.id)).capabilities.revise.allowed,false);
    await assert.rejects(reviseDocument(db,ungrantedAdmin,draft.id,settings),/override reason/);
    const eventId = randomUUID();
    const revision = await reviseDocument(
      db,
      actor,
      draft.id,
      settings,
      undefined,
      eventId,
    );
    const retry = await reviseDocument(
      db,
      actor,
      draft.id,
      settings,
      undefined,
      eventId,
    );
    assert.equal((await one(db,"SELECT mobile FROM customers WHERE number='SYN-CUSTOMER'"))!.mobile,"current-profile");
    assert.equal(revision.id, retry.id);
    assert.equal(revision.parent_quotation_id, issued.id);
    assert.notEqual(
      revision.lines[0].input.watcherEventId,
      issued.lines[0].input.watcherEventId,
    );
    assert.equal(
      (await one(
        db,
        "SELECT quotation_id FROM price_watch_events WHERE id=$1",
        [issued.lines[0].input.watcherEventId],
      ))!.quotation_id,
      issued.id,
    );
    assert.equal(revision.lines[0].partNumber, "EXACT-A");
    assert.equal(revision.lines[0].input.unitPriceExcl, "10.123456");
    assert.deepEqual(
      (await one(
        db,
        "SELECT snapshot FROM quotation_document_snapshots WHERE quotation_id=$1",
        [issued.id],
      ))!.snapshot.lines,
      issued.lines,
    );
    await assert.rejects(
      reviseDocument(
        db,
        { ...actor, id: randomUUID(), permissions: [] },
        issued.id,
        settings,
      ),
    );
    const response = await handle(
      new Request(
        `http://localhost/amt_price_list/api/v1/quotations/${issued.id}/print`,
        { headers: { Cookie: cookie } },
      ),
      db,
    );
    assert.equal(response.status, 200);
    assert.match(await response.text(), /EXACT-A/);
    const legacy = await quotes.saveDraft(db, actor, input, settings),
      itemId = randomUUID(),
      lineId = randomUUID(),
      requestId = randomUUID();
    const canonical = {
      id: randomUUID(),
      version: 1,
      date: "2026-10-10T00:00:00Z",
      customer: "Synthetic customer",
      currency: "USD",
      taxBasis: "EXCLUSIVE",
      taxRate: "15",
      subtotal: "20",
      taxTotal: "3",
      total: "23",
      lines: [
        {
          itemId,
          name: "Repeated description",
          quantity: "2",
          sellingPrice: "10",
          unit: "pcs",
        },
      ],
    };
    const link = {
      erpRequestId: requestId,
      lines: { [lineId]: { itemId } },
      sharedQuotations: [canonical],
    };
    await db.query(
      "INSERT INTO sw_job_documents(id,data) VALUES($1,$2::jsonb)",
      [legacy.id, JSON.stringify(link)],
    );
    const oldRender = await sharedQuotationPdfJob(
      db,
      actor.id,
      requestId,
      canonical,
      legacy.number,
      legacy.id,
    );
    const unresolvedRevision = await reviseDocument(
      db,
      actor,
      legacy.id,
      settings,
      1,
      randomUUID(),
    );
    await assert.rejects(
      quotes.reviewIssue(db, actor, unresolvedRevision.id, settings),
      /missing historical part number/,
    );
    const proof = {
      source: "ERP_ORIGINAL_INTAKE",
      documentId: legacy.id,
      itemId,
      localLineId: lineId,
      partNumber: "PROVEN-PART",
      auditId: randomUUID(),
      auditDate: "2026-10-01T00:00:00.000Z",
      fingerprint: "a".repeat(64),
      originalSnapshotHash: "b".repeat(64),
    };
    const transport = async () => ({
      documentId: legacy.id,
      quotationId: canonical.id,
      version: 1,
      evidence: [proof],
    });
    await verifyHistoricalReferences(db, actor, legacy.id, 1, transport);
    await verifyHistoricalReferences(db, actor, legacy.id, 1, transport);
    assert.equal(
      (await one(db, "SELECT count(*) n FROM quotation_reference_provenance"))!
        .n,
      1,
    );
    const newRender = await sharedQuotationPdfJob(
      db,
      actor.id,
      requestId,
      canonical,
      legacy.number,
      legacy.id,
    );
    assert.notEqual(newRender.id, oldRender.id);
    assert.equal(
      (
        await sharedQuotationPdfJob(
          db,
          actor.id,
          requestId,
          canonical,
          legacy.number,
          legacy.id,
        )
      ).id,
      newRender.id,
    );
    assert.equal(newRender.payload.snapshot.lines[0].partNumber, "PROVEN-PART");
    assert.equal(
      JSON.stringify(newRender.payload.snapshot).includes(proof.auditId),
      false,
    );
    assert.deepEqual(
      (await one(db, "SELECT data FROM sw_job_documents WHERE id=$1", [
        legacy.id,
      ]))!.data,
      link,
    );
    assert.equal(
      (await one(db, "SELECT status FROM jobs WHERE id=$1", [oldRender.id]))!
        .status,
      "PENDING",
    );
    assert.equal(
      (await readDocument(db, actor, legacy.id, 1)).lines[0].partNumber,
      "PROVEN-PART",
    );
    const corrected = await reviseDocument(
      db,
      actor,
      legacy.id,
      settings,
      1,
      randomUUID(),
    );
    assert.equal(corrected.document_currency, "USD");
    const correctedReview = await quotes.reviewIssue(
      db,
      actor,
      corrected.id,
      settings,
    );
    const correctedIssued = await quotes.issue(
      db,
      actor,
      corrected.id,
      correctedReview.token,
      settings,
    );
    assert.equal(correctedIssued.company_snapshot.currency, "USD");
    const {createCustomerLink}=await import("../backend/quotations/lifecycle");
    await assert.rejects(createCustomerLink(db,ungrantedAdmin,correctedIssued.id),/override reason/);
    await assert.rejects(
      verifyHistoricalReferences(db, actor, legacy.id, 1, async () => ({
        ...(await transport()),
        quotationId: randomUUID(),
      })),
      /different quotation/,
    );
    await assert.rejects(
      db.query(
        "DELETE FROM quotation_reference_provenance WHERE document_id=$1",
        [legacy.id],
      ),
      /append-only/,
    );
    // Ordinary revisions retain the existing view+issue sharing policy; only
    // workflow-linked roots require a current ownership override.
    const ordinary = await quotes.saveDraft(db,actor,input,settings);
    const ordinaryReview = await quotes.reviewIssue(db,actor,ordinary.id,settings);
    await quotes.issue(db,actor,ordinary.id,ordinaryReview.token,settings);
    const ordinaryRevision=await reviseDocument(db,actor,ordinary.id,settings,undefined,randomUUID());
    const revisionReview=await quotes.reviewIssue(db,actor,ordinaryRevision.id,settings);
    await quotes.issue(db,actor,ordinaryRevision.id,revisionReview.token,settings);
    await db.query("INSERT INTO users(id,username,name,password_hash,role_id) SELECT $1,'synthetic-link-issuer','Synthetic link issuer',password_hash,role_id FROM users WHERE id=$2",[ungrantedAdmin.id,actor.id]);
    const viewIssuer={...ungrantedAdmin,permissions:['QUOTE_ISSUE','QUOTE_VIEW_ALL']};
    const customerLink=await createCustomerLink(db,viewIssuer,ordinaryRevision.id);
    assert.ok(customerLink.token.length>20);
  } finally {
    await db.close!();
  }
});

test("historical references require exact retained intake mapping and reject conflicts or mutable-draft guesses", async () => {
  const db = await embedded();
  try {
    await migrate(db);
    const documentId = randomUUID(),
      localLineId = randomUUID(),
      itemId = randomUUID();
    await db.query(
      "INSERT INTO sw_job_documents(id,data) VALUES($1,$2::jsonb)",
      [documentId, JSON.stringify({ lines: { [localLineId]: { itemId } } })],
    );
    const quote = {
      date: "2026-10-15T00:00:00Z",
      lines: [{ itemId, name: "Same description" }],
    };
    assert.equal(
      (await resolveSharedReferences(db, documentId, quote)).resolutions[0]
        .status,
      "UNRESOLVED",
    );
    const insert = async (partNumber: string) =>
      db.query(
        "INSERT INTO sw_job_outbox(id,channel,endpoint,payload,result,created_at) VALUES($1,'REMOTE','jobs-assign',$2::jsonb,$3::jsonb,'2026-10-01')",
        [
          randomUUID(),
          JSON.stringify({
            documentId,
            kind: "PRICING",
            lines: [{ id: localLineId, partNumber }],
          }),
          JSON.stringify({ items: [{ id: itemId, localLineId }] }),
        ],
      );
    await insert("RECORDED-A");
    assert.equal(
      (await resolveSharedReferences(db, documentId, quote)).quote.lines[0]
        .partNumber,
      "RECORDED-A",
    );
    assert.equal(quote.lines[0].name, "Same description");
    assert.equal("partNumber" in quote.lines[0], false);
    await insert("CONFLICT-B");
    const conflict = await resolveSharedReferences(db, documentId, quote);
    assert.equal(conflict.resolutions[0].status, "CONFLICT");
    assert.equal(conflict.quote.lines[0].partNumber, undefined);
    assert.equal(
      (
        await resolveSharedReferences(db, documentId, {
          ...quote,
          lines: [{ itemId, partNumber: "SAVED-VERSION" }],
        })
      ).quote.lines[0].partNumber,
      "SAVED-VERSION",
    );
  } finally {
    await db.close!();
  }
});
