import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const { createConnection } = createRequire(import.meta.url)("../scripts/whatsapp-connection.cjs");
class Client extends EventEmitter {
  destroyed = false;
  loggedOut = false;
  info = { wid: { user: "966500000000" } };
  async initialize() {}
  async destroy() { this.destroyed = true; }
  async logout() { this.loggedOut = true; }
}
test("QR expires and reconnect ignores events from the previous client", async () => {
  let now = 0;
  const clients: Client[] = [];
  const connection = createConnection({ now: () => now, createClient: () => { const c = new Client(); clients.push(c); return c; }, encodeQr: async (s: string) => s });
  try {
    await connection.connect();
    clients[0].emit("qr", "first"); await Promise.resolve();
    assert.equal(connection.snapshot().qr, "first");
    now = 46000;
    assert.equal(connection.snapshot().status, "QR_EXPIRED");
    assert.equal(connection.snapshot().qr, null);
    await connection.connect();
    clients[0].emit("ready");
    assert.equal(connection.snapshot().status, "STARTING");
    assert.equal(clients[0].loggedOut, false);
    clients[1].emit("ready");
    assert.equal(connection.snapshot().status, "READY");
    await connection.connect(); assert.equal(clients.length, 2);
    await connection.disconnect();
    assert.equal(clients[1].loggedOut, true);
    assert.equal(connection.snapshot().number, null);
  } finally { await connection.close(); }
});
test("startup timeout allows recovery and does not leak underlying errors", async () => {
  const connection = createConnection({ createClient: () => new Client(), encodeQr: async (s: string) => s, startupMs: 5 });
  try {
    await connection.connect();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(connection.snapshot().status, "FAILED");
    assert.match(connection.snapshot().diagnostic, /timed out/);
    await connection.connect();
    assert.equal(connection.snapshot().status, "STARTING");
  } finally { await connection.close(); }
});
test("late QR encoding cannot replace a ready session", async () => {
  const client = new Client(); let finish: (s: string) => void = () => {};
  const connection = createConnection({ createClient: () => client, encodeQr: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await connection.connect(); client.emit("qr", "pending"); client.emit("ready");
    finish("late"); await Promise.resolve();
    assert.equal(connection.snapshot().status, "READY");
    assert.equal(connection.snapshot().qr, null);
  } finally { await connection.close(); }
});

test("disconnect clears failed authentication credentials", async () => {
  const client = new Client(); let cleared = false;
  const connection = createConnection({ createClient: () => client, encodeQr: async (s: string) => s, clearSession: async () => { cleared = true; } });
  try {
    await connection.connect();
    client.emit("auth_failure", "private provider detail");
    assert.equal(connection.snapshot().status, "FAILED");
    assert.doesNotMatch(connection.snapshot().diagnostic, /private provider detail/);
    await connection.disconnect();
    assert.equal(cleared, true);
    assert.equal(connection.snapshot().status, "DISCONNECTED");
  } finally { await connection.close(); }
});

test("QR refresh encoding cannot restore an older or authenticated QR", async () => {
  const client=new Client();const pending:((s:string)=>void)[]=[];
  const connection=createConnection({createClient:()=>client,encodeQr:()=>new Promise(resolve=>pending.push(resolve))});
  try{
    await connection.connect();client.emit("qr","first");client.emit("qr","second");
    pending[1]("new");await Promise.resolve();pending[0]("old");await Promise.resolve();
    assert.equal(connection.snapshot().qr,"new");
    client.emit("qr","third");client.emit("authenticated");pending[2]("obsolete");await Promise.resolve();
    assert.equal(connection.snapshot().qr,null);assert.equal(connection.snapshot().status,"STARTING");
  }finally{await connection.close();}
});

test("onMessage invokes callback when client is ready", async () => {
  const client = new Client();
  const received: any[] = [];
  const connection = createConnection({
    createClient: () => client,
    encodeQr: async (s: string) => s,
    onMessage: async (msg: any) => { received.push(msg); },
  });
  try {
    await connection.connect();
    client.emit("ready");
    assert.equal(connection.snapshot().status, "READY");

    client.emit("message", { from: "966501234567@c.us", body: "hello", fromMe: false });
    await Promise.resolve();
    assert.equal(received.length, 1);
    assert.equal(received[0].body, "hello");
  } finally {
    await connection.close();
  }
});

test("formatOtpMessage generates official professional bilingual message with store URL", () => {
  const { formatOtpMessage, formatTestMessage, translateOrderStatus } = createRequire(import.meta.url)("../scripts/whatsapp-service.cjs");
  
  const loginMsg = formatOtpMessage("123456", "LOGIN", "https://softwaresolver.online/amt_price_list/store");
  assert.match(loginMsg, /123456/);
  assert.match(loginMsg, /إيه إم تي للمواد الكهربائية/);
  assert.match(loginMsg, /AMT Electrical Supplies/);
  assert.match(loginMsg, /Login Verification Code/);
  assert.match(loginMsg, /10 دقائق/);
  assert.match(loginMsg, /https:\/\/softwaresolver.online\/amt_price_list\/store/);

  const signupMsg = formatOtpMessage("654321", "SIGNUP");
  assert.match(signupMsg, /654321/);
  assert.match(signupMsg, /Account Registration Code/);
  assert.match(signupMsg, /تأكيد تسجيل الحساب/);

  const checkoutMsg = formatOtpMessage("888999", "CHECKOUT");
  assert.match(checkoutMsg, /888999/);
  assert.match(checkoutMsg, /Order Checkout Code/);

  const testMsg = formatTestMessage();
  assert.match(testMsg, /اختبار اتصال واتساب ناجح/);
  assert.match(testMsg, /WhatsApp Connection Test Successful/);

  assert.equal(translateOrderStatus("CONFIRMED"), "مؤكد وجارٍ التجهيز (Confirmed)");
  assert.equal(translateOrderStatus("DELIVERED"), "تم التوصيل والتسليم (Delivered)");
});

test("handleBotMessage responds with menu and options", async () => {
  const { handleBotMessage } = createRequire(import.meta.url)("../scripts/whatsapp-service.cjs");
  const sent: { to: string; text: string }[] = [];
  const fakeClient = {
    sendMessage: async (to: string, text: string) => { sent.push({ to, text }); },
  };

  // 1. Greeting -> Menu
  await handleBotMessage({ from: "966500000001@c.us", body: "السلام عليكم", fromMe: false }, fakeClient);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /أهلاً بك في شركة إيه إم تي للمواد الكهربائية/);
  assert.match(sent[0].text, /المتجر وتصفح المنتجات/);
  assert.match(sent[0].text, /طلب تسعيرة كميات/);

  // 2. Option 1 -> Store Link
  await handleBotMessage({ from: "966500000001@c.us", body: "1", fromMe: false }, fakeClient);
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /متجر إيه إم تي الإلكتروني/);
  assert.match(sent[1].text, /amt_price_list\/store/);

  // 3. Option 4 -> RFQ
  await handleBotMessage({ from: "966500000001@c.us", body: "4", fromMe: false }, fakeClient);
  assert.equal(sent.length, 3);
  assert.match(sent[2].text, /طلب تسعيرة كميات ومشاريع/);
  assert.match(sent[2].text, /requirements/);

  // 4. Option 5 -> Location
  await handleBotMessage({ from: "966500000001@c.us", body: "5", fromMe: false }, fakeClient);
  assert.equal(sent.length, 4);
  assert.match(sent[3].text, /الرياض، المملكة العربية السعودية/);

  // 5. Option 6 -> Support
  await handleBotMessage({ from: "966500000001@c.us", body: "6", fromMe: false }, fakeClient);
  assert.equal(sent.length, 5);
  assert.match(sent[4].text, /خدمة العملاء/);
});
