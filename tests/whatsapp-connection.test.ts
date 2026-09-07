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
