const http = require("node:http");
const { timingSafeEqual } = require("node:crypto");
let Client, LocalAuth;
try {
  ({ Client, LocalAuth } = require("whatsapp-web.js"));
} catch (e) {
  // Optional in test runner or minimal headless environments
}
let QRCode;
try {
  QRCode = require("qrcode");
} catch (e) {}
const path = require("node:path");
const fs = require("node:fs/promises");
const sessionDirectory = path.resolve(process.env.WHATSAPP_SESSION_DIR || "/data/whatsapp");

let userLanguages = {};
const langFilePath = path.join(sessionDirectory, "languages.json");
fs.readFile(langFilePath, "utf8").then(data => {
  try { userLanguages = JSON.parse(data); } catch(e){}
}).catch(()=>{});
const saveLanguages = () => fs.writeFile(langFilePath, JSON.stringify(userLanguages)).catch(()=>{});

let userStates = {};

function parseStaffPricingQuery(raw) {
  let text = (raw || "").trim();
  if (text.startsWith("!")) text = text.slice(1).trim();

  let percent = undefined;
  let percentType = "AUTO";

  // 1. Explicit positive markup (+10% or +10)
  const plusMatch = text.match(/(?:[\s]+|^)\+(\d+(?:\.\d+)?)\s*%?$/);
  if (plusMatch) {
    percent = parseFloat(plusMatch[1]);
    percentType = "MARKUP";
    text = text.slice(0, plusMatch.index).trim();
  } else {
    // 2. Explicit discount (-10% or -10)
    const minusMatch = text.match(/(?:[\s]+|^)\-(\d+(?:\.\d+)?)\s*%?$/);
    if (minusMatch) {
      percent = parseFloat(minusMatch[1]);
      percentType = "DISCOUNT";
      text = text.slice(0, minusMatch.index).trim();
    } else {
      // 3. Trailing percentage (%10 or % 10 or 10% or space 10)
      const numMatch = text.match(/(?:[\s%]+)(\d+(?:\.\d+)?)\s*%?$/);
      if (numMatch) {
        percent = parseFloat(numMatch[1]);
        percentType = "AUTO";
        text = text.slice(0, numMatch.index).trim();
      } else {
        // 4. Has % symbol without number (e.g. LC1D09M7 % or % LC1D09M7)
        const pctIdx = text.indexOf("%");
        if (pctIdx !== -1) {
          const before = text.slice(0, pctIdx).trim();
          const after = text.slice(pctIdx + 1).trim();
          const afterNum = parseFloat(after);
          if (!isNaN(afterNum) && after.length > 0) {
            percent = afterNum;
            percentType = "AUTO";
            text = before;
          } else {
            text = before || after;
          }
        }
      }
    }
  }

  text = text.replace(/^[!%\s]+|[!%\s]+$/g, "").trim();
  return { partNumber: text, percent, percentType };
}

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

function getMainMenu(isEn, storeUrl) {
  return isEn ? `⚡ *Welcome to AMT Electrical Supplies* ⚡
────────────────────────────
We are happy to serve you! Your trusted destination for electrical equipment, breakers, cables, and project solutions in KSA 🇸🇦

How can we assist you today? Please select a service number:

1️⃣  🛒 *Store & Catalog*
2️⃣  🔍 *Search Products & Prices*
3️⃣  📦 *Track Your Order*
4️⃣  📋 *Request Quotation / RFQ*
5️⃣  📍 *Location & Hours*
6️⃣  💬 *Contact Sales / Support*

────────────────────────────
💡 *Send a number (1 - 6) or type any product name or order number.*
🌐 *Language: Send 'lang' or '00' to change language.*` : `⚡ *أهلاً بك في شركة إيه إم تي للمواد الكهربائية* ⚡
────────────────────────────
يسعدنا خدمتك! وجهتك الموثوقة للمعدات الكهربائية، القواطع، الكابلات، وحلول المشاريع المعتمدة في المملكة العربية السعودية 🇸🇦

الرجاء اختيار رقم الخدمة المطلوبة:

1️⃣  🛒 *المتجر وتصفح المنتجات*
2️⃣  🔍 *البحث عن صنف وسعر*
3️⃣  📦 *تتبع حالة طلبك*
4️⃣  📋 *طلب تسعيرة كميات / مشاريع*
5️⃣  📍 *موقعنا ومواعيد العمل*
6️⃣  💬 *التواصل مع خدمة العملاء*

────────────────────────────
💡 *أرسل رقم الخيار (1 - 6) أو اكتب اسم الصنف أو رقم الطلب مباشرة!*
🌐 *لتغيير اللغة: أرسل 'lang' أو '00'*`;
}

function getLanguagePrompt() {
  return `⚡ *شركة إيه إم تي للمواد الكهربائية*
*AMT Electrical Supplies*
────────────────────────────
🌐 *الرجاء اختيار اللغة / Please select your language:*

1️⃣  العربية (Arabic) 🇸🇦
2️⃣  English 🇬🇧

💡 *أرسل 1 للغة العربية أو 2 للإنجليزية*
💡 *Reply 1 for Arabic or 2 for English*
────────────────────────────`;
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

    // STAFF PRICING COMMAND (!partNumber or partNumber % or %partNumber)
    const isPricingCmd = bodyText.startsWith("!") || bodyText.includes("%");
    if (isPricingCmd) {
      const parsed = parseStaffPricingQuery(bodyText);
      const partNumber = parsed.partNumber;
      const percent = parsed.percent;
      const percentType = parsed.percentType;

      if (!partNumber) {
        await client.sendMessage(sender, `⚠️ *صيغة أمر التسعير غير مكتملة | Incomplete Command*
يرجى إرسال رقم الصنف مع نسبة الخصم أو هامش الربح الاختياري، مثال:
\`!LC1D09M7\`
\`!LC1D09M7 %\`
\`!LC1D09M7 10%\`
\`LC1D09M7 % 20\``);
        return;
      }

      const senderPhone = sender.replace(/@.*$/, "");

      try {
        const res = await fetch(`${appInternalUrl}/storefront/bot/price`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            query: partNumber, 
            senderPhone, 
            discount: percent, 
            percent, 
            percentType 
          })
        });
        const data = await res.json();

        if (data.authorized === false) {
          await client.sendMessage(sender, `🔒 *أمر خاص بموظفي شركة إيه إم تي | AMT Staff Only*
────────────────────────────
⚠️ رقم الواتساب الخاص بك غير مسجل كموظف في نظام إيه إم تي.
لتفعيل صلاحية تسعير الموظفين، يرجى التواصل مع مدير النظام (Admin) لإضافة رقم جوالك في ملف المستخدم الخاص بك.

⚠️ Your WhatsApp phone number is not registered in the AMT staff directory. Please contact your administrator to add your phone number in user management.`);
          return;
        }

        if (!data.found) {
          await client.sendMessage(sender, `🔍 *بحث تسعيرة الموظفين | Staff Price Check*
────────────────────────────
❌ الصنف *${partNumber}* غير موجود في قاعدة بيانات المتجر أو غير نشط.
يرجى التأكد من كتابة رقم الصنف أو البديل بشكل صحيح.
Part number *${partNumber}* was not found in active products.`);
          return;
        }

        const staffName = data.staff ? data.staff.name : "AMT Staff";
        const stockStr = (data.stock > 0) ? `✅ ${data.stock} ${data.unit || "حبة"}` : "⚠️ غير متوفر حالياً في المستودع";
        const discAlert = !data.discountAllowed ? `\n⚠️ *تنبيه:* النسبة المطلوبة تتجاوز الحد المسموح لك (${data.staff?.maxDiscount}%).` : "";

        let staffCard = "";
        if (data.method === "COST_MARKUP") {
          staffCard = `🏷️ *تفاصيل تسعيرة الصنف (تكلفة + هامش ربح) | Staff Price Details*
────────────────────────────
👤 *الموظف:* ${staffName}
🔹 *رقم الصنف (Part No):* *${data.partNumber}*
📌 *الوصف:* ${data.description || "—"}
🏢 *الماركة:* ${data.brand || "—"}
📦 *المخزون المتوفر:* ${stockStr}

⚙️ *نظام التسعير:* تكلفة + هامش ربح (Cost + Markup)
🔒 *سعر التكلفة:* ${data.cost} ريال
📈 *نسبة هامش الربح:* ${data.markupPercent}%
💵 *السعر الأساسي (قبل الضريبة):* ${data.priceExcl} ريال
📑 *ضريبة القيمة المضافة (${data.vat}%):* ${data.vatAmount} ريال
✨ *السعر النهائي للعميل:* *${data.finalPrice} ريال* (شامل الضريبة)
────────────────────────────
💡 *للطلب أو الحجز أو إضافة تسعيرة، استخدم لوحة تحكم إيه إم تي الداخلية.*`;
        } else {
          staffCard = `🏷️ *تفاصيل تسعيرة الصنف (سعر قائمة - خصم) | Staff Price Details*
────────────────────────────
👤 *الموظف:* ${staffName}
🔹 *رقم الصنف (Part No):* *${data.partNumber}*
📌 *الوصف:* ${data.description || "—"}
🏢 *الماركة:* ${data.brand || "—"}
📦 *المخزون المتوفر:* ${stockStr}

⚙️ *نظام التسعير:* سعر القائمة - خصم (List - Discount)
📋 *سعر القائمة:* ${data.listPrice} ريال
📉 *نسبة الخصم:* ${data.discountPercent}%${discAlert}
💵 *السعر بعد الخصم (قبل الضريبة):* ${data.priceExcl} ريال
📑 *ضريبة القيمة المضافة (${data.vat}%):* ${data.vatAmount} ريال
✨ *السعر النهائي للعميل:* *${data.finalPrice} ريال* (شامل الضريبة)
${data.cost ? `🔒 *سعر التكلفة الداخلي:* ${data.cost} ريال` : ""}
────────────────────────────
💡 *للطلب أو الحجز أو إضافة تسعيرة، استخدم لوحة تحكم إيه إم تي الداخلية.*`;
        }

        await client.sendMessage(sender, staffCard);
      } catch (err) {
        console.error("Bot price command error:", err);
        await client.sendMessage(sender, `❌ حدث خطأ أثناء جلب تسعيرة الصنف: ${partNumber}. يرجى المحاولة لاحقاً.`);
      }
      return;
    }

    // LANGUAGE SWITCH COMMAND (ANYTIME)
    if (["lang", "language", "لغة", "اللغة", "00", "تغيير اللغة"].includes(lower)) {
      delete userLanguages[sender];
      saveLanguages();
      await client.sendMessage(sender, getLanguagePrompt());
      return;
    }

    // LANGUAGE SELECTION LOGIC
    let lang = userLanguages[sender];

    if (!lang) {
      if (["1", "١", "عربي", "ar", "arabic", "العربية"].includes(lower)) {
        userLanguages[sender] = "ar";
        saveLanguages();
        await client.sendMessage(sender, "تم اختيار اللغة العربية بنجاح 🇸🇦");
        await client.sendMessage(sender, getMainMenu(false, storeUrl));
        return;
      }
      if (["2", "٢", "english", "en", "eng"].includes(lower)) {
        userLanguages[sender] = "en";
        saveLanguages();
        await client.sendMessage(sender, "Language has been set to English 🇬🇧");
        await client.sendMessage(sender, getMainMenu(true, storeUrl));
        return;
      }

      // Check if it's an Arabic greeting, auto-set Arabic and show menu
      const isArabicGreeting = ["مرحبا", "مرحباً", "اهلا", "أهلا", "هلا", "السلام عليكم", "سلام"].includes(lower);
      if (isArabicGreeting) {
        userLanguages[sender] = "ar";
        saveLanguages();
        await client.sendMessage(sender, getMainMenu(false, storeUrl));
        return;
      }

      // Default to English
      userLanguages[sender] = "en";
      saveLanguages();
      lang = "en";
    }

    // Explicit language switch while already set
    if (lower === "english" || lower === "en") {
      userLanguages[sender] = "en";
      saveLanguages();
      await client.sendMessage(sender, "Language has been set to English 🇬🇧\n\n" + getMainMenu(true, storeUrl));
      return;
    }
    if (lower === "عربي" || lower === "ar" || lower === "arabic" || lower === "العربية") {
      userLanguages[sender] = "ar";
      saveLanguages();
      await client.sendMessage(sender, "تم اختيار اللغة العربية بنجاح 🇸🇦\n\n" + getMainMenu(false, storeUrl));
      return;
    }

    const isEn = lang === "en";

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
      await client.sendMessage(sender, getMainMenu(isEn, storeUrl));
      return;
    }

    // 2. OPTION 1: Store & Catalog
    if (["1", "متجر", "المتجر", "كتالوج", "الكتالوج", "منتجات", "المنتجات", "store", "catalog", "shop", "products", "رابط"].includes(lower)) {
      const catalogMsg = isEn ? `🛒 *AMT Online Store*
────────────────────────────
Browse over 40,000 certified electrical products with competitive prices and fast delivery to all KSA regions:

🔗 *Direct Store Link:*
${storeUrl}

✨ *Main Categories:*
🔹 *Circuit Breakers & Switches*
🔹 *Cables & Wires*
🔹 *Distribution Boards & Panels*
🔹 *Industrial & Architectural Lighting*
🔹 *Conduits & Accessories*
🔹 *Transformers & Power Supplies*

🏷️ *Certified Brands:*
Schneider Electric, ABB, Legrand, Al-Fanar, Siemens, Riyadh Cables.

💡 *To search for any product by name or part number, send it here directly!*` : `🛒 *متجر إيه إم تي الإلكتروني*
────────────────────────────
تصفح أكثر من 40,000 صنف كهربائي معتمد بأسعار منافسة وتوصيل سريع لجميع مدن ومناطق المملكة:

🔗 *رابط المتجر الرسمي المباشر:*
${storeUrl}

✨ *أبرز الأقسام المتوفرة:*
🔹 *القواطع والمفاتيح الكهربائية*
🔹 *الكابلات والأسلاك النحاسية*
🔹 *لوحات التوزيع وأنظمة التحكم*
🔹 *الإنارة الصناعية والمعمارية*
🔹 *مواسير التمديدات والإكسسوارات*
🔹 *محولات ومولدات ومغذيات طاقة*

🏷️ *علامات تجارية عالمية ومحلية معتمدة:*
Schneider Electric, ABB, Legrand, Al-Fanar, Siemens, Riyadh Cables.

💡 *للبحث عن أي صنف بالاسم أو رقم القطعة، أرسل الاسم هنا مباشرة!*`;
      await client.sendMessage(sender, catalogMsg);
      return;
    }

    // 3. OPTION 2: Search prompt (Direct to Store Catalog)
    if (["2", "٢", "بحث", "البحث", "search", "ابحث"].includes(lower)) {
      const searchPrompt = isEn ? `🔍 *Browse Store Catalog & Search*
────────────────────────────
To search products, check live prices, and order directly online:
🔗 ${storeUrl}

💡 Or send any product name or part number here to get direct links!` : `🔍 *تصفح متجر ومنتجات إيه إم تي*
────────────────────────────
للبحث عن المنتجات، الاطلاع على الأسعار المعتمدة، وإتمام الطلب مباشرة:
🔗 ${storeUrl}

💡 أو اكتب اسم الصنف أو رقم القطعة هنا للحصول على روابط مباشرة في المتجر!`;
      await client.sendMessage(sender, searchPrompt);
      return;
    }

    // 4. OPTION 3: Track order prompt
    if (["3", "٣", "تتبع", "طلب", "طلبي", "حالة الطلب", "track", "order", "status"].includes(lower)) {
      userStates[sender] = { action: "AWAITING_ORDER_NUMBER", time: Date.now() };
      const trackPrompt = isEn ? `📦 *Track Your Order*
────────────────────────────
To check the status of your order, please reply with your Order Number (e.g., \`WEB-...\` or \`ORD-...\` or your web order number).` : `📦 *تتبع حالة الطلب*
────────────────────────────
لمعرفة تفاصيل وحالة طلبك، يرجى إرسال رقم الطلب (مثال: \`WEB-...\` أو \`ORD-...\` أو رقم طلبك في المتجر).`;
      await client.sendMessage(sender, trackPrompt);
      return;
    }

    // Check if input looks like an order number or user was awaiting order number
    const isAwaitingOrder = userStates[sender]?.action === "AWAITING_ORDER_NUMBER" && (Date.now() - userStates[sender].time < 900000);
    const orderMatch = bodyText.match(/(?:(?:web|ord|amt)[-_]?[a-z0-9\-]+)|(?:#[a-z0-9\-]+)/i);
    const hasOrderKeywords = lower.startsWith("web") || lower.startsWith("ord") || lower.startsWith("amt") || bodyText.startsWith("#");

    if (orderMatch || hasOrderKeywords || (isAwaitingOrder && bodyText.length >= 3 && !bodyText.startsWith("!"))) {
      delete userStates[sender];
      const queryNumber = (orderMatch ? orderMatch[0] : bodyText).trim();
      const senderPhone = sender.replace(/@.*$/, "");
      try {
        const fetchRes = await fetch(`${appInternalUrl}/storefront/bot/track-order`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: queryNumber, senderPhone }),
          signal: AbortSignal.timeout(6000),
        });
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.found) {
            const statusText = translateOrderStatus(data.status);
            const dateStr = data.createdAt ? new Date(data.createdAt).toLocaleDateString(isEn ? "en-US" : "ar-SA") : (isEn ? "Recently" : "حديثاً");
            const methodStr = data.fulfillmentMethod === "DELIVERY" ? (isEn ? "Delivery" : "توصيل إلى الموقع") : (isEn ? "Pickup" : "استلام من المستودع");
            const totalStr = data.totals?.total ? `${data.totals.total} SAR` : (isEn ? "Unknown" : "غير محدد");

            let trackingDetails = "";
            if (data.tracking) {
              trackingDetails = isEn 
                ? `\n🚚 *Carrier:* ${data.carrier || "Courier Service"}\n🔢 *Tracking Number:* *${data.tracking}*`
                : `\n🚚 *شركة الشحن الناقلة:* ${data.carrier || "خدمة التوصيل"}\n🔢 *رقم بوليصة الشحن (التتبع):* *${data.tracking}*`;
            }
            if (data.fulfillmentStatus) {
              const fText = data.fulfillmentStatus === "SHIPPED" 
                ? (isEn ? "Shipped (In Transit)" : "تم الشحن وهي في طريقها إليك")
                : (data.fulfillmentStatus === "PROCESSING" ? (isEn ? "Preparing in Warehouse" : "جارٍ التجهيز في المستودع") : statusText);
              trackingDetails += isEn ? `\n📍 *Fulfillment Status:* ${fText}` : `\n📍 *حالة التجهيز والشحن:* ${fText}`;
            }

            const orderCard = isEn ? `📦 *Order Details: ${data.number}*
────────────────────────────
🔹 *Status:* ${statusText}${trackingDetails}
📅 *Date:* ${dateStr}
🚚 *Fulfillment:* ${methodStr}
💵 *Total:* ${totalStr}
📦 *Items:* ${data.itemCount || 1}

🔗 *To track the order and view invoice on your account:*
${storeUrl}/account
────────────────────────────
If you have any questions, reply with 6 to contact support.` : `📦 *تفاصيل الطلب: ${data.number}*
────────────────────────────
🔹 *الحالة:* ${statusText}${trackingDetails}
📅 *تاريخ الطلب:* ${dateStr}
🚚 *طريقة الاستلام:* ${methodStr}
💵 *المبلغ الإجمالي:* ${totalStr}
📦 *عدد الأصناف:* ${data.itemCount || 1}

🔗 *لمتابعة الطلب وتفاصيل الفاتورة عبر حسابك:*
${storeUrl}/account
────────────────────────────
إذا كان لديك أي استفسار حول الشحنة، أرسل 6 للتواصل مع خدمة العملاء.`;
            await client.sendMessage(sender, orderCard);
            return;
          } else if (data.unauthorized) {
            await client.sendMessage(sender, isEn ? 
              `🔒 *Unauthorized | غير مصرح*\n────────────────────────────\nThis order does not belong to your WhatsApp number.\nPlease register this phone number in your account settings and send the order number again.` : 
              `🔒 *غير مصرح | Unauthorized*\n────────────────────────────\nهذا الطلب غير مرتبط برقم الواتساب الخاص بك.\nيرجى تسجيل هذا الرقم في حسابك عبر الموقع والمحاولة مرة أخرى.`);
            return;
          }
        }
      } catch (err) {
        console.error("Order tracking API error in bot:", err);
      }

      await client.sendMessage(sender, isEn ? `📦 *Order Tracking*
────────────────────────────
Sorry, we could not find an order with number: *${queryNumber}*.
Please ensure you typed the order number exactly as it appears on your confirmation (e.g. \`WEB-...\` or \`ORD-...\`).

💬 For further assistance, send *6* to contact support.` : `📦 *تتبع الطلب*
────────────────────────────
عذراً، لم نتمكن من العثور على طلب برقم: *${queryNumber}*.
يرجى التأكد من كتابة رقم الطلب كما هو مدون في رسالة التأكيد أو الفاتورة (مثال: \`WEB-...\` أو \`ORD-...\`).

💬 للاستفسار المباشر، أرسل *6* للتحدث مع خدمة العملاء.`);
      return;
    }

    // 5. OPTION 4: Quotation / RFQ
    if (["4", "تسعيرة", "عرض سعر", "مشروع", "مشاريع", "quote", "rfq", "quotation", "project"].includes(lower) || lower.includes("تسعير")) {
      const rfqMsg = isEn ? `📋 *RFQ & Quotations*
────────────────────────────
We offer special pricing for contractors, companies, and projects:

1️⃣ *Via Corporate Portal (Fastest):*
Upload your BOQ (Excel / PDF) directly to get a detailed quote:
🔗 ${storeUrl}/requirements

2️⃣ *Via Email:*
✉️ sales@amtelectric.com

3️⃣ *Via WhatsApp:*
Send your BOQ document here, and our pricing engineers will review it and prepare an offer.
────────────────────────────
💡 *To return to the main menu, send 0.*` : `📋 *طلب تسعيرة كميات ومشاريع*
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
      const locationMsg = isEn ? `📍 *Location & Hours*
────────────────────────────
🏢 *AMT Electrical Supplies*
📍 *Head Office & Central Warehouse:* Riyadh, KSA.

⏰ *Business Hours:*
• Saturday - Thursday: 8:00 AM - 6:00 PM
• Friday: Closed

🚚 *Shipping & Delivery:*
• Instant delivery inside Riyadh.
• 24-48h shipping to all KSA regions.

🌐 *Store is available 24/7 for direct ordering:*
${storeUrl}
────────────────────────────
💡 *To return to the main menu, send 0.*` : `📍 *موقعنا ومواعيد العمل*
────────────────────────────
🏢 *شركة إيه إم تي للمواد الكهربائية (AMT Electric)*
📍 *المقر الرئيسي والمستودعات المركزية:* الرياض، المملكة العربية السعودية.

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
      const supportMsg = isEn ? `💬 *Customer Support & Sales*
────────────────────────────
Our team is happy to assist you:

📞 *Phone / Sales:*
+966 11 000 0000

✉️ *Email:*
support@amtelectric.com | sales@amtelectric.com

🕒 *Working Hours:*
Sat - Thu: 8:00 AM - 6:00 PM

💡 *You can also write your inquiry directly here, and a representative will reply shortly.*
────────────────────────────
💡 *To return to the main menu, send 0.*` : `💬 *خدمة العملاء وفريق المبيعات*
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

    // 8. PRODUCT SEARCH FALLBACK (Directs customers to Storefront, avoids exposing internal prices)
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
              let searchResults = isEn ? `🔍 *Catalog Search Results:* "${cleanQuery}"
────────────────────────────\n` : `🔍 *نتائج البحث في المتجر:* "${cleanQuery}"
────────────────────────────\n`;
              items.slice(0, 4).forEach((item, idx) => {
                const num = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"][idx];
                const desc = item.description || item.part_number;
                const part = item.part_number;
                const itemSlug = item.slug || item.id;
                searchResults += `${num} *${part}*\n📌 ${desc}\n🔗 ${storeUrl}/products/${itemSlug}\n\n`;
              });
              searchResults += isEn ? `────────────────────────────
🌐 *To view pricing, check stock, and checkout:*
${storeUrl}?q=${encodeURIComponent(cleanQuery)}

💡 *Send 0 to return to the main menu.*` : `────────────────────────────
🌐 *للاطلاع على الأسعار وتوفر المخزون والطلب أونلاين:*
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
    const defaultReply = isEn ? `Welcome to *AMT Electrical Supplies* ⚡
We couldn't quite understand your request.

You can send:
• *1* Store & Catalog
• *2* Search for a product
• *3* Track your order
• *4* Request a quotation
• *5* Location & Hours
• *6* Contact Support

🌐 Or visit our store directly:
${storeUrl}` : `مرحباً بك في *إيه إم تي للمواد الكهربائية* ⚡
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
