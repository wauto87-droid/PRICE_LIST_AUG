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
          customer: { name: "Customer", notes: "Call before delivery" },
          lines: [line],
        })
      ).data;
      quoteId = q.id;
      assert.equal(q.lines[0].price.finalExcl, "110.00");
      assert.equal(q.lines[0].price.maxDiscount, undefined);
      assert.equal(q.customer.notes, "Call before delivery");
      assert.equal(
        (await request("quotations/" + quoteId)).data.customer.notes,
        "Call before delivery",
      );
      await request(
        "quotations/" + quoteId,
        "PUT",
        { customer: {}, lines: [line], version: 99 },
        409,
      );
    },
  );
  await t.test(
    "Below-minimum discount requests persist for admin review with history and quotation context",
    async () => {
      await request(
        "discount-requests",
        "POST",
        {
          productId,
          sellingLevel: "END_CUSTOMER",
          quantity: "2",
          discount: "20",
          reason: "",
        },
        400,
      );
      const rejected = (
        await request("discount-requests", "POST", {
          productId,
          sellingLevel: "END_CUSTOMER",
          quantity: "2",
          discount: "20",
          reason: "Need approval for a project customer",
        })
      ).data;
      const approved = (
        await request("discount-requests", "POST", {
          productId,
          sellingLevel: "END_CUSTOMER",
          quantity: "3",
          discount: "18",
          reason: "Repeat customer request",
        })
      ).data;
      await request("discount-requests", "GET", undefined, 403);
      cookie = adminCookie;
      csrf = adminCsrf;
      const pending = (await request("discount-requests")).data;
      assert.equal(pending.counts.pending, 2);
      const detail = (await request("discount-requests/" + rejected.id)).data;
      assert.equal(detail.reason, "Need approval for a project customer");
      assert.equal(detail.quotations[0].id, quoteId);
      assert(detail.history.length >= 1);
      await request("discount-requests/" + rejected.id + "/reject", "POST", {
        note: "Below protected floor for this order",
      });
      await request("discount-requests/" + approved.id + "/approve", "POST", {
        note: "Approved for strategic account",
      });
      const rejectedDetail = (
        await request("discount-requests/" + rejected.id)
      ).data;
      const approvedDetail = (
        await request("discount-requests/" + approved.id)
      ).data;
      assert.equal(rejectedDetail.status, "REJECTED");
      assert.equal(rejectedDetail.decisionNote, "Below protected floor for this order");
      assert.equal(rejectedDetail.events.length, 2);
      assert.equal(approvedDetail.status, "APPROVED");
      assert.equal(approvedDetail.decisionNote, "Approved for strategic account");
      const afterReview = (await request("discount-requests")).data;
      assert.equal(afterReview.counts.pending, 0);
      assert.equal(afterReview.counts.approved, 1);
      assert.equal(afterReview.counts.rejected, 1);
      cookie = staffCookie;
      csrf = staffCsrf;
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
  await t.test("Import detail API pages rows and reports totals", async () => {
    const pagedImportId = randomUUID();
    await db.query(
      "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id,summary) VALUES($1,'paged.csv','/nonexistent','EXCEL','AWAITING_REVIEW',$2,$3)",
      [
        pagedImportId,
        adminId,
        json({ rows: 120, columns: ["CODE", "DESC", "Activity"] }),
      ],
    );
    for (let i = 0; i < 120; i++)
      await db.query(
        "INSERT INTO import_rows(id,job_id,row_number,raw,decision,verified,errors) VALUES($1,$2,$3,$4,'REVIEW',false,'[]'::jsonb)",
        [
          randomUUID(),
          pagedImportId,
          i + 1,
          json({
            CODE: `ROW-${i + 1}`,
            DESC: `Description ${i + 1}`,
            Activity: i % 2 === 0 ? "PPCCB" : "LIGHTING",
          }),
        ],
      );
    const pageTwo = (
      await request("imports/" + pagedImportId + "?page=1&pageSize=50")
    ).data;
    assert.equal(pageTwo.totalRows, 120);
    assert.equal(pageTwo.totalPages, 3);
    assert.equal(pageTwo.page, 1);
    assert.equal(pageTwo.rows.length, 50);
    assert.equal(pageTwo.rows[0].row_number, 51);
    assert.deepEqual(pageTwo.groupValues, ["LIGHTING", "PPCCB"]);
    assert.equal(pageTwo.reviewStats.unverifiedRows, 120);
  });
  await t.test("Admin product list pages results and exposes full-match selection", async () => {
    for (let i = 0; i < 55; i++)
      await request("products", "POST", {
        ...base,
        partNumber: `PAGE-${String(i).padStart(3, "0")}`,
        description: `Paged product ${i}`,
        aliases: [],
      });
    const pageOne = (await request("products?q=PAGE")).data;
    const pageTwo = (await request("products?q=PAGE&page=1&pageSize=50")).data;
    assert.equal(pageOne.totalRows, 55);
    assert.equal(pageOne.totalPages, 2);
    assert.equal(pageOne.items.length, 50);
    assert.equal(pageOne.selectableItems.length, 55);
    assert.equal(pageTwo.page, 1);
    assert.equal(pageTwo.items.length, 5);
  });
  await t.test("Product search matches partial description text", async () => {
    const results = (await request("search?q=Contactor 9A")).data;
    assert.equal(results[0].partNumber, "LC1D09M7");
  });
  await t.test(
    "Product search prioritizes exact and prefix part matches while supporting contains fallback",
    async () => {
      for (const product of [
        {
          ...base,
          partNumber: "56116",
          description: "Exact match test part",
          aliases: [],
        },
        {
          ...base,
          partNumber: "56116X",
          description: "Prefix match test part",
          aliases: [],
        },
        {
          ...base,
          partNumber: "EZ6F56116",
          description: "Contains match test part",
          aliases: ["OLD-56116"],
        },
        {
          ...base,
          partNumber: "DESC-ONLY-PANEL",
          description: "Panel part 56116 from description only",
          aliases: [],
        },
      ])
        await request("products", "POST", product);
      const ranked = (await request("search?q=56116")).data;
      assert.equal(ranked[0].partNumber, "56116");
      assert.equal(ranked[1].partNumber, "56116X");
      assert.equal(ranked[2].partNumber, "EZ6F56116");
      const adminRanked = (await request("products?q=56116")).data.items;
      assert.equal(adminRanked[0].partNumber, "56116");
      assert.equal(adminRanked[1].partNumber, "56116X");
      assert.equal(adminRanked[2].partNumber, "EZ6F56116");
      const aliasRanked = (await request("search?q=OLD-56116")).data;
      assert.equal(aliasRanked[0].partNumber, "EZ6F56116");
      const fallback = (await request("search?q=Panel part 56116")).data;
      assert.equal(fallback[0].partNumber, "DESC-ONLY-PANEL");
    },
  );
  await t.test("Lookup search returns a lean payload with pricing-ready fields", async () => {
    const results = (await request("search?q=LC1D09M7")).data;
    assert.equal(results[0].partNumber, "LC1D09M7");
    assert.equal(results[0].defaultLevel, "END_CUSTOMER");
    assert.equal(Array.isArray(results[0].sellingLevels), true);
    assert.equal(typeof results[0].sellingLevels[0].masterExcl, "string");
    assert.equal(typeof results[0].sellingLevels[0].masterIncl, "string");
    assert.equal("version" in results[0], false);
    assert.equal("aliases" in results[0], false);
    assert.equal("keywords" in results[0], false);
    assert.equal("active" in results[0], false);
  });
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
      const before = (await request("products?q=LC1D")).data.items[0];
      const payload = {
        items: [{ id: productId, version: before.version }],
        operation: "MINIMUM",
        value: "120",
        confirm: false,
      };
      await request("products/bulk", "POST", payload);
      assert.equal(
        (await request("products?q=LC1D")).data.items[0].minimum,
        before.minimum,
      );
      await request("products/bulk", "POST", { ...payload, confirm: true });
      assert.equal(
        (await request("products?q=LC1D")).data.items[0].minimum,
        "120.00",
      );
    },
  );
  await t.test(
    "Remove minimum fully disables protection and dashboard excludes zero floors",
    async () => {
      const protectedBefore = (
        await request("admin/dashboard")
      ).data.products.protected;
      const before = (await request("products?q=LC1D")).data.items[0];
      await request("products/bulk", "POST", {
        items: [{ id: before.id, version: before.version }],
        operation: "REMOVE_MINIMUM",
        confirm: true,
      });
      const after = (await request("products?q=LC1D")).data.items[0];
      assert.equal(after.minimumEnabled, false);
      assert.equal(after.minimum, "0.00");
      const dashboardAfter = (await request("admin/dashboard")).data;
      assert.equal(
        dashboardAfter.minimumProtected.some((item: any) => item.id === before.id),
        false,
      );
      assert.equal(
        Number(dashboardAfter.products.protected) <= Number(protectedBefore),
        true,
      );
      await request("products/" + before.id, "PUT", {
        ...base,
        version: after.version,
        minimumEnabled: true,
        minimum: "120",
      });
    },
  );
  await t.test("Bulk archive and reactivate update product status", async () => {
    const before = (await request("products?q=LC1D")).data.items[0];
    await request("products/bulk", "POST", {
      items: [{ id: before.id, version: before.version }],
      operation: "ARCHIVE",
      confirm: true,
    });
    const archived = (await request("products?q=LC1D")).data.items[0];
    assert.equal(archived.active, false);
    await request("products/bulk", "POST", {
      items: [{ id: archived.id, version: archived.version }],
      operation: "REACTIVATE",
      confirm: true,
    });
    const restored = (await request("products?q=LC1D")).data.items[0];
    assert.equal(restored.active, true);
  });
  await t.test("Bulk delete removes unused products", async () => {
    const created = (
      await request("products", "POST", {
        ...base,
        partNumber: "DELETE-ME",
        aliases: [],
      })
    ).data;
    await request("products/bulk", "POST", {
      items: [{ id: created.id, version: created.version }],
      operation: "DELETE",
      confirm: true,
    });
    assert.equal((await request("products?q=DELETE-ME")).data.items.length, 0);
  });
  await t.test("Bulk delete accepts integer-like versions and reports item validation errors", async () => {
    const created = (
      await request("products", "POST", {
        ...base,
        partNumber: "DELETE-STRING-VERSION",
        aliases: [],
      })
    ).data;
    await request("products/bulk", "POST", {
      items: [{ id: created.id, version: String(created.version) }],
      operation: "DELETE",
      confirm: true,
    });
    assert.equal(
      (await request("products?q=DELETE-STRING-VERSION")).data.items.length,
      0,
    );
    const invalid = await request(
      "products/bulk",
      "POST",
      {
        items: [{ id: created.id, version: "abc" }],
        operation: "DELETE",
        confirm: true,
      },
      400,
    );
    assert.equal(invalid.data.error, "Please correct the highlighted values");
    assert(
      invalid.data.details.some(
        (detail: any) =>
          detail.path?.join(".") === "items.0.version" &&
          /whole number/i.test(detail.message),
      ),
      JSON.stringify(invalid.data.details),
    );
  });
  await t.test("Bulk delete blocks products used in quotations", async () => {
    const p = (
      await request("products", "POST", {
        ...base,
        partNumber: "DELETE-BLOCKED",
        aliases: [],
      })
    ).data;
    await request("quotations", "POST", {
      customer: {},
      lines: [{ ...line, productId: p.id }],
    });
    await request(
      "products/bulk",
      "POST",
      {
        items: [{ id: p.id, version: p.version }],
        operation: "DELETE",
        confirm: true,
      },
      409,
    );
  });
  await t.test("Bulk archive supports large matched selections up to 5000 items", async () => {
    for (let i = 0; i < 1005; i++)
      await request("products", "POST", {
        ...base,
        partNumber: `BULK-LARGE-${String(i).padStart(4, "0")}`,
        description: `Large bulk product ${i}`,
        aliases: [],
      });
    const matched = (await request("products?q=BULK-LARGE")).data;
    assert.equal(matched.selectableItems.length, 1005);
    await request("products/bulk", "POST", {
      items: matched.selectableItems,
      operation: "ARCHIVE",
      confirm: true,
    });
    const archived = (await request("products?q=BULK-LARGE")).data;
    assert(archived.items.every((item: any) => item.active === false));
  });
  await t.test("Bulk selection can load the next matched batch without repeating the first", async () => {
    const firstBatch = (await request("products?q=BULK-LARGE&selectionOffset=0")).data;
    const nextBatch = (await request("products?q=BULK-LARGE&selectionOffset=500")).data;
    assert.equal(firstBatch.selectionOffset, 0);
    assert.equal(nextBatch.selectionOffset, 500);
    assert.equal(firstBatch.selectableItems.length, 1005);
    assert.equal(nextBatch.selectableItems.length, 505);
    assert.notEqual(
      firstBatch.selectableItems[0]?.id,
      nextBatch.selectableItems[0]?.id,
    );
    assert.equal(nextBatch.selectionHasMore, false);
  });
  await t.test(
    "Import mapping accepts integer-like versions and reports targeted validation details",
    async () => {
      const iid = randomUUID();
      await db.query(
        "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id) VALUES($1,'mapping.csv','/none','EXCEL','AWAITING_REVIEW',$2)",
        [iid, adminId],
      );
      await db.query(
        "INSERT INTO import_rows(id,job_id,row_number,raw) VALUES($1,$2,1,$3)",
        [
          randomUUID(),
          iid,
          json({ CODE: "MAP-STRING-VERSION", DESC: "Mapped row", COST: "50" }),
        ],
      );
      await request("imports/" + iid + "/mapping", "POST", {
        mapping: { partNumber: "CODE", description: "DESC", cost: "COST" },
        defaults: { method: "COST_MARKUP", markup: "25" },
        version: "1",
      });
      const mapped = (await request("imports/" + iid)).data;
      assert.equal(mapped.rows[0].proposed.partNumber, "MAP-STRING-VERSION");
      const invalid = await request(
        "imports/" + iid + "/mapping",
        "POST",
        {
          mapping: { description: "DESC" },
          defaults: { method: "COST_MARKUP", markup: "25" },
          version: 2,
        },
        400,
      );
      assert.equal(
        invalid.data.error,
        "Map the part number column before validating the import",
      );
      const malformed = await request(
        "imports/" + iid + "/mapping",
        "POST",
        {
          mapping: { partNumber: "CODE" },
          defaults: { method: "COST_MARKUP", markup: "25" },
          version: "not-a-number",
        },
        400,
      );
      assert.equal(malformed.data.error, "Please correct the highlighted values");
      assert(
        malformed.data.details.some(
          (detail: any) =>
            detail.path?.join(".") === "version" &&
            /number|nan|whole number/i.test(detail.message),
        ),
        JSON.stringify(malformed.data.details),
      );
    },
  );
  await t.test(
    "Auto-import accepts integer-like versions and skips invalid rows",
    async () => {
      const iid = randomUUID();
      await db.query(
        "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id,mode) VALUES($1,'auto.csv','/none','EXCEL','AWAITING_REVIEW',$2,'CREATE_UPDATE')",
        [iid, adminId],
      );
      const validId = randomUUID();
      const invalidId = randomUUID();
      await db.query(
        "INSERT INTO import_rows(id,job_id,row_number,raw,proposed,errors,decision,verified,duplicate_id,expected_version) VALUES($1,$2,1,$3,$4,'[]'::jsonb,'REVIEW',false,null,null)",
        [
          validId,
          iid,
          json({ CODE: "AUTO-IMPORT-OK" }),
          json({
            ...base,
            partNumber: "AUTO-IMPORT-OK",
            aliases: [],
          }),
        ],
      );
      await db.query(
        "INSERT INTO import_rows(id,job_id,row_number,raw,proposed,errors,decision,verified,duplicate_id,expected_version) VALUES($1,$2,2,$3,$4,$5,'REVIEW',false,null,null)",
        [
          invalidId,
          iid,
          json({ CODE: "" }),
          json({ description: "Broken row" }),
          json(["partNumber: Invalid input"]),
        ],
      );
      await request("imports/" + iid + "/auto-confirm", "POST", {
        version: "1",
      });
      const imported = (await request("imports/" + iid)).data;
      assert.equal(imported.status, "IMPORTED");
      assert.equal((await request("products?q=AUTO-IMPORT-OK")).data.items.length, 1);
    },
  );
  await t.test(
    "Quick import summary accepts part number plus price, imports EZ9F56116, and keeps invalid rows visible",
    async () => {
      const iid = randomUUID();
      await db.query(
        "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id,mode) VALUES($1,'supplier-quick.xlsx','/none','EXCEL','AWAITING_REVIEW',$2,'CREATE_UPDATE')",
        [iid, adminId],
      );
      const rows = [
        {
          "Part Reference": "EZ9F56116",
          "Local Description": "EASY9 MCB 1P 16A C 6000A 230V MINIATURE",
          Activity: "PPCFD",
          "Public Pricelist": "26.70",
        },
        {
          "Part Reference": "QUICK-NO-DESC",
          "Local Description": "",
          Activity: "PPCFD",
          "Public Pricelist": "88.00",
        },
        {
          "Part Reference": "QUICK-NO-PRICE",
          "Local Description": "Missing price",
          Activity: "PPCFD",
          "Public Pricelist": "",
        },
        {
          "Part Reference": "",
          "Local Description": "Missing part",
          Activity: "PPCFD",
          "Public Pricelist": "15.00",
        },
      ];
      for (let i = 0; i < rows.length; i++)
        await db.query(
          "INSERT INTO import_rows(id,job_id,row_number,raw) VALUES($1,$2,$3,$4)",
          [randomUUID(), iid, i + 1, json(rows[i])],
        );
      await request("imports/" + iid + "/mapping", "POST", {
        mapping: {
          partNumber: "Part Reference",
          description: "Local Description",
          listPrice: "Public Pricelist",
        },
        defaults: {
          method: "LIST_DISCOUNT",
          baseDiscount: "0",
          vat: "15",
        },
        version: 1,
        mode: "CREATE_UPDATE",
        quickImport: true,
      });
      const staged = (await request("imports/" + iid)).data;
      assert.equal(staged.quickStats.validRows, 2);
      assert.equal(staged.quickStats.invalidRows, 2);
      assert.equal(staged.rows[0].proposed.partNumber, "EZ9F56116");
      assert.equal(staged.rows[1].proposed.description, "QUICK-NO-DESC");
      await request("imports/" + iid + "/auto-confirm", "POST", {
        version: 2,
      });
      const imported = (await request("imports/" + iid)).data;
      assert.equal(imported.status, "IMPORTED");
      assert.equal(imported.quickStats.invalidRows, 2);
      assert.equal(imported.rows[2].decision, "SKIP");
      assert.equal(imported.rows[3].decision, "SKIP");
      const repairPageOne = (
        await request("imports/" + iid + "?rowView=repair&page=0&pageSize=1")
      ).data;
      const repairPageTwo = (
        await request("imports/" + iid + "?rowView=repair&page=1&pageSize=1")
      ).data;
      assert.equal(repairPageOne.rowView, "repair");
      assert.equal(repairPageOne.totalRows, 4);
      assert.equal(repairPageOne.filteredRows, 2);
      assert.equal(repairPageOne.rowViewCounts.repairRows, 2);
      assert.equal(repairPageOne.totalPages, 2);
      assert.equal(repairPageOne.rows[0].row_number, 3);
      assert.equal(repairPageTwo.rows[0].row_number, 4);
      assert.equal((await request("products?q=EZ9F56116")).data.items.length, 1);
      const noDesc = (await request("products?q=QUICK-NO-DESC")).data.items;
      assert.equal(noDesc.length, 1);
      assert.equal(noDesc[0].description, "QUICK-NO-DESC");
      assert.equal((await request("products?q=QUICK-NO-PRICE")).data.items.length, 0);
    },
  );
  await t.test(
    "Bulk review select-all applies across all import pages",
    async () => {
      const iid = randomUUID();
      await db.query(
        "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id,mode,summary) VALUES($1,'bulk-review.csv','/none','EXCEL','AWAITING_REVIEW',$2,'CREATE_UPDATE',$3)",
        [iid, adminId, json({ rows: 120, columns: ["CODE"] })],
      );
      for (let i = 0; i < 120; i++)
        await db.query(
          "INSERT INTO import_rows(id,job_id,row_number,raw,proposed,errors,decision,verified) VALUES($1,$2,$3,$4,$5,$6,'REVIEW',false)",
          [
            randomUUID(),
            iid,
            i + 1,
            json({ CODE: `BULK-${i + 1}` }),
            json({
              ...base,
              partNumber: `BULK-${i + 1}`,
              description: `Bulk row ${i + 1}`,
              aliases: [],
            }),
            json(i % 3 === 0 ? ["Bad row"] : []),
          ],
        );
      await request("imports/" + iid + "/bulk-review", "POST", {
        version: 1,
        action: "SELECT_ALL",
      });
      const paged = (await request("imports/" + iid + "?page=2&pageSize=50")).data;
      assert.equal(paged.page, 2);
      assert.equal(paged.rows[0].row_number, 101);
      assert.equal(paged.rows[0].decision, "UPDATE");
      assert.equal(paged.rows[0].verified, true);
      assert.equal(paged.rows[2].row_number, 103);
      assert.equal(paged.rows[2].decision, "SKIP");
      assert.equal(paged.rows[2].verified, false);
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
      const p = (await request("products?q=DOUBLE")).data.items[0];
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
      assert(
        await one(
          db,
          "SELECT 1 AS ok FROM audit_logs WHERE action='EXCEL_IMPORT' LIMIT 1",
        ),
      );
      assert(
        await one(
          db,
          "SELECT 1 AS ok FROM audit_logs WHERE action='IMPORT_ROLLBACK' LIMIT 1",
        ),
      );
      assert(!JSON.stringify(rows).includes("password_hash"));
    },
  );
});
