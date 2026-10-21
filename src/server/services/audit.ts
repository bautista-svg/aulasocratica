import type { Context } from "hono";
import { db, schema } from "../db/client";
import { clientIp } from "../lib/request";
import { log, errorFields } from "../lib/logger";

/** Security-relevant actions (sign-in, deletions, resets). Never stores message content. */
export async function audit(
  c: Context | null,
  teacherId: string | null,
  action: string,
  entityType = "",
  entityId: string | null = null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(schema.auditLogs).values({
      teacherId,
      action,
      entityType,
      entityId,
      ip: c ? clientIp(c) : "",
      details,
    });
  } catch (err) {
    log.warn("audit_failed", { action, ...errorFields(err) });
  }
}
