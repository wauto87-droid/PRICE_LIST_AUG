import test from "node:test";
import assert from "node:assert/strict";
import { embedded, migrate, one } from "../backend/core/db";
import { setup, PERMISSIONS } from "../backend/auth/service";
import { handle } from "../backend/api/router";
import { json } from "../backend/core/audit";

test("instant maintenance enforcement and auto-recovery for storefront and workspace", async (t) => {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.SETUP_TOKEN = "maintenance-test-setup-token-12345";
  process.env.APP_ORIGIN = "http://localhost:18180";
  const db = await embedded();
  t.after(() => db.close?.());
  await migrate(db);

  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "testadmin",
    password: "AdminPassword123!",
    name: "Test Admin",
    companyName: "AMT Electric",
  });

  // 1. Health check returns maintenance status
  const healthReq = new Request("http://localhost/amt_price_list/api/v1/health");
  const healthRes = await handle(healthReq, db);
  const healthData = await healthRes.json();
  assert.equal(healthRes.status, 200);
  assert.equal(healthData.ok, true);
  assert.equal(healthData.maintenance.workspace.enabled, false);
  assert.equal(healthData.maintenance.storefront.enabled, false);

  // 2. Turn ON storefront maintenance
  await db.query(`
    UPDATE storefront_settings 
    SET data = jsonb_set(
      jsonb_set(data, '{maintenanceEnabled}', 'true'::jsonb),
      '{maintenanceText}', '"Store is undergoing planned maintenance"'::jsonb
    )
    WHERE id = 1
  `);

  // Health probe reflects storefront maintenance immediately
  const healthActiveRes = await handle(healthReq, db);
  const healthActiveData = await healthActiveRes.json();
  assert.equal(healthActiveData.maintenance.storefront.enabled, true);
  assert.equal(healthActiveData.maintenance.storefront.text, "Store is undergoing planned maintenance");

  // Operational storefront endpoints are blocked with 503 MAINTENANCE_MODE
  const sfReq = new Request("http://localhost/amt_price_list/api/v1/storefront/homepage");
  const sfRes = await handle(sfReq, db);
  assert.equal(sfRes.status, 503);
  const sfData = await sfRes.json();
  assert.equal(sfData.error, "MAINTENANCE_MODE");
  assert.equal(sfData.maintenance.enabled, true);
  assert.equal(sfData.maintenance.text, "Store is undergoing planned maintenance");

  // Configuration endpoint remains readable so client knows the maintenance message
  const sfConfigReq = new Request("http://localhost/amt_price_list/api/v1/storefront/configuration");
  const sfConfigRes = await handle(sfConfigReq, db);
  assert.equal(sfConfigRes.status, 200);
  const sfConfigData = await sfConfigRes.json();
  assert.equal(sfConfigData.maintenanceEnabled, true);

  // 3. Turn OFF storefront maintenance -> instantly restored
  await db.query(`
    UPDATE storefront_settings 
    SET data = jsonb_set(data, '{maintenanceEnabled}', 'false'::jsonb)
    WHERE id = 1
  `);

  const healthOffRes = await handle(healthReq, db);
  const healthOffData = await healthOffRes.json();
  assert.equal(healthOffData.maintenance.storefront.enabled, false);

  const sfRestoredRes = await handle(sfReq, db);
  assert.equal(sfRestoredRes.status, 200);

  // 4. Test workspace maintenance
  await db.query(`
    UPDATE settings 
    SET data = jsonb_set(
      jsonb_set(data, '{workspaceMaintenance}', 'true'::jsonb),
      '{workspaceMaintenanceText}', '"Staff portal under maintenance"'::jsonb
    )
    WHERE id = 1
  `);

  const healthWsRes = await handle(healthReq, db);
  const healthWsData = await healthWsRes.json();
  assert.equal(healthWsData.maintenance.workspace.enabled, true);
  assert.equal(healthWsData.maintenance.workspace.text, "Staff portal under maintenance");

  // Turn OFF workspace maintenance
  await db.query(`
    UPDATE settings 
    SET data = jsonb_set(data, '{workspaceMaintenance}', 'false'::jsonb)
    WHERE id = 1
  `);

  const healthWsOffRes = await handle(healthReq, db);
  const healthWsOffData = await healthWsOffRes.json();
  assert.equal(healthWsOffData.maintenance.workspace.enabled, false);
});
