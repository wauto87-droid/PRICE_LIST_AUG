import test from "node:test";
import assert from "node:assert/strict";
import { calculateCustom } from "../backend/pricing/engine";
import { quoteInput, duplicateLineInput, saveDraft } from "../backend/quotations/service";
import { cartLineHasBlockingError } from "../frontend/cart-live-pricing";
import { embedded, migrate, one } from "../backend/core/db";
import { setup, login, authenticate, sessionCookie } from "../backend/auth/service";
import { saveTemplate, instantiateTemplate } from "../backend/handover/service";

const base = { type: "CUSTOM" as const, partNumber: "MARKUP-TEST", description: "Custom panel", unit: "pcs", quantity: "1", unitPriceExcl: "100", discount: "20" };
test("custom adjustments are exclusive, rounded before VAT, and compatible with old discount lines", () => {
  assert.equal(calculateCustom(base, "15").finalExcl, "80.00");
  const price = calculateCustom({ ...base, markup: "20", quantity: "1.5" }, "15");
  assert.equal(price.finalExcl, "120.00");
  assert.equal(price.subtotal, "180.00");
  assert.equal(price.vatAmount, "27.00");
  assert.equal(price.total, "207.00");
  assert.equal(price.effectiveDiscount, "0");
  assert.equal(price.effectiveMarkup, "20");
  assert.equal(price.adjustmentMode, "MARKUP");
  assert.equal(calculateCustom({ ...base, markup: "0" }, "15").finalExcl, "100.00");
  assert.equal(calculateCustom({ ...base, markup: "150" }, "15").finalExcl, "250.00");
  assert.equal(calculateCustom({ ...base, discount: "100" }, "15").total, "0.00");
  assert.equal(calculateCustom({ ...base, unitPriceExcl: "0.03", markup: "50" }, "15").finalExcl, "0.05");
  for (const markup of ["-1", "abc", "1,000"]) {
    assert.throws(() => calculateCustom({ ...base, markup }, "15"));
    assert.equal(cartLineHasBlockingError({ input: { ...base, markup } }), true);
  }
  assert.throws(() => calculateCustom({ ...base, discount: "101" }, "15"));
  assert.throws(() => calculateCustom({ ...base, quantity: "0" }, "15"));
  const parsed = quoteInput.parse({ customer: {}, lines: [{ ...base, discount: "0", markup: "150" }] });
  assert.equal(duplicateLineInput({ source: "CUSTOM", input: parsed.lines[0] }).markup, "150");
});

test("saved custom markup survives reopening and duplication and records separate watcher evidence", async () => {
  const db = await embedded();
  try {
    await migrate(db);
    process.env.SETUP_TOKEN = "custom-markup-test-token-long-enough";
    await setup(db, { token: process.env.SETUP_TOKEN, username: "admin", password: "abcd", name: "Admin", companyName: "AMT" });
    const session = await login(db, { username: "admin", password: "abcd" });
    const actor = await authenticate(db, new Request("http://localhost", { headers: { Cookie: sessionCookie(session.token).split(";")[0] } }));
    const saved: any = await saveDraft(db, actor, { customer: {}, lines: [{ ...base, discount: "0", markup: "20" }] }, {});
    assert.equal(saved.lines[0].input.markup, "20");
    assert.equal(saved.lines[0].input.unitPriceExcl, "100");
    assert.equal(saved.lines[0].price.finalExcl, "120.00");
    const evidence = await one(db, "SELECT effective_discount::text, effective_markup::text, adjustment_mode FROM price_watch_events WHERE quotation_id=$1", [saved.id]);
    assert.equal(Number(evidence!.effective_discount), 0);
    assert.equal(Number(evidence!.effective_markup), 20);
    assert.equal(evidence!.adjustment_mode, "MARKUP");
    const duplicate: any = await saveDraft(db, actor, { customer: {}, lines: saved.lines.map(duplicateLineInput) }, {});
    assert.equal(duplicate.lines[0].price.finalExcl, "120.00");
    const template = await saveTemplate(db, actor, undefined, { name: "Markup template", content: { customer: {}, lines: [duplicateLineInput(saved.lines[0])] } });
    const restored = await instantiateTemplate(db, actor, template!.id);
    assert.equal(restored.lines[0].input.markup, "20");
    assert.equal(restored.lines[0].price.finalExcl, "120.00");
  } finally { await db.close?.(); }
});
