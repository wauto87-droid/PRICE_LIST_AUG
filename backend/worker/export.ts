import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import type { DB } from "../core/db";
import { productSelect, toInput } from "../products/service";
import {
  masterPrice,
  money,
  sellingLevels,
  levelPrice,
} from "../pricing/engine";
import { codes, tierColumns, exportLevelValues } from "../pricing/transfer";
import Decimal from "decimal.js";
export async function exportCatalog(db: DB, id: string, includeCosts: boolean) {
  const dir = path.join(
    path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
    "exports",
  );
  await fs.mkdir(dir, { recursive: true });
  const book = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: path.join(dir, id + ".xlsx"),
    useStyles: false,
    useSharedStrings: false,
  });
  const sheet = book.addWorksheet("Products");
  const fields = includeCosts
    ? [
        "partNumber",
        "description",
        "brand",
        "category",
        "method",
        "cost",
        "markup",
        "listPrice",
        "baseDiscount",
        "vat",
        "minimumEnabled",
        "minimum",
        "unit",
        "quantityPrecision",
        "active",
        "aliases",
        "keywords",
        "defaultLevel",
        ...tierColumns,
      ]
    : [
        "partNumber",
        "description",
        "brand",
        "category",
        "masterExcl",
        "masterIncl",
        "vat",
        "unit",
        "defaultLevel",
        ...codes.flatMap((c) => [`${c}.masterExcl`, `${c}.masterIncl`]),
      ];
  sheet.columns = fields.map((f) => ({ header: f, key: f, width: 22 }));
  let after = "";
  while (true) {
    const rows = (
      await db.query(
        productSelect +
          " WHERE p.normalized_part>$1 ORDER BY p.normalized_part LIMIT 1000",
        [after],
      )
    ).rows;
    if (!rows.length) break;
    for (const row of rows) {
      const p = toInput(row),
        master = masterPrice(p);
      const values = {
        ...p,
        aliases: p.aliases.join("|"),
        ...exportLevelValues(p, includeCosts),
        ...Object.fromEntries(
          sellingLevels(p)
            .filter((l) => l.active)
            .flatMap((l) => [
              [`${l.code}.masterExcl`, levelPrice(p, l).toFixed(2)],
              [
                `${l.code}.masterIncl`,
                money(
                  levelPrice(p, l).mul(
                    new Decimal(1).add(new Decimal(p.vat).div(100)),
                  ),
                ),
              ],
            ]),
        ),
        masterExcl: master.toFixed(2),
        masterIncl: money(
          master.mul(new Decimal(1).add(new Decimal(p.vat).div(100))),
        ),
      };
      sheet
        .addRow(Object.fromEntries(fields.map((f) => [f, (values as any)[f]])))
        .commit();
    }
    after = rows[rows.length - 1].normalized_part;
  }
  sheet.commit();
  await book.commit();
}
