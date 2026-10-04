import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { DB, one } from "../core/db";
import { Actor, has, requirePermission } from "../auth/service";
import { getQuote } from "../quotations/service";
import { audit } from "../core/audit";
import {
  authenticate,
  check,
  readBody,
  remote,
  state,
  ConnectionError,
} from "./core";
import {
  assignmentInput,
  costInput,
  deliver,
  enqueue,
  hash,
  lineFingerprint,
  receipt,
  workflowEnabled,
} from "./job-protocol";

const J = JSON.stringify;
export const lineQuantity = (line: any) =>
  String(line.input?.quantity ?? line.price?.quantity ?? line.quantity ?? "");
const idFor = (line: any) => line.input?.watcherEventId;
/** Read canonical assignments for display, never manufacture a local collection job. */
export function canonicalCollectionProgress(canonical: any, lineId: string, previous: any) {
  const item = canonical?.items.find((i: any) => i.localLineId === lineId);
  if (!item) return previous;
  const assigned = (canonical.orders || []).flatMap((o: any) => o.lines.filter((l: any) => l.itemId === item.id && l.allocations.length).map((l: any) => ({ ...l, orderId: o.id, status: o.status })));
  if (!assigned.length) return previous;
  const line = assigned.at(-1), staff = line.staff[0];
  return { ...previous, COLLECTION: { status: Number(line.outstanding) <= 0 ? 'COMPLETED' : 'ASSIGNED', owner: staff?.id, ownerName: canonical.people?.[staff?.id], shops: line.supplier, notes: line.poReferences?.length ? 'PO reference: ' + line.poReferences.join(', ') : '', movements: line.movements, orderId: line.orderId } };
}
function mayCost(actor: Actor, quote: any) {
  return (
    quote.owner_id === actor.id ||
    actor.role === "ADMIN" ||
    has(actor, "COST_VIEW")
  );
}
async function document(db: DB, actor: Actor, id: string, edit = false) {
  const q = await getQuote(db, actor, id, edit);
  if (edit) {
    requirePermission(actor, "QUOTE_EDIT");
    check(
      mayCost(actor, q),
      "Cost access is required for job assignments",
      403,
    );
  }
  const settings = await one(db, "SELECT data FROM settings WHERE id=1");
  q.workflowCurrency =
    q.company_snapshot?.currency || settings?.data?.currency || "SAR";
  return q;
}
async function prepare(tx: DB, q: any) {
  let changed = false;
  const seen = new Set<string>();
  for (const line of q.lines) {
    let id = idFor(line);
    if (!id) {
      id = randomUUID();
      line.input = { ...line.input, watcherEventId: id };
      changed = true;
    }
    check(
      !seen.has(id),
      "Duplicate line identities. Duplicate products must have separate line IDs.",
      409,
    );
    seen.add(id);
  }
  if (changed) {
    await tx.query(
      "UPDATE quotations SET lines=$2::jsonb,version=version+1 WHERE id=$1",
      [q.id, J(q.lines)],
    );
    q.version++;
  }
  await tx.query(
    "INSERT INTO sw_job_documents(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING",
    [q.id, J({ lines: {} })],
  );
  return (await one(
    tx,
    "SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE",
    [q.id],
  ))!;
}
export function ready(q: any, link: any) {
  const complete =
    !Object.values<any>(link.data.lines).some((e) => e.decisionPending) &&
    q.lines.length > 0 &&
    q.lines.every((l: any) => {
      const entry = link.data.lines[idFor(l)];
      const job = entry?.PRICING;
      if (entry?.decisionPending) return false;
      if (job?.status === "SKIPPED")
        return job.fingerprint === lineFingerprint(l);
      return (
        l.workflowCost?.fingerprint === lineFingerprint(l) &&
        (!job || job.status === "COMPLETED" || job.status === "KNOWN")
      );
    });
  return {
    complete,
    ready: complete && q.status === "DRAFT",
    count: q.lines.length,
    round: complete
      ? hash(
          q.lines.map((l: any) => [
            idFor(l),
            l.workflowCost,
            link.data.lines[idFor(l)]?.PRICING?.status,
          ]),
        )
      : null,
  };
}
function branchLocked(link: any) {
  return !!(
    link?.data.branchLocked ||
    link?.data.erpRequestId ||
    Object.values<any>(link?.data.lines || {}).some(
      (l) => l.PRICING?.token || l.COLLECTION?.token,
    )
  );
}
export async function workflowContext(
  db: DB,
  actor: Actor,
  q: any,
  link: any,
  requested = "",
  transport = remote,
) {
  const locked = branchLocked(link);
  check(
    !locked ||
      !requested ||
      !link.data.branchId ||
      requested === link.data.branchId,
    "Document branch is locked after assignment",
    409,
  );
  const config = await state(db);
  const params = new URLSearchParams({
    documentId: q.id,
    owner: q.owner_id,
    actor: actor.id,
    branchId: requested || link?.data.branchId || "",
    kind: q.status === "DRAFT" ? "PRICING" : "COLLECTION",
  });
  const context = await transport(config, `jobs-context?${params}`);
  const shape = z
    .object({
      branchId: z.string().min(1),
      branchName: z.string().min(1),
      branches: z.array(z.object({ id: z.string(), name: z.string() })),
      staff: z.array(
        z.object({ id: z.string().min(1), name: z.string().optional() }),
      ),
      ownerMappingRevision: z.number().int().positive(),
      actorMappingRevision: z.number().int().positive(),
    })
    .safeParse(context);
  if (!shape.success)
    throw new ConnectionError(
      "ERP returned an incompatible staff directory. Check the ERP Integration Ingress URL and update the ERP server.",
      502,
      200,
      "UPDATE_REQUIRED",
    );
  // An older queued job has no reliable branch identity until ERP has acknowledged it.
  check(
    !locked || link.data.branchId || context.branchLocked,
    "Existing assignment needs ERP branch reconciliation before further changes",
    409,
  );
  return {
    ...context,
    workflowVersion: link?.revision,
    branchLocked: locked || context.branchLocked,
  };
}
export async function jobWorkspace(
  db: DB,
  actor: Actor,
  req: Request,
  transport = remote,
  startWorker = true,
) {
  workflowEnabled();
  const url = new URL(req.url);
  const id = url.searchParams.get("documentId");
  if (req.method === "GET" && url.searchParams.has("staff")) {
    check(id, "Choose a document first");
    const q = await document(db, actor, id);
    const link = await one(db, "SELECT * FROM sw_job_documents WHERE id=$1", [
      id,
    ]);
    try {
      const context = await workflowContext(db, actor, q, link, "", transport);
      if (
        !link?.data.branchId &&
        mayCost(actor, q) &&
        has(actor, "QUOTE_EDIT")
      ) {
        await db.transaction(async (tx) => {
          await tx.query("SELECT id FROM quotations WHERE id=$1 FOR UPDATE", [
            id,
          ]);
          const current = await prepare(tx, await document(tx, actor, id));
          check(
            !current.data.branchId ||
              current.data.branchId === context.branchId,
            "Document branch changed. Refresh.",
            409,
          );
          check(
            current.revision === (link?.revision || 0),
            "Assignments changed. Refresh.",
            409,
          );
          current.data.branchId = context.branchId;
          current.data.branchName = context.branchName;
          await tx.query(
            "UPDATE sw_job_documents SET data=$2::jsonb,revision=revision+1 WHERE id=$1",
            [id, J(current.data)],
          );
          await audit(
            tx,
            actor.id,
            "WORKFLOW_BRANCH_DEFAULT",
            "quotations",
            id,
            null,
            { branchId: context.branchId },
          );
          context.workflowVersion = current.revision + 1;
        });
      }
      return context;
    } catch (e) {
      const detail = (e as Error).message;
      const code =
        (e as any).code ||
        (/integration is disabled/i.test(detail)
          ? "INTEGRATION_DISABLED"
          : /mapping|branch|ownership/i.test(detail)
            ? "MAPPING_REQUIRED"
            : /401|403|key|permission/i.test(detail)
              ? "AUTHENTICATION_FAILED"
              : "ERP_UNAVAILABLE");
      const labels: Record<string, string> = {
        INTEGRATION_DISABLED: "Integration disabled",
        MAPPING_REQUIRED: "Mapping required",
        AUTHENTICATION_FAILED: "Authentication failed",
        ENDPOINT_REQUIRED: "Integration URL needs correction",
        UPDATE_REQUIRED: "ERP update required",
        ERP_UNAVAILABLE: "ERP unavailable",
      };
      return {
        staff: [],
        branches: [],
        directoryLoaded: false,
        diagnostic: {
          code,
          message: labels[code] || "ERP unavailable",
          detail,
        },
        error: `${labels[code] || "ERP unavailable"}: ${detail}`,
      };
    }
  }
  if (req.method === "GET" && !id) {
    const isAdmin = actor.role === "ADMIN" || has(actor, "QUOTE_VIEW_ALL");
    const statusParam = (url.searchParams.get("status") || "")
      .trim()
      .toUpperCase();
    const ownerParam = (url.searchParams.get("owner") || "").trim();

    const conditions: string[] = ["q.status<>'DELETED'"];
    const params: any[] = [];

    if (statusParam === "QUOTATIONS") {
      conditions.push("(CASE WHEN jsonb_array_length(COALESCE(j.data->'sharedQuotations','[]'::jsonb))>0 THEN 'ISSUED' ELSE q.status END)<>'DRAFT'");
    } else if (statusParam && statusParam !== "ALL") {
      params.push(statusParam);
      conditions.push(`(CASE WHEN jsonb_array_length(COALESCE(j.data->'sharedQuotations','[]'::jsonb))>0 THEN 'ISSUED' ELSE q.status END) = $${params.length}`);
    }

    if (!isAdmin) {
      params.push(actor.id);
      conditions.push(
        `(q.owner_id = $${params.length}::uuid OR $${params.length}::uuid = ANY(q.shared_with))`,
      );
    } else {
      if (ownerParam === "me") {
        params.push(actor.id);
        conditions.push(`q.owner_id = $${params.length}::uuid`);
      } else if (ownerParam && ownerParam !== "all") {
        params.push(ownerParam);
        conditions.push(`q.owner_id = $${params.length}::uuid`);
      }
    }

    const whereClause = conditions.join(" AND ");
    const rows = (
      await db.query(
        `SELECT q.id,q.number,q.status,q.customer,q.owner_id,u.name creator,j.data workflow FROM quotations q
      LEFT JOIN users u ON u.id=q.owner_id LEFT JOIN sw_job_documents j ON j.id=q.id::text
      WHERE ${whereClause} ORDER BY q.updated_at DESC LIMIT 200`,
        params,
      )
    ).rows;

    const creators = isAdmin
      ? (
          await db.query(
            "SELECT id, name, username FROM users WHERE disabled IS NOT TRUE ORDER BY name ASC",
          )
        ).rows
      : [];

    return {
      userId: actor.id,
      userReference: await one(
        db,
        "SELECT name,integration_reference reference FROM users WHERE id=$1",
        [actor.id],
      ),
      isAdmin,
      creators,
      rows: rows.map((q) => {
        const lines = Object.values<any>(q.workflow?.lines || {});
        return {
          id: q.id,
          number: q.number,
          status: q.workflow?.sharedQuotations?.length ? "ISSUED" : q.status,
          customer: q.customer,
          creator: q.creator || "Unknown",
          ownerId: q.owner_id,
          pricing: lines.filter((l) =>
            ["COMPLETED", "KNOWN"].includes(l.PRICING?.status),
          ).length,
          pricingAssigned: lines.filter((l) => l.PRICING).length,
          collection: lines.filter((l) => l.COLLECTION?.status === "COMPLETED")
            .length,
          collectionAssigned: lines.filter((l) => l.COLLECTION).length,
          workflow: q.workflow?.workflowNumber || "",
          orders: q.workflow?.orders || [],
          blockers: lines.filter(
            (l) => l.PRICING?.blocker || l.COLLECTION?.blocker,
          ).length,
        };
      }),
    };
  }
  if (req.method === 'GET' && id) {
    await document(db, actor, id);
    await retireObsoleteCollectionAssignments(db, id);
  }
  if (req.method === "GET" && id)
    return db.transaction(async (tx) => {
      await tx.query("SELECT id FROM quotations WHERE id=$1 FOR UPDATE", [id]);
      const q = await document(tx, actor, id);
      const link = await prepare(tx, q);
      let canonical: any;
      let syncWarning = '';
      if (link.data.erpRequestId && (q.owner_id === actor.id || actor.role === 'ADMIN')) {
        try { canonical = await remote(await state(tx), 'jobs-quotation', { documentId: id, actorId: actor.id }); }
        catch (e) { syncWarning = `Collection progress could not refresh: ${(e as Error).message}`; }
      }
      const failures = (
        await tx.query(
          "SELECT id,state,error FROM sw_job_outbox WHERE payload->>'documentId'=$1 AND state<>'SENT' ORDER BY next_at DESC",
          [id],
        )
      ).rows;
      return {
        id: q.id,
        number: q.number,
        status: canonical?.quotations?.length || link.data.sharedQuotations?.length ? "ISSUED" : q.status,
        version: q.version,
        workflowVersion: link.revision,
        creatorId: q.owner_id,
        creator: await one(
          tx,
          "SELECT name,integration_reference reference FROM users WHERE id=$1",
          [q.owner_id],
        ),
        branchId: link.data.branchId || null,
        branchLocked: branchLocked(link),
        currency: q.workflowCurrency,
        requestRevision: link.data.erpRevision,
        workflow: link.data.workflowNumber || "",
        erpRequestId: link.data.erpRequestId,
        orders: link.data.orders || [],
        collectionOrders: link.data.collectionOrders || [],
        ...ready(q, link),
        canOverride: actor.role === "ADMIN" && q.owner_id !== actor.id,
        handoverPending: !!link.data.handover,
        canAssign:
          !link.data.handover &&
          (q.owner_id === actor.id ||
            (actor.role === "ADMIN" &&
              Date.parse(link.data.overrides?.[actor.id]?.until || "") >
                Date.now())) &&
          has(actor, "QUOTE_EDIT"),
        failures,
        syncWarning,
        lines: q.lines.map((l: any) => ({
          id: idFor(l),
          description: l.description,
          partNumber: l.partNumber,
          unit: l.unit,
          quantity: lineQuantity(l),
          jobs: canonicalCollectionProgress(canonical, idFor(l), link.data.lines[idFor(l)] || {}),
          ...(mayCost(actor, q)
            ? {
                workflowCost: l.workflowCost,
                workflowPricing: l.workflowPricing,
                sellingPrice: l.price?.finalExcl,
                margin:
                  l.workflowCost &&
                  l.price?.finalExcl &&
                  l.workflowCost.currency === q.workflowCurrency &&
                  l.workflowCost.unit === l.unit &&
                  !l.workflowCost.stale &&
                  ["Excluding VAT", "No VAT"].includes(l.workflowCost.taxBasis)
                    ? new Decimal(l.price.finalExcl)
                        .minus(l.workflowCost.cost)
                        .toFixed()
                    : null,
              }
            : {}),
        })),
      };
    });
  check(req.method === "POST", "Method not allowed", 405);
  const input = await readBody(req);
  const documentId = z.string().uuid().parse(input.documentId);
  if (input.action === "pickup") {
    const q = await document(db, actor, documentId);
    const config = await state(db);
    const response = await transport(config, "jobs-pickup-source", {
      documentId,
      actorId: actor.id,
      orderId: input.orderId,
      supplier: String(input.supplier || ""),
      staff: String(input.staff || ""),
      internal: input.internal === true,
    });
    const { pickupPdf } = await import("../pdf/pickup");
    return pickupPdf(db, response);
  }
  const commandId = z.string().uuid().parse(input.eventId);
  const result = await receipt(
    db,
    `local:${actor.id}:${commandId}`,
    input,
    async (tx) => {
      await tx.query("SELECT id FROM quotations WHERE id=$1 FOR UPDATE", [
        documentId,
      ]);
      if (input.action === "override") {
        check(actor.role === "ADMIN", "Administrator required", 403);
        const reason = z.string().trim().min(5).max(1000).parse(input.reason);
        const q = await document(tx, actor, documentId);
        const link = await prepare(tx, q);
        check(!link.data.handover, "Handover pending", 409);
        (link.data.overrides ||= {})[actor.id] = {
          reason,
          until: new Date(Date.now() + 15 * 60000).toISOString(),
        };
        await tx.query(
          "UPDATE sw_job_documents SET data=$2::jsonb,revision=revision+1 WHERE id=$1",
          [q.id, J(link.data)],
        );
        await audit(
          tx,
          actor.id,
          "WORKFLOW_OVERRIDE_AUTHORIZED",
          "quotations",
          q.id,
          null,
          { reason },
        );
        return { saved: true };
      }
      const q = await document(tx, actor, documentId, true);
      const link = await prepare(tx, q);
      check(
        input.workflowVersion === link.revision,
        "Assignments changed. Refresh before editing.",
        409,
      );
      check(
        q.version === input.version,
        "Draft changed. Refresh before assigning or confirming prices.",
        409,
      );
      if (input.action === "branch") {
        check(
          typeof input.branchId === "string" && input.branchId,
          "Choose an ERP branch",
        );
        const context = await workflowContext(
          tx,
          actor,
          q,
          link,
          input.branchId,
          transport,
        );
        link.data.branchId = context.branchId;
        link.data.branchName = context.branchName;
        await tx.query(
          "UPDATE sw_job_documents SET data=$2::jsonb,revision=revision+1 WHERE id=$1",
          [q.id, J(link.data)],
        );
        await audit(tx, actor.id, "WORKFLOW_BRANCH", "quotations", q.id, null, {
          branchId: context.branchId,
        });
        return { saved: true };
      }
      if (input.action === "orderAction") {
        const op = z
          .enum(["orderCancel", "orderConfirm", "orderEdit"])
          .parse(input.operation);
        check(
          (link.data.collectionOrders || []).some(
            (o: any) => o.id === input.orderId,
          ),
          "Order missing",
        );
        if (op === "orderEdit") {
          const o = link.data.collectionOrders.find(
            (o: any) => o.id === input.orderId,
          );
          const changes = z
            .record(z.string(), z.string().trim().min(1).max(500))
            .parse(input.suppliers);
          check(
            Object.keys(changes).length > 0 &&
              Object.keys(changes).every((id) => o.quantities[id]),
            "Choose valid order products",
          );
          o.suppliers = { ...o.suppliers, ...changes };
        }
        await enqueue(tx, commandId, "jobs-order-command", {
          ...input,
          action: op,
          actorId: actor.id,
          revision: link.data.erpRevision,
          authorized: input.authorized === true,
          selected:
            input.operation === "orderEdit"
              ? Object.keys(input.suppliers || {})
              : Object.keys(
                  (link.data.collectionOrders || []).find(
                    (o: any) => o.id === input.orderId,
                  ).quantities,
                ),
        });
      } else if (input.action === "createOrder") {
        check(input.action !== "createOrder", "Confirm the customer quotation in the creator workflow; it creates the shared order", 409);
      } else if (["known", "skip", "remove"].includes(input.action)) {
        check(
          q.status === "DRAFT",
          "Only editable drafts can change pricing decisions",
          409,
        );
        const line = q.lines.find((l: any) => idFor(l) === input.lineId);
        check(line, "Product no longer exists in this draft", 409);
        const entry = (link.data.lines[input.lineId] ||= {});
        check(
          !entry.decisionPending,
          "Previous decision is still syncing. Retry synchronization first",
          409,
        );
        const needsERP = !!(
          link.data.erpRequestId ||
          entry.PRICING?.token ||
          input.requestId
        );
        (entry.history ||= []).push({
          job: entry.PRICING,
          cost: line.workflowCost,
          date: new Date().toISOString(),
          actor: actor.id,
        });
        const updatedAt = new Date().toISOString();
        if (input.action === "known") {
          const cost = z
            .object({
              cost: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/),
              currency: z.string().regex(/^[A-Z]{3}$/),
              unit: z.string().trim().min(1).max(500),
              supplier: z.string().trim().max(500).default(""),
              taxBasis: z.enum([
                "Excluding VAT",
                "Including VAT",
                "No VAT",
                "Unknown",
              ]),
              evidence: z.string().max(500).default(""),
              availability: z
                .string()
                .max(500)
                .default("Confirmed by salesman"),
              leadTime: z.string().max(500).default("Unknown"),
            })
            .parse(input.cost);
          check(
            cost.unit === line.unit && cost.currency === q.workflowCurrency,
            "Confirm currency and unit conversion first",
            409,
          );
          line.workflowCost = {
            ...cost,
            ownerId: q.owner_id,
            fingerprint: lineFingerprint(line),
            actorName: actor.name,
            actorId: actor.id,
            updatedAt,
          };
          delete line.workflowPricing;
          entry.PRICING = {
            status: "KNOWN",
            updatedAt,
            fingerprint: lineFingerprint(line),
          };
        } else if (input.action === "skip") {
          line.workflowPricing = {
            status: "SKIPPED",
            fingerprint: lineFingerprint(line),
            actorId: actor.id,
            updatedAt,
          };
          delete line.workflowCost;
          entry.PRICING = {
            status: "SKIPPED",
            updatedAt,
            fingerprint: lineFingerprint(line),
          };
        } else {
          check(
            q.lines.length > 1,
            "Keep at least one product in the draft",
            409,
          );
          (link.data.removedLines ||= []).push({
            line,
            actorId: actor.id,
            updatedAt,
          });
          q.lines = q.lines.filter((l: any) => idFor(l) !== input.lineId);
          entry.PRICING = { status: "REMOVED", updatedAt };
          const { computeTotals } = await import("../quotations/service");
          q.totals = computeTotals(q.lines);
        }
        if (needsERP) entry.decisionPending = commandId;
        await tx.query(
          "UPDATE quotations SET lines=$2::jsonb,totals=$3::jsonb,version=version+1,updated_at=now() WHERE id=$1",
          [q.id, J(q.lines), J(q.totals)],
        );
        if (needsERP)
          await enqueue(tx, commandId, "jobs-pricing-decision", {
            eventId: commandId,
            documentId: q.id,
            lineId: input.lineId,
            action: input.action,
            decision: entry.PRICING,
            cost: line.workflowCost,
            number: q.number,
            version: q.version + 1,
          });
      } else {
        check(input.action === "assign", "Unknown job action");
        check(
          (
            await one(tx, "SELECT disabled FROM users WHERE id=$1", [
              q.owner_id,
            ])
          )?.disabled !== true,
          "Document creator is disabled; correct user access before assigning",
          403,
        );
        const kind = z.enum(["PRICING", "COLLECTION"]).parse(input.kind);
        if (kind === 'COLLECTION') {
          check(Array.isArray(input.selected) && input.selected.every((id: string) => link.data.lines[id]?.collections?.[input.orderId]?.token || link.data.lines[id]?.COLLECTION?.token), 'Assign new collections through the shared creator workflow after customer confirmation', 409);
        }
        const order =
          kind === "COLLECTION"
            ? (link.data.collectionOrders || []).find(
                (o: any) => o.id === input.orderId,
              )
            : undefined;
        check(
          kind !== "COLLECTION" || order,
          "Create or select a collection order first",
        );
        check(
          kind === "PRICING"
            ? q.status === "DRAFT"
            : ["ISSUED", "ACCEPTED"].includes(q.status),
          kind === "PRICING"
            ? "Save an editable draft before assigning pricing"
            : "Issue the quotation before authorizing collection",
          409,
        );
        const context = await workflowContext(
          tx,
          actor,
          q,
          link,
          String(input.branchId || ""),
          transport,
        );
        check(
          input.ownerMappingRevision === context.ownerMappingRevision &&
            input.actorMappingRevision === context.actorMappingRevision,
          "Admin mapping changed. Refresh before assigning.",
          409,
        );
        check(
          context.staff.some((s: any) => s.id === input.assignee),
          "Choose eligible staff from this branch",
          403,
        );
        const payload = assignmentInput.parse({
          ...input,
          order,
          mode: order?.mode || input.mode,
          poNumber: order?.poNumber || input.poNumber,
          authorized: kind === "COLLECTION" ? true : input.authorized,
          sourceStatus: q.status,
          branchId: context.branchId,
          eventId: z.string().uuid().parse(input.eventId),
          documentVersion: q.version,
          ownerId: q.owner_id,
          actorId: actor.id,
          number: q.number,
          customer: q.customer.name || "Customer",
          contact: q.customer.mobile || "",
          lines: q.lines.map((l: any) => ({
            id: idFor(l),
            name: l.description,
            partNumber: l.partNumber || "",
            specifications: l.specifications || "",
            unit: l.unit,
            quantity: String(lineQuantity(l)),
            currency: q.workflowCurrency,
            fingerprint: lineFingerprint(l),
            knownCost:
              l.workflowCost?.supplier &&
              l.workflowCost?.evidence &&
              l.workflowCost?.fingerprint === lineFingerprint(l)
                ? l.workflowCost
                : undefined,
          })),
        });
        link.data.branchId = context.branchId;
        link.data.branchName = context.branchName;
        link.data.branchLocked = true;
        const oldEvent = await one(
          tx,
          "SELECT payload FROM sw_job_outbox WHERE id=$1",
          [payload.eventId],
        );
        check(
          !oldEvent || hash(oldEvent.payload) === hash(payload),
          "Assignment retry differs from the original",
          409,
        );
        if (!oldEvent) {
          for (const lineId of payload.selected) {
            const entry = (link.data.lines[lineId] ||= {});
            if (kind === "PRICING") {
              check(
                !entry.decisionPending,
                "Previous pricing decision is still syncing",
                409,
              );
              const line = q.lines.find((l: any) => idFor(l) === lineId);
              if (line?.workflowPricing) {
                delete line.workflowPricing;
                await tx.query(
                  "UPDATE quotations SET lines=$2::jsonb WHERE id=$1",
                  [q.id, J(q.lines)],
                );
              }
            }
            entry[kind] = {
              token: payload.eventId,
              status: "PENDING_ERP_SYNC",
              owner: payload.assignee,
              ownerName: context.staff.find(
                (s: any) => s.id === payload.assignee,
              )?.name,
              currency: payload.lines.find((l) => l.id === lineId)!.currency,
              notes: payload.notes,
              shops: payload.shops,
              due: payload.due || payload.noDueReason,
            };
          }
          if (order)
            for (const lineId of payload.selected) {
              const entry = link.data.lines[lineId];
              (entry.collections ||= {})[order.id] = {
                ...entry.COLLECTION,
                orderId: order.id,
              };
            }
          await enqueue(tx, payload.eventId, "jobs-assign", payload);
        }
      }
      await tx.query(
        "UPDATE sw_job_documents SET data=$2::jsonb,revision=revision+1 WHERE id=$1",
        [q.id, J(link.data)],
      );
      await audit(tx, actor.id, "WORKFLOW_JOB", "quotations", q.id, null, {
        action: input.action,
        selected: input.selected || [input.lineId],
      });
      const completion = ready(q, link);
      if (completion.ready && completion.round)
        await enqueue(tx, `ready:${q.id}:${completion.round}`, "jobs-ready", {
          eventId: `ready:${q.id}:${completion.round}`,
          documentId: q.id,
          actorId: actor.id,
          ...completion,
        });
      return { saved: true, ...completion };
    },
  );
  if (startWorker) void runPriceJobs(db).catch(() => {});
  return result;
}
const resultInput = z.object({
  eventId: z.string().uuid(),
  documentId: z.string().uuid(),
  lineId: z.string().uuid(),
  token: z.string().uuid(),
  orderId: z.string().optional(),
  revision: z.number().int(),
  kind: z.enum(["PRICING", "COLLECTION"]),
  fingerprint: z.string().length(64),
  done: z.boolean(),
  blocker: z.string(),
  actorName: z.string().max(500),
  updatedAt: z.string().datetime(),
  cost: costInput.optional(),
  movements: z.array(z.any()).max(10000).default([]),
});
export async function receiveJobResult(db: DB, req: Request) {
  workflowEnabled();
  check(req.method === "POST", "Method not allowed", 405);
  await authenticate(db, req, "jobs:results");
  const result = resultInput.parse(await readBody(req));
  return receipt(db, result.eventId, result, async (tx) => {
    const q = await one(tx, "SELECT * FROM quotations WHERE id=$1 FOR UPDATE", [
      result.documentId,
    ]);
    check(q, "Document not found", 404);
    const link = await one(
      tx,
      "SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE",
      [q.id],
    );
    check(link, "Document was not linked", 409);
    const job = result.orderId
      ? link.data.lines[result.lineId]?.collections?.[result.orderId]
      : link.data.lines[result.lineId]?.[result.kind];
    if (
      !job ||
      job.token !== result.token ||
      (job.revision || 0) >= result.revision
    )
      return { received: true, stale: true };
    const line = q.lines.find((l: any) => idFor(l) === result.lineId);
    const conflict =
      !line ||
      lineFingerprint(line) !== result.fingerprint ||
      (result.kind === "PRICING" && q.status !== "DRAFT") ||
      (result.cost &&
        (result.cost.unit !== line?.unit ||
          result.cost.currency !== job.currency));
    if (
      result.orderId &&
      link.data.lines[result.lineId]?.COLLECTION?.token === result.token
    )
      link.data.lines[result.lineId].COLLECTION = job;
    job.revision = result.revision;
    job.status = conflict
      ? "REVIEW_REQUIRED"
      : result.done
        ? "COMPLETED"
        : "PENDING";
    job.blocker = conflict
      ? "Document, product, currency or unit changed; review the retained ERP result"
      : result.blocker;
    job.actorName = result.actorName;
    job.updatedAt = result.updatedAt;
    // Costs stay in the restricted quotation line; job summaries contain no cost payload.
    if (conflict) {
      job.pendingResultId = result.eventId;
      (link.data.pendingResults ||= {})[result.eventId] = result;
    }
    if (result.kind === "COLLECTION") job.movements = result.movements;
    if (!conflict && result.kind === "PRICING" && result.done) {
      check(result.cost, "Completed pricing requires a supplier cost");
      delete line.workflowPricing;
      line.workflowCost = {
        ...result.cost,
        ownerId: q.owner_id,
        fingerprint: result.fingerprint,
        actorName: result.actorName,
        updatedAt: result.updatedAt,
      };
      await tx.query(
        "UPDATE quotations SET lines=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1",
        [q.id, J(q.lines)],
      );
    }
    await tx.query(
      "UPDATE sw_job_documents SET data=$2::jsonb,revision=revision+1 WHERE id=$1",
      [q.id, J(link.data)],
    );
    await audit(tx, null, "WORKFLOW_RESULT", "quotations", q.id, null, {
      eventId: result.eventId,
      lineId: result.lineId,
      conflict,
    });
    return { received: true, ...ready(q, link) };
  });
}
let running = false;
/** Retire only explicitly rejected obsolete commands; retain their receipts/history. */
export async function retireObsoleteCollectionAssignments(db: DB, documentId?: string) {
  await db.transaction(async tx => {
    const rejected = (await tx.query("SELECT * FROM sw_job_outbox WHERE endpoint='jobs-assign' AND payload->>'kind'='COLLECTION' AND state IN ('FAILED','REJECTED') AND error LIKE '%Remote HTTP 409: Confirm the shared quotation and assign collection through jobs-quotation-command%' AND ($1::text IS NULL OR payload->>'documentId'=$1) FOR UPDATE", [documentId || null])).rows;
    for (const row of rejected) {
      await tx.query("UPDATE sw_job_outbox SET state='REJECTED',lease_until=NULL WHERE id=$1", [row.id]);
      const link = await one(tx, 'SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE', [row.payload.documentId]);
      if (!link) continue;
      for (const lineId of row.payload.selected || []) {
        const entry = link.data.lines[lineId];
        for (const job of [entry?.COLLECTION, ...Object.values<any>(entry?.collections || {})]) {
          if (job?.token === row.payload.eventId && job.status === 'PENDING_ERP_SYNC') { job.status = 'REJECTED'; job.blocker = 'Previous collection assignment was rejected. Open quotation to assign the confirmed order.'; }
        }
      }
      await tx.query('UPDATE sw_job_documents SET data=$2::jsonb WHERE id=$1', [link.id, J(link.data)]);
    }
  });
}
export async function runPriceJobs(db: DB) {
  if (running || process.env.WORKFLOW_INTEGRATION_ENABLED !== "true") return;
  running = true;
  try {
    await retireObsoleteCollectionAssignments(db);
    await deliver(db, "REMOTE", undefined, async (row, response) => {
      if (row.endpoint === "jobs-pricing-decision") {
        await acknowledgePricingDecision(db, row, response);
        return;
      }
      if (!["jobs-assign", "jobs-order-command"].includes(row.endpoint)) return;
      await db.transaction(async (tx) => {
        const link = await one(
          tx,
          "SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE",
          [row.payload.documentId],
        );
        if (!link) return;
        for (const lineId of row.payload.selected || []) {
          const entry = link.data.lines[lineId];
          const job = row.payload.order
            ? entry?.collections?.[row.payload.order.id]
            : entry?.[row.payload.kind];
          if (
            job?.token === row.payload.eventId &&
            job.status === "PENDING_ERP_SYNC"
          )
            job.status = "ASSIGNED";
        }
        if (response.requestRevision >= Number(link.data.erpRevision || 0)) {
          link.data.erpRevision = response.requestRevision;
          link.data.erpRequestId = response.requestId;
          link.data.workflowNumber = response.number;
          if (response.orders) {
            link.data.orders = response.orders;
            for (const o of link.data.collectionOrders || []) {
              const current = response.orders.find((s: any) => s.id === o.id);
              if (current) {
                o.mode = current.mode;
                o.poNumber = current.poNumber;
              }
            }
          }
        }
        await tx.query(
          "UPDATE sw_job_documents SET data=$2::jsonb WHERE id=$1",
          [link.id, J(link.data)],
        );
      });
    });
  } finally {
    running = false;
  }
}

// Quotation save/issue rebuilds prices from the catalog. Keep only server-owned
// per-line sourcing metadata whose identity/specification fingerprint still matches.
export function preserveWorkflowCosts(lines: any[], oldLines: any[]) {
  const old = new Map(oldLines.map((l) => [idFor(l), l]));
  const ids = new Set<string>();
  for (const line of lines) {
    const id = idFor(line);
    check(
      id && !ids.has(id),
      "Each product card needs its own line identity",
      409,
    );
    ids.add(id);
    const previous = old.get(id);
    delete line.workflowCost;
    delete line.workflowPricing;
    if (previous?.workflowPricing)
      line.workflowPricing = {
        ...previous.workflowPricing,
        stale: previous.workflowPricing.fingerprint !== lineFingerprint(line),
      };
    if (previous?.workflowCost)
      line.workflowCost = {
        ...previous.workflowCost,
        stale: previous.workflowCost.fingerprint !== lineFingerprint(line),
      };
  }
  return lines;
}

export async function assertWorkflowPricingReady(db: DB, q: any) {
  const link = await one(db, "SELECT * FROM sw_job_documents WHERE id=$1", [
    q.id,
  ]);
  if (link && Object.values<any>(link.data.lines).some((l) => l.PRICING))
    check(
      ready(q, link).complete,
      "Finish or review all assigned supplier prices before issuing this quotation",
      409,
    );
}

// A cart edit uses the same cancellation contract as the focused ERP screen.
export async function recordRemovedDraftLines(
  tx: DB,
  actor: Actor,
  id: string,
  oldLines: any[],
  lines: any[],
) {
  const removed = oldLines.filter(
    (l) => !lines.some((n) => idFor(n) === idFor(l)),
  );
  const link = await one(
    tx,
    "SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!link) return;
  check(
    !lines.some((l) =>
      (link.data.removedLines || []).some(
        (r: any) => idFor(r.line) === idFor(l),
      ),
    ),
    "Removed products cannot be restored by an old draft save",
    409,
  );
  if (!removed.length) return;
  const q = await one(tx, "SELECT version,number FROM quotations WHERE id=$1", [
    id,
  ]);
  check(q, "Document missing", 404);
  for (const line of removed) {
    const entry = (link.data.lines[idFor(line)] ||= {});
    check(
      !entry.decisionPending,
      "Finish pending pricing synchronization before removing products",
      409,
    );
    const eventId = randomUUID(),
      updatedAt = new Date().toISOString();
    (entry.history ||= []).push({
      job: entry.PRICING,
      cost: line.workflowCost,
      date: updatedAt,
      actor: actor.id,
    });
    (link.data.removedLines ||= []).push({
      line,
      actorId: actor.id,
      updatedAt,
    });
    entry.PRICING = { status: "REMOVED", updatedAt };
    entry.decisionPending = eventId;
    await enqueue(tx, eventId, "jobs-pricing-decision", {
      eventId,
      documentId: id,
      lineId: idFor(line),
      action: "remove",
      decision: entry.PRICING,
      number: q.number,
      version: q.version + 1,
    });
  }
  await tx.query(
    "UPDATE sw_job_documents SET data=$2::jsonb,revision=revision+1 WHERE id=$1",
    [id, J(link.data)],
  );
  await audit(tx, actor.id, "WORKFLOW_REMOVE_LINES", "quotations", id, null, {
    removed: removed.map(idFor),
  });
}
export async function acknowledgePricingDecision(
  db: DB,
  row: any,
  response: any,
) {
  check(response?.received, "Pricing decision acknowledgement missing", 502);
  await db.transaction(async (tx) => {
    const link = await one(
      tx,
      "SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE",
      [row.payload.documentId],
    );
    if (
      link &&
      link.data.lines[row.payload.lineId]?.decisionPending === row.id
    ) {
      delete link.data.lines[row.payload.lineId].decisionPending;
      await tx.query("UPDATE sw_job_documents SET data=$2::jsonb WHERE id=$1", [
        link.id,
        J(link.data),
      ]);
      const q = await one(tx, "SELECT * FROM quotations WHERE id=$1", [
        link.id,
      ]);
      check(q, "Document missing", 404);
      const completion = ready(q, link);
      if (completion.ready)
        await enqueue(tx, `ready:${q.id}:${completion.round}`, "jobs-ready", {
          eventId: `ready:${q.id}:${completion.round}`,
          documentId: q.id,
          actorId: q.owner_id,
          ...completion,
        });
    }
  });
}
