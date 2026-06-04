import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createPostgresClient(databaseUrl: string) {
  return postgres(databaseUrl, { max: 10 });
}

export function createDb(databaseUrl: string) {
  const client = createPostgresClient(databaseUrl);
  return { client, db: drizzle(client, { schema }) };
}

export type Db = ReturnType<typeof createDb>["db"];
