import "dotenv/config";
import { getDB } from "../core/db";
import { runJob } from "./process";
const db = await getDB();
let running = true;
let housekeepingAt = 0;
process.on("SIGTERM", () => {
  running = false;
});
process.on("SIGINT", () => {
  running = false;
});
while (running) {
  try {
    if (Date.now() - housekeepingAt > 3600000) {
      await db.query("DELETE FROM sessions WHERE expires_at<now()");
      await db.query("DELETE FROM login_attempts WHERE expires_at<now()");
      await db.query(
        "UPDATE jobs SET status='FAILED',error='Interrupted repeatedly; submit a new job' WHERE status='RUNNING' AND attempts>=3 AND locked_at<now()-interval '15 minutes'",
      );
      await db.query(
        "UPDATE import_jobs SET status='FAILED',error='Worker interrupted repeatedly; upload again' WHERE status='PROCESSING' AND id IN (SELECT (payload->>'importId')::uuid FROM jobs WHERE kind='IMPORT_EXTRACT' AND status='FAILED')",
      );
      housekeepingAt = Date.now();
    }
    if (!(await runJob(db))) await new Promise((r) => setTimeout(r, 1500));
  } catch (e) {
    console.error("Worker unavailable", (e as Error).message);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
process.exit(0);
