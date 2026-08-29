import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSelectedLookupQuery,
  normalizeLookupQuery,
  relatedLookupResults,
} from "../frontend/lookup-view";

test("Lookup query normalization matches selected parts case-insensitively", () => {
  assert.equal(normalizeLookupQuery(" ez9f56263 "), "EZ9F56263");
  assert.equal(isSelectedLookupQuery("ez9f56263", "EZ9F56263"), true);
  assert.equal(isSelectedLookupQuery("ez9f56264", "EZ9F56263"), false);
});

test("Related lookup results exclude the selected item without removing others", () => {
  const results = [
    { id: "a", partNumber: "EZ9F56263" },
    { id: "b", partNumber: "EZ9F56116" },
    { id: "c", partNumber: "EZ9F56110" },
  ];
  assert.deepEqual(relatedLookupResults(results, { id: "a" }), [
    { id: "b", partNumber: "EZ9F56116" },
    { id: "c", partNumber: "EZ9F56110" },
  ]);
  assert.deepEqual(relatedLookupResults(results, null), results);
});
