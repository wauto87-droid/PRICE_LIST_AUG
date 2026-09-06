const http = require("node:http");
const { timingSafeEqual } = require("node:crypto");
const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");

const secret = process.env.WHATSAPP_SERVICE_TOKEN;
if (!secret || secret.length < 32)
  throw new Error(
    "Set WHATSAPP_SERVICE_TOKEN to at least 32 random characters",
  );
let client,
  status = "DISCONNECTED",
  qr = null,
  qrExpiresAt = null,
  number = null,
  starting = false;
let queue = Promise.resolve();
const serial = (task) => {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
};
async function connect() {
  if (starting || status === "READY" || status === "QR") return;
  starting = true;
  status = "STARTING";
  if (client) await client.destroy().catch(() => {});
  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: process.env.WHATSAPP_SESSION_DIR || "/data/whatsapp",
    }),
    puppeteer: {
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
      args:
        process.env.WHATSAPP_NO_SANDBOX === "true"
          ? ["--no-sandbox", "--disable-setuid-sandbox"]
          : [],
    },
  });
  client.on("qr", async (value) => {
    const encoded = await QRCode.toDataURL(value);
    if (status !== "READY") {
      qr = encoded;
      qrExpiresAt = Date.now() + 45000;
      status = "QR";
    }
  });
  client.on("ready", () => {
    status = "READY";
    qr = null;
    qrExpiresAt = null;
    number = client.info?.wid?.user || null;
    starting = false;
  });
  client.on("auth_failure", () => {
    status = "AUTH_FAILURE";
    qr = null;
    number = null;
    starting = false;
  });
  client.on("disconnected", () => {
    status = "DISCONNECTED";
    qr = null;
    number = null;
    starting = false;
  });
  client.initialize().catch(() => {
    status = "FAILED";
    starting = false;
    qr = null;
  });
}
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
        return respond(200, {
          status,
          number,
          qr: qrExpiresAt > Date.now() ? qr : null,
          qrExpiresAt,
        });
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
        await serial(connect);
        return respond(200, { status });
      }
      if (req.url === "/disconnect") {
        await serial(async () => {
          if (client) {
            await client.logout();
            await client.destroy().catch(() => {});
          }
          client = null;
          status = "DISCONNECTED";
          qr = null;
          number = null;
          starting = false;
        });
        return respond(200, { status });
      }
      if (!["/send", "/test"].includes(req.url))
        return respond(404, { error: "Not found" });
      if (status !== "READY")
        return respond(503, { error: "WhatsApp disconnected" });
      if (!/^\+[1-9]\d{7,14}$/.test(body.destination))
        return respond(400, { error: "Invalid destination" });
      if (req.url === "/send" && !/^\d{6}$/.test(body.code))
        return respond(400, { error: "Invalid code" });
      await serial(async () => {
        if (status !== "READY") throw new Error("Disconnected");
        const recipient = await client.getNumberId(body.destination.slice(1));
        if (!recipient) throw new Error("Recipient unavailable");
        const message =
          req.url === "/test"
            ? "AMT: WhatsApp connection test successful. تم اختبار اتصال واتساب بنجاح."
            : `AMT verification code: ${body.code}. Expires in 10 minutes. Do not share this code.\nرمز التحقق: ${body.code}. صالح لمدة 10 دقائق. لا تشارك الرمز.`;
        await client.sendMessage(recipient._serialized, message);
      });
      respond(200, { sent: true });
    } catch {
      respond(503, { error: "WhatsApp operation failed. Reconnect or retry." });
    }
  })
  .listen(Number(process.env.WHATSAPP_PORT || 3010), "0.0.0.0");
connect();
const shutdown = async () => {
  if (client) await client.destroy().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
