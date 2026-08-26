import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { getDB, one } from "../backend/core/db";
import { settings } from "../backend/admin/service";
const exec = promisify(execFile),
  db = await getDB();
const dir = path.resolve(process.env.BACKUP_DIR || "/data/backups");
await fs.mkdir(dir, { recursive: true });
const url = new URL(process.env.DATABASE_URL!);
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: url.pathname.slice(1),
};
let running = true;
process.on("SIGTERM", () => {
  running = false;
});
while (running) {
  try {
    const recent = await one(
      db,
      "SELECT id FROM backups WHERE created_at>now()-interval '24 hours' AND status IN ('PENDING','RUNNING','DONE') LIMIT 1",
    );
    if (!recent)
      await db.query("INSERT INTO backups(id) VALUES($1)", [randomUUID()]);
    const backup = await db.transaction(async (tx) => {
      const b = await one(
        tx,
        "SELECT * FROM backups WHERE status='PENDING' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (b)
        await tx.query("UPDATE backups SET status='RUNNING' WHERE id=$1", [
          b.id,
        ]);
      return b;
    });
    if (backup) {
      const filename = `amt-${new Date().toISOString().replaceAll(":", "-")}-${backup.id}.dump`,
        target = path.join(dir, filename);
      try {
        await exec(
          "pg_dump",
          ["--format=custom", "--no-owner", "--no-acl", "--file", target],
          { env, timeout: 600000, maxBuffer: 1024 * 1024, windowsHide: true },
        );
        await exec("pg_restore", ["--list", target], {
          env,
          timeout: 60000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        });
        await fs.chmod(target, 0o600);
        const stat = await fs.stat(target);
        await db.query(
          "UPDATE backups SET status='DONE',filename=$2,size_bytes=$3,completed_at=now() WHERE id=$1",
          [backup.id, filename, stat.size],
        );
      } catch (e) {
        console.error("Backup failed", backup.id, (e as Error).message);
        await db.query(
          "UPDATE backups SET status='FAILED',error='Backup failed; check backup service logs' WHERE id=$1",
          [backup.id],
        );
      }
    }
    const retention = (await settings(db)).backupRetentionDays ?? 14;
    const old = (
      await db.query(
        "SELECT id,filename FROM backups WHERE status='DONE' AND completed_at<now()-($1::int*interval '1 day')",
        [retention],
      )
    ).rows;
    for (const b of old) {
      if (!/^amt-[a-zA-Z0-9.\-]+\.dump$/.test(b.filename)) continue;
      const target = path.resolve(dir, b.filename);
      if (path.dirname(target) !== dir) continue;
      await fs.unlink(target).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      });
      await db.query("UPDATE backups SET status='EXPIRED' WHERE id=$1", [b.id]);
    }
    await db.query(
      "UPDATE backups SET status='FAILED',error='Interrupted backup; request a new backup' WHERE status='RUNNING' AND created_at<now()-interval '30 minutes'",
    );
  } catch (e) {
    console.error("Backup service error", (e as Error).message);
  }
  await new Promise((r) => setTimeout(r, 15000));
}
process.exit(0);
