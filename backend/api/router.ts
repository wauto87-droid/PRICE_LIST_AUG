import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { AppError, assert } from "../core/errors";
import { audit, json } from "../core/audit";
import * as auth from "../auth/service";
import * as products from "../products/service";
import * as quotes from "../quotations/service";
import * as admin from "../admin/service";
import * as imports from "../imports/service";
import { calculate, lineInput } from "../pricing/engine";
import { quotationHtml } from "../pdf/template";
const response = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
async function readLimited(req: Request, limit: number): Promise<Buffer> {
  assert(
    Number(req.headers.get("content-length") ?? 0) <= limit,
    413,
    "Request too large",
  );
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AppError(413, "Request too large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    reader.releaseLock();
  }
}
async function body(req: Request) {
  const text = (await readLimited(req, 2 * 1024 * 1024)).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "Invalid JSON");
  }
}
const uuid = (s: string) => z.string().uuid().parse(s);
export async function handle(req: Request, db: DB): Promise<Response> {
  try {
    const url = new URL(req.url),
      parts = url.pathname
        .replace(/^\/api\/v1\/?/, "")
        .split("/")
        .filter(Boolean),
      [root, id, action] = parts,
      method = req.method;
    if (root === "health") {
      await db.query("SELECT 1");
      return response({ ok: true });
    }
    if (root === "setup" && method === "GET")
      return response({
        required: !(await one(db, "SELECT id FROM users LIMIT 1")),
      });
    if (root === "setup" && method === "POST") {
      auth.checkOrigin(req);
      await auth.throttle(db, "setup", 10);
      return response(await auth.setup(db, await body(req)));
    }
    if (root === "auth" && id === "login" && method === "POST") {
      auth.checkOrigin(req);
      await auth.throttle(db, "global-login", 200);
      const { token } = await auth.login(db, await body(req));
      return response({ ok: true }, 200, {
        "Set-Cookie": auth.sessionCookie(token),
      });
    }
    const actor = await auth.authenticate(db, req);
    if (!["GET", "HEAD"].includes(method)) auth.checkCsrf(req, actor);
    const settings = await admin.settings(db);
    if (root === "auth" && id === "me")
      return response({
        user: actor,
        settings: {
          companyName: settings.companyName,
          currency: settings.currency,
          vat: settings.vat,
          minimumVisible: settings.minimumVisible,
          showMaxDiscount: settings.showMaxDiscount,
          allowOfflineCache: settings.allowOfflineCache,
        },
      });
    if (root === "auth" && id === "logout" && method === "POST") {
      await auth.logout(db, req);
      return response({ ok: true }, 200, {
        "Set-Cookie": auth.sessionCookie(""),
      });
    }
    if (root === "search" && method === "GET")
      return response(
        await products.search(
          db,
          actor,
          url.searchParams.get("q") ?? "",
          settings,
        ),
      );
    if (root === "pricing" && method === "POST") {
      auth.requirePermission(actor, "PRODUCT_VIEW");
      const input = lineInput.parse(await body(req));
      const p = await products.getProduct(db, input.productId);
      assert(p.active, 409, "Product is archived");
      const { maxDiscount, ...price } = calculate(
        products.toInput(p),
        auth.pricingPolicy(actor),
        input,
      );
      return response({
        ...price,
        ...(settings.showMaxDiscount ? { maxDiscount } : {}),
      });
    }
    if (root === "products") {
      if (method === "GET" && !id)
        return response(
          await products.search(
            db,
            actor,
            url.searchParams.get("q") ?? "",
            settings,
            true,
          ),
        );
      if (id === "bulk" && method === "POST")
        return response(await admin.bulkPrice(db, actor, await body(req)));
      if (id && method === "GET") {
        auth.requirePermission(actor, "PRODUCT_VIEW");
        return response(
          products.staffProduct(
            await products.getProduct(db, uuid(id)),
            actor,
            settings,
          ),
        );
      }
      if (method === "POST" || method === "PUT") {
        auth.requirePermission(actor, id ? "PRODUCT_EDIT" : "PRODUCT_CREATE");
        auth.requirePermission(actor, "COST_VIEW");
        const { version, ...data } = await body(req);
        if (data.vat === undefined) data.vat = settings.vat;
        return response(
          await db.transaction((tx) =>
            products.saveProduct(
              tx,
              actor,
              data,
              id ? uuid(id) : undefined,
              version,
            ),
          ),
        );
      }
    }
    if (root === "quotations") {
      if (!id && method === "GET") {
        auth.requirePermission(actor, "PRODUCT_VIEW");
        return response(
          (
            await db.query(
              `SELECT id,number,status,customer,totals,version,created_at FROM quotations WHERE status<>'DELETED' AND ($1 OR owner_id=$2) ORDER BY created_at DESC LIMIT 200`,
              [auth.has(actor, "QUOTE_VIEW_ALL"), actor.id],
            )
          ).rows,
        );
      }
      if (!id && method === "POST") {
        const { requestId, ...data } = await body(req);
        return response(
          await quotes.saveDraft(
            db,
            actor,
            data,
            settings,
            undefined,
            undefined,
            requestId,
          ),
        );
      }
      if (id) {
        uuid(id);
        if (!action && method === "GET")
          return response(
            quotes.publicQuote(await quotes.getQuote(db, actor, id), actor),
          );
        if (!action && method === "PUT") {
          const { version, ...data } = await body(req);
          return response(
            await quotes.saveDraft(db, actor, data, settings, id, version),
          );
        }
        if (!action && method === "DELETE") {
          auth.requirePermission(actor, "QUOTE_DELETE");
          return response(
            await db.transaction(async (tx) => {
              await tx.query(
                "SELECT id FROM quotations WHERE id=$1 FOR UPDATE",
                [id],
              );
              const q = await quotes.getQuote(tx, actor, id, true);
              assert(
                q.status === "DRAFT",
                409,
                "Issued quotations cannot be deleted",
              );
              await tx.query(
                "UPDATE quotations SET status='DELETED',version=version+1 WHERE id=$1",
                [id],
              );
              await audit(tx, actor.id, "QUOTATION_DELETE", "quotations", id);
              return { ok: true };
            }),
          );
        }
        if (action === "duplicate" && method === "POST") {
          const q = await quotes.getQuote(db, actor, id);
          return response(
            await quotes.saveDraft(
              db,
              actor,
              {
                customer: q.customer,
                lines: q.lines.map((l: any) => ({
                  ...quotes.savedLineInput(l),
                  override: false,
                  reason: "",
                })),
              },
              settings,
            ),
          );
        }
        if (action === "review" && method === "POST")
          return response(await quotes.reviewIssue(db, actor, id, settings));
        if (action === "issue" && method === "POST") {
          const { token } = z
            .object({ token: z.string().length(64) })
            .strict()
            .parse(await body(req));
          return response(await quotes.issue(db, actor, id, token, settings));
        }
        if (action === "print" && method === "GET") {
          const q = await quotes.getQuote(db, actor, id);
          const logo =
            "data:image/svg+xml;base64," +
            (
              await fs.readFile(path.join(process.cwd(), "public/logo.svg"))
            ).toString("base64");
          return new Response(quotationHtml(q, settings, logo), {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          });
        }
        if (action === "pdf" && method === "POST") {
          const q = await quotes.getQuote(db, actor, id);
          const job = randomUUID();
          await db.query(
            "INSERT INTO jobs(id,kind,payload) VALUES($1,'QUOTE_PDF',$2)",
            [
              job,
              json({
                quoteId: id,
                ownerId: actor.id,
                snapshot: {
                  ...q,
                  company_snapshot: q.company_snapshot ?? settings,
                },
              }),
            ],
          );
          return response({ id: job });
        }
      }
    }
    if (root === "documents" && id) {
      uuid(id);
      const job = await one(
        db,
        "SELECT * FROM jobs WHERE id=$1 AND kind='QUOTE_PDF'",
        [id],
      );
      assert(job, 404, "Document not found");
      await quotes.getQuote(db, actor, job.payload.quoteId);
      if (action === "download") {
        assert(job.status === "DONE", 409, "PDF is not ready");
        return new Response(
          await fs.readFile(
            path.join(
              path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
              "pdf",
              id + ".pdf",
            ),
          ),
          {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": 'attachment; filename="AMT-quotation.pdf"',
              "Cache-Control": "no-store",
            },
          },
        );
      }
      return response({ id: job.id, status: job.status, error: job.error });
    }
    if (root === "customers") {
      auth.requirePermission(actor, "QUOTE_CREATE");
      if (method === "GET")
        return response(
          (
            await db.query(
              "SELECT * FROM customers WHERE name ILIKE $1 OR number ILIKE $1 ORDER BY name LIMIT 50",
              ["%" + (url.searchParams.get("q") ?? "").slice(0, 100) + "%"],
            )
          ).rows,
        );
      if (method === "POST") {
        const customer = quotes.quoteInput.shape.customer.parse(
          await body(req),
        );
        assert(
          customer.name || customer.number,
          400,
          "Name or number is required",
        );
        const cid = randomUUID();
        await db.query("INSERT INTO customers VALUES($1,$2,$3,$4,$5)", [
          cid,
          customer.name,
          customer.number,
          customer.mobile,
          customer.reference,
        ]);
        return response({ id: cid, ...customer });
      }
    }
    if (root === "imports") {
      auth.requirePermission(actor, "COST_VIEW");
      assert(
        auth.has(actor, "IMPORT_EXCEL") ||
          auth.has(actor, "IMPORT_PDF") ||
          auth.has(actor, "IMPORT_CONFIRM"),
        403,
        "Import permission required",
      );
      if (!id && method === "POST") {
        const bytes = await readLimited(
          req,
          (Number(process.env.UPLOAD_MAX_MB || 20) + 1) * 1024 * 1024,
        );
        const form = await new Response(new Uint8Array(bytes), {
          headers: { "Content-Type": req.headers.get("content-type") ?? "" },
        }).formData();
        const file = form.get("file");
        assert(file instanceof File, 400, "Select a file");
        return response(await imports.upload(db, actor, file));
      }
      if (!id && method === "GET")
        return response(
          (
            await db.query(
              "SELECT id,filename,kind,status,summary,error,version,created_at FROM import_jobs ORDER BY created_at DESC LIMIT 100",
            )
          ).rows,
        );
      if (id) {
        uuid(id);
        if (!action && method === "GET") {
          const job = await one(
            db,
            "SELECT id,filename,kind,status,mapping,defaults,summary,error,version FROM import_jobs WHERE id=$1",
            [id],
          );
          assert(job, 404, "Import not found");
          const rows = (
            await db.query(
              "SELECT * FROM import_rows WHERE job_id=$1 ORDER BY row_number LIMIT 10000",
              [id],
            )
          ).rows;
          for (const row of rows)
            if (row.duplicate_id && auth.has(actor, "COST_VIEW"))
              row.current = products.toInput(
                await products.getProduct(db, row.duplicate_id),
              );
          return response({ ...job, rows });
        }
        if (action === "mapping" && method === "POST")
          return response(
            await imports.mapRows(db, actor, id, await body(req)),
          );
        if (action === "review" && method === "POST")
          return response(
            await imports.reviewRows(db, actor, id, await body(req)),
          );
        if (action === "confirm" && method === "POST")
          return response(
            await imports.confirmImport(
              db,
              actor,
              id,
              z
                .object({ version: z.number().int() })
                .strict()
                .parse(await body(req)).version,
            ),
          );
        if (action === "rollback" && method === "POST")
          return response(await imports.rollback(db, actor, id));
      }
    }
    if (root === "exports") {
      auth.requirePermission(actor, "EXPORT");
      if (!id && method === "POST") {
        const job = randomUUID();
        await db.query(
          "INSERT INTO jobs(id,kind,payload) VALUES($1,'CATALOG_EXPORT',$2)",
          [
            job,
            json({
              ownerId: actor.id,
              includeCosts: auth.has(actor, "COST_VIEW"),
            }),
          ],
        );
        return response({ id: job, status: "PENDING" });
      }
      if (id && method === "GET") {
        uuid(id);
        const job = await one(
          db,
          "SELECT * FROM jobs WHERE id=$1 AND kind='CATALOG_EXPORT'",
          [id],
        );
        assert(
          job && job.payload.ownerId === actor.id,
          404,
          "Export not found",
        );
        if (job.payload.includeCosts)
          auth.requirePermission(actor, "COST_VIEW");
        if (action === "download") {
          assert(job.status === "DONE", 409, "Export is not ready");
          return new Response(
            await fs.readFile(
              path.join(
                path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
                "exports",
                id + ".xlsx",
              ),
            ),
            {
              headers: {
                "Content-Type":
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition":
                  'attachment; filename="AMT-products.xlsx"',
                "Cache-Control": "no-store",
              },
            },
          );
        }
        return response({ id: job.id, status: job.status, error: job.error });
      }
    }
    if (root === "admin") {
      auth.requirePermission(actor, "ADMIN_VIEW");
      if (id === "dashboard" && method === "GET")
        return response(await admin.dashboard(db));
      if (id === "settings") {
        auth.requirePermission(actor, "SETTINGS_MANAGE");
        return response(
          method === "GET"
            ? settings
            : await admin.saveSettings(db, actor, await body(req)),
        );
      }
      if (id === "users") {
        auth.requirePermission(actor, "USER_MANAGE");
        return response(
          method === "GET"
            ? (
                await db.query(
                  "SELECT id,username,name,role_id,permissions,max_discount,disabled FROM users ORDER BY username",
                )
              ).rows
            : await admin.saveUser(
                db,
                actor,
                await body(req),
                action ? uuid(action) : undefined,
              ),
        );
      }
      if (id === "roles") {
        auth.requirePermission(actor, "USER_MANAGE");
        return response(
          method === "GET"
            ? {
                roles: (await db.query("SELECT * FROM roles ORDER BY id")).rows,
                permissions: auth.PERMISSIONS,
              }
            : await admin.saveRole(db, actor, await body(req)),
        );
      }
      if (id === "brands" || id === "categories") {
        auth.requirePermission(actor, "PRODUCT_EDIT");
        return response(
          method === "GET"
            ? (await db.query(`SELECT * FROM ${id} ORDER BY name`)).rows
            : await admin.saveTaxonomy(
                db,
                actor,
                id,
                await body(req),
                action ? uuid(action) : undefined,
              ),
        );
      }
      if (id === "history") {
        auth.requirePermission(actor, "PRICE_HISTORY_VIEW");
        auth.requirePermission(actor, "COST_VIEW");
        return response(
          (
            await db.query(
              "SELECT h.*,p.part_number,u.name AS actor FROM price_history h JOIN products p ON p.id=h.product_id LEFT JOIN users u ON u.id=h.actor_id WHERE ($1::uuid IS NULL OR h.product_id=$1) ORDER BY h.created_at DESC LIMIT 300",
              [
                url.searchParams.get("productId")
                  ? uuid(url.searchParams.get("productId")!)
                  : null,
              ],
            )
          ).rows,
        );
      }
      if (id === "audit") {
        auth.requirePermission(actor, "AUDIT_VIEW");
        auth.requirePermission(actor, "COST_VIEW");
        return response(
          (
            await db.query(
              "SELECT a.*,u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 300",
            )
          ).rows,
        );
      }
      if (id === "backups") {
        auth.requirePermission(actor, "BACKUP_MANAGE");
        if (method === "GET")
          return response(
            (
              await db.query(
                "SELECT * FROM backups ORDER BY created_at DESC LIMIT 100",
              )
            ).rows,
          );
        const bid = randomUUID();
        await db.query("INSERT INTO backups(id,requested_by) VALUES($1,$2)", [
          bid,
          actor.id,
        ]);
        await audit(db, actor.id, "BACKUP_REQUEST", "backups", bid);
        return response({ id: bid });
      }
    }
    throw new AppError(404, "Endpoint not found");
  } catch (error) {
    if (error instanceof AppError)
      return response(
        { error: error.message, details: error.details },
        error.status,
      );
    if (error instanceof z.ZodError)
      return response(
        {
          error: "Please correct the highlighted values",
          details: error.issues,
        },
        400,
      );
    if ((error as any).code === "23505")
      return response(
        { error: "A record with this identifier already exists" },
        409,
      );
    const safe = [
      "Minimum price",
      "Quantity",
      "Discount",
      "Override",
      "Select a default",
      "Selected selling level",
      "Duplicate selling level",
      "Calculated master",
    ];
    if (error instanceof Error && safe.some((s) => error.message.startsWith(s)))
      return response({ error: error.message }, 400);
    console.error("API request failed", error);
    return response(
      {
        error:
          "Unable to complete this request. Please try again or contact your administrator.",
      },
      500,
    );
  }
}
