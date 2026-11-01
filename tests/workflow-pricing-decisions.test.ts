import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../backend/auth/service";
import {
  jobWorkspace,
  receiveJobResult,
  ready,
  preserveWorkflowCosts,
  assertWorkflowPricingReady,
  acknowledgePricingDecision,
} from "../backend/integrations/jobs";
import { adminCommand } from "../backend/integrations/core";
import { lineFingerprint } from "../backend/integrations/job-protocol";
process.env.CONNECTED_APPS_ENABLED = "true";
process.env.WORKFLOW_INTEGRATION_ENABLED = "true";
process.env.CONNECTED_APPS_ENCRYPTION_KEY = "c".repeat(64);
test("ten products: staff costs, anonymous known costs, skip, removal, acknowledgements and late replies", async () => {
  const db = await embedded();
  try {
    await migrate(db);
    process.env.SETUP_TOKEN = "simple-workflow-test-token-long-enough";
    await setup(db, {
      token: process.env.SETUP_TOKEN,
      username: "flowadmin",
      password: "abcd",
      name: "Owner",
      companyName: "Pilot",
    });
    const session = await login(db, {
      username: "flowadmin",
      password: "abcd",
    });
    const actor = await authenticate(
      db,
      new Request("http://local", {
        headers: { Cookie: sessionCookie(session.token).split(";")[0] },
      }),
    );
    const id = randomUUID(),
      token = randomUUID();
    const lines = Array.from({ length: 10 }, (_, n) => ({
      source: "CUSTOM",
      description: `Product ${n}`,
      partNumber: `P-${n}`,
      unit: "pcs",
      input: { type: "CUSTOM", watcherEventId: randomUUID(), quantity: "5" },
      price: {
        quantity: "5",
        finalExcl: "10",
        subtotal: "50",
        vatAmount: "7.50",
        total: "57.50",
      },
    }));
    const entries = Object.fromEntries(
      lines.map((l) => [
        l.input.watcherEventId,
        { PRICING: { token, status: "ASSIGNED", currency: "SAR" } },
      ]),
    );
    await db.query(
      "INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,'DR-TEST','DRAFT',$2,'{\"name\":\"Pilot\"}',$3::jsonb,'{}')",
      [id, actor.id, JSON.stringify(lines)],
    );
    await db.query(
      "INSERT INTO sw_job_documents(id,data) VALUES($1,$2::jsonb)",
      [id, JSON.stringify({ lines: entries, erpRequestId: "req" })],
    );
    const cost = {
      cost: "16.0001",
      currency: "SAR",
      unit: "pcs",
      supplier: "Shop",
      taxBasis: "Excluding VAT",
      availability: "Available",
      evidence: "Confirmed",
      leadTime: "Today",
    };
    const key = (
      await adminCommand(db, { app: "pricelist" }, actor.id, {
        action: "generate",
        name: "ERP",
        scopes: ["jobs:results"],
        expires: new Date(Date.now() + 86400000).toISOString(),
      })
    ).key;
    const send = (payload: any) =>
      receiveJobResult(
        db,
        new Request("http://local/jobs-result", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: JSON.stringify(payload),
        }),
      );
    const result = (l: any, revision = 1) => ({
      eventId: randomUUID(),
      documentId: id,
      lineId: l.input.watcherEventId,
      token,
      revision,
      kind: "PRICING",
      fingerprint: lineFingerprint(l),
      done: true,
      blocker: "",
      actorName: "Staff",
      updatedAt: new Date().toISOString(),
      cost,
      movements: [],
    });
    for (const l of lines.slice(0, 4)) await send(result(l));
    const get = () =>
      jobWorkspace(
        db,
        actor,
        new Request(`http://local/workflow-jobs?documentId=${id}`),
      );
    const post = async (action: string, line: any, details: any = {}) => {
      const q = await get();
      const body = {
        eventId: randomUUID(),
        documentId: id,
        action,
        lineId: line.input.watcherEventId,
        version: q.version,
        workflowVersion: q.workflowVersion,
        ...details,
      };
      await jobWorkspace(
        db,
        actor,
        new Request("http://local/workflow-jobs", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      return body;
    };
    const decisions: any[] = [];
    decisions.push(
      await post("known", lines[4], {
        cost: { ...cost, supplier: "", evidence: "", taxBasis: "Unknown" },
      }),
    );
    decisions.push(await post("known", lines[5], { cost }));
    decisions.push(await post("skip", lines[6]));
    decisions.push(await post("skip", lines[7]));
    decisions.push(await post("remove", lines[8]));
    decisions.push(await post("remove", lines[9]));
    let q = await get();
    assert.equal(q.lines.length, 8);
    assert.equal(
      q.ready,
      false,
      "No readiness until ERP acknowledges stopped jobs",
    );
    assert.equal(
      q.lines.find((l: any) => l.id === lines[4].input.watcherEventId)
        .workflowCost.supplier,
      "",
    );
    assert.equal(
      q.lines.find((l: any) => l.id === lines[4].input.watcherEventId).margin,
      null,
      "Unknown VAT cannot show a margin",
    );
    for (const l of lines.slice(4))
      assert.equal(
        (await send(result(l, 99))).stale,
        true,
        "Late replies cannot overwrite decisions",
      );
    const saved = (await one(db, "SELECT * FROM quotations WHERE id=$1", [
      id,
    ]))!;
    const link = (await one(db, "SELECT * FROM sw_job_documents WHERE id=$1", [
      id,
    ]))!;
    for (const decision of decisions) {
      const event = (await one(db, "SELECT * FROM sw_job_outbox WHERE id=$1", [
        decision.eventId,
      ]))!;
      await acknowledgePricingDecision(db, event, { received: true });
      await acknowledgePricingDecision(db, event, { received: true });
    }
    const acknowledged = (await one(
      db,
      "SELECT * FROM sw_job_documents WHERE id=$1",
      [id],
    ))!;
    link.data = acknowledged.data;
    const notices = (
      await db.query(
        "SELECT payload FROM sw_job_outbox WHERE endpoint='jobs-ready'",
      )
    ).rows;
    assert.equal(
      notices.length,
      1,
      "One completion notice survives repeated acknowledgements",
    );
    assert.equal(
      notices[0].payload.actorId,
      actor.id,
      "Completion notice has a mapped recipient context",
    );
    assert.equal(ready(saved, link).ready, true);
    await assertWorkflowPricingReady(db, saved);
    assert.equal(
      saved.lines[6].workflowCost,
      undefined,
      "Skip never becomes zero cost",
    );
    const rebuilt = preserveWorkflowCosts(
      [...saved.lines]
        .reverse()
        .map((l: any) => ({ ...l, workflowCost: { cost: "0" } })),
      saved.lines,
    );
    assert.equal(
      rebuilt.find(
        (l: any) => l.input.watcherEventId === lines[4].input.watcherEventId,
      ).workflowCost.cost,
      "16.0001",
    );
    assert.equal(
      rebuilt.find(
        (l: any) => l.input.watcherEventId === lines[6].input.watcherEventId,
      ).workflowCost,
      undefined,
    );
    const stale = structuredClone(saved);
    stale.lines[6].description = "Changed product";
    assert.equal(ready(stale, link).ready, false);
    const old = await get();
    await assert.rejects(
      jobWorkspace(
        db,
        actor,
        new Request("http://local/workflow-jobs", {
          method: "POST",
          body: JSON.stringify({
            ...decisions[0],
            eventId: randomUUID(),
            version: 1,
            workflowVersion: old.workflowVersion,
          }),
        }),
      ),
      /Draft changed/,
    );
    const outsider = {
      ...actor,
      id: randomUUID(),
      role: "STAFF",
      permissions: [
        "QUOTE_VIEW_ALL",
        "QUOTE_EDIT",
        "QUOTE_EDIT_ALL",
        "COST_VIEW",
      ],
    };
    await assert.rejects(
      jobWorkspace(
        db,
        outsider,
        new Request("http://local/workflow-jobs", {
          method: "POST",
          body: JSON.stringify({
            action: "skip",
            eventId: randomUUID(),
            documentId: id,
            lineId: lines[0].input.watcherEventId,
            version: old.version,
            workflowVersion: old.workflowVersion,
          }),
        }),
      ),
      /responsible owner|permission|Access|access/,
    );
    await db.query("UPDATE quotations SET status='ISSUED' WHERE id=$1", [id]);
    q = await get();
    assert.equal(q.ready, false);
    await assert.rejects(
      jobWorkspace(
        db,
        actor,
        new Request("http://local/workflow-jobs", {
          method: "POST",
          body: JSON.stringify({
            action: "skip",
            eventId: randomUUID(),
            documentId: id,
            lineId: lines[0].input.watcherEventId,
            version: q.version,
            workflowVersion: q.workflowVersion,
          }),
        }),
      ),
      /editable drafts/,
    );
  } finally {
    await db.close?.();
  }
});
