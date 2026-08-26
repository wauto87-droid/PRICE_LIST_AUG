import { z } from "zod";
import { one, type DB } from "../core/db";
import { audit, json } from "../core/audit";
import { assert } from "../core/errors";
import { requirePermission, lockActor, type Actor } from "../auth/service";
const text = z.string().trim().max(2000).default("");
const asset = z
  .string()
  .max(800000)
  .refine(
    (s) => !s || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s),
    "Use a PNG, JPEG or WebP image",
  )
  .default("");
export const quotationSettingsSchema = z
  .object({
    prefix: z
      .string()
      .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/)
      .max(24)
      .default("AMT-QT"),
    padding: z.number().int().min(4).max(12).default(6),
    legalName: text,
    vatRegistration: text,
    commercialRegistration: text,
    address: text,
    city: text,
    country: text,
    phone: text,
    email: text,
    website: text,
    bankName: text,
    accountName: text,
    iban: text,
    validityDays: z.number().int().min(0).max(365).default(30),
    delivery: text,
    payment: text,
    notes: text,
    termsEnglish: text,
    termsArabic: text,
    signatureLabel: text,
    footer: text,
    logo: asset,
    watermark: z
      .object({
        enabled: z.boolean().default(false),
        useLogo: z.boolean().default(true),
        image: asset,
        text: z.string().max(100).default(""),
        opacity: z.number().min(0.02).max(0.25).default(0.08),
        size: z.number().min(80).max(450).default(260),
        rotation: z.number().min(-90).max(90).default(-30),
        position: z.enum(["CENTER", "TOP", "BOTTOM"]).default("CENTER"),
      })
      .default({
        enabled: false,
        useLogo: true,
        image: "",
        text: "",
        opacity: 0.08,
        size: 260,
        rotation: -30,
        position: "CENTER",
      }),
  })
  .strict();
export function documentSettings(settings: any) {
  return quotationSettingsSchema.parse(settings.quotation ?? {});
}
export async function sequenceState(db: DB) {
  const row = (await one(
    db,
    "SELECT last_value::text,is_called FROM quotation_serial_seq",
  ))!;
  return {
    last: row.is_called ? row.last_value : null,
    next: (BigInt(row.last_value) + (row.is_called ? 1n : 0n)).toString(),
  };
}
export async function getSettings(db: DB, actor: Actor) {
  requirePermission(actor, "SETTINGS_MANAGE");
  const row = (await one(db, "SELECT data,version FROM settings WHERE id=1"))!;
  return {
    quotation: documentSettings(row.data),
    companyName: row.data.companyName,
    companyArabic: row.data.companyArabic,
    currency: row.data.currency,
    vat: row.data.vat,
    pdfUnitPrices: row.data.pdfUnitPrices,
    version: row.version,
    sequence: await sequenceState(db),
  };
}
export async function saveSettings(db: DB, actor: Actor, input: unknown) {
  requirePermission(actor, "SETTINGS_MANAGE");
  const data = z
    .object({
      quotation: quotationSettingsSchema,
      version: z.number().int(),
      companyName: z.string().min(1).max(100),
      companyArabic: z.string().max(100),
      pdfUnitPrices: z.enum(["BOTH", "EXCL", "INCL"]),
      nextSerial: z
        .string()
        .regex(/^[1-9]\d{0,17}$/)
        .optional(),
      reason: z.string().trim().max(500).default(""),
    })
    .strict()
    .parse(input);
  await db.transaction(async (tx) => {
    const row = (await one(
      tx,
      "SELECT data,version FROM settings WHERE id=1 FOR UPDATE",
    ))!;
    assert(
      row.version === data.version,
      409,
      "Settings changed. Reload before saving",
    );
    await lockActor(tx, actor);
    if (data.nextSerial) {
      const state = await sequenceState(tx);
      assert(
        BigInt(data.nextSerial) > BigInt(state.next),
        400,
        "Next serial must increase; lowering or reusing numbers is prohibited",
      );
      assert(
        data.reason.length > 0,
        400,
        "A reason is required to raise the serial",
      );
      await audit(
        tx,
        actor.id,
        "QUOTATION_SEQUENCE_RAISE",
        "settings",
        "1",
        state,
        { next: data.nextSerial },
        data.reason,
      );
      await tx.query("SELECT setval('quotation_serial_seq',$1::bigint,false)", [
        data.nextSerial,
      ]);
    }
    const after = {
      ...row.data,
      quotation: data.quotation,
      companyName: data.companyName,
      companyArabic: data.companyArabic,
      pdfUnitPrices: data.pdfUnitPrices,
    };
    await tx.query("UPDATE settings SET data=$1,version=version+1 WHERE id=1", [
      json(after),
    ]);
    await audit(
      tx,
      actor.id,
      "QUOTATION_SETTINGS_CHANGE",
      "settings",
      "1",
      row.data,
      after,
    );
  });
  return getSettings(db, actor);
}
export async function allocateNumber(
  db: DB,
  quotationId: string,
  actor: Actor,
  settings: any,
) {
  const config = documentSettings(settings);
  const serial = (await one(
    db,
    "SELECT nextval('quotation_serial_seq')::text AS serial",
  ))!.serial;
  const number = `${config.prefix}-${serial.padStart(config.padding, "0")}`;
  assert(
    !(await one(db, "SELECT id FROM quotations WHERE number=$1", [number])),
    409,
    "Quotation number already reserved; retry to allocate a new number",
  );
  await db.query(
    "INSERT INTO quotation_allocations(serial,number,quotation_id,actor_id) VALUES($1,$2,$3,$4)",
    [serial, number, quotationId, actor.id],
  );
  return { serial, number };
}
