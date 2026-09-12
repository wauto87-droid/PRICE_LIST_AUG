const http = require("node:http");
const { timingSafeEqual } = require("node:crypto");
const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const path = require("node:path");
const fs = require("node:fs/promises");
const sessionDirectory = path.resolve(process.env.WHATSAPP_SESSION_DIR || "/data/whatsapp");

const secret = process.env.WHATSAPP_SERVICE_TOKEN;
if (!secret || secret.length < 32)
  throw new Error(
    "Set WHATSAPP_SERVICE_TOKEN to at least 32 random characters",
  );
const { createConnection } = require("./whatsapp-connection.cjs");
const { formatOtpMessage, formatTestMessage } = require("./whatsapp-messages.cjs");
const connection = createConnection({
  // LocalAuth's default client stores credentials only in this child directory.
  clearSession: () => fs.rm(path.join(sessionDirectory, "session"), { recursive: true, force: true }),
  encodeQr: value => QRCode.toDataURL(value),
  createClient: () => new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDirectory }),
    puppeteer: {
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || require("playwright").chromium.executablePath(),
      args: process.env.WHATSAPP_NO_SANDBOX === "true" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
    },
  }),
});
let queue = Promise.resolve();
const serial = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
function authorized(req) {
  const got = Buffer.from(req.headers.authorization || ""),
    expected = Buffer.from(`Bearer ${secret}`);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
http
  .createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    const respond = (code, body) => {
      res.writeHead(code);
      res.end(JSON.stringify(body));
    };
    if (!authorized(req)) return respond(401, { error: "Unauthorized" });
    try {
      if (req.method === "GET" && req.url === "/status")
        return respond(200, connection.snapshot());
      if (req.method !== "POST")
        return respond(405, { error: "Method not allowed" });
      let bytes = 0,
        chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 4096) return respond(413, { error: "Request too large" });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (req.url === "/connect") {
        await serial(connection.connect);
        return respond(200, connection.snapshot());
      }
      if (req.url === "/disconnect") {
        await serial(connection.disconnect);
        return respond(200, connection.snapshot());
      }
      if (!["/send", "/test"].includes(req.url))
        return respond(404, { error: "Not found" });
      if (!connection.readyClient())
        return respond(503, { error: "WhatsApp disconnected" });
      if (!/^\+[1-9]\d{7,14}$/.test(body.destination))
        return respond(400, { error: "Invalid destination" });
      if (req.url === "/send" && !/^\d{6}$/.test(body.code))
        return respond(400, { error: "Invalid code" });
      if (req.url === "/send" && body.purpose != null && !["CHECKOUT", "SIGNUP", "LOGIN"].includes(body.purpose))
        return respond(400, { error: "Invalid verification purpose" });
      await serial(async () => {
        if (!connection.readyClient()) throw new Error("Disconnected");
        const client = connection.readyClient();
        if (!client) throw new Error("Disconnected");
        const recipient = await client.getNumberId(body.destination.slice(1));
        if (!recipient) throw new Error("Recipient unavailable");
        const message =
          req.url === "/test"
            ? formatTestMessage()
            : formatOtpMessage(body.code, body.purpose);
        await client.sendMessage(recipient._serialized, message);
      });
      respond(200, { sent: true });
    } catch {
      respond(503, { error: "WhatsApp operation failed. Reconnect or retry." });
    }
  })
  .listen(Number(process.env.WHATSAPP_PORT || 3010), process.env.WHATSAPP_BIND_HOST || "127.0.0.1");
void connection.connect();
const shutdown = async () => {
  await connection.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
