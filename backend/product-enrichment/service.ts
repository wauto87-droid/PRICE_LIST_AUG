import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { AppError, assert } from "../core/errors";
import { audit, json } from "../core/audit";
import { type Actor, requirePermission } from "../auth/service";
import { productInput } from "../pricing/engine";
import { getProduct, toInput } from "../products/service";

const DEFAULT_MODEL = "gpt-5.4-nano";
const detailsSchema = productInput.shape.details;
const suggestionSchema = z
  .object({
    status: z.enum(["FOUND", "UNCERTAIN", "NOT_FOUND"]),
    reason: z.string().trim().max(500).default(""),
    description: z.string().trim().max(1000).default(""),
    manufacturer: z.string().trim().max(200).default(""),
    productName: z.string().trim().max(300).default(""),
    productType: z.string().trim().max(200).default(""),
    series: z.string().trim().max(200).default(""),
    specifications: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(120),
            value: z.string().trim().min(1).max(300),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    applications: z
      .array(z.string().trim().min(1).max(300))
      .max(20)
      .default([]),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  })
  .strict();
const filtersSchema = z
  .object({
    query: z.string().trim().max(100).default(""),
    minimumFilter: z.enum(["ALL", "PROTECTED", "UNPROTECTED"]).default("ALL"),
    statusFilter: z.enum(["ALL", "ACTIVE", "ARCHIVED"]).default("ALL"),
    methodFilter: z
      .enum(["ALL", "COST_MARKUP", "LIST_DISCOUNT", "FIXED"])
      .default("ALL"),
    contentFilter: z.enum(["ALL", "MISSING", "COMPLETE"]).default("ALL"),
  })
  .strict();

const permission = (actor: Actor) =>
  requirePermission(actor, "AI_PRODUCT_ENRICH");
function encryptionKey() {
  const raw = process.env.AI_SECRET_ENCRYPTION_KEY ?? "";
  assert(
    /^[a-f0-9]{64}$/i.test(raw),
    503,
    "AI secret encryption is not configured on this server",
  );
  return Buffer.from(raw, "hex");
}
async function saveSecret(db: DB, actor: Actor, value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  await db.query(
    `INSERT INTO app_secrets(key,ciphertext,iv,auth_tag,updated_by) VALUES('OPENAI_API_KEY',$1,$2,$3,$4)
    ON CONFLICT(key) DO UPDATE SET ciphertext=$1,iv=$2,auth_tag=$3,updated_by=$4,updated_at=now()`,
    [ciphertext, iv, cipher.getAuthTag(), actor.id],
  );
}
async function secret(db: DB) {
  const row = await one(
    db,
    "SELECT ciphertext,iv,auth_tag FROM app_secrets WHERE key='OPENAI_API_KEY'",
  );
  assert(row, 409, "Configure the OpenAI API key before starting AI research");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), row.iv);
    decipher.setAuthTag(row.auth_tag);
    return Buffer.concat([
      decipher.update(row.ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError(
      503,
      "The saved AI key cannot be decrypted with this server configuration",
    );
  }
}
async function model(db: DB) {
  const row = await one(
    db,
    "SELECT data->>'aiProductModel' model FROM settings WHERE id=1",
  );
  return row?.model || process.env.OPENAI_PRODUCT_MODEL || DEFAULT_MODEL;
}
export async function configuration(db: DB, actor: Actor) {
  permission(actor);
  return {
    configured: Boolean(
      await one(db, "SELECT 1 FROM app_secrets WHERE key='OPENAI_API_KEY'"),
    ),
    encryptionConfigured: /^[a-f0-9]{64}$/i.test(
      process.env.AI_SECRET_ENCRYPTION_KEY ?? "",
    ),
    model: await model(db),
    maskedKey: (await one(
      db,
      "SELECT 1 FROM app_secrets WHERE key='OPENAI_API_KEY'",
    ))
      ? "••••••••"
      : "",
  };
}
export async function saveConfiguration(db: DB, actor: Actor, raw: unknown) {
  permission(actor);
  const input = z
    .object({
      apiKey: z.string().trim().min(20).max(500).optional(),
      model: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9._-]{1,100}$/)
        .default(DEFAULT_MODEL),
    })
    .strict()
    .parse(raw);
  await db.transaction(async (tx) => {
    if (input.apiKey) await saveSecret(tx, actor, input.apiKey);
    await tx.query(
      "UPDATE settings SET data=jsonb_set(data,'{aiProductModel}',to_jsonb($1::text),true),version=version+1 WHERE id=1",
      [input.model],
    );
    await audit(
      tx,
      actor.id,
      "AI_CONFIGURATION_CHANGE",
      "settings",
      "OPENAI",
      null,
      { keyChanged: Boolean(input.apiKey), model: input.model },
    );
  });
  return configuration(db, actor);
}
export async function testConfiguration(db: DB, actor: Actor) {
  permission(actor);
  const key = await secret(db),
    modelName = await model(db),
    controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      `https://api.openai.com/v1/models/${encodeURIComponent(modelName)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      },
    );
    assert(
      response.ok,
      409,
      `OpenAI connection test failed (${response.status})`,
    );
    await audit(
      db,
      actor.id,
      "AI_CONFIGURATION_TEST",
      "settings",
      "OPENAI",
      null,
      { ok: true, model: modelName },
    );
    return { ok: true, model: modelName };
  } finally {
    clearTimeout(timer);
  }
}

function filteredWhere(filters: z.infer<typeof filtersSchema>) {
  const args: any[] = [],
    bind = (v: any) => {
      args.push(v);
      return `$${args.length}`;
    };
  const conditions = ["true"];
  if (filters.query) {
    const q = bind(`%${filters.query.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(
      `(p.part_number ILIKE ${q} ESCAPE '\\' OR p.description ILIKE ${q} ESCAPE '\\')`,
    );
  }
  if (filters.statusFilter === "ACTIVE") conditions.push("p.active");
  else if (filters.statusFilter === "ARCHIVED") conditions.push("NOT p.active");
  if (filters.minimumFilter === "PROTECTED")
    conditions.push("pp.minimum_enabled AND pp.minimum>0");
  else if (filters.minimumFilter === "UNPROTECTED")
    conditions.push("NOT(pp.minimum_enabled AND pp.minimum>0)");
  if (filters.methodFilter !== "ALL")
    conditions.push(`pp.method=${bind(filters.methodFilter)}`);
  const missing = `(btrim(p.description)='' OR upper(regexp_replace(btrim(p.description),'\\s+',' ','g'))=upper(regexp_replace(btrim(p.part_number),'\\s+',' ','g')) OR upper(regexp_replace(btrim(p.description),'[.\\s]+','','g')) IN ('N/A','NA','UNKNOWN','NODESCRIPTION'))`;
  if (filters.contentFilter === "MISSING") conditions.push(missing);
  else if (filters.contentFilter === "COMPLETE")
    conditions.push(`NOT ${missing}`);
  return { where: conditions.join(" AND "), args };
}
export async function randomSelection(db: DB, actor: Actor, raw: unknown) {
  permission(actor);
  const input = z
      .object({
        filters: filtersSchema,
        count: z.coerce.number().int().min(1).max(100),
      })
      .strict()
      .parse(raw),
    f = filteredWhere(input.filters);
  return (
    await db.query(
      `SELECT p.id,p.version FROM products p JOIN product_pricing pp ON pp.product_id=p.id WHERE ${f.where} ORDER BY random() LIMIT ${input.count}`,
      f.args,
    )
  ).rows;
}
export async function queue(db: DB, actor: Actor, raw: unknown) {
  permission(actor);
  const input = z
    .object({
      items: z
        .array(
          z
            .object({
              id: z.string().uuid(),
              version: z.coerce.number().int().positive(),
            })
            .strict(),
        )
        .min(1)
        .max(100),
      filters: filtersSchema.default({
        query: "",
        minimumFilter: "ALL",
        statusFilter: "ALL",
        methodFilter: "ALL",
        contentFilter: "ALL",
      }),
    })
    .strict()
    .parse(raw);
  await secret(db);
  const ids = [...new Set(input.items.map((x) => x.id))];
  assert(ids.length === input.items.length, 400, "Duplicate products selected");
  const jobId = randomUUID(),
    jobModel = await model(db);
  await db.transaction(async (tx) => {
    const rows = (
      await tx.query(
        "SELECT id,version,part_number,description,details FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
        [ids],
      )
    ).rows;
    assert(
      rows.length === ids.length,
      409,
      "One or more selected products no longer exist",
    );
    for (const selected of input.items) {
      const p = rows.find((x: any) => x.id === selected.id);
      assert(p, 409, "Selected product no longer exists");
      assert(
        p.version === selected.version,
        409,
        `Product ${p.part_number} changed. Reload before AI research`,
      );
    }
    await tx.query(
      "INSERT INTO product_enrichment_jobs(id,owner_id,status,filters,progress,model) VALUES($1,$2,'PENDING',$3,$4,$5)",
      [
        jobId,
        actor.id,
        json(input.filters),
        json({
          phase: "QUEUED",
          processedRows: 0,
          totalRows: rows.length,
          percentage: 0,
          remainingSeconds: null,
        }),
        jobModel,
      ],
    );
    for (const p of rows)
      await tx.query(
        "INSERT INTO product_enrichment_rows(id,job_id,product_id,expected_version,source_part,original_description,original_details,status) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING')",
        [
          randomUUID(),
          jobId,
          p.id,
          p.version,
          p.part_number,
          p.description,
          json(p.details ?? {}),
        ],
      );
    await tx.query(
      "INSERT INTO jobs(id,kind,payload) VALUES($1,'PRODUCT_AI_ENRICH',$2)",
      [randomUUID(), json({ enrichmentJobId: jobId })],
    );
    await audit(
      tx,
      actor.id,
      "PRODUCT_AI_ENRICH_QUEUE",
      "product_enrichment_jobs",
      jobId,
      null,
      { products: rows.length, model: jobModel },
    );
  });
  return { id: jobId, status: "PENDING" };
}
export async function list(db: DB, actor: Actor) {
  permission(actor);
  return (
    await db.query(
      "SELECT j.*,u.name owner_name FROM product_enrichment_jobs j JOIN users u ON u.id=j.owner_id WHERE j.status<>'DELETED' ORDER BY j.created_at DESC LIMIT 30",
    )
  ).rows;
}
export async function get(db: DB, actor: Actor, id: string) {
  permission(actor);
  const job = await one(
    db,
    "SELECT * FROM product_enrichment_jobs WHERE id=$1 AND status<>'DELETED'",
    [id],
  );
  assert(job, 404, "AI research job not found");
  const rows = (
    await db.query(
      "SELECT r.*,p.part_number current_part,p.description current_description,p.version current_version FROM product_enrichment_rows r JOIN products p ON p.id=r.product_id WHERE r.job_id=$1 ORDER BY r.created_at,r.id",
      [id],
    )
  ).rows;
  return { ...job, rows };
}
export async function editSuggestion(
  db: DB,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  permission(actor);
  const input = z
    .object({
      suggestion: suggestionSchema
        .omit({ status: true, reason: true, confidence: true })
        .extend({
          confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
        }),
    })
    .strict()
    .parse(raw);
  const row = await one(
    db,
    "UPDATE product_enrichment_rows SET suggestion=$2,confidence=$3,updated_at=now() WHERE id=$1 AND status IN ('FOUND','UNCERTAIN') RETURNING job_id",
    [id, json(input.suggestion), input.suggestion.confidence],
  );
  assert(row, 409, "This AI suggestion cannot be edited");
  await audit(
    db,
    actor.id,
    "PRODUCT_AI_SUGGESTION_EDIT",
    "product_enrichment_rows",
    id,
  );
  return get(db, actor, row.job_id);
}
export async function confirm(
  db: DB,
  actor: Actor,
  jobId: string,
  raw: unknown,
) {
  permission(actor);
  const input = z
    .object({ rowIds: z.array(z.string().uuid()).min(1).max(100) })
    .strict()
    .parse(raw);
  return db.transaction(async (tx) => {
    const rows = (
      await tx.query(
        "SELECT r.* FROM product_enrichment_rows r WHERE r.job_id=$1 AND r.id=ANY($2::uuid[]) ORDER BY r.id FOR UPDATE",
        [jobId, input.rowIds],
      )
    ).rows;
    assert(
      rows.length === new Set(input.rowIds).size,
      404,
      "One or more suggestions were not found",
    );
    const confirmed = [];
    for (const row of rows) {
      assert(
        ["FOUND", "UNCERTAIN"].includes(row.status),
        409,
        `Suggestion for ${row.source_part} is not ready`,
      );
      const suggestion = suggestionSchema
        .partial({ status: true, reason: true })
        .parse(row.suggestion);
      assert(
        suggestion.description,
        400,
        `Description is required for ${row.source_part}`,
      );
      const product = await getProduct(tx, row.product_id, true);
      assert(
        product.version === row.expected_version,
        409,
        `Product ${product.part_number} changed. Research it again before confirming`,
      );
      const details =
        detailsSchema.parse({
          manufacturer: suggestion.manufacturer,
          productName: suggestion.productName,
          productType: suggestion.productType,
          series: suggestion.series,
          specifications: suggestion.specifications,
          applications: suggestion.applications,
        }) ?? {};
      await tx.query(
        "UPDATE products SET description=$2,details=$3,version=version+1,updated_by=$4,updated_at=now() WHERE id=$1",
        [product.id, suggestion.description, json(details), actor.id],
      );
      await tx.query(
        "UPDATE product_enrichment_rows SET status='CONFIRMED',reviewed_by=$2,confirmed_at=now(),updated_at=now() WHERE id=$1",
        [row.id, actor.id],
      );
      await audit(
        tx,
        actor.id,
        "PRODUCT_AI_ENRICH_CONFIRM",
        "products",
        product.id,
        { description: product.description, details: product.details },
        { description: suggestion.description, details, sources: row.sources },
      );
      confirmed.push(row.id);
    }
    return { confirmed };
  });
}
export async function remove(db: DB, actor: Actor, id: string) {
  permission(actor);
  const row = await one(
    db,
    "UPDATE product_enrichment_jobs SET status='DELETED',updated_at=now() WHERE id=$1 AND status NOT IN ('PENDING','RUNNING') RETURNING id",
    [id],
  );
  assert(row, 409, "Wait for AI research to finish before deleting it");
  await audit(
    db,
    actor.id,
    "PRODUCT_AI_ENRICH_DELETE",
    "product_enrichment_jobs",
    id,
  );
  return { deleted: true };
}

async function research(apiKey: string, modelName: string, p: any) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
        store: false,
        max_output_tokens: 1400,
        max_tool_calls: 3,
        tools: [{ type: "web_search" }],
        include: ["web_search_call.action.sources"],
        instructions:
          "Research electrical products conservatively. Match the exact manufacturer part number. Never guess or merge a similar code. Return NOT_FOUND when evidence is absent and UNCERTAIN when sources conflict. Write concise factual English.",
        input: `Exact part number: ${p.part_number}\nKnown brand: ${p.brand ?? ""}\nKnown category: ${p.category ?? ""}\nCurrent description: ${p.description ?? ""}`,
        text: {
          format: {
            type: "json_schema",
            name: "product_enrichment",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: [
                "status",
                "reason",
                "description",
                "manufacturer",
                "productName",
                "productType",
                "series",
                "specifications",
                "applications",
                "confidence",
              ],
              properties: {
                status: {
                  type: "string",
                  enum: ["FOUND", "UNCERTAIN", "NOT_FOUND"],
                },
                reason: { type: "string" },
                description: { type: "string" },
                manufacturer: { type: "string" },
                productName: { type: "string" },
                productType: { type: "string" },
                series: { type: "string" },
                specifications: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["label", "value"],
                    properties: {
                      label: { type: "string" },
                      value: { type: "string" },
                    },
                  },
                },
                applications: { type: "array", items: { type: "string" } },
                confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
              },
            },
          },
        },
      }),
    });
    if (!response.ok) {
      const error = new Error(
        `OpenAI request failed (${response.status})`,
      ) as Error & {
        retryable?: boolean;
      };
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    const raw: any = await response.json();
    const parsed = suggestionSchema.parse(JSON.parse(raw.output_text));
    const sources: any[] = [];
    for (const item of raw.output ?? [])
      for (const source of item.action?.sources ?? [])
        if (source.url && !sources.some((x) => x.url === source.url)) {
          const url = String(source.url).slice(0, 2000);
          try {
            if (!["http:", "https:"].includes(new URL(url).protocol)) continue;
            sources.push({
              title: String(source.title ?? "").slice(0, 300),
              url,
            });
          } catch {
            // Ignore malformed model-provided source URLs.
          }
        }
    return { parsed, sources };
  } finally {
    clearTimeout(timer);
  }
}
async function researchWithRetry(apiKey: string, modelName: string, p: any) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await research(apiKey, modelName, p);
    } catch (error) {
      const retryable =
        (error as Error & { retryable?: boolean }).retryable ||
        (error as Error).name === "AbortError";
      if (!retryable || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error("AI research failed");
}
export async function processJob(db: DB, id: string) {
  const job = await one(
    db,
    "SELECT * FROM product_enrichment_jobs WHERE id=$1",
    [id],
  );
  if (!job || !["PENDING", "RUNNING"].includes(job.status)) return;
  const apiKey = await secret(db);
  await db.query(
    "UPDATE product_enrichment_jobs SET status='RUNNING',progress=jsonb_set(progress,'{phase}','\"RESEARCHING\"'),updated_at=now() WHERE id=$1",
    [id],
  );
  const started = Date.now();
  const pending = (
    await db.query(
      `SELECT r.*,p.part_number,p.description,b.name brand,c.name category FROM product_enrichment_rows r JOIN products p ON p.id=r.product_id LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id WHERE r.job_id=$1 AND r.status IN ('PENDING','PROCESSING') ORDER BY r.created_at,r.id`,
      [id],
    )
  ).rows;
  const total = Number(job.progress?.totalRows ?? pending.length);
  let processed = total - pending.length;
  for (const row of pending) {
    await db.query(
      "UPDATE product_enrichment_rows SET status='PROCESSING',updated_at=now() WHERE id=$1",
      [row.id],
    );
    try {
      const result = await researchWithRetry(apiKey, job.model, row);
      await db.query(
        "UPDATE product_enrichment_rows SET status=$2,suggestion=$3,sources=$4,confidence=$5,error=NULL,updated_at=now() WHERE id=$1",
        [
          row.id,
          result.parsed.status,
          json(result.parsed),
          json(result.sources),
          result.parsed.confidence,
        ],
      );
    } catch (e) {
      await db.query(
        "UPDATE product_enrichment_rows SET status='FAILED',error=$2,updated_at=now() WHERE id=$1",
        [row.id, (e as Error).message.slice(0, 300)],
      );
    }
    processed++;
    const elapsed = (Date.now() - started) / 1000,
      remaining = processed
        ? Math.max(0, Math.round((elapsed / processed) * (total - processed)))
        : null;
    await db.query(
      "UPDATE product_enrichment_jobs SET progress=$2,updated_at=now() WHERE id=$1",
      [
        id,
        json({
          phase: "RESEARCHING",
          processedRows: processed,
          totalRows: total,
          percentage: Math.round((processed / total) * 100),
          remainingSeconds: remaining,
        }),
      ],
    );
    await db.query(
      "UPDATE jobs SET locked_at=now() WHERE kind='PRODUCT_AI_ENRICH' AND payload->>'enrichmentJobId'=$1 AND status='RUNNING'",
      [id],
    );
  }
  await db.query(
    "UPDATE product_enrichment_jobs SET status='READY',progress=$2,completed_at=now(),updated_at=now() WHERE id=$1",
    [
      id,
      json({
        phase: "COMPLETE",
        processedRows: total,
        totalRows: total,
        percentage: 100,
        remainingSeconds: 0,
      }),
    ],
  );
}
