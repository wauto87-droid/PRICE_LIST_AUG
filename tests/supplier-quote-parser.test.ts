import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const exec = promisify(execFile);

test("supplier quotation parser extracts only product line items", async () => {
  const fixture = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "supplier-quote-pages.json",
  );
  const script = [
    "import json,sys",
    "from supplier_quote import extract_supplier_quote_pages",
    "pages=json.load(open(sys.argv[1], encoding='utf-8'))",
    "print(json.dumps(extract_supplier_quote_pages(pages)))",
  ].join("; ");
  const { stdout } = await exec(process.env.PYTHON_BIN || "python", [
    "-c",
    script,
    fixture,
  ], { cwd: path.join(process.cwd(), "scripts") });
  const rows = JSON.parse(stdout);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    "Article number": "3RT2015-1BB41",
    Description:
      "power contactor, AC-3e/AC-3, 7 A, 3 kW / 400 V, 3-pole 24 V DC, auxiliary contacts: 1 NO, screw terminal",
    Unit: "Piece",
    "Quoted quantity": "30",
    "Unit price": "60.94",
    "Total price": "1828.20",
    Page: "2",
    "Quote number": "SAQ00020221",
    "Quote date": "24-11-24",
  });
  assert.equal(rows[1]["Article number"], "3RH2122-1AP00");
  assert.match(rows[1].Description, /Contactor relay/);
});
