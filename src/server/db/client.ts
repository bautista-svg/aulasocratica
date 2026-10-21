import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export const sqlClient = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  idle_timeout: 30,
  connect_timeout: 10,
  // Keep timestamps as ISO strings at the edges; Drizzle maps them to Date objects.
  onnotice: () => {},
});

export const db = drizzle(sqlClient, { schema, casing: "snake_case" });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };

export async function pingDb(): Promise<boolean> {
  try {
    await sqlClient`select 1`;
    return true;
  } catch {
    return false;
  }
}
