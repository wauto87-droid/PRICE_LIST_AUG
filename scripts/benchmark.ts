import "dotenv/config";
import { performance } from "node:perf_hooks";
import { embedded, migrate } from "../backend/core/db";
import { search } from "../backend/products/service";
// Isolated in-memory PostgreSQL benchmark: never inserts synthetic data into the shop DB.
const db = await embedded();
await migrate(db);
await db.query(
  `INSERT INTO products(id,part_number,normalized_part,description,keywords,quantity_precision) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'AMT'||lpad(n::text,8,'0'),'AMT'||lpad(n::text,8,'0'),'Electrical contactor reference '||n,'contactor',0 FROM generate_series(1,100000) n`,
);
await db.query(
  `INSERT INTO product_selling_levels(product_id,code,method,markup) SELECT id,'END_CUSTOMER','COST_MARKUP',25 FROM products`,
);
await db.query(
  `INSERT INTO product_pricing SELECT id,'COST_MARKUP',100,25,0,0,125,15,false,0,'END_CUSTOMER' FROM products`,
);
await db.query("ANALYZE products");
await db.query("ANALYZE product_pricing");
const actor = {
  id: "00000000-0000-4000-8000-000000000000",
  username: "benchmark",
  name: "Benchmark",
  role: "STAFF",
  permissions: ["PRODUCT_VIEW"],
  maxDiscount: "5",
  csrf: "",
};
for (const query of ["AMT00050000", "AMT00050", "contactor"]) {
  const timings = [];
  for (let i = 0; i < 25; i++) {
    const start = performance.now();
    await search(db, actor, query, {});
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      products: 100000,
      query,
      p50: timings[12].toFixed(1),
      p95: timings[23].toFixed(1),
      runtime: "PGlite / local; not VPS acceptance",
    }),
  );
}
process.exit(0);
