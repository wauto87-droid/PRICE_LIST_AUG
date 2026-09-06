import test from "node:test";
import assert from "node:assert/strict";
import { embedded, migrate, one } from "../backend/core/db";
import * as store from "../backend/storefront/service";
import { normalizePhone } from "../backend/storefront/whatsapp";

test("mandatory WhatsApp signup and purpose-bound customer login", async (t) => {
  Object.assign(process.env, { NODE_ENV: "test" });
  const db = await embedded();
  t.after(() => db.close?.());
  await migrate(db);
  const details = {
    name: "Retail Buyer",
    email: "retail@example.com",
    mobile: "0500000021",
    password: "Buyer123456!",
    accountType: "RETAIL",
  };
  async function code(mobile: string, purpose = "SIGNUP") {
    const c = await store.requestOtp(db, {
      destination: mobile,
      channel: "WHATSAPP",
      purpose,
    });
    const v = await store.verifyOtp(db, { id: c.id, code: c.testCode });
    return { verificationId: c.id, verificationToken: v.verificationToken };
  }
  await t.test(
    "normalizes Saudi and international mobiles consistently",
    () => {
      assert.equal(normalizePhone("050 000 0021"), "+966500000021");
      assert.equal(normalizePhone("00966500000021"), "+966500000021");
      assert.throws(() => normalizePhone("user@example.com"));
    },
  );
  await t.test(
    "rejects signup without OTP or email signup challenge",
    async () => {
      await assert.rejects(store.registerAccount(db, details));
      await assert.rejects(
        store.requestOtp(db, {
          destination: details.email,
          channel: "EMAIL",
          purpose: "SIGNUP",
        }),
        /WhatsApp/,
      );
      assert.equal(
        (await one(db, "SELECT count(*) n FROM customer_accounts"))!.n,
        0,
      );
    },
  );
  const verification = await code(details.mobile);
  await t.test(
    "rejects changed mobile and accepts verified retail signup",
    async () => {
      await assert.rejects(
        store.registerAccount(db, {
          ...details,
          ...verification,
          mobile: "0500000022",
        }),
        /verification/,
      );
      const account = await store.registerAccount(db, {
        ...details,
        ...verification,
      });
      assert.equal(account.status, "ACTIVE");
      const saved = await one(
        db,
        "SELECT * FROM customer_accounts WHERE id=$1",
        [account.id],
      );
      assert.equal(saved!.verified_mobile, "+966500000021");
      assert.equal(saved!.company_id, null);
      assert.ok(
        (
          await store.loginAccount(db, {
            login: details.email,
            password: details.password,
          })
        ).token,
      );
    },
  );
  await t.test(
    "consumed signup proof cannot register or log in again",
    async () => {
      await assert.rejects(
        store.registerAccount(db, { ...details, ...verification }),
        /verification/,
      );
      await assert.rejects(
        store.loginAccountOtp(db, { mobile: details.mobile, ...verification }),
        /verification/,
      );
    },
  );
  await t.test(
    "resend cooldown applies across normalized destination spellings",
    async () => {
      await assert.rejects(
        store.requestOtp(db, {
          destination: "+966500000021",
          channel: "WHATSAPP",
          purpose: "LOGIN",
        }),
        /60 seconds/,
      );
    },
  );
  await t.test(
    "login OTP is single-use and cannot authorize signup",
    async () => {
      await db.query(
        "UPDATE commerce_otp_destinations SET sent_at=now()-interval '2 minutes'",
      );
      const login = await code(details.mobile, "LOGIN");
      await assert.rejects(
        store.registerAccount(db, { ...details, ...login }),
        /verification/,
      );
      assert.ok(
        (await store.loginAccountOtp(db, { mobile: details.mobile, ...login }))
          .token,
      );
      await assert.rejects(
        store.loginAccountOtp(db, { mobile: details.mobile, ...login }),
        /verification/,
      );
    },
  );
  await t.test(
    "company signup is phone verified but company approval remains pending",
    async () => {
      const v = await code("0500000023");
      const result = await store.registerAccount(db, {
        ...details,
        email: "company@example.com",
        mobile: "0500000023",
        accountType: "COMPANY",
        ...v,
      });
      assert.equal(result.status, "ACTIVE");
      assert.equal(result.companyStatus, "PENDING");
    },
  );
  await t.test(
    "incorrect codes consume attempts and expired codes fail",
    async () => {
      const challenge = await store.requestOtp(db, {
        destination: "0500000024",
        channel: "WHATSAPP",
        purpose: "SIGNUP",
      });
      const wrong = challenge.testCode === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++)
        await assert.rejects(
          store.verifyOtp(db, { id: challenge.id, code: wrong }),
          /incorrect/,
        );
      await assert.rejects(
        store.verifyOtp(db, { id: challenge.id, code: challenge.testCode }),
        /Too many/,
      );
      const exp = await store.requestOtp(db, {
        destination: "0500000025",
        channel: "WHATSAPP",
        purpose: "SIGNUP",
      });
      await db.query(
        "UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
        [exp.id],
      );
      await assert.rejects(
        store.verifyOtp(db, { id: exp.id, code: exp.testCode }),
        /expired/,
      );
    },
  );
  await t.test(
    "provider failure creates no usable verification challenge",
    async () => {
      const original = globalThis.fetch;
      process.env.WHATSAPP_SERVICE_URL = "http://whatsapp.invalid";
      process.env.WHATSAPP_SERVICE_TOKEN = "test-token";
      globalThis.fetch = async () => new Response("{}", { status: 503 });
      try {
        const before = (await one(db, "SELECT count(*) n FROM otp_challenges"))!
          .n;
        await assert.rejects(
          store.requestOtp(db, {
            destination: "0500000026",
            channel: "WHATSAPP",
            purpose: "SIGNUP",
          }),
          /disconnected/,
        );
        assert.equal(
          (await one(db, "SELECT count(*) n FROM otp_challenges"))!.n,
          before,
        );
      } finally {
        globalThis.fetch = original;
        delete process.env.WHATSAPP_SERVICE_URL;
        delete process.env.WHATSAPP_SERVICE_TOKEN;
      }
    },
  );
});
