// Mirrored in Price List; only the ERP worker dispatches WHATSAPP messages.
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ConnectionDB, check, remote, state, ConnectionError } from "./core";

export const amount = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
const text = z.string().trim().min(1).max(500);
export const costInput = z.object({
  cost: amount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  unit: text,
  supplier: text,
  taxBasis: text,
  availability: text,
  evidence: text,
  leadTime: z.string().max(500).default("Unknown"),
});
export const jobLine = z.object({
  id: z.string().uuid(),
  name: text,
  specifications: z.string().max(10000).default(""),
  partNumber: z.string().max(500).default(""),
  unit: text,
  quantity: amount.refine((v) => Number(v) > 0),
  currency: z.string().regex(/^[A-Z]{3}$/),
  fingerprint: z.string().length(64),
  knownCost: costInput.optional(),
});
export const assignmentInput = z
  .object({
    eventId: z.string().uuid(),
    documentId: z.string().uuid(),
    number: text,
    ownerId: text,
    actorId: text,
    customer: text,
    contact: z.string().max(500).default("Not supplied"),
    branchId: text,
    ownerMappingRevision: z.number().int().positive(),
    actorMappingRevision: z.number().int().positive(),
    workflowVersion: z.number().int().nonnegative(),
    documentVersion: z.number().int().positive(),
    lines: z.array(jobLine).min(1).max(200),
    selected: z.array(z.string().uuid()).min(1).max(200),
    assignee: text,
    kind: z.enum(["PRICING", "COLLECTION"]),
    mode: z.enum(["ORDER_CONFIRMED", "EARLY_AUTHORIZED"]).optional(),
    order: z
      .object({
        id: z.string().uuid(),
        mode: z.enum(["ORDER_CONFIRMED", "EARLY_AUTHORIZED"]),
        quantities: z.record(z.string(), amount),
        suppliers: z.record(z.string(), z.string().max(500)).default({}),
      })
      .optional(),
    operation: z.enum(["ASSIGN", "CANCEL"]).default("ASSIGN"),
    sourceStatus: z.string().default(""),
    quantities: z.record(z.string(), amount).default({}),
    poNumber: z.string().max(500).default(""),
    notes: z.string().max(10000).default(""),
    shops: z.string().max(10000).default(""),
    due: z.string().default(""),
    noDueReason: z.string().max(500).default(""),
    authorized: z.boolean().default(false),
  })
  .refine(
    (v) =>
      v.due ? Number.isFinite(Date.parse(v.due)) : !!v.noDueReason.trim(),
    "Enter a deadline or an unknown-date reason",
  )
  .refine(
    (v) =>
      new Set(v.selected).size === v.selected.length &&
      v.selected.every((id) => v.lines.some((l) => l.id === id)),
    "Invalid selected lines",
  );
export type Assignment = z.infer<typeof assignmentInput>;
export function workflowEnabled() {
  check(
    process.env.WORKFLOW_INTEGRATION_ENABLED === "true",
    "Pricing & Collection Jobs integration is disabled",
    503,
  );
}
export const hash = (data: unknown): string =>
  createHash("sha256")
    .update(
      JSON.stringify(data, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, value[key]]),
            )
          : value,
      ),
    )
    .digest("hex");
export const lineFingerprint = (line: any) =>
  hash([
    line.description || line.name,
    line.partNumber || "",
    line.specifications || "",
    line.unit,
    String(line.input?.quantity ?? line.quantity ?? ""),
  ]);
export async function enqueue(
  db: ConnectionDB,
  id: string,
  endpoint: string,
  payload: unknown,
  channel = "REMOTE",
) {
  await db.query(
    "INSERT INTO sw_job_outbox(id,channel,endpoint,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING",
    [id, channel, endpoint, JSON.stringify(payload)],
  );
}
export async function receipt<T>(
  db: ConnectionDB,
  eventId: string,
  payload: unknown,
  apply: (tx: ConnectionDB) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Transaction-scoped serialization covers concurrent first deliveries too.
    await tx.query("SELECT id FROM sw_link_state WHERE id=1 FOR UPDATE");
    const previous = (
      await tx.query("SELECT hash,result FROM sw_job_events WHERE id=$1", [
        eventId,
      ])
    ).rows[0];
    check(
      !previous || previous.hash === hash(payload),
      "Event ID was already used for different content",
      409,
    );
    if (previous) return previous.result;
    const result = await apply(tx);
    await tx.query(
      "INSERT INTO sw_job_events(id,hash,result) VALUES($1,$2,$3::jsonb)",
      [eventId, hash(payload), JSON.stringify(result)],
    );
    return result;
  });
}
export async function deliver(
  db: ConnectionDB,
  channel: string,
  send?: (payload: any) => Promise<boolean>,
  acknowledge?: (row: any, result: any) => Promise<void>,
) {
  workflowEnabled();
  const config = channel === "REMOTE" ? await state(db) : null;
  if (config && (config.paused || !config.url || !config.secret)) return;
  if (channel === "WHATSAPP")
    await db.query(
      "UPDATE sw_job_outbox SET state='DELIVERY_UNKNOWN',error='Worker interrupted during send; check delivery before retrying' WHERE channel='WHATSAPP' AND state='SENDING' AND lease_until<now()",
    );
  for (let n = 0; n < 20; n++) {
    const row = (
      await db.query(
        `UPDATE sw_job_outbox SET state='SENDING', attempts=attempts+1,lease_until=now()+interval '90 seconds'
      WHERE id=(SELECT id FROM sw_job_outbox WHERE channel=$1 AND ((state IN ('PENDING','FAILED') AND next_at<=now()) OR ($1='REMOTE' AND state='SENDING' AND lease_until<now())) ORDER BY next_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
        [channel],
      )
    ).rows[0];
    if (!row) return;
    try {
      const result =
        channel === "REMOTE"
          ? await remote(config, row.endpoint, row.payload)
          : await send!(row.payload);
      if (channel === "WHATSAPP" && result !== true) {
        await db.query(
          "UPDATE sw_job_outbox SET state='DELIVERY_UNKNOWN',error='Transport did not confirm acceptance; check WhatsApp before retrying' WHERE id=$1",
          [row.id],
        );
        continue;
      }
      if (acknowledge) await acknowledge(row, result);
      await db.query(
        "UPDATE sw_job_outbox SET state=$2,result=$3::jsonb,error=NULL,lease_until=NULL WHERE id=$1",
        [
          row.id,
          channel === "REMOTE" ? "SENT" : "ACCEPTED",
          JSON.stringify(result),
        ],
      );
    } catch (e) {
      const blocked = (e as any)?.code === "MISSING_PHONE";
      const obsoleteCollection = row.endpoint === 'jobs-assign' && row.payload.kind === 'COLLECTION' && e instanceof ConnectionError && e.remoteStatus === 409 && /Confirm the shared quotation and assign collection through jobs-quotation-command/.test(e.message);
      const next = new Date(
        Date.now() + Math.min(3600000, 10000 * 2 ** Math.min(row.attempts, 8)),
      ).toISOString();
      await db.query(
        "UPDATE sw_job_outbox SET state=$2,error=$3,next_at=$4::timestamptz,lease_until=NULL WHERE id=$1",
        [
          row.id,
          channel === "WHATSAPP"
            ? blocked
              ? "FAILED"
              : "DELIVERY_UNKNOWN"
            : obsoleteCollection ? 'REJECTED' : "FAILED",
          channel === "WHATSAPP"
            ? blocked
              ? "Staff WhatsApp number missing or access disabled"
              : "Delivery unknown; check WhatsApp before retrying"
            : `Remote delivery failed: ${e instanceof Error ? e.message.slice(0, 500).replace(/swk_[a-zA-Z0-9_-]+/g, "[redacted]") : "Check pairing, permissions and document conflicts"}`,
          next,
        ],
      );
    }
  }
}
export { randomUUID };
