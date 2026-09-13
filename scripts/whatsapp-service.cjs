const http = require("node:http");
const { timingSafeEqual } = require("node:crypto");
const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const path = require("node:path");
const fs = require("node:fs/promises");
const sessionDirectory = path.resolve(process.env.WHATSAPP_SESSION_DIR || "/data/whatsapp");

const isEntrypoint =
  require.main === module ||
  Boolean(process.env.pm_id || process.env.pm_exec_path) ||
  Boolean(require.main && /pm2|ProcessContainer/i.test(require.main.filename));

const secret = process.env.WHATSAPP_SERVICE_TOKEN;
if ((!secret || secret.length < 32) && isEntrypoint)
  throw new Error(
    "Set WHATSAPP_SERVICE_TOKEN to at least 32 random characters",
  );

function getStoreUrl(customUrl) {
  if (customUrl && typeof customUrl === "string" && customUrl.startsWith("http")) return customUrl;
  const origin = (process.env.APP_ORIGIN || "https://softwaresolver.online").replace(/\/$/, "");
  return `${origin}/amt_price_list/store`;
}

function formatOtpMessage(code, purpose, customStoreUrl) {
  const storeUrl = getStoreUrl(customStoreUrl);

  let titleAr = "رمز التحقق لتسجيل الدخول";
  let titleEn = "Login Verification Code";
  let actionAr = "لتسجيل الدخول إلى حسابك";
  let actionEn = "to sign in to your account";

  if (purpose === "SIGNUP") {
    titleAr = "تأكيد تسجيل الحساب الجديد";
    titleEn = "Account Registration Code";
    actionAr = "لتفعيل وإنشاء حسابك الجديد";
    actionEn = "to activate your new account";
  } else if (purpose === "CHECKOUT") {
    titleAr = "تأكيد طلب الشراء والدفع";
    titleEn = "Order Checkout Code";
    actionAr = "لتأكيد إتمام طلب الشراء والدفع";
    actionEn = "to verify and complete your order";
  }

  return `⚡ *شركة إيه إم تي للمواد الكهربائية*
*AMT Electrical Supplies*
────────────────────────────
🔐 *${titleAr}*
*${titleEn}*

رمز التحقق الخاص بك ${actionAr} هو:
Your verification code ${actionEn} is:

👉  *${code}*  👈

⏱️ الرمز صالح للاستخدام لمدة *10 دقائق* فقط.
⏱️ Code is valid for *10 minutes* only.

⚠️ *تنبيه أمني هام:* لا تشارك هذا الرمز مع أي شخص، موظفونا لن يطلبوا هذا الرمز منك أبداً.
⚠️ *Security Notice:* Never share this code with anyone. AMT staff will never ask for it.
────────────────────────────
🌐 *متجرنا الإلكتروني الرسمي | Official Store:*
${storeUrl}

📞 *خدمة العملاء والدعم الفني:*
support@amtelectric.com`;
}

function formatTestMessage(customStoreUrl) {
  const storeUrl = getStoreUrl(customStoreUrl);

  return `⚡ *شركة إيه إم تي للمواد الكهربائية | AMT Electric*
────────────────────────────
✅ *اختبار اتصال واتساب ناجح!*
*WhatsApp Connection Test Successful!*

تم ربط نظام واتساب بالمتجر الإلكتروني بنجاح وهو يعمل الآن بكفاءة لإرسال رموز التحقق، تحديثات الطلبات، والرد الآلي على العملاء.
WhatsApp integration is operational and ready to dispatch OTPs, order updates, and automated bot assistance.

🌐 *رابط المتجر:*
${storeUrl}
────────────────────────────`;
}

function translateOrderStatus(status) {
  switch (status) {
    case "PENDING_VERIFICATION": return "بانتظار التحقق (Pending Verification)";
    case "PENDING_PAYMENT": return "بانتظار السداد (Pending Payment)";
    case "PENDING_REVIEW": return "بانتظار المراجعة (Pending Review)";
    case "CONFIRMED": return "مؤكد وجارٍ التجهيز (Confirmed)";
    case "DELIVERED": return "تم التوصيل والتسليم (Delivered)";
    case "CANCELLED": return "ملغي (Cancelled)";
    case "FAILED": return "غير مكتمل (Failed)";
    default: return status || "قيد المعالجة (Processing)";
  }
}

async function handleBotMessage(msg, client) {
  try {
    if (!msg || msg.fromMe) return;
    if (msg.from === "status@broadcast" || msg.isStatus) return;
    if (msg.from.endsWith("@g.us")) return; // skip group chats

    const sender = msg.from;
    const bodyText = (msg.body || "").trim();
    const lower = bodyText.toLowerCase();

    const storeUrl = getStoreUrl();
    const appInternalUrl = process.env.APP_INTERNAL_URL || "http://127.0.0.1:18180/amt_price_list/api/v1";

    // Handle document / media without text
    if (msg.hasMedia && !bodyText) {
      await client.sendMessage(sender, `📄 *شكراً لإرسال الملف! | Document Received*
────────────────────────────
تم استلام ملفك بنجاح. إذا كان هذا جدول كميات لمشروع أو طلب تسعيرة (BOM / RFQ)، سيقوم مهندسو المبيعات بمراجعته والتواصل معك.

🔗 *يمكنك أيضاً رفع ملفك ومتابعته عبر بوابة الشركات والمشاريع:*
${storeUrl}/requirements
────────────────────────────`);
      return;
    }

    // 1. GREETINGS & MAIN MENU
    const isGreeting = ["hi", "hello", "hey", "start", "menu", "مرحبا", "مرحباً", "اهلا", "أهلا", "هلا", "السلام عليكم", "سلام", "قائمة", "الرئيسية", "مساعدة", "help", "0"].includes(lower);

    if (isGreeting || !bodyText) {
      const menu = `⚡ *أهلاً بك في شركة إيه إم تي للمواد الكهربائية*
*Welcome to AMT Electrical Supplies* ⚡
────────────────────────────
يسعدنا خدمتك! وجهتك الموثوقة للمعدات الكهربائية، القواطع، الكابلات، وحلول المشاريع المعتمدة في المملكة العربية السعودية 🇸🇦

How can we assist you today? الرجاء اختيار رقم الخدمة المطلوبة:

1️⃣  🛒 *المتجر وتصفح المنتجات | Store & Catalog*
2️⃣  🔍 *البحث عن صنف وسعر | Search Products & Prices*
3️⃣  📦 *تتبع حالة طلبك | Track Your Order*
4️⃣  📋 *طلب تسعيرة كميات / مشاريع | Request Quotation / RFQ*
5️⃣  📍 *موقعنا ومواعيد العمل | Location & Hours*
6️⃣  💬 *التواصل مع خدمة العملاء | Contact Sales / Support*

────────────────────────────
💡 *أرسل رقم الخيار (1 - 6) أو اكتب اسم الصنف أو رقم الطلب مباشرة!*
💡 *Send a number (1 - 6) or type any product name or order number.*`;
      await client.sendMessage(sender, menu);
      return;
    }

    // 2. OPTION 1: Store & Catalog
    if (["1", "متجر", "المتجر", "كتالوج", "الكتالوج", "منتجات", "المنتجات", "store", "catalog", "shop", "products", "رابط"].includes(lower)) {
      const catalogMsg = `🛒 *متجر إيه إم تي الإلكتروني | AMT Online Store*
────────────────────────────
تصفح أكثر من 40,000 صنف كهربائي معتمد بأسعار منافسة وتوصيل سريع لجميع مدن ومناطق المملكة:

🔗 *رابط المتجر الرسمي المباشر:*
${storeUrl}

✨ *أبرز الأقسام المتوفرة:*
🔹 *القواطع والمفاتيح الكهربائية* (Circuit Breakers, Contactors, Isolators)
🔹 *الكابلات والأسلاك النحاسية* (Riyadh Cables, Bahra, Al Fanar)
🔹 *لوحات التوزيع وأنظمة التحكم* (Distribution Boards & Panels)
🔹 *الإنارة الصناعية والمعمارية* (LED, Floodlights, Panels)
🔹 *مواسير التمديدات والإكسسوارات* (PVC & EMT Conduits, Trunks)
🔹 *محولات ومولدات ومغذيات طاقة* (Transformers & Power Supplies)

🏷️ *علامات تجارية عالمية ومحلية معتمدة:*
Schneider Electric, ABB, Legrand, Al-Fanar, Siemens, Riyadh Cables.

💡 *للبحث عن أي صنف بالاسم أو رقم القطعة، أرسل الاسم هنا مباشرة!*`;
      await client.sendMessage(sender, catalogMsg);
      return;
    }

    // 3. OPTION 2: Search prompt
    if (["2", "بحث", "البحث", "search", "ابحث"].includes(lower)) {
      const searchPrompt = `🔍 *البحث عن المنتجات والأسعار | Search Catalog*
────────────────────────────
أرسل اسم المنتج، رقم القطعة، أو الماركة للبحث الفوري في قاعدة بيانات المتجر!
Type the product name, part number, or brand to search live products and prices.

💡 *أمثلة على البحث:*
• \`Schneider MCB 16A\`
• \`ABB 32A\`
• \`سلك 4 ملم الفنار\`
• \`قاطع 100 امبير\`
• \`004701060\``;
      await client.sendMessage(sender, searchPrompt);
      return;
    }

    // 4. OPTION 3: Track order prompt
    if (["3", "تتبع", "طلب", "طلبي", "حالة الطلب", "track", "order", "status"].includes(lower)) {
      const trackPrompt = `📦 *تتبع حالة الطلب | Track Your Order*
────────────────────────────
لمعرفة تفاصيل وحالة طلبك، يرجى إرسال رقم الطلب (مثال: \`ORD-...\` أو رقم طلبك في المتجر).
Please reply with your Order Number to check its status and fulfillment details.`;
      await client.sendMessage(sender, trackPrompt);
      return;
    }

    // Check if input looks like an order number (e.g. starts with ORD, or contains ORD- or digits)
    const orderMatch = bodyText.match(/(?:ord|amt)[-_]?[a-z0-9\-]+/i);
    const isLikelyOrderNumber = orderMatch || (lower.startsWith("ord") || lower.startsWith("amt"));
    if (isLikelyOrderNumber) {
      const queryNumber = (orderMatch ? orderMatch[0] : bodyText).trim();
      try {
        const fetchRes = await fetch(`${appInternalUrl}/storefront/bot/track-order`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: queryNumber }),
          signal: AbortSignal.timeout(6000),
        });
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.found) {
            const statusText = translateOrderStatus(data.status);
            const dateStr = data.createdAt ? new Date(data.createdAt).toLocaleDateString("ar-SA") : "حديثاً";
            const methodStr = data.fulfillmentMethod === "DELIVERY" ? "توصيل إلى الموقع (Delivery)" : "استلام من المستودع (Pickup)";
            const totalStr = data.totals?.total ? `${data.totals.total} ر.س` : "غير محدد";

            const orderCard = `📦 *تفاصيل الطلب: ${data.number}*
────────────────────────────
🔹 *الحالة | Status:* ${statusText}
📅 *تاريخ الطلب | Date:* ${dateStr}
🚚 *طريقة الاستلام | Method:* ${methodStr}
💵 *المبلغ الإجمالي | Total:* ${totalStr}
📦 *عدد الأصناف | Items:* ${data.itemCount || 1}

🔗 *لمتابعة الطلب وتفاصيل الفاتورة عبر حسابك:*
${storeUrl}/account
────────────────────────────
إذا كان لديك أي استفسار حول الشحنة، أرسل 6 للتواصل مع خدمة العملاء.`;
            await client.sendMessage(sender, orderCard);
            return;
          }
        }
      } catch (err) {
        console.error("Order tracking API error in bot:", err);
      }

      await client.sendMessage(sender, `📦 *تتبع الطلب | Order Tracking*
────────────────────────────
عذراً، لم نتمكن من العثور على طلب برقم: *${queryNumber}*.
يرجى التأكد من كتابة رقم الطلب كما هو مدون في رسالة التأكيد أو الفاتورة.

💬 للاستفسار المباشر، أرسل *6* للتحدث مع خدمة العملاء.`);
      return;
    }

    // 5. OPTION 4: Quotation / RFQ
    if (["4", "تسعيرة", "عرض سعر", "مشروع", "مشاريع", "quote", "rfq", "quotation", "project"].includes(lower) || lower.includes("تسعير")) {
      const rfqMsg = `📋 *طلب تسعيرة كميات ومشاريع | RFQ & Quotations*
────────────────────────────
نقدم في شركة إيه إم تي عروض أسعار تفضيلية للمقاولين، الشركات، والمشاريع الإنشائية والصناعية:

1️⃣ *عبر بوابة المشاريع الإلكترونية (أسرع طريقة):*
ارفع ملف جدول الكميات (Excel / BOM / PDF) مباشرة للحصول على تسعيرة مفصلة:
🔗 ${storeUrl}/requirements

2️⃣ *عبر البريد الإلكتروني للمبيعات:*
✉️ sales@amtelectric.com

3️⃣ *عبر الواتساب مباشرة:*
أرسل ملف جدول الكميات هنا في هذه المحادثة، وسيقوم مهندس التسعير بدراسته وإعداد عرض السعر لك.
────────────────────────────
💡 *لإعادة عرض القائمة الرئيسية، أرسل 0.*`;
      await client.sendMessage(sender, rfqMsg);
      return;
    }

    // 6. OPTION 5: Location & Hours
    if (["5", "موقع", "الموقع", "عنوان", "دوام", "ساعات", "location", "address", "hours", "فروع", "مستودع", "وينكم"].includes(lower)) {
      const locationMsg = `📍 *موقعنا ومواعيد العمل | Location & Hours*
────────────────────────────
🏢 *شركة إيه إم تي للمواد الكهربائية (AMT Electric)*
📍 *المقر الرئيسي والمستودعات المركزية:* الرياض، المملكة العربية السعودية.
Riyadh, Kingdom of Saudi Arabia.

⏰ *أوقات العمل الرسمية:*
• من السبت إلى الخميس: من 8:00 صباحاً حتى 6:00 مساءً
• الجمعة: عطلة أسبوعية

🚚 *الشحن والتوصيل:*
• توصيل فوري داخل مدينة الرياض.
• شحن لجميع مناطق ومدن المملكة خلال 24 - 48 ساعة.

🌐 *المتجر متاح 24/7 للاطلاع على الكتالوج والطلب المباشر:*
${storeUrl}
────────────────────────────
💡 *لإعادة عرض القائمة الرئيسية، أرسل 0.*`;
      await client.sendMessage(sender, locationMsg);
      return;
    }

    // 7. OPTION 6: Customer Support
    if (["6", "دعم", "مساعدة", "خدمة العملاء", "مبيعات", "موظف", "support", "agent", "human", "contact"].includes(lower)) {
      const supportMsg = `💬 *خدمة العملاء وفريق المبيعات | Customer Support*
────────────────────────────
فريقنا يسعد بخدمتكم والإجابة على كافة استفساراتكم الفنية والشرائية:

📞 *الهاتف / المبيعات:*
+966 11 000 0000

✉️ *البريد الإلكتروني:*
support@amtelectric.com | sales@amtelectric.com

🕒 *ساعات التواجد:*
السبت - الخميس: 8:00 صباحاً - 6:00 مساءً.

💡 *يمكنك أيضاً كتابة استفسارك أو طلبك هنا مباشرة، وسيقوم أحد ممثلينا بالرد عليك فوراً.*
────────────────────────────
💡 *لإعادة عرض القائمة الرئيسية، أرسل 0.*`;
      await client.sendMessage(sender, supportMsg);
      return;
    }

    // 8. PRODUCT SEARCH FALLBACK
    if (bodyText.length >= 2) {
      const cleanQuery = bodyText.replace(/^(?:ابحث عن|بحث عن|سعر|كم سعر|اسعار|اريد|أريد|ابغى|أبغى|search|price of)\s+/i, "").trim();
      if (cleanQuery.length >= 2) {
        try {
          const catRes = await fetch(`${appInternalUrl}/storefront/catalog?q=${encodeURIComponent(cleanQuery)}&limit=4`, {
            signal: AbortSignal.timeout(6000),
          });
          if (catRes.ok) {
            const catData = await catRes.json();
            const items = catData.items || [];
            if (items.length > 0) {
              let searchResults = `🔍 *نتائج البحث عن:* "${cleanQuery}"
────────────────────────────\n`;
              items.slice(0, 4).forEach((item, idx) => {
                const num = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"][idx];
                const desc = item.description || item.part_number;
                const part = item.part_number;
                const itemSlug = item.slug || item.id;
                searchResults += `${num} *${part}*\n📌 ${desc}\n🔗 ${storeUrl}/products/${itemSlug}\n\n`;
              });
              searchResults += `────────────────────────────
🌐 *لتصفح كافة النتائج وإتمام الطلب:*
${storeUrl}?q=${encodeURIComponent(cleanQuery)}

💡 *أرسل 0 للعودة إلى القائمة الرئيسية.*`;
              await client.sendMessage(sender, searchResults);
              return;
            }
          }
        } catch (err) {
          console.error("Catalog search error in bot:", err);
        }
      }
    }

    // 9. DEFAULT FALLBACK
    const defaultReply = `مرحباً بك في *إيه إم تي للمواد الكهربائية* ⚡
لم نتمكن من فهم طلبك بدقة.

يمكنك إرسال:
• *1* لتصفح المتجر والمنتجات
• *2* للبحث عن صنف أو سعر
• *3* لتتبع حالة طلبك
• *4* لطلب تسعيرة مشروع / كميات
• *5* لموقعنا وأوقات العمل
• *6* للتحدث مع خدمة العملاء

🌐 أو زيارة متجرنا مباشرة:
${storeUrl}`;
    await client.sendMessage(sender, defaultReply);

  } catch (outerErr) {
    console.error("Error in handleBotMessage:", outerErr);
  }
}

const { createConnection } = require("./whatsapp-connection.cjs");
const connection = createConnection({
  // LocalAuth's default client stores credentials only in this child directory.
  clearSession: () => fs.rm(path.join(sessionDirectory, "session"), { recursive: true, force: true }),
  encodeQr: value => QRCode.toDataURL(value),
  onMessage: handleBotMessage,
  createClient: () => new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDirectory }),
    puppeteer: {
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || require("playwright").chromium.executablePath(),
      args: [
        ...(process.env.WHATSAPP_NO_SANDBOX === "true" ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
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

const server = http.createServer(async (req, res) => {
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
    if (req.url === "/send" && !body.message && !/^\d{6}$/.test(body.code))
      return respond(400, { error: "Invalid code or message" });
    await serial(async () => {
      if (!connection.readyClient()) throw new Error("Disconnected");
      const client = connection.readyClient();
      if (!client) throw new Error("Disconnected");
      const recipient = await client.getNumberId(body.destination.slice(1));
      if (!recipient) throw new Error("Recipient unavailable");

      let message;
      if (req.url === "/test") {
        message = formatTestMessage(body.storeUrl);
      } else if (body.message) {
        message = body.message;
      } else {
        message = formatOtpMessage(body.code, body.purpose, body.storeUrl);
      }

      await client.sendMessage(recipient._serialized, message);
    });
    respond(200, { sent: true });
  } catch (err) {
    respond(503, { error: "WhatsApp operation failed. Reconnect or retry." });
  }
});

if (isEntrypoint) {
  server.listen(Number(process.env.WHATSAPP_PORT || 3010), process.env.WHATSAPP_BIND_HOST || "127.0.0.1");
  void connection.connect();
  const shutdown = async () => {
    await connection.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = {
  formatOtpMessage,
  formatTestMessage,
  translateOrderStatus,
  handleBotMessage,
  getStoreUrl,
  isEntrypoint,
};
