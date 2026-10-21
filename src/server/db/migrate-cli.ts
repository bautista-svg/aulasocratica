import { runMigrations } from "./migrate";
import { sqlClient } from "./client";

await runMigrations();
await sqlClient.end();
