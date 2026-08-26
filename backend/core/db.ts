import { Pool } from "pg";
import fs from "node:fs/promises";
import path from "node:path";
export interface DB {
  query<T = Record<string, any>>(
    sql: string,
    args?: any[],
  ): Promise<{ rows: T[] }>;
  transaction<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}
function wrap(client: any, transaction?: DB["transaction"]): DB {
  return {
    query: (sql, args = []) => client.query(sql, args),
    transaction: transaction ?? (async (fn) => fn(wrap(client))),
  };
}
export function postgres(url: string): DB {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    statement_timeout: 15000,
  });
  return wrap(pool, async (fn) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(wrap(c));
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  });
}
export async function embedded(directory?: string): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const pg = new PGlite({ dataDir: directory, extensions: { pg_trgm } });
  await pg.waitReady;
  return {
    ...wrap(pg, (fn) => pg.transaction((tx) => fn(wrap(tx)))),
    close: () => pg.close(),
  };
}
export async function migrate(db: DB) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  const files = (await fs.readdir(path.join(process.cwd(), "database")))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files)
    if (
      !(await db.query("SELECT name FROM migrations WHERE name=$1", [file]))
        .rows.length
    ) {
      const sql = await fs.readFile(
        path.join(process.cwd(), "database", file),
        "utf8",
      );
      await db.transaction(async (tx) => {
        for (const statement of sql.split(";").filter((s) => s.trim()))
          await tx.query(statement);
        await tx.query("INSERT INTO migrations(name) VALUES($1)", [file]);
      });
    }
}
const globalDB = globalThis as unknown as { amtDB?: Promise<DB> };
export function getDB(): Promise<DB> {
  return (globalDB.amtDB ??= (async () => {
    if (
      process.env.DEV_EMBEDDED_DB === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      const db = await embedded(path.join(process.cwd(), ".data", "postgres"));
      await migrate(db);
      if (process.env.DEV_WORKER === "true") {
        const { runJob } = await import("../worker/process");
        let busy = false;
        setInterval(async () => {
          if (busy) return;
          busy = true;
          try {
            await runJob(db);
          } catch (e) {
            console.error("Local worker failed", (e as Error).message);
          } finally {
            busy = false;
          }
        }, 1500).unref();
      }
      return db;
    }
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    return postgres(process.env.DATABASE_URL);
  })());
}
export async function one<T = Record<string, any>>(
  db: DB,
  sql: string,
  args: any[] = [],
): Promise<T | undefined> {
  return (await db.query<T>(sql, args)).rows[0];
}
