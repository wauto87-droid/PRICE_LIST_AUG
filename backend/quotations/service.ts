import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import {
  type Actor,
  has,
  pricingPolicy,
  requirePermission,
  lockActor,
} from "../auth/service";
import { lineInput, calculate, totals } from "../pricing/engine";
import { getProduct, toInput } from "../products/service";
export const quoteInput = z
  .object({
    customer: z
      .object({
        name: z.string().max(150).default(""),
        number: z.string().max(80).default(""),
        mobile: z.string().max(50).default(""),
        reference: z.string().max(200).default(""),
      })
      .strict(),
    lines: z.array(lineInput).min(1).max(200),
  })
  .strict();
// Pre-migration snapshots used the one original price, migrated to End Customer.
export const savedLineInput = (line: any) => ({
  ...line.input,
  sellingLevel: line.input.sellingLevel ?? line.sellingLevel ?? "END_CUSTOMER",
});
export async function snapshot(
  db: DB,
  actor: Actor,
  lines: z.infer<typeof lineInput>[],
) {
  const result = [];
  await lockActor(db, actor);
  await db.query(
    "SELECT id FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
    [[...new Set(lines.map((l) => l.productId))]],
  );
  for (const input of lines) {
    const row = await getProduct(db, input.productId);
    assert(row.active, 409, `Product is archived: ${row.part_number}`);
    const p = toInput(row),
      calculation = calculate(p, pricingPolicy(actor), input);
    result.push({
      productId: row.id,
      partNumber: p.partNumber,
      description: p.description,
      unit: p.unit,
      quantityPrecision: p.quantityPrecision,
      productVersion: row.version,
      sellingLevel: calculation.sellingLevel,
      input: { ...input, sellingLevel: calculation.sellingLevel },
      price: calculation,
      internalPricing: {
        minimumEnabled: p.minimumEnabled,
        minimum: p.minimum,
        discountLimit: actor.maxDiscount,
      },
      timestamp: new Date().toISOString(),
    });
  }
  return result;
}
function publicLine(line: any, actor: Actor) {
  const { maxDiscount, ...price } = line.price;
  const { internalPricing, ...safe } = line;
  return {
    ...safe,
    price: {
      ...price,
      ...(has(actor, "MIN_PRICE_VIEW") ? { maxDiscount } : {}),
    },
  };
}
export function publicQuote(q: any, actor: Actor) {
  return { ...q, lines: q.lines.map((l: any) => publicLine(l, actor)) };
}
export async function getQuote(db: DB, actor: Actor, id: string, edit = false) {
  const q = await one(db, "SELECT * FROM quotations WHERE id=$1", [id]);
  assert(q && q.status !== "DELETED", 404, "Quotation not found");
  assert(
    q.owner_id === actor.id ||
      has(actor, edit ? "QUOTE_EDIT_ALL" : "QUOTE_VIEW_ALL"),
    403,
    "This quotation belongs to another user",
  );
  return q;
}
async function nextNumber(db: DB, kind: "DR" | "QT", settings: any) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replaceAll("-", "");
  const row = await one(
    db,
    "INSERT INTO document_sequences(day,kind,counter) VALUES($1,$2,1) ON CONFLICT(day,kind) DO UPDATE SET counter=document_sequences.counter+1 RETURNING counter",
    [day, kind],
  );
  return `${kind === "DR" ? settings.draftPrefix : settings.quotePrefix}-${day}-${String(row!.counter).padStart(4, "0")}`;
}
export async function saveDraft(
  db: DB,
  actor: Actor,
  input: unknown,
  settings: any,
  id?: string,
  version?: number,
  requestId?: string,
) {
  requirePermission(actor, id ? "QUOTE_EDIT" : "QUOTE_CREATE");
  const data = quoteInput.parse(input);
  return db.transaction(async (tx) => {
    settings = (await one(
      tx,
      "SELECT data FROM settings WHERE id=1 FOR SHARE",
    ))!.data;
    if (!id && requestId) {
      z.string().uuid().parse(requestId);
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [actor.id]);
      const previous = await one(
        tx,
        "SELECT response FROM idempotency_keys WHERE user_id=$1 AND key=$2",
        [actor.id, requestId],
      );
      if (previous) {
        assert(
          previous.response.inputHash ===
            createHash("sha256").update(json(data)).digest("hex"),
          409,
          "This draft was already saved with different values. Reopen it from Quotations before editing",
        );
        return publicQuote(
          await getQuote(tx, actor, previous.response.quoteId),
          actor,
        );
      }
    }
    if (id) {
      await tx.query("SELECT id FROM quotations WHERE id=$1 FOR UPDATE", [id]);
      const old = await getQuote(tx, actor, id, true);
      assert(old.status === "DRAFT", 409, "Issued quotations cannot be edited");
      assert(
        old.version === version,
        409,
        "Draft changed on another device. Reload before saving",
      );
    }
    const lines = await snapshot(tx, actor, data.lines);
    const sum = totals(lines.map((l) => l.price));
    const quoteId = id ?? randomUUID();
    if (id)
      await tx.query(
        "UPDATE quotations SET customer=$2,lines=$3,totals=$4,version=version+1,updated_at=now() WHERE id=$1",
        [id, json(data.customer), json(lines), json(sum)],
      );
    else
      await tx.query(
        "INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,$2,'DRAFT',$3,$4,$5,$6)",
        [
          quoteId,
          await nextNumber(tx, "DR", settings),
          actor.id,
          json(data.customer),
          json(lines),
          json(sum),
        ],
      );
    for (const line of lines)
      if (line.price.overridden)
        await audit(
          tx,
          actor.id,
          "MIN_PRICE_OVERRIDE",
          "quotations",
          quoteId,
          null,
          { productId: line.productId, price: line.price.finalExcl },
          line.input.reason,
        );
    await audit(
      tx,
      actor.id,
      id ? "DRAFT_EDIT" : "DRAFT_CREATE",
      "quotations",
      quoteId,
    );
    if (!id && requestId)
      await tx.query(
        "INSERT INTO idempotency_keys(user_id,key,response) VALUES($1,$2,$3)",
        [
          actor.id,
          requestId,
          json({
            quoteId,
            inputHash: createHash("sha256").update(json(data)).digest("hex"),
          }),
        ],
      );
    return publicQuote(await getQuote(tx, actor, quoteId), actor);
  });
}
const fingerprint = (q: any, lines: any[], actor: Actor, settings: any) =>
  createHash("sha256")
    .update(
      json({
        id: q.id,
        version: q.version,
        lines: lines.map(({ timestamp, ...l }) => l),
        permissions: actor.permissions,
        maxDiscount: actor.maxDiscount,
        settings,
      }),
    )
    .digest("hex");
export async function reviewIssue(
  db: DB,
  actor: Actor,
  id: string,
  settings: any,
) {
  requirePermission(actor, "QUOTE_ISSUE");
  return db.transaction(async (tx) => {
    settings = (await one(
      tx,
      "SELECT data FROM settings WHERE id=1 FOR SHARE",
    ))!.data;
    const q = await getQuote(tx, actor, id, true);
    assert(q.status === "DRAFT", 409, "Only drafts can be issued");
    const lines = await snapshot(tx, actor, q.lines.map(savedLineInput));
    return {
      token: fingerprint(q, lines, actor, settings),
      version: q.version,
      before: publicQuote(q, actor),
      after: lines.map((l) => publicLine(l, actor)),
      totals: totals(lines.map((l) => l.price)),
    };
  });
}
export async function issue(
  db: DB,
  actor: Actor,
  id: string,
  token: string,
  settings: any,
) {
  requirePermission(actor, "QUOTE_ISSUE");
  return db.transaction(async (tx) => {
    settings = (await one(
      tx,
      "SELECT data FROM settings WHERE id=1 FOR SHARE",
    ))!.data;
    await tx.query("SELECT id FROM quotations WHERE id=$1 FOR UPDATE", [id]);
    const q = await getQuote(tx, actor, id, true);
    assert(q.status === "DRAFT", 409, "Only drafts can be issued");
    const lines = await snapshot(tx, actor, q.lines.map(savedLineInput));
    assert(
      fingerprint(q, lines, actor, settings) === token,
      409,
      "Pricing or permissions changed. Review again before issuing",
    );
    const customer = {
      ...q.customer,
      name: q.customer.name || (!q.customer.number ? "Walk-in Customer" : ""),
    };
    await tx.query(
      "UPDATE quotations SET status='ISSUED',number=$2,lines=$3,totals=$4,company_snapshot=$5,customer=$6,issued_at=now(),updated_at=now(),version=version+1 WHERE id=$1",
      [
        id,
        await nextNumber(tx, "QT", settings),
        json(lines),
        json(totals(lines.map((l) => l.price))),
        json(settings),
        json(customer),
      ],
    );
    for (const line of lines)
      if (line.price.overridden)
        await audit(
          tx,
          actor.id,
          "MIN_PRICE_OVERRIDE",
          "quotations",
          id,
          null,
          { productId: line.productId, price: line.price.finalExcl },
          line.input.reason,
        );
    await audit(tx, actor.id, "QUOTATION_ISSUE", "quotations", id);
    return publicQuote(await getQuote(tx, actor, id), actor);
  });
}
