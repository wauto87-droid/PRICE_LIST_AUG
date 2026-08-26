import { randomUUID } from "node:crypto";
import type { DB } from "./db";
export const json = (v: unknown) => JSON.stringify(v ?? null);
export async function audit(
  db: DB,
  actor: string | null,
  action: string,
  entity: string,
  id: string | null,
  before: unknown = null,
  after: unknown = null,
  reason: string | null = null,
) {
  await db.query(
    "INSERT INTO audit_logs(id,actor_id,action,entity,entity_id,before_value,after_value,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      randomUUID(),
      actor,
      action,
      entity,
      id,
      json(before),
      json(after),
      reason,
    ],
  );
}
