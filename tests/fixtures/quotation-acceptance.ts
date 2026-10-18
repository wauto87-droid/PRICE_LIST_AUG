import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { embedded, migrate, one } from "../../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../../backend/auth/service";
import { saveDraft } from "../../backend/quotations/service";

if (process.env.NODE_ENV === "production")
  throw new Error("Synthetic acceptance fixtures are development-only");
const directory = path.resolve(process.env.DEV_DATABASE_DIRECTORY || "");
if (!directory.endsWith("isolated-quotation-20261017"))
  throw new Error("Use the dedicated isolated acceptance directory");
await fs.mkdir(path.dirname(directory), { recursive: true });
const db = await embedded(directory);
try {
  await migrate(db);
  if (await one(db, "SELECT id FROM users LIMIT 1"))
    throw new Error(
      "Existing acceptance database preserved; seed only an empty fixture",
    );
  process.env.SETUP_TOKEN = randomUUID();
  const password = "Synthetic-quotation-test-123";
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "quotation-pilot",
    password,
    name: "Synthetic quotation pilot",
    companyName: "Synthetic acceptance company",
  });
  const session = await login(db, { username: "quotation-pilot", password });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(session.token) },
    }),
  );
  const settings = (await one(db, "SELECT data FROM settings WHERE id=1"))!
    .data;
  for (const size of [33, 100]) {
    await saveDraft(
      db,
      actor,
      {
        customer: {
          name: `Synthetic ${size}-item customer`,
          reference: "Synthetic imported reference",
          notes: "Synthetic delivery source notes",
        },
        lines: Array.from({ length: size }, (_, n) => ({
          type: "CUSTOM",
          partNumber: `TEST-REPEATED-${n % 6}`,
          description: `Synthetic item ${n + 1} with a long description to verify compact table behaviour and repeated part references`,
          quantity: String((n % 5) + 1),
          unit: "pcs",
          unitPriceExcl: "2.123456",
          vat: "15",
        })),
      },
      settings,
    );
  }
  console.log(
    "Seeded two isolated quotations (33 and 100 rows). Synthetic login: quotation-pilot / Synthetic-quotation-test-123",
  );
} finally {
  await db.close!();
}
