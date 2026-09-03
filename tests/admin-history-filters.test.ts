import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { authenticate, login, sessionCookie, setup } from "../backend/auth/service";
import { embedded, migrate } from "../backend/core/db";
import { handle } from "../backend/api/router";

test("Price history search, source filters, and date sorting", async () => {
  process.env.SETUP_TOKEN = "admin-history-filters-setup-token-123";
  process.env.APP_ORIGIN = "http://localhost:18180";
  const db = await embedded();
  try {
    await migrate(db);
    await setup(db, {
      token: process.env.SETUP_TOKEN,
      username: "history-admin",
      password: "History-admin-password-123",
      name: "History Admin",
      companyName: "AMT Electric",
    });
    const auth = await login(db, {
      username: "history-admin",
      password: "History-admin-password-123",
    });
    const cookie = sessionCookie(auth.token).split(";")[0];
    const actor = await authenticate(
      db,
      new Request("http://localhost:18180", { headers: { Cookie: cookie } }),
    );
    const records = [
      ["MANUAL-RELAY", "Manual relay", "MANUAL", "2026-09-01T08:00:00Z"],
      ["IMPORT-CONTACTOR", "Imported contactor", "IMPORT", "2026-09-02T08:00:00Z"],
      ["ROLLBACK-FUSE", "Restored fuse", "ROLLBACK", "2026-09-03T08:00:00Z"],
    ];
    const productIds: string[] = [];
    for (const [partNumber, description, source, createdAt] of records) {
      const productId = randomUUID();
      productIds.push(productId);
      await db.query(
        "INSERT INTO products(id,part_number,normalized_part,description,quantity_precision) VALUES($1,$2,$3,$4,0)",
        [productId, partNumber, partNumber, description],
      );
      await db.query(
        "INSERT INTO price_history(id,product_id,before_value,after_value,actor_id,source,resulting_version,created_at) VALUES($1,$2,NULL,$3,$4,$5,1,$6)",
        [
          randomUUID(),
          productId,
          JSON.stringify({ partNumber, description }),
          actor.id,
          source,
          createdAt,
        ],
      );
    }
    const request = async (query: string) => {
      const response = await handle(
        new Request(`http://localhost:18180/api/v1/admin/history?${query}`, {
          headers: { Origin: process.env.APP_ORIGIN!, Cookie: cookie },
        }),
        db,
      );
      assert.equal(response.status, 200);
      return response.json() as Promise<any[]>;
    };

    assert.equal((await request("q=CONTACTOR")).at(0).source, "IMPORT");
    assert.equal((await request("q=History%20Admin")).length, 3);
    assert.equal((await request("q=rollback")).at(0).source, "ROLLBACK");
    assert.equal((await request("source=IMPORT")).at(0).part_number, "IMPORT-CONTACTOR");
    assert.equal(
      (await request(`productId=${productIds[0]}`)).at(0).part_number,
      "MANUAL-RELAY",
    );
    assert.equal((await request("sort=OLDEST")).at(0).source, "MANUAL");
    assert.equal((await request("sort=NEWEST")).at(0).source, "ROLLBACK");
  } finally {
    await db.close?.();
  }
});
