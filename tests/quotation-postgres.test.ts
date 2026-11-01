import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { postgres, migrate, one, type DB } from "../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../backend/auth/service";
import { reviewIssue, issue, saveDraft } from "../backend/quotations/service";
import { reviseDocument } from "../backend/quotations/documents";

const fixture = process.env.QUOTATION_ISOLATED_POSTGRES;
const identifier = (v: string) => '"' + v.replaceAll('"', '""') + '"';
async function inventory(db: DB, columns?: Record<string, string[]>) {
  if (!columns) {
    columns = {};
    for (const c of (
      await db.query(
        "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
      )
    ).rows)
      (columns[c.table_name] ||= []).push(c.column_name);
  }
  const fingerprints: Record<string, unknown> = {};
  for (const [table, fields] of Object.entries(columns)) {
    if (table === "migrations") continue;
    const rows = (
      await db.query(
        `SELECT ${fields.map(identifier).join(",")} FROM ${identifier(table)}`,
      )
    ).rows;
    const normalized = rows.map((r) => JSON.stringify(r)).sort();
    fingerprints[table] = {
      count: rows.length,
      hash: createHash("sha256")
        .update(JSON.stringify(normalized))
        .digest("hex"),
    };
  }
  return { columns, fingerprints };
}
test(
  "real PostgreSQL: fresh and retained migrations, no-op replay, preservation, revision concurrency and actual backup restore",
  { skip: !fixture, timeout: 120000 },
  async () => {
    const url = new URL(fixture!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "15439");
    assert.equal(url.username, "quotation_test");
    const admin = new Client({ connectionString: fixture });
    await admin.connect();
    const created: string[] = [];
    const opened: DB[] = [];
    async function create(name: string) {
      assert.match(name, /^quotation_[a-f0-9_]+$/);
      await admin.query(`CREATE DATABASE ${identifier(name)}`);
      created.push(name);
      const u = new URL(fixture!);
      u.pathname = "/" + name;
      const db = postgres(u.toString());
      opened.push(db);
      return { db, url: u };
    }
    try {
      const suffix = randomUUID().replaceAll("-", "");
      const fresh = await create("quotation_f_" + suffix);
      await migrate(fresh.db);
      const count = await one(fresh.db, "SELECT count(*) n FROM migrations");
      await migrate(fresh.db);
      assert.deepEqual(
        await one(fresh.db, "SELECT count(*) n FROM migrations"),
        count,
      );
      const retained = await create("quotation_a_" + suffix);
      await retained.db.query(
        "CREATE TABLE migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
      );
      for (const file of (await fs.readdir("database"))
        .filter((f) => f.endsWith(".sql") && f < "072")
        .sort()) {
        await retained.db.transaction(async (tx) => {
          await tx.execute!(
            await fs.readFile(path.join("database", file), "utf8"),
          );
          await tx.query("INSERT INTO migrations(name) VALUES($1)", [file]);
        });
      }
      process.env.SETUP_TOKEN = "isolated-postgres-quotation-test-setup";
      await setup(retained.db, {
        token: process.env.SETUP_TOKEN,
        username: "pg-pilot",
        password: "Synthetic-Postgres-test-123",
        name: "Synthetic pilot",
        companyName: "Synthetic PostgreSQL",
      });
      const owner = (await one(
        retained.db,
        "SELECT id FROM users WHERE username='pg-pilot'",
      ))!.id;
      const originalId = randomUUID(),
        lineId = randomUUID();
      const customer = {
        name: "Synthetic retained customer",
        number: "",
        mobile: "",
        reference: "",
        notes: "",
      };
      const line = {
        source: "CUSTOM",
        partNumber: "RETAINED-PART",
        description: "Retained synthetic item",
        unit: "pcs",
        input: {
          type: "CUSTOM",
          watcherEventId: lineId,
          partNumber: "RETAINED-PART",
          description: "Retained synthetic item",
          unit: "pcs",
          quantity: "2",
          unitPriceExcl: "10.123456",
          vat: "15",
          discount: "0",
        },
        price: {
          quantity: "2",
          finalExcl: "10.12",
          finalIncl: "11.64",
          subtotal: "20.25",
          vatAmount: "3.04",
          vatRate: "15",
          total: "23.29",
        },
      };
      await retained.db.query(
        "INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,'DR-RETAINED','DRAFT',$2,$3::jsonb,$4::jsonb,$5::jsonb)",
        [
          originalId,
          owner,
          JSON.stringify(customer),
          JSON.stringify([line]),
          JSON.stringify({ subtotal: "20.25", vat: "3.04", total: "23.29" }),
        ],
      );
      await retained.db.query(
        "INSERT INTO sw_job_outbox(id,channel,endpoint,payload) VALUES($1,'REMOTE','jobs-assign',$2::jsonb)",
        [
          randomUUID(),
          JSON.stringify({
            documentId: originalId,
            kind: "PRICING",
            lines: [],
          }),
        ],
      );
      const before = await inventory(retained.db);
      await migrate(retained.db);
      assert.deepEqual(
        (await inventory(retained.db, before.columns)).fingerprints,
        before.fingerprints,
      );
      assert.equal(
        (await one(retained.db, "SELECT created_at FROM sw_job_outbox"))!
          .created_at,
        null,
        "No invented historical timestamp",
      );
      const after = await inventory(retained.db);
      await migrate(retained.db);
      assert.deepEqual(
        (await inventory(retained.db)).fingerprints,
        after.fingerprints,
      );
      const session = await login(retained.db, {
        username: "pg-pilot",
        password: "Synthetic-Postgres-test-123",
      });
      const actor = await authenticate(
        retained.db,
        new Request("http://localhost", {
          headers: { Cookie: sessionCookie(session.token) },
        }),
      );
      const settings = (await one(
        retained.db,
        "SELECT data FROM settings WHERE id=1",
      ))!.data;
      const review = await reviewIssue(
        retained.db,
        actor,
        originalId,
        settings,
      );
      await issue(retained.db, actor, originalId, review.token, settings);
      const eventId = randomUUID();
      const revisions = await Promise.all([
        reviseDocument(
          retained.db,
          actor,
          originalId,
          settings,
          undefined,
          eventId,
        ),
        reviseDocument(
          retained.db,
          actor,
          originalId,
          settings,
          undefined,
          eventId,
        ),
      ]);
      assert.equal(revisions[0].id, revisions[1].id);
      const separate = await Promise.all([
        reviseDocument(
          retained.db,
          actor,
          originalId,
          settings,
          undefined,
          randomUUID(),
        ),
        reviseDocument(
          retained.db,
          actor,
          originalId,
          settings,
          undefined,
          randomUUID(),
        ),
      ]);
      assert.notEqual(separate[0].revision, separate[1].revision);
      const edit = revisions[0];
      const input = {
        customer: edit.customer,
        lines: edit.lines.map((l: any) => l.input),
      };
      await saveDraft(
        retained.db,
        actor,
        input,
        settings,
        edit.id,
        edit.version,
      );
      await assert.rejects(
        saveDraft(retained.db, actor, input, settings, edit.id, edit.version),
        /changed on another device/,
      );
      const expected = await inventory(retained.db);
      const restored = await create("quotation_b_" + suffix);
      const directory = path.resolve("../mission-20261017");
      await fs.mkdir(directory, { recursive: true });
      const backup = path.join(directory, `synthetic-quotation-${suffix}.dump`);
      const bin = process.env.QUOTATION_POSTGRES_BIN!;
      assert.ok(bin);
      execFileSync(path.join(bin, "pg_dump.exe"), [
        "-h",
        "127.0.0.1",
        "-p",
        "15439",
        "-U",
        "quotation_test",
        "-d",
        retained.url.pathname.slice(1),
        "-Fc",
        "-f",
        backup,
      ]);
      execFileSync(path.join(bin, "pg_restore.exe"), [
        "-h",
        "127.0.0.1",
        "-p",
        "15439",
        "-U",
        "quotation_test",
        "-d",
        restored.url.pathname.slice(1),
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        backup,
      ]);
      assert.deepEqual(
        (await inventory(restored.db)).fingerprints,
        expected.fingerprints,
      );
      console.log(
        `PASS: fresh migration; retained 71→73 migration; exact original-column fingerprints; no-op replay; concurrent revision identity; stale edit rejection; actual pg_dump/pg_restore across ${Object.keys(expected.fingerprints).length} tables. Synthetic backup retained at ${backup}`,
      );
    } finally {
      for (const db of opened) await db.close!();
      for (const name of created)
        await admin.query(`DROP DATABASE ${identifier(name)}`);
      await admin.end();
    }
  },
);
