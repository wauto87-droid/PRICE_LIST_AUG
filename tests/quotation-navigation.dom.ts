import test from "node:test";
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
// DOM interaction coverage only; visual CSS acceptance is a separate browser check.
const cssHooks = registerHooks({
  load(url, context, next) {
    return url.endsWith(".css")
      ? { format: "module", source: "export default {};", shortCircuit: true }
      : next(url, context);
  },
});
const { JSDOM } = createRequire(import.meta.url)(
  process.env.QUOTATION_TEST_DOM_RUNTIME || "jsdom",
);
import { act, createElement } from "react";
import Quotations from "../frontend/Quotations";
const dom = new JSDOM('<div id="root"></div>', {
  url: "https://quotation.test/amt_price_list/",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  FormData: dom.window.FormData,
  IS_REACT_ACT_ENVIRONMENT: true,
});
// React DOM must detect the DOM after the fixture exists, as it does in a browser.
const { createRoot } = await import("react-dom/client");
test.after(() => {
  dom.window.close();
  cssHooks.deregister();
});
const quote = (id: string, shared = false) => ({
  id,
  number: "DR-" + id,
  version: 1,
  status: "DRAFT",
  sharedWorkflow: shared,
  sharedRequestId: shared ? "request-" + id : undefined,
  customer: { name: "Synthetic buyer" },
  created_at: "2026-10-15T00:00:00Z",
  totals: { total: "10" },
  lines: [
    {
      partNumber: "SYN-1",
      description: "Test cable",
      price: {
        quantity: 1,
        finalExcl: "10",
        subtotal: "10",
        vatAmount: "0",
        total: "10",
      },
      input: { type: "CUSTOM" },
      source: "CUSTOM",
    },
  ],
});
let rows: any[] = [];
let pdfDeferred: ((r: Response) => void) | undefined;
let fetches: string[] = [];
let sharedUnavailable = false;
const json = (value: any) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
globalThis.fetch = async (input: any, init: any = {}) => {
  const path = String(input).split("/api/v1/")[1];
  fetches.push(path);
  if (sharedUnavailable && path === "shared-quotation?documentId=linked")
    return new Response(
      JSON.stringify({ error: "Synthetic ERP unavailable" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  if (path.startsWith("quotations?")) return json(rows);
  if (path === "quotation-templates")
    return json({ items: [], availableUsers: [] });
  if (path === "shared-quotation?documentId=linked")
    return json({
      requestId: "request-linked",
      requestRevision: 1,
      actorId: "owner",
      ownerId: "owner",
      branch: "test",
      items: [
        { id: "item", name: "Cable", quantity: "1", unit: "m", offers: [] },
      ],
      quotations: [
        {
          version: 1,
          customer: "Synthetic buyer",
          currency: "SAR",
          total: "10",
          subtotal: "10",
          taxTotal: "0",
          lines: [
            {
              itemId: "item",
              name: "Cable",
              quantity: "1",
              unit: "m",
              sellingPrice: "10",
            },
          ],
        },
      ],
      suppliers: [],
      orders: [],
    });
  if (path === "shared-quotation" && init.method === "POST")
    return json({ id: "shared-pdf", status: "DONE" });
  if (path.endsWith("/pdf"))
    return await new Promise((resolve) => {
      pdfDeferred = resolve;
    });
  if (path.startsWith("quotations/"))
    return json(rows.find((q) => q.id === path.split("/")[1]));
  throw new Error("Unexpected mock request: " + path);
};
const tick = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
};
const click = async (label: string) => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  assert.ok(button, "Missing " + label);
  await act(async () => {
    button!.click();
  });
  await tick();
};
const props = () => ({
  t: (en: string) => en,
  user: { permissions: ["QUOTE_CREATE", "QUOTE_ISSUE"] },
  cart: { lines: [] },
  onOpen: () => {},
  onUseTemplate: () => {},
  onOpenSharedDraft: () => {},
  onOpenWorkflow: () => {
    throw new Error("Opening quotations must not auto-navigate to workflow");
  },
});
test("legacy quotation toolbar, Back and browser Forward retain the list; old PDF jobs cannot attach to another quotation", async () => {
  rows = [quote("one"), quote("two")];
  fetches = [];
  window.history.replaceState({}, "");
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(createElement(Quotations, props())));
  await tick();
  await click("Open");
  assert.equal(document.querySelectorAll("[role=dialog]").length, 1);
  for (const label of ["Edit quotation", "Generate PDF", "Print view"])
    assert.ok(document.body.textContent?.includes(label));
  const dialog = document.querySelector("[role=dialog]")!;
  assert.ok(dialog.querySelector("[role=toolbar]"));
  assert.ok(
    !(
      dialog
        .querySelector("[role=toolbar]")!
        .compareDocumentPosition(dialog.querySelector(".quote-line")!) &
      dom.window.Node.DOCUMENT_POSITION_PRECEDING
    ),
  );
  await click("Generate PDF");
  assert.ok(pdfDeferred);
  await click("Back to quotations");
  await tick();
  assert.equal(document.querySelectorAll("[role=dialog]").length, 0);
  assert.ok(document.body.textContent?.includes("DR-two"));
  await act(async () => {
    window.history.forward();
  });
  await tick();
  assert.equal(
    document.querySelector("[role=dialog]")?.getAttribute("aria-label"),
    "DR-one",
  );
  await click("Back to quotations");
  await tick();
  const opens = Array.from(document.querySelectorAll("button")).filter(
    (b) => b.textContent === "Open",
  );
  await act(async () => opens[1].click());
  await tick();
  assert.equal(
    document.querySelector("[role=dialog]")?.getAttribute("aria-label"),
    "DR-two",
  );
  await act(async () => pdfDeferred!(json({ id: "old-pdf", status: "DONE" })));
  await tick();
  assert.equal(document.querySelector("a[href*=old-pdf]"), null);
  await act(async () => root.unmount());
});
test("linked quotations stay in Quotations with edit, saved-version print and PDF actions", async () => {
  rows = [quote("linked", true)];
  fetches = [];
  window.history.replaceState({}, "");
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(createElement(Quotations, props())));
  await tick();
  await click("Open");
  await tick();
  for (const text of [
    "Edit draft (1)",
    "Generate PDF",
    "Print quotation / Save PDF",
    "Back to quotations",
  ])
    assert.ok(document.body.textContent?.includes(text), "Missing " + text);
  assert.equal(
    fetches.some((p) => p.startsWith("workflow-jobs")),
    false,
  );
  const print = document.querySelector("a[href*=print]") as HTMLAnchorElement;
  assert.ok(print.href.includes("version=1"));
  await click("Generate PDF");
  assert.ok(document.querySelector("a[href*=shared-pdf]"));
  await click("Back to quotations");
  await tick();
  assert.equal(document.querySelectorAll("[role=dialog]").length, 0);
  await act(async () => root.unmount());
});

test("unavailable ERP details leave visible disabled actions and Retry restores them", async () => {
  rows = [quote("linked", true)];
  sharedUnavailable = true;
  window.history.replaceState({}, "");
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(createElement(Quotations, props())));
    await tick();
    await click("Open");
    await tick();
    assert.ok(document.querySelector("[role=alert]"));
    for (const text of [
      "Edit draft",
      "Generate PDF",
      "Print quotation / Save PDF",
    ]) {
      const button = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === text,
      );
      assert.ok(button);
      assert.equal(button.disabled, true);
    }
    sharedUnavailable = false;
    await click("Refresh progress");
    await tick();
    assert.equal(
      Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "Generate PDF",
      )!.disabled,
      false,
    );
  } finally {
    sharedUnavailable = false;
    await act(async () => root.unmount());
  }
});

test("the actual app keeps shared editing in Quotations and returns without refresh", async () => {
  rows = [quote("linked", true)];
  fetches = [];
  window.history.replaceState({}, "");
  Object.assign(globalThis, { location: window.location });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  (window as any).matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  Object.assign(globalThis, { matchMedia: window.matchMedia });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init: any = {}) => {
    const path = String(input).split("/api/v1/")[1];
    if (path === "auth/me")
      return json({
        user: {
          id: "pilot",
          name: "Synthetic staff",
          username: "pilot@example.invalid",
          csrf: "synthetic-token",
          permissions: ["QUOTE_CREATE", "QUOTE_ISSUE"],
        },
        settings: { allowOfflineCache: false, allowOfflineQuotes: false },
      });
    if (path === "health" || path === "health/maintenance")
      return json({ release: "synthetic", workspace: { enabled: false } });
    if (path === "ads") return json({ ads: [] });
    if (path?.startsWith("shared-quotation?documentId=linked&draft=1"))
      return json({
        ...quote("linked", true),
        sharedDocumentId: "linked",
        sharedRequestId: "request-linked",
        sharedDraftMode: "edit",
        sharedQuoteVersion: 1,
        sharedRevision: 1,
        sharedTaxBasis: "EXEMPT",
        sharedTaxRate: "0",
        workflowCurrency: "SAR",
      });
    return previousFetch(input, init);
  };
  const App = (await import("../app/page")).default;
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(createElement(App)));
    await tick();
    await tick();
    await click("Quotations");
    await tick();
    await click("Open");
    await tick();
    await click("Edit draft (1)");
    await tick();
    assert.ok(document.querySelector(".workflow-editor"));
    assert.ok(document.body.textContent?.includes("Back to quotation"));
    assert.equal(document.querySelector(".workflow-workspace"), null);
    await click("Back to quotation");
    await tick();
    assert.ok(document.querySelector("[role=dialog]"));
    await click("Back to quotations");
    await tick();
    assert.equal(document.querySelectorAll("[role=dialog]").length, 0);
    assert.ok(document.body.textContent?.includes("DR-linked"));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previousFetch;
  }
});
