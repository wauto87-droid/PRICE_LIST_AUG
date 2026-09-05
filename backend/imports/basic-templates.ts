import ExcelJS from "exceljs";

export type BasicTemplateKind = "public-discount" | "supplier-markup";

export async function basicImportTemplate(kind: BasicTemplateKind) {
  const discount = kind === "public-discount";
  const book = new ExcelJS.Workbook();
  book.creator = "AMT Electric";
  const sheet = book.addWorksheet(
    discount ? "Public Price Import" : "Supplier Cost Import",
    { views: [{ state: "frozen", ySplit: 1 }] },
  );
  const adjustment = discount ? "Discount %" : "Markup %";
  sheet.getRow(1).values = ["Part Number", "Description", "Price", adjustment];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFCC001F" },
  };
  sheet.addRow(["EXAMPLE-001", "Example product", 100, discount ? 20 : 25]);
  sheet.addRow(["EXAMPLE-002", "Uses the app default percentage", 75.5, null]);
  sheet.columns = [
    { width: 24 },
    { width: 48 },
    { width: 18 },
    { width: 18 },
  ];
  sheet.getColumn(3).numFmt = "#,##0.000000";
  sheet.getColumn(4).numFmt = "0.######";
  sheet.autoFilter = "A1:D3";

  const instructions = book.addWorksheet("Instructions");
  instructions.columns = [{ width: 110 }];
  instructions.addRow([
    discount
      ? "Public Price + Discount template"
      : "Supplier Cost + Markup template",
  ]);
  instructions.addRow([
    `${adjustment} is optional when one default percentage is entered in AMT.`,
  ]);
  instructions.addRow([
    "Keep Part Number as text when it contains leading zeroes. Delete the example rows before importing.",
  ]);
  instructions.getRow(1).font = { bold: true, size: 15 };
  instructions.getRow(2).alignment = { wrapText: true };
  return Buffer.from(await book.xlsx.writeBuffer());
}
