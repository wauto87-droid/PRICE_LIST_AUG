import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasSupplierSimpleColumns,
  rankedMappedColumn,
} from "../frontend/Imports";

test("Basic import ranks ABB columns without guessing the alternate product ID", () => {
  const columns = [
    "S.No",
    "Solution",
    "Product Family",
    "Material Code",
    "Product ID / Addtl Info",
    "Description ",
    "Min Ordering Qty",
    "Price per \nPiece",
    "Gross Price \n (SAR )",
  ];
  assert.deepEqual(rankedMappedColumn(columns, "partNumber"), {
    column: "Material Code",
    ambiguous: false,
  });
  assert.deepEqual(rankedMappedColumn(columns, "description"), {
    column: "Description ",
    ambiguous: false,
  });
  assert.deepEqual(rankedMappedColumn(columns, "price"), {
    column: "Gross Price \n (SAR )",
    ambiguous: false,
  });
});

test("Basic import reports equally ranked duplicate headings as ambiguous", () => {
  assert.deepEqual(rankedMappedColumn(["Part No", "Part-No"], "partNumber"), {
    column: "Part No",
    ambiguous: true,
  });
});

test("ABB headers stay in Basic import instead of supplier-simple mode", () => {
  assert.equal(
    hasSupplierSimpleColumns([
      "S.No",
      "Solution",
      "Product Family",
      "Material Code",
      "Product ID / Addtl Info",
      "Description ",
      "Min Ordering Qty",
      "Price per \nPiece",
      "Gross Price \n (SAR )",
    ]),
    false,
  );
});

test("Dedicated supplier template still opens supplier-simple mode", () => {
  assert.equal(
    hasSupplierSimpleColumns([
      "Part Reference",
      "Local Description",
      "Public Pricelist",
      "Activity",
    ]),
    true,
  );
});
