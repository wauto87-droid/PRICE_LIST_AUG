import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// The formatter is deliberately pure so message content can be verified without
// a connected company phone or a real customer destination.
const messages = createRequire(import.meta.url)("../scripts/whatsapp-messages.cjs");

test("OTP messages identify AMT, explain login verification, and keep the code prominent", () => {
  const message = messages.formatOtpMessage("123456", "LOGIN");
  assert.match(message, /^AMT Electric\nLogin verification\n\n123456/m);
  assert.match(message, /expires in 10 minutes/i);
  assert.match(message, /Do not share it with anyone/i);
  assert.match(message, /تأكيد تسجيل الدخول/);
  assert.match(message, /لا تشاركه مع أي شخص/);
  assert.match(message, /https:\/\/softwaresolver\.online\/amt_price_list\/store/);
});

test("connection test message uses the same professional bilingual AMT style", () => {
  const message = messages.formatTestMessage();
  assert.match(message, /^AMT Electric\nWhatsApp connection test successful\./m);
  assert.match(message, /تم اختبار اتصال واتساب بنجاح/);
  assert.match(message, /https:\/\/softwaresolver\.online\/amt_price_list\/store/);
});
