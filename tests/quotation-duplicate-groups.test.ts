import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDuplicateGroups,
  getDuplicateGroupColor,
  normalizeDuplicateItemKey,
} from "../frontend/quotation-duplicate-groups";

test("normalizeDuplicateItemKey handles catalog and custom items cleanly", () => {
  assert.equal(
    normalizeDuplicateItemKey({ partNumber: "abc-100" }),
    "ABC-100",
  );
  assert.equal(
    normalizeDuplicateItemKey({ input: { partNumber: "  XYZ-200  " } }),
    "XYZ-200",
  );
  assert.equal(
    normalizeDuplicateItemKey({
      input: { type: "CUSTOM", description: "Special Cable" },
    }),
    "DESC:SPECIAL CABLE",
  );
  assert.equal(normalizeDuplicateItemKey({}), "");
});

test("getDuplicateGroupColor provides distinct colors without repeating for arbitrary N", () => {
  const generatedColors = new Set<string>();
  const totalTestGroups = 30;

  for (let i = 1; i <= totalTestGroups; i++) {
    const color = getDuplicateGroupColor(i);
    assert.ok(color.bg, `Group ${i} should have a background color`);
    assert.ok(color.border, `Group ${i} should have a border color`);
    assert.ok(color.text, `Group ${i} should have a text color`);

    assert.ok(
      !generatedColors.has(color.bg),
      `Color background ${color.bg} at group ${i} should be unique across tested groups`,
    );
    generatedColors.add(color.bg);
  }

  assert.equal(generatedColors.size, totalTestGroups);
});

test("buildDuplicateGroups assigns 1..N indices without wrapping at 6", () => {
  // Create 10 different repeated items (20 lines total)
  const lines: any[] = [];
  for (let i = 1; i <= 10; i++) {
    lines.push({ partNumber: `PART-${i}` });
    lines.push({ partNumber: `PART-${i}` });
  }

  const mapRef = new Map<string, number>();
  const result = buildDuplicateGroups(lines, mapRef);

  assert.equal(result.totalGroups, 10);
  for (let i = 1; i <= 10; i++) {
    const key = `PART-${i}`;
    assert.equal(result.partCounts[key], 2);
    assert.ok(
      result.duplicateIndices[key] >= 1 && result.duplicateIndices[key] <= 10,
    );
    assert.ok(result.groupColors[key]);
  }

  // All 10 groups should have distinct group numbers
  const indices = Object.values(result.duplicateIndices);
  const uniqueIndices = new Set(indices);
  assert.equal(uniqueIndices.size, 10);
  assert.ok(
    !indices.includes(0),
    "Indices should be 1-based positive integers",
  );
});

test("buildDuplicateGroups keeps stable indices across line updates", () => {
  const mapRef = new Map<string, number>();

  const linesV1 = [
    { partNumber: "A" },
    { partNumber: "A" },
    { partNumber: "B" },
    { partNumber: "B" },
  ];
  const r1 = buildDuplicateGroups(linesV1, mapRef);
  const indexA = r1.duplicateIndices["A"];
  const indexB = r1.duplicateIndices["B"];

  // Add more lines and a third repeated item
  const linesV2 = [
    ...linesV1,
    { partNumber: "C" },
    { partNumber: "C" },
  ];
  const r2 = buildDuplicateGroups(linesV2, mapRef);

  // Existing keys retain their assigned numbers
  assert.equal(r2.duplicateIndices["A"], indexA);
  assert.equal(r2.duplicateIndices["B"], indexB);
  assert.ok(r2.duplicateIndices["C"] !== indexA);
  assert.ok(r2.duplicateIndices["C"] !== indexB);
});
