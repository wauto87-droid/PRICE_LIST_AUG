import { createHash } from "node:crypto";
import type { DB } from "../core/db";
import { one } from "../core/db";
import { z } from "zod";
import { check, remote, state } from "../integrations/core";
import { getQuote } from "./service";
import type { Actor } from "../auth/service";
import { requirePermission } from "../auth/service";

/** Resolve by immutable intake identity only. Never search descriptions, row
 * positions, mutable catalog entries or the current draft's part numbers. */
export async function resolveSharedReferences(
  db: DB,
  documentId: string | undefined,
  quote: any,
) {
  const link = documentId
    ? await one(db, "SELECT data FROM sw_job_documents WHERE id=$1", [
        documentId,
      ])
    : undefined;
  const events = documentId
    ? (
        await db.query(
          "SELECT id,payload,result,created_at FROM sw_job_outbox WHERE endpoint='jobs-assign' AND payload->>'documentId'=$1 ORDER BY created_at,id",
          [documentId],
        )
      ).rows
    : [];
  const retained = documentId
    ? (
        await db.query(
          "SELECT item_id,part_number,evidence_hash,evidence FROM quotation_reference_provenance WHERE document_id=$1 AND source_version=$2",
          [documentId, quote.version],
        )
      ).rows
    : [];
  const resolutions: any[] = [];
  const lines = quote.lines.map((line: any) => {
    if (line.partNumber !== undefined) return { ...line };
    const localIds = Object.entries<any>(link?.data.lines || {})
      .filter(([, entry]) => entry.itemId === line.itemId)
      .map(([id]) => id);
    const evidence: any[] = retained
      .filter((r) => r.item_id === line.itemId)
      .map((r) => ({
        partNumber: r.part_number,
        evidenceHash: r.evidence_hash,
        evidence: r.evidence,
      }));
    if (localIds.length === 1)
      for (const event of events) {
        // Only the original version of intake can establish historical identity.
        // Later assignment/refresh payloads are not evidence of the old reference.
        if (
          event.payload.kind !== "PRICING" ||
          event.payload.operation === "CANCEL"
        )
          continue;
        if (
          !quote.date ||
          !event.created_at ||
          !Number.isFinite(Date.parse(quote.date)) ||
          Date.parse(event.created_at) > Date.parse(quote.date)
        )
          continue;
        // A current link alone is insufficient: the retained acknowledgement must
        // independently establish the same source/item identity at intake time.
        const identities = (event.result?.items || []).filter(
          (item: any) =>
            item.id === line.itemId && item.localLineId === localIds[0],
        );
        if (identities.length !== 1) continue;
        const matching = (event.payload.lines || []).filter(
          (l: any) => l.id === localIds[0],
        );
        if (
          matching.length !== 1 ||
          !String(matching[0].partNumber || "").trim()
        )
          continue;
        evidence.push({
          eventId: event.id,
          localLineId: localIds[0],
          itemId: line.itemId,
          partNumber: matching[0].partNumber,
          payloadHash: createHash("sha256")
            .update(JSON.stringify(event.payload))
            .digest("hex"),
        });
      }
    const values = [...new Set(evidence.map((e) => e.partNumber))];
    if (values.length !== 1) {
      resolutions.push({
        itemId: line.itemId,
        status: values.length ? "CONFLICT" : "UNRESOLVED",
      });
      return { ...line };
    }
    const prior = retained.find(
      (r) => r.item_id === line.itemId && r.part_number === values[0],
    );
    const proof = {
      itemId: line.itemId,
      partNumber: values[0],
      status: "RECOVERED",
      evidence: prior?.evidence || evidence,
    };
    resolutions.push({
      ...proof,
      evidenceHash:
        prior?.evidence_hash ||
        createHash("sha256").update(JSON.stringify(proof)).digest("hex"),
    });
    return { ...line, partNumber: values[0] };
  });
  return { quote: { ...quote, lines }, resolutions };
}

const proofInput = z
  .object({
    source: z.literal("ERP_ORIGINAL_INTAKE"),
    documentId: z.string().uuid(),
    itemId: z.string().uuid(),
    localLineId: z.string().uuid(),
    partNumber: z.string().min(1).max(500),
    auditId: z.string().uuid(),
    auditDate: z.string().datetime(),
    fingerprint: z.string().length(64),
    originalSnapshotHash: z.string().length(64),
  })
  .strict();
/** Explicit verification action; ordinary reads and output never require ERP. */
export async function verifyHistoricalReferences(
  db: DB,
  actor: Actor,
  documentId: string,
  version: number,
  transport = remote,
) {
  requirePermission(actor, "QUOTE_EDIT");
  await getQuote(db, actor, documentId, true);
  const link = await one(db, "SELECT data FROM sw_job_documents WHERE id=$1", [
    documentId,
  ]);
  const quote = link?.data.sharedQuotations?.find(
    (q: any) => q.version === version,
  );
  check(quote, "Saved quotation version missing", 404);
  const response = await transport(
    await state(db),
    "jobs-quotation-references",
    { documentId, actorId: actor.id, version },
  );
  check(
    response.documentId === documentId &&
      response.quotationId === quote.id &&
      response.version === version,
    "Reference evidence identifies a different quotation",
    409,
  );
  const evidence = z.array(proofInput).max(10000).parse(response.evidence);
  for (const proof of evidence) {
    check(
      proof.documentId === documentId &&
        link!.data.lines?.[proof.localLineId]?.itemId === proof.itemId &&
        quote.lines.filter((l: any) => l.itemId === proof.itemId).length === 1,
      "Reference item mapping conflicts",
      409,
    );
    check(
      Date.parse(proof.auditDate) <= Date.parse(quote.date),
      "Reference evidence postdates the saved quotation",
      409,
    );
  }
  await db.transaction(async (tx) => {
    const locked = await one(
      tx,
      "SELECT data FROM sw_job_documents WHERE id=$1 FOR UPDATE",
      [documentId],
    );
    check(
      JSON.stringify(
        locked?.data.sharedQuotations?.find((q: any) => q.version === version),
      ) === JSON.stringify(quote),
      "Saved version changed during verification; refresh",
      409,
    );
    for (const proof of evidence)
      await retainReferenceEvidence(tx, documentId, version, [
        {
          status: "RECOVERED",
          itemId: proof.itemId,
          partNumber: proof.partNumber,
          evidenceHash: createHash("sha256")
            .update(JSON.stringify(proof))
            .digest("hex"),
          evidence: [proof],
        },
      ]);
  });
  return { verified: evidence.length };
}

export async function retainReferenceEvidence(
  db: DB,
  documentId: string,
  version: number,
  resolutions: any[],
) {
  for (const row of resolutions.filter((r) => r.status === "RECOVERED"))
    await db.query(
      "INSERT INTO quotation_reference_provenance(document_id,source_version,item_id,part_number,evidence_hash,evidence) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING",
      [
        documentId,
        version,
        row.itemId,
        row.partNumber,
        row.evidenceHash,
        JSON.stringify(row.evidence),
      ],
    );
}
