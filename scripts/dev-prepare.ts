import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import { setup, PERMISSIONS } from "../backend/auth/service";
import { saveProduct } from "../backend/products/service";
if (process.env.NODE_ENV === "production")
  throw new Error("Development fixtures must never run in production");
await fs.mkdir(".data", { recursive: true });
const token = randomBytes(32).toString("hex");
process.env.SETUP_TOKEN = token;
const db = await embedded(".data/postgres");
await migrate(db);
if (await one(db, "SELECT id FROM users LIMIT 1")) {
  console.log("Existing local database preserved.");
  process.exit(0);
}
const password = "AMT-" + randomBytes(12).toString("base64url");
await setup(db, {
  token,
  username: "preview_admin",
  password,
  name: "AMT Preview Admin",
  companyName: "AMT Electric",
});
const user = await one(
  db,
  "SELECT id FROM users WHERE username='preview_admin'",
);
const actor = {
  id: user!.id,
  username: "preview_admin",
  name: "AMT Preview Admin",
  role: "ADMIN",
  permissions: [...PERMISSIONS],
  maxDiscount: "100",
  csrf: "",
};
for (const p of [
  {
    partNumber: "LC1D09M7",
    description: "Contactor 9A · 220V AC coil",
    brand: "Schneider Electric",
    category: "Contactor",
    method: "COST_MARKUP",
    cost: "100",
    markup: "25",
    minimumEnabled: true,
    minimum: "110",
    aliases: ["OLD123"],
  },
  {
    partNumber: "GV2ME14",
    description: "Motor circuit breaker · 6–10A",
    brand: "Schneider Electric",
    category: "Motor Protection",
    method: "LIST_DISCOUNT",
    listPrice: "100",
    baseDiscount: "40",
  },
  {
    partNumber: "15336",
    description: "IH mechanical time switch · 18mm · 24h · 100h reserve",
    brand: "Schneider Electric",
    category: "Timer",
    method: "LIST_DISCOUNT",
    listPrice: "390",
    baseDiscount: "20",
  },
  {
    partNumber: "CABLE-2.5",
    description: "Single core copper cable · 2.5 mm²",
    brand: "AMT Electric",
    category: "Cable",
    method: "COST_MARKUP",
    cost: "1.4",
    markup: "25",
    unit: "m",
    quantityPrecision: 3,
  },
])
  await db.transaction((tx) => saveProduct(tx, actor, p));
await fs.writeFile(
  ".data/dev-access.json",
  JSON.stringify(
    {
      username: "preview_admin",
      password,
      note: "Local development only. Sample catalog; never production.",
    },
    null,
    2,
  ),
  { flag: "wx", mode: 0o600 },
);
try {
  await fs.writeFile(
    ".env.local",
    `DEV_EMBEDDED_DB=true\nDEV_WORKER=true\nAPP_ORIGIN=http://127.0.0.1:18180\nCOOKIE_SECURE=false\nSETUP_TOKEN=${token}\n`,
    { flag: "wx", mode: 0o600 },
  );
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
}
console.log(
  "Prepared local-only preview fixtures. Credentials: .data/dev-access.json. Production has no sample users or products.",
);
process.exit(0);
