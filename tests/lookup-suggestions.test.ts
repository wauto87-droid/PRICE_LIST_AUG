import test from "node:test";
import assert from "node:assert/strict";
import {
  activeSuggestionIndex,
  clampHighlightedIndex,
  moveHighlightedIndex,
  suggestionOptionId,
  topSuggestions,
} from "../frontend/lookup-suggestions";

test("Suggestion helpers clamp and move the highlighted item correctly", () => {
  assert.equal(clampHighlightedIndex(-2, 4), 0);
  assert.equal(clampHighlightedIndex(9, 4), 3);
  assert.equal(clampHighlightedIndex(1, 4), 1);
  assert.equal(moveHighlightedIndex(-1, "next", 3), 0);
  assert.equal(moveHighlightedIndex(-1, "previous", 3), 2);
  assert.equal(moveHighlightedIndex(1, "next", 3), 2);
  assert.equal(moveHighlightedIndex(1, "previous", 3), 0);
  assert.equal(activeSuggestionIndex(-1, 3), 0);
  assert.equal(activeSuggestionIndex(2, 3), 2);
  assert.equal(activeSuggestionIndex(7, 3), 0);
  assert.equal(activeSuggestionIndex(0, 0), -1);
  assert.equal(suggestionOptionId("lookup", 2), "lookup-option-2");
});

test("Suggestion helpers keep only the top visible matches", () => {
  assert.deepEqual(topSuggestions([1, 2, 3, 4], 2), [1, 2]);
  assert.deepEqual(topSuggestions([], 2), []);
});
