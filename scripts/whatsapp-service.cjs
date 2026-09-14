const http = require("node:http");
const { timingSafeEqual } = require("node:crypto");
const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const path = require("node:path");
const fs = require("node:fs/promises");
const sessionDirectory = path.resolve(process.env.WHATSAPP_SESSION_DIR || "/data/whatsapp");

let userLanguages = {};
const langFilePath = path.join(sessionDirectory, "languages.json");
fs.readFile(langFilePath, "utf8").then(data => {
  try { userLanguages = JSON.parse(data); } catch(e){}
}).catch(()=>{});
const saveLanguages = () => fs.writeFile(langFilePath, JSON.stringify(userLanguages)).catch(()=>{});

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

    // STAFF PRICING COMMAND
    if (bodyText.startsWith("!")) {
      const parts = bodyText.slice(1).split(" ");
      const partNumber = parts[0];
      const discountStr = parts.length > 1 ? parts[1].replace("%", "") : "0";
      const discount = parseFloat(discountStr) || 0;
      
      try {
        const res = await fetch(`${appInternalUrl}/storefront/bot/price`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: partNumber })
        });
        const data = await res.json();
        if (data.found) {
          const price = parseFloat(data.priceExcl);
          const discountedPrice = price * (1 - discount / 100);
          const vat = parseFloat(data.vat) / 100;
          const finalPrice = discountedPrice * (1 + vat);
          const msgResponse = `*Price details for ${data.partNumber}*
Original Price: ${price.toFixed(2)} SAR (excl. VAT)
Discount Applied: ${discount}%
Discounted Price: ${discountedPrice.toFixed(2)} SAR (excl. VAT)
Final Price with ${data.vat}% VAT: ${finalPrice.toFixed(2)} SAR`;
          await client.sendMessage(sender, msgResponse);
        } else {
          await client.sendMessage(sender, `Part number ${partNumber} not found.`);
        }
      } catch (err) {
        await client.sendMessage(sender, `Error fetching price for ${partNumber}.`);
      }
      return;
    }

    // LANGUAGE SELECTION LOGIC
    if (lower === "english" || lower === "en") {
      userLanguages[sender] = "en";
      saveLanguages();
      await client.sendMessage(sender, "Language has been set to English. Send 'menu' to see options.");
      return;
    }
    if (lower === "عربي" || lower === "ar" || lower === "arabic") {
      userLanguages[sender] = "ar";
      saveLanguages();
      await client.sendMessage(sender, "تم اختيار اللغة العربية بنجاح. أرسل 'القائمة' لعرض الخيارات.");
      return;
    }

    const lang = userLanguages[sender];
    if (!lang) {
      await client.sendMessage(sender, `Please choose your language to continue / الرجاء اختيار اللغة للمتابعة\nType *English* for English\nاكتب *عربي* للغة العربية`);
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
      const menu = isEn ? `⚡ *Welcome to AMT Electrical Supplies* ⚡
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
💡 *Send a number (1 - 6) or type any product name or order number.*` : `⚡ *أهلاً بك في شركة إيه إم تي للمواد الكهربائية* ⚡
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
💡 *أرسل رقم الخيار (1 - 6) أو اكتب اسم الصنف أو رقم الطلب مباشرة!*`;
      await client.sendMessage(sender, menu);
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

    // 3. OPTION 2: Search prompt
    if (["2", "بحث", "البحث", "search", "ابحث"].includes(lower)) {
      const searchPrompt = isEn ? `🔍 *Search Catalog & Prices*
────────────────────────────
Send the product name, part number, or brand to search our database instantly!

💡 *Examples:*
• \`Schneider MCB 16A\`
• \`ABB 32A\`
• \`Al-Fanar 4mm wire\`
• \`100A breaker\`
• \`004701060\`` : `🔍 *البحث عن المنتجات والأسعار*
────────────────────────────
أرسل اسم المنتج، رقم القطعة، أو الماركة للبحث الفوري في قاعدة بيانات المتجر!

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
      const trackPrompt = isEn ? `📦 *Track Your Order*
────────────────────────────
To check the status of your order, please reply with your Order Number (e.g., \`ORD-...\` or your web order number).` : `📦 *تتبع حالة الطلب*
────────────────────────────
لمعرفة تفاصيل وحالة طلبك، يرجى إرسال رقم الطلب (مثال: \`ORD-...\` أو رقم طلبك في المتجر).`;
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
            const dateStr = data.createdAt ? new Date(data.createdAt).toLocaleDateString(isEn ? "en-US" : "ar-SA") : (isEn ? "Recently" : "حديثاً");
            const methodStr = data.fulfillmentMethod === "DELIVERY" ? (isEn ? "Delivery" : "توصيل إلى الموقع") : (isEn ? "Pickup" : "استلام من المستودع");
            const totalStr = data.totals?.total ? `${data.totals.total} SAR` : (isEn ? "Unknown" : "غير محدد");

            const orderCard = isEn ? `📦 *Order Details: ${data.number}*
────────────────────────────
🔹 *Status:* ${statusText}
📅 *Date:* ${dateStr}
🚚 *Fulfillment:* ${methodStr}
💵 *Total:* ${totalStr}
📦 *Items:* ${data.itemCount || 1}

🔗 *To track the order and view invoice on your account:*
${storeUrl}/account
────────────────────────────
If you have any questions, reply with 6 to contact support.` : `📦 *تفاصيل الطلب: ${data.number}*
────────────────────────────
🔹 *الحالة:* ${statusText}
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
          }
        }
      } catch (err) {
        console.error("Order tracking API error in bot:", err);
      }

      await client.sendMessage(sender, isEn ? `📦 *Order Tracking*
────────────────────────────
Sorry, we could not find an order with number: *${queryNumber}*.
Please ensure you typed the order number exactly as it appears on your confirmation.

💬 For further assistance, send *6* to contact support.` : `📦 *تتبع الطلب*
────────────────────────────
عذراً، لم نتمكن من العثور على طلب برقم: *${queryNumber}*.
يرجى التأكد من كتابة رقم الطلب كما هو مدون في رسالة التأكيد أو الفاتورة.

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
              let searchResults = isEn ? `🔍 *Search Results for:* "${cleanQuery}"
────────────────────────────\n` : `🔍 *نتائج البحث عن:* "${cleanQuery}"
────────────────────────────\n`;
              items.slice(0, 4).forEach((item, idx) => {
                const num = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"][idx];
                const desc = item.description || item.part_number;
                const part = item.part_number;
                const itemSlug = item.slug || item.id;
                searchResults += `${num} *${part}*\n📌 ${desc}\n🔗 ${storeUrl}/products/${itemSlug}\n\n`;
              });
              searchResults += isEn ? `────────────────────────────
🌐 *To browse all results and checkout:*
${storeUrl}?q=${encodeURIComponent(cleanQuery)}

💡 *Send 0 to return to the main menu.*` : `────────────────────────────
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
