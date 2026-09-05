import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { basicImportTemplate } from "../backend/imports/basic-templates";

for (const [kind, adjustment] of [["public-discount", "Discount %"], ["supplier-markup", "Markup %"]] as const) {
  test(`${kind} sample is a formatted, importable basic workbook`, async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await basicImportTemplate(kind) as any);
    const sheet = book.worksheets[0]!;
    assert.deepEqual((sheet.getRow(1).values as any[]).slice(1), ["Part Number", "Description", "Price", adjustment]);
    assert.equal(sheet.views[0]?.state, "frozen");
    assert.equal(sheet.getCell("A2").value, "EXAMPLE-001");
    assert.equal(typeof sheet.getCell("C2").value, "number");
    assert.match(String(book.getWorksheet("Instructions")!.getCell("A2").value), /optional/i);
  });
}
