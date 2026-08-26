import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionData, validateAdminData } from "../frontend/admin-data";
test("Admin never renders dashboard or stale responses as a brands array", () => {
  const dashboard = {
    section: "dashboard",
    payload: { products: {}, quotes: {}, imports: {} },
  };
  for (const section of [
    "brands",
    "categories",
    "products",
    "users",
    "roles",
    "history",
    "audit",
    "backups",
    "settings",
  ])
    assert.equal(sectionData(dashboard, section), null);
  assert.equal(
    sectionData({ section: "brands", payload: [] }, "dashboard"),
    null,
  );
  assert.deepEqual(
    sectionData({ section: "brands", payload: [] }, "brands"),
    [],
  );
});
test("Admin validates each endpoint shape before map or nested property access", () => {
  for (const section of [
    "brands",
    "categories",
    "products",
    "users",
    "history",
    "audit",
    "backups",
  ]) {
    assert.deepEqual(validateAdminData(section, []), []);
    for (const wrong of [null, {}, { roles: [] }, "error"])
      assert.throws(() => validateAdminData(section, wrong), /Unexpected/);
  }
  assert.throws(() => validateAdminData("dashboard", []));
  assert.throws(() => validateAdminData("dashboard", {}));
  assert.throws(() => validateAdminData("roles", { roles: [] }));
  assert.deepEqual(validateAdminData("roles", { roles: [], permissions: [] }), {
    roles: [],
    permissions: [],
  });
  assert.throws(() => validateAdminData("settings", []));
});
