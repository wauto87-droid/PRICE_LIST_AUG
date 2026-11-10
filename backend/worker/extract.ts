import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as XLSX from "xlsx";

const exec = promisify(execFile);

export function getPythonBin(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  return process.platform === "win32" ? "python" : "python3";
}

export type ExtractedResult = {
  rows: Record<string, string>[];
  columns: string[];
  warnings: string[];
  profile?: string | null;
};

const IDENTIFIER_HEADERS = new Set([
  "partnumber",
  "partno",
  "partreference",
  "partref",
  "itemcode",
  "item",
  "code",
  "sku",
  "reference",
]);

function normalizeHeader(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function extractSpreadsheet(
  filePath: string,
  buffer: Buffer,
  maxRows: number = 50000,
): ExtractedResult {
  const ext = path.extname(filePath).toLowerCase();

  // Validate workbook signatures
  if (ext === ".xlsx") {
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new Error("Invalid XLSX workbook");
    }
  } else if (ext === ".xls") {
    const isObe = buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
    const isBiff = buffer.length >= 2 && buffer[0] === 0x09 && [0x00, 0x02, 0x04, 0x08].includes(buffer[1]);
    if (!isObe && !isBiff) {
      throw new Error("Invalid XLS workbook");
    }
  }

  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    raw: true,
  });

  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], columns: [], warnings: [] };
  const sheet = wb.Sheets[sheetName];
  if (!sheet || !sheet["!ref"])
    return { rows: [], columns: [], warnings: [] };

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const ncols = range.e.c - range.s.c + 1;
  if (ncols > 100) {
    throw new Error("Too many or duplicate column headings");
  }

  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
    const val =
      cell && cell.v !== undefined && cell.v !== null
        ? String(cell.v).trim()
        : "";
    headers.push(val || `Column ${c - range.s.c + 1}`);
  }

  if (headers.length > 100 || new Set(headers).size !== headers.length) {
    throw new Error("Too many or duplicate column headings");
  }

  const rows: Record<string, string>[] = [];
  const warnings: string[] = [];
  if (ext === ".xls") {
    warnings.push(
      "Legacy XLS values may be cached formula results. Verify all prices.",
    );
  }

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    let hasVal = false;
    const row: Record<string, string> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const h = headers[c - range.s.c];
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v === undefined || cell.v === null) {
        row[h] = "";
      } else {
        hasVal = true;
        let textVal = "";
        const v = cell.v;
        if (cell.f && (v === undefined || v === null)) {
          textVal = "FORMULA_REQUIRES_VALUE";
        } else if (typeof v === "number") {
          textVal = Number.isInteger(v) ? String(v) : String(v);
        } else {
          textVal = String(v);
        }

        // Preserve zero-padded identifiers if formatted
        const isIdentifier = IDENTIFIER_HEADERS.has(normalizeHeader(h));
        if (isIdentifier && cell.w && cell.t === "n" && cell.w.length > textVal.length) {
          textVal = cell.w;
        }

        row[h] = textVal;
      }
    }

    if (hasVal) {
      if (rows.length >= maxRows) {
        throw new Error(`Maximum ${maxRows.toLocaleString("en-US")} rows`);
      }
      rows.push(row);
    }
  }

  return { rows, columns: headers, warnings };
}

export async function extractFile(
  filePath: string,
  maxPages: number = 100,
  maxRows: number = 50000,
): Promise<ExtractedResult> {
  const ext = path.extname(filePath).toLowerCase();

  // For spreadsheets (.xlsx, .xls, .csv), attempt native extraction first
  if ([".xlsx", ".xls", ".csv"].includes(ext)) {
    try {
      const buffer = await fs.readFile(filePath);
      return extractSpreadsheet(filePath, buffer, maxRows);
    } catch (spreadsheetError: any) {
      // If native parsing threw a validation error (like max rows or duplicate headings), rethrow it
      const msg = spreadsheetError?.message || "";
      if (
        msg.includes("Maximum") ||
        msg.includes("Too many or duplicate column headings") ||
        msg.includes("Expanded workbook exceeds")
      ) {
        throw spreadsheetError;
      }
      // Otherwise fall back to python extractor below
    }
  }

  // Fallback or PDF: execute python extract.py with platform-aware python executable
  const pythonBin = getPythonBin();
  const { stdout } = await exec(
    pythonBin,
    [
      path.join(process.cwd(), "scripts", "extract.py"),
      filePath,
      String(maxPages),
      String(maxRows),
    ],
    { timeout: 300000, maxBuffer: 128 * 1024 * 1024, windowsHide: true },
  );

  return JSON.parse(stdout);
}
