import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionData, validateAdminData } from "../frontend/admin-data";
test("Admin never renders dashboard or stale responses as a brands array", () => {
  const dashboard = {
    section: "dashboard",
    payload: {
      products: {},
      quotes: {},
      imports: {},
      recentImports: [],
      importErrors: [],
      duplicateRows: [],
      minimumProtected: [],
      minimumProtectedSelectionItems: [],
      minimumProtectedPage: 0,
      minimumProtectedPageSize: 50,
      minimumProtectedTotalRows: 0,
      minimumProtectedTotalPages: 1,
      minimumProtectedHasMore: false,
      minimumProtectedSelectionOffset: 0,
      minimumProtectedSelectionHasMore: false,
      minimumProtectedSelectionLimitReached: false,
      updatedTodayItems: [],
      draftQuotations: [],
      issuedTodayItems: [],
    },
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
  for (const section of ["brands", "categories", "users", "history", "audit", "backups"]) {
    assert.deepEqual(validateAdminData(section, []), []);
    for (const wrong of [null, {}, { roles: [] }, "error"])
      assert.throws(() => validateAdminData(section, wrong), /Unexpected/);
  }
  assert.deepEqual(
    validateAdminData("products", {
      items: [],
      selectableItems: [],
      page: 0,
      pageSize: 50,
      totalRows: 0,
      totalPages: 1,
      hasMore: false,
      minimumFilter: "ALL",
      statusFilter: "ALL",
      methodFilter: "ALL",
      selectionOffset: 0,
      selectionHasMore: false,
      selectionLimitReached: false,
    }),
    {
      items: [],
      selectableItems: [],
      page: 0,
      pageSize: 50,
      totalRows: 0,
      totalPages: 1,
      hasMore: false,
      minimumFilter: "ALL",
      statusFilter: "ALL",
      methodFilter: "ALL",
      selectionOffset: 0,
      selectionHasMore: false,
      selectionLimitReached: false,
    },
  );
  for (const wrong of [[], null, {}, { items: [] }, "error"])
    assert.throws(() => validateAdminData("products", wrong), /Unexpected/);
  assert.throws(() => validateAdminData("dashboard", []));
  assert.throws(() => validateAdminData("dashboard", {}));
  assert.deepEqual(
    validateAdminData("dashboard", {
      products: {},
      quotes: {},
      imports: {},
      recentImports: [],
      importErrors: [],
      duplicateRows: [],
      minimumProtected: [],
      minimumProtectedSelectionItems: [],
      minimumProtectedPage: 0,
      minimumProtectedPageSize: 50,
      minimumProtectedTotalRows: 0,
      minimumProtectedTotalPages: 1,
      minimumProtectedHasMore: false,
      minimumProtectedSelectionOffset: 0,
      minimumProtectedSelectionHasMore: false,
      minimumProtectedSelectionLimitReached: false,
      updatedTodayItems: [],
      draftQuotations: [],
      issuedTodayItems: [],
    }),
    {
      products: {},
      quotes: {},
      imports: {},
      recentImports: [],
      importErrors: [],
      duplicateRows: [],
      minimumProtected: [],
      minimumProtectedSelectionItems: [],
      minimumProtectedPage: 0,
      minimumProtectedPageSize: 50,
      minimumProtectedTotalRows: 0,
      minimumProtectedTotalPages: 1,
      minimumProtectedHasMore: false,
      minimumProtectedSelectionOffset: 0,
      minimumProtectedSelectionHasMore: false,
      minimumProtectedSelectionLimitReached: false,
      updatedTodayItems: [],
      draftQuotations: [],
      issuedTodayItems: [],
    },
  );
  assert.throws(() => validateAdminData("roles", { roles: [] }));
  assert.deepEqual(validateAdminData("roles", { roles: [], permissions: [] }), {
    roles: [],
    permissions: [],
  });
  assert.throws(() => validateAdminData("settings", []));
});
