import "dotenv/config";
import { getDB, migrate } from "../backend/core/db";
await migrate(await getDB());
console.log("Database migrations complete");
process.exit(0);
