import { randomUUID } from "node:crypto";
import { z } from "zod";
import Decimal from "decimal.js";
import { type DB, one } from "../core/db";
import { json, audit } from "../core/audit";
import { assert } from "../core/errors";
import { type Actor, requirePermission, lockActor } from "../auth/service";
import {
  productSelect,
  toInput,
  saveProduct,
  getProduct,
} from "../products/service";
import {
  productInput,
  validateProduct,
  canonicalProduct,
  sellingLevels,
  levelPrice,
  normalizePart,
  type ProductInput,
} from "../pricing/engine";
const level = z.enum(["DEFAULT", "ALL", "WHOLESALE", "RETAIL", "END_CUSTOMER"]);
export const ruleSchema = z
  .object({
    match: z.enum(["ALL", "ANY"]).default("ALL"),
    conditions: z
      .array(
        z
          .object({
            field: z.enum([
              "partNumber",
              "description",
              "brand",
              "category",
              "method",
              "sellingLevel",
              "state",
              "price",
              "changePercent",
            ]),
            operator: z.enum(["EQ", "CONTAINS", "PREFIX", "GTE", "LTE"]),
            value: z.string().max(200),
            level: level.default("DEFAULT"),
          })
          .strict(),
      )
      .max(20),
    actions: z
      .array(
        z
          .object({
            field: z.enum([
              "brand",
              "category",
              "unit",
              "defaultLevel",
              "vat",
              "minimum",
              "minimumEnabled",
              "cost",
              "method",
              "markup",
              "listPrice",
              "baseDiscount",
              "fixedPrice",
              "active",
              "decision",
              "verified",
            ]),
            operation: z
              .enum(["SET", "INCREASE_PERCENT", "DECREASE_PERCENT"])
              .default("SET"),
            value: z.string().max(200),
            level: level.default("DEFAULT"),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
const previewInput = z
  .object({
    scope: z.enum(["CATALOG", "IMPORT"]),
    importId: z.string().uuid().optional(),
    ruleId: z.string().uuid().optional(),
    definition: ruleSchema,
    selectedIds: z.array(z.string().uuid()).max(10000).optional(),
    acknowledgeVerification: z.boolean().default(false),
  })
  .strict();
const decisionValue = z.enum(["KEEP", "UPDATE", "SKIP", "REVIEW"]);
const verifiedValue = z.enum(["true", "false"]);

function permitted(actor: Actor, scope: string) {
  requirePermission(actor, "COST_VIEW");
  requirePermission(
    actor,
    scope === "IMPORT" ? "IMPORT_CONFIRM" : "PRODUCT_EDIT",
  );
}
function comparable(input: ProductInput) {
  const normalize = (value: any, key = ""): any => {
    if (
      [
        "cost",
        "markup",
        "listPrice",
        "baseDiscount",
        "fixedPrice",
        "minimum",
        "vat",
      ].includes(key)
    )
      return new Decimal(value).toString();
    if (Array.isArray(value)) return value.map((v) => normalize(v));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, normalize(value[k], k)]),
      );
    return value;
  };
  return json(normalize(canonicalProduct(productInput.parse(input))));
}
export function levelDifferences(
  before: ProductInput | undefined,
  after: ProductInput,
) {
  return sellingLevels(after)
    .filter((l) => l.active)
    .map((l) => {
      const previous =
          before &&
          sellingLevels(before).find((b) => b.code === l.code && b.active),
        old = previous ? levelPrice(before!, previous) : null,
        next = levelPrice(after, l);
      return {
        code: l.code,
        before: old?.toFixed(2) ?? null,
        after: next.toFixed(2),
        changePercent:
          old && !old.isZero()
            ? next.sub(old).div(old).mul(100).toFixed(2)
            : null,
      };
    });
}
export function matches(
  def: z.infer<typeof ruleSchema>,
  p: any,
  states: string[],
  before?: ProductInput,
) {
  const values = def.conditions.map((c) => {
    let options: any[] = [];
    if (c.field === "state") options = states;
    else if (c.field === "method" || c.field === "sellingLevel")
      options = (p.levels ?? [])
        .filter(
          (l: any) =>
            l.active &&
            (c.level === "ALL" ||
              l.code === (c.level === "DEFAULT" ? p.defaultLevel : c.level)),
        )
        .map((l: any) => (c.field === "method" ? l.method : l.code));
    else if (c.field === "price" || c.field === "changePercent") {
      try {
        options = levelDifferences(before, p)
          .filter(
            (l) =>
              c.level === "ALL" ||
              l.code === (c.level === "DEFAULT" ? p.defaultLevel : c.level),
          )
          .map((l) => (c.field === "price" ? l.after : l.changePercent))
          .filter((v) => v !== null);
      } catch {
        return false;
      }
    } else options = [p[c.field] ?? ""];
    return options.some((value) => {
      const a = String(value).normalize("NFKC").toUpperCase(),
        b = c.value.normalize("NFKC").toUpperCase();
      if (c.operator === "EQ") return a === b;
      if (c.operator === "PREFIX") return a.startsWith(b);
      if (c.operator === "CONTAINS") return a.includes(b);
      try {
        return c.operator === "GTE"
          ? new Decimal(a).gte(b)
          : new Decimal(a).lte(b);
      } catch {
        return false;
      }
    });
  });
  return (
    !values.length ||
    (def.match === "ALL" ? values.every(Boolean) : values.some(Boolean))
  );
}
export function transform(
  p: ProductInput,
  actions: z.infer<typeof ruleSchema>["actions"],
) {
  const next: any = structuredClone(p);
  next.levels = sellingLevels(p).map((l) => ({ ...l }));
  next.defaultLevel = p.defaultLevel ?? "END_CUSTOMER";
  for (const action of actions) {
    if (["decision", "verified"].includes(action.field)) continue;
    const tierField = [
      "method",
      "markup",
      "listPrice",
      "baseDiscount",
      "fixedPrice",
      "active",
    ].includes(action.field);
    const targets = tierField
      ? next.levels.filter(
          (l: any) =>
            action.level === "ALL" ||
            l.code ===
              (action.level === "DEFAULT" ? next.defaultLevel : action.level),
        )
      : [next];
    assert(
      targets.length,
      400,
      "Selected level is unavailable on " + p.partNumber,
    );
    for (const target of targets) {
      let value: any = action.value;
      if (["minimumEnabled", "active"].includes(action.field)) {
        assert(["true", "false"].includes(value), 400, "Use true or false");
        value = value === "true";
      } else if (action.operation !== "SET") {
        assert(
          [
            "cost",
            "vat",
            "minimum",
            "markup",
            "listPrice",
            "baseDiscount",
            "fixedPrice",
          ].includes(action.field),
          400,
          "Percentage operation requires a numeric field",
        );
        const percent = new Decimal(action.value);
        assert(
          percent.gte(0) &&
            (action.operation !== "DECREASE_PERCENT" || percent.lte(100)),
          400,
          "Invalid percentage",
        );
        value = new Decimal(target[action.field])
          .mul(
            new Decimal(1).add(
              percent
                .div(100)
                .mul(action.operation === "DECREASE_PERCENT" ? -1 : 1),
            ),
          )
          .toDecimalPlaces(action.field === "minimum" ? 2 : 6)
          .toString();
      }
      target[action.field] = value;
    }
  }
  return canonicalProduct(validateProduct(productInput.parse(next)));
}
export async function preview(db: DB, actor: Actor, input: unknown) {
  const data = previewInput.parse(input);
  permitted(actor, data.scope);
  if (
    data.definition.actions.some(
      (a) => a.field === "verified" && a.value === "true",
    )
  )
    assert(
      data.acknowledgeVerification,
      400,
      "Confirm that selected source values have been checked",
    );
  if (data.ruleId)
    assert(
      await one(
        db,
        "SELECT id FROM bulk_rules WHERE id=$1 AND active AND NOT deleted",
        [data.ruleId],
      ),
      404,
      "Rule is unavailable",
    );
  return db.transaction(async (tx) => {
    const settingsVersion = (await one(
      tx,
      "SELECT version FROM settings WHERE id=1",
    ))!.version;
    const selectedIds = data.selectedIds ? new Set(data.selectedIds) : null;
    let rows: any[], job: any;
    if (data.scope === "IMPORT") {
      assert(data.importId, 400, "Choose an import");
      job = await one(tx, "SELECT * FROM import_jobs WHERE id=$1 FOR SHARE", [
        data.importId,
      ]);
      assert(
        job?.status === "AWAITING_REVIEW",
        409,
        "Import is not awaiting review",
      );
      rows = (
        await tx.query(
          "SELECT * FROM import_rows WHERE job_id=$1 ORDER BY row_number",
          [data.importId],
        )
      ).rows;
    } else rows = (await tx.query(productSelect + " ORDER BY p.id")).rows;
    const currentProducts = new Map<string, ProductInput>();
    if (job) {
      const duplicateIds = [
        ...new Set(
          rows
            .map((row) => row.duplicate_id)
            .filter((value): value is string => typeof value === "string"),
        ),
      ];
      if (duplicateIds.length) {
        const existing = await tx.query(
          productSelect + " WHERE p.id = ANY($1::uuid[])",
          [duplicateIds],
        );
        for (const product of existing.rows)
          currentProducts.set(product.id, toInput(product));
      }
    }
    const duplicateCounts = new Map<string, number>();
    if (job)
      for (const row of rows) {
        const part = normalizePart(String(row.proposed?.partNumber ?? ""));
        duplicateCounts.set(part, (duplicateCounts.get(part) ?? 0) + 1);
      }
    const items: any[] = [];
    const actionsChangeValues = data.definition.actions.some(
      (a) => !["decision", "verified"].includes(a.field),
    );
    for (const row of rows) {
      if (selectedIds && !selectedIds.has(row.id)) continue;
      const before = job
          ? row.duplicate_id
            ? currentProducts.get(row.duplicate_id)
            : undefined
          : toInput(row),
        p = job ? row.proposed : before;
      if (!p) continue;
      let changed = true;
      try {
        changed = !before || comparable(before) !== comparable(p);
      } catch {}
      const states = job
        ? [
            before ? "EXISTING" : "UNKNOWN",
            row.errors.length ? "ERROR" : "VALID",
            changed ? "CHANGED" : "UNCHANGED",
            ...((duplicateCounts.get(normalizePart(String(p.partNumber))) ??
              0) > 1
              ? ["DUPLICATE"]
              : []),
          ]
        : ["EXISTING", row.active ? "ACTIVE" : "ARCHIVED", "VALID"];
      if (!matches(data.definition, p, states, before)) continue;
      let after: any = p,
        error = "";
      try {
        after = transform(p, data.definition.actions);
      } catch (e) {
        error = (e as Error).message;
      }
      let decision = row.decision,
        verified = row.verified;
      if (job && actionsChangeValues) verified = false;
      for (const a of data.definition.actions) {
        if (a.field === "decision") decision = decisionValue.parse(a.value);
        if (a.field === "verified")
          verified = verifiedValue.parse(a.value) === "true";
      }
      if (
        job &&
        row.confidence === "LOW" &&
        verified &&
        (!row.verified || actionsChangeValues)
      )
        error =
          "Low-confidence extraction requires individual source verification";
      if (job && !before && verified && (!row.verified || actionsChangeValues))
        error = "New items require individual source verification";
      if (job && job.mode === "UPDATE_ONLY" && !before && decision === "UPDATE")
        error = "Unknown item is blocked in Update Existing Only mode";
      const skipped =
        job &&
        ["KEEP", "SKIP", "REVIEW"].includes(decision) &&
        !actionsChangeValues;
      if (skipped) {
        error = "";
        verified = false;
      }
      let differences: any[] = [];
      try {
        differences = levelDifferences(before, after);
      } catch {}
      items.push({
        id: row.id,
        productId: job ? row.duplicate_id : row.id,
        version: job ? row.expected_version : row.version,
        partNumber: p.partNumber,
        before: before ?? null,
        after,
        states,
        decision,
        verified,
        error,
        differences,
        retainedErrors: skipped ? row.errors : [],
      });
      assert(
        items.length <= 10000,
        400,
        "More than 10,000 matches. Narrow the rule and preview again",
      );
    }
    const id = randomUUID();
    await tx.query(
      "INSERT INTO bulk_previews(id,actor_id,scope,import_id,rule_id,definition,items,import_version,settings_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        id,
        actor.id,
        data.scope,
        data.importId ?? null,
        data.ruleId ?? null,
        json(data.definition),
        json(items),
        job?.version ?? null,
        settingsVersion,
      ],
    );
    return {
      id,
      matched: items.length,
      errors: items.filter((i) => i.error).length,
      items: items.slice(0, 50),
      page: 0,
    };
  });
}
export async function getPreview(db: DB, actor: Actor, id: string, page = 0) {
  const p = await one(
    db,
    "SELECT * FROM bulk_previews WHERE id=$1 AND actor_id=$2",
    [id, actor.id],
  );
  assert(p, 404, "Preview not found");
  permitted(actor, p.scope);
  return {
    id,
    matched: p.items.length,
    errors: p.items.filter((i: any) => i.error).length,
    items: p.items.slice(page * 50, page * 50 + 50),
    page,
  };
}
export async function apply(db: DB, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const p = await one(
      tx,
      "SELECT * FROM bulk_previews WHERE id=$1 AND actor_id=$2 FOR UPDATE",
      [id, actor.id],
    );
    assert(p, 404, "Preview not found");
    permitted(actor, p.scope);
    if (p.result) return p.result;
    assert(
      new Date(p.expires_at) > new Date(),
      409,
      "Preview expired. Preview again",
    );
    assert(p.items.length, 400, "No matched records");
    assert(
      !p.items.some((i: any) => i.error),
      400,
      "Resolve preview errors first",
    );
    if (p.import_id) {
      const job = await one(
        tx,
        "SELECT status,version FROM import_jobs WHERE id=$1 FOR UPDATE",
        [p.import_id],
      );
      assert(
        job?.status === "AWAITING_REVIEW" && job.version === p.import_version,
        409,
        "Import changed. Preview again",
      );
    }
    const settings = await one(
      tx,
      "SELECT version FROM settings WHERE id=1 FOR UPDATE",
    );
    await lockActor(tx, actor);
    assert(
      settings?.version === p.settings_version,
      409,
      "Settings changed. Preview again",
    );
    const sortedItems = [...p.items].sort((a: any, b: any) =>
      String(a.productId).localeCompare(String(b.productId)),
    );
    if (p.import_id) {
      const productIds = [
        ...new Set(
          sortedItems
            .map((item: any) => item.productId)
            .filter((value: unknown): value is string => typeof value === "string"),
        ),
      ];
      if (productIds.length) {
        const versions = await tx.query(
          "SELECT id, version FROM products WHERE id = ANY($1::uuid[]) FOR UPDATE",
          [productIds],
        );
        const productVersions = new Map(
          versions.rows.map((row) => [row.id, row.version]),
        );
        for (const item of sortedItems)
          if (item.productId)
            assert(
              productVersions.get(item.productId) === item.version,
              409,
              "Product changed. Preview again",
            );
      }
      const metadata = json({ previewId: id, ruleId: p.rule_id, actor: actor.id });
      const chunkSize = 250;
      for (let index = 0; index < sortedItems.length; index += chunkSize) {
        const chunk = sortedItems.slice(index, index + chunkSize);
        await tx.query(
          `UPDATE import_rows AS r
           SET proposed = v.proposed,
               decision = v.decision,
               verified = v.verified,
               errors = v.errors,
               rule_metadata = $3::jsonb
           FROM jsonb_to_recordset($1::jsonb) AS v(
             id uuid,
             proposed jsonb,
             decision text,
             verified boolean,
             errors jsonb
           )
           WHERE r.id = v.id AND r.job_id = $2`,
          [
            json(
              chunk.map((item: any) => ({
                id: item.id,
                proposed: item.after,
                decision: item.decision,
                verified: item.verified,
                errors: item.retainedErrors ?? [],
              })),
            ),
            p.import_id,
            metadata,
          ],
        );
      }
    } else {
      for (const item of sortedItems) {
        if (item.productId)
          assert(
            (await getProduct(tx, item.productId, true)).version === item.version,
            409,
            "Product changed. Preview again",
          );
        await saveProduct(
          tx,
          actor,
          item.after,
          item.productId,
          item.version,
          "RULE",
        );
      }
    }
    if (p.import_id)
      await tx.query("UPDATE import_jobs SET version=version+1 WHERE id=$1", [
        p.import_id,
      ]);
    const result = { ok: true, matched: p.items.length, staged: !!p.import_id };
    await tx.query(
      "INSERT INTO bulk_executions(id,preview_id,rule_id,actor_id,scope,matched,definition) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        randomUUID(),
        id,
        p.rule_id,
        actor.id,
        p.scope,
        p.items.length,
        json(p.definition),
      ],
    );
    await tx.query("UPDATE bulk_previews SET result=$2 WHERE id=$1", [
      id,
      json(result),
    ]);
    await audit(
      tx,
      actor.id,
      "BULK_RULE_APPLY",
      "bulk_previews",
      id,
      null,
      result,
    );
    return result;
  });
}
export async function saveRule(
  db: DB,
  actor: Actor,
  input: unknown,
  id?: string,
) {
  permitted(actor, "CATALOG");
  const data = z
    .object({
      name: z.string().trim().min(1).max(100),
      definition: ruleSchema,
      active: z.boolean().default(true),
      version: z.number().int().optional(),
    })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    const uid = id ?? randomUUID();
    if (id) {
      const old = await one(
        tx,
        "SELECT version FROM bulk_rules WHERE id=$1 AND NOT deleted FOR UPDATE",
        [id],
      );
      assert(old && old.version === data.version, 409, "Rule changed. Reload");
    }
    await tx.query(
      "INSERT INTO bulk_rules(id,name,definition,active,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=$2,definition=$3,active=$4,version=bulk_rules.version+1,updated_at=now()",
      [uid, data.name, json(data.definition), data.active, actor.id],
    );
    await audit(tx, actor.id, "BULK_RULE_SAVE", "bulk_rules", uid, null, data);
    return { id: uid };
  });
}
