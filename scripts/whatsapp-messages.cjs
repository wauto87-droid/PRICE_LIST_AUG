const storefrontUrl = "https://softwaresolver.online/amt_price_list/store";

const purposeCopy = {
  CHECKOUT: {
    en: "Checkout verification",
    ar: "تأكيد إتمام الطلب",
  },
  SIGNUP: {
    en: "Account verification",
    ar: "تأكيد إنشاء الحساب",
  },
  LOGIN: {
    en: "Login verification",
    ar: "تأكيد تسجيل الدخول",
  },
};

function copyFor(purpose) {
  return purposeCopy[purpose] || purposeCopy.CHECKOUT;
}

function formatOtpMessage(code, purpose = "CHECKOUT") {
  const copy = copyFor(purpose);
  return [
    "AMT Electric",
    copy.en,
    "",
    code,
    "",
    "This code expires in 10 minutes. Do not share it with anyone.",
    `Store: ${storefrontUrl}`,
    "",
    "AMT Electric",
    copy.ar,
    "",
    code,
    "",
    "الرمز صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.",
    `المتجر: ${storefrontUrl}`,
  ].join("\n");
}

function formatTestMessage() {
  return [
    "AMT Electric",
    "WhatsApp connection test successful.",
    "The verification service is ready.",
    `Store: ${storefrontUrl}`,
    "",
    "AMT Electric",
    "تم اختبار اتصال واتساب بنجاح.",
    "خدمة التحقق جاهزة.",
    `المتجر: ${storefrontUrl}`,
  ].join("\n");
}

module.exports = { formatOtpMessage, formatTestMessage, storefrontUrl };
