import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { embedded, migrate, one } from "../backend/core/db";
import { setup, login, authenticate } from "../backend/auth/service";
test("Local PostgreSQL data, setup state, and sessions survive close/reopen", async () => {
  await fs.mkdir("test-results", { recursive: true });
  const dir = await fs.mkdtemp(path.resolve("test-results", "persistence-"));
  let db = await embedded(dir);
  await migrate(db);
  process.env.SETUP_TOKEN = "persistence-test-setup-token-32-characters";
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "persist",
    password: "Persistent-password-129",
    name: "Persistent User",
    companyName: "AMT Persistence Test",
  });
  const session = await login(db, {
    username: "persist",
    password: "Persistent-password-129",
  });
  await db.close!();
  db = await embedded(dir);
  await migrate(db);
  try {
    assert.equal(
      (await one(db, "SELECT data FROM settings WHERE id=1"))!.data.companyName,
      "AMT Persistence Test",
    );
    assert.equal(
      (
        await authenticate(
          db,
          new Request("http://localhost/", {
            headers: { cookie: "amt_session=" + session.token },
          }),
        )
      ).username,
      "persist",
    );
    assert.equal(
      (await one(db, "SELECT count(*) AS n FROM migrations"))!.n,
      (await fs.readdir("database")).filter((name) => name.endsWith(".sql"))
        .length,
    );
  } finally {
    await db.close!();
  }
});
