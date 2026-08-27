import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import { handle } from "../backend/api/router";
import { json } from "../backend/core/audit";
process.env.APP_ORIGIN = "http://localhost:18180";
process.env.SETUP_TOKEN = "integration-only-setup-token-not-production";
process.env.APP_RELEASE = "integration-release";
test("PostgreSQL-backed security, catalog, quotations, and imports", async (t) => {
  const db = await embedded();
  await migrate(db);
  let cookie = "",
    csrf = "";
  async function request(
    path: string,
    method = "GET",
    body?: any,
    expected = 200,
  ) {
    // The HTTP contract requires an explicit preview acceptance before confirmation.
    if (path.endsWith("/confirm") && method === "POST" && !body.token) {
      const preview = await request(
        path.replace(/\/confirm$/, "/preview-confirmation"),
        "POST",
        {},
      );
      body = { ...body, token: preview.data.token };
    }
    const res = await handle(
      new Request("http://localhost:18180/api/v1/" + path, {
        method,
        headers: {
          Origin: process.env.APP_ORIGIN!,
          Cookie: cookie,
          "X-CSRF-Token": csrf,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      db,
    );
    let data: any;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    assert.equal(res.status, expected, JSON.stringify(data));
    return { data, res };
  }
  await t.test(
    "Setup is token-protected and permanently single-use",
    async () => {
      await request(
        "setup",
        "POST",
        {
          token: "wrong",
          username: "jaleel@amt.com",
          password: "1234",
          name: "Administrator",
          companyName: "AMT Electric",
        },
        403,
      );
      await request("setup", "POST", {
        token: process.env.SETUP_TOKEN,
        username: "jaleel@amt.com",
        password: "1234",
        name: "Administrator",
        companyName: "AMT Electric",
      });
      const saved = (await one(db, "SELECT data FROM settings WHERE id=1"))!.data;
      assert.equal(saved.vat, "15");
      assert.equal(saved.quotePrefix, "QT");
      await request(
        "setup",
        "POST",
        {
          token: process.env.SETUP_TOKEN,
          username: "other",
          password: "1234",
          name: "Other",
          companyName: "AMT",
        },
        409,
      );
    },
  );
  await request(
    "auth/login",
    "POST",
    { username: "jaleel@amt.com", password: "wrong" },
    401,
  );
  const login = await request("auth/login", "POST", {
    username: "jaleel@amt.com",
    password: "1234",
  });
  cookie = login.res.headers.get("set-cookie")!.split(";")[0];
  let me = (await request("auth/me")).data;
  assert.equal(me.release, "integration-release");
  csrf = me.user.csrf;
  const adminCookie = cookie,
    adminCsrf = csrf,
    adminId = me.user.id;
  const base = {
    partNumber: "LC1D09M7",
    description: "Contactor 9A 220V",
    brand: "Schneider Electric",
    category: "Contactor",
    method: "COST_MARKUP",
    cost: "100",
    markup: "25",
    vat: "15",
    minimumEnabled: true,
    minimum: "110",
    aliases: ["OLD123"],
  };
  let productId = "",
    quoteId = "",
    staffId = "";
  await t.test(
    "Create product, enforce duplicates and alias collisions",
    async () => {
      productId = (await request("products", "POST", base)).data.id;
      await request(
        "products",
        "POST",
        { ...base, partNumber: " lc1d09m7 " },
        409,
      );
      await request(
        "products",
        "POST",
        { ...base, partNumber: "OLD123", aliases: [] },
        409,
      );
      await request(
        "products",
        "POST",
        { ...base, partNumber: "SECOND", aliases: ["OLD123"] },
        409,
      );
      assert.equal((await request("search?q=old123")).data[0].id, productId);
      assert.equal(
        (await request("search?q=LC1D")).data[0].masterIncl,
        "143.75",
      );
    },
  );
  await t.test("Create staff with restricted permissions", async () => {
      staffId = (
      await request("admin/users", "POST", {
        username: "sales@amt.com",
        name: "Counter Staff",
        role: "STAFF",
        password: "abcd",
        maxDiscount: "20",
      })
    ).data.id;
  });
  await t.test("Admin settings expose VAT and quotation prefix", async () => {
    const current = (await request("admin/settings")).data;
    const updated = (
      await request("admin/settings", "POST", {
        ...current,
        quotePrefix: "JAL",
        vat: "10",
      })
    ).data;
    assert.equal(updated.quotePrefix, "JAL");
    assert.equal(updated.vat, "10");
    const refreshed = (await request("admin/settings")).data;
    assert.equal(refreshed.quotePrefix, "JAL");
    assert.equal(refreshed.vat, "10");
  });
  await t.test("Reject CSRF and disallowed origins", async () => {
    const saved = csrf;
    csrf = "wrong";
    await request(
      "pricing",
      "POST",
      { productId, quantity: "1", discount: "0" },
      403,
    );
    csrf = saved;
    const res = await handle(
      new Request("http://localhost:18180/api/v1/auth/login", {
        method: "POST",
        headers: { Origin: "https://attacker.invalid" },
        body: "{}",
      }),
      db,
    );
    assert.equal(res.status, 403);
  });
  const staffLogin = await request("auth/login", "POST", {
    username: "sales@amt.com",
    password: "abcd",
  });
  cookie = staffLogin.res.headers.get("set-cookie")!.split(";")[0];
  csrf = (await request("auth/me")).data.user.csrf;
  const staffCookie = cookie,
    staffCsrf = csrf;
  await t.test(
    "Staff cannot retrieve confidential fields or admin endpoints",
    async () => {
      const results = (await request("search?q=LC1D")).data;
      for (const field of [
        "cost",
        "markup",
        "baseDiscount",
        "minimum",
        "method",
        "maxDiscount",
      ])
        assert.equal(field in results[0], false, field);
      await request("admin/users", "GET", undefined, 403);
      await request("products", "GET", undefined, 403);
      await request("admin/history", "GET", undefined, 403);
    },
  );
  const line = {
    productId,
    quantity: "1",
    discount: "20",
    override: false,
    reason: "",
  };
  await t.test(
    "Staff pricing clamps floor and rejects forged values and override",
    async () => {
      assert.equal(
        (await request("pricing", "POST", line)).data.finalExcl,
        "110.00",
      );
      await request("pricing", "POST", { ...line, finalExcl: "1" }, 400);
      await request(
        "pricing",
        "POST",
        { ...line, override: true, reason: "Attempted bypass" },
        400,
      );
      await request(
        "quotations",
        "POST",
        { customer: {}, lines: [{ ...line, price: "1" }] },
        400,
      );
    },
  );
  await t.test(
    "Save draft snapshots and enforce draft version conflicts",
    async () => {
      const q = (
        await request("quotations", "POST", {
          customer: { name: "Customer" },
          lines: [line],
        })
      ).data;
      quoteId = q.id;
      assert.equal(q.lines[0].price.finalExcl, "110.00");
      assert.equal(q.lines[0].price.maxDiscount, undefined);
      await request(
        "quotations/" + quoteId,
        "PUT",
        { customer: {}, lines: [line], version: 99 },
        409,
      );
    },
  );
  cookie = adminCookie;
  csrf = adminCsrf;
  await t.test(
    "Master update does not silently change saved draft",
    async () => {
      await request("products/" + productId, "PUT", {
        ...base,
        cost: "112",
        version: 1,
      });
      assert.equal(
        (await request("quotations/" + quoteId)).data.lines[0].price.masterExcl,
        "125.00",
      );
      await request(
        "products/" + productId,
        "PUT",
        { ...base, cost: "120", version: 1 },
        409,
      );
    },
  );
  cookie = staffCookie;
  csrf = staffCsrf;
  await t.test(
    "Issue review uses current prices and cannot be tampered with",
    async () => {
      const review = (
        await request("quotations/" + quoteId + "/review", "POST", {})
      ).data;
      assert.equal(review.after[0].price.masterExcl, "140.00");
      await request(
        "quotations/" + quoteId + "/issue",
        "POST",
        { token: "0".repeat(64) },
        409,
      );
      const q = (
        await request("quotations/" + quoteId + "/issue", "POST", {
          token: review.token,
        })
      ).data;
      assert.equal(q.status, "ISSUED");
      assert.equal(q.lines[0].price.finalExcl, "112.00");
      await request(
        "quotations/" + quoteId,
        "PUT",
        { customer: {}, lines: [line], version: q.version },
        409,
      );
    },
  );
  cookie = adminCookie;
  csrf = adminCsrf;
  await t.test(
    "Issued snapshots and VAT survive subsequent master/settings changes",
    async () => {
      await request("products/" + productId, "PUT", {
        ...base,
        cost: "120",
        vat: "10",
        version: 2,
      });
      const q = (await request("quotations/" + quoteId)).data;
      assert.equal(q.lines[0].price.masterExcl, "140.00");
      assert.equal(q.lines[0].price.vatRate, "15");
    },
  );
  await t.test(
    "Quote ownership enforced independently of knowing IDs",
    async () => {
      await request("admin/users", "POST", {
        username: "otherstaff@amt.com",
        name: "Other",
        role: "STAFF",
        password: "efgh",
      });
      const other = await request("auth/login", "POST", {
        username: "otherstaff@amt.com",
        password: "efgh",
      });
      cookie = other.res.headers.get("set-cookie")!.split(";")[0];
      csrf = (await request("auth/me")).data.user.csrf;
      await request("quotations/" + quoteId, "GET", undefined, 403);
      cookie = adminCookie;
      csrf = adminCsrf;
    },
  );
  const importId = randomUUID(),
    rowId = randomUUID();
  await db.query(
    "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id) VALUES($1,'supplier.csv','/nonexistent','EXCEL','AWAITING_REVIEW',$2)",
    [importId, adminId],
  );
  await db.query(
    "INSERT INTO import_rows(id,job_id,row_number,raw) VALUES($1,$2,1,$3)",
    [
      rowId,
      importId,
      json({
        CODE: "LC1D09M7",
        DESC: "Updated contactor",
        COST: "130",
        MIN: "110",
      }),
    ],
  );
  await t.test(
    "Import cannot publish until mapped, reviewed, and verified",
    async () => {
      await request(
        "imports/" + importId + "/confirm",
        "POST",
        { version: 1 },
        400,
      );
      await request("imports/" + importId + "/mapping", "POST", {
        mapping: {
          partNumber: "CODE",
          description: "DESC",
          cost: "COST",
          minimum: "MIN",
        },
        defaults: {
          method: "COST_MARKUP",
          markup: "25",
          vat: "15",
          minimumEnabled: true,
        },
        version: 1,
      });
      const j = (await request("imports/" + importId)).data;
      assert.equal(j.rows[0].duplicate_id, productId);
      await request("imports/" + importId + "/review", "POST", {
        rows: [{ id: rowId, decision: "UPDATE", verified: false }],
      });
      await request(
        "imports/" + importId + "/confirm",
        "POST",
        { version: 3 },
        400,
      );
      await request("imports/" + importId + "/review", "POST", {
        rows: [{ id: rowId, decision: "UPDATE", verified: true }],
      });
      await request("imports/" + importId + "/confirm", "POST", { version: 4 });
      assert.equal(
        (await request("search?q=LC1D")).data[0].masterExcl,
        "162.50",
      );
      await request("imports/" + importId + "/confirm", "POST", { version: 4 });
    },
  );
  await t.test(
    "Rollback restores previous values while retaining history",
    async () => {
      await request("imports/" + importId + "/rollback", "POST", {});
      assert.equal(
        (await request("search?q=LC1D")).data[0].masterExcl,
        "150.00",
      );
      assert.equal(
        (await one(
          db,
          "SELECT count(*) AS n FROM price_history WHERE product_id=$1",
          [productId],
        ))!.n,
        5,
      );
    },
  );
  await t.test(
    "Disabling user revokes existing sessions and blocks login",
    async () => {
      await request("admin/users/" + staffId, "POST", {
        username: "sales@amt.com",
        name: "Counter Staff",
        role: "STAFF",
        maxDiscount: "20",
        disabled: true,
      });
      cookie = staffCookie;
      csrf = staffCsrf;
      await request("auth/me", "GET", undefined, 401);
      await request(
        "auth/login",
        "POST",
        { username: "sales@amt.com", password: "abcd" },
        401,
      );
      cookie = adminCookie;
      csrf = adminCsrf;
    },
  );
  await t.test(
    "Draft retries are idempotent and changed retry inputs are rejected",
    async () => {
      const requestId = randomUUID(),
        payload = {
          requestId,
          customer: {},
          lines: [{ ...line, discount: "0" }],
        };
      const a = (await request("quotations", "POST", payload)).data,
        b = (await request("quotations", "POST", payload)).data;
      assert.equal(a.id, b.id);
      await request(
        "quotations",
        "POST",
        { ...payload, customer: { name: "Changed after lost response" } },
        409,
      );
    },
  );
  await t.test("Review acceptance expires when prices change", async () => {
    const p = (
      await request("products", "POST", {
        ...base,
        partNumber: "REVIEW-TEST",
        aliases: [],
      })
    ).data;
    const q = (
      await request("quotations", "POST", {
        customer: {},
        lines: [{ ...line, productId: p.id }],
      })
    ).data;
    const review = (await request("quotations/" + q.id + "/review", "POST", {}))
      .data;
    await request("products/" + p.id, "PUT", {
      ...base,
      partNumber: "REVIEW-TEST",
      aliases: [],
      cost: "105",
      version: 1,
    });
    await request(
      "quotations/" + q.id + "/issue",
      "POST",
      { token: review.token },
      409,
    );
  });
  await t.test(
    "Bulk minimum can exceed 100 SAR and preview does not mutate data",
    async () => {
      const before = (await request("products?q=LC1D")).data[0];
      const payload = {
        items: [{ id: productId, version: before.version }],
        operation: "MINIMUM",
        value: "120",
        confirm: false,
      };
      await request("products/bulk", "POST", payload);
      assert.equal(
        (await request("products?q=LC1D")).data[0].minimum,
        before.minimum,
      );
      await request("products/bulk", "POST", { ...payload, confirm: true });
      assert.equal(
        (await request("products?q=LC1D")).data[0].minimum,
        "120.00",
      );
    },
  );
  await t.test(
    "Import detects duplicates within the file atomically",
    async () => {
      const iid = randomUUID();
      await db.query(
        "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id) VALUES($1,'double.csv','/none','EXCEL','AWAITING_REVIEW',$2)",
        [iid, adminId],
      );
      const ids = [randomUUID(), randomUUID()];
      for (let i = 0; i < 2; i++)
        await db.query(
          "INSERT INTO import_rows(id,job_id,row_number,raw) VALUES($1,$2,$3,$4)",
          [
            ids[i],
            iid,
            i + 1,
            json({ CODE: "DOUBLE", DESC: "Duplicate row", COST: "100" }),
          ],
        );
      await request("imports/" + iid + "/mapping", "POST", {
        mode: "CREATE_UPDATE",
        mapping: { partNumber: "CODE", description: "DESC", cost: "COST" },
        defaults: { method: "COST_MARKUP", markup: "25" },
        version: 1,
      });
      await request("imports/" + iid + "/review", "POST", {
        rows: ids.map((id) => ({ id, decision: "UPDATE", verified: true })),
      });
      await request("imports/" + iid + "/confirm", "POST", { version: 3 }, 409);
      assert.equal((await request("search?q=DOUBLE")).data.length, 0);
      await request("imports/" + iid + "/review", "POST", {
        rows: [{ id: ids[1], decision: "SKIP", verified: false }],
      });
      await request("imports/" + iid + "/confirm", "POST", { version: 4 });
      const p = (await request("products?q=DOUBLE")).data[0];
      await request("products/" + p.id, "PUT", {
        ...p,
        id: undefined,
        cost: "110",
      });
      await request("imports/" + iid + "/rollback", "POST", {}, 409);
      assert.equal(
        (await request("search?q=DOUBLE")).data[0].masterExcl,
        "137.50",
      );
    },
  );
  await t.test(
    "Exports and backups are queued, not executed in counter requests",
    async () => {
      const exportJob = (await request("exports", "POST", {})).data;
      assert.equal(
        (await request("exports/" + exportJob.id)).data.status,
        "PENDING",
      );
      const backup = (await request("admin/backups", "POST", {})).data;
      assert.equal(
        (await one(db, "SELECT status FROM backups WHERE id=$1", [backup.id]))!
          .status,
        "PENDING",
      );
    },
  );
  await t.test(
    "Request limits reject oversized JSON and multipart before parsing",
    async () => {
      await request(
        "pricing",
        "POST",
        { padding: "x".repeat(2 * 1024 * 1024) },
        413,
      );
      const res = await handle(
        new Request("http://localhost:18180/api/v1/imports", {
          method: "POST",
          headers: {
            Origin: process.env.APP_ORIGIN!,
            Cookie: cookie,
            "X-CSRF-Token": csrf,
            "Content-Type": "multipart/form-data; boundary=test",
            "Content-Length": String(22 * 1024 * 1024),
          },
          body: "--test--",
        }),
        db,
      );
      assert.equal(res.status, 413);
    },
  );
  await t.test(
    "Audit includes pricing/import actions but not password hashes",
    async () => {
      const rows = (await request("admin/audit")).data;
      assert(rows.some((r: any) => r.action === "EXCEL_IMPORT"));
      assert(rows.some((r: any) => r.action === "IMPORT_ROLLBACK"));
      assert(!JSON.stringify(rows).includes("password_hash"));
    },
  );
});
