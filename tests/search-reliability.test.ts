import test from "node:test";
import assert from "node:assert/strict";
import { search } from "../backend/products/service";

const actor: any = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Search tester",
  role: "STAFF",
  permissions: ["PRODUCT_VIEW"],
  maxDiscount: "100",
};

test("one-character workspace search stays on indexed part and alias matching", async () => {
  const statements: string[] = [];
  const db: any = {
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [] };
    },
  };
  assert.deepEqual(await search(db, actor, "X", {}, false), []);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /part_ranked/);
  assert.doesNotMatch(statements[0], /text_ranked/);
});

test("two-character workspace search adds description and keyword fallback", async () => {
  const statements: string[] = [];
  const db: any = {
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [] };
    },
  };
  assert.deepEqual(await search(db, actor, "XM", {}, false), []);
  assert.equal(statements.length, 2);
  assert.match(statements[1], /text_ranked/);
});
