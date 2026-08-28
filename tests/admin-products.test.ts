import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBulkItems,
  chunkBulkItems,
  classifyBulkDeleteError,
  formatBulkDeleteError,
  getProductSuggestions,
} from "../frontend/admin-products";

const t = (en: string) => en;

test("Bulk item payload normalizes integer-like versions and sorts by id", () => {
  assert.deepEqual(
    buildBulkItems({
      "b-id": "7",
      "a-id": 3,
      "c-id": "not-a-number",
    }),
    [
      { id: "a-id", version: 3 },
      { id: "b-id", version: 7 },
      { id: "c-id", version: "not-a-number" },
    ],
  );
});

test("Large bulk selections are split into steady smaller batches", () => {
  assert.deepEqual(
    chunkBulkItems([1, 2, 3, 4, 5], 2),
    [[1, 2], [3, 4], [5]],
  );
});

test("Bulk delete errors are classified into friendly categories", () => {
  assert.equal(
    classifyBulkDeleteError("Cannot delete LC1D: it is used in quotation QT-001"),
    "blocked",
  );
  assert.equal(
    classifyBulkDeleteError("Product changed. Reload its current values before deleting"),
    "stale",
  );
  assert.equal(
    classifyBulkDeleteError("Invalid input: items.0.version: expected number, received string"),
    "invalid-selection",
  );
});

test("Bulk delete friendly copy keeps business conflicts and rewrites selection errors", () => {
  assert.equal(
    formatBulkDeleteError(
      "Cannot delete LC1D: it is referenced by import test.xlsx",
      t,
    ),
    "Cannot delete LC1D: it is referenced by import test.xlsx",
  );
  assert.match(
    formatBulkDeleteError("items.0.version: Invalid input", t),
    /invalid selection data/i,
  );
});

test("Product suggestions keep top ranked unique items and require a query", () => {
  const items = [
    { id: "1", partNumber: "LC1D09M7", description: "Contactor", brand: "Schneider" },
    { id: "1", partNumber: "LC1D09M7", description: "Duplicate", brand: "Schneider" },
    { id: "2", partNumber: "LC1D12", description: "Contactor 12A", brand: "Schneider" },
    { id: "3", partNumber: "LC1D18", description: "Contactor 18A", brand: "Schneider" },
  ];
  assert.deepEqual(getProductSuggestions(items, "", 3), []);
  assert.deepEqual(
    getProductSuggestions(items, "LC1D", 2).map((item) => item.id),
    ["1", "2"],
  );
});
