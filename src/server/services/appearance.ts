// The accent color of the whole app. Read on every page load, so it is cached in memory (one
// instance; see ARQUITECTURA.md) and refreshed when it changes. Who may change it: teachers the
// admin enabled for "Pedidos de cambios" (teachers.can_request_changes), the app's trusted docentes.
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { DEFAULT_ACCENT, isAccent, type Accent } from "@shared/domain/accents";

const KEY = "accent";
let cached: { accent: Accent; chosen: boolean } | null = null;

export async function currentAccent(): Promise<{ accent: Accent; chosen: boolean }> {
  if (cached) return cached;
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY));
  cached = row && isAccent(row.value) ? { accent: row.value, chosen: true } : { accent: DEFAULT_ACCENT, chosen: false };
  return cached;
}

export async function canChooseAppearance(teacherId: string | null | undefined): Promise<boolean> {
  if (!teacherId) return false;
  const [t] = await db
    .select({ allowed: schema.teachers.canRequestChanges })
    .from(schema.teachers)
    .where(eq(schema.teachers.id, teacherId));
  return t?.allowed === true;
}

export async function setAccent(teacherId: string, accent: Accent) {
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value: accent, updatedBy: teacherId })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: accent, updatedBy: teacherId, updatedAt: new Date() } });
  cached = { accent, chosen: true };
}

/** Tests start from an empty database: forget what was cached. */
export function resetAppearanceCache() {
  cached = null;
}
