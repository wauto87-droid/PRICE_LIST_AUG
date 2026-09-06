import { createHash, randomBytes, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import type { DB } from "../core/db";
import { one } from "../core/db";
import { AppError, assert } from "../core/errors";
import { audit, json } from "../core/audit";
import type { Actor } from "../auth/service";
import { has, requirePermission } from "../auth/service";
import * as quotes from "./service";

const ruleInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    active: z.boolean().default(true),
    priority: z.number().int().min(0).max(10000).default(100),
    tier: z.number().int().min(1).max(20).default(1),
    approverRole: z.string().trim().max(80).nullable().default(null),
    approverUserId: z.string().uuid().nullable().default(null),
    allowSelfApproval: z.boolean().default(false),
    conditions: z
      .object({
        roleIds: z.array(z.string().max(80)).max(50).default([]),
        minimumDiscount: z.string().default("0"),
        minimumTotal: z.string().default("0"),
        maximumMargin: z.string().optional(),
        brandIds: z.array(z.string().uuid()).max(100).default([]),
        categoryIds: z.array(z.string().uuid()).max(100).default([]),
      })
      .default({
        roleIds: [],
        minimumDiscount: "0",
        minimumTotal: "0",
        brandIds: [],
        categoryIds: [],
      }),
    version: z.number().int().positive().optional(),
  })
  .refine(
    (v) => v.approverRole || v.approverUserId,
    "Choose an approver role or user",
  );

const d = (value: unknown) => new Decimal(String(value ?? 0));
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function listRules(db: DB, actor: Actor) {
  requirePermission(actor, "QUOTE_APPROVE");
  return (
    await db.query(
      `SELECT r.*,u.name approver_user_name FROM approval_rules r LEFT JOIN users u ON u.id=r.approver_user_id ORDER BY priority,tier,name`,
    )
  ).rows;
}

export async function saveRule(
  db: DB,
  actor: Actor,
  id: string | undefined,
  raw: unknown,
) {
  requirePermission(actor, "QUOTE_APPROVE");
  const data = ruleInput.parse(raw);
  return db.transaction(async (tx) => {
    if (data.approverRole)
      assert(
        await one(tx, "SELECT id FROM roles WHERE id=$1", [data.approverRole]),
        400,
        "Approver role not found",
      );
    if (data.approverUserId)
      assert(
        await one(tx, "SELECT id FROM users WHERE id=$1 AND NOT disabled", [
          data.approverUserId,
        ]),
        400,
        "Approver user not found or disabled",
      );
    if (id) {
      const before = await one(
        tx,
        "SELECT * FROM approval_rules WHERE id=$1 FOR UPDATE",
        [id],
      );
      assert(before, 404, "Approval rule not found");
      assert(
        before.version === data.version,
        409,
        "Approval rule changed. Reload and try again",
      );
      const row = (
        await tx.query(
          `UPDATE approval_rules SET name=$2,active=$3,priority=$4,tier=$5,approver_role=$6,approver_user_id=$7,
        allow_self_approval=$8,conditions=$9,updated_by=$10,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,
          [
            id,
            data.name,
            data.active,
            data.priority,
            data.tier,
            data.approverRole,
            data.approverUserId,
            data.allowSelfApproval,
            json(data.conditions),
            actor.id,
          ],
        )
      ).rows[0];
      await audit(
        tx,
        actor.id,
        "APPROVAL_RULE_UPDATE",
        "approval_rules",
        id,
        before,
        row,
      );
      return row;
    }
    const nextId = randomUUID();
    const row = (
      await tx.query(
        `INSERT INTO approval_rules(id,name,active,priority,tier,approver_role,approver_user_id,allow_self_approval,conditions,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
        [
          nextId,
          data.name,
          data.active,
          data.priority,
          data.tier,
          data.approverRole,
          data.approverUserId,
          data.allowSelfApproval,
          json(data.conditions),
          actor.id,
        ],
      )
    ).rows[0];
    await audit(
      tx,
      actor.id,
      "APPROVAL_RULE_CREATE",
      "approval_rules",
      nextId,
      null,
      row,
    );
    return row;
  });
}

async function quoteFacts(db: DB, actor: Actor, q: any, settings: any) {
  const refreshed = await quotes.snapshot(
    db,
    actor,
    q.lines.map(quotes.savedLineInput),
    settings,
  );
  const catalog = refreshed.filter(
    (line: any) => line.source !== "CUSTOM" && line.productId,
  );
  const ids = [...new Set(catalog.map((line: any) => line.productId))];
  const products = ids.length
    ? (
        await db.query(
          `SELECT p.id,p.brand_id,p.category_id,pp.cost::text FROM products p JOIN product_pricing pp ON pp.product_id=p.id WHERE p.id=ANY($1::uuid[])`,
          [ids],
        )
      ).rows
    : [];
  const byId = new Map(products.map((p: any) => [p.id, p]));
  let maxDiscount = new Decimal(0),
    lowestMargin: Decimal | null = null;
  for (const line of catalog) {
    const discount = d(
      line.price?.effectiveDiscount ?? line.input?.discount ?? 0,
    );
    if (discount.gt(maxDiscount)) maxDiscount = discount;
    const cost = d(byId.get(line.productId)?.cost ?? 0),
      final = d(line.price?.finalExcl ?? 0);
    if (final.gt(0)) {
      const margin = final.sub(cost).div(final).mul(100);
      if (lowestMargin === null || margin.lt(lowestMargin))
        lowestMargin = margin;
    }
  }
  return {
    refreshed,
    maxDiscount,
    lowestMargin,
    total: d(q.totals?.total ?? 0),
    products,
    role: actor.role,
  };
}

const matches = (rule: any, facts: any) => {
  const c = rule.conditions ?? {};
  if (c.roleIds?.length && !c.roleIds.includes(facts.role)) return false;
  if (facts.maxDiscount.lt(d(c.minimumDiscount ?? 0))) return false;
  if (facts.total.lt(d(c.minimumTotal ?? 0))) return false;
  if (
    c.maximumMargin !== undefined &&
    (facts.lowestMargin === null || facts.lowestMargin.gt(d(c.maximumMargin)))
  )
    return false;
  if (
    c.brandIds?.length &&
    !facts.products.some((p: any) => c.brandIds.includes(p.brand_id))
  )
    return false;
  if (
    c.categoryIds?.length &&
    !facts.products.some((p: any) => c.categoryIds.includes(p.category_id))
  )
    return false;
  return true;
};

export async function submitForApproval(
  db: DB,
  actor: Actor,
  id: string,
  settings: any,
) {
  requirePermission(actor, "QUOTE_EDIT");
  return db.transaction(async (tx) => {
    await tx.query("SELECT id FROM quotations WHERE id=$1 FOR UPDATE", [id]);
    const q = await quotes.getQuote(tx, actor, id, true);
    assert(
      ["DRAFT", "REJECTED"].includes(q.status),
      409,
      "Only a draft or rejected quotation can be submitted",
    );
    assert(
      !quotes.quoteHasUnresolvedLines(q),
      409,
      "Resolve and price every quotation line before approval",
    );
    const facts = await quoteFacts(tx, actor, q, settings);
    const rules = (
      await tx.query(
        "SELECT * FROM approval_rules WHERE active ORDER BY tier,priority,id",
      )
    ).rows.filter((r: any) => matches(r, facts));
    await tx.query(
      "UPDATE quotation_approvals SET status='CANCELLED',decided_at=now() WHERE quotation_id=$1 AND status='PENDING'",
      [id],
    );
    for (const rule of rules)
      await tx.query(
        `INSERT INTO quotation_approvals(id,quotation_id,rule_id,tier,status,requested_by,pricing_snapshot)
      VALUES($1,$2,$3,$4,'PENDING',$5,$6)`,
        [
          randomUUID(),
          id,
          rule.id,
          rule.tier,
          actor.id,
          json({
            maxDiscount: facts.maxDiscount.toString(),
            lowestMargin: facts.lowestMargin?.toString() ?? null,
            total: facts.total.toString(),
            quoteVersion: q.version,
          }),
        ],
      );
    const status = rules.length ? "PENDING_APPROVAL" : "APPROVED";
    await tx.query(
      "UPDATE quotations SET status=$2,version=version+1,updated_at=now() WHERE id=$1",
      [id, status],
    );
    await audit(
      tx,
      actor.id,
      "QUOTATION_APPROVAL_SUBMIT",
      "quotations",
      id,
      null,
      { status, matchedRules: rules.map((r: any) => r.id) },
    );
    return { id, status, approvals: rules.length };
  });
}

export async function approvalQueue(db: DB, actor: Actor) {
  requirePermission(actor, "QUOTE_APPROVE");
  return (
    await db.query(
      `SELECT a.*,q.number,q.customer,q.totals,q.owner_id,u.name requester_name,r.name rule_name,r.approver_role,r.approver_user_id,r.allow_self_approval
    FROM quotation_approvals a JOIN quotations q ON q.id=a.quotation_id JOIN approval_rules r ON r.id=a.rule_id
    LEFT JOIN users u ON u.id=a.requested_by WHERE a.status='PENDING' AND q.status='PENDING_APPROVAL'
    AND (r.approver_user_id=$1 OR (r.approver_user_id IS NULL AND r.approver_role=$2)) ORDER BY a.created_at`,
      [actor.id, actor.role],
    )
  ).rows;
}

export async function decide(
  db: DB,
  actor: Actor,
  approvalId: string,
  decision: "APPROVED" | "REJECTED",
  comment: string,
) {
  requirePermission(actor, "QUOTE_APPROVE");
  return db.transaction(async (tx) => {
    const approval = await one(
      tx,
      `SELECT a.*,q.status quotation_status,r.approver_role,r.approver_user_id,r.allow_self_approval
      FROM quotation_approvals a JOIN quotations q ON q.id=a.quotation_id JOIN approval_rules r ON r.id=a.rule_id WHERE a.id=$1 FOR UPDATE OF a`,
      [approvalId],
    );
    assert(
      approval &&
        approval.status === "PENDING" &&
        approval.quotation_status === "PENDING_APPROVAL",
      409,
      "Approval is no longer pending",
    );
    assert(
      approval.approver_user_id === actor.id ||
        (!approval.approver_user_id && approval.approver_role === actor.role),
      403,
      "This approval is assigned to another approver",
    );
    assert(
      approval.allow_self_approval || approval.requested_by !== actor.id,
      403,
      "You cannot approve your own quotation",
    );
    const earlier = await one(
      tx,
      "SELECT id FROM quotation_approvals WHERE quotation_id=$1 AND tier<$2 AND status='PENDING' LIMIT 1",
      [approval.quotation_id, approval.tier],
    );
    assert(!earlier, 409, "An earlier approval tier must be completed first");
    await tx.query(
      "UPDATE quotation_approvals SET status=$2,decided_by=$3,comment=$4,decided_at=now() WHERE id=$1",
      [approvalId, decision, actor.id, comment.trim().slice(0, 1000)],
    );
    let quoteStatus = "PENDING_APPROVAL";
    if (decision === "REJECTED") {
      quoteStatus = "REJECTED";
      await tx.query(
        "UPDATE quotation_approvals SET status='CANCELLED',decided_at=now() WHERE quotation_id=$1 AND status='PENDING'",
        [approval.quotation_id],
      );
    } else if (
      !(await one(
        tx,
        "SELECT id FROM quotation_approvals WHERE quotation_id=$1 AND status='PENDING' LIMIT 1",
        [approval.quotation_id],
      ))
    )
      quoteStatus = "APPROVED";
    await tx.query(
      "UPDATE quotations SET status=$2,version=version+1,updated_at=now() WHERE id=$1",
      [approval.quotation_id, quoteStatus],
    );
    await audit(
      tx,
      actor.id,
      `QUOTATION_${decision}`,
      "quotations",
      approval.quotation_id,
      null,
      { approvalId, quoteStatus },
      comment,
    );
    return { quotationId: approval.quotation_id, status: quoteStatus };
  });
}

export async function createRevision(
  db: DB,
  actor: Actor,
  id: string,
  settings: any,
) {
  requirePermission(actor, "QUOTE_CREATE");
  const original = await quotes.getQuote(db, actor, id);
  assert(
    ["ISSUED", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED"].includes(
      original.status,
    ),
    409,
    "Only an issued quotation can be revised",
  );
  const rootId = original.parent_quotation_id ?? original.id;
  const latest = Number(
    (
      await one(
        db,
        "SELECT COALESCE(max(revision),1) n FROM quotations WHERE id=$1 OR parent_quotation_id=$1",
        [rootId],
      )
    )?.n ?? 1,
  );
  const draft = await quotes.saveDraft(
    db,
    actor,
    {
      customer: original.customer,
      lines: original.lines.map(quotes.duplicateLineInput),
      adjustment: { targetTotal: "" },
    },
    settings,
  );
  const revision = latest + 1,
    number = `${original.number.replace(/-R\d+$/i, "")}-R${revision}`;
  await db.query(
    "UPDATE quotations SET number=$2,parent_quotation_id=$3,revision=$4 WHERE id=$1",
    [draft.id, number, rootId, revision],
  );
  await audit(
    db,
    actor.id,
    "QUOTATION_REVISION_CREATE",
    "quotations",
    draft.id,
    null,
    { parentId: id, rootId, revision, number },
  );
  return quotes.publicQuote(await quotes.getQuote(db, actor, draft.id), actor);
}

export async function createCustomerLink(
  db: DB,
  actor: Actor,
  quotationId: string,
  days = 30,
) {
  requirePermission(actor, "QUOTE_ISSUE");
  const q = await quotes.getQuote(db, actor, quotationId);
  assert(
    ["ISSUED", "SENT", "VIEWED"].includes(q.status),
    409,
    "Issue the quotation before sharing a customer link",
  );
  const token = randomBytes(32).toString("base64url"),
    id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE quotation_access_tokens SET revoked_at=now() WHERE quotation_id=$1 AND revoked_at IS NULL AND responded_at IS NULL",
      [quotationId],
    );
    await tx.query(
      "INSERT INTO quotation_access_tokens(id,quotation_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,now()+($4||' days')::interval,$5)",
      [id, quotationId, hash(token), Math.max(1, Math.min(90, days)), actor.id],
    );
    await tx.query(
      "UPDATE quotations SET status='SENT',updated_at=now() WHERE id=$1 AND status='ISSUED'",
      [quotationId],
    );
    await audit(
      tx,
      actor.id,
      "QUOTATION_CUSTOMER_LINK_CREATE",
      "quotations",
      quotationId,
      null,
      { tokenId: id, days },
    );
  });
  return { token, expiresInDays: Math.max(1, Math.min(90, days)) };
}

export async function customerView(db: DB, token: string) {
  const key = hash(z.string().min(20).max(200).parse(token));
  return db.transaction(async (tx) => {
    const access = await one(
      tx,
      `SELECT a.*,q.number,q.customer,q.lines,q.totals,q.status,q.company_snapshot FROM quotation_access_tokens a JOIN quotations q ON q.id=a.quotation_id
      WHERE a.token_hash=$1 FOR UPDATE OF a`,
      [key],
    );
    assert(
      access && !access.revoked_at && new Date(access.expires_at) > new Date(),
      404,
      "Quotation link is invalid or expired",
    );
    assert(access.status !== "DELETED", 404, "Quotation is unavailable");
    await tx.query(
      "UPDATE quotation_access_tokens SET first_viewed_at=COALESCE(first_viewed_at,now()),last_viewed_at=now(),view_count=view_count+1 WHERE id=$1",
      [access.id],
    );
    if (["ISSUED", "SENT"].includes(access.status))
      await tx.query(
        "UPDATE quotations SET status='VIEWED',updated_at=now() WHERE id=$1",
        [access.quotation_id],
      );
    return {
      number: access.number,
      customer: access.customer,
      lines: access.lines.map((l:any)=>({source:l.source,productId:l.productId,partNumber:l.partNumber,description:l.description,unit:l.unit,price:l.price?{quantity:l.price.quantity,finalExcl:l.price.finalExcl,finalIncl:l.price.finalIncl,vatRate:l.price.vatRate,vatAmount:l.price.vatAmount,subtotal:l.price.subtotal,total:l.price.total}:null})),
      totals: access.totals,
      status: access.status,
      company: access.company_snapshot,
      expiresAt: access.expires_at,
      response: access.response,
    };
  });
}

export async function customerRespond(db: DB, token: string, raw: unknown) {
  const data = z
    .object({
      decision: z.enum(["ACCEPTED", "DECLINED"]),
      note: z.string().trim().max(1000).default(""),
    })
    .parse(raw);
  const key = hash(z.string().min(20).max(200).parse(token));
  return db.transaction(async (tx) => {
    const access = await one(
      tx,
      `SELECT a.*,q.status FROM quotation_access_tokens a JOIN quotations q ON q.id=a.quotation_id WHERE a.token_hash=$1 FOR UPDATE OF a,q`,
      [key],
    );
    assert(
      access && !access.revoked_at && new Date(access.expires_at) > new Date(),
      404,
      "Quotation link is invalid or expired",
    );
    assert(!access.responded_at, 409, "A response was already recorded");
    assert(
      ["ISSUED", "SENT", "VIEWED"].includes(access.status),
      409,
      "Quotation can no longer be accepted or declined",
    );
    await tx.query(
      "UPDATE quotation_access_tokens SET response=$2,response_note=$3,responded_at=now() WHERE id=$1",
      [access.id, data.decision, data.note],
    );
    await tx.query(
      "UPDATE quotations SET status=$2,accepted_at=CASE WHEN $2='ACCEPTED' THEN now() ELSE accepted_at END,updated_at=now(),version=version+1 WHERE id=$1",
      [access.quotation_id, data.decision],
    );
    await tx.query('UPDATE commerce_requests SET status=$2,version=version+1 WHERE quotation_id=$1',[access.quotation_id,data.decision]);
    await audit(
      tx,
      null,
      `CUSTOMER_QUOTATION_${data.decision}`,
      "quotations",
      access.quotation_id,
      null,
      { tokenId: access.id },
      data.note,
    );
    return { ok: true, status: data.decision };
  });
}
