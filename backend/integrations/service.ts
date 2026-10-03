import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DB, one } from "../core/db";
import { Actor } from "../auth/service";
import { saveProduct } from "../products/service";
import { normalizePart } from "../pricing/engine";
import {
  Hooks,
  check,
  catalogItem,
  adminState,
  adminCommand,
  reviewProposal,
  protocol,
  readBody,
  ConnectionError,
  authenticate,
  getHistory,
} from "./core";

export const priceHooks: Hooks = {
  app: "pricelist",
  catalog: async (tx) => {
    const products = (
      await tx.query(
        "SELECT p.id,p.part_number,p.description,p.unit,p.active,p.details,b.name brand,c.name category,COALESCE((SELECT json_agg(a.label) FROM product_aliases a WHERE a.product_id=p.id),'[]') aliases FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id",
      )
    ).rows;
    const custom = (
      await tx.query(
        "SELECT id,reference,description,unit,status,product_id FROM reusable_custom_items",
      )
    ).rows;
    return [
      ...products.map((p) =>
        catalogItem.parse({
          id: p.id,
          type: "PRODUCT",
          code: p.part_number,
          description: p.description,
          unit: p.unit,
          brand: p.brand || "",
          category: p.category || "",
          aliases: p.aliases,
          specifications:
            (p.details?.specifications || [])
              .map((s: any) => `${s.label}: ${s.value}`)
              .join("; ") ||
            p.details?.detailedDescription ||
            "",
          active: p.active,
        }),
      ),
      ...custom.map((p) =>
        catalogItem.parse({
          id: p.id,
          type: "REUSABLE",
          code: p.reference,
          description: p.description,
          unit: p.unit,
          active: p.status === "ACTIVE",
          convertedTo: p.product_id || null,
        }),
      ),
    ];
  },
  approve: async (tx, actor: Actor, input) => {
    check(actor.role === "ADMIN", "Administrator access required", 403);
    const type = z.enum(["PRODUCT", "REUSABLE"]).parse(input.type);
    if (input.decision === "LINKED") {
      const id = z.string().uuid().parse(input.targetId);
      const row = await one(
        tx,
        type === "PRODUCT"
          ? "SELECT id,part_number code,unit FROM products WHERE id=$1 AND active=true"
          : "SELECT id,reference code,unit FROM reusable_custom_items WHERE id=$1 AND status='ACTIVE'",
        [id],
      );
      check(row, "Choose an active existing item");
      return { id, type, code: row.code, unit: row.unit };
    }
    if (type === "PRODUCT") {
      check(
        input.product &&
          typeof input.product.cost === "string" &&
          typeof input.product.listPrice === "string" &&
          input.pricingConfirmed === true,
        "Enter and confirm product pricing before approval",
      );
      const code = z
        .string()
        .trim()
        .min(1)
        .max(100)
        .parse(input.product.partNumber);
      await tx.query("SELECT id FROM settings WHERE id=1 FOR UPDATE");
      check(
        !(await one(
          tx,
          "SELECT id FROM reusable_custom_items WHERE status='ACTIVE' AND normalized_reference=$1",
          [normalizePart(code)],
        )),
        "This reference exists as a reusable item. Link it or convert it in Reusable Custom Items first.",
        409,
      );
      const row = await saveProduct(
        tx,
        actor,
        input.product,
        undefined,
        undefined,
        "WORKFLOW_REVIEW",
      );
      return {
        id: row.id,
        type,
        code: input.product.partNumber,
        unit: input.product.unit,
      };
    }
    const v = z
      .object({
        reference: z.string().trim().max(100),
        description: z.string().trim().min(1).max(1000),
        unit: z.string().trim().min(1).max(20),
        suggestedUnitPrice: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/),
      })
      .strict()
      .parse(input.custom);
    check(
      input.pricingConfirmed === true,
      "Enter and confirm a suggested price",
    );
    await tx.query(
      "LOCK TABLE reusable_custom_items IN SHARE ROW EXCLUSIVE MODE",
    );
    await tx.query("SELECT id FROM settings WHERE id=1 FOR UPDATE");
    const reference = normalizePart(v.reference);
    const description = v.description
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleUpperCase("en-US");
    const collision = await one(
      tx,
      "SELECT id FROM products WHERE $1<>'' AND normalized_part=$1 UNION ALL SELECT product_id FROM product_aliases WHERE $1<>'' AND normalized=$1 UNION ALL SELECT id FROM reusable_custom_items WHERE status='ACTIVE' AND (($1<>'' AND normalized_reference=$1) OR normalized_description=$2)",
      [reference, description],
    );
    check(
      !collision,
      "A matching code or reusable description exists. Review and link the existing item instead.",
      409,
    );
    const id = randomUUID();
    await tx.query(
      "INSERT INTO reusable_custom_items(id,reference,normalized_reference,description,normalized_description,unit,suggested_unit_price,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        v.reference,
        reference,
        v.description,
        description,
        v.unit,
        v.suggestedUnitPrice,
        actor.id,
      ],
    );
    return { id, type, code: v.reference, unit: v.unit };
  },
};
export async function integrationPublic(db: DB, req: Request, path: string) {
  if (path === "jobs-pickup" || path === "jobs-orders-update") {
    try {
      const { workflowEnabled, receipt } = await import("./job-protocol");
      workflowEnabled();
      await authenticate(db, req, "jobs:results");
      check(req.method === "POST", "Method not allowed", 405);
      const input = await readBody(req);
      if (path === "jobs-pickup") {
        const { pickupPdf } = await import("../pdf/pickup");
        return Response.json(await pickupPdf(db, input));
      }
      return Response.json(
        await receipt(db, input.eventId, input, async (tx) => {
          const link = await one(
            tx,
            "SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE",
            [z.string().uuid().parse(input.documentId)],
          );
          check(link, "Document missing", 404);
          if ((link.data.orderRevision || 0) >= input.revision)
            return { received: true, stale: true };
          link.data.erpRevision = input.revision;
          link.data.orderRevision = input.revision;
          link.data.orders = input.orders;
          for (const o of link.data.collectionOrders || []) {
            const current = input.orders.find((s: any) => s.id === o.id);
            if (current) {
              o.mode = current.mode;
              o.poNumber = current.poNumber;
            }
          }
          link.data.workflowNumber = input.workflow || link.data.workflowNumber;
          await tx.query(
            "UPDATE sw_job_documents SET data=$2::jsonb WHERE id=$1",
            [link.id, JSON.stringify(link.data)],
          );
          return { received: true };
        }),
      );
    } catch (e) {
      return Response.json(
        {
          error: e instanceof Error ? e.message : "Pickup/order update failed",
        },
        { status: e instanceof ConnectionError ? e.status : 400 },
      );
    }
  }
  if (path === "jobs-owner-command") {
    try {
      const { workflowEnabled, receipt } = await import("./job-protocol");
      workflowEnabled();
      await authenticate(db, req, "jobs:results");
      check(req.method === "POST", "Method not allowed", 405);
      const input = await readBody(req);
      return Response.json(
        await receipt(db, `erp-owner:${input.eventId}`, input, async (tx) => {
          const u = await one(
            tx,
            `SELECT u.*,r.permissions role_permissions,COALESCE(u.max_discount,r.max_discount)::text discount FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND NOT u.disabled FOR SHARE OF u,r`,
            [z.string().uuid().parse(input.actorId)],
          );
          check(u, "Mapped user is disabled or missing", 403);
          const actor: Actor = {
            id: u.id,
            username: u.username,
            name: u.name,
            role: u.role_id,
            permissions: [
              ...new Set<string>([...u.permissions, ...u.role_permissions]),
            ],
            maxDiscount: u.discount,
            csrf: "",
          };
          const q = await one(
            tx,
            "SELECT * FROM quotations WHERE id=$1 FOR UPDATE",
            [input.documentId],
          );
          const link = await one(
            tx,
            "SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE",
            [input.documentId],
          );
          check(
            q &&
              link &&
              q.owner_id === input.ownerId &&
              !link.data.handover &&
              (link.data.ownershipRevision || 0) === input.ownershipRevision &&
              link.data.branchId === input.branchId,
            "Ownership or branch changed; refresh before retrying",
            409,
          );
          if (actor.id !== q.owner_id) {
            check(
              actor.role === "ADMIN",
              "Only the responsible salesman may change pricing",
              403,
            );
            const reason = z
              .string()
              .trim()
              .min(5)
              .max(1000)
              .parse(input.reason);
            (link.data.overrides ||= {})[actor.id] = {
              reason,
              until: new Date(Date.now() + 60000).toISOString(),
            };
            await tx.query(
              "UPDATE sw_job_documents SET data=$2::jsonb WHERE id=$1",
              [q.id, JSON.stringify(link.data)],
            );
          }
          const { jobWorkspace, workflowContext } = await import("./jobs");
          if (input.action !== "assign") {
            const context = await workflowContext(
              tx,
              actor,
              q,
              link,
              input.branchId,
            );
            check(
              context.ownerMappingRevision === input.ownerMappingRevision &&
                context.actorMappingRevision === input.actorMappingRevision,
              "Admin mapping changed; refresh before retrying",
              409,
            );
          }
          const result = await jobWorkspace(
            tx,
            actor,
            new Request("http://internal/workflow-jobs", {
              method: "POST",
              body: JSON.stringify(input),
            }),
            undefined,
            false,
          );
          return { received: true, ...result };
        }),
      );
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Decision failed" },
        { status: (e as any).status || 400 },
      );
    }
  }
  if (path === "jobs-review") {
    try {
      const { workflowEnabled } = await import("./job-protocol");
      workflowEnabled();
      await authenticate(db, req, "jobs:results");
      check(req.method === "POST", "Method not allowed", 405);
      const input = await readBody(req);
      const id = z.string().uuid().parse(input.documentId);
      const q = await one(db, "SELECT * FROM quotations WHERE id=$1", [id]);
      const link = await one(db, "SELECT * FROM sw_job_documents WHERE id=$1", [
        id,
      ]);
      check(q && link, "Linked document not found", 404);
      const { ready } = await import("./jobs");
      return Response.json({
        ...ready(q, link),
        status: q.status,
        number: q.number,
        ownerId: q.owner_id,
        version: q.version,
        workflowVersion: link.revision,
        currency:
          q.company_snapshot?.currency ||
          (await one(db, "SELECT data FROM settings WHERE id=1"))?.data
            ?.currency ||
          "SAR",
        lines: q.lines.map((l: any) => ({
          id: l.input?.watcherEventId,
          name: l.description,
          specifications: l.specifications || "",
          partNumber: l.partNumber,
          quantity: String(l.input?.quantity ?? l.price?.quantity ?? ""),
          unit: l.unit,
          workflowCost: l.workflowCost,
          workflowPricing: l.workflowPricing,
          job: link.data.lines[l.input?.watcherEventId]?.PRICING,
          decisionPending:
            !!link.data.lines[l.input?.watcherEventId]?.decisionPending,
        })),
        removed:
          link.data.removedLines?.map(
            (x: any) => x.line.input?.watcherEventId,
          ) || [],
        ownershipRevision: link.data.ownershipRevision || 0,
        handoverPending: !!link.data.handover,
      });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Review unavailable" },
        { status: e instanceof ConnectionError ? e.status : 503 },
      );
    }
  }
  if (path === "jobs-ownership") {
    try {
      const { ownershipEndpoint } = await import("./ownership");
      return Response.json(await ownershipEndpoint(db, req));
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Handover failed" },
        { status: e instanceof ConnectionError ? e.status : 503 },
      );
    }
  }
  if (path === "jobs-result") {
    try {
      const { receiveJobResult } = await import("./jobs");
      return Response.json(await receiveJobResult(db, req));
    } catch (e) {
      return Response.json(
        {
          error:
            e instanceof ConnectionError
              ? e.message
              : "Job result could not be applied",
        },
        { status: e instanceof ConnectionError ? e.status : 503 },
      );
    }
  }
  if (path === "users") {
    try {
      check(req.method === "GET", "Method not allowed", 405);
      await authenticate(db, req, "users:read");
      const after = new URL(req.url).searchParams.get("after") || "";
      check(
        !after || z.string().uuid().safeParse(after).success,
        "Invalid directory cursor",
      );
      const rows = (
        await db.query(
          "SELECT id,name,username,integration_reference reference,NOT COALESCE(disabled,false) active FROM users WHERE id::text>$1 ORDER BY id::text LIMIT 201",
          [after],
        )
      ).rows;
      return Response.json(
        {
          users: rows.slice(0, 200),
          next: rows.length > 200 ? rows[199].id : null,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      return Response.json(
        {
          error:
            e instanceof ConnectionError ? e.message : "Directory unavailable",
        },
        { status: e instanceof ConnectionError ? e.status : 503 },
      );
    }
  }
  try {
    return Response.json(await protocol(db, priceHooks, req, path), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof ConnectionError
            ? e.message
            : "Invalid or unavailable integration request",
      },
      {
        status:
          e instanceof ConnectionError
            ? e.status
            : e instanceof z.ZodError
              ? 400
              : 503,
      },
    );
  }
}
export async function integrationAdmin(db: DB, actor: Actor, req: Request) {
  try {
    check(actor.role === "ADMIN", "Administrator access required", 403);
    const url = new URL(req.url);
    if (req.method === "GET") {
      if (url.searchParams.has("incoming")) {
        const page = Math.max(
          0,
          Math.min(100000, Number(url.searchParams.get("page")) || 0),
        );
        return Response.json({
          rows: (
            await db.query(
              "SELECT * FROM sw_link_proposals ORDER BY updated_at DESC LIMIT 100 OFFSET $1",
              [page * 100],
            )
          ).rows,
        });
      }
      if (url.searchParams.has("history")) {
        const page = Math.max(
          0,
          Math.min(100000, Number(url.searchParams.get("page")) || 0),
        );
        return Response.json({ rows: await getHistory(db, 50) });
      }
      if (url.searchParams.has("search")) {
        const term = `%${(url.searchParams.get("search") || "").slice(0, 100).replace(/[\\%_]/g, "\\$&")}%`;
        return Response.json({
          rows: (
            await db.query(
              "SELECT id,'PRODUCT' type,part_number code,description,unit FROM products WHERE active AND (part_number ILIKE $1 OR description ILIKE $1) UNION ALL SELECT id,'REUSABLE' type,reference code,description,unit FROM reusable_custom_items WHERE status='ACTIVE' AND (reference ILIKE $1 OR description ILIKE $1) LIMIT 100",
              [term],
            )
          ).rows,
        });
      }
      return Response.json(await adminState(db, priceHooks));
    }
    check(req.method === "POST", "Method not allowed", 405);
    const body = await readBody(req);
    return Response.json(
      body.action === "review"
        ? await reviewProposal(db, priceHooks, actor, body)
        : await adminCommand(db, priceHooks, actor.id, body),
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Connection unavailable" },
      {
        status:
          e instanceof ConnectionError
            ? e.status
            : e instanceof z.ZodError
              ? 400
              : 500,
      },
    );
  }
}
