// Mechanical OOXML namespace normalization for ExcelJS compatibility.
// Template cells, formatting and validations are authored using artifact-tool.
import fs from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const JSZip = createRequire(require.resolve("exceljs/package.json"))("jszip");
for (const kind of ["simple", "advanced"]) {
  const file = new URL(`../assets/templates/${kind}.xlsx`, import.meta.url);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  for (const name of Object.keys(zip.files).filter((n) => n.endsWith(".xml"))) {
    const source = await zip.file(name).async("string");
    if (
      source.includes(
        'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      )
    )
      zip.file(
        name,
        source
          .replace(
            /xmlns:x="http:\/\/schemas.openxmlformats.org\/spreadsheetml\/2006\/main"/g,
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
          )
          .replace(/(<\/?)x:/g, "$1"),
      );
  }
  await fs.writeFile(
    file,
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}
