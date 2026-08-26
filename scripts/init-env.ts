import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
// Exclusive creation prevents accidental overwrite of an existing environment.
const password = randomBytes(32).toString("hex"),
  token = randomBytes(32).toString("hex");
const template = await fs.readFile(".env.example", "utf8");
await fs.writeFile(
  ".env",
  template
    .replaceAll("REPLACE_WITH_RANDOM_PASSWORD", password)
    .replace("REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS", token),
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Created .env with new app-only secrets. Read SETUP_TOKEN privately on the host.",
);
