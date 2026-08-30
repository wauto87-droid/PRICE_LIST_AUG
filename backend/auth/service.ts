import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit } from "../core/audit";
export const PERMISSIONS = [
  "PRODUCT_VIEW",
  "PRODUCT_CREATE",
  "PRODUCT_EDIT",
  "PRODUCT_DELETE",
  "COST_VIEW",
  "MIN_PRICE_VIEW",
  "PRICE_HISTORY_VIEW",
  "QUOTE_CREATE",
  "QUOTE_EDIT",
  "QUOTE_DELETE",
  "QUOTE_ISSUE",
  "QUOTE_VIEW_ALL",
  "QUOTE_EDIT_ALL",
  "OVERRIDE_MINIMUM_PRICE",
  "IMPORT_EXCEL",
  "IMPORT_PDF",
  "IMPORT_CONFIRM",
  "USER_MANAGE",
  "BACKUP_MANAGE",
  "SETTINGS_MANAGE",
  "AUDIT_VIEW",
  "ADMIN_VIEW",
  "EXPORT",
  "SALES_PRICE_CHECK",
  "QUANTITY_FINDER",
  "REUSABLE_CUSTOM_MANAGE",
] as const;
export type Actor = {
  id: string;
  username: string;
  name: string;
  role: string;
  permissions: string[];
  maxDiscount: string;
  csrf: string;
};
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const passwordSchema = z.string().min(4).max(128);
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?:[a-z0-9_.-]{3,80}|[a-z0-9_.+\-]{1,64}@[a-z0-9.-]{1,251}\.[a-z]{2,})$/,
  );
export const has = (a: Actor, p: string) => a.permissions.includes(p);
export async function lockActor(db: DB, actor: Actor) {
  const current = await one(
    db,
    `SELECT u.disabled,u.permissions AS user_permissions,r.permissions,COALESCE(u.max_discount,r.max_discount)::text AS max_discount FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 FOR SHARE OF u,r`,
    [actor.id],
  );
  assert(current && !current.disabled, 401, "Account disabled or unavailable");
  const permissions = [
    ...new Set<string>([...current.permissions, ...current.user_permissions]),
  ].sort();
  assert(
    JSON.stringify(permissions) ===
      JSON.stringify([...actor.permissions].sort()) &&
      current.max_discount === actor.maxDiscount,
    409,
    "Your permissions changed. Reload and review again",
  );
}
export function requirePermission(a: Actor, p: string) {
  assert(has(a, p), 403, "You do not have permission for this action");
}
export const pricingPolicy = (a: Actor) => ({
  maxDiscount: a.maxDiscount,
  canOverride: has(a, "OVERRIDE_MINIMUM_PRICE"),
});
export async function throttle(db: DB, key: string, limit = 10) {
  const row = await one(
    db,
    `INSERT INTO login_attempts(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.expires_at<now() THEN 1 ELSE login_attempts.attempts+1 END,expires_at=CASE WHEN login_attempts.expires_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.expires_at END RETURNING attempts`,
    [digest(key)],
  );
  assert(
    row!.attempts <= limit,
    429,
    "Too many attempts. Please wait 15 minutes.",
  );
}
export async function setup(db: DB, input: unknown) {
  const data = z
    .object({
      token: z.string(),
      username: usernameSchema,
      password: passwordSchema,
      name: z.string().trim().min(1).max(100),
      companyName: z.string().trim().min(1).max(100),
      currency: z.literal("SAR").default("SAR"),
    })
    .strict()
    .parse(input);
  const expected = process.env.SETUP_TOKEN ?? "";
  assert(
    expected.length >= 32 &&
      data.token.length === expected.length &&
      timingSafeEqual(Buffer.from(data.token), Buffer.from(expected)),
    403,
    "Invalid setup token",
  );
  return db.transaction(async (tx) => {
    await tx.query("SELECT id FROM settings WHERE id=1 FOR UPDATE");
    assert(
      !(await one(tx, "SELECT id FROM users LIMIT 1")),
      409,
      "Setup has already been completed",
    );
    await tx.query(
      "INSERT INTO roles(id,permissions,max_discount) VALUES($1,$2,$3),($4,$5,$6),($7,$8,$9)",
      [
        "ADMIN",
        [...PERMISSIONS],
        "100",
        "MANAGER",
        [
          "PRODUCT_VIEW",
          "QUOTE_CREATE",
          "QUOTE_EDIT",
          "QUOTE_ISSUE",
          "QUOTE_VIEW_ALL",
        ],
        "20",
        "STAFF",
        ["PRODUCT_VIEW", "QUOTE_CREATE", "QUOTE_EDIT", "QUOTE_ISSUE"],
        "5",
      ],
    );
    const id = randomUUID();
    await tx.query(
      "INSERT INTO users(id,username,name,password_hash,role_id) VALUES($1,$2,$3,$4,$5)",
      [id, data.username, data.name, await hash(data.password), "ADMIN"],
    );
    await tx.query(`UPDATE settings SET data=data || $1::jsonb WHERE id=1`, [
      JSON.stringify({
        companyName: data.companyName,
        currency: data.currency,
      }),
    ]);
    await audit(tx, id, "SETUP", "settings", "1");
    return { ok: true };
  });
}
export async function login(db: DB, input: unknown) {
  const { username, password } = z
    .object({ username: usernameSchema, password: z.string().max(128) })
    .strict()
    .parse(input);
  await throttle(db, "login:" + username);
  const user = await one(db, "SELECT * FROM users WHERE username=$1", [
    username,
  ]);
  // Always execute an expensive hash operation even when the account does not exist.
  const valid = user
    ? await verify(user.password_hash, password)
    : Boolean(await hash(password)) && false;
  assert(valid && !user!.disabled, 401, "Invalid username or password");
  const token = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions VALUES($1,$2,$3,now()+interval '400 days')",
    [digest(token), user!.id, csrf],
  );
  await audit(db, user!.id, "LOGIN", "users", user!.id);
  return { token, csrf };
}
export async function authenticate(db: DB, request: Request): Promise<Actor> {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("amt_session="))
    ?.slice(12);
  assert(token, 401, "Please sign in");
  const row = await one(
    db,
    `SELECT u.id,u.username,u.name,u.role_id,u.permissions AS user_permissions,r.permissions,COALESCE(u.max_discount,r.max_discount)::text AS max_discount,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled`,
    [digest(token)],
  );
  assert(row, 401, "Session expired. Please sign in");
  await db.query(
    "UPDATE sessions SET expires_at=now()+interval '400 days' WHERE token_hash=$1",
    [digest(token)],
  );
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role_id,
    permissions: [
      ...new Set<string>([...row.permissions, ...row.user_permissions]),
    ],
    maxDiscount: row.max_discount,
    csrf: row.csrf,
  };
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_ORIGIN || "http://localhost:18180";
  assert(origin === expected, 403, "Request origin is not allowed");
}
export function checkCsrf(request: Request, actor: Actor) {
  checkOrigin(request);
  assert(
    request.headers.get("x-csrf-token") === actor.csrf,
    403,
    "Session verification failed. Reload and try again",
  );
}
export async function logout(db: DB, request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("amt_session="))
    ?.slice(12);
  if (token)
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]);
}
export const sessionCookie = (token: string) =>
  `amt_session=${token}; HttpOnly; SameSite=Strict; Path=/amt_price_list/; Max-Age=${token ? 34560000 : 0}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`;

export const requestSessionToken = (request: Request) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("amt_session="))
    ?.slice(12) ?? "";
