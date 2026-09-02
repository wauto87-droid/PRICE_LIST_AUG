import assert from "node:assert/strict";
import test from "node:test";
import { nextCatalogResultHighlight } from "../frontend/catalog-result-navigation";

test("catalog result keyboard navigation wraps and moves by a visible page", () => {
  assert.equal(nextCatalogResultHighlight(0, 8, "ArrowUp"), 7);
  assert.equal(nextCatalogResultHighlight(7, 8, "ArrowDown"), 0);
  assert.equal(nextCatalogResultHighlight(2, 8, "Home"), 0);
  assert.equal(nextCatalogResultHighlight(2, 8, "End"), 7);
  assert.equal(nextCatalogResultHighlight(1, 8, "PageDown"), 6);
  assert.equal(nextCatalogResultHighlight(6, 8, "PageUp"), 1);
});

test("catalog result keyboard navigation keeps the current result for unrelated keys", () => {
  assert.equal(nextCatalogResultHighlight(2, 8, "Enter"), 2);
  assert.equal(nextCatalogResultHighlight(0, 0, "ArrowDown"), 0);
});
