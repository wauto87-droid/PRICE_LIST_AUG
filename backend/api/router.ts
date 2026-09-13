import { whatsappAdmin } from "../storefront/whatsapp";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { AppError, assert } from "../core/errors";
import { audit, json } from "../core/audit";
import * as auth from "../auth/service";
import * as products from "../products/service";
import * as productImages from "../products/images";
import * as quotes from "../quotations/service";
import * as quoteSettings from "../quotations/settings";
import * as quoteLifecycle from "../quotations/lifecycle";
import * as bulkRules from "../bulk/service";
import * as admin from "../admin/service";
import * as discountRequests from "../discount-requests/service";
import * as imports from "../imports/service";
import { basicImportTemplate } from "../imports/basic-templates";
import * as salesChecks from "../sales-checks/service";
import * as historicalPrices from "../historical-prices/service";
import * as quantityFinder from "../quantity-finder/service";
import * as reusableCustom from "../reusable-custom/service";
import * as deliveryQuoteImports from "../delivery-quote-imports/service";
import * as priceWatcher from "../price-watcher/service";
import * as productEnrichment from "../product-enrichment/service";
import * as handover from "../handover/service";
import * as commercial from "../commercial/service";
import * as storefront from "../storefront/service";
import * as commerce from '../storefront/commerce';
import * as requirements from '../storefront/requirements';
import * as storeOperations from '../storefront/operations';
import {
  calculate,
  calculateTargetPrice,
  lineInput,
  productInput,
  targetLineInput,
} from "../pricing/engine";
import { quotationHtml } from "../pdf/template";
import { quotationPdfDisposition } from "../pdf/filename";
import { quotationPdfFingerprint } from "../pdf/cache";
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
    const release = process.env.APP_RELEASE || "local";
    const url = new URL(req.url),
      parts = url.pathname
        .replace(/^\/amt_price_list(?=\/)/, "")
        .replace(/^\/api\/v1\/?/, "")
        .split("/")
        .filter(Boolean),
      [root, id, action] = parts,
      method = req.method;
    if (root === "health") {
      await db.query("SELECT 1");
      return response({ ok: true, release });
    }
    if (root === "setup" && method === "GET")
      return response({
        required: !(await one(db, "SELECT id FROM users LIMIT 1")),
        release,
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
    if (root === "storefront") {
      const account = await storefront.authenticateAccount(db, req);
      if (!["GET", "HEAD"].includes(method)) auth.checkOrigin(req);
      if(id==='homepage'&&method==='GET'){
        const campaigns=await commerce.activeCampaigns(db,account);
        const sections=[];
        for(const c of campaigns.filter(c=>c.kind==='SECTION')){
          let ids=c.data.productIds;
          if(c.data.sectionType==='NEW')ids=(await db.query('SELECT id FROM products WHERE active AND storefront_published ORDER BY created_at DESC LIMIT 12')).rows.map(p=>p.id);
          if(c.data.sectionType==='OFFERS'){const offers=campaigns.filter(x=>x.kind==='OFFER');ids=[...new Set(offers.flatMap(x=>x.data.productIds))];if(offers.some(x=>!x.data.productIds.length))ids=(await db.query('SELECT id FROM products WHERE active AND storefront_published ORDER BY part_number LIMIT 12')).rows.map(p=>p.id);}
          if(c.data.sectionType==='BESTSELLERS')ids=(await db.query("SELECT (l->>'productId')::uuid id FROM ecommerce_orders o CROSS JOIN LATERAL jsonb_array_elements(o.lines) l JOIN products p ON p.id=(l->>'productId')::uuid WHERE o.status='CONFIRMED' AND p.active AND p.storefront_published GROUP BY l->>'productId' ORDER BY sum((l->>'quantity')::numeric) DESC LIMIT 12")).rows.map(p=>p.id);
          const items=[];for(const productId of ids){try{items.push(await storefront.productDetail(db,productId,account));}catch(e){if(!(e instanceof AppError&&e.status===404))throw e;}}
          sections.push({...c,items});
        }
        return response({banners:campaigns.filter(c=>c.kind==='BANNER'),sections});
      }
      if(id==='media'&&action&&method==='GET'){const media=await one(db,'SELECT content FROM commerce_media WHERE id=$1',[uuid(action)]);assert(media,404,'Image not found');return new Response(new Uint8Array(media.content),{headers:{'Content-Type':'image/webp','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});}
      if(id==='business'&&method==='GET')return response(await requirements.portal(db,account));
      if(id==='suggestions'&&method==='GET'){const q=z.string().trim().max(100).parse(url.searchParams.get('q')||'');if(q.length<2)return response({items:[]});return response({items:(await db.query("SELECT p.id,p.part_number,p.description FROM products p WHERE p.active AND p.storefront_published AND (p.part_number ILIKE '%'||$1||'%' OR p.description ILIKE '%'||$1||'%' OR EXISTS(SELECT 1 FROM product_aliases a WHERE a.product_id=p.id AND a.label ILIKE '%'||$1||'%')) ORDER BY CASE WHEN lower(p.part_number)=lower($1) THEN 0 WHEN p.part_number ILIKE $1||'%' THEN 1 ELSE 2 END,p.part_number LIMIT 8",[q])).rows});}
      if(id==='quote-cart'&&action&&method==='GET'){const q=await requirements.checkoutQuote(db,account,uuid(action));const items=[];for(const l of q.lines){const p=await storefront.productDetail(db,l.productId,account);items.push({...p,quantity:String(l.price.quantity)})}return response({items});}
      if(id==='invitations'&&method==='POST')return response(await commerce.invite(db,account,await body(req)));
      if(id==='members'&&action&&method==='DELETE')return response(await commerce.removeMember(db,account,uuid(action)));
      if(id==='requirements'&&!action&&method==='POST')return response(await requirements.submit(db,account,await body(req)));
      if(id==='requirements'&&action&&parts[3]==='discount'&&method==='POST')return response(await requirements.requestDiscount(db,account,uuid(action),await body(req)));
      if(id==='attachments'&&method==='POST'){
        const bytes=await readLimited(req,11*1024*1024);const form=await new Request(req.url,{method:'POST',headers:{'content-type':req.headers.get('content-type')||''},body:new Uint8Array(bytes)}).formData();
        const file=form.get('file');assert(file instanceof File,400,'Choose a file');return response(await requirements.upload(db,account,form.get('requestId')?uuid(String(form.get('requestId'))):null,file.name,Buffer.from(await file.arrayBuffer())));
      }
      if(id==='attachments'&&action&&method==='GET'){const a=await requirements.attachment(db,uuid(action),account);return new Response(new Uint8Array(a.content),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
      if(id==='returns'&&method==='POST')return response(await storeOperations.requestReturn(db,account,await body(req)));
      if (id === "account") {
        if (action === "me" && method === "GET")
          return response({ account: account || null });
        if (action === "login-otp" && method === "POST") {
          await auth.throttle(db,"store-login-otp",200);
          const result=await storefront.loginAccountOtp(db,await body(req));
          return response({account:result.account},200,{"Set-Cookie":storefront.accountSessionCookie(result.token)});
        }
        if (action === "login" && method === "POST") {
          await auth.throttle(db, "store-login", 200);
          const data = await body(req);
          await auth.throttle(
            db,
            `store-login:${String(data.login).toLowerCase()}`,
            15,
          );
          const result = await storefront.loginAccount(db, data);
          return response({ account: result.account }, 200, {
            "Set-Cookie": storefront.accountSessionCookie(result.token),
          });
        }
        if (action === "register" && method === "POST")
          return response(
            await storefront.registerAccount(db, await body(req)),
          );
        if (action === "logout" && method === "POST") {
          await storefront.logoutAccount(db, req);
          return response({ ok: true }, 200, {
            "Set-Cookie": storefront.accountSessionCookie(""),
          });
        }
      }
      if (id === "products" && action && method === "GET")
        return response(
          await storefront.productDetail(db, uuid(action), account),
        );
      if (id === "images" && action && method === "GET")
        return new Response(
          new Uint8Array(await storefront.publicImage(db, uuid(action))),
          {
            headers: {
              "Content-Type": "image/webp",
              "Cache-Control": "no-store",
            },
          },
        );
      if (id === "preview" && method === "POST")
        return response(await storefront.preview(db, await body(req), account));
      if (id === "orders" && action && method === "POST")
        return response(
          await storefront.orderStatus(
            db,
            uuid(action),
            await body(req),
            account,
          ),
        );
      if (id === "configuration" && method === "GET")
        return response(await storefront.configuration(db));
      if (id === "catalog" && method === "GET")
        return response(
          await storefront.catalog(
            db,
            Object.fromEntries(url.searchParams),
            account,
          ),
        );
      if (id === "otp" && action === "request" && method === "POST")
        return response(await storefront.requestOtp(db, await body(req)));
      if (id === "otp" && action === "verify" && method === "POST")
        return response(await storefront.verifyOtp(db, await body(req)));
      if (id === "checkout" && method === "POST") {
        const data = await body(req);
        z.string().length(64).parse(data.quoteHash);
        return response(await storefront.checkout(db, data, account));
      }
      if (id === "payment-return" && method === "GET")
        return response(
          await storefront.confirmMoyasarPayment(
            db,
            z.string().min(5).parse(url.searchParams.get("id")),
          ),
        );
      if (id === "bot" && action === "track-order" && method === "POST") {
        const d = z.object({ query: z.string().trim().min(1).max(100) }).parse(await body(req));
        const order = await one(db, `
          SELECT o.number, o.status, o.totals, o.fulfillment_method, o.created_at, jsonb_array_length(o.lines) as item_count
          FROM ecommerce_orders o
          WHERE lower(o.number) = lower($1) OR o.number ILIKE '%' || $1
          ORDER BY o.created_at DESC LIMIT 1
        `, [d.query]);
        if (!order) return response({ found: false });
        return response({
          found: true,
          number: order.number,
          status: order.status,
          totals: order.totals,
          fulfillmentMethod: order.fulfillment_method,
          itemCount: Number(order.item_count) || 0,
          createdAt: order.created_at,
        });
      }
    }
    if (root === "customer-quotation" && id) {
      await auth.throttle(db, `customer-quotation:${id}`, 120);
      if (!action && method === "GET")
        return response(await quoteLifecycle.customerView(db, id));
      if (action === "respond" && method === "POST")
        return response(
          await quoteLifecycle.customerRespond(db, id, await body(req)),
        );
    }
    const actor = await auth.authenticate(db, req);
    if (!["GET", "HEAD"].includes(method)) auth.checkCsrf(req, actor);
    const settings = await admin.settings(db);
    if (root === "storefront-admin") {
      if(id==='catalog-options'&&method==='POST'){auth.requirePermission(actor,'STOREFRONT_MANAGE');const d=z.object({ids:z.array(z.string().uuid()).max(200)}).parse(await body(req));return response({products:(await db.query('SELECT id,part_number,description FROM products WHERE id=ANY($1::uuid[]) ORDER BY part_number',[d.ids])).rows});}

      if(id==='category-seo'){
        auth.requirePermission(actor,'STOREFRONT_MANAGE');
        if(method==='GET'){const settings=await one(db,'SELECT data,version FROM storefront_settings WHERE id=1');return response({version:settings!.version,content:settings!.data.categorySeo||{},categories:(await db.query('SELECT id,name FROM categories WHERE active ORDER BY name')).rows});}
        if(method==='PUT'){const d=z.object({categoryId:z.string().uuid(),version:z.number().int(),title:z.string().max(150),description:z.string().max(320),titleAr:z.string().max(150),descriptionAr:z.string().max(320)}).parse(await body(req));return response(await db.transaction(async tx=>{assert(await one(tx,'SELECT id FROM categories WHERE id=$1',[d.categoryId]),404,'Category not found');const before=await one(tx,'SELECT * FROM storefront_settings WHERE id=1 FOR UPDATE');assert(before?.version===d.version,409,'Settings changed. Reload');const content={...before!.data,categorySeo:{...before!.data.categorySeo,[d.categoryId]:{title:d.title,description:d.description,titleAr:d.titleAr,descriptionAr:d.descriptionAr}}};await tx.query('UPDATE storefront_settings SET data=$1,version=version+1 WHERE id=1',[json(content)]);await audit(tx,actor.id,'CATEGORY_SEO_UPDATE','categories',d.categoryId,null,d);return {ok:true}}));}
      }

      if(id==='image-matches'&&method==='POST'){
        auth.requirePermission(actor,'STOREFRONT_MANAGE');auth.requirePermission(actor,'PRODUCT_EDIT');
        const d=z.object({names:z.array(z.string().min(1).max(250)).min(1).max(200)}).parse(await body(req));const items=[];
        for(const name of d.names){let partNumber=name.replace(/\.(?:jpe?g|png|webp)$/i,'');let matches=(await db.query('SELECT id FROM products WHERE lower(part_number)=lower($1)',[partNumber])).rows;if(!matches.length){partNumber=partNumber.replace(/__\d+$/,'');matches=(await db.query('SELECT id FROM products WHERE lower(part_number)=lower($1)',[partNumber])).rows;}items.push({partNumber,productId:matches.length===1?matches[0].id:null});}
        return response({items});
      }

      if(id==='whatsapp'){
        auth.requirePermission(actor,'SETTINGS_MANAGE');
        auth.requirePermission(actor,'STOREFRONT_MANAGE');
        assert((action==='status' && method==='GET') || (['connect','disconnect','test'].includes(action) && method==='POST'),405,'Method not allowed');
        const result=await whatsappAdmin(action,method==='POST'?await body(req):{});
        if(method==='POST') await audit(db,actor.id,'WHATSAPP_'+action.toUpperCase(),'settings','1',null,{action});
        return response(result,200,{'Cache-Control':'no-store'});
      }

      if(id==='replenishment'&&method==='PUT'){auth.requirePermission(actor,'INVENTORY_MANAGE');const d=z.object({productId:z.string().uuid(),warehouseId:z.string().uuid(),minimum:z.string().regex(/^\d+(?:\.\d{1,6})?$/)}).parse(await body(req));await db.transaction(async tx=>{await tx.query('INSERT INTO replenishment_settings(product_id,warehouse_id,minimum) VALUES($1,$2,$3) ON CONFLICT(product_id,warehouse_id) DO UPDATE SET minimum=$3',[d.productId,d.warehouseId,d.minimum]);await audit(tx,actor.id,'REPLENISHMENT_UPDATE','products',d.productId,null,d)});return response({ok:true});}
      if(id==='bulk-publish'&&method==='PUT'){const d=z.object({items:z.array(z.object({id:z.string().uuid(),version:z.number().int(),published:z.boolean()})).min(1).max(100)}).parse(await body(req));auth.requirePermission(actor,'STOREFRONT_MANAGE');const results=[];for(const p of d.items){try{await storefront.publishProduct(db,actor,p.id,p);results.push({id:p.id,ok:true})}catch(e){if(!(e instanceof AppError))throw e;results.push({id:p.id,ok:false,error:e.message})}}return response({ok:results.every(r=>r.ok),results});}
      if(id==='commerce'&&method==='GET')return response(await commerce.dashboard(db,actor));
      if(id==='campaigns'&&method==='PUT')return response(await commerce.saveCampaign(db,actor,await body(req)));
      if(id==='company'&&action&&method==='PUT')return response(await commerce.saveCompany(db,actor,uuid(action),await body(req)));
      if(id==='prices'&&method==='PUT')return response(await commerce.savePrice(db,actor,await body(req)));
      if(id==='price-lists'&&method==='POST'){auth.requirePermission(actor,'STOREFRONT_MANAGE');const d=z.object({name:z.string().trim().min(1).max(150)}).parse(await body(req));return response(await one(db,'INSERT INTO commerce_price_lists(id,name) VALUES($1,$2) RETURNING *',[randomUUID(),d.name]));}
      if(id==='price-lists'&&action&&method==='PUT'){auth.requirePermission(actor,'STOREFRONT_MANAGE');const d=z.object({name:z.string().trim().min(1).max(150),active:z.boolean(),version:z.number().int()}).parse(await body(req));return response(await db.transaction(async tx=>{const saved=await one(tx,'UPDATE commerce_price_lists SET name=$2,active=$3,version=version+1 WHERE id=$1 AND version=$4 RETURNING *',[uuid(action),d.name,d.active,d.version]);assert(saved,409,'Price list changed. Reload');await audit(tx,actor.id,'COMMERCE_PRICE_LIST_SAVE','commerce_price_lists',action,null,d);return saved}));}
      if(id==='requirements'&&action&&method==='PUT')return response(await requirements.review(db,actor,uuid(action),await body(req)));
      if(id==='order-actions'&&action&&method==='PUT')return response(await storeOperations.orderAction(db,actor,uuid(action),await body(req)));
      if(id==='returns'&&action&&method==='PUT')return response(await storeOperations.reviewReturn(db,actor,uuid(action),await body(req)));
      if(id==='attachments'&&action&&method==='GET'){const a=await requirements.attachment(db,uuid(action),undefined,actor);return new Response(new Uint8Array(a.content),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
      if(id==='media'&&method==='POST'){auth.requirePermission(actor,'STOREFRONT_MANAGE');const bytes=await readLimited(req,8*1024*1024);const sharp=(await import('sharp')).default;const content=await sharp(bytes,{limitInputPixels:25000000}).rotate().resize(1920,1000,{fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();const mediaId=randomUUID();await db.query('INSERT INTO commerce_media(id,content) VALUES($1,$2)',[mediaId,content]);return response({url:'/amt_price_list/api/v1/storefront/media/'+mediaId});}
      if(id==='notifications'&&action&&method==='PUT'){auth.requirePermission(actor,'STOREFRONT_MANAGE');await db.query("UPDATE commerce_notifications SET status='QUEUED',error=NULL WHERE id=$1 AND status='FAILED'",[uuid(action)]);return response({ok:true});}
      if (id === "management" && method === "GET")
        return response(
          await storefront.management(
            db,
            actor,
            url.searchParams.get("q") || "",
            {offset:url.searchParams.get("offset")||0,publication:url.searchParams.get("publication")||"ALL",selection:url.searchParams.get("selection")==="true"},
          ),
        );
      if (id === "products" && action && method === "PUT")
        return response(
          await storefront.publishProduct(
            db,
            actor,
            uuid(action),
            await body(req),
          ),
        );
      if (id === "zones" && method === "PUT")
        return response(await storefront.saveZone(db, actor, await body(req)));
      if (id === "accounts" && action && method === "PUT")
        return response(
          await storefront.updateAccount(
            db,
            actor,
            uuid(action),
            await body(req),
          ),
        );
      if (method === "GET")
        return response(await storefront.configuration(db, actor));
      if (method === "PUT")
        return response(
          await storefront.saveConfiguration(db, actor, await body(req)),
        );
    }
    if (root === "approval-rules") {
      if (!id && method === "GET")
        return response(await quoteLifecycle.listRules(db, actor));
      if (!id && method === "POST")
        return response(
          await quoteLifecycle.saveRule(db, actor, undefined, await body(req)),
        );
      if (id && method === "PUT")
        return response(
          await quoteLifecycle.saveRule(db, actor, uuid(id), await body(req)),
        );
    }
    if (root === "quotation-approvals") {
      if (!id && method === "GET")
        return response(await quoteLifecycle.approvalQueue(db, actor));
      if (id && action === "approve" && method === "POST") {
        const input = z
          .object({ comment: z.string().max(1000).default("") })
          .parse(await body(req));
        return response(
          await quoteLifecycle.decide(
            db,
            actor,
            uuid(id),
            "APPROVED",
            input.comment,
          ),
        );
      }
      if (id && action === "reject" && method === "POST") {
        const input = z
          .object({ comment: z.string().trim().min(1).max(1000) })
          .parse(await body(req));
        return response(
          await quoteLifecycle.decide(
            db,
            actor,
            uuid(id),
            "REJECTED",
            input.comment,
          ),
        );
      }
    }
    if (root === "commercial" && id === "dashboard" && method === "GET")
      return response(await commercial.dashboard(db, actor));
    if (root === "sales-orders") {
      if (!id && method === "GET")
        return response(
          await commercial.listSalesOrders(
            db,
            actor,
            Object.fromEntries(url.searchParams),
          ),
        );
      if (id === "from-quotation" && action && method === "POST")
        return response(
          await commercial.convertAcceptedQuotation(
            db,
            actor,
            uuid(action),
            await body(req),
          ),
        );
      if (id && action === "reserve" && method === "POST")
        return response(
          await commercial.reserveSalesOrder(db, actor, uuid(id)),
        );
      if (id && action === "deliver" && method === "POST")
        return response(
          await commercial.deliverSalesOrder(
            db,
            actor,
            uuid(id),
            await body(req),
          ),
        );
      if (id && action === "proforma" && method === "POST")
        return response(
          await commercial.issueProforma(db, actor, uuid(id), await body(req)),
        );
      if (id && !action && method === "GET")
        return response(await commercial.getSalesOrder(db, actor, uuid(id)));
    }
    if (root === "online-orders") {
      if (!id && method === "GET")
        return response(
          await commercial.listOnlineOrders(
            db,
            actor,
            Object.fromEntries(url.searchParams),
          ),
        );
      if (id && action === "approve" && method === "POST")
        return response(
          await commercial.approveOnlineOrder(
            db,
            actor,
            uuid(id),
            await body(req),
          ),
        );
    }
    if (root === "inventory" && id === "adjustments" && method === "POST")
      return response(
        await commercial.stockAdjustment(db, actor, await body(req)),
      );
    if (root === "inventory" && id === "transfers" && method === "POST")
      return response(
        await commercial.transferStock(db, actor, await body(req)),
      );
    if (root === "stock-counts") {
      if (!id && method === "POST") {
        const input = z
          .object({ warehouseId: z.string().uuid() })
          .parse(await body(req));
        return response(
          await commercial.createStockCount(db, actor, input.warehouseId),
        );
      }
      if (id && !action && method === "PUT")
        return response(
          await commercial.updateStockCount(
            db,
            actor,
            uuid(id),
            await body(req),
          ),
        );
      if (id && action === "post" && method === "POST") {
        const input = z
          .object({ version: z.number().int().positive() })
          .parse(await body(req));
        return response(
          await commercial.postStockCount(db, actor, uuid(id), input.version),
        );
      }
    }
    if (root === "warehouses") {
      if (!id && method === "GET")
        return response(
          await commercial.warehouses(
            db,
            actor,
            Object.fromEntries(url.searchParams),
          ),
        );
      if (!id && method === "POST")
        return response(
          await commercial.saveWarehouse(db, actor, undefined, await body(req)),
        );
      if (id && method === "PUT")
        return response(
          await commercial.saveWarehouse(db, actor, uuid(id), await body(req)),
        );
    }
    if (root === "inventory" && id === "balances" && method === "GET")
      return response(
        await commercial.stockBalances(
          db,
          actor,
          Object.fromEntries(url.searchParams),
        ),
      );
    if (root === "suppliers") {
      if (!id && method === "GET")
        return response(
          await commercial.suppliers(
            db,
            actor,
            Object.fromEntries(url.searchParams),
          ),
        );
      if (!id && method === "POST")
        return response(
          await commercial.saveSupplier(db, actor, undefined, await body(req)),
        );
      if (id && method === "PUT")
        return response(
          await commercial.saveSupplier(db, actor, uuid(id), await body(req)),
        );
    }
    if (root === "purchase-orders") {
      if (!id && method === "GET")
        return response(
          await commercial.listPurchaseOrders(
            db,
            actor,
            Object.fromEntries(url.searchParams),
          ),
        );
      if (!id && method === "POST")
        return response(
          await commercial.createPurchaseOrder(db, actor, await body(req)),
        );
      if (id && action === "approve" && method === "POST") {
        const input = z
          .object({ version: z.number().int().positive() })
          .parse(await body(req));
        return response(
          await commercial.approvePurchaseOrder(
            db,
            actor,
            uuid(id),
            input.version,
          ),
        );
      }
      if (id && action === "receipts" && method === "POST")
        return response(
          await commercial.createGoodsReceipt(
            db,
            actor,
            uuid(id),
            await body(req),
          ),
        );
    }
    if (
      root === "goods-receipts" &&
      id === "for-po" &&
      action &&
      method === "GET"
    )
      return response(
        await commercial.listGoodsReceipts(db, actor, uuid(action)),
      );
    if (
      root === "goods-receipts" &&
      id &&
      action === "post" &&
      method === "POST"
    ) {
      const input = z
        .object({ version: z.number().int().positive() })
        .parse(await body(req));
      return response(
        await commercial.postGoodsReceipt(db, actor, uuid(id), input.version),
      );
    }
    if (root === "product-images" && id && method === "GET") {
      const image = await productImages.file(
        db,
        actor,
        uuid(id),
        action === "thumbnail",
      );
      const download = url.searchParams.get("download") === "1";
      return new Response(image.data, {
        headers: {
          "Content-Type": image.mime,
          "Cache-Control": "private, max-age=3600",
          ...(download
            ? {
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(image.name)}`,
              }
            : {}),
        },
      });
    }
    if (root === "learned-delivery-matches") {
      if (!id && method === "GET")
        return response(
          await handover.learnedMatches(
            db,
            actor,
            Object.fromEntries(url.searchParams),
          ),
        );
      if (id && method === "PUT")
        return response(
          await handover.updateLearnedMatch(
            db,
            actor,
            decodeURIComponent(id),
            await body(req),
          ),
        );
      if (id && method === "DELETE")
        return response(
          await handover.deleteLearnedMatch(
            db,
            actor,
            decodeURIComponent(id),
            await body(req),
          ),
        );
    }
    if (root === "quotation-templates") {
      if (!id && method === "GET")
        return response(await handover.listTemplates(db, actor));
      if (!id && method === "POST")
        return response(
          await handover.saveTemplate(db, actor, undefined, await body(req)),
        );
      if (id) {
        uuid(id);
        if (!action && method === "PUT")
          return response(
            await handover.saveTemplate(db, actor, id, await body(req)),
          );
        if (!action && method === "DELETE")
          return response(
            await handover.deleteTemplate(db, actor, id, await body(req)),
          );
        if (action === "duplicate" && method === "POST")
          return response(await handover.duplicateTemplate(db, actor, id));
        if (action === "instantiate" && method === "POST")
          return response(await handover.instantiateTemplate(db, actor, id));
      }
    }
    if (root === "quotation-price-history" && method === "GET")
      return response(
        await handover.recentPrices(
          db,
          actor,
          Object.fromEntries(url.searchParams),
        ),
      );
    if (root === "quotation-previous-prices" && method === "POST")
      return response(
        await handover.reusableCustomerPrices(db, actor, await body(req)),
      );
    if (root === "templates" && method === "GET") {
      auth.requirePermission(actor, "IMPORT_CONFIRM");
      const kind = z
        .enum([
          "simple",
          "supplier-simple",
          "advanced",
          "public-discount",
          "supplier-markup",
        ])
        .parse(id);
      if (kind === "advanced") auth.requirePermission(actor, "COST_VIEW");
      const generated =
        kind === "public-discount" || kind === "supplier-markup";
      return new Response(
        generated
          ? await basicImportTemplate(kind)
          : await fs.readFile(
              path.join(process.cwd(), "assets", "templates", kind + ".xlsx"),
            ),
        {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="AMT-${kind}-template.xlsx"`,
            "Cache-Control": "no-store",
          },
        },
      );
    }
    if (root === "bulk-rules") {
      auth.requirePermission(actor, "COST_VIEW");
      auth.requirePermission(actor, "PRODUCT_EDIT");
      if (!id && method === "GET")
        return response(
          (
            await db.query(
              "SELECT * FROM bulk_rules WHERE NOT deleted ORDER BY name",
            )
          ).rows,
        );
      if (!id && method === "POST")
        return response(await bulkRules.saveRule(db, actor, await body(req)));
      if (id === "history" && method === "GET")
        return response(
          (
            await db.query(
              "SELECT * FROM bulk_executions ORDER BY created_at DESC LIMIT 100",
            )
          ).rows,
        );
      if (id && method === "PUT")
        return response(
          await bulkRules.saveRule(db, actor, await body(req), uuid(id)),
        );
      if (id && method === "DELETE") {
        await db.transaction(async (tx) => {
          await tx.query(
            "UPDATE bulk_rules SET deleted=true,active=false,version=version+1 WHERE id=$1",
            [uuid(id)],
          );
          await audit(tx, actor.id, "BULK_RULE_DELETE", "bulk_rules", id);
        });
        return response({ ok: true });
      }
    }
    if (root === "bulk-preview") {
      if (!id && method === "POST")
        return response(await bulkRules.preview(db, actor, await body(req)));
      if (id && method === "GET")
        return response(
          await bulkRules.getPreview(
            db,
            actor,
            uuid(id),
            z.coerce
              .number()
              .int()
              .min(0)
              .max(200)
              .parse(url.searchParams.get("page") ?? 0),
          ),
        );
      if (id && method === "POST")
        return response(await bulkRules.apply(db, actor, uuid(id)));
    }
    if (root === "auth" && id === "me")
      return response(
        {
          release,
          user: actor,
          settings: {
            companyName: settings.companyName,
            currency: settings.currency,
            vat: settings.vat,
            minimumVisible: settings.minimumVisible,
            showMaxDiscount: settings.showMaxDiscount,
            allowOfflineCache: settings.allowOfflineCache,
          },
        },
        200,
        { "Set-Cookie": auth.sessionCookie(auth.requestSessionToken(req)) },
      );
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
      const raw = await body(req);
      const direct = raw && typeof raw === "object" && "targetFinalExcl" in raw;
      const input = direct ? targetLineInput.parse(raw) : lineInput.parse(raw);
      const p = await products.getProduct(db, input.productId);
      assert(p.active, 409, "Product is archived");
      const { maxDiscount, ...price } = direct
        ? calculateTargetPrice(
            products.toInput(p),
            auth.pricingPolicy(actor),
            input as any,
          )
        : calculate(
            products.toInput(p),
            auth.pricingPolicy(actor),
            input as any,
          );
      return response({
        ...price,
        ...(settings.showMaxDiscount ? { maxDiscount } : {}),
      });
    }
    if (root === "price-watcher") {
      if (id === "capture" && method === "POST")
        return response(
          await priceWatcher.captureLookup(db, actor, await body(req)),
        );
      if (id === "cart" && method === "POST")
        return response(
          await priceWatcher.captureCart(
            db,
            actor,
            await body(req),
            settings.vat,
          ),
        );
      const filters = {
        from: url.searchParams.get("from") || undefined,
        to: url.searchParams.get("to") || undefined,
        actorId: url.searchParams.get("actorId") || undefined,
        query: url.searchParams.get("query") ?? "",
        customer: url.searchParams.get("customer") ?? "",
        stage: url.searchParams.get("stage") ?? "ALL",
        source: url.searchParams.get("source") ?? "ALL",
        sellingLevel: url.searchParams.get("sellingLevel") ?? "ALL",
        minDiscount: url.searchParams.get("minDiscount") || undefined,
        maxDiscount: url.searchParams.get("maxDiscount") || undefined,
        itemKey: url.searchParams.get("itemKey") || undefined,
        page: url.searchParams.get("page") ?? 0,
        pageSize: url.searchParams.get("pageSize") ?? 25,
        view: url.searchParams.get("view") ?? "ACTIVITY",
        sort: url.searchParams.get("sort") ?? "",
        direction: url.searchParams.get("direction") ?? "desc",
        staffSort: url.searchParams.get("staffSort") ?? "subtotal",
        staffDirection: url.searchParams.get("staffDirection") ?? "desc",
      };
      if (!id && method === "GET")
        return response(await priceWatcher.dashboard(db, actor, filters));
      if (id === "details" && method === "GET")
        return response(await priceWatcher.details(db, actor, filters));
      if (id === "excel" && method === "POST")
        return response(
          await priceWatcher.queueExport(db, actor, filters, "XLSX"),
        );
      if (id === "pdf" && method === "POST")
        return response(
          await priceWatcher.queueExport(db, actor, filters, "PDF"),
        );
    }
    if (root === "price-watcher-exports" && id) {
      auth.requirePermission(actor, "PRICE_WATCHER");
      uuid(id);
      const job = await one(
        db,
        "SELECT * FROM jobs WHERE id=$1 AND kind IN ('PRICE_WATCHER_XLSX','PRICE_WATCHER_PDF')",
        [id],
      );
      assert(job && job.payload.ownerId === actor.id, 404, "Export not found");
      if (action === "download") {
        assert(job.status === "DONE", 409, "Export is not ready");
        const pdf = job.kind.endsWith("PDF"),
          ext = pdf ? "pdf" : "xlsx";
        return new Response(
          await fs.readFile(
            path.join(
              path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
              "price-watcher-exports",
              `${id}.${ext}`,
            ),
          ),
          {
            headers: {
              "Content-Type": pdf
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Content-Disposition": `attachment; filename="AMT-price-watcher.${ext}"`,
              "Cache-Control": "no-store",
            },
          },
        );
      }
      return response({
        id: job.id,
        status: job.status,
        error: job.error,
        format: job.kind.endsWith("PDF") ? "PDF" : "XLSX",
      });
    }
    if (root === "product-enrichment") {
      if (!id && method === "GET")
        return response(await productEnrichment.list(db, actor));
      if (!id && method === "POST")
        return response(
          await productEnrichment.queue(db, actor, await body(req)),
        );
      if (id === "configuration" && method === "GET")
        return response(await productEnrichment.configuration(db, actor));
      if (id === "configuration" && method === "PUT")
        return response(
          await productEnrichment.saveConfiguration(db, actor, await body(req)),
        );
      if (id === "configuration" && action === "test" && method === "POST")
        return response(await productEnrichment.testConfiguration(db, actor));
      if (id === "random" && method === "POST")
        return response(
          await productEnrichment.randomSelection(db, actor, await body(req)),
        );
      if (id && !action && method === "GET")
        return response(await productEnrichment.get(db, actor, uuid(id)));
      if (id && action === "confirm" && method === "POST")
        return response(
          await productEnrichment.confirm(db, actor, uuid(id), await body(req)),
        );
      if (id && action === "suggestion" && method === "PUT")
        return response(
          await productEnrichment.editSuggestion(
            db,
            actor,
            uuid(id),
            await body(req),
          ),
        );
      if (id && !action && method === "DELETE")
        return response(await productEnrichment.remove(db, actor, uuid(id)));
    }
    if (root === "discount-requests") {
      if (!id && method === "POST")
        return response(
          await discountRequests.createRequest(db, actor, await body(req)),
        );
      if (!id && method === "GET")
        return response(await discountRequests.listRequests(db, actor));
      if (id && method === "GET")
        return response(
          await discountRequests.getRequestDetail(db, actor, uuid(id)),
        );
      if (id && action === "approve" && method === "POST")
        return response(
          await discountRequests.approveRequest(
            db,
            actor,
            uuid(id),
            await body(req),
          ),
        );
      if (id && action === "reject" && method === "POST")
        return response(
          await discountRequests.rejectRequest(
            db,
            actor,
            uuid(id),
            await body(req),
          ),
        );
    }
    if (root === "products") {
      if (method === "GET" && !id) {
        const protectedOnly = ["1", "true", "yes", "on"].includes(
          (url.searchParams.get("protectedOnly") ?? "").toLowerCase(),
        );
        return response(
          await products.search(
            db,
            actor,
            url.searchParams.get("q") ?? "",
            settings,
            {
              admin: true,
              minimumFilter: z
                .enum(["ALL", "PROTECTED", "UNPROTECTED"])
                .catch(protectedOnly ? "PROTECTED" : "ALL")
                .parse(url.searchParams.get("minimumFilter") ?? undefined),
              statusFilter: z
                .enum(["ALL", "ACTIVE", "ARCHIVED"])
                .catch("ALL")
                .parse(url.searchParams.get("statusFilter") ?? undefined),
              methodFilter: z
                .enum(["ALL", "COST_MARKUP", "LIST_DISCOUNT", "FIXED"])
                .catch("ALL")
                .parse(url.searchParams.get("methodFilter") ?? undefined),
              contentFilter: z
                .enum(["ALL", "MISSING", "COMPLETE"])
                .catch("ALL")
                .parse(url.searchParams.get("contentFilter") ?? undefined),
              page: z.coerce
                .number()
                .int()
                .min(0)
                .parse(url.searchParams.get("page") ?? 0),
              pageSize: z.coerce
                .number()
                .int()
                .min(1)
                .max(200)
                .parse(url.searchParams.get("pageSize") ?? 50),
              selectionOffset: z.coerce
                .number()
                .int()
                .min(0)
                .parse(url.searchParams.get("selectionOffset") ?? 0),
            },
          ),
        );
      }
      if (id === "bulk" && method === "POST")
        return response(await admin.bulkPrice(db, actor, await body(req)));
      if (id && action === "images") {
        const productId = uuid(id);
        if (method === "GET")
          return response(await productImages.list(db, actor, productId));
        if (method === "POST") {
          const bytes = await readLimited(req, 6 * 1024 * 1024);
          const form = await new Response(new Uint8Array(bytes), {
            headers: { "Content-Type": req.headers.get("content-type") ?? "" },
          }).formData();
          const file = form.get("file");
          assert(file instanceof File, 400, "Choose an image to upload");
          return response(
            await db.transaction((tx) =>
              productImages.upload(
                tx,
                actor,
                productId,
                file,
                String(form.get("caption") ?? ""),
              ),
            ),
            201,
          );
        }
        if (method === "PUT")
          return response(
            await productImages.update(db, actor, productId, await body(req)),
          );
        if (method === "DELETE") {
          const input = z
            .object({
              imageId: z.string().uuid(),
              version: z.number().int().positive(),
            })
            .strict()
            .parse(await body(req));
          return response(
            await productImages.remove(
              db,
              actor,
              productId,
              input.imageId,
              input.version,
            ),
          );
        }
      }
      if (id && action === "aliases" && method === "POST") {
        const input = await body(req);
        return response(
          await db.transaction((tx) =>
            products.addProductAlias(tx, actor, uuid(id), input),
          ),
        );
      }
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
        const q = (url.searchParams.get("q") ?? "")
          .trim()
          .toUpperCase()
          .slice(0, 100)
          .replace(/[\\%_]/g, "\\$&");
        const scope = url.searchParams.get("scope") ?? "mine";
        if (scope === "all") auth.requirePermission(actor, "QUOTE_VIEW_ALL");
        const status = z
          .enum([
            "",
            "DRAFT",
            "PENDING_APPROVAL",
            "APPROVED",
            "REJECTED",
            "ISSUED",
            "SENT",
            "VIEWED",
            "ACCEPTED",
            "DECLINED",
            "EXPIRED",
          ])
          .parse(url.searchParams.get("status") ?? "");
        const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
        const from = url.searchParams.get("from"),
          to = url.searchParams.get("to");
        if (from) date.parse(from);
        if (to) date.parse(to);
        return response(
          (
            await db.query(
              `SELECT id,number,status,customer,totals,version,created_at FROM quotations WHERE status<>'DELETED' AND ($1 OR owner_id=$2) AND ($3='' OR number ILIKE $3||'%') AND ($4='' OR status=$4) AND ($5::date IS NULL OR created_at >= ($5::date::timestamp AT TIME ZONE 'Asia/Riyadh')) AND ($6::date IS NULL OR created_at < (($6::date+1)::timestamp AT TIME ZONE 'Asia/Riyadh')) ORDER BY CASE WHEN upper(number)=$7 THEN 0 ELSE 1 END,created_at DESC LIMIT 200`,
              [
                scope === "all",
                actor.id,
                q,
                status,
                from,
                to,
                (url.searchParams.get("q") ?? "").trim().toUpperCase(),
              ],
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
      if (id === "resolve" && method === "POST")
        return response(
          await reusableCustom.resolveExact(db, actor, await body(req)),
        );
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
                lines: q.lines.map((l: any) => quotes.duplicateLineInput(l)),
              },
              settings,
            ),
          );
        }
        if (action === "review" && method === "POST")
          return response(await quotes.reviewIssue(db, actor, id, settings));
        if (action === "submit-approval" && method === "POST")
          return response(
            await quoteLifecycle.submitForApproval(db, actor, id, settings),
          );
        if (action === "revision" && method === "POST")
          return response(
            await quoteLifecycle.createRevision(db, actor, id, settings),
          );
        if (action === "customer-link" && method === "POST") {
          const input = z
            .object({ days: z.number().int().min(1).max(90).default(30) })
            .parse(await body(req));
          return response(
            await quoteLifecycle.createCustomerLink(db, actor, id, input.days),
          );
        }
        if (action === "issue" && method === "POST") {
          const { token } = z
            .object({ token: z.string().length(64) })
            .strict()
            .parse(await body(req));
          return response(await quotes.issue(db, actor, id, token, settings));
        }
        if (action === "print" && method === "GET") {
          const q = await quotes.getQuote(db, actor, id);
          quotes.assertQuoteReadyForOutput(q);
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
          return response(
            await db.transaction(async (tx) => {
              await tx.query(
                "SELECT id FROM quotations WHERE id=$1 FOR UPDATE",
                [id],
              );
              const q = await quotes.getQuote(tx, actor, id);
              quotes.assertQuoteReadyForOutput(q);
              const snapshot = {
                ...q,
                company_snapshot: q.company_snapshot ?? settings,
              };
              const fingerprint = quotationPdfFingerprint(snapshot);
              const cached = await one<{ id: string; status: string }>(
                tx,
                `SELECT id,status FROM jobs
                 WHERE kind='QUOTE_PDF' AND payload->>'quoteId'=$1 AND payload->>'fingerprint'=$2
                   AND status IN ('PENDING','RUNNING','DONE')
                 ORDER BY created_at DESC,id DESC LIMIT 1`,
                [id, fingerprint],
              );
              if (cached) return { ...cached, reused: true };

              const job = randomUUID();
              await tx.query(
                "INSERT INTO jobs(id,kind,payload) VALUES($1,'QUOTE_PDF',$2)",
                [
                  job,
                  json({
                    quoteId: id,
                    ownerId: actor.id,
                    fingerprint,
                    snapshot,
                  }),
                ],
              );
              return { id: job, status: "PENDING", reused: false };
            }),
          );
        }
      }
    }
    if (root === "reusable-custom-items") {
      if (!id && method === "GET") {
        if (url.searchParams.get("admin") === "1")
          return response(
            await reusableCustom.list(
              db,
              actor,
              url.searchParams.get("q") ?? "",
              url.searchParams.get("status") ?? "ACTIVE",
            ),
          );
        return response(
          await reusableCustom.search(
            db,
            actor,
            url.searchParams.get("q") ?? "",
          ),
        );
      }
      if (id) {
        uuid(id);
        if (!action && method === "PUT")
          return response(
            await reusableCustom.update(db, actor, id, await body(req)),
          );
        if (!action && method === "DELETE")
          return response(await reusableCustom.remove(db, actor, id));
        if (action === "convert" && method === "POST")
          return response(
            await reusableCustom.convert(db, actor, id, await body(req)),
          );
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
      const quote = await quotes.getQuote(db, actor, job.payload.quoteId);
      if (action === "download") {
        assert(
          job.status !== "EXPIRED",
          410,
          "This PDF was superseded by a newer quotation PDF",
        );
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
              "Content-Disposition": quotationPdfDisposition(
                job.payload.snapshot ?? quote,
              ),
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
              "SELECT * FROM customers WHERE name ILIKE $1 OR number ILIKE $1 ORDER BY CASE WHEN btrim(number)=$2 THEN 0 ELSE 1 END,name LIMIT 50",
              [
                "%" + (url.searchParams.get("q") ?? "").slice(0, 100) + "%",
                (url.searchParams.get("q") ?? "").slice(0, 100).trim(),
              ],
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
              "SELECT id,filename,kind,status,summary,error,version,source_job_id,created_at FROM import_jobs ORDER BY created_at DESC LIMIT 100",
            )
          ).rows,
        );
      if (id) {
        uuid(id);
        if (!action && method === "GET")
          return response(
            await imports.getImportPage(
              db,
              actor,
              id,
              z.coerce
                .number()
                .int()
                .min(0)
                .parse(url.searchParams.get("page") ?? 0),
              z.coerce
                .number()
                .int()
                .min(1)
                .max(200)
                .parse(url.searchParams.get("pageSize") ?? 50),
              url.searchParams.get("groupColumn"),
              z
                .enum(["all", "repair", "ready", "skipped", "imported"])
                .parse(url.searchParams.get("rowView") ?? "all"),
            ),
          );
        if (action === "mapping" && method === "POST")
          return response(
            await imports.mapRows(db, actor, id, await body(req)),
          );
        if (action === "header" && method === "POST")
          return response(
            await deliveryQuoteImports.updateHeader(
              db,
              actor,
              id,
              await body(req),
            ),
          );
        if (action === "correction" && method === "POST")
          return response(
            await handover.correctCatalogImport(db, actor, id, await body(req)),
          );
        if (action === "review" && method === "POST")
          return response(
            await imports.reviewRows(db, actor, id, await body(req)),
          );
        if (action === "bulk-review" && method === "POST")
          return response(
            await imports.bulkReview(db, actor, id, await body(req)),
          );
        if (action === "confirm" && method === "POST") {
          const input = z
            .object({
              version: z.coerce.number().int(),
              token: z.string().min(1),
            })
            .strict()
            .parse(await body(req));
          return response(
            await imports.confirmImport(
              db,
              actor,
              id,
              input.version,
              input.token,
            ),
          );
        }
        if (action === "auto-confirm" && method === "POST") {
          const input = z
            .object({ version: z.coerce.number().int() })
            .strict()
            .parse(await body(req));
          return response(
            await imports.autoVerifyAndConfirmImport(
              db,
              actor,
              id,
              input.version,
            ),
          );
        }
        if (action === "preview-confirmation" && method === "POST")
          return response(
            await imports.previewConfirmationPage(
              db,
              actor,
              id,
              String(Date.now()),
              z.coerce
                .number()
                .int()
                .min(0)
                .parse(url.searchParams.get("page") ?? 0),
              z.coerce
                .number()
                .int()
                .min(1)
                .max(200)
                .parse(url.searchParams.get("pageSize") ?? 50),
            ),
          );
        if (action === "rollback" && method === "POST")
          return response(await imports.rollback(db, actor, id));
        if (action === "reopen" && method === "POST")
          return response(await imports.reopen(db, actor, id, await body(req)));
        if (action === "delete" && method === "POST")
          return response(await imports.deleteImport(db, actor, id));
      }
    }
    if (root === "historical-prices") {
      if (!id && method === "GET") {
        return response(await historicalPrices.list(db, actor));
      }
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
        return response(await historicalPrices.upload(db, actor, file));
      }
      if (id) {
        if (!action && method === "DELETE")
          return response(await historicalPrices.remove(db, actor, id));
        if (action === "map" && method === "POST")
          return response(await historicalPrices.mapAndSave(db, actor, id, await body(req)));
      }
    }
    if (root === "sales-price-checks") {
      auth.requirePermission(actor, "SALES_PRICE_CHECK");
      if (!id && method === "GET")
        return response(await salesChecks.list(db, actor));
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
        return response(await salesChecks.upload(db, actor, file));
      }
      if (id) {
        uuid(id);
        if (!action && method === "GET")
          return response(
            await salesChecks.get(
              db,
              actor,
              id,
              z.coerce
                .number()
                .int()
                .min(0)
                .parse(url.searchParams.get("page") ?? 0),
              z.coerce
                .number()
                .int()
                .min(1)
                .max(200)
                .parse(url.searchParams.get("pageSize") ?? 50),
              url.searchParams.get("filter") ?? "ALL",
              url.searchParams.get("q") ?? "",
              url.searchParams.get("minDiscount") ?? "",
              url.searchParams.get("sort") ?? "ROW_ASC",
            ),
          );
        if (action === "analyze" && method === "POST")
          return response(
            await salesChecks.analyze(db, actor, id, await body(req)),
          );
        if (action === "map-row" && method === "POST")
          return response(
            await salesChecks.mapRow(db, actor, id, await body(req)),
          );
        if (action === "excel" && method === "POST")
          return response(await salesChecks.queueExport(db, actor, id, "XLSX"));
        if (action === "pdf" && method === "POST")
          return response(await salesChecks.queueExport(db, actor, id, "PDF"));
        if (!action && method === "DELETE")
          return response(await salesChecks.remove(db, actor, id));
      }
    }
    if (root === "sales-price-check-exports" && id) {
      auth.requirePermission(actor, "SALES_PRICE_CHECK");
      uuid(id);
      const job = await one(
        db,
        "SELECT * FROM jobs WHERE id=$1 AND kind IN ('SALES_CHECK_XLSX','SALES_CHECK_PDF')",
        [id],
      );
      assert(job && job.payload.ownerId === actor.id, 404, "Export not found");
      if (action === "download") {
        assert(job.status === "DONE", 409, "Export is not ready");
        const pdf = job.kind === "SALES_CHECK_PDF",
          ext = pdf ? "pdf" : "xlsx";
        return new Response(
          await fs.readFile(
            path.join(
              path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
              "sales-check-exports",
              id + "." + ext,
            ),
          ),
          {
            headers: {
              "Content-Type": pdf
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Content-Disposition": `attachment; filename="AMT-sales-price-check.${ext}"`,
              "Cache-Control": "no-store",
            },
          },
        );
      }
      return response({
        id: job.id,
        status: job.status,
        error: job.error,
        format: job.kind.endsWith("PDF") ? "PDF" : "XLSX",
      });
    }
    if (root === "quantity-finder") {
      auth.requirePermission(actor, "QUANTITY_FINDER");
      if (!id && method === "GET")
        return response(await quantityFinder.list(db, actor));
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
        return response(await quantityFinder.upload(db, actor, file));
      }
      if (id) {
        uuid(id);
        if (!action && method === "GET")
          return response(
            await quantityFinder.get(
              db,
              actor,
              id,
              z.coerce
                .number()
                .int()
                .min(0)
                .parse(url.searchParams.get("page") ?? 0),
              z.coerce
                .number()
                .int()
                .min(1)
                .max(200)
                .parse(url.searchParams.get("pageSize") ?? 50),
              url.searchParams.get("view") ?? "GROUPS",
              url.searchParams.get("q") ?? "",
              url.searchParams.get("sort") ?? "PART_ASC",
              url.searchParams.get("group") ?? "",
            ),
          );
        if (action === "analyze" && method === "POST")
          return response(
            await quantityFinder.analyze(db, actor, id, await body(req)),
          );
        if (action === "excel" && method === "POST")
          return response(
            await quantityFinder.queueExport(db, actor, id, "XLSX"),
          );
        if (action === "pdf" && method === "POST")
          return response(
            await quantityFinder.queueExport(db, actor, id, "PDF"),
          );
        if (!action && method === "DELETE")
          return response(await quantityFinder.remove(db, actor, id));
      }
    }
    if (root === "quantity-finder-exports" && id) {
      auth.requirePermission(actor, "QUANTITY_FINDER");
      uuid(id);
      const job = await one(
        db,
        "SELECT * FROM jobs WHERE id=$1 AND kind IN ('QUANTITY_XLSX','QUANTITY_PDF')",
        [id],
      );
      assert(job && job.payload.ownerId === actor.id, 404, "Export not found");
      if (action === "download") {
        assert(job.status === "DONE", 409, "Export is not ready");
        const pdf = job.kind === "QUANTITY_PDF",
          ext = pdf ? "pdf" : "xlsx";
        return new Response(
          await fs.readFile(
            path.join(
              path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
              "quantity-finder-exports",
              `${id}.${ext}`,
            ),
          ),
          {
            headers: {
              "Content-Type": pdf
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Content-Disposition": `attachment; filename="AMT-quantity-finder.${ext}"`,
              "Cache-Control": "no-store",
            },
          },
        );
      }
      return response({
        id: job.id,
        status: job.status,
        error: job.error,
        format: job.kind.endsWith("PDF") ? "PDF" : "XLSX",
      });
    }
    if (root === "delivery-quote-imports") {
      if (!id && method === "GET") {
        const scope = url.searchParams.get("scope");
        if (scope)
          return response(
            await deliveryQuoteImports.history(db, actor, {
              scope,
              query: url.searchParams.get("query") ?? "",
              status: url.searchParams.get("status") ?? "ALL",
              datePreset: url.searchParams.get("datePreset") ?? "all",
              from: url.searchParams.get("from") ?? "",
              to: url.searchParams.get("to") ?? "",
              sort: url.searchParams.get("sort") ?? "newest",
              page: url.searchParams.get("page") ?? 0,
              pageSize: url.searchParams.get("pageSize") ?? 20,
            }),
          );
        return response(await deliveryQuoteImports.list(db, actor));
      }
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
        return response(await deliveryQuoteImports.upload(db, actor, file));
      }
      if (id) {
        uuid(id);
        if (!action && method === "GET")
          return response(
            await deliveryQuoteImports.get(
              db,
              actor,
              id,
              z.coerce
                .number()
                .int()
                .min(0)
                .parse(url.searchParams.get("page") ?? 0),
              z.coerce
                .number()
                .int()
                .min(1)
                .max(200)
                .parse(url.searchParams.get("pageSize") ?? 50),
              url.searchParams.get("filter") ?? "all",
            ),
          );
        if (action === "mapping" && method === "POST")
          return response(
            await deliveryQuoteImports.mapRows(db, actor, id, await body(req)),
          );
        if (action === "review" && method === "POST")
          return response(
            await deliveryQuoteImports.reviewRows(
              db,
              actor,
              id,
              await body(req),
            ),
          );
        if (action === "finalize" && method === "POST")
          return response(
            await deliveryQuoteImports.finalize(db, actor, id, await body(req)),
          );
        if (action === "reopen" && method === "POST")
          return response(
            await deliveryQuoteImports.reopen(db, actor, id, await body(req)),
          );
        if (action === "correction" && method === "POST")
          return response(
            await handover.correctDeliveryImport(
              db,
              actor,
              id,
              await body(req),
            ),
          );
        if (!action && method === "DELETE")
          return response(await deliveryQuoteImports.remove(db, actor, id));
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
      if (id === "quotation-settings") {
        if (method === "GET")
          return response(await quoteSettings.getSettings(db, actor));
        if (method === "PUT")
          return response(
            await quoteSettings.saveSettings(db, actor, await body(req)),
          );
        if (method === "POST" && action === "preview") {
          auth.requirePermission(actor, "SETTINGS_MANAGE");
          const data = await body(req),
            config = quoteSettings.quotationSettingsSchema.parse(
              data.quotation,
            );
          const logo =
            "data:image/svg+xml;base64," +
            (
              await fs.readFile(path.join(process.cwd(), "public", "logo.svg"))
            ).toString("base64");
          const sample = {
            number: config.prefix + "-PREVIEW",
            status: "DRAFT",
            created_at: new Date().toISOString(),
            customer: { name: "Sample customer / عميل تجريبي" },
            lines: [
              {
                partNumber: "AMT-SAMPLE",
                description: "Sample electrical item / صنف كهربائي تجريبي",
                unit: "pcs",
                price: calculate(
                  productInput.parse({
                    partNumber: "AMT-SAMPLE",
                    description: "Sample",
                    cost: "100",
                    markup: "0",
                    vat: settings.vat,
                  }),
                  { maxDiscount: "100", canOverride: false },
                  { quantity: "2", discount: "0", override: false, reason: "" },
                ),
              },
            ],
            totals: { subtotal: "0.00", vat: "0.00", total: "0.00" },
          };
          sample.totals = {
            subtotal: sample.lines[0].price.subtotal,
            vat: sample.lines[0].price.vatAmount,
            total: sample.lines[0].price.total,
          };
          return response({
            html: quotationHtml(
              sample,
              {
                ...settings,
                companyName: z.string().max(100).parse(data.companyName),
                companyArabic: z.string().max(100).parse(data.companyArabic),
                pdfUnitPrices: z
                  .enum(["BOTH", "EXCL", "INCL"])
                  .parse(data.pdfUnitPrices ?? settings.pdfUnitPrices),
                quotation: config,
              },
              logo,
            ),
          });
        }
      }
      auth.requirePermission(actor, "ADMIN_VIEW");
      if (id === "dashboard" && method === "GET")
        return response(
          await admin.dashboard(db, {
            minimumProtectedPage: z.coerce
              .number()
              .int()
              .min(0)
              .parse(url.searchParams.get("minimumProtectedPage") ?? 0),
            minimumProtectedPageSize: z.coerce
              .number()
              .int()
              .min(1)
              .max(200)
              .parse(url.searchParams.get("minimumProtectedPageSize") ?? 50),
          }),
        );
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
        const filters = z
          .object({
            productId: z.string().uuid().optional(),
            q: z.string().trim().max(160).default(""),
            source: z
              .enum(["ALL", "MANUAL", "IMPORT", "ROLLBACK"])
              .default("ALL"),
            sort: z.enum(["NEWEST", "OLDEST"]).default("NEWEST"),
          })
          .parse(Object.fromEntries(url.searchParams));
        const direction = filters.sort === "OLDEST" ? "ASC" : "DESC";
        return response(
          (
            await db.query(
              `SELECT h.*,p.part_number,p.description,u.name AS actor
               FROM price_history h
               JOIN products p ON p.id=h.product_id
               LEFT JOIN users u ON u.id=h.actor_id
               WHERE ($1::uuid IS NULL OR h.product_id=$1)
                 AND ($2='' OR p.part_number ILIKE '%'||$2||'%' OR p.description ILIKE '%'||$2||'%' OR COALESCE(u.name,'') ILIKE '%'||$2||'%' OR h.source ILIKE '%'||$2||'%')
                 AND ($3='ALL' OR h.source=$3)
               ORDER BY h.created_at ${direction},h.id ${direction}
               LIMIT 300`,
              [filters.productId ?? null, filters.q, filters.source],
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
