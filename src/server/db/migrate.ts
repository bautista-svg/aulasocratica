// Applies the versioned SQL migrations in /drizzle at startup, under an advisory lock so
// two processes never migrate at the same time.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sqlClient } from "./client";
import { log } from "../lib/logger";

function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dev: src/server/db → ../../../drizzle ; prod bundle: dist/server → ../../drizzle
  const candidates = [path.resolve(here, "../../../drizzle"), path.resolve(here, "../../drizzle"), path.resolve("drizzle")];
  const found = candidates.find((p) => fs.existsSync(path.join(p, "meta", "_journal.json")));
  if (!found) throw new Error("No se encontró la carpeta de migraciones (drizzle/)");
  return found;
}

export async function runMigrations(): Promise<void> {
  const folder = migrationsFolder();
  await sqlClient`select pg_advisory_lock(727001)`;
  try {
    await migrate(db, { migrationsFolder: folder });
    log.info("migrations_applied", { folder });
  } finally {
    await sqlClient`select pg_advisory_unlock(727001)`;
  }
}
